import { UserRole } from '../src/users/entities/user.entity.js';
import { WhatsAppMessage } from '../src/whatsapp/entities/whatsapp-message.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

describe('Paginación de listados', () => {
  let t: TestApp;
  let auth: string;

  const get = (path: string) => t.http().get(path).set('authorization', auth);

  beforeAll(async () => {
    t = await createTestApp();
    auth = (await t.createUser(UserRole.ADMIN)).auth;

    const customer = await t.createCustomer();
    const product = await t.createProduct();

    for (let i = 0; i < 7; i++) {
      await t
        .http()
        .post('/orders')
        .set('authorization', auth)
        .send({
          customerId: customer.id,
          items: [{ productId: product.id, quantity: 1 }],
        })
        .expect(201);
    }
  });

  afterAll(() => t.close());

  it('sin parámetros devuelve la lista completa (compatibilidad)', async () => {
    const res = await get('/orders').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(7);
  });

  it('con page y limit devuelve la página y los totales', async () => {
    const all = (await get('/orders').expect(200)).body;
    const res = await get('/orders?page=2&limit=3').expect(200);

    expect(res.body).toEqual({
      data: all.slice(3, 6),
      total: 7,
      page: 2,
      limit: 3,
      totalPages: 3,
    });
  });

  it('la última página trae lo que queda', async () => {
    const res = await get('/orders?page=3&limit=3').expect(200);

    expect(res.body.data).toHaveLength(1);
  });

  it('usa 50 por defecto si solo se pasa page', async () => {
    const res = await get('/orders?page=1').expect(200);

    expect(res.body.limit).toBe(50);
  });

  it.each([
    ['page=0', 'page must not be less than 1'],
    ['limit=0', 'limit must not be less than 1'],
    ['limit=201', 'limit must not be greater than 200'],
    ['page=abc', 'page must be an integer number'],
  ])('rechaza %s', async (query, message) => {
    const res = await get(`/orders?${query}`).expect(400);

    expect(res.body.message).toContain(message);
  });

  describe('conversaciones de WhatsApp', () => {
    beforeAll(async () => {
      const repository = t.dataSource.getRepository(WhatsAppMessage);
      const message = (phone: string, text: string, minutesAgo: number) =>
        repository.create({
          phone,
          message: text,
          direction: 'incoming',
          type: 'text',
          status: 'received',
          createdAt: new Date(Date.now() - minutesAgo * 60_000),
        } as Partial<WhatsAppMessage>);

      await repository.save([
        message('111', 'viejo', 30),
        message('111', 'último de 111', 5),
        message('222', 'último de 222', 10),
        message('333', 'último de 333', 1),
      ]);

      // Dos clientes con el mismo teléfono: se muestra el activo.
      await t.createCustomer({
        phone: '111',
        name: 'Inactivo',
        isActive: false,
      });
      await t.createCustomer({ phone: '111', name: 'Activo' });
    });

    it('una conversación por teléfono con su último mensaje, más reciente primero', async () => {
      const res = await get('/whatsapp/conversations').expect(200);

      expect(
        res.body.map((c: { phone: string; lastMessage: string }) => [
          c.phone,
          c.lastMessage,
        ]),
      ).toEqual([
        ['333', 'último de 333'],
        ['111', 'último de 111'],
        ['222', 'último de 222'],
      ]);

      expect(res.body[1].customerName).toBe('Activo');
      expect(res.body[0].customerName).toBe('Cliente desconocido');
    });

    it('se pueden paginar', async () => {
      const res = await get('/whatsapp/conversations?page=2&limit=2').expect(
        200,
      );

      expect(res.body.total).toBe(3);
      expect(res.body.data.map((c: { phone: string }) => c.phone)).toEqual([
        '222',
      ]);
    });
  });
});
