import { JwtService } from '@nestjs/jwt';

import { UserSession } from '../src/auth/entities/user-session.entity.js';
import { UserRole } from '../src/users/entities/user.entity.js';

import { TEST_PASSWORD, TestApp, createTestApp } from './support/test-app.js';

const HOUR = 60 * 60 * 1000;

describe('Sesiones: duración y cierre', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  const login = (email: string) =>
    t
      .http()
      .post('/auth/login')
      .set('user-agent', 'Celular de prueba')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);

  const decode = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
      iat: number;
      exp: number;
      sid: string;
    };

  it('el login abre una sesión de 8 horas', async () => {
    const { user } = await t.createUser(UserRole.VENTAS);

    const res = await login(user.email);

    const { iat, exp, sid } = decode(res.body.access_token);
    expect(exp - iat).toBe(8 * 60 * 60);

    const expiresAt = new Date(res.body.expiresAt).getTime();
    expect(Math.abs(expiresAt - (Date.now() + 8 * HOUR))).toBeLessThan(60_000);

    const session = await t.dataSource
      .getRepository(UserSession)
      .findOneByOrFail({ id: sid });
    expect(session).toMatchObject({
      userId: user.id,
      revokedAt: null,
      userAgent: 'Celular de prueba',
    });
  });

  it('cerrar sesión invalida ese token al instante, sin afectar otros dispositivos', async () => {
    const { user } = await t.createUser(UserRole.VENTAS);
    const phone = (await login(user.email)).body.access_token;
    const office = (await login(user.email)).body.access_token;

    await t
      .http()
      .post('/auth/logout')
      .set('authorization', `Bearer ${phone}`)
      .expect(201);

    const res = await t
      .http()
      .get('/orders')
      .set('authorization', `Bearer ${phone}`)
      .expect(401);
    expect(res.body.message).toBe('Tu sesión se cerró. Volvé a ingresar.');

    await t
      .http()
      .get('/orders')
      .set('authorization', `Bearer ${office}`)
      .expect(200);
  });

  it('una sesión vencida no sirve aunque el token sea válido', async () => {
    const ventas = await t.createUser(UserRole.VENTAS);
    await t.dataSource
      .getRepository(UserSession)
      .update(ventas.session.id, { expiresAt: new Date(Date.now() - 1000) });

    await t.http().get('/orders').set('authorization', ventas.auth).expect(401);
  });

  it('los tokens sin sesión (anteriores a este cambio) piden volver a ingresar', async () => {
    const { user } = await t.createUser(UserRole.VENTAS);
    const oldToken = await t.app.get(JwtService).signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const res = await t
      .http()
      .get('/orders')
      .set('authorization', `Bearer ${oldToken}`)
      .expect(401);
    expect(res.body.message).toBe('Tu sesión venció. Volvé a ingresar.');
  });

  it('un token vencido pide volver a ingresar', async () => {
    const ventas = await t.createUser(UserRole.VENTAS);
    const expired = await t.app.get(JwtService).signAsync(
      {
        sub: ventas.user.id,
        email: ventas.user.email,
        role: ventas.user.role,
        sid: ventas.session.id,
      },
      { expiresIn: -10 },
    );

    const res = await t
      .http()
      .get('/orders')
      .set('authorization', `Bearer ${expired}`)
      .expect(401);
    expect(res.body.message).toBe('Tu sesión venció. Volvé a ingresar.');
  });

  it('resetear la contraseña de un empleado cierra todas sus sesiones', async () => {
    const superAdmin = await t.createUser(UserRole.SUPER_ADMIN);
    const employee = await t
      .http()
      .post('/employees')
      .set('authorization', superAdmin.auth)
      .send({ name: 'Repartidor', position: 'delivery', salary: 0 })
      .expect(201);
    await t
      .http()
      .post(`/employees/${employee.body.id}/account`)
      .set('authorization', superAdmin.auth)
      .send({
        email: 'perdio-el-celular@test.com',
        password: TEST_PASSWORD,
        role: 'reparto',
      })
      .expect(201);
    const session = (await login('perdio-el-celular@test.com')).body
      .access_token;

    await t
      .http()
      .patch(`/employees/${employee.body.id}/account`)
      .set('authorization', superAdmin.auth)
      .send({ password: 'OtraClave123' })
      .expect(200);

    await t
      .http()
      .get('/deliveries/mine')
      .set('authorization', `Bearer ${session}`)
      .expect(401);
  });
});
