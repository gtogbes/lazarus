import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
/**
 * Frame rate and long tasks while the demo's `prove-real` step replays the real PAYROLL
 * port with the Visuals and the lab scene on screen (graphical-proof task 23.3,
 * Requirement 15.2): an average of at least 55 fps and no long task over 50 ms.
 *
 * The demo (/program/PAYROLL?demo=1) is skipped to `prove-real` once the scene has loaded,
 * then the whole 40 s step is measured: requestAnimationFrame timestamps for the frame
 * rate, and a `longtask` PerformanceObserver (a long task is one over 50 ms, so any entry
 * fails the check).
 *
 * The requirement names a mid-range laptop. The owner's laptop is the reference machine
 * (tasks.md, notes); it is faster than a mid-range one, so the step also runs under 4x CPU
 * throttling, reported but not asserted. CI timing is not trusted.
 *
 * Run: `npx playwright test -c perf/playwright.config.ts vitals.perf.ts` from web/ (also
 * part of `npm run perf:scene -w web`). Results: perf/results/vitals.json (gitignored).
 */
const STEP = 'prove-real';
const VIEWPORT = { width: 1920, height: 1080 } as const;
export const MIN_AVERAGE_FPS = 55;
export const LONG_TASK_MS = 50;
interface LongTask {
  /** ms from the step's start. */
  readonly atMs: number;
  readonly durationMs: number;
}
type VitalsWindow = Window & { __longTasks?: { start: number; duration: number }[] };
const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('perf/results', { recursive: true });
  writeFileSync('perf/results/vitals.json', `${JSON.stringify(results, null, 2)}\n`);
});
test.use({ viewport: VIEWPORT, deviceScaleFactor: 1 });
test.beforeEach(async ({ page }) => {
  // Buffered from the first script, so nothing between navigation and the measurement is lost.
  await page.addInitScript(() => {
    const w = window as VitalsWindow;
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks?.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  });
});
async function renderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
}
/** Opens the demo with the scene running, then skips to the step under test. */
async function openDemoAtStep(page: Page, cpuThrottle: number) {
  const glb = page.waitForResponse((r) => r.url().endsWith('/models/lab.glb'));
  await page.goto('/program/PAYROLL?demo=1');
  await glb;
  await expect(page.getByTestId('lab-scene-layer')).toHaveAttribute('data-scene', 'canvas');
  await expect(page.getByTestId('lab-scene-layer').locator('canvas')).toHaveCount(1);
  const bar = page.getByTestId('demo-bar');
  await expect(bar).toHaveAttribute('data-demo-step', 'program', { timeout: 15_000 });
  // Decode, shader compile and the first frames, as in scene.perf.ts.
  await page.waitForTimeout(2000);
  const before = await busyMs(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  // Shows the throttling took effect: the same work, timed again.
  const slowdown = round((await busyMs(page)) / before, 1);
  for (let i = 0; i < 4 && (await bar.getAttribute('data-demo-step')) !== STEP; i++) {
    await bar.getByRole('button', { name: 'Skip step' }).click();
  }
  await expect(bar).toHaveAttribute('data-demo-step', STEP);
  return { slowdown };
}
/** Main-thread time for a fixed piece of work. */
async function busyMs(page: Page): Promise<number> {
  return page.evaluate(() => {
    const t0 = performance.now();
    let x = 0;
    for (let i = 0; i < 2e7; i++) x = (x + i * 7) % 1_000_003;
    return Math.max(1, performance.now() - t0 + (x < 0 ? 1 : 0));
  });
}
/** rAF timestamps and long tasks from now until the demo bar leaves the step. */
async function measureStep(page: Page) {
  return page.evaluate(
    ({ step, capMs }) =>
      new Promise<{ stamps: number[]; longTasks: LongTask[]; sawVisuals: boolean }>((resolve) => {
        const bar = document.querySelector('[data-testid="demo-bar"]');
        const t0 = performance.now();
        const stamps: number[] = [];
        let sawVisuals = false;
        const tick = (now: number) => {
          stamps.push(now);
          sawVisuals ||= document.querySelector('[data-testid="heartbeat"][data-mode="beating"]') !== null;
          if (bar?.getAttribute('data-demo-step') === step && now - t0 < capMs) {
            requestAnimationFrame(tick);
            return;
          }
          const w = window as VitalsWindow;
          const longTasks = (w.__longTasks ?? [])
            .filter((t) => t.start + t.duration > t0 && t.start < now)
            .map((t) => ({ atMs: Math.round(t.start - t0), durationMs: Math.round(t.duration) }));
          resolve({ stamps, longTasks, sawVisuals });
        };
        requestAnimationFrame(tick);
      }),
    { step: STEP, capMs: 60_000 },
  );
}
function round(n: number, digits = 1) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
function frameStats(stamps: readonly number[]) {
  const deltas = stamps.slice(1).map((s, i) => s - (stamps[i] ?? s));
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const spanMs = (stamps.at(-1) ?? 0) - (stamps[0] ?? 0);
  const medianMs = at(0.5);
  const p95Ms = at(0.95);
  return {
    frames: deltas.length,
    spanS: round(spanMs / 1000, 2),
    averageFps: round((deltas.length * 1000) / spanMs),
    medianFps: round(1000 / medianMs),
    /** The frame rate the slowest 5% of frames fall below: 1000 / p95 frame time. */
    p95Fps: round(1000 / p95Ms),
    medianMs: round(medianMs),
    p95Ms: round(p95Ms),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}
for (const cpuThrottle of [1, 4]) {
  const asserted = cpuThrottle === 1;
  const name = `${STEP}, ${VIEWPORT.width}x${VIEWPORT.height} dpr 1, cpu ${cpuThrottle}x${asserted ? '' : ' (reported only)'}`;
  test(name, async ({ page }) => {
    const { slowdown } = await openDemoAtStep(page, cpuThrottle);
    const { stamps, longTasks, sawVisuals } = await measureStep(page);
    const frames = frameStats(stamps);
    const result = { renderer: await renderer(page), measuredCpuSlowdown: slowdown, sawVisuals, ...frames, longTasks };
    results[name] = result;
    console.log(name, JSON.stringify(result));
    expect(sawVisuals, 'the heartbeat beats during the step (the replay ran)').toBe(true);
    expect(frames.spanS, 'the whole 40 s step was measured').toBeGreaterThan(35);
    if (!asserted) return;
    expect(frames.averageFps, `average fps during ${STEP}`).toBeGreaterThanOrEqual(MIN_AVERAGE_FPS);
    expect(longTasks, `long tasks (over ${LONG_TASK_MS} ms) during ${STEP}`).toEqual([]);
  });
}
