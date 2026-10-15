import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';

import { filter, firstValueFrom } from 'rxjs';

import { UserRole } from '../src/users/entities/user.entity.js';
import {
  OrderEvent,
  RealtimeService,
} from '../src/realtime/realtime.service.js';
import {
  WHATSAPP_CLIENT,
  WhatsAppConnectionStatus,
} from '../src/whatsapp/connection/whatsapp-client.js';

import { FakeWhatsAppClient } from './support/fake-whatsapp-client.js';
import { TestApp, createTestApp } from './support/test-app.js';

type Fixture = Awaited<ReturnType<TestApp['createUser']>>;

describe('Avisos en tiempo real de las entregas', () => {
  let t: TestApp;
  let realtime: RealtimeService;
  let whatsapp: FakeWhatsAppClient;
  let office: Fixture;
  let driver: Fixture;

  beforeAll(async () => {
    whatsapp = new FakeWhatsAppClient();
    t = await createTestApp(
      { DELIVERY_NOTIFY_PHONES: '3415550000, 3415551111' },
      (builder) => builder.overrideProvider(WHATSAPP_CLIENT).useValue(whatsapp),
    );
    realtime = t.app.get(RealtimeService);
    office = await t.createUser(UserRole.VENTAS);
    driver = await t.createUser(UserRole.REPARTO, { name: 'Repartidor Uno' });
  });

  afterAll(() => t.close());

  beforeEach(() => {
    whatsapp.state = {
      status: WhatsAppConnectionStatus.CONNECTED,
      phone: '5493410000000',
    };
  });

  const nextEvent = (type: OrderEvent['type']) =>
    firstValueFrom(realtime.orders().pipe(filter((e) => e.type === type)));

  const note = async (deliveryDate?: string) => {
    const customer = await t.createCustomer({ name: 'Carnicería Centro' });
    const product = await t.createProduct({ salePrice: 1000, stock: 50 });
    const res = await t
      .http()
      .post('/orders')
      .set('authorization', office.auth)
      .send({
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 5 }],
        assignedToId: driver.user.id,
        deliveryDate,
      })
      .expect(201);

    return { orderId: res.body.order.id as string, productId: product.id };
  };

  const deliver = (orderId: string, productId: string, kg = 4.8) =>
    t
      .http()
      .post(`/orders/${orderId}/deliver`)
      .set('authorization', driver.auth)
      .send({
        items: [{ productId, quantity: kg }],
        payments: [
          { amount: 3000, method: 'cash' },
          { amount: 1000, method: 'transfer' },
        ],
      });

  it('crear una nota avisa a la oficina', async () => {
    const event = nextEvent('order.created');

    const { orderId } = await note();

    expect((await event).data).toMatchObject({
      orderId,
      customerName: 'Carnicería Centro',
      driverName: 'Repartidor Uno',
      total: 5000,
    });
  });

  it('cuando el repartidor entrega, la oficina recibe el resumen al instante', async () => {
    const { orderId, productId } = await note();
    const event = nextEvent('order.delivered');

    await deliver(orderId, productId).expect(201);

    expect((await event).data).toEqual({
      orderId,
      customerName: 'Carnicería Centro',
      driverName: 'Repartidor Uno',
      total: 4800,
      collected: 4000,
      pending: 800,
      debtCollected: 0,
      collectedByMethod: { cash: 3000, transfer: 1000 },
    });
  });

  it('y le llega un WhatsApp a cada número configurado', async () => {
    const { orderId, productId } = await note();
    const before = whatsapp.sent.length;

    await deliver(orderId, productId).expect(201);

    await expect.poll(() => whatsapp.sent.length).toBe(before + 2);
    const sent = whatsapp.sent.slice(before);

    expect(sent.map((m) => m.phone)).toEqual([
      '5493415550000',
      '5493415551111',
    ]);
    expect(sent[0].text).toBe(
      '✅ Entregado: Carnicería Centro (Repartidor Uno)\n' +
        'Total $4.800 · Cobrado $4.000 (Efectivo $3.000, Transferencia $1.000)\n' +
        'Queda en cuenta corriente $800',
    );
  });

  it('si no se entregó, avisa con el motivo', async () => {
    const { orderId } = await note();
    const event = nextEvent('order.not_delivered');
    const before = whatsapp.sent.length;

    await t
      .http()
      .post(`/orders/${orderId}/not-delivered`)
      .set('authorization', driver.auth)
      .send({ reason: 'No había nadie' })
      .expect(201);

    expect((await event).data).toMatchObject({
      orderId,
      driverName: 'Repartidor Uno',
      reason: 'No había nadie',
    });
    await expect.poll(() => whatsapp.sent.length).toBe(before + 2);
    expect(whatsapp.sent.at(-1)?.text).toBe(
      '❌ No entregado: Carnicería Centro (Repartidor Uno)\nMotivo: No había nadie',
    );
  });

  it('con WhatsApp desconectado la entrega se registra igual', async () => {
    whatsapp.state = { status: WhatsAppConnectionStatus.DISCONNECTED };
    const { orderId, productId } = await note();
    const before = whatsapp.sent.length;

    await deliver(orderId, productId).expect(201);

    expect(whatsapp.sent.length).toBe(before);
    expect(await t.stockOf(productId)).toBe(45.2);
  });

  it('el tablero del día muestra cada nota con su estado', async () => {
    const date = '2030-01-15';
    const delivered = await note(date);
    const pending = await note(date);
    const failed = await note(date);
    await note('2030-01-16'); // otro día: no aparece

    await deliver(delivered.orderId, delivered.productId).expect(201);
    await t
      .http()
      .post(`/orders/${failed.orderId}/not-delivered`)
      .set('authorization', driver.auth)
      .send({ reason: 'Cerrado' })
      .expect(201);

    // La nota entregada hoy cuenta en el tablero de hoy, no en el del 15.
    const res = await t
      .http()
      .get(`/deliveries/board?date=${date}`)
      .set('authorization', office.auth)
      .expect(200);

    const statusOf = (id: string) =>
      res.body.notes.find((n: { id: string }) => n.id === id)?.boardStatus;

    expect(statusOf(pending.orderId)).toBe('pending');
    expect(statusOf(failed.orderId)).toBe('not_delivered');
    expect(statusOf(delivered.orderId)).toBeUndefined();
    expect(res.body.summary).toMatchObject({
      total: 2,
      pending: 1,
      notDelivered: 1,
    });

    const today = await t
      .http()
      .get('/deliveries/board')
      .set('authorization', office.auth)
      .expect(200);
    const deliveredNote = today.body.notes.find(
      (n: { id: string }) => n.id === delivered.orderId,
    );
    expect(deliveredNote).toMatchObject({
      boardStatus: 'delivered',
      driverName: 'Repartidor Uno',
      total: 4800,
      collected: 4000,
      customer: { name: 'Carnicería Centro' },
    });
  });

  describe('canal de eventos (SSE)', () => {
    const open = (path: string) =>
      new Promise<{ status: number; type?: string }>((resolve, reject) => {
        const { port } = t.app.getHttpServer().address() as AddressInfo;
        const req = httpRequest({ port, path }, (res) => {
          resolve({
            status: res.statusCode!,
            type: res.headers['content-type'],
          });
          req.destroy();
        });
        req.on('error', (error) =>
          (error as NodeJS.ErrnoException).code === 'ECONNRESET'
            ? undefined
            : reject(error),
        );
        req.end();
      });

    const token = (fixture: Fixture) => fixture.auth.replace('Bearer ', '');

    it('sin token devuelve 401', async () => {
      expect((await open('/events')).status).toBe(401);
    });

    it('la oficina lo abre con ?access_token=', async () => {
      const res = await open(`/events?access_token=${token(office)}`);

      expect(res.status).toBe(200);
      expect(res.type).toContain('text/event-stream');
    });

    it('el repartidor no recibe los avisos de la oficina', async () => {
      expect((await open(`/events?access_token=${token(driver)}`)).status).toBe(
        403,
      );
    });
  });
});
