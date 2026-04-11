import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    maxConcurrency: 1,
    bail: 1,
    passWithNoTests: true,
  },
});
