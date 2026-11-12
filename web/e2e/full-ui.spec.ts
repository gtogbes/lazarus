import type { ConsoleMessage, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { PROGRAMS } from '../../src/ports/registry';

/**
 * The whole UI end to end, against the real proof API and real GnuCOBOL (docker runner):
 * the full-viewport lab scene on every page, the morgue explanations, every program
 * proven Alive, every mutant proven Relapsed (or Alive with its equivalence reason),
 * the scene mood following the status, the recorded fallback, reduced motion, a phone
 * viewport, worst-case text contrast over the scene, and no console errors.
 *
 * The scene mood is read from `data-mood` on the scene layer, never from pixels.
 */

// A proof runs at most 25 s on the server (Requirement 3.6); the first also starts a container.
const PROOF_TIMEOUT = 60_000;
const MOODS_KEY = '__lazarusMoods';

interface Watch {
  readonly errors: string[];
}

/**
 * Collects console errors and page errors. `allow` exempts the browser's own
 * "Failed to load resource" line for a request the test blocked on purpose.
 */
function watchConsole(page: Page, allow?: RegExp): Watch {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    if (allow && allow.test(m.location().url) && /Failed to load resource/.test(m.text())) return;
    errors.push(`${m.text()} (${m.location().url})`);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return { errors };
}

/** Records every `data-mood` the scene layer shows, in order, so short moods are not missed. */
async function recordMoods(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    const w = window as unknown as Record<string, string[]>;
    w[key] = [];
    const watch = () => {
      const layer = document.querySelector('[data-testid="lab-scene-layer"]');
      if (!layer) return false;
      const push = () => {
        const mood = layer.getAttribute('data-mood') ?? '';
        if (w[key]?.at(-1) !== mood) w[key]?.push(mood);
      };
      push();
      new MutationObserver(push).observe(layer, { attributes: true, attributeFilter: ['data-mood'] });
      return true;
    };
    const boot = new MutationObserver(() => {
      if (watch()) boot.disconnect();
    });
    document.addEventListener('DOMContentLoaded', () => {
      if (!watch()) boot.observe(document.body, { childList: true, subtree: true });
    });
  }, MOODS_KEY);
}

async function moods(page: Page): Promise<string[]> {
  return page.evaluate((key) => [...((window as unknown as Record<string, string[]>)[key] ?? [])], MOODS_KEY);
}

const layer = (page: Page) => page.getByTestId('lab-scene-layer');

/** Tags the scene canvas so a later check can tell whether it is the same element. */
async function tagCanvas(page: Page): Promise<void> {
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.evaluate(() => {
    (window as unknown as { __labCanvas: Element | null }).__labCanvas = document.querySelector('canvas');
  });
}

async function sameCanvas(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const tagged = (window as unknown as { __labCanvas?: Element | null }).__labCanvas;
    return tagged != null && tagged.isConnected && document.querySelectorAll('canvas').length === 1 && document.querySelector('canvas') === tagged;
  });
}

/** Polls, because the scene sizes its canvas after it mounts (300 x 150 until then). */
async function expectFillsViewport(page: Page, selector: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return 'missing';
          const r = el.getBoundingClientRect();
          const off = Math.max(Math.abs(r.x), Math.abs(r.y), Math.abs(r.width - window.innerWidth), Math.abs(r.height - window.innerHeight));
          return off <= 1 ? 'fills' : `${r.x},${r.y} ${r.width}x${r.height} in ${window.innerWidth}x${window.innerHeight}`;
        }, selector),
      { message: `${selector} fills the viewport` },
    )
    .toBe('fills');
}

/** Waits for CSS animations (the morgue card entrance) so contrast is read at rest. */
async function animationsDone(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
}

interface ContrastFailure {
  readonly text: string;
  readonly ratio: number;
  readonly needed: number;
}

/**
 * Requirement 9.1 over the canvas, which axe cannot see. For every visible text element
 * whose backgrounds let the scene show through, composite those backgrounds over the
 * worst-case scene pixel (pure white for light text, pure black for dark text) and
 * compute the WCAG contrast. The scene layer sits above <body>, so the walk stops there.
 */
