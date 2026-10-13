import pg from 'pg';

// Base de datos para los tests de integración. Por defecto, el Postgres de
// docker-compose.test.yml; se puede cambiar con TEST_DB_HOST, TEST_DB_PORT,
// TEST_DB_USER y TEST_DB_PASSWORD.
export const TEST_DB_PREFIX = 'dfachuras_test_';
export const TEMPLATE_DB = `${TEST_DB_PREFIX}template`;

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

export function testDbConfig() {
  const config = {
    host: process.env.TEST_DB_HOST ?? 'localhost',
    port: Number(process.env.TEST_DB_PORT ?? 5433),
    user: process.env.TEST_DB_USER ?? 'postgres',
    password: process.env.TEST_DB_PASSWORD ?? 'postgres',
  };

  // Los tests crean y borran bases: nunca deben apuntar a un servidor remoto
  // (por ejemplo, el Supabase de producción).
  if (!LOCAL_HOSTS.includes(config.host)) {
    throw new Error(
      `Los tests solo corren contra un Postgres local (TEST_DB_HOST=${config.host})`,
    );
  }

  return config;
}

export async function withAdminClient<T>(
  work: (client: pg.Client) => Promise<T>,
) {
  const client = new pg.Client({ ...testDbConfig(), database: 'postgres' });

  await client.connect();

  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function dropDatabase(client: pg.Client, name: string) {
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}
