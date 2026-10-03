import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'sync',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
