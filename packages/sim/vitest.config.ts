import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'sim',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
