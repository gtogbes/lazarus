import { expect, test } from './fixtures';
import { MUTANTS } from '../../src/ports/payroll.mutants';

/**
 * Requirement 7.4: under reduced motion the landing page shows a still and never
 * fetches the three.js chunk; with motion allowed (and WebGL) the scene loads.
 */
// Dev: /src/scene/LabScene.tsx and pre-bundled three deps. Build: assets/LabScene-<hash>.js.
const SCENE_CHUNK = /\/LabScene(-[\w-]+)?\.(tsx|js)(\?|$)|\/deps\/(three|postprocessing)/;
const PROOF_TIMEOUT = 60_000;
const halfUpTax = MUTANTS.find((m) => m.id === 'half-up-tax');
if (!halfUpTax) throw new Error('PAYROLL mutant half-up-tax not found');

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows the still and never requests the scene chunk', async ({ page }) => {
    const sceneRequests: string[] = [];
    page.on('request', (request) => {
      if (SCENE_CHUNK.test(request.url())) sceneRequests.push(request.url());
    });
    await page.goto('/');
    const still = page.getByTestId('lab-still');
    await expect(still).toHaveAttribute('data-mood', 'buried');
    // Decorative: empty alt inside the aria-hidden slot.
    await expect(still).toHaveAttribute('alt', '');
    await expect.poll(() => still.evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)).toBe(true);
    // Give the idle-time loader every chance to fire.
    await page.waitForTimeout(2500);
    expect(sceneRequests).toEqual([]);
    await expect(page.locator('canvas')).toHaveCount(0);
  });
  // graphical-proof Requirement 14.3: the static equivalents of the new visuals.
  test('program view: static vitals, stepwise shrink list, Revived ✓ with no shock pulse, still and no scene chunk', async ({ page }) => {
    const sceneRequests: string[] = [];
    page.on('request', (request) => {
      if (SCENE_CHUNK.test(request.url())) sceneRequests.push(request.url());
    });
    await page.goto('/program/PAYROLL');
    await expect(page.getByTestId('lab-still')).toBeAttached();
    const prove = page.getByRole('region', { name: 'Prove it' });
    const status = prove.getByTestId('proof-status');
    await page.getByRole('region', { name: 'Sabotage the port' }).getByRole('radio', { name: halfUpTax.title }).check();
    await prove.getByRole('button', { name: 'Prove it' }).click();
    await expect(status).toHaveText('Relapsed', { timeout: PROOF_TIMEOUT });
    // No moving heartbeat, a grid drawn at status changes (14.3).
    await expect(page.getByTestId('heartbeat')).toHaveAttribute('data-motion', 'reduced');
    await expect(page.getByTestId('heartbeat')).toHaveAttribute('data-mode', 'flatline');
    await expect(page.getByTestId('case-grid')).toHaveAttribute('data-motion', 'reduced');
    await expect(page.getByTestId('case-grid-caption')).toContainText('diverged');
    // The stepwise shrink list, visible, instead of the animated stage.
    const viewer = page.getByTestId('shrink-viewer');
    await expect(viewer.getByTestId('shrink-stage')).toHaveCount(0);
    await expect(viewer.getByTestId('shrink-list')).toBeVisible();
    await expect(viewer.getByTestId('shrink-list')).not.toHaveClass(/sr-only/);
    // Revive: "Revived ✓" in text, and no shock pulse.
    await prove.getByRole('button', { name: 'Revive' }).click();
    await expect(status).toHaveText('Alive', { timeout: PROOF_TIMEOUT });
    await expect(page.getByTestId('resurrection-fill-revived')).toHaveText('Revived ✓');
    await expect(page.locator('[data-demo-beat="revive-pulse"], .shock')).toHaveCount(0);
    expect(await page.evaluate(() => document.getAnimations().length), 'no CSS or Web animations').toBe(0);
    await expect(page.getByTestId('lab-still')).toHaveAttribute('data-mood', 'alive');
    await expect(page.getByTestId('lab-scene-layer').locator('canvas')).toHaveCount(0);
    expect(sceneRequests).toEqual([]);
  });
});

test('with motion allowed, loads the scene instead of the still', async ({ page }) => {
  const sceneRequest = page.waitForRequest((request) => SCENE_CHUNK.test(request.url()));
  await page.goto('/');
  await sceneRequest;
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('lab-still')).toHaveCount(0);
});
