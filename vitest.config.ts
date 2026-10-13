import { defineConfig } from 'vitest/config';

// Tests unitarios: rápidos, sin base de datos.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    setupFiles: ['reflect-metadata'],
    include: ['src/**/*.spec.ts'],
  },
});
