import { InventoryMovement } from '../src/inventory/entities/inventory-movement.entity.js';
import { Order } from '../src/orders/entities/order.entity.js';
import { Payment } from '../src/payments/entities/payments.entity.js';
import { Product } from '../src/products/entities/product.entity.js';
import { UserRole } from '../src/users/entities/user.entity.js';
import {
  WhatsAppOrder,
  WhatsAppOrderStatus,
} from '../src/whatsapp/entities/whatsapp-order.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

type Fixture = Awaited<ReturnType<TestApp['createUser']>>;
type Item = { productId: string; quantity: number };
type PaymentInput = { amount: number; method: string };

describe('Notas de pedido, reparto y entrega', () => {
  let t: TestApp;
  let office: Fixture;
  let driver: Fixture;
  let otherDriver: Fixture;

  beforeAll(async () => {
    t = await createTestApp();
    office = await t.createUser(UserRole.VENTAS);
    driver = await t.createUser(UserRole.REPARTO, { name: 'Repartidor Uno' });
    otherDriver = await t.createUser(UserRole.REPARTO);
  });

  afterAll(() => t.close());

  const createNote = (
    customerId: string,
    items: Item[],
    extra: Record<string, unknown> = { assignedToId: driver.user.id },
  ) =>
    t
      .http()
      .post('/orders')
      .set('authorization', office.auth)
      .send({ customerId, items, ...extra });

  const deliver = (
    orderId: string,
    items: Item[],
    payments: PaymentInput[] = [],
    who: Fixture = driver,
  ) =>
    t
      .http()
      .post(`/orders/${orderId}/deliver`)
      .set('authorization', who.auth)
      .send({ items, payments });

  const noteFor = async (items: Item[], stock = 100) => {
    const customer = await t.createCustomer();
    const products = await Promise.all(
      items.map(() => t.createProduct({ stock })),
    );
    const res = await createNote(
      customer.id,
      items.map((item, i) => ({ ...item, productId: products[i].id })),
    ).expect(201);

    return { customer, products, order: res.body.order as Order };
  };

  describe('nota de pedido', () => {
    it('se crea pendiente, con el total estimado y sin tocar el stock', async () => {
      const customer = await t.createCustomer();
      const chinchulin = await t.createProduct({ salePrice: 1000, stock: 50 });

      const res = await createNote(customer.id, [
        { productId: chinchulin.id, quantity: 5 },
      ]).expect(201);

      expect(res.body.order).toMatchObject({
        status: 'pending',
        assignedToId: driver.user.id,
      });
      expect(Number(res.body.order.total)).toBe(5000);
      expect(Number(res.body.items[0].requestedQuantity)).toBe(5);
      expect(await t.stockOf(chinchulin.id)).toBe(50);
      expect(
        await t.dataSource
          .getRepository(InventoryMovement)
          .countBy({ referenceId: res.body.order.id }),
      ).toBe(0);
    });

    it('rechaza productos inactivos y clientes inactivos', async () => {
      const customer = await t.createCustomer();
      const inactive = await t.createProduct({ isActive: false });
      await createNote(customer.id, [
        { productId: inactive.id, quantity: 1 },
      ]).expect(404);

      const inactiveCustomer = await t.createCustomer({ isActive: false });
      const product = await t.createProduct();
      await createNote(inactiveCustomer.id, [
        { productId: product.id, quantity: 1 },
      ]).expect(404);
    });

    it('rechaza un repartidor inexistente', async () => {
      const customer = await t.createCustomer();
      const product = await t.createProduct();

      await createNote(customer.id, [{ productId: product.id, quantity: 1 }], {
        assignedToId: '00000000-0000-4000-8000-000000000000',
      }).expect(404);
    });

    it('se puede modificar mientras está pendiente', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 2 },
      ]);

      const res = await t
        .http()
        .patch(`/orders/${order.id}`)
        .set('authorization', office.auth)
        .send({
          items: [{ productId: products[0].id, quantity: 3.5 }],
          deliveryDate: '2026-10-20',
        })
        .expect(200);

      expect(Number(res.body.order.total)).toBe(3500);
      expect(res.body.order.deliveryDate).toBe('2026-10-20');
    });

    it('se asigna a un repartidor y se anula', async () => {
      const { order } = await noteFor([{ productId: '', quantity: 1 }]);

      const assigned = await t
        .http()
        .post(`/orders/${order.id}/assign`)
        .set('authorization', office.auth)
        .send({ assignedToId: otherDriver.user.id, deliveryDate: '2026-10-21' })
        .expect(201);
      expect(assigned.body).toMatchObject({
        assignedToId: otherDriver.user.id,
        deliveryDate: '2026-10-21',
      });

      await t
        .http()
        .post(`/orders/${order.id}/cancel`)
        .set('authorization', office.auth)
        .expect(201);

      await deliver(order.id, [], [], otherDriver).expect(409);
    });

    it('no se pueden cobrar notas sin entregar', async () => {
      const { order } = await noteFor([{ productId: '', quantity: 1 }]);

      const res = await t
        .http()
        .post('/payments')
        .set('authorization', office.auth)
        .send({ orderId: order.id, amount: 100, method: 'cash' })
        .expect(400);

      expect(res.body.message).toContain('todavía no se entregó');
    });
  });

  describe('entrega', () => {
    it('con los kilos pesados: descuenta el stock real y calcula el total real', async () => {
      const { order, products } = await noteFor(
        [
          { productId: '', quantity: 5 },
          { productId: '', quantity: 2 },
        ],
        50,
      );
      const [chinchulin, molleja] = products;

      const res = await deliver(order.id, [
        { productId: chinchulin.id, quantity: 4.7 }, // menos de lo pedido
        { productId: molleja.id, quantity: 2.35 }, // más de lo pedido
      ]).expect(201);

      expect(res.body.order).toMatchObject({
        status: 'delivered',
        deliveredById: driver.user.id,
      });
      expect(Number(res.body.order.total)).toBe(7050); // (4.7 + 2.35) × 1000
      expect(await t.stockOf(chinchulin.id)).toBe(45.3);
      expect(await t.stockOf(molleja.id)).toBe(47.65);

      const items = res.body.items.map(
        (i: { requestedQuantity: string; quantity: string }) => [
          Number(i.requestedQuantity),
          Number(i.quantity),
        ],
      );
      expect(items).toEqual(
        expect.arrayContaining([
          [5, 4.7],
          [2, 2.35],
        ]),
      );
    });

    it('el cliente agrega un producto y no lleva otro', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 3 },
        { productId: '', quantity: 1 },
      ]);
      const [taken, rejected] = products;
      const added = await t.createProduct({ salePrice: 2500, stock: 10 });

      const res = await deliver(order.id, [
        { productId: taken.id, quantity: 3 },
        { productId: added.id, quantity: 1.2 },
      ]).expect(201);

      expect(Number(res.body.order.total)).toBe(6000); // 3000 + 1.2 × 2500
      expect(await t.stockOf(rejected.id)).toBe(100);
      expect(await t.stockOf(added.id)).toBe(8.8);

      const byProduct = Object.fromEntries(
        res.body.items.map(
          (i: {
            productId: string;
            quantity: string;
            requestedQuantity: string;
          }) => [
            i.productId,
            [Number(i.requestedQuantity), Number(i.quantity)],
          ],
        ),
      );
      expect(byProduct[rejected.id]).toEqual([1, 0]);
      expect(byProduct[added.id]).toEqual([0, 1.2]);
    });

    it('respeta el precio de la nota aunque el producto haya aumentado', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 2 },
      ]);
      await t.dataSource
        .getRepository(Product)
        .update(products[0].id, { salePrice: 1500 });

      const res = await deliver(order.id, [
        { productId: products[0].id, quantity: 2 },
      ]).expect(201);

      expect(Number(res.body.order.total)).toBe(2000);
    });

    it('permite que el stock quede negativo (diferencias de peso)', async () => {
      const { order, products } = await noteFor(
        [{ productId: '', quantity: 5 }],
        3,
      );

      await deliver(order.id, [
        { productId: products[0].id, quantity: 5.4 },
      ]).expect(201);

      expect(await t.stockOf(products[0].id)).toBe(-2.4);
    });

    it('cobro combinado y parcial: el resto queda en cuenta corriente', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 5 },
      ]);

      const res = await deliver(
        order.id,
        [{ productId: products[0].id, quantity: 5 }],
        [
          { amount: 2000, method: 'cash' },
          { amount: 1500, method: 'transfer' },
        ],
      ).expect(201);

      expect(res.body).toMatchObject({ collected: 3500, pending: 1500 });
      expect(res.body.order.paymentStatus).toBe('partial');

      const payments = await t.dataSource
        .getRepository(Payment)
        .findBy({ orderId: order.id });
      expect(payments).toHaveLength(2);
      expect(payments.every((p) => p.collectedById === driver.user.id)).toBe(
        true,
      );
    });

    it('sin cobro queda pendiente de pago; con todo cobrado, pagada', async () => {
      const unpaid = await noteFor([{ productId: '', quantity: 1 }]);
      const r1 = await deliver(unpaid.order.id, [
        { productId: unpaid.products[0].id, quantity: 1 },
      ]).expect(201);
      expect(r1.body.order.paymentStatus).toBe('pending');

      const paid = await noteFor([{ productId: '', quantity: 1 }]);
      const r2 = await deliver(
        paid.order.id,
        [{ productId: paid.products[0].id, quantity: 1 }],
        [{ amount: 1000, method: 'transfer' }],
      ).expect(201);
      expect(r2.body.order.paymentStatus).toBe('paid');
    });

    it('rechaza cobrar más que el total y no cambia nada', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 1 },
      ]);

      const res = await deliver(
        order.id,
        [{ productId: products[0].id, quantity: 1 }],
        [{ amount: 1000.01, method: 'cash' }],
      ).expect(400);

      expect(res.body.message).toContain('supera el total');
      expect(await t.stockOf(products[0].id)).toBe(100);
      expect(
        (
          await t.dataSource
            .getRepository(Order)
            .findOneByOrFail({ id: order.id })
        ).status,
      ).toBe('pending');
    });

    it('si no se entregó nada pide marcarla como no entregada', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 1 },
      ]);

      const res = await deliver(order.id, [
        { productId: products[0].id, quantity: 0 },
      ]).expect(400);

      expect(res.body.message).toContain('no entregado');
    });

    it('rechaza el mismo producto repetido en la entrega', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 1 },
      ]);

      await deliver(order.id, [
        { productId: products[0].id, quantity: 1 },
        { productId: products[0].id, quantity: 1 },
      ]).expect(400);
    });

    it('un repartidor no puede entregar notas de otro; la oficina sí', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 1 },
      ]);
      const items = [{ productId: products[0].id, quantity: 1 }];

      await deliver(order.id, items, [], otherDriver).expect(403);
      await deliver(order.id, items, [], office).expect(201);
    });

    it('no se puede entregar dos veces, ni con entregas simultáneas', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 2 },
      ]);
      const items = [{ productId: products[0].id, quantity: 2 }];

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          deliver(order.id, items, [{ amount: 2000, method: 'cash' }]),
        ),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await t.stockOf(products[0].id)).toBe(98);
      expect(
        await t.dataSource
          .getRepository(Payment)
          .countBy({ orderId: order.id }),
      ).toBe(1);
    });

    it('20 entregas simultáneas del mismo producto descuentan exactamente', async () => {
      const product = await t.createProduct({ stock: 100 });
      const notes = await Promise.all(
        Array.from({ length: 20 }, async () => {
          const customer = await t.createCustomer();
          const res = await createNote(customer.id, [
            { productId: product.id, quantity: 1 },
          ]).expect(201);
          return res.body.order.id as string;
        }),
      );

      const results = await Promise.all(
        notes.map((id) =>
          deliver(id, [{ productId: product.id, quantity: 1 }]),
        ),
      );

      expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
      expect(await t.stockOf(product.id)).toBe(80);
    });

    it('no se puede modificar una nota entregada', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 1 },
      ]);
      await deliver(order.id, [
        { productId: products[0].id, quantity: 1 },
      ]).expect(201);

      await t
        .http()
        .patch(`/orders/${order.id}`)
        .set('authorization', office.auth)
        .send({ notes: 'cambio' })
        .expect(409);
    });
  });

  describe('no entregado', () => {
    it('vuelve a la oficina sin repartidor, con el motivo y sin tocar el stock', async () => {
      const { order, products } = await noteFor([
        { productId: '', quantity: 2 },
      ]);

      const res = await t
        .http()
        .post(`/orders/${order.id}/not-delivered`)
        .set('authorization', driver.auth)
        .send({ reason: 'No había nadie' })
        .expect(201);

      expect(res.body).toMatchObject({
        status: 'pending',
        assignedToId: null,
        deliveryComment: 'No había nadie',
      });
      expect(await t.stockOf(products[0].id)).toBe(100);
    });

    it('un repartidor no puede marcar notas de otro', async () => {
      const { order } = await noteFor([{ productId: '', quantity: 1 }]);

      await t
        .http()
        .post(`/orders/${order.id}/not-delivered`)
        .set('authorization', otherDriver.auth)
        .send({ reason: 'x' })
        .expect(403);
    });
  });

  describe('pantalla del repartidor', () => {
    it('ve solo sus notas pendientes, con los datos del cliente', async () => {
      const mine = await t.createUser(UserRole.REPARTO);
      const customer = await t.createCustomer({
        name: 'Carnicería Centro',
        address: 'San Martín 123',
        phone: '3415556789',
      });
      const product = await t.createProduct({ name: 'Chinchulín' });
      const items = [{ productId: product.id, quantity: 3 }];

      const today = await createNote(customer.id, items, {
        assignedToId: mine.user.id,
        deliveryDate: '2026-10-14',
      }).expect(201);
      await createNote(customer.id, items, {
        assignedToId: mine.user.id,
        deliveryDate: '2026-10-15',
      }).expect(201);
      await createNote(customer.id, items, {
        assignedToId: otherDriver.user.id,
      }).expect(201);

      const all = await t
        .http()
        .get('/deliveries/mine')
        .set('authorization', mine.auth)
        .expect(200);
      expect(all.body).toHaveLength(2);

      const res = await t
        .http()
        .get('/deliveries/mine?date=2026-10-14')
        .set('authorization', mine.auth)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: today.body.order.id,
        customer: {
          name: 'Carnicería Centro',
          address: 'San Martín 123',
          phone: '3415556789',
        },
        items: [
          { productName: 'Chinchulín', requestedQuantity: 3, quantity: 3 },
        ],
      });
    });

    it('recibe todos los datos del cliente y lo que debía de antes', async () => {
      const mine = await t.createUser(UserRole.REPARTO);
      const customer = await t.createCustomer({
        name: 'Restaurante El Asador',
        phone: '3415550001',
        email: 'compras@elasador.com',
        address: 'Pellegrini 456',
        notes: 'Entregar por la puerta de atrás',
        taxId: '30712345679',
        taxCondition: 1,
        collectDebt: true,
      });
      const product = await t.createProduct({ salePrice: 1000, stock: 50 });
      const items = [{ productId: product.id, quantity: 3 }];
      const deliverAs = (id: string, paid: number) =>
        t
          .http()
          .post(`/orders/${id}/deliver`)
          .set('authorization', mine.auth)
          .send({
            items,
            payments: paid ? [{ amount: paid, method: 'cash' }] : [],
          })
          .expect(201);

      // Dos entregas anteriores: una quedó debiendo $1000 y otra $3000.
      const first = await createNote(customer.id, items, {
        assignedToId: mine.user.id,
      });
      await deliverAs(first.body.order.id, 2000);
      const second = await createNote(customer.id, items, {
        assignedToId: mine.user.id,
      });
      await deliverAs(second.body.order.id, 0);

      await createNote(customer.id, items, {
        assignedToId: mine.user.id,
      }).expect(201);

      const res = await t
        .http()
        .get('/deliveries/mine')
        .set('authorization', mine.auth)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].customer).toEqual({
        id: customer.id,
        name: 'Restaurante El Asador',
        phone: '3415550001',
        email: 'compras@elasador.com',
        address: 'Pellegrini 456',
        notes: 'Entregar por la puerta de atrás',
        taxId: '30712345679',
        taxCondition: 1,
        collectDebt: true,
        pendingBalance: 4000,
        specialPrices: {},
      });
    });

    it('la oficina ve la lista de repartidores para asignar', async () => {
      const res = await t
        .http()
        .get('/deliveries/drivers')
        .set('authorization', office.auth)
        .expect(200);

      expect(res.body.map((d: { id: string }) => d.id)).toEqual(
        expect.arrayContaining([driver.user.id, otherDriver.user.id]),
      );
      expect(res.body[0]).not.toHaveProperty('password');
    });
  });

  describe('rendición del repartidor', () => {
    it('resume lo entregado, los kilos y lo cobrado por método', async () => {
      const rendidor = await t.createUser(UserRole.REPARTO, {
        name: 'Rendidor',
      });
      const admin = await t.createUser(UserRole.ADMIN);
      const chinchulin = await t.createProduct({
        name: 'Chinchulín',
        stock: 100,
      });
      const molleja = await t.createProduct({ name: 'Molleja', stock: 100 });

      const note = async (items: Item[]) => {
        const customer = await t.createCustomer();
        return (
          await createNote(customer.id, items, {
            assignedToId: rendidor.user.id,
          })
        ).body.order.id as string;
      };

      const a = await note([{ productId: chinchulin.id, quantity: 5 }]);
      const b = await note([
        { productId: chinchulin.id, quantity: 2 },
        { productId: molleja.id, quantity: 1 },
      ]);
      await note([{ productId: molleja.id, quantity: 1 }]); // queda pendiente

      await deliver(
        a,
        [{ productId: chinchulin.id, quantity: 4.8 }],
        [
          { amount: 3000, method: 'cash' },
          { amount: 1800, method: 'transfer' },
        ],
        rendidor,
      ).expect(201);
      await deliver(
        b,
        [
          { productId: chinchulin.id, quantity: 2 },
          { productId: molleja.id, quantity: 1.5 },
        ],
        [{ amount: 1000, method: 'cash' }],
        rendidor,
      ).expect(201);

      const today = new Date(Date.now() - 3 * 3600_000)
        .toISOString()
        .slice(0, 10);
      const res = await t
        .http()
        .get(`/deliveries/settlement?userId=${rendidor.user.id}&date=${today}`)
        .set('authorization', admin.auth)
        .expect(200);

      expect(res.body).toMatchObject({
        driver: { id: rendidor.user.id, name: 'Rendidor' },
        date: today,
        deliveredCount: 2,
        stillPendingCount: 1,
        totalSold: 8300, // 4800 + 2000 + 1500
        totalCollected: 5800,
        totalOnCredit: 2500,
        collectedByMethod: { cash: 4000, transfer: 1800 },
      });
      expect(res.body.products).toEqual([
        expect.objectContaining({
          name: 'Chinchulín',
          requested: 7,
          delivered: 6.8,
          amount: 6800,
        }),
        expect.objectContaining({
          name: 'Molleja',
          requested: 1,
          delivered: 1.5,
          amount: 1500,
        }),
      ]);

      // El repartidor ve la suya (sin pasar userId), pero no la de otro.
      await t
        .http()
        .get(`/deliveries/settlement?date=${today}`)
        .set('authorization', rendidor.auth)
        .expect(200);
      await t
        .http()
        .get(`/deliveries/settlement?userId=${driver.user.id}`)
        .set('authorization', rendidor.auth)
        .expect(403);
    });
  });

  describe('ajustes manuales de inventario', () => {
    it('entrada, salida (hasta negativo) y ajuste a un valor', async () => {
      const admin = await t.createUser(UserRole.ADMIN);
      const product = await t.createProduct({ stock: 5 });
      const move = (type: string, quantity: number) =>
        t
          .http()
          .post('/inventory/movement')
          .set('authorization', admin.auth)
          .send({ productId: product.id, type, quantity, reason: 'test' })
          .expect(201);

      await move('entry', 2.5);
      expect(await t.stockOf(product.id)).toBe(7.5);
      await move('exit', 10);
      expect(await t.stockOf(product.id)).toBe(-2.5);
      await move('adjustment', 12);
      expect(await t.stockOf(product.id)).toBe(12);
    });
  });

  describe('WhatsApp', () => {
    it('prepara el pedido aunque no haya stock suficiente', async () => {
      const phone = '5491100001111';
      await t.createCustomer({ phone });
      await t.createProduct({ name: 'Chinchulin', stock: 2 });

      const res = await t
        .http()
        .post('/whatsapp/orders/prepare')
        .set('authorization', office.auth)
        .send({ phone, message: 'quiero 10 kg de chinchulin' })
        .expect(201);

      expect(res.body.order.status).toBe(WhatsAppOrderStatus.PENDING);
    });

    it('confirmar crea una sola nota de pedido (aunque se confirme 5 veces a la vez)', async () => {
      const customer = await t.createCustomer();
      const product = await t.createProduct({ stock: 10 });

      const repository = t.dataSource.getRepository(WhatsAppOrder);
      const whatsappOrder = await repository.save(
        repository.create({
          phone: '5491100002222',
          customerId: customer.id,
          productId: product.id,
          quantity: 2,
          unit: 'kg',
          unitPrice: 1000,
          subtotal: 2000,
        }),
      );

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          t
            .http()
            .post(`/whatsapp/orders/${whatsappOrder.id}/confirm`)
            .set('authorization', office.auth),
        ),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const orders = await t.dataSource
        .getRepository(Order)
        .findBy({ customerId: customer.id });
      expect(orders).toHaveLength(1);
      expect(orders[0].status).toBe('pending');
      // El stock se descuenta recién al entregar.
      expect(await t.stockOf(product.id)).toBe(10);
    });
  });
});
