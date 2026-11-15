import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { MUTANTS } from '../../src/ports/payroll.mutants';

/**
 * Task 23, Requirement 9.2, in a real browser: status changes are announced through a
 * polite live region, and progress no more than once every 5 s.
 */

const PROOF_TIMEOUT = 60_000;
const INTERVAL_MS = 5000; // PROGRESS_ANNOUNCE_INTERVAL_MS in ProofAnnouncer.tsx
/** Timer jitter allowance when checking the 5 s spacing. */
const SLACK_MS = 150;
const halfUpTax = MUTANTS.find((m) => m.id === 'half-up-tax');
if (!halfUpTax) throw new Error('PAYROLL mutant half-up-tax not found');

interface Announcement {
  readonly t: number;
  readonly text: string;
}

/** Records every text change of the proof live region, with a page timestamp. */
async function recordAnnouncements(page: Page): Promise<() => Promise<Announcement[]>> {
  await page.addInitScript(() => {
    const log: { t: number; text: string }[] = [];
    (window as Window & { __announcements?: typeof log }).__announcements = log;
    new MutationObserver(() => {
      const region = document.querySelector('[data-testid="proof-announcer"]');
      const text = region?.textContent ?? '';
      if (region && text !== (log.at(-1)?.text ?? '')) log.push({ t: performance.now(), text });
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as Window & { __announcements?: Announcement[] }).__announcements ?? []);
}

async function openPayroll(page: Page) {
  await page.goto('/program/PAYROLL');
  await expect(page.getByRole('heading', { level: 1, name: 'PAYROLL' })).toBeVisible();
  const prove = page.getByRole('region', { name: 'Prove it' });
  const region = prove.getByTestId('proof-announcer');
  // Present and empty before anything happens, so screen readers pick up the first change.
  await expect(region).toHaveAttribute('role', 'status');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveText('');
  return { prove, status: prove.getByTestId('proof-status') };
}

test('a live proof announces its start and its result', async ({ page }) => {
  const announcements = await recordAnnouncements(page);
  const { prove, status } = await openPayroll(page);
  await prove.getByRole('button', { name: 'Prove it' }).click();
  await expect(status).toHaveText('Alive', { timeout: PROOF_TIMEOUT });
  const texts = (await announcements()).map((a) => a.text);
  expect(texts[0]).toBe('Proof started for PAYROLL.');
  expect(texts.at(-1)).toMatch(/^PAYROLL is alive: [\d,]+ cases matched GnuCOBOL\.$/);
});

test('progress is announced at most once every 5 s while the counters update at 4 Hz', async ({ page }, testInfo) => {
  // Needs a run longer than 5 s; real local runs finish in under a second. The proof
  // request is held open (the store really is reanimating, through start()), and the
  // counters are fed at 4 Hz through the store, as the NDJSON client does. The store is
  // reached through its dev-server module URL, so this runs against the dev build only.
  test.skip(testInfo.project.name !== 'chromium', 'needs the Vite dev server module graph');
  // Show the still, not the full-viewport scene: headless Chromium renders WebGL on the
  // CPU, which slows the 250 ms feed loop below 4 Hz. The scene is not under test here.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const announcements = await recordAnnouncements(page);
  const { prove, status } = await openPayroll(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/prove', async (route) => {
    await held;
    await route.continue();
  });
  await prove.getByRole('button', { name: 'Prove it' }).click();
  await expect(status).toHaveText('Reanimating…');

  const feedMs = 2 * INTERVAL_MS + 1500;
  const visibleUpdates = await page.evaluate(async ([ms, storeUrl]) => {
    // The same module instance the app uses: Vite serves each module once per URL.
    const { useProofRun } = (await import(storeUrl)) as {
      useProofRun: { setState(s: Record<string, unknown>): void };
    };
    const cell = document.querySelector('[data-testid="proof-executions"]');
    const seen = new Set<string>();
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const elapsedMs = Math.round(performance.now() - t0);
      useProofRun.setState({ executions: Math.round(elapsedMs * 0.8), elapsedMs });
      await new Promise((r) => setTimeout(r, 250));
      seen.add(cell?.textContent ?? '');
    }
    return seen.size;
  }, [feedMs, '/src/features/proof/useProofRun.ts'] as const);
  release();
  await expect(status).toHaveText('Alive', { timeout: PROOF_TIMEOUT });

  const log = await announcements();
  const start = log.find((a) => a.text === 'Proof started for PAYROLL.');
  expect(start, JSON.stringify(log)).toBeDefined();
  const progress = log.filter((a) => / cases run, .* seconds elapsed\.$/.test(a.text));
  // 11.5 s of updates at 4 Hz (about 46 visible changes) give exactly two announcements.
  expect(visibleUpdates).toBeGreaterThan(30);
  expect(progress, JSON.stringify(log)).toHaveLength(2);
  let previous = start?.t ?? 0;
  testInfo.annotations.push({
    type: 'announcements',
    description: log.map((a) => `+${Math.round(a.t - (start?.t ?? 0))} ms: ${a.text}`).join(' | '),
  });
  for (const p of progress) {
    expect(p.t - previous).toBeGreaterThanOrEqual(INTERVAL_MS - SLACK_MS);
    previous = p.t;
  }
  expect(log.at(-1)?.text).toMatch(/^PAYROLL is alive: /);
});

