import { UserRole } from '../src/users/entities/user.entity.js';
import { User } from '../src/users/entities/user.entity.js';

import { TEST_PASSWORD, TestApp, createTestApp } from './support/test-app.js';

describe('Autenticación y usuarios', () => {
  let t: TestApp;
  let superAdmin: Awaited<ReturnType<TestApp['createUser']>>;

  beforeAll(async () => {
    t = await createTestApp();
    superAdmin = await t.createUser(UserRole.SUPER_ADMIN);
  });

  afterAll(() => t.close());

  describe('login', () => {
    it('devuelve un token con credenciales válidas', async () => {
      const { user } = await t.createUser(UserRole.VENTAS);

      const res = await t
        .http()
        .post('/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(201);

      expect(res.body.access_token).toEqual(expect.any(String));
      expect(res.body.user).toEqual({
        id: user.id,
        name: user.name,
        email: user.email,
        role: UserRole.VENTAS,
      });
    });

    it('rechaza una contraseña incorrecta', async () => {
      const { user } = await t.createUser(UserRole.VENTAS);

      await t
        .http()
        .post('/auth/login')
        .send({ email: user.email, password: 'incorrecta' })
        .expect(401);
    });

    it('rechaza a un usuario desactivado', async () => {
      const { user } = await t.createUser(UserRole.VENTAS, {
        isActive: false,
      });

      await t
        .http()
        .post('/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(401);
    });
  });

  describe('token', () => {
    it('sin token devuelve 401', async () => {
      await t.http().get('/orders').expect(401);
    });

    it('con un token firmado con otro secreto devuelve 401', async () => {
      const forged =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzdWIiOiJ4Iiwicm9sZSI6InN1cGVyX2FkbWluIn0.' +
        'firma-invalida';

      await t
        .http()
        .get('/orders')
        .set('authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('deja de valer apenas se desactiva al usuario', async () => {
      const ventas = await t.createUser(UserRole.VENTAS);

      await t
        .http()
        .get('/orders')
        .set('authorization', ventas.auth)
        .expect(200);

      await t.dataSource
        .getRepository(User)
        .update(ventas.user.id, { isActive: false });

      await t
        .http()
        .get('/orders')
        .set('authorization', ventas.auth)
        .expect(401);
    });

    it('usa el rol actual de la base, no el del token', async () => {
      const ventas = await t.createUser(UserRole.VENTAS);

      await t
        .http()
        .get('/reports/dashboard')
        .set('authorization', ventas.auth)
        .expect(403);

      await t.dataSource
        .getRepository(User)
        .update(ventas.user.id, { role: UserRole.FINANZAS });

      await t
        .http()
        .get('/reports/dashboard')
        .set('authorization', ventas.auth)
        .expect(200);
    });
  });

  describe('gestión de usuarios', () => {
    const newUser = () => ({
      name: 'Nuevo',
      email: `nuevo-${Math.random()}@test.com`,
      password: 'Segura12345',
      role: UserRole.SUPER_ADMIN,
    });

    it('POST /users sin token devuelve 401 (no hay registro público)', async () => {
      await t.http().post('/users').send(newUser()).expect(401);
    });

    it('POST /users con un rol que no es super admin devuelve 403', async () => {
      const admin = await t.createUser(UserRole.ADMIN);

      await t
        .http()
        .post('/users')
        .set('authorization', admin.auth)
        .send(newUser())
        .expect(403);
    });

    it('el super admin crea usuarios y la respuesta no incluye la contraseña', async () => {
      const res = await t
        .http()
        .post('/users')
        .set('authorization', superAdmin.auth)
        .send(newUser())
        .expect(201);

      expect(res.body.id).toEqual(expect.any(String));
      expect(res.body).not.toHaveProperty('password');
    });

    it('GET /users no expone contraseñas', async () => {
      const res = await t
        .http()
        .get('/users')
        .set('authorization', superAdmin.auth)
        .expect(200);

      expect(res.body.length).toBeGreaterThan(0);
      for (const user of res.body) {
        expect(user).not.toHaveProperty('password');
      }
    });

    it('rechaza contraseñas de menos de 8 caracteres', async () => {
      await t
        .http()
        .post('/users')
        .set('authorization', superAdmin.auth)
        .send({ ...newUser(), password: '1234567' })
        .expect(400);
    });
  });

  it('limita los intentos de login a 5 por minuto', async () => {
    const attempt = () =>
      t
        .http()
        .post('/auth/login')
        .send({ email: 'nadie@test.com', password: 'x' });

    // Los tests de login de arriba ya consumieron algunos intentos.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await attempt()).status);
    }

    expect(statuses).toContain(429);
    expect(statuses.at(-1)).toBe(429);
  });
});
