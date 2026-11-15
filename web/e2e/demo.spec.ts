import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, test as base } from './fixtures';
import { MUTANTS } from '../../src/ports/payroll.mutants';

/**
 * graphical-proof task 19.4 (Requirements 11.2, 11.3, 11.4, 11.6, 11.10 and 13.3): Demo_Mode
 * tells the PAYROLL story from recordings without the Proof_API.
 *
 * - One run of the whole story at its normal pace (1920×1080, motion on), which also checks
 *   the 130 s total (11.12) and the stitch and digit-inspector cues in order.
 * - The same steps walked with "Skip step" at 1920×1080 with reduced motion, and at 390×844
 *   with motion on and off, asserting each step's labels and visuals (and no sideways scroll
 *   on mobile).
 * - The "Run the demo" links on the landing page and the morgue, and Pause, Resume and Exit
 *   from the keyboard.
 *
 * Every request to `/api/` is aborted and fails the test (11.3), and so does any console
 * error or uncaught page error.
 */

const test = base.extend<{ guard: void }>({
  guard: [
    async ({ context }, use) => {
      const apiCalls: string[] = [];
      const errors: string[] = [];
      await context.route(/\/api\//, (route) => {
        apiCalls.push(`${route.request().method()} ${route.request().url()}`);
        return route.abort('blockedbyclient');
      });
      context.on('console', (m) => {
        if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
      });
      context.on('weberror', (e) => errors.push(`[pageerror] ${e.error().message}`));
      await use();
      expect(apiCalls, 'Demo_Mode must make no request to the Proof_API (11.3)').toEqual([]);
      expect(errors, 'browser console errors').toEqual([]);
    },
    { auto: true },
  ],
});

const DEMO_URL = /\/program\/PAYROLL\?demo=1$/;
const DESKTOP = { width: 1920, height: 1080 } as const;
const MOBILE = { width: 390, height: 844 } as const;

const halfUpTax = MUTANTS.find((m) => m.id === 'half-up-tax');
if (!halfUpTax) throw new Error('PAYROLL mutant half-up-tax not found');

/** The result of a committed recording, read the way the app reads it (the last event). */
function recorded(file: string): { durationMs: number; generatedAt: string } {
  const json = JSON.parse(readFileSync(new URL(`../public/recorded/${file}`, import.meta.url), 'utf8')) as {
    events: { type: string; result?: { durationMs: number; generatedAt: string } }[];
  };
  const last = json.events.at(-1);
  if (last?.type !== 'result' || !last.result) throw new Error(`${file}: no result event`);
  return last.result;
}
const REAL = recorded('PAYROLL.json');
const MUTANT = recorded('PAYROLL.half-up-tax.json');
/** proofMessages.ts DATE_FORMAT and DemoBar.tsx rateText, computed here from the files. */
const date = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
const slow = (speed: number, ms: number) => `Slow motion, 1/${speed} speed. The real run took ${(ms / 1000).toFixed(2)} s.`;

type StepId = 'program' | 'stitches' | 'prove-real' | 'sabotage' | 'prove-mutant' | 'shrink' | 'autopsy' | 'revive';
/** demoScript.ts, in order, with each step's duration at the normal pace. */
const STEPS: readonly (readonly [StepId, number])[] = [
  ['program', 8_000],
  ['stitches', 22_000],
  ['prove-real', 40_000],
  ['sabotage', 4_000],
  ['prove-mutant', 6_000],
  ['shrink', 10_000],
  ['autopsy', 20_000],
  ['revive', 20_000],
];

interface Mode {
  readonly reduced: boolean;
  readonly mobile: boolean;
  /** Normal pace: let each step run out instead of skipping it. */
  readonly full: boolean;
}

function parts(page: Page) {
  const bar = page.getByTestId('demo-bar');
  return {
    bar,
    rate: bar.getByTestId('demo-rate'),
    status: page.getByRole('region', { name: 'Prove it' }).getByTestId('proof-status'),
    heartbeat: page.getByTestId('heartbeat'),
    grid: page.getByTestId('case-grid'),
    fill: page.getByTestId('resurrection-fill'),
    card: page.getByTestId('counterexample-card'),
  };
}