async function worstCaseContrastFailures(page: Page): Promise<{ checked: number; minRatio: number; failures: ContrastFailure[] }> {
  return page.evaluate(() => {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    /** Any CSS colour (oklch included) to sRGB 0-255 and alpha 0-1, via the 2D canvas. */
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
    };
    const lum = ([r, g, b]: readonly number[]) => {
      const lin = (v: number) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0);
    };
    const over = (top: readonly number[], bottom: readonly number[]) => {
      const a = top[3] ?? 1;
      return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (bottom[i] ?? 0) * (1 - a));
    };
    const ratio = (a: readonly number[], b: readonly number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    };
    const failures: { text: string; ratio: number; needed: number }[] = [];
    let checked = 0;
    let minRatio = Infinity;
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.closest('[data-testid="lab-scene-layer"], [aria-disabled="true"], script, style')) continue;
      const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (!ownText) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width <= 1 || rect.height <= 1 || style.visibility === 'hidden') continue;
      // Backgrounds from the element up to <body>, innermost first, stopping at the first opaque one.
      const layers: [number, number, number, number][] = [];
      let opaque = false;
      for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
        const bg = rgba(getComputedStyle(n).backgroundColor);
        if (bg[3] === 0) continue;
        layers.push(bg);
        if (bg[3] >= 0.999) {
          opaque = true;
          break;
        }
      }
      // The scene cannot show through an opaque layer, and axe already checks those.
      if (opaque) continue;
      const text = rgba(style.color);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      let worst = Infinity;
      for (const scene of [
        [255, 255, 255],
        [0, 0, 0],
      ]) {
        let bg: readonly number[] = scene;
        for (const l of [...layers].reverse()) bg = over(l, bg);
        worst = Math.min(worst, ratio(over(text, bg), bg));
      }
      checked++;
      minRatio = Math.min(minRatio, worst);
      if (worst < needed) failures.push({ text: (el.textContent ?? '').trim().slice(0, 60), ratio: Math.round(worst * 100) / 100, needed });
    }
    return { checked, minRatio: Math.round(minRatio * 100) / 100, failures };
  });
}

async function expectReadableOverScene(page: Page, state: string): Promise<void> {
  await animationsDone(page);
  const result = await worstCaseContrastFailures(page);
  test.info().annotations.push({ type: 'worst-case contrast', description: `${state}: ${result.checked} text elements over the scene, lowest ${result.minRatio}:1` });
  expect(result.checked, `${state}: some text sits over the scene`).toBeGreaterThan(0);
  expect(result.failures, `${state}: text below 4.5:1 (3:1 large) over a white or black scene pixel`).toEqual([]);
}

