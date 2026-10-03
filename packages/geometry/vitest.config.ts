import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'geometry',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
