import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server-integration',
    root: import.meta.dirname,
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/support/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    maxWorkers: 3,
    coverage: {
      provider: 'v8',
      include: ['src/persistence/postgres-store.ts', 'src/persistence/migrate.ts'],
      reportsDirectory: '../../coverage/integration',
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 90 },
    },
  },
});