async function expectNoSidewaysScroll(page: Page, where: string) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `horizontal scroll at ${where}`).toBeLessThanOrEqual(innerWidth);
}

/** Labels every step shows (11.4): "Demo: recorded replay", and "Recorded" with the recording's date. */
async function expectLabels(bar: Locator) {
  await expect(bar.getByText('Demo: recorded replay', { exact: true })).toBeVisible();
  const recordedLabel = bar.getByTestId('demo-recorded');
  await expect(recordedLabel).toContainText('Recorded');
  await expect(recordedLabel).toContainText(date(REAL.generatedAt));
}

/** What a step shows while it is current. Holds early in the step, so it suits both paces. */
async function duringStep(page: Page, id: StepId, mode: Mode) {
  const p = parts(page);
  switch (id) {
    case 'program':
      await expect(page.getByRole('heading', { level: 1, name: 'PAYROLL' })).toBeVisible();
      await expect(page.getByTestId('source-panes')).toBeVisible();
      await expect(p.status).toHaveText('Not yet proven');
      return;
    case 'stitches':
      await expect(p.bar).toHaveAttribute('data-demo-beat', 'field:IN-HOURS');
      return;
    case 'prove-real':
      await expect(p.rate).toHaveText(slow(40, REAL.durationMs));
      // 13.3: the Prove panel shows "Recorded" with the date while a recording plays.
      await expect(page.getByTestId('proof-recorded')).toContainText(date(REAL.generatedAt));
      // Heartbeat mid-run, and the static forms under reduced motion (11.10, 14.3).
      await expect(p.heartbeat).toHaveAttribute('data-demo-beat', 'heartbeat');
      await expect(p.heartbeat).toHaveAttribute('data-motion', mode.reduced ? 'reduced' : 'full');
      await expect(p.grid).toHaveAttribute('data-motion', mode.reduced ? 'reduced' : 'full');
      if (mode.reduced) await expect(page.getByTestId('case-grid-caption')).toContainText('With reduced motion the grid is drawn');
      return;
    case 'sabotage': {
      const sabotage = page.getByRole('region', { name: 'Sabotage the port' });
      await expect(sabotage.getByRole('radio', { name: halfUpTax!.title })).toBeChecked();
      await expect(page.getByTestId('mutant-diff')).toBeVisible();
      return;
    }
    case 'prove-mutant':
      await expect(p.rate).toHaveText(slow(40, MUTANT.durationMs));
      await expect(p.bar.getByTestId('demo-recorded')).toContainText(date(MUTANT.generatedAt));
      await expect(p.heartbeat).toHaveAttribute('data-mode', 'flatline');
      return;
    case 'shrink': {
      const viewer = page.getByTestId('shrink-viewer');
      await expect(viewer).toBeVisible();
      // Reduced motion: no animated stage, the step list instead (14.3).
      if (mode.reduced) {
        await expect(viewer.getByTestId('shrink-stage')).toHaveCount(0);
        await expect(viewer.getByTestId('shrink-list')).not.toHaveClass(/sr-only/);
      } else {
        await expect(viewer.getByTestId('shrink-stage')).toBeVisible();
        await expect(viewer.getByTestId('shrink-list')).toHaveClass(/sr-only/);
      }
      return;
    }
    case 'autopsy': {
      await expect(p.card.getByTestId('autopsy')).toBeVisible();
      await expect(p.card.getByTestId('autopsy-fields').locator('[data-field="OUT-TAX"]')).toBeVisible();
      const inspector = p.card.getByTestId('digit-inspector');
      await expect(inspector.getByRole('radio', { name: /OUT-TAX/ })).toBeChecked();
      await expect(inspector.locator('[data-testid="digit-table"] [data-differs]').first()).toBeVisible();
      return;
    }
    case 'revive':
      await expect(p.rate).toHaveText(slow(20, REAL.durationMs));
      return;
  }
}

