import { defineConfig } from 'vitest/config';

const coreLogic = { lines: 90 };

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'scripts/vitest.config.ts'],
    pool: 'forks',
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.d.ts', 'packages/sim/src/bin.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      thresholds: {
        'packages/model/src/**': coreLogic,
        'packages/sync/src/**': coreLogic,
        'packages/sim/src/**': coreLogic,
      },
    },
  },
});
