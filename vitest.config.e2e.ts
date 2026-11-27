import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    env: { NODE_ENV: 'test', REVGAS_USE_MOCK: 'true' },
  },
});
