import { defineConfig, devices } from '@playwright/test';

/**
 * Lab scene frame-time and flicker measurements (task 19, Requirement 9.4), against a
 * production build. `--mode perf` differs from a normal build only by exposing the proof
 * store on `window`, so the run can drive the scene's moods (see LabScene.tsx).
 *
 * Run: `npm run perf:scene -w web`. Not part of the e2e suite: the numbers depend on
 * the machine, and the run takes about a minute. Results: perf/results/*.json (gitignored).
 *
 * `--use-angle=metal` gives headless Chromium the real GPU on macOS (otherwise it falls
 * back to SwiftShader, a software renderer). The test prints the renderer it got.
 */
const PORT = 4174;
const GPU_ARGS = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'];
/**
 * `PERF_UNCAPPED=1`: no vsync and no frame rate limit, so frame times show the real cost
 * of a frame (headroom) instead of the 16.7 ms display interval.
 */
const UNCAPPED_ARGS = process.env.PERF_UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];

export default defineConfig({
  testDir: '.',
  testMatch: '*.perf.ts',
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: [...GPU_ARGS, ...UNCAPPED_ARGS] },
      },
    },
  ],
  webServer: {
    command: `npx vite build --mode perf --outDir perf/dist --emptyOutDir && npx vite preview --outDir perf/dist --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
