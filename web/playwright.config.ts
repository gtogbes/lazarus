import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real proof API and real GnuCOBOL (docker runner).
 * Needs Docker running and the `lazarus-gnucobol:3.1.2` image (`npm run cobol:image`).
 * Run with `npm run test:e2e -w web`. Not part of `npm test -w web` (Vitest), which stays Docker-free.
 *
 * `E2E_BASE_URL=https://lab.example.com` (the deployed site's URL) runs the specs against a deployed site instead and
 * starts no local servers. The hosted proof API has reserved concurrency 1, so keep one worker
 * and pick specs with care (no perf or video runs against production).
 */
const API_HOST = '127.0.0.1';
const API_PORT = 8787; // src/api/dev-server.ts DEFAULT_PORT; vite.config.ts proxies /api here.
const WEB_PORT = 5173;
const LIVE_URL = process.env.E2E_BASE_URL;
const LOCAL_URL = `http://127.0.0.1:${WEB_PORT}`;
const WEB_URL = LIVE_URL ?? LOCAL_URL;

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
  webServer: LIVE_URL ? [] : [
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
      url: LOCAL_URL,
      env: { LAZARUS_API_HOST: API_HOST, LAZARUS_API_PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
