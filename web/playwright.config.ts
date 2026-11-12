import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real proof API and real GnuCOBOL (docker runner).
 * Needs Docker running and the `lazarus-gnucobol:3.1.2` image (`npm run cobol:image`).
 * Run with `npm run test:e2e -w web`. Not part of `npm test -w web` (Vitest), which stays Docker-free.
 */
const API_HOST = '127.0.0.1';
const API_PORT = 8787; // src/api/dev-server.ts DEFAULT_PORT; vite.config.ts proxies /api here.
const WEB_PORT = 5173;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // One worker: every test shares the one dev server and its COBOL container.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Generous: the first proof starts a COBOL container and may compile the program.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The dev server answers GET with 405, which Playwright does not treat as ready, so wait on the port.
      command: 'npm run api:dev',
      cwd: '..',
      port: API_PORT,
      env: { LAZARUS_RUNNER: 'docker', LAZARUS_API_HOST: API_HOST, LAZARUS_API_PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      env: { LAZARUS_API_HOST: API_HOST, LAZARUS_API_PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
