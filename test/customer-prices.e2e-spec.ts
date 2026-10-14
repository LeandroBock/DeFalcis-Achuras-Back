import { Product } from '../src/products/entities/product.entity.js';
import { UserRole } from '../src/users/entities/user.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

type Fixture = Awaited<ReturnType<TestApp['createUser']>>;

describe('Precios especiales por cliente', () => {
  let t: TestApp;
  let admin: Fixture;
  let ventas: Fixture;
  let driver: Fixture;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.createUser(UserRole.ADMIN);
    ventas = await t.createUser(UserRole.VENTAS);
    driver = await t.createUser(UserRole.REPARTO);
  });

  afterAll(() => t.close());

  const setPrice = (
    customerId: string,
    productId: string,
    price: unknown,
    who: Fixture = admin,
  ) =>
    t
      .http()
      .put(`/customers/${customerId}/prices/${productId}`)
      .set('authorization', who.auth)
      .send({ price });

  const createNote = async (customerId: string, productId: string, kg = 2) => {
    const res = await t
      .http()
      .post('/orders')
      .set('authorization', ventas.auth)
      .send({
        customerId,
        items: [{ productId, quantity: kg }],
        assignedToId: driver.user.id,
      })
      .expect(201);
    return res.body;
  };

  describe('gestión', () => {
    it('se cargan, se listan con el precio normal al lado y se borran', async () => {
      const customer = await t.createCustomer();
      const chinchulin = await t.createProduct({
        name: 'Chinchulín',
        salePrice: 1000,
      });

      await setPrice(customer.id, chinchulin.id, 900).expect(200);

      const list = await t
        .http()
        .get(`/customers/${customer.id}/prices`)
        .set('authorization', ventas.auth)
        .expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({
          productId: chinchulin.id,
          productName: 'Chinchulín',
          normalPrice: 1000,
          price: 900,
        }),
      ]);

      // Cargarlo de nuevo lo actualiza (no lo duplica).
      await setPrice(customer.id, chinchulin.id, 950).expect(200);
      const updated = await t
        .http()
        .get(`/customers/${customer.id}/prices`)
        .set('authorization', admin.auth);
      expect(updated.body).toHaveLength(1);
      expect(updated.body[0].price).toBe(950);

      await t
        .http()
        .delete(`/customers/${customer.id}/prices/${chinchulin.id}`)
        .set('authorization', admin.auth)
        .expect(200);
      await t
        .http()
        .delete(`/customers/${customer.id}/prices/${chinchulin.id}`)
        .set('authorization', admin.auth)
        .expect(404);
    });

    it('ventas los ve pero no los puede cambiar', async () => {
      const customer = await t.createCustomer();
      const product = await t.createProduct();

      await setPrice(customer.id, product.id, 900, ventas).expect(403);
    });

    it('valida el precio, el cliente y el producto', async () => {
      const customer = await t.createCustomer();
      const product = await t.createProduct();
      const inactive = await t.createProduct({ isActive: false });

      await setPrice(customer.id, product.id, 0).expect(400);
      await setPrice(customer.id, product.id, 'mucho').expect(400);
      await setPrice(customer.id, inactive.id, 900).expect(404);
      await setPrice(
        '00000000-0000-4000-8000-000000000000',
        product.id,
        900,
      ).expect(404);
    });
  });

  describe('se aplican solos', () => {
    it('la nota de pedido usa el precio especial; otro cliente paga el normal', async () => {
      const especial = await t.createCustomer();
      const comun = await t.createCustomer();
      const product = await t.createProduct({ salePrice: 1000 });
      await setPrice(especial.id, product.id, 850).expect(200);

      const a = await createNote(especial.id, product.id);
      const b = await createNote(comun.id, product.id);

      expect(Number(a.items[0].unitPrice)).toBe(850);
      expect(Number(a.order.total)).toBe(1700);
      expect(Number(b.items[0].unitPrice)).toBe(1000);
    });

    it('si el producto aumenta, el precio especial no cambia', async () => {
      const especial = await t.createCustomer();
      const comun = await t.createCustomer();
      const product = await t.createProduct({ salePrice: 1000 });
      await setPrice(especial.id, product.id, 850).expect(200);

      await t.dataSource
        .getRepository(Product)
        .update(product.id, { salePrice: 1200 });

      expect(
        Number((await createNote(especial.id, product.id)).items[0].unitPrice),
      ).toBe(850);
      expect(
        Number((await createNote(comun.id, product.id)).items[0].unitPrice),
      ).toBe(1200);
    });

    it('la nota respeta su precio aunque después cambie el especial', async () => {
      const customer = await t.createCustomer();
      const product = await t.createProduct({ salePrice: 1000 });
      await setPrice(customer.id, product.id, 850).expect(200);
      const { order } = await createNote(customer.id, product.id);

      await setPrice(customer.id, product.id, 700).expect(200);

      const res = await t
        .http()
        .post(`/orders/${order.id}/deliver`)
        .set('authorization', driver.auth)
        .send({ items: [{ productId: product.id, quantity: 2 }] })
        .expect(201);
      expect(Number(res.body.order.total)).toBe(1700);
    });

    it('un producto agregado en la entrega va al precio especial del cliente', async () => {
      const customer = await t.createCustomer();
      const pedido = await t.createProduct({ salePrice: 1000 });
      const agregado = await t.createProduct({ salePrice: 2500 });
      await setPrice(customer.id, agregado.id, 2000).expect(200);
      const { order } = await createNote(customer.id, pedido.id, 1);

      const res = await t
        .http()
        .post(`/orders/${order.id}/deliver`)
        .set('authorization', driver.auth)
        .send({
          items: [
            { productId: pedido.id, quantity: 1 },
            { productId: agregado.id, quantity: 1.5 },
          ],
        })
        .expect(201);

      expect(Number(res.body.order.total)).toBe(4000); // 1000 + 1.5 × 2000
    });

    it('el repartidor recibe los precios especiales del cliente', async () => {
      const customer = await t.createCustomer();
      const product = await t.createProduct({ salePrice: 1000 });
      const other = await t.createProduct({ salePrice: 3000 });
      await setPrice(customer.id, other.id, 2700).expect(200);
      await createNote(customer.id, product.id);

      const res = await t
        .http()
        .get('/deliveries/mine')
        .set('authorization', driver.auth)
        .expect(200);

      const delivery = res.body.find(
        (d: { customer: { id: string } }) => d.customer.id === customer.id,
      );
      expect(delivery.customer.specialPrices).toEqual({ [other.id]: 2700 });
    });

    it('los pedidos por WhatsApp también usan el precio especial', async () => {
      const customer = await t.createCustomer({ phone: '3415559999' });
      const product = await t.createProduct({
        name: 'Mollejas',
        salePrice: 3000,
      });
      await setPrice(customer.id, product.id, 2600).expect(200);

      const res = await t
        .http()
        .post('/whatsapp/orders/prepare')
        .set('authorization', ventas.auth)
        .send({ phone: '5493415559999', message: 'quiero 2 kg de mollejas' })
        .expect(201);

      expect(Number(res.body.order.unitPrice)).toBe(2600);
      expect(Number(res.body.order.subtotal)).toBe(5200);
      expect(res.body.confirmationMessage).toContain('El total es $5200');

      const confirmed = await t
        .http()
        .post(`/whatsapp/orders/${res.body.order.id}/confirm`)
        .set('authorization', ventas.auth)
        .expect(201);
      expect(Number(confirmed.body.order.total)).toBe(5200);
    });
  });
});
