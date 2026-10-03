import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    environment: 'node',
  },
});
