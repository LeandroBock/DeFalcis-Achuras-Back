import { Order } from '../src/orders/entities/order.entity.js';
import { UserRole } from '../src/users/entities/user.entity.js';
import {
  WHATSAPP_CLIENT,
  WhatsAppConnectionStatus,
} from '../src/whatsapp/connection/whatsapp-client.js';

import { ReceiptSenderService } from '../src/whatsapp/receipt-sender.service.js';
import { FakeWhatsAppClient } from './support/fake-whatsapp-client.js';
import { TestApp, createTestApp } from './support/test-app.js';

type Fixture = Awaited<ReturnType<TestApp['createUser']>>;

describe('Listas de precios, rutas de reparto y recibo X', () => {
  let t: TestApp;
  let fake: FakeWhatsAppClient;
  let admin: Fixture;
  let ventas: Fixture;
  let driver: Fixture;

  beforeAll(async () => {
    fake = new FakeWhatsAppClient();
    t = await createTestApp({}, (builder) =>
      builder.overrideProvider(WHATSAPP_CLIENT).useValue(fake),
    );
    admin = await t.createUser(UserRole.ADMIN);
    ventas = await t.createUser(UserRole.VENTAS);
    driver = await t.createUser(UserRole.REPARTO);
  });

  afterAll(() => t.close());

  const createNote = async (
    customerId: string,
    items: { productId: string; quantity: number }[],
    extra: Record<string, unknown> = {},
  ) =>
    (
      await t
        .http()
        .post('/orders')
        .set('authorization', ventas.auth)
        .send({ customerId, items, ...extra })
        .expect(201)
    ).body;

  const createList = async (name: string, adjustmentPercent = 0) =>
    (
      await t
        .http()
        .post('/price-lists')
        .set('authorization', admin.auth)
        .send({ name, adjustmentPercent })
        .expect(201)
    ).body as { id: string };

  describe('listas de precios', () => {
    it('cobra el precio de la lista y después el descuento del cliente', async () => {
      const chinchulin = await t.createProduct({ salePrice: 1000 });
      const molleja = await t.createProduct({ salePrice: 2000 });
      const rinon = await t.createProduct({ salePrice: 500 });

      // Mayoristas: 10% menos, y la molleja a precio fijo 1500.
      const list = await createList('Mayoristas', -10);
      await t
        .http()
        .put(`/price-lists/${list.id}/items/${molleja.id}`)
        .set('authorization', admin.auth)
        .send({ price: 1500 })
        .expect(200);

      const customer = await t.createCustomer();
      const assigned = await t
        .http()
        .put(`/price-lists/${list.id}/customers`)
        .set('authorization', admin.auth)
        .send({ customerIds: [customer.id] })
        .expect(200);
      expect(assigned.body.customers).toEqual([
        { id: customer.id, name: customer.name },
      ]);

      // Además, 5% de descuento en la molleja.
      await t
        .http()
        .put(`/customers/${customer.id}/prices/${molleja.id}`)
        .set('authorization', admin.auth)
        .send({ discountPercent: 5 })
        .expect(200);

      const note = await createNote(customer.id, [
        { productId: chinchulin.id, quantity: 1 },
        { productId: molleja.id, quantity: 1 },
        { productId: rinon.id, quantity: 2 },
      ]);

      const priceOf = (productId: string) =>
        Number(
          note.items.find(
            (item: { productId: string }) => item.productId === productId,
          ).unitPrice,
        );

      expect(priceOf(chinchulin.id)).toBe(900); // lista -10%
      expect(priceOf(molleja.id)).toBe(1425); // 1500 de la lista - 5%
      expect(priceOf(rinon.id)).toBe(450);
      expect(Number(note.order.total)).toBe(900 + 1425 + 900);

      const pricing = await t
        .http()
        .get(`/customers/${customer.id}/pricing`)
        .set('authorization', ventas.auth)
        .expect(200);
      expect(pricing.body.priceList).toEqual({
        id: list.id,
        name: 'Mayoristas',
      });
      expect(pricing.body.prices[molleja.id]).toEqual({
        price: 1425,
        special: true,
      });
      expect(pricing.body.prices[chinchulin.id]).toEqual({
        price: 900,
        special: false,
      });

      const prices = await t
        .http()
        .get(`/customers/${customer.id}/prices`)
        .set('authorization', ventas.auth)
        .expect(200);
      expect(prices.body).toEqual([
        expect.objectContaining({
          productId: molleja.id,
          normalPrice: 2000,
          listPrice: 1500,
          discountPercent: 5,
          fixedPrice: null,
          price: 1425,
        }),
      ]);
    });

    it('al desactivar la lista sus clientes vuelven al precio normal', async () => {
      const product = await t.createProduct({ salePrice: 1000 });
      const list = await createList('Temporal', -20);
      const customer = await t.createCustomer({ priceListId: list.id });

      await t
        .http()
        .patch(`/price-lists/${list.id}/deactivate`)
        .set('authorization', admin.auth)
        .expect(200);

      const note = await createNote(customer.id, [
        { productId: product.id, quantity: 1 },
      ]);
      expect(Number(note.items[0].unitPrice)).toBe(1000);
    });

    it('ventas puede ver las listas pero no editarlas', async () => {
      await t
        .http()
        .get('/price-lists')
        .set('authorization', ventas.auth)
        .expect(200);
      await t
        .http()
        .post('/price-lists')
        .set('authorization', ventas.auth)
        .send({ name: 'No' })
        .expect(403);
    });
  });

  describe('asignación masiva y ruta', () => {
    it('asigna varias notas y el repartidor las ve en el orden de la ruta', async () => {
      const product = await t.createProduct();
      const routeDriver = await t.createUser(UserRole.REPARTO);
      const notes = [];
      for (let i = 0; i < 3; i++) {
        const customer = await t.createCustomer({ name: `Parada ${i}` });
        notes.push(
          await createNote(customer.id, [
            { productId: product.id, quantity: 1 },
          ]),
        );
      }
      const [a, b, c] = notes.map((note) => note.order.id as string);

      const assigned = await t
        .http()
        .post('/orders/assign')
        .set('authorization', ventas.auth)
        .send({ orderIds: [a, b, c], assignedToId: routeDriver.user.id })
        .expect(201);
      expect(assigned.body.assigned).toBe(3);

      // La oficina arma la ruta: c, a, b.
      await t
        .http()
        .put('/deliveries/route')
        .set('authorization', ventas.auth)
        .send({ driverId: routeDriver.user.id, orderIds: [c, a, b] })
        .expect(200);

      const mine = await t
        .http()
        .get('/deliveries/mine')
        .set('authorization', routeDriver.auth)
        .expect(200);
      expect(mine.body.map((note: { id: string }) => note.id)).toEqual([
        c,
        a,
        b,
      ]);
      expect(
        mine.body.map((n: { routeOrder: number }) => n.routeOrder),
      ).toEqual([1, 2, 3]);

      // Una nota nueva asignada (aunque sea para hoy) va al final de la ruta.
      const customer = await t.createCustomer({ name: 'Parada nueva' });
      const late = await createNote(
        customer.id,
        [{ productId: product.id, quantity: 1 }],
        { deliveryDate: new Date().toISOString().slice(0, 10) },
      );
      await t
        .http()
        .post(`/orders/${late.order.id}/assign`)
        .set('authorization', ventas.auth)
        .send({ assignedToId: routeDriver.user.id })
        .expect(201);

      const after = await t
        .http()
        .get('/deliveries/mine')
        .set('authorization', routeDriver.auth)
        .expect(200);
      expect(after.body.map((note: { id: string }) => note.id)).toEqual([
        c,
        a,
        b,
        late.order.id,
      ]);
    });

    it('no asigna si alguna nota ya fue entregada o anulada', async () => {
      const product = await t.createProduct();
      const customer = await t.createCustomer();
      const pending = await createNote(customer.id, [
        { productId: product.id, quantity: 1 },
      ]);
      const cancelled = await createNote(customer.id, [
        { productId: product.id, quantity: 1 },
      ]);
      await t
        .http()
        .post(`/orders/${cancelled.order.id}/cancel`)
        .set('authorization', ventas.auth)
        .expect(201);

      await t
        .http()
        .post('/orders/assign')
        .set('authorization', ventas.auth)
        .send({
          orderIds: [pending.order.id, cancelled.order.id],
          assignedToId: driver.user.id,
        })
        .expect(409);

      const untouched = await t.dataSource
        .getRepository(Order)
        .findOneByOrFail({ id: pending.order.id });
      expect(untouched.assignedToId).toBeNull();
    });

    it('no acepta en la ruta notas de otro repartidor', async () => {
      const product = await t.createProduct();
      const customer = await t.createCustomer();
      const other = await createNote(
        customer.id,
        [{ productId: product.id, quantity: 1 }],
        { assignedToId: driver.user.id },
      );
      const someone = await t.createUser(UserRole.REPARTO);

      await t
        .http()
        .put('/deliveries/route')
        .set('authorization', ventas.auth)
        .send({ driverId: someone.user.id, orderIds: [other.order.id] })
        .expect(400);
    });
  });

  describe('recibo X', () => {
    const waitForReceipt = (orderId: string) =>
      vi.waitFor(
        async () => {
          const order = await t.dataSource
            .getRepository(Order)
            .findOneByOrFail({ id: orderId });
          if (!order.receiptSentAt && !order.receiptError) {
            throw new Error('Todavía no se procesó el recibo');
          }
          return order;
        },
        { timeout: 5000, interval: 50 },
      );

    it('al confirmar la entrega se numera y se manda por WhatsApp al cliente', async () => {
      const product = await t.createProduct({ salePrice: 1000, stock: 10 });
      const customer = await t.createCustomer({
        name: 'Carnicería Don José',
        phone: '0341 155556789',
      });
      const note = await createNote(
        customer.id,
        [{ productId: product.id, quantity: 2 }],
        { assignedToId: driver.user.id },
      );

      const delivered = await t
        .http()
        .post(`/orders/${note.order.id}/deliver`)
        .set('authorization', driver.auth)
        .send({
          items: [{ productId: product.id, quantity: 2.5 }],
          payments: [{ amount: 2000, method: 'cash' }],
        })
        .expect(201);
      expect(delivered.body.order.receiptNumber).toEqual(expect.any(Number));

      const order = await waitForReceipt(note.order.id);
      expect(order.receiptError).toBeNull();

      const sent = fake.documents.at(-1)!;
      expect(sent.phone).toBe('5493415556789');
      expect(sent.mimetype).toBe('application/pdf');
      expect(sent.buffer.subarray(0, 4).toString()).toBe('%PDF');
      expect(sent.caption).toContain('Carnicería Don José');
      expect(sent.caption).toContain('Total $2.500');
      expect(sent.caption).toContain('Queda en cuenta corriente $500');

      // El repartidor que la entregó (y la oficina) pueden bajar el PDF.
      const pdf = await t
        .http()
        .get(`/orders/${note.order.id}/receipt`)
        .set('authorization', driver.auth)
        .expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');

      const otherDriver = await t.createUser(UserRole.REPARTO);
      await t
        .http()
        .get(`/orders/${note.order.id}/receipt`)
        .set('authorization', otherDriver.auth)
        .expect(403);
    });

    it('si WhatsApp está desconectado queda anotado y se puede reenviar', async () => {
      const product = await t.createProduct({ salePrice: 1000, stock: 10 });
      const customer = await t.createCustomer({ phone: '3415550000' });
      const note = await createNote(
        customer.id,
        [{ productId: product.id, quantity: 1 }],
        { assignedToId: driver.user.id },
      );

      fake.state = { status: WhatsAppConnectionStatus.DISCONNECTED };
      await t
        .http()
        .post(`/orders/${note.order.id}/deliver`)
        .set('authorization', driver.auth)
        .send({ items: [{ productId: product.id, quantity: 1 }] })
        .expect(201);

      const failed = await waitForReceipt(note.order.id);
      expect(failed.receiptSentAt).toBeNull();
      expect(failed.receiptError).toMatch(/WhatsApp no está conectado/);

      fake.state = {
        status: WhatsAppConnectionStatus.CONNECTED,
        phone: '5493410000000',
      };
      const resent = await t
        .http()
        .post(`/whatsapp/receipts/${note.order.id}`)
        .set('authorization', ventas.auth)
        .expect(201);
      expect(resent.body).toEqual({ sent: true, to: '5493415550000' });
    });

    it('si el PDF no se puede mandar, le llega el resumen en texto', async () => {
      const product = await t.createProduct({ salePrice: 1000, stock: 10 });
      const customer = await t.createCustomer({ phone: '341 15 5550123' });
      const note = await createNote(
        customer.id,
        [{ productId: product.id, quantity: 1 }],
        { assignedToId: driver.user.id },
      );

      fake.failDocuments = true;
      const texts = fake.sent.length;
      await t
        .http()
        .post(`/orders/${note.order.id}/deliver`)
        .set('authorization', driver.auth)
        .send({ items: [{ productId: product.id, quantity: 1 }] })
        .expect(201);

      const order = await waitForReceipt(note.order.id);
      fake.failDocuments = false;

      expect(order.receiptSentAt).not.toBeNull();
      expect(order.receiptError).toMatch(/resumen en texto/);
      const text = fake.sent.at(-1)!;
      expect(fake.sent.length).toBe(texts + 1);
      // 341 15 5550123 (con 15 y sin 0) va al celular correcto.
      expect(text.phone).toBe('5493415550123');
      expect(text.text).toContain('Total $1.000');
    });

    it('si WhatsApp estaba desconectado, lo reintenta solo', async () => {
      const sender = t.app.get(ReceiptSenderService);
      sender.retryDelaysMs = [100];

      const product = await t.createProduct({ salePrice: 1000, stock: 10 });
      const customer = await t.createCustomer({ phone: '3415550456' });
      const note = await createNote(
        customer.id,
        [{ productId: product.id, quantity: 1 }],
        { assignedToId: driver.user.id },
      );

      fake.state = { status: WhatsAppConnectionStatus.DISCONNECTED };
      await t
        .http()
        .post(`/orders/${note.order.id}/deliver`)
        .set('authorization', driver.auth)
        .send({ items: [{ productId: product.id, quantity: 1 }] })
        .expect(201);
      await waitForReceipt(note.order.id);
      fake.state = {
        status: WhatsAppConnectionStatus.CONNECTED,
        phone: '5493410000000',
      };

      await vi.waitFor(
        async () => {
          const order = await t.dataSource
            .getRepository(Order)
            .findOneByOrFail({ id: note.order.id });
          expect(order.receiptSentAt).not.toBeNull();
          expect(order.receiptError).toBeNull();
        },
        { timeout: 5000, interval: 50 },
      );
      expect(fake.documents.at(-1)!.phone).toBe('5493415550456');
    });

    it('no hay recibo de una nota sin entregar', async () => {
      const product = await t.createProduct();
      const customer = await t.createCustomer();
      const note = await createNote(customer.id, [
        { productId: product.id, quantity: 1 },
      ]);

      await t
        .http()
        .get(`/orders/${note.order.id}/receipt`)
        .set('authorization', ventas.auth)
        .expect(409);
    });
  });
});
