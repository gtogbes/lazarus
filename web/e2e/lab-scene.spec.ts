import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Task 19: the landing page loads the hero GLB and its decoders from this site (no CDN,
 * so the CSP of task 21 can stay same-origin), with no console errors; and if the GLB or
 * a decoder cannot load, the slot falls back to the still (Requirement 7.4).
 */

const GLB = /\/models\/lab\.glb$/;
// Dev serves three's decoder files from node_modules; a build serves hashed copies from /assets.
const DECODERS = /\/(draco_wasm_wrapper|draco_decoder)[^/]*\.(js|wasm)(\?.*)?$/;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('loads the GLB and Draco decoder from same-origin URLs, without console errors', async ({ page, baseURL }) => {
  const errors = collectConsoleErrors(page);
  const sceneAssets: { url: string; status: number }[] = [];
  page.on('response', (r) => {
    if (GLB.test(r.url()) || DECODERS.test(r.url())) sceneAssets.push({ url: r.url(), status: r.status() });
  });
  const offSite: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(new URL(baseURL ?? '').origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) offSite.push(r.url());
  });

  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect.poll(() => sceneAssets.map((a) => a.url)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(GLB),
      expect.stringMatching(/draco_wasm_wrapper[^/]*\.js/),
      expect.stringMatching(/draco_decoder[^/]*\.wasm/),
    ]),
  );
  // Let decoding finish and a few frames render.
  await page.waitForTimeout(1500);

  for (const asset of sceneAssets) expect(asset.status, asset.url).toBe(200);
  expect(offSite).toEqual([]);
  expect(errors).toEqual([]);
  // Still decorative: hidden from assistive tech and inert.
  const slot = page.locator('[aria-hidden="true"][inert]').filter({ has: page.locator('canvas') });
  await expect(slot).toHaveCount(1);
  await expect(page.getByTestId('lab-still')).toHaveCount(0);
});

for (const [what, pattern] of [
  ['the GLB', GLB],
  ['the Draco decoder', /\/draco_(wasm_wrapper|decoder)[^/]*\.(js|wasm)(\?.*)?$/],
  // The baked WebP textures are embedded in the GLB, so there is no separate file to fail here.
] as const) {
  test(`falls back to the still when ${what} fails to load`, async ({ page }) => {
    await page.route(pattern, (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page.goto('/');
    const still = page.getByTestId('lab-still');
    await expect(still).toHaveAttribute('data-mood', 'buried', { timeout: 20_000 });
    await expect(page.locator('canvas')).toHaveCount(0);
  });
}
