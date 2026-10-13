import { UserRole } from '../src/users/entities/user.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

describe('Compras, pagos a proveedores y saldo a favor', () => {
  let t: TestApp;
  let auth: string;

  beforeAll(async () => {
    t = await createTestApp();
    auth = (await t.createUser(UserRole.ADMIN)).auth;
  });

  afterAll(() => t.close());

  // Cada kilo cuesta $500.
  const items = (productId: string, kg: number) => [
    { productId, quantity: kg, unitCost: 500 },
  ];

  const setup = async (stock = 0) => ({
    supplier: await t.createSupplier(),
    product: await t.createProduct({ stock }),
  });

  const createPurchase = async (
    supplierId: string,
    productId: string,
    kg: number,
    paymentMethod = 'credit',
  ) => {
    const res = await t
      .http()
      .post('/purchases')
      .set('authorization', auth)
      .send({ supplierId, paymentMethod, items: items(productId, kg) })
      .expect(201);

    return res.body.purchase as { id: string; paymentStatus: string };
  };

  const editPurchase = (id: string, productId: string, kg: number) =>
    t
      .http()
      .patch(`/purchases/${id}`)
      .set('authorization', auth)
      .send({ items: items(productId, kg) });

  const cancelPurchase = (id: string) =>
    t.http().delete(`/purchases/${id}`).set('authorization', auth);

  const paySupplier = (purchaseId: string, amount: number, method = 'cash') =>
    t
      .http()
      .post('/supplier-payments')
      .set('authorization', auth)
      .send({ purchaseId, amount, method });

  const paymentsOf = async (purchaseId: string) =>
    (
      await t
        .http()
        .get(`/supplier-payments/purchase/${purchaseId}`)
        .set('authorization', auth)
        .expect(200)
    ).body;

  const creditOf = async (supplierId: string) =>
    (
      await t
        .http()
        .get(`/supplier-payments/supplier/${supplierId}/credit`)
        .set('authorization', auth)
        .expect(200)
    ).body.balance as number;

  describe('alta', () => {
    it('suma el stock comprado', async () => {
      const { supplier, product } = await setup(5);

      await createPurchase(supplier.id, product.id, 10);

      expect(await t.stockOf(product.id)).toBe(15);
    });

    it('una compra de contado queda pagada con su pago registrado', async () => {
      const { supplier, product } = await setup();

      const purchase = await createPurchase(supplier.id, product.id, 4, 'cash');

      expect(purchase.paymentStatus).toBe('paid');
      expect(await paymentsOf(purchase.id)).toMatchObject({
        total: 2000,
        paidAmount: 2000,
        pendingAmount: 0,
      });
    });

    it('una compra a crédito queda pendiente', async () => {
      const { supplier, product } = await setup();

      const purchase = await createPurchase(supplier.id, product.id, 4);

      expect(purchase.paymentStatus).toBe('pending');
      expect((await paymentsOf(purchase.id)).pendingAmount).toBe(2000);
    });
  });

  describe('edición', () => {
    it('ajusta el stock solo por la diferencia de kilos', async () => {
      const { supplier, product } = await setup();
      const purchase = await createPurchase(supplier.id, product.id, 10);

      await editPurchase(purchase.id, product.id, 8).expect(200);

      expect(await t.stockOf(product.id)).toBe(8);
    });

    it('a la baja con la compra pagada: queda pagada y el excedente va a saldo a favor', async () => {
      const { supplier, product } = await setup();
      const purchase = await createPurchase(
        supplier.id,
        product.id,
        10,
        'cash',
      );

      const res = await editPurchase(purchase.id, product.id, 8).expect(200);

      expect(res.body.purchase.paymentStatus).toBe('paid');
      expect(await creditOf(supplier.id)).toBe(1000);
      expect((await paymentsOf(purchase.id)).paidAmount).toBe(4000);
    });

    it('a la suba con la compra pagada: queda parcial con la diferencia pendiente', async () => {
      const { supplier, product } = await setup();
      const purchase = await createPurchase(
        supplier.id,
        product.id,
        10,
        'cash',
      );

      const res = await editPurchase(purchase.id, product.id, 12).expect(200);

      expect(res.body.purchase.paymentStatus).toBe('partial');
      expect((await paymentsOf(purchase.id)).pendingAmount).toBe(1000);
      expect(await creditOf(supplier.id)).toBe(0);
    });

    it('recalcula el estado en ediciones sucesivas sin duplicar saldo', async () => {
      const { supplier, product } = await setup();
      const purchase = await createPurchase(supplier.id, product.id, 10);
      await paySupplier(purchase.id, 3000).expect(201);

      const states: [number, string, number][] = [
        // [kg, estado esperado, saldo a favor esperado]
        [12, 'partial', 0],
        [6, 'paid', 0],
        [4, 'paid', 1000],
        [10, 'partial', 1000],
      ];

      for (const [kg, status, credit] of states) {
        const res = await editPurchase(purchase.id, product.id, kg).expect(200);
        expect(res.body.purchase.paymentStatus).toBe(status);
        expect(await creditOf(supplier.id)).toBe(credit);
      }
    });

    it('no permite editar una compra anulada', async () => {
      const { supplier, product } = await setup();
      const purchase = await createPurchase(supplier.id, product.id, 2);
      await cancelPurchase(purchase.id).expect(200);

      await editPurchase(purchase.id, product.id, 3).expect(409);
    });
  });

  describe('anulación', () => {
    it('revierte el stock y pasa lo pagado a saldo a favor', async () => {
      const { supplier, product } = await setup();
      const purchase = await createPurchase(supplier.id, product.id, 10);
      await paySupplier(purchase.id, 1500).expect(201);

      const res = await cancelPurchase(purchase.id).expect(200);

      expect(res.body.purchase.paymentStatus).toBe('cancelled');
      expect(res.body.creditGenerated).toBe(1500);
      expect(await t.stockOf(product.id)).toBe(0);
      expect(await creditOf(supplier.id)).toBe(1500);
    });

    it('una compra sin pagos no genera saldo', async () => {
      const { supplier, product } = await setup();
      const purchase = await createPurchase(supplier.id, product.id, 10);

      const res = await cancelPurchase(purchase.id).expect(200);

      expect(res.body.creditGenerated).toBe(0);
      expect(await creditOf(supplier.id)).toBe(0);
    });

    it('5 anulaciones simultáneas revierten el stock una sola vez', async () => {
      const { supplier, product } = await setup();
      const purchase = await createPurchase(
        supplier.id,
        product.id,
        10,
        'cash',
      );

      const results = await Promise.all(
        Array.from({ length: 5 }, () => cancelPurchase(purchase.id)),
      );

      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await t.stockOf(product.id)).toBe(0);
      expect(await creditOf(supplier.id)).toBe(5000);
    });

    it('no acepta pagos a compras anuladas', async () => {
      const { supplier, product } = await setup();
      const purchase = await createPurchase(supplier.id, product.id, 2);
      await cancelPurchase(purchase.id).expect(200);

      await paySupplier(purchase.id, 100).expect(400);
    });

    it('las compras anuladas no aparecen en el listado, las parciales sí', async () => {
      const { supplier, product } = await setup();
      const cancelled = await createPurchase(supplier.id, product.id, 2);
      await cancelPurchase(cancelled.id).expect(200);
      const partial = await createPurchase(supplier.id, product.id, 2);
      await paySupplier(partial.id, 100).expect(201);

      const res = await t
        .http()
        .get('/purchases')
        .set('authorization', auth)
        .expect(200);

      const ids = res.body.map((p: { id: string }) => p.id);
      expect(ids).toContain(partial.id);
      expect(ids).not.toContain(cancelled.id);
    });
  });

  describe('pagar con saldo a favor', () => {
    const supplierWithCredit = async (credit: number) => {
      const { supplier, product } = await setup();
      const purchase = await createPurchase(
        supplier.id,
        product.id,
        credit / 500,
        'cash',
      );
      await cancelPurchase(purchase.id).expect(200);
      return { supplier, product };
    };

    it('usa el saldo para pagar otra compra del mismo proveedor', async () => {
      const { supplier, product } = await supplierWithCredit(3000);
      const purchase = await createPurchase(supplier.id, product.id, 4);

      const res = await paySupplier(
        purchase.id,
        2000,
        'supplier_credit',
      ).expect(201);

      expect(res.body.paymentStatus).toBe('paid');
      expect(await creditOf(supplier.id)).toBe(1000);
    });

    it('rechaza usar más saldo del disponible', async () => {
      const { supplier, product } = await supplierWithCredit(1000);
      const purchase = await createPurchase(supplier.id, product.id, 4);

      const res = await paySupplier(
        purchase.id,
        1500,
        'supplier_credit',
      ).expect(400);

      expect(res.body.message).toContain('1000.00');
      expect(await creditOf(supplier.id)).toBe(1000);
    });

    it('el saldo de un proveedor no sirve para otro', async () => {
      await supplierWithCredit(3000);
      const { supplier, product } = await setup();
      const purchase = await createPurchase(supplier.id, product.id, 2);

      await paySupplier(purchase.id, 500, 'supplier_credit').expect(400);
    });

    it('dos pagos simultáneos no pueden usar el mismo saldo', async () => {
      const { supplier, product } = await supplierWithCredit(3000);
      const first = await createPurchase(supplier.id, product.id, 6);
      const second = await createPurchase(supplier.id, product.id, 6);

      const results = await Promise.all(
        [first, second].map((p) => paySupplier(p.id, 3000, 'supplier_credit')),
      );

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 400,
      ]);
      expect(await creditOf(supplier.id)).toBe(0);
    });
  });
});
