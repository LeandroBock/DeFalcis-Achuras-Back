import { defineConfig } from 'vitest/config';

// Tests de integración: levantan la app completa contra un Postgres local
// (ver test/support/test-db.ts). Cada archivo usa su propia base.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    setupFiles: ['reflect-metadata'],
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
