import { defineConfig } from 'vitest/config';

const coreLogic = { lines: 90 };
const everythingElse = { lines: 80 };

export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      'bench/vitest.config.ts',
      'scripts/vitest.config.ts',
    ],
    pool: 'forks',
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/server/src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        'packages/sim/src/bin.ts',
        'apps/server/src/main.ts',
        'apps/server/src/persistence/postgres-store.ts',
        'apps/server/src/persistence/migrate.ts',
      ],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      thresholds: {
        'packages/model/src/**': coreLogic,
        'packages/geometry/src/**': coreLogic,
        'packages/sync/src/**': coreLogic,
        'packages/sim/src/**': coreLogic,
        'apps/server/src/**': everythingElse,
        'apps/server/src/rooms/**': coreLogic,
        'apps/server/src/auth.ts': coreLogic,
        'apps/server/src/persistence/**': coreLogic,
      },
    },
  },
});