/** What a replaying step leaves on screen once its replay has ended. */
async function afterStep(page: Page, id: StepId, mode: Mode) {
  const p = parts(page);
  switch (id) {
    case 'prove-real':
    case 'revive':
      await expect(p.status).toHaveText('Alive');
      await expect(p.heartbeat).toHaveAttribute('data-mode', 'steady');
      await expect(page.getByTestId('heartbeat-label')).toHaveText('✓ 2,000 / 2,000 matched');
      await expect(p.grid).toHaveAttribute('data-demo-beat', 'grid-alive');
      await expect(p.fill).toHaveAttribute('data-demo-beat', 'all-passed');
      if (id === 'revive' && mode.reduced) await expect(page.getByTestId('resurrection-fill-revived')).toHaveText('Revived ✓');
      return;
    case 'prove-mutant':
      await expect(p.status).toHaveText('Relapsed');
      await expect(p.heartbeat).toHaveAttribute('data-mode', 'flatline');
      await expect(page.getByTestId('heartbeat-label')).toContainText('✗');
      await expect(p.grid).toHaveAttribute('data-status', 'relapsed');
      await expect(p.grid).not.toHaveAttribute('data-failed-index', '');
      return;
    default:
      return;
  }
}

/** Walk the whole story, by "Skip step" or at normal pace. Returns ms from the first step to the end. */
async function walkDemo(page: Page, mode: Mode): Promise<number> {
  const { bar } = parts(page);
  await expect(bar).toHaveAttribute('data-demo-step', 'program', { timeout: 15_000 });
  const started = Date.now();
  let previous: StepId | null = null;
  let previousMs = 0;
  for (const [id, durationMs] of STEPS) {
    // At normal pace a step starts when the one before it has run out.
    await expect(bar).toHaveAttribute('data-demo-step', id, { timeout: previousMs + 10_000 });
    if (previous) await afterStep(page, previous, mode);
    await expectLabels(bar);
    await duringStep(page, id, mode);
    if (mode.mobile) await expectNoSidewaysScroll(page, `step ${id}`);
    if (mode.full) await fullPaceCues(page, id);
    else await bar.getByRole('button', { name: 'Skip step' }).click();
    previous = id;
    previousMs = mode.full ? durationMs : 0;
  }
  await expect(bar).toHaveAttribute('data-demo-state', 'done', { timeout: 30_000 });
  const elapsed = Date.now() - started;
  await afterStep(page, 'revive', mode);
  await expect(bar.getByTestId('demo-caption')).toHaveText('The demo has finished. Exit to use the lab yourself.');
  if (mode.mobile) await expectNoSidewaysScroll(page, 'the end');
  return elapsed;
}

/** At normal pace, the timed cues each step moves through (demoScript.ts). */
async function fullPaceCues(page: Page, id: StepId) {
  const { bar } = parts(page);
  const beats: Partial<Record<StepId, readonly string[]>> = {
    stitches: ['field:IN-RATE', 'field:WS-GROSS', 'field:OUT-GROSS', 'field:OUT-TAX', 'statement:4'],
    autopsy: ['inspect:OUT-TAX'],
  };
  for (const beat of beats[id] ?? []) await expect(bar).toHaveAttribute('data-demo-beat', beat, { timeout: 10_000 });
}

