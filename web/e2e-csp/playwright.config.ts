import { defineConfig, devices } from '@playwright/test';

/**
 * Task 21: the e2e suite against the production build, served with the exact
 * CloudFront security headers (CSP included) and SPA rewrite (serve-dist.ts),
 * plus csp.spec.ts, which fails on any CSP violation.
 *
 * Needs Docker and `lazarus-gnucobol:3.1.2`, like the dev e2e. Run with
 * `npm run test:e2e:csp -w web`. The web server step rebuilds web/dist first.
 */
const API_HOST = '127.0.0.1';
const API_PORT = 8787; // src/api/dev-server.ts DEFAULT_PORT
const WEB_PORT = 4175;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'csp', testDir: '.', testMatch: '*.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'e2e-under-csp', testDir: '../e2e', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'npm run api:dev',
      cwd: '../..',
      port: API_PORT,
      env: { LAZARUS_RUNNER: 'docker', LAZARUS_API_HOST: API_HOST, LAZARUS_API_PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npx vite build && npx tsx e2e-csp/serve-dist.ts',
      cwd: '..',
      url: WEB_URL,
      env: { LAZARUS_CSP_PORT: String(WEB_PORT), LAZARUS_API_HOST: API_HOST, LAZARUS_API_PORT: String(API_PORT) },
      // Always rebuild and restart: a stale build would test the wrong bundle.
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
