import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The UI tests import app modules directly; resolve the shared package like the apps do.
  resolve: {
    alias: {
      '@sv/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname,
    },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
