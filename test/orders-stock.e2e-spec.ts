import { InventoryMovement } from '../src/inventory/entities/inventory-movement.entity.js';
import { Order } from '../src/orders/entities/order.entity.js';
import { UserRole } from '../src/users/entities/user.entity.js';
import {
  WhatsAppOrder,
  WhatsAppOrderStatus,
} from '../src/whatsapp/entities/whatsapp-order.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

describe('Pedidos y stock', () => {
  let t: TestApp;
  let auth: string;

  beforeAll(async () => {
    t = await createTestApp();
    auth = (await t.createUser(UserRole.ADMIN)).auth;
  });

  afterAll(() => t.close());

  const createOrder = (customerId: string, items: object[]) =>
    t
      .http()
      .post('/orders')
      .set('authorization', auth)
      .send({ customerId, items });

  it('crea el pedido con el precio actual y descuenta el stock', async () => {
    const customer = await t.createCustomer();
    const chinchulin = await t.createProduct({ salePrice: 1000, stock: 50 });
    const molleja = await t.createProduct({ salePrice: 2500.5, stock: 20 });

    const res = await createOrder(customer.id, [
      { productId: chinchulin.id, quantity: 2.5 },
      { productId: molleja.id, quantity: 1 },
    ]).expect(201);

    expect(Number(res.body.order.total)).toBe(5000.5);
    expect(res.body.items).toHaveLength(2);
    expect(await t.stockOf(chinchulin.id)).toBe(47.5);
    expect(await t.stockOf(molleja.id)).toBe(19);
  });

  it('permite vender aunque el stock quede negativo (diferencias de peso)', async () => {
    const customer = await t.createCustomer();
    const product = await t.createProduct({ stock: 3 });

    await createOrder(customer.id, [
      { productId: product.id, quantity: 10 },
    ]).expect(201);

    expect(await t.stockOf(product.id)).toBe(-7);
  });

  it('acepta el mismo producto repetido en el pedido', async () => {
    const customer = await t.createCustomer();
    const product = await t.createProduct({ stock: 10 });

    await createOrder(customer.id, [
      { productId: product.id, quantity: 1 },
      { productId: product.id, quantity: 2 },
    ]).expect(201);

    expect(await t.stockOf(product.id)).toBe(7);
  });

  it('registra un movimiento de inventario por cada ítem', async () => {
    const customer = await t.createCustomer();
    const product = await t.createProduct({ stock: 10 });

    const res = await createOrder(customer.id, [
      { productId: product.id, quantity: 4 },
    ]).expect(201);

    const movements = await t.dataSource
      .getRepository(InventoryMovement)
      .findBy({ referenceId: res.body.order.id });

    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      productId: product.id,
      type: 'exit',
      reason: 'Salida por venta',
    });
    expect(Number(movements[0].quantity)).toBe(4);
  });

  it('rechaza productos inactivos sin tocar el stock de los demás', async () => {
    const customer = await t.createCustomer();
    const active = await t.createProduct({ stock: 10 });
    const inactive = await t.createProduct({ isActive: false });

    const res = await createOrder(customer.id, [
      { productId: active.id, quantity: 1 },
      { productId: inactive.id, quantity: 1 },
    ]).expect(404);

    expect(res.body.message).toContain(inactive.id);
    expect(await t.stockOf(active.id)).toBe(10);
  });

  it('rechaza clientes inactivos', async () => {
    const customer = await t.createCustomer({ isActive: false });
    const product = await t.createProduct();

    await createOrder(customer.id, [
      { productId: product.id, quantity: 1 },
    ]).expect(404);
  });

  it('20 pedidos simultáneos descuentan exactamente 20 (sin pisarse)', async () => {
    const customer = await t.createCustomer();
    const product = await t.createProduct({ stock: 100 });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        createOrder(customer.id, [{ productId: product.id, quantity: 1 }]),
      ),
    );

    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    expect(await t.stockOf(product.id)).toBe(80);
  });

  it('pedidos simultáneos con productos en distinto orden no se bloquean entre sí', async () => {
    const customer = await t.createCustomer();
    const a = await t.createProduct({ stock: 100 });
    const b = await t.createProduct({ stock: 100 });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createOrder(
          customer.id,
          i % 2
            ? [
                { productId: a.id, quantity: 1 },
                { productId: b.id, quantity: 1 },
              ]
            : [
                { productId: b.id, quantity: 1 },
                { productId: a.id, quantity: 1 },
              ],
        ),
      ),
    );

    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await t.stockOf(a.id)).toBe(90);
    expect(await t.stockOf(b.id)).toBe(90);
  });

  describe('ajustes manuales de inventario', () => {
    const move = (productId: string, type: string, quantity: number) =>
      t
        .http()
        .post('/inventory/movement')
        .set('authorization', auth)
        .send({ productId, type, quantity, reason: 'test' });

    it('entrada, salida (hasta negativo) y ajuste a un valor', async () => {
      const product = await t.createProduct({ stock: 5 });

      await move(product.id, 'entry', 2.5).expect(201);
      expect(await t.stockOf(product.id)).toBe(7.5);

      await move(product.id, 'exit', 10).expect(201);
      expect(await t.stockOf(product.id)).toBe(-2.5);

      await move(product.id, 'adjustment', 12).expect(201);
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
        .set('authorization', auth)
        .send({ phone, message: 'quiero 10 kg de chinchulin' })
        .expect(201);

      expect(res.body.order).toBeDefined();
      expect(res.body.order.status).toBe(WhatsAppOrderStatus.PENDING);
    });

    it('5 confirmaciones simultáneas del mismo pedido crean un solo pedido', async () => {
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
            .set('authorization', auth),
        ),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 400)).toHaveLength(4);
      expect(
        await t.dataSource
          .getRepository(Order)
          .countBy({ customerId: customer.id }),
      ).toBe(1);
      expect(await t.stockOf(product.id)).toBe(8);
    });
  });
});
