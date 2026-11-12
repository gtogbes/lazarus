import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { MUTANTS } from '../../src/ports/payroll.mutants';

/**
 * Task 23, Requirement 9.1: the whole happy path with the keyboard only (no clicks),
 * against the real proof API. Every element that Tab lands on must show a focus
 * indicator, and Tab must be able to leave every part of the page (no traps).
 */

const PROOF_TIMEOUT = 60_000;
/** Upper bound on tab stops in one cycle of the program page (the port pane has a button per linked statement). */
const MAX_TAB_STOPS = 400;

const halfUpTax = MUTANTS.find((m) => m.id === 'half-up-tax');
if (!halfUpTax) throw new Error('PAYROLL mutant half-up-tax not found');

interface Focused {
  readonly key: string;
  readonly tag: string;
  readonly name: string;
  readonly indicator: string | null;
}

/** The focused element, and its focus indicator (outline or box-shadow), or null when it has none. */
async function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { key: 'body', tag: 'body', name: '', indicator: null };
    const style = getComputedStyle(el);
    const outline =
      style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1
        ? `outline ${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`
        : null;
    const shadow = style.boxShadow !== 'none' ? `box-shadow ${style.boxShadow}` : null;
    const rect = el.getBoundingClientRect();
    const name = (el.getAttribute('aria-label') ?? (el as HTMLElement).innerText ?? '').trim().slice(0, 60);
    // A stable identity for the cycle check, kept on the element itself.
    const w = window as Window & { __tabStops?: number };
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) throw new Error('unexpected focus target');
    el.dataset.tabStop ??= String((w.__tabStops = (w.__tabStops ?? 0) + 1));
    return {
      key: el.dataset.tabStop,
      tag: el.tagName.toLowerCase(),
      name,
      indicator: rect.width > 0 && rect.height > 0 ? (outline ?? shadow) : null,
    };
  });
}

/** Tab (or Shift+Tab) until `matches` holds, checking the focus indicator at every stop. */
async function tabTo(page: Page, matches: (f: Focused) => boolean, { back = false, max = MAX_TAB_STOPS } = {}) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    const f = await focused(page);
    if (f.tag !== 'body') expect(f.indicator, `no visible focus on <${f.tag}> "${f.name}"`).not.toBeNull();
    if (matches(f)) return f;
  }
  throw new Error('focus never reached the target');
}

const named = (name: string | RegExp) => (f: Focused) => (typeof name === 'string' ? f.name === name : name.test(f.name));

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('skip link: first Tab shows it, Enter moves focus to the main content', async ({ page }) => {
  await page.goto('/morgue');
  await expect(page.getByRole('heading', { level: 1, name: 'The morgue' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(20); // no longer sr-only
  expect((await focused(page)).indicator).not.toBeNull();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
  // The next Tab continues inside main, past the header navigation.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'INTCALC' })).toBeFocused();
});

test('happy path by keyboard: morgue, PAYROLL, Prove, sabotage, Prove, counterexample, Copy command', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Reanimation lab' })).toBeVisible();
  // Landing to the morgue.
  await tabTo(page, named('Enter the morgue'));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'The morgue' })).toBeVisible();
  // Client-side navigation moves focus to main (AppShell).
  await expect(page.locator('main#main')).toBeFocused();

  await tabTo(page, named('PAYROLL'));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'PAYROLL' })).toBeVisible();
  await expect(page.locator('main#main')).toBeFocused();
  const provePanel = page.getByRole('region', { name: 'Prove it' });
  const status = provePanel.getByTestId('proof-status');
  await expect(page.getByRole('region', { name: 'Sabotage the port' })).toBeVisible();

  // Prove the real port.
  await tabTo(page, named('Prove it'));
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('Alive', { timeout: PROOF_TIMEOUT });
  // Focus stayed on the button (aria-disabled during the run, not disabled).
  await expect(provePanel.getByRole('button', { name: 'Prove again' })).toBeFocused();

  // Into the sabotage radio group, then arrows to the half-up-tax mutant.
  const radio = (name: string) => page.getByRole('radio', { name });
  await tabTo(page, (f) => f.tag === 'input');
  await expect(radio('No sabotage: prove the real port')).toBeFocused();
  for (let i = 0; i < 10 && !(await radio(halfUpTax.title).isChecked()); i++) {
    await page.keyboard.press('ArrowDown');
    expect((await focused(page)).indicator).not.toBeNull();
  }
  await expect(radio(halfUpTax.title)).toBeChecked();
  await expect(page.getByTestId('mutant-diff')).toBeVisible();

  // Back up to Prove again and run the mutant.
  await tabTo(page, named('Prove again'), { back: true });
  await page.keyboard.press('Space');
  await expect(status).toHaveText('Relapsed', { timeout: PROOF_TIMEOUT });

  // The counterexample sits after the Prove panel; Copy command is in it.
  const card = page.getByRole('region', { name: 'Counterexample' });
  await expect(card).toBeVisible();
  await tabTo(page, named('Copy command'));
  await page.keyboard.press('Enter');
  await expect(card.getByTestId('copy-status')).toHaveText('Copied the replay command.');
  const command = await card.getByTestId('replay-command').innerText();
  expect(command).toMatch(/^LAZARUS_SEED=-?\d+ /);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);

  // No traps: a full Tab cycle over the Relapsed page (diff and counterexample shown)
  // visits every stop once with a visible indicator and comes back round.
  const start = await focused(page);
  const seen = new Set<string>([start.key]);
  for (let i = 0; ; i++) {
    expect(i, 'Tab never cycled back: focus trap or runaway tab order').toBeLessThan(MAX_TAB_STOPS);
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (f.key === start.key) break;
    if (f.tag === 'body') continue; // leaving the document to the browser chrome and back
    expect(f.indicator, `no visible focus on <${f.tag}> "${f.name}"`).not.toBeNull();
    expect(seen.has(f.key), `focus returned to <${f.tag}> "${f.name}" before cycling`).toBe(false);
    seen.add(f.key);
  }
  expect(seen.size).toBeGreaterThan(10);
});
