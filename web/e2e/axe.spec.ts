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
    await expectNoViolations(page, 'Prove running');
    release();
    await expect(status).toHaveText('Alive', { timeout: PROOF_TIMEOUT });
    await expectNoViolations(page, 'Alive');
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
    await card.getByText('Raw records').click(); // open the <details> too
    await expectNoViolations(page, 'Relapsed with the counterexample card');
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
