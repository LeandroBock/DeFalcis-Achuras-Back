import { Order } from '../src/orders/entities/order.entity.js';
import { Payment } from '../src/payments/entities/payments.entity.js';
import { UserRole } from '../src/users/entities/user.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

type Fixture = Awaited<ReturnType<TestApp['createUser']>>;
type PaymentInput = { amount: number; method: string };

describe('Cuenta corriente', () => {
  let t: TestApp;
  let office: Fixture;
  let finance: Fixture;
  let driver: Fixture;

  beforeAll(async () => {
    t = await createTestApp();
    office = await t.createUser(UserRole.VENTAS);
    finance = await t.createUser(UserRole.FINANZAS);
    driver = await t.createUser(UserRole.REPARTO);
  });

  afterAll(() => t.close());

  // Nota de 1 kg a $1000 entregada al cliente, con lo cobrado.
  const deliveredSale = async (
    customerId: string,
    payments: PaymentInput[] = [],
    expected = 201,
  ) => {
    const product = await t.createProduct({ salePrice: 1000, stock: 100 });
    const note = await t
      .http()
      .post('/orders')
      .set('authorization', office.auth)
      .send({
        customerId,
        items: [{ productId: product.id, quantity: 1 }],
        assignedToId: driver.user.id,
      })
      .expect(201);

    return t
      .http()
      .post(`/orders/${note.body.order.id}/deliver`)
      .set('authorization', driver.auth)
      .send({ items: [{ productId: product.id, quantity: 1 }], payments })
      .expect(expected);
  };

  const account = (customerId: string) =>
    t
      .http()
      .get(`/current-accounts/${customerId}`)
      .set('authorization', office.auth)
      .expect(200);

  const paymentsOf = (orderId: string) =>
    t.dataSource.getRepository(Payment).findBy({ orderId });

  it('lo que no se cobra queda como deuda del cliente', async () => {
    const customer = await t.createCustomer({ name: 'Carnicería Deuda' });

    await deliveredSale(customer.id, [{ amount: 300, method: 'cash' }]);
    await deliveredSale(customer.id);

    const detail = (await account(customer.id)).body;
    expect(detail.debt).toBe(1700);
    expect(detail.orders.map((o: { pending: number }) => o.pending)).toEqual([
      700, 1000,
    ]);

    const list = await t
      .http()
      .get('/current-accounts')
      .set('authorization', finance.auth)
      .expect(200);
    expect(
      list.body.customers.find(
        (c: { customerId: string }) => c.customerId === customer.id,
      ),
    ).toMatchObject({ name: 'Carnicería Deuda', debt: 1700, openOrders: 2 });
  });

  it('"Cuenta corriente" en la entrega no registra cobro', async () => {
    const customer = await t.createCustomer();

    const res = await deliveredSale(customer.id, [
      { amount: 400, method: 'cash' },
      { amount: 600, method: 'current_account' },
    ]);

    const payments = await paymentsOf(res.body.order.id);
    expect(payments).toHaveLength(1);
    expect(Number(payments[0].amount)).toBe(400);
    expect(res.body.order.paymentStatus).toBe('partial');
    expect((await account(customer.id)).body.debt).toBe(600);
  });

  it('el repartidor ve la deuda anterior en la nota nueva', async () => {
    const customer = await t.createCustomer();
    await deliveredSale(customer.id, [{ amount: 250, method: 'cash' }]);

    const product = await t.createProduct();
    await t
      .http()
      .post('/orders')
      .set('authorization', office.auth)
      .send({
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1 }],
        assignedToId: driver.user.id,
      })
      .expect(201);

    const pending = await t
      .http()
      .get('/deliveries/mine')
      .set('authorization', driver.auth)
      .expect(200);
    const note = pending.body.find(
      (n: { customer: { id: string } }) => n.customer.id === customer.id,
    );
    expect(note.customer.pendingBalance).toBe(750);
  });

  it('lo cobrado de más en la entrega paga la deuda más vieja primero', async () => {
    const customer = await t.createCustomer();
    const first = await deliveredSale(customer.id);
    const second = await deliveredSale(customer.id, [
      { amount: 500, method: 'cash' },
    ]);

    // Nota de $1000 + deuda de $1500: cobra $2200 (efectivo y transferencia).
    const third = await deliveredSale(customer.id, [
      { amount: 1500, method: 'cash' },
      { amount: 700, method: 'transfer' },
    ]);

    expect(third.body.order.paymentStatus).toBe('paid');
    expect(third.body.debtCollected).toBe(1200);

    const firstPayments = await paymentsOf(first.body.order.id);
    expect(firstPayments.map((p) => [Number(p.amount), p.method])).toEqual([
      [500, 'cash'],
      [500, 'transfer'],
    ]);
    expect(firstPayments[0].collectedById).toBe(driver.user.id);

    const secondPayments = await paymentsOf(second.body.order.id);
    expect(
      secondPayments.map((p) => Number(p.amount)).sort((a, b) => a - b),
    ).toEqual([200, 500]);

    const orders = t.dataSource.getRepository(Order);
    expect(
      (await orders.findOneByOrFail({ id: first.body.order.id })).paymentStatus,
    ).toBe('paid');
    expect(
      (await orders.findOneByOrFail({ id: second.body.order.id }))
        .paymentStatus,
    ).toBe('partial');
    expect((await account(customer.id)).body.debt).toBe(300);
  });

  it('la rendición separa la deuda cobrada', async () => {
    const otherDriver = await t.createUser(UserRole.REPARTO);
    const customer = await t.createCustomer();
    await deliveredSale(customer.id);

    const product = await t.createProduct({ salePrice: 1000, stock: 10 });
    const note = await t
      .http()
      .post('/orders')
      .set('authorization', office.auth)
      .send({
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1 }],
        assignedToId: otherDriver.user.id,
      })
      .expect(201);
    await t
      .http()
      .post(`/orders/${note.body.order.id}/deliver`)
      .set('authorization', otherDriver.auth)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        payments: [{ amount: 1600, method: 'cash' }],
      })
      .expect(201);

    const today = new Date(Date.now() - 3 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const settlement = await t
      .http()
      .get(`/deliveries/settlement?userId=${otherDriver.user.id}&date=${today}`)
      .set('authorization', finance.auth)
      .expect(200);

    expect(settlement.body).toMatchObject({
      totalSold: 1000,
      totalCollected: 1600,
      debtCollected: 600,
      totalOnCredit: 0,
      collectedByMethod: { cash: 1600 },
    });
  });

  it('no se puede cobrar más que la entrega más la deuda', async () => {
    const customer = await t.createCustomer();
    await deliveredSale(customer.id);

    const res = await deliveredSale(
      customer.id,
      [{ amount: 2000.01, method: 'cash' }],
      400,
    );
    expect(res.body.message).toContain('supera el total');
    expect((await account(customer.id)).body.debt).toBe(1000);
  });

  it('el pago desde la oficina se aplica a las notas más viejas', async () => {
    const customer = await t.createCustomer();
    const first = await deliveredSale(customer.id);
    const second = await deliveredSale(customer.id);

    await t
      .http()
      .post(`/current-accounts/${customer.id}/payments`)
      .set('authorization', finance.auth)
      .send({ amount: 2500, method: 'transfer' })
      .expect(400);

    const res = await t
      .http()
      .post(`/current-accounts/${customer.id}/payments`)
      .set('authorization', finance.auth)
      .send({ amount: 1200, method: 'transfer', notes: 'Pagó el viernes' })
      .expect(201);

    expect(res.body).toMatchObject({ paid: 1200, remainingDebt: 800 });

    const [firstPayment] = await paymentsOf(first.body.order.id);
    expect(Number(firstPayment.amount)).toBe(1000);
    expect(firstPayment.notes).toBe(
      'Pago de cuenta corriente: Pagó el viernes',
    );
    expect(firstPayment.collectedById).toBe(finance.user.id);
    expect(
      (await paymentsOf(second.body.order.id)).map((p) => Number(p.amount)),
    ).toEqual([200]);
  });

  it('Mercado Pago ya no se acepta como forma de cobro', async () => {
    const customer = await t.createCustomer();
    const sale = await deliveredSale(customer.id);

    await t
      .http()
      .post('/payments')
      .set('authorization', finance.auth)
      .send({
        orderId: sale.body.order.id,
        amount: 100,
        method: 'mercado_pago',
      })
      .expect(400);

    await t
      .http()
      .post(`/current-accounts/${customer.id}/payments`)
      .set('authorization', finance.auth)
      .send({ amount: 100, method: 'current_account' })
      .expect(400);
  });

  it('el repartidor no ve las cuentas corrientes', async () => {
    await t
      .http()
      .get('/current-accounts')
      .set('authorization', driver.auth)
      .expect(403);
  });
});
