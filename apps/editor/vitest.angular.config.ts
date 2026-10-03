import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        'src/app/interaction/**': { lines: 90 },
        'src/app/core/**': { lines: 90 },
        'src/app/collab/**': { lines: 90 },
        'src/app/presence/**': { lines: 90 },
        'src/app/a11y/**': { lines: 90 },
        'src/app/canvas/**': { lines: 80 },
        'src/app/shell/**': { lines: 80 },
      },
    },
  },
});
