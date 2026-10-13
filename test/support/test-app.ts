import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { configureApp } from '../../src/app.setup.js';
import { Customer } from '../../src/customers/entities/customer.entity.js';
import {
  Product,
  ProductUnit,
} from '../../src/products/entities/product.entity.js';
import { Supplier } from '../../src/suppliers/entities/supplier.entity.js';
import { User, UserRole } from '../../src/users/entities/user.entity.js';

import {
  TEMPLATE_DB,
  TEST_DB_PREFIX,
  dropDatabase,
  testDbConfig,
  withAdminClient,
} from './test-db.js';

export const TEST_PASSWORD = 'Test12345678';

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

// Levanta la app completa (módulos, guards, pipes y migraciones) contra una
// base nueva copiada de la plantilla.
export async function createTestApp(env: Record<string, string> = {}) {
  const database = `${TEST_DB_PREFIX}${randomUUID().slice(0, 8)}`;
  const db = testDbConfig();

  await withAdminClient((client) =>
    client.query(`CREATE DATABASE "${database}" TEMPLATE "${TEMPLATE_DB}"`),
  );

  // ConfigModule valida el entorno al importar AppModule: hay que definirlo
  // antes del import.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_HOST: db.host,
    DB_PORT: String(db.port),
    DB_USERNAME: db.user,
    DB_PASSWORD: db.password,
    DB_NAME: database,
    DB_SSL: 'false',
    JWT_SECRET: 'test-secret-de-al-menos-32-caracteres!!',
    SEED_ADMIN_EMAIL: '',
    SEED_ADMIN_PASSWORD: '',
    ...env,
  });

  const { AppModule } = await import('../../src/app.module.js');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.listen(0);

  const dataSource = app.get(DataSource);
  const jwtService = app.get(JwtService);

  const fixtures = createFixtures(dataSource, jwtService);

  return {
    app: app as INestApplication,
    dataSource,
    ...fixtures,

    http: () => request(app.getHttpServer()),

    async close() {
      await app.close();
      await withAdminClient((client) => dropDatabase(client, database));
    },
  };
}

function createFixtures(dataSource: DataSource, jwtService: JwtService) {
  let counter = 0;
  const unique = () => `${Date.now()}-${++counter}`;

  return {
    async createUser(role: UserRole, overrides: Partial<User> = {}) {
      const repository = dataSource.getRepository(User);

      const user = await repository.save(
        repository.create({
          name: `Usuario ${role}`,
          email: `${role}-${unique()}@test.com`,
          password: await bcrypt.hash(TEST_PASSWORD, 4),
          role,
          isActive: true,
          ...overrides,
        }),
      );

      const token = await jwtService.signAsync({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      return { user, token, auth: `Bearer ${token}` };
    },

    async createProduct(overrides: Partial<Product> = {}) {
      const repository = dataSource.getRepository(Product);

      return repository.save(
        repository.create({
          name: `Producto ${unique()}`,
          category: 'achuras',
          unit: ProductUnit.KG,
          salePrice: 1000,
          costPrice: 500,
          stock: 0,
          isActive: true,
          ...overrides,
        }),
      );
    },

    async createCustomer(overrides: Partial<Customer> = {}) {
      const repository = dataSource.getRepository(Customer);

      return repository.save(
        repository.create({ name: `Cliente ${unique()}`, ...overrides }),
      );
    },

    async createSupplier(overrides: Partial<Supplier> = {}) {
      const repository = dataSource.getRepository(Supplier);

      return repository.save(
        repository.create({ name: `Proveedor ${unique()}`, ...overrides }),
      );
    },

    async stockOf(productId: string) {
      const product = await dataSource
        .getRepository(Product)
        .findOneByOrFail({ id: productId });

      return Number(product.stock);
    },
  };
}
