import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Equivalence tests start a GnuCOBOL container; allow for image start-up.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
