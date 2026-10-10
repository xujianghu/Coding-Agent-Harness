import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    maxWorkers: 2,
    include: ['tests/**/*.test.ts'],
  },
});
