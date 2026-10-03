import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'bench',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
