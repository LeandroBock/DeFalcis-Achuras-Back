import { User, UserRole } from '../src/users/entities/user.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

type Fixture = Awaited<ReturnType<TestApp['createUser']>>;

describe('Empleados y su acceso a la app', () => {
  let t: TestApp;
  let superAdmin: Fixture;
  let admin: Fixture;

  beforeAll(async () => {
    t = await createTestApp();
    superAdmin = await t.createUser(UserRole.SUPER_ADMIN);
    admin = await t.createUser(UserRole.ADMIN);
  });

  afterAll(() => t.close());

  let counter = 0;
  const createEmployee = async (name = 'Juan Repartidor') => {
    const res = await t
      .http()
      .post('/employees')
      .set('authorization', superAdmin.auth)
      .send({ name, position: 'delivery', salary: 0 })
      .expect(201);
    return res.body.id as string;
  };

  const giveAccess = (
    employeeId: string,
    body: Record<string, unknown> = {},
    who: Fixture = superAdmin,
  ) =>
    t
      .http()
      .post(`/employees/${employeeId}/account`)
      .set('authorization', who.auth)
      .send({
        email: `empleado-${++counter}@test.com`,
        password: 'Reparto1234',
        role: 'reparto',
        ...body,
      });

  const updateAccess = (employeeId: string, body: Record<string, unknown>) =>
    t
      .http()
      .patch(`/employees/${employeeId}/account`)
      .set('authorization', superAdmin.auth)
      .send(body);

  const login = (email: string, password: string) =>
    t.http().post('/auth/login').send({ email, password });

  it('el super admin le crea la cuenta de reparto a un empleado y este puede entrar', async () => {
    const employeeId = await createEmployee('Juan Repartidor');

    const res = await giveAccess(employeeId, {
      email: 'Juan.Reparto@Test.com',
    }).expect(201);

    expect(res.body).toEqual({
      userId: expect.any(String),
      email: 'juan.reparto@test.com',
      role: 'reparto',
      isActive: true,
    });

    // Entra con su cuenta y ve sus entregas.
    const session = await login('juan.reparto@test.com', 'Reparto1234').expect(
      201,
    );
    expect(session.body.user).toMatchObject({
      name: 'Juan Repartidor',
      role: 'reparto',
    });
    await t
      .http()
      .get('/deliveries/mine')
      .set('authorization', `Bearer ${session.body.access_token}`)
      .expect(200);

    // Aparece para asignarle notas de pedido.
    const drivers = await t
      .http()
      .get('/deliveries/drivers')
      .set('authorization', admin.auth)
      .expect(200);
    expect(drivers.body.map((d: { name: string }) => d.name)).toContain(
      'Juan Repartidor',
    );
  });

  it('el listado de empleados muestra el acceso, sin contraseñas', async () => {
    const withAccess = await createEmployee('Con acceso');
    const without = await createEmployee('Sin acceso');
    await giveAccess(withAccess).expect(201);

    const res = await t
      .http()
      .get('/employees')
      .set('authorization', admin.auth)
      .expect(200);

    const byId = Object.fromEntries(
      res.body.map((e: { id: string }) => [e.id, e]),
    );
    expect(byId[withAccess].account).toMatchObject({
      role: 'reparto',
      isActive: true,
    });
    expect(byId[without].account).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('solo el super admin puede dar accesos', async () => {
    const employeeId = await createEmployee();

    await giveAccess(employeeId, {}, admin).expect(403);
  });

  it('desde empleados no se pueden crear cuentas de super admin', async () => {
    const employeeId = await createEmployee();

    const res = await giveAccess(employeeId, { role: 'super_admin' }).expect(
      400,
    );
    expect(JSON.stringify(res.body.message)).toContain('El rol tiene que ser');
  });

  it('valida email y contraseña', async () => {
    const employeeId = await createEmployee();

    await giveAccess(employeeId, { email: 'no-es-un-email' }).expect(400);
    await giveAccess(employeeId, { password: '1234567' }).expect(400);
  });

  it('no se repiten emails ni accesos', async () => {
    const first = await createEmployee();
    const second = await createEmployee();
    await giveAccess(first, { email: 'repetido@test.com' }).expect(201);

    const duplicated = await giveAccess(second, {
      email: 'repetido@test.com',
    }).expect(409);
    expect(duplicated.body.message).toBe('Ya existe un registro con ese email');

    const again = await giveAccess(first).expect(409);
    expect(again.body.message).toBe('El empleado ya tiene acceso a la app');
  });

  it('resetear la contraseña', async () => {
    const employeeId = await createEmployee();
    await giveAccess(employeeId, { email: 'olvidadizo@test.com' }).expect(201);

    await updateAccess(employeeId, { password: 'NuevaClave99' }).expect(200);

    await login('olvidadizo@test.com', 'Reparto1234').expect(401);
    await login('olvidadizo@test.com', 'NuevaClave99').expect(201);
  });

  it('cambiar el rol', async () => {
    const employeeId = await createEmployee();
    await giveAccess(employeeId).expect(201);

    const res = await updateAccess(employeeId, { role: 'ventas' }).expect(200);
    expect(res.body.role).toBe('ventas');

    await updateAccess(employeeId, { role: 'super_admin' }).expect(400);
  });

  it('bloquear el acceso corta la sesión al instante', async () => {
    const employeeId = await createEmployee();
    await giveAccess(employeeId, { email: 'bloqueado@test.com' }).expect(201);
    const session = await login('bloqueado@test.com', 'Reparto1234').expect(
      201,
    );
    const auth = `Bearer ${session.body.access_token}`;

    await updateAccess(employeeId, { isActive: false }).expect(200);

    await t
      .http()
      .get('/deliveries/mine')
      .set('authorization', auth)
      .expect(401);
    await login('bloqueado@test.com', 'Reparto1234').expect(401);

    // Desbloquearlo no revive la sesión anterior: tiene que volver a entrar.
    await updateAccess(employeeId, { isActive: true }).expect(200);
    await t
      .http()
      .get('/deliveries/mine')
      .set('authorization', auth)
      .expect(401);
  });

  it('dar de baja al empleado le quita el acceso', async () => {
    const employeeId = await createEmployee();
    const access = await giveAccess(employeeId).expect(201);

    await t
      .http()
      .patch(`/employees/${employeeId}/deactivate`)
      .set('authorization', superAdmin.auth)
      .expect(200);

    // (Que un usuario inactivo no pueda entrar se prueba arriba; acá no se
    // repite el login para no chocar con el límite de 5 intentos por minuto.)
    const user = await t.dataSource
      .getRepository(User)
      .findOneByOrFail({ id: access.body.userId });
    expect(user.isActive).toBe(false);
  });

  it('cambiar el nombre del empleado lo cambia también en la app', async () => {
    const employeeId = await createEmployee('Nombre Viejo');
    const access = await giveAccess(employeeId).expect(201);

    await t
      .http()
      .patch(`/employees/${employeeId}`)
      .set('authorization', superAdmin.auth)
      .send({ name: 'Nombre Nuevo' })
      .expect(200);

    const drivers = await t
      .http()
      .get('/deliveries/drivers')
      .set('authorization', admin.auth);
    expect(
      drivers.body.find((d: { id: string }) => d.id === access.body.userId)
        ?.name,
    ).toBe('Nombre Nuevo');
  });

  it('gestionar el acceso de un empleado sin cuenta devuelve 404', async () => {
    const employeeId = await createEmployee();

    await updateAccess(employeeId, { role: 'ventas' }).expect(404);
  });
});