test.describe('demo at 1920×1080, motion on', () => {
  test.use({ viewport: DESKTOP, reducedMotion: 'no-preference' });

  test('the landing page link runs the whole story at its normal pace in 130 s', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await page.getByRole('link', { name: 'Run the demo' }).click();
    await expect(page).toHaveURL(DEMO_URL);
    const elapsed = await walkDemo(page, { reduced: false, mobile: false, full: true });
    test.info().annotations.push({ type: 'demo duration', description: `${(elapsed / 1000).toFixed(1)} s` });
    // 11.12: 130 s ± 5 s; the step changes are observed by polling, so allow a little slack above.
    expect(elapsed).toBeGreaterThanOrEqual(125_000);
    expect(elapsed).toBeLessThanOrEqual(136_000);
  });

  test('needs nothing more from the server once it has started, and draws the empty grid at once', async ({ page }) => {
    // A dev server stopped mid-demo accepts requests and never answers. From the first step
    // on, every recording request here does the same.
    let started = false;
    const late: string[] = [];
    await page.route(/\/recorded\//, (route) => {
      if (!started) return route.continue();
      late.push(route.request().url());
      return undefined; // never answered
    });
    await page.goto('/program/PAYROLL?demo=1');
    const { bar, grid, status } = parts(page);
    await expect(bar).toHaveAttribute('data-demo-step', 'program', { timeout: 15_000 });
    started = true;
    await bar.getByRole('button', { name: 'Pause' }).click();
    const skip = bar.getByRole('button', { name: 'Skip step' });
    await skip.click();
    await expect(bar).toHaveAttribute('data-demo-step', 'stitches');
    await skip.click();
    // Paused at the start of prove-real: no case has run, and all 2,000 cells are drawn as not run.
    await expect(bar).toHaveAttribute('data-demo-step', 'prove-real');
    await expect(grid).toHaveAttribute('data-not-run', '2000');
    await expect(grid).toHaveAttribute('data-passed', '0');
    const painted = await page.getByTestId('case-grid-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) opaque++;
      return opaque;
    });
    expect(painted, 'grey not-run cells on the canvas').toBeGreaterThan(0);
    await bar.getByRole('button', { name: 'Resume' }).click();
    for (const [id] of STEPS.slice(2)) {
      await expect(bar).toHaveAttribute('data-demo-step', id);
      await skip.click();
    }
    await expect(bar).toHaveAttribute('data-demo-state', 'done');
    await expect(status).toHaveText('Alive');
    expect(late, 'recording requests after the demo started').toEqual([]);
  });
  test('Pause, Resume and Exit work from the keyboard', async ({ page }) => {
    await page.goto('/program/PAYROLL?demo=1');
    const { bar, heartbeat } = parts(page);
    await expect(bar).toHaveAttribute('data-demo-step', 'program', { timeout: 15_000 });
    const skip = bar.getByRole('button', { name: 'Skip step' });
    await skip.click();
    await skip.click();
    await expect(bar).toHaveAttribute('data-demo-step', 'prove-real');
    await expect(heartbeat).toHaveAttribute('data-demo-beat', 'heartbeat');

    // From the clicked Skip button, the keyboard takes over.
    const exit = bar.getByRole('button', { name: 'Exit demo' });
    const pause = bar.getByRole('button', { name: 'Pause' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(pause).toBeFocused();
    expect(await pause.evaluate((el) => el.matches(':focus-visible'))).toBe(true);

    // 11.7: paused, the replay holds where it is.
    await page.keyboard.press('Enter');
    await expect(bar).toHaveAttribute('data-demo-state', 'paused');
    const resume = bar.getByRole('button', { name: 'Resume' });
    await expect(resume).toBeFocused();
    const label = page.getByTestId('heartbeat-label');
    const held = await label.textContent();
    await page.waitForTimeout(1_500);
    await expect(label).toHaveText(held ?? '');
    await expect(bar).toHaveAttribute('data-demo-step', 'prove-real');
    await page.keyboard.press('Space');
    await expect(bar).toHaveAttribute('data-demo-state', 'running');
    await expect(label).not.toHaveText(held ?? '');

    // 11.8: Exit stops the demo, resets the proof and focuses the heading.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(exit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(bar).toHaveCount(0);
    await expect(page).toHaveURL(/\/program\/PAYROLL$/);
    await expect(page.getByRole('heading', { level: 1, name: 'PAYROLL' })).toBeFocused();
    await expect(parts(page).status).toHaveText('Not yet proven');
  });
});

for (const mode of [
  { name: '1920×1080, reduced motion', viewport: DESKTOP, reduced: true },
  { name: '390×844, motion on', viewport: MOBILE, reduced: false },
  { name: '390×844, reduced motion', viewport: MOBILE, reduced: true },
] as const) {
  test.describe(`demo at ${mode.name}`, () => {
    test.use({ viewport: mode.viewport, reducedMotion: mode.reduced ? 'reduce' : 'no-preference' });

    test('Skip step walks every step with its labels and visuals', async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto(mode.viewport === MOBILE ? '/morgue' : '/');
      if (mode.viewport === MOBILE) await expectNoSidewaysScroll(page, 'the morgue');
      // 11.1: the morgue link on mobile, the landing page link on desktop.
      await page.getByRole('link', { name: 'Run the demo' }).click();
      await expect(page).toHaveURL(DEMO_URL);
      await walkDemo(page, { reduced: mode.reduced, mobile: mode.viewport === MOBILE, full: false });
    });
  });
}
