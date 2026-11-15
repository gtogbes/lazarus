import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { MUTANTS } from '../../src/ports/payroll.mutants';

/**
 * Task 23, Requirement 9.1: axe (WCAG 2.0/2.1/2.2 A and AA rules) on every route and
 * the main states of the program view, against the real proof API.
 *
 * Nothing is excluded. The lab scene slot is aria-hidden and inert, so axe already
 * skips its content (it is decorative; status is announced by the Prove panel).
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
const PROOF_TIMEOUT = 60_000;

const halfUpTax = MUTANTS.find((m) => m.id === 'half-up-tax');
if (!halfUpTax) throw new Error('PAYROLL mutant half-up-tax not found');

const ANIMATIONS_TIMEOUT = 5_000;

/**
 * Wait for every finite running animation (e.g. the morgue `card-in` fade) to finish,
 * so axe measures contrast at the final colours, not mid-fade. Infinite animations
 * are skipped: they never finish.
 */
async function waitForAnimations(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? 0))
        .every((a) => a.playState === 'finished' || a.playState === 'idle'),
    undefined,
    { timeout: ANIMATIONS_TIMEOUT },
  );
}

async function expectNoViolations(page: Page, state: string): Promise<void> {
  await waitForAnimations(page);
  const { violations, incomplete } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  // "Needs review" results (axe could not decide, e.g. contrast over a gradient): listed, not failed.
  for (const item of incomplete) {
    test.info().annotations.push({
      type: 'axe needs review',
      description: `${state}: ${item.id} on ${item.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    });
  }
  const summary = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
  }));
  expect(summary, `axe violations in: ${state}`).toEqual([]);
}

async function openPayroll(page: Page) {
  await page.goto('/program/PAYROLL');
  await expect(page.getByRole('heading', { level: 1, name: 'PAYROLL' })).toBeVisible();
  // The sources (and with them the sabotage panel) load in their own chunk.
  await expect(page.getByRole('region', { name: 'Sabotage the port' })).toBeVisible();
  const prove = page.getByRole('region', { name: 'Prove it' });
  return { prove, status: prove.getByTestId('proof-status') };
}

test.describe('landing', () => {
  test('with motion allowed (scene loaded)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toHaveCount(1);
    await expectNoViolations(page, 'landing');
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    test('with the still', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByTestId('lab-still')).toBeAttached();
      await expectNoViolations(page, 'landing, reduced motion');
    });
  });
});

test('morgue, with the recorded proofs loaded', async ({ page }) => {
  await page.goto('/morgue');
  await expect(page.getByRole('heading', { level: 1, name: 'The morgue' })).toBeVisible();
  await expect(page.getByText('Checking for a recorded proof…')).toHaveCount(0);
  await expectNoViolations(page, 'morgue');
});

test('not-found: unknown route and unknown program', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { level: 1, name: 'Nothing buried here' })).toBeVisible();
  await expectNoViolations(page, 'not-found route');
  await page.goto('/program/NOPE');
  await expect(page.getByRole('heading', { level: 1, name: 'Nothing buried here' })).toBeVisible();
  await expectNoViolations(page, 'unknown program');
});

test.describe('program view', () => {
  test('panes side by side', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openPayroll(page);
    await expect(page.getByRole('tablist', { name: 'Source' })).toHaveCount(0);
    await expectNoViolations(page, 'program view, side by side');
  });

  test('panes stacked below 900 px, both tabs', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openPayroll(page);
    const tabs = page.getByRole('tablist', { name: 'Source' });
    await expect(tabs).toBeVisible();
    await expectNoViolations(page, 'program view, stacked, COBOL tab');
    await tabs.getByRole('tab', { name: 'TypeScript port' }).click();
    await expectNoViolations(page, 'program view, stacked, port tab');
  });

  test('Prove running, then Alive', async ({ page }) => {
    const { prove, status } = await openPayroll(page);
    // Hold the real request so the UI stays in Reanimating long enough to scan.
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
    await expect(prove.getByRole('button', { name: 'Cancel' })).toBeVisible();
    // graphical-proof: the vitals panel (heartbeat, case grid, resurrection fill) while running.
    const vitals = page.getByTestId('vitals-panel');
    await expect(vitals).toHaveAttribute('data-status', 'reanimating');
    await expectNoViolations(page, 'Prove running, with the vitals');
    release();
    await expect(status).toHaveText('Alive', { timeout: PROOF_TIMEOUT });
    await expect(vitals).toHaveAttribute('data-status', 'alive');
    await expect(page.getByTestId('heartbeat-label')).toContainText('✓');
    // The Visuals draw only while in view (Requirement 15.4), so bring the fill into view first.
    await page.getByTestId('resurrection-fill').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('resurrection-fill')).toHaveAttribute('data-demo-beat', 'all-passed');
    await expectNoViolations(page, 'Alive, with the vitals');
  });

  test('sabotage selected with the diff, then Relapsed with the counterexample', async ({ page }) => {
    const { prove, status } = await openPayroll(page);
    const sabotage = page.getByRole('region', { name: 'Sabotage the port' });
    await sabotage.getByRole('radio', { name: halfUpTax.title }).check();
    await expect(sabotage.getByTestId('mutant-diff')).toBeVisible();
    await expectNoViolations(page, 'sabotage selected with the diff');
    await prove.getByRole('button', { name: 'Prove it' }).click();
    await expect(status).toHaveText('Relapsed', { timeout: PROOF_TIMEOUT });
    const card = page.getByRole('region', { name: 'Counterexample' });
    await expect(card).toBeVisible();
    // Mid-playback: the shrink stage is animating (its Pause control shows) beside the
    // Autopsy and the Digit inspector; the vitals show the flatline and the failed case.
    const viewer = card.getByTestId('shrink-viewer');
    await expect(viewer.getByTestId('shrink-stage')).toBeVisible();
    await expect(viewer.getByTestId('shrink-controls').getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(card.getByTestId('autopsy')).toBeVisible();
    await expect(card.getByTestId('digit-inspector')).toBeVisible();
    await expect(page.getByTestId('vitals-panel')).toHaveAttribute('data-status', 'relapsed');
    await expect(page.getByTestId('heartbeat')).toHaveAttribute('data-mode', 'flatline');
    await expectNoViolations(page, 'Relapsed, shrink viewer mid-playback');
    await card.getByText('Records field by field').click(); // open both <details> too
    await card.getByText('Raw records').click();
    await expectNoViolations(page, 'Relapsed with the counterexample card');
    // The Revive button, then the run it starts ends Alive (with the shock pulse).
    const revive = prove.getByRole('button', { name: 'Revive' });
    await expect(revive).toBeVisible();
    await revive.click();
    await expect(status).toHaveText('Alive', { timeout: PROOF_TIMEOUT });
    await expect(revive).toHaveCount(0);
    await expectNoViolations(page, 'Alive after Revive');
  });

  test('error with the recorded-fallback offer, then a recorded replay', async ({ page }) => {
    const { prove, status } = await openPayroll(page);
    // The proof API is down.
    await page.route('**/api/prove', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await prove.getByRole('button', { name: 'Prove it' }).click();
    await expect(status).toHaveText('Proof failed');
    await expect(prove.getByTestId('recorded-offer')).toBeVisible();
    await expectNoViolations(page, 'error with the recorded-fallback offer');
    await prove.getByRole('button', { name: 'Replay the recorded proof' }).click();
    await expect(status).toHaveText('Alive');
    await expect(prove.getByTestId('proof-recorded')).toContainText('A replay of a proof recorded on');
    await expectNoViolations(page, 'recorded replay');
  });
});

/** graphical-proof Requirement 14.7: axe on the new states (stitches, reduced-motion visuals, Demo_Mode). */
test.describe('graphical proof', () => {
  /** Shown once the overlay has drawn the stitch (it starts as `display: none`). */
  const stitchDrawn = (page: Page, kind: 'field' | 'link') =>
    expect.poll(() => page.locator(`[data-stitch="${kind}"]`).evaluate((g) => getComputedStyle(g).display)).not.toBe('none');
  test('field stitches with a field active, side by side', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openPayroll(page);
    const option = page.getByRole('listbox', { name: 'Fields' }).locator('[data-field-option="IN-HOURS"]');
    await option.click();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('field-details')).toContainText('IN-HOURS');
    await stitchDrawn(page, 'field');
    await expectNoViolations(page, 'field stitches, side by side, IN-HOURS active');
  });
  test('field stitches with a field active, stacked', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openPayroll(page);
    const option = page.getByRole('listbox', { name: 'Fields' }).locator('[data-field-option="OUT-TAX"]');
    await option.click();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Show in port' })).toBeVisible();
    await expectNoViolations(page, 'field stitches, stacked, OUT-TAX active');
  });
  test('the statement-link stitch', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openPayroll(page);
    await page.locator('[data-link]').first().focus();
    await expect(page.getByTestId('link-caption')).toContainText('highlighted for port');
    await stitchDrawn(page, 'link');
    await expectNoViolations(page, 'statement-link stitch');
  });
  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    test('vitals, counterexample and Revived ✓ in their static forms', async ({ page }) => {
      const { prove, status } = await openPayroll(page);
      await page.getByRole('region', { name: 'Sabotage the port' }).getByRole('radio', { name: halfUpTax.title }).check();
      await prove.getByRole('button', { name: 'Prove it' }).click();
      await expect(status).toHaveText('Relapsed', { timeout: PROOF_TIMEOUT });
      await expect(page.getByTestId('heartbeat')).toHaveAttribute('data-motion', 'reduced');
      await expect(page.getByTestId('case-grid')).toHaveAttribute('data-motion', 'reduced');
      const viewer = page.getByTestId('shrink-viewer');
      await expect(viewer.getByTestId('shrink-stage')).toHaveCount(0);
      await expect(viewer.getByTestId('shrink-list')).not.toHaveClass(/sr-only/);
      await expectNoViolations(page, 'Relapsed, reduced motion');
      await prove.getByRole('button', { name: 'Revive' }).click();
      await expect(status).toHaveText('Alive', { timeout: PROOF_TIMEOUT });
      await expect(page.getByTestId('resurrection-fill-revived')).toHaveText('Revived ✓');
      await expectNoViolations(page, 'Revived ✓, reduced motion');
    });
  });
  test.describe('demo mode', () => {
    test.beforeEach(async ({ context }) => {
      // Demo_Mode never calls the Proof_API (Requirement 11.3).
      await context.route(/\/api\//, (route) => route.abort('blockedbyclient'));
    });
    test('the bar during a replay, then paused', async ({ page }) => {
      await page.goto('/program/PAYROLL?demo=1');
      const bar = page.getByTestId('demo-bar');
      await expect(bar).toHaveAttribute('data-demo-step', 'program', { timeout: 15_000 });
      const skip = bar.getByRole('button', { name: 'Skip step' });
      await skip.click();
      await skip.click();
      await expect(bar).toHaveAttribute('data-demo-step', 'prove-real');
      await expect(page.getByTestId('heartbeat')).toHaveAttribute('data-demo-beat', 'heartbeat');
      await expectNoViolations(page, 'demo bar, prove-real replay');
      await bar.getByRole('button', { name: 'Pause' }).click();
      await expect(bar).toHaveAttribute('data-demo-state', 'paused');
      await expectNoViolations(page, 'demo bar, paused');
    });
    test('the error state', async ({ page }) => {
      await page.route('**/recorded/PAYROLL.half-up-tax.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
      await page.goto('/program/PAYROLL?demo=1');
      const bar = page.getByTestId('demo-bar');
      await expect(bar).toHaveAttribute('data-demo-state', 'error', { timeout: 15_000 });
      await expect(bar.getByTestId('demo-caption')).toHaveText(
        'The demo stopped: the recording recorded/PAYROLL.half-up-tax.json is missing or invalid.',
      );
      await expect(bar.getByRole('button', { name: 'Exit demo' })).toBeVisible();
      await expectNoViolations(page, 'demo bar, error');
    });
  });
});
