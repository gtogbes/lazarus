import type { Page } from '@playwright/test';
import { expect, test } from '../e2e/fixtures';
import { SECURITY_HEADERS } from '../../infra/lib/security-headers.ts';

/**
 * Task 21: the production build works under the CloudFront CSP and headers.
 * Runs against serve-dist.ts (see playwright.config.ts in this directory).
 */

interface Violation {
  readonly directive: string;
  readonly blocked: string;
  readonly source: string;
}

/** Records every CSP violation (and CSP console errors) across navigations. */
async function watchCsp(page: Page): Promise<string[]> {
  const found: string[] = [];
  await page.exposeFunction('__reportCspViolation', (v: Violation) => {
    found.push(`${v.directive} blocked ${v.blocked} (${v.source})`);
  });
  await page.addInitScript(() => {
    const report = (window as unknown as { __reportCspViolation: (v: Violation) => void }).__reportCspViolation;
    document.addEventListener('securitypolicyviolation', (e) => {
      report({ directive: e.effectiveDirective, blocked: e.blockedURI, source: `${e.sourceFile}:${e.lineNumber}` });
    });
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) found.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => {
    if (/Content Security Policy|EvalError|unsafe-eval/i.test(e.message)) found.push(`pageerror: ${e.message}`);
  });
  return found;
}

test('every response carries the CloudFront security headers; deep links get the app, missing files a 404', async ({
  request,
}) => {
  const deepLink = await request.get('/program/PAYROLL');
  expect(deepLink.status()).toBe(200);
  expect(deepLink.headers()['content-type']).toContain('text/html');
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(deepLink.headers()[name], name).toBe(value);

  const html = await deepLink.text();
  const entry = /src="(\/assets\/index-[\w-]+\.js)"/.exec(html)?.[1];
  expect(entry).toBeDefined();
  const script = await request.get(entry ?? '');
  expect(script.status()).toBe(200);
  expect(script.headers()['content-security-policy']).toBe(SECURITY_HEADERS['content-security-policy']);

  expect((await request.get('/assets/does-not-exist.js')).status()).toBe(404);
  expect((await request.get('/recorded/NOPE.json')).status()).toBe(404);

  // The icon index.html links (img-src 'self'), so browsers do not ask for /favicon.ico.
  expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
  const icon = await request.get('/favicon.svg');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
});

test('no CSP violations: landing scene with decoders, deep-linked program view, a live proof', async ({ page }) => {
  const violations = await watchCsp(page);

  // Landing: the scene chunk, the GLB, the Draco decoder (wasm in blob: workers) and the
  // embedded WebP textures (fetched from blob: URLs by GLTFLoader's ImageBitmapLoader).
  const glb = page.waitForResponse(/\/models\/lab\.glb$/);
  const draco = page.waitForResponse(/draco_decoder[^/]*\.wasm$/);
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
  await Promise.all([glb, draco]);
  await page.waitForTimeout(2000); // let the workers decode and a few frames render
  await expect(page.getByTestId('lab-still')).toHaveCount(0); // no fallback: the scene loaded

  // Deep link through the SPA rewrite; Shiki token colours are React style props.
  await page.goto('/program/PAYROLL');
  await expect(page.getByRole('heading', { level: 1, name: 'PAYROLL' })).toBeVisible();
  const token = page.locator('code span[style*="color"]').first();
  await expect(token).toBeVisible();
  const { inline, computed } = await token.evaluate((el: HTMLElement) => ({
    inline: el.style.color,
    computed: getComputedStyle(el).color,
  }));
  expect(inline).not.toBe('');
  expect(computed).toBe(inline);

  // Live proof: POST /api/prove (connect-src 'self') streaming NDJSON.
  const provePanel = page.getByRole('region', { name: 'Prove it' });
  await provePanel.getByRole('button', { name: 'Prove it' }).click();
  await expect(provePanel.getByTestId('proof-status')).toHaveText('Alive', { timeout: 60_000 });

  expect(violations).toEqual([]);
});