test.describe('full UI', () => {
  test('landing hero over a full-viewport scene, then the morgue with the same canvas', async ({ page }) => {
    const watch = watchConsole(page);
    await recordMoods(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Reanimation lab' })).toBeVisible();
    await expect(page.getByText('Legacy COBOL, ported to TypeScript and proven equivalent against real GnuCOBOL.')).toBeVisible();
    await expect(layer(page)).toHaveAttribute('data-scene', 'canvas');
    await tagCanvas(page);
    await expectFillsViewport(page, '[data-testid="lab-scene-layer"]');
    await expectFillsViewport(page, 'canvas');
    await expect(layer(page)).toHaveAttribute('data-mood', 'buried');
    await expectReadableOverScene(page, 'landing');

    await page.getByRole('link', { name: 'Enter the morgue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'The morgue' })).toBeVisible();
    const cards = page.getByTestId('program-card');
    await expect(cards).toHaveCount(PROGRAMS.length);
    for (const program of PROGRAMS) {
      const card = page.getByRole('listitem', { name: program.id });
      await expect(card.getByTestId('program-summary')).toHaveText(program.summary);
      // The recorded proof status (Alive, Relapsed or Unproven) once it has loaded.
      await expect(card.getByText(/^(Alive|Relapsed|Unproven)$/)).toBeVisible();
    }
    expect(await sameCanvas(page), 'the scene canvas survives the route change').toBe(true);
    await expectFillsViewport(page, 'canvas');

    // Hover and focus light the card and nudge the scene, without changing its mood.
    await page.getByRole('listitem', { name: 'PAYROLL' }).hover();
    await expect(layer(page)).toHaveAttribute('data-mood', 'buried');
    await expectReadableOverScene(page, 'morgue');
    expect(await moods(page)).toEqual(['buried']);
    expect(watch.errors).toEqual([]);
  });

  for (const program of PROGRAMS) {
    test(`${program.id}: the real port is Alive, every mutant relapses or is shown equivalent`, async ({ page }) => {
      test.setTimeout(PROOF_TIMEOUT * (program.mutants.length + 2));
      const watch = watchConsole(page);
      await recordMoods(page);
      await page.goto('/morgue');
      await tagCanvas(page);
      await page.getByRole('link', { name: program.id, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: program.id })).toBeVisible();
      await expect(page.getByTestId('program-summary')).toHaveText(program.summary);
      expect(await sameCanvas(page), 'the scene canvas survives the route change').toBe(true);

      const prove = page.getByRole('region', { name: 'Prove it' });
      const status = prove.getByTestId('proof-status');
      const sabotage = page.getByRole('region', { name: 'Sabotage the port' });
      await expect(sabotage).toBeVisible();
      await expect(status).toHaveText('Not yet proven');

      // The real port: Alive, with cases, seed and reference; the scene goes reanimating, then alive.
      await prove.getByRole('button', { name: 'Prove it' }).click();
      await expect(status).toHaveText(/^Alive/, { timeout: PROOF_TIMEOUT });
      const summary = prove.getByTestId('proof-summary');
      await expect(summary).toContainText(/Cases\s*[\d,]+/);
      await expect(summary).toContainText(/Seed\s*-?\d+/);
      await expect(summary).toContainText(/Reference\s*lazarus-gnucobol:3\.1\.2/);
      await expect(layer(page)).toHaveAttribute('data-mood', 'alive');
      expect(await moods(page)).toEqual(['buried', 'reanimating', 'alive']);
      await expectReadableOverScene(page, `${program.id} Alive`);

      for (const mutant of program.mutants) {
        await sabotage.getByRole('radio', { name: new RegExp(`^${escapeRegExp(mutant.title)}`) }).check();
        const diff = sabotage.getByRole('region', { name: /Changes against the real port/ });
        await expect(diff).toBeVisible();
        await expect(diff).toContainText('MUTANT:');
        await expect(prove.getByTestId('sabotage-notice')).toContainText(mutant.id);
        await prove.getByRole('button', { name: 'Prove again' }).click();
        if (mutant.equivalent !== undefined) {
          await expect(sabotage.getByTestId('equivalent-reason')).toContainText(mutant.equivalent);
          await expect(status).toHaveText(/^Alive/, { timeout: PROOF_TIMEOUT });
          await expect(layer(page)).toHaveAttribute('data-mood', 'alive');
          await expect(page.getByRole('region', { name: 'Counterexample' })).toHaveCount(0);
          continue;
        }
        await expect(status).toHaveText('Relapsed', { timeout: PROOF_TIMEOUT });
        await expect(layer(page)).toHaveAttribute('data-mood', 'relapsed');
        const card = page.getByRole('region', { name: 'Counterexample' });
        await expect(card).toBeVisible();
        const input = card.getByRole('table', { name: /^Input record/ });
        await expect(input.getByRole('rowheader').first()).toBeVisible();
        const output = card.getByRole('table', { name: /^Output record/ });
        expect(await output.getByRole('row').filter({ hasText: 'Differs' }).count(), mutant.id).toBeGreaterThanOrEqual(1);
        await expect(card).toContainText(`Sabotage: ${mutant.title}`);
        await expect(card).toContainText(mutant.explanation);
        if (mutant === program.mutants.find((m) => m.equivalent === undefined)) {
          await expectReadableOverScene(page, `${program.id} Relapsed`);
        }
      }
      const seen = await moods(page);
      expect(seen.filter((m) => m !== 'buried' && m !== 'reanimating' && m !== 'alive' && m !== 'relapsed')).toEqual([]);
      expect(seen).toContain('relapsed');
      expect(watch.errors).toEqual([]);
    });
  }

  test('recorded fallback: the live proof fails, the recorded proof replays with its label and date', async ({ page }) => {
    const watch = watchConsole(page, /\/api\/prove$/);
    await page.route('**/api/prove', (route) => route.abort('failed'));
    await page.goto('/program/PAYROLL');
    const prove = page.getByRole('region', { name: 'Prove it' });
    const status = prove.getByTestId('proof-status');
    await prove.getByRole('button', { name: 'Prove it' }).click();
    await expect(status).toHaveText('Proof failed');
    await expect(layer(page)).toHaveAttribute('data-mood', 'fault');
    const offer = prove.getByTestId('recorded-offer');
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Replay the recorded proof' }).click();
    await expect(status).toHaveText(/^Alive/, { timeout: PROOF_TIMEOUT });
    const label = prove.getByTestId('proof-recorded');
    await expect(label).toContainText('Recorded');
    await expect(label).toContainText(/recorded on \d{1,2} \w{3} \d{4}/);
    await expect(label.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
    await expect(layer(page)).toHaveAttribute('data-mood', 'alive');
    expect(watch.errors).toEqual([]);
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('shows the full-viewport still instead of the canvas, on every page', async ({ page }) => {
      const watch = watchConsole(page);
      await page.goto('/');
      const still = page.getByTestId('lab-still');
      await expect(still).toHaveAttribute('data-mood', 'buried');
      await expect(layer(page)).toHaveAttribute('data-scene', 'still');
      await expectFillsViewport(page, '[data-testid="lab-still"]');
      await expect(still).toHaveCSS('object-fit', 'cover');
      await page.getByRole('link', { name: 'Enter the morgue' }).click();
      await expect(page.getByTestId('program-card')).toHaveCount(PROGRAMS.length);
      // No entrance animation or transition under reduced motion.
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
      await expect(page.getByTestId('program-card').first()).toHaveCSS('animation-name', 'none');
      await expectFillsViewport(page, '[data-testid="lab-still"]');
      await expect(page.locator('canvas')).toHaveCount(0);
      expect(watch.errors).toEqual([]);
    });
  });

  test.describe('phone, 390 x 844', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('cards stack, program panes stack with tabs, the scene fills the screen, no sideways scroll', async ({ page }) => {
      const watch = watchConsole(page);
      const noSidewaysScroll = async (where: string) =>
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), where).toBeLessThanOrEqual(0);

      await page.goto('/');
      await expect(page.locator('canvas')).toHaveCount(1);
      await expectFillsViewport(page, 'canvas');
      await noSidewaysScroll('landing');
      await tagCanvas(page);

      await page.getByRole('link', { name: 'Enter the morgue' }).click();
      const cards = page.getByTestId('program-card');
      await expect(cards).toHaveCount(PROGRAMS.length);
      await animationsDone(page);
      const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, bottom: r.bottom })));
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i]?.x).toBeCloseTo(boxes[0]?.x ?? 0, 0);
        expect(boxes[i]?.y ?? 0).toBeGreaterThanOrEqual(boxes[i - 1]?.bottom ?? 0);
      }
      await noSidewaysScroll('morgue');
      await expectReadableOverScene(page, 'phone morgue');

      await page.getByRole('link', { name: 'PAYROLL', exact: true }).click();
      const tabs = page.getByRole('tablist', { name: 'Source' });
      await expect(tabs).toBeVisible();
      await tabs.getByRole('tab', { name: 'TypeScript port' }).click();
      await expect(tabs.getByRole('tab', { name: 'TypeScript port' })).toHaveAttribute('aria-selected', 'true');
      await noSidewaysScroll('program');
      expect(await sameCanvas(page)).toBe(true);
      // The fixed layer still covers the screen when the long page is scrolled.
      await page.mouse.wheel(0, 2000);
      await expectFillsViewport(page, 'canvas');
      expect(watch.errors).toEqual([]);
    });
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
