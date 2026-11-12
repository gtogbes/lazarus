import { expect, test } from './fixtures';

/**
 * Requirement 7.4: under reduced motion the landing page shows a still and never
 * fetches the three.js chunk; with motion allowed (and WebGL) the scene loads.
 */
// Dev: /src/scene/LabScene.tsx and pre-bundled three deps. Build: assets/LabScene-<hash>.js.
const SCENE_CHUNK = /\/LabScene(-[\w-]+)?\.(tsx|js)(\?|$)|\/deps\/(three|postprocessing)/;

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
});

test('with motion allowed, loads the scene instead of the still', async ({ page }) => {
  const sceneRequest = page.waitForRequest((request) => SCENE_CHUNK.test(request.url()));
  await page.goto('/');
  await sceneRequest;
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('lab-still')).toHaveCount(0);
});
