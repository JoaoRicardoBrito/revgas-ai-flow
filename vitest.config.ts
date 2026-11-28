import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    root: './',
    include: ['src/**/*.spec.ts', 'web/src/**/*.spec.ts'],
    env: { NODE_ENV: 'test' },
  },
});
