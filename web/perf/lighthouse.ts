/**
 * Lighthouse against the production build, served locally with the CloudFront headers
 * (CSP included) and gzip by e2e-csp/serve-dist.ts (task 23, Requirement 9.3).
 *
 * Budget, asserted on the "laptop, fast 4G" profile for every page:
 * - Largest Contentful Paint under 2.5 s;
 * - initial JavaScript under 200 KB gzipped, 3D excluded (the scene chunk and the Draco
 *   decoder load after the 2D interface is interactive, Requirement 7.1).
 * The Lighthouse mobile default (slow 4G, 4x CPU, Moto G Power screen) is also reported,
 * not asserted: it is stricter than the requirement.
 *
 * Simulated throttling on this machine is a lab estimate, not a field measurement.
 *
 * Run: `npm run perf:lighthouse -w web` (builds web/dist first). Results: perf/results/lighthouse.json.
 */
import { chromium } from '@playwright/test';
import lighthouse, { defaultConfig, desktopConfig, type Config, type Result } from 'lighthouse';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4176;
const DEBUG_PORT = 9333;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PAGES = ['/', '/morgue', '/program/PAYROLL'] as const;
const GPU_ARGS = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'];

export const LCP_BUDGET_MS = 2500;
export const INITIAL_JS_BUDGET_BYTES = 200 * 1000;
/** Loaded after the 2D interface is interactive, so not initial JS (Requirement 9.3). */
const DEFERRED_3D = /\/assets\/(LabScene|draco_)[^/]*$/;

/**
 * "Laptop, fast 4G": Chrome DevTools' Fast 4G preset (9 Mbps down, 1.5 Mbps up, 60 ms
 * latency with DevTools' 2.75x request-latency factor, 165 ms per request) and 2x CPU
 * slowdown, a rough step from this M5 Pro down to a mid-range laptop.
 */
const LAPTOP_FAST_4G: Config = {
  ...desktopConfig,
  settings: {
    ...desktopConfig.settings,
    throttlingMethod: 'simulate',
    throttling: {
      rttMs: 60,
      throughputKbps: 9000,
      requestLatencyMs: 165,
      downloadThroughputKbps: 9000 * 0.9,
      uploadThroughputKbps: 1500 * 0.9,
      cpuSlowdownMultiplier: 2,
    },
  },
};

const PROFILES = [
  { name: 'laptop, fast 4G', config: LAPTOP_FAST_4G, asserted: true },
  { name: 'Lighthouse mobile default (slow 4G, 4x CPU)', config: defaultConfig, asserted: false },
] as const;

interface PageResult {
  readonly profile: string;
  readonly page: string;
  readonly lcpMs: number;
  readonly cls: number;
  readonly tbtMs: number;
  readonly performance: number;
  readonly accessibility: number;
  readonly initialJsGzipBytes: number;
  readonly initialJs: readonly string[];
}

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${url} did not start`);
}

/** Gzipped size of a built file, from web/dist (the same bytes the server sends). */
function gzipBytes(pathname: string): number {
  return gzipSync(readFileSync(`${WEB}dist${pathname}`)).length;
}

function initialScripts(lhr: Result): string[] {
  const items = (lhr.audits['network-requests']?.details as { items?: { url: string; resourceType?: string }[] } | undefined)?.items ?? [];
  return items
    .filter((i) => i.resourceType === 'Script' && i.url.startsWith(ORIGIN))
    .map((i) => new URL(i.url).pathname)
    .filter((p) => !DEFERRED_3D.test(p));
}

function summarise(profile: string, page: string, lhr: Result): PageResult {
  const num = (id: string) => lhr.audits[id]?.numericValue ?? Number.NaN;
  const scripts = initialScripts(lhr);
  return {
    profile,
    page,
    lcpMs: Math.round(num('largest-contentful-paint')),
    cls: Math.round(num('cumulative-layout-shift') * 1000) / 1000,
    tbtMs: Math.round(num('total-blocking-time')),
    performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
    accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
    initialJsGzipBytes: scripts.reduce((sum, p) => sum + gzipBytes(p), 0),
    initialJs: scripts,
  };
}

async function main(): Promise<void> {
  if (!process.argv.includes('--no-build')) {
    const build = spawnSync('npx', ['vite', 'build'], { cwd: WEB, stdio: 'inherit' });
    if (build.status !== 0) throw new Error('vite build failed');
  }
  const server = spawn('npx', ['tsx', 'e2e-csp/serve-dist.ts'], {
    cwd: WEB,
    env: { ...process.env, LAZARUS_CSP_PORT: String(PORT) },
    stdio: 'ignore',
    detached: true, // own process group, so npx and the server under it stop together
  });
  const results: PageResult[] = [];
  // Playwright's pinned Chromium (headless shell), driven by Lighthouse over the debugging port.
  // With the real GPU, as in perf/playwright.config.ts: without it the landing page's scene renders
  // in SwiftShader (software) and its frames show up as seconds of blocking time no laptop has.
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${DEBUG_PORT}`, ...GPU_ARGS] }).catch((e: unknown) => {
    if (server.pid) process.kill(-server.pid);
    throw e;
  });
  try {
    await waitForServer(`${ORIGIN}/`);
    for (const { name, config } of PROFILES) {
      for (const page of PAGES) {
        const run = await lighthouse(
          `${ORIGIN}${page}`,
          { port: DEBUG_PORT, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility'] },
          config,
        );
        if (!run) throw new Error(`Lighthouse returned nothing for ${page}`);
        if (run.lhr.runtimeError) throw new Error(`${page}: ${run.lhr.runtimeError.message}`);
        results.push(summarise(name, page, run.lhr));
      }
    }
  } finally {
    await browser.close();
    if (server.pid) process.kill(-server.pid);
  }

  mkdirSync(`${WEB}perf/results`, { recursive: true });
  writeFileSync(`${WEB}perf/results/lighthouse.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.table(
    results.map((r) => ({
      profile: r.profile,
      page: r.page,
      'LCP ms': r.lcpMs,
      CLS: r.cls,
      'TBT ms': r.tbtMs,
      perf: r.performance,
      a11y: r.accessibility,
      'initial JS KB gz': Math.round(r.initialJsGzipBytes / 100) / 10,
    })),
  );

  const failures = results
    .filter((r) => PROFILES.find((p) => p.name === r.profile)?.asserted)
    .flatMap((r) => [
      ...(r.lcpMs < LCP_BUDGET_MS ? [] : [`${r.page}: LCP ${r.lcpMs} ms is not under ${LCP_BUDGET_MS} ms`]),
      ...(r.initialJsGzipBytes < INITIAL_JS_BUDGET_BYTES
        ? []
        : [`${r.page}: initial JS ${r.initialJsGzipBytes} B gzipped is not under ${INITIAL_JS_BUDGET_BYTES} B`]),
      ...(r.initialJs.length > 0 ? [] : [`${r.page}: no initial scripts found, the budget check is not measuring anything`]),
    ]);
  if (failures.length > 0) {
    console.error(`Budget failed (Requirement 9.3):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Budget met (Requirement 9.3): LCP < ${LCP_BUDGET_MS} ms and initial JS < 200 KB gzipped on every page.`);
  }
}

await main();