/**
 * graphical-proof Requirement 14.6: the Visuals and Demo_Mode add no live region. The
 * page keeps the proof announcer, plus the Copy command status inside the counterexample
 * card (reanimation-lab, unchanged).
 */
async function liveRegions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"], [role="marquee"], [role="timer"], output',
      ),
    ]
      .map((el) => el.getAttribute('data-testid') ?? `<${el.tagName.toLowerCase()} ${el.outerHTML.slice(0, 80)}>`)
      .sort(),
  );
}
test('the new visuals add no live region: running, Relapsed with the card, Alive after Revive', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { prove, status } = await openPayroll(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/prove', async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole('region', { name: 'Sabotage the port' }).getByRole('radio', { name: halfUpTax.title }).check();
  await prove.getByRole('button', { name: 'Prove it' }).click();
  await expect(page.getByTestId('vitals-panel')).toBeVisible();
  expect(await liveRegions(page), 'running').toEqual(['proof-announcer']);
  release();
  await expect(status).toHaveText('Relapsed', { timeout: PROOF_TIMEOUT });
  await expect(page.getByTestId('counterexample-card')).toBeVisible();
  await expect(page.getByTestId('shrink-viewer')).toBeVisible();
  expect(await liveRegions(page), 'Relapsed').toEqual(['copy-status', 'proof-announcer']);
  await prove.getByRole('button', { name: 'Revive' }).click();
  await expect(status).toHaveText('Alive', { timeout: PROOF_TIMEOUT });
  await expect(page.getByTestId('resurrection-fill-revived')).toBeVisible();
  expect(await liveRegions(page), 'Alive after Revive').toEqual(['proof-announcer']);
});
test('demo replays use the same polite region, and progress is announced at most once every 5 s', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  // The still, not the WebGL scene (see above); Demo_Mode never calls the Proof_API.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await context.route(/\/api\//, (route) => route.abort('blockedbyclient'));
  const announcements = await recordAnnouncements(page);
  await page.goto('/program/PAYROLL?demo=1');
  const bar = page.getByTestId('demo-bar');
  const status = page.getByRole('region', { name: 'Prove it' }).getByTestId('proof-status');
  await expect(bar).toHaveAttribute('data-demo-step', 'program', { timeout: 15_000 });
  expect(await liveRegions(page), 'demo bar shown').toEqual(['proof-announcer']);
  const skip = bar.getByRole('button', { name: 'Skip step' });
  await skip.click();
  await skip.click();
  await expect(bar).toHaveAttribute('data-demo-step', 'prove-real');
  const caption = (await bar.getByTestId('demo-caption').textContent()) ?? '';
  expect(await liveRegions(page), 'demo replay').toEqual(['proof-announcer']);
  // The replay runs at 1/40 speed, so it shows progress for well over 5 s.
  await expect(status).toHaveText('Alive', { timeout: 60_000 });
  const log = await announcements();
  testInfo.annotations.push({ type: 'announcements', description: log.map((a) => `${Math.round(a.t)} ms: ${a.text}`).join(' | ') });
  const stepStart = log.findLast((a) => a.text === caption);
  expect(stepStart, `the prove-real caption is announced: ${JSON.stringify(log)}`).toBeDefined();
  const progress = log.filter((a) => a.t > (stepStart?.t ?? 0) && / cases? run, .* seconds elapsed\.$/.test(a.text));
  expect(progress.length, JSON.stringify(log)).toBeGreaterThanOrEqual(1);
  let previous = stepStart?.t ?? 0;
  for (const p of progress) {
    expect(p.t - previous, JSON.stringify(log)).toBeGreaterThanOrEqual(INTERVAL_MS - SLACK_MS);
    previous = p.t;
  }
  expect(log.at(-1)?.text).toMatch(/^Recorded proof: PAYROLL is alive: /);
});
