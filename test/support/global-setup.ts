/// <reference types="vite/client" />
import 'reflect-metadata';
import { DataSource } from 'typeorm';

import {
  TEMPLATE_DB,
  TEST_DB_PREFIX,
  dropDatabase,
  testDbConfig,
  withAdminClient,
} from './test-db.js';

// Crea una base "plantilla" corriendo las migraciones reales, y verifica que
// el esquema resultante coincida con las entidades (si alguien cambia una
// entidad sin escribir la migración, los tests fallan acá). Cada archivo de
// tests copia la plantilla (CREATE DATABASE ... TEMPLATE), así corren aislados
// y en paralelo.
export async function setup() {
  await dropTestDatabases();

  await withAdminClient((client) =>
    client.query(`CREATE DATABASE "${TEMPLATE_DB}"`),
  );

  const { host, port, user, password } = testDbConfig();

  const dataSource = new DataSource({
    type: 'postgres',
    host,
    port,
    username: user,
    password,
    database: TEMPLATE_DB,
    entities: classesFrom(
      import.meta.glob('../../src/**/*.entity.ts', { eager: true }),
    ),
    migrations: classesFrom(
      import.meta.glob('../../src/migrations/*.ts', { eager: true }),
    ),
  });

  await dataSource.initialize();

  try {
    await dataSource.runMigrations();

    const pending = await dataSource.driver.createSchemaBuilder().log();

    if (pending.upQueries.length > 0) {
      throw new Error(
        'Las entidades no coinciden con las migraciones. Falta una migración con:\n' +
          pending.upQueries.map((query) => query.query).join(';\n'),
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

function classesFrom(modules: Record<string, unknown>) {
  return Object.values(modules).flatMap((module) =>
    Object.values(module as Record<string, unknown>).filter(
      (value) => typeof value === 'function',
    ),
  ) as (new () => never)[];
}

export async function teardown() {
  await dropTestDatabases();
}

async function dropTestDatabases() {
  await withAdminClient(async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${TEST_DB_PREFIX}%`],
    );

    for (const { datname } of rows) {
      await dropDatabase(client, datname);
    }
  });
}
