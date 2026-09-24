import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Tests must never touch the live network; see tests/setup.ts.
    setupFiles: ['tests/setup.ts'],
  },
});
