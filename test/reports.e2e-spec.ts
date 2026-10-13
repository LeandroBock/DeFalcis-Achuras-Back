import ExcelJS from 'exceljs';

import { Order, OrderStatus } from '../src/orders/entities/order.entity.js';
import { Payment } from '../src/payments/entities/payments.entity.js';
import { UserRole } from '../src/users/entities/user.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

// Datos armados a mano para conocer el resultado exacto de cada reporte:
//
// Ventas  · Pedido 1: 2 kg × $1000 = $2000, cobrado $500  → debe $1500
//         · Pedido 2: 1 kg × $1000 = $1000, cobrado $1000 (enero 2025)
//         · Pedido 3: $1000 cancelado → no cuenta
// Compras · A: crédito 10 kg × $500 = $5000, pagado $2000 → debemos $3000
//         · B: contado 4 kg = $2000 (pagada)
//         · C: contado 2 kg = $1000, anulada → no cuenta
// Gastos  · $300
describe('Reportes', () => {
  let t: TestApp;
  let auth: string;
  let supplierId: string;
  let order1: string;
  let order2: string;

  const get = (path: string) =>
    t.http().get(path).set('authorization', auth).expect(200);

  beforeAll(async () => {
    t = await createTestApp();
    auth = (await t.createUser(UserRole.FINANZAS)).auth;
    const admin = (await t.createUser(UserRole.ADMIN)).auth;
    const post = (path: string, body: object) =>
      t.http().post(path).set('authorization', admin).send(body).expect(201);

    const customer = await t.createCustomer({ name: 'Carnicería Test' });
    const sold = await t.createProduct({ salePrice: 1000, stock: 0 });
    const bought = await t.createProduct({ stock: 0 });
    await t.createProduct({ stock: 3 }); // stock bajo
    await t.createProduct({ stock: 0, isActive: false }); // no cuenta

    const order = async (kg: number) =>
      (
        await post('/orders', {
          customerId: customer.id,
          items: [{ productId: sold.id, quantity: kg }],
        })
      ).body.order.id as string;

    order1 = await order(2);
    order2 = await order(1);
    const order3 = await order(1);

    await post('/payments', { orderId: order1, amount: 500, method: 'cash' });
    await post('/payments', { orderId: order2, amount: 1000, method: 'cash' });
    await t.dataSource
      .getRepository(Order)
      .update(order3, { status: OrderStatus.CANCELLED });

    // El pedido 2 y su pago quedan en enero de 2025 para probar el filtro.
    const january = new Date('2025-01-15T12:00:00');
    await t.dataSource
      .getRepository(Order)
      .update(order2, { createdAt: january });
    await t.dataSource
      .getRepository(Payment)
      .update({ orderId: order2 }, { createdAt: january });

    supplierId = (await t.createSupplier({ name: 'Frigorífico Test' })).id;
    const purchase = async (kg: number, paymentMethod: string) =>
      (
        await post('/purchases', {
          supplierId,
          paymentMethod,
          items: [{ productId: bought.id, quantity: kg, unitCost: 500 }],
        })
      ).body.purchase.id as string;

    const purchaseA = await purchase(10, 'credit');
    await purchase(4, 'cash');
    const purchaseC = await purchase(2, 'cash');
    await post('/supplier-payments', {
      purchaseId: purchaseA,
      amount: 2000,
      method: 'transfer',
    });
    await t
      .http()
      .delete(`/purchases/${purchaseC}`)
      .set('authorization', admin)
      .expect(200);

    await post('/expenses', {
      category: 'fuel',
      description: 'Nafta',
      amount: 300,
      paymentMethod: 'cash',
    });
  });

  afterAll(() => t.close());

  it('dashboard', async () => {
    const { body } = await get('/reports/dashboard');

    expect(body).toEqual({
      financial: {
        totalSales: 3000,
        totalCollected: 1500,
        totalPurchases: 7000, // sin la compra anulada
        totalExpenses: 300,
        estimatedResult: -5800,
      },
      inventory: {
        totalProducts: 3,
        productsWithoutStock: 1, // el vendido quedó en -4
        productsWithLowStock: 1,
      },
      receivables: { pending: 1500 },
      payables: { pending: 3000 },
    });
  });

  it('resumen financiero con filtro de fechas', async () => {
    const { body } = await get(
      '/reports/financial-summary?from=2025-01-01&to=2025-01-31',
    );

    expect(body).toEqual({
      from: '2025-01-01',
      to: '2025-01-31',
      totalSales: 1000,
      totalCollected: 1000,
      totalPurchases: 0,
      totalExpenses: 0,
      estimatedResult: 1000,
    });
  });

  it('cuentas por cobrar', async () => {
    const { body } = await get('/reports/receivables');

    expect(body).toEqual([
      expect.objectContaining({
        orderId: order1,
        customerName: 'Carnicería Test',
        total: 2000,
        paid: 500,
        pending: 1500,
        paymentStatus: 'partial',
      }),
    ]);
  });

  it('cuentas por pagar', async () => {
    const { body } = await get('/reports/payables');

    expect(body).toEqual([
      expect.objectContaining({
        supplierId,
        supplierName: 'Frigorífico Test',
        total: 5000,
        paid: 2000,
        pending: 3000,
        paymentStatus: 'partial',
      }),
    ]);
  });

  it('exporta el Excel con todas las hojas y el resumen correcto', async () => {
    const res = await t
      .http()
      .get('/reports/export')
      .set('authorization', auth)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Resumen',
      'Por cobrar',
      'Por pagar',
      'Inventario',
      'Ventas',
      'Compras',
      'Gastos',
    ]);

    const resumen = workbook.getWorksheet('Resumen')!;
    expect(resumen.getCell('B3').value).toBe(3000); // ventas
    expect(resumen.getCell('B4').value).toBe(1500); // cobrado
    expect(resumen.getCell('B5').value).toBe(7000); // compras
    expect(resumen.getCell('B6').value).toBe(300); // gastos

    // 2 pedidos vendidos (el cancelado no) y 2 compras (la anulada no),
    // más la fila de encabezado y la de totales.
    expect(workbook.getWorksheet('Ventas')!.rowCount).toBe(4);
    expect(workbook.getWorksheet('Compras')!.rowCount).toBe(4);
  });

  it('solo finanzas y administradores ven los reportes', async () => {
    const ventas = await t.createUser(UserRole.VENTAS);

    await t
      .http()
      .get('/reports/dashboard')
      .set('authorization', ventas.auth)
      .expect(403);
  });
});
