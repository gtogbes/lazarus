import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Synthesising the app stages web/dist and the Docker context; allow for it.
    testTimeout: 60_000,
  },
});
