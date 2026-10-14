import { Order, OrderStatus } from '../src/orders/entities/order.entity.js';
import { UserRole } from '../src/users/entities/user.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

describe('Pagos de clientes', () => {
  let t: TestApp;
  let auth: string;

  beforeAll(async () => {
    t = await createTestApp();
    auth = (await t.createUser(UserRole.ADMIN)).auth;
  });

  afterAll(() => t.close());

  // Pedido de $1000 (1 kg a $1000) ya entregado, sin cobrar.
  const createOrder = async () => {
    const customer = await t.createCustomer();
    const product = await t.createProduct({ salePrice: 1000 });
    const items = [{ productId: product.id, quantity: 1 }];

    const res = await t
      .http()
      .post('/orders')
      .set('authorization', auth)
      .send({ customerId: customer.id, items })
      .expect(201);

    await t
      .http()
      .post(`/orders/${res.body.order.id}/deliver`)
      .set('authorization', auth)
      .send({ items })
      .expect(201);

    return res.body.order.id as string;
  };

  const pay = (orderId: string, amount: number) =>
    t
      .http()
      .post('/payments')
      .set('authorization', auth)
      .send({ orderId, amount, method: 'cash' });

  it('pago parcial y luego total actualizan el estado del pedido', async () => {
    const orderId = await createOrder();

    const partial = await pay(orderId, 400).expect(201);
    expect(partial.body).toMatchObject({
      paymentStatus: 'partial',
      paidAmount: 400,
      pendingAmount: 600,
    });

    const rest = await pay(orderId, 600).expect(201);
    expect(rest.body).toMatchObject({
      paymentStatus: 'paid',
      paidAmount: 1000,
      pendingAmount: 0,
    });

    const summary = await t
      .http()
      .get(`/payments/order/${orderId}`)
      .set('authorization', auth)
      .expect(200);

    expect(summary.body.payments).toHaveLength(2);
    expect(summary.body.pendingAmount).toBe(0);
  });

  it('rechaza un pago mayor al saldo pendiente', async () => {
    const orderId = await createOrder();
    await pay(orderId, 700).expect(201);

    const res = await pay(orderId, 300.01).expect(400);
    expect(res.body.message).toContain('300.00');
  });

  it('rechaza pagos a pedidos cancelados', async () => {
    const orderId = await createOrder();
    await t.dataSource
      .getRepository(Order)
      .update(orderId, { status: OrderStatus.CANCELLED });

    await pay(orderId, 100).expect(400);
  });

  it('10 pagos simultáneos del total: se acepta uno solo', async () => {
    const orderId = await createOrder();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => pay(orderId, 1000)),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(9);

    const summary = await t
      .http()
      .get(`/payments/order/${orderId}`)
      .set('authorization', auth);

    expect(summary.body.paidAmount).toBe(1000);
  });
});
