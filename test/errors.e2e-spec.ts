import { Supplier } from '../src/suppliers/entities/supplier.entity.js';
import { UserRole } from '../src/users/entities/user.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

describe('Errores de base de datos', () => {
  let t: TestApp;
  let superAdmin: string;

  beforeAll(async () => {
    t = await createTestApp();
    superAdmin = (await t.createUser(UserRole.SUPER_ADMIN)).auth;
  });

  afterAll(() => t.close());

  it('un dato único repetido devuelve 409 indicando el campo', async () => {
    const user = {
      name: 'Repetido',
      email: 'repetido@test.com',
      password: 'Segura12345',
    };

    await t
      .http()
      .post('/users')
      .set('authorization', superAdmin)
      .send(user)
      .expect(201);

    const res = await t
      .http()
      .post('/users')
      .set('authorization', superAdmin)
      .send(user)
      .expect(409);

    expect(res.body).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Ya existe un registro con ese email',
    });
  });

  it('aunque dos requests simultáneos pasen la validación previa, uno recibe 409', async () => {
    // La verificación de duplicados del servicio no alcanza con requests
    // simultáneos: la restricción única de la base es la que decide.
    const admin = (await t.createUser(UserRole.ADMIN)).auth;
    const body = { name: 'Simultáneo', email: 'simultaneo@test.com' };

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        t.http().post('/suppliers').set('authorization', admin).send(body),
      ),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    expect(
      await t.dataSource.getRepository(Supplier).countBy({ email: body.email }),
    ).toBe(1);
  });

  it('un error inesperado devuelve 500 sin detalles internos', async () => {
    const admin = (await t.createUser(UserRole.ADMIN)).auth;
    await t.dataSource.query('ALTER TABLE "EXPENSES" RENAME TO "EXPENSES_X"');

    try {
      const res = await t
        .http()
        .get('/expenses')
        .set('authorization', admin)
        .expect(500);

      expect(res.body).toEqual({
        statusCode: 500,
        message: 'Internal server error',
      });
    } finally {
      await t.dataSource.query('ALTER TABLE "EXPENSES_X" RENAME TO "EXPENSES"');
    }
  });
});
