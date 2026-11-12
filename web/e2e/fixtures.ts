import { expect, test as base, type ConsoleMessage } from '@playwright/test';
/**
 * The Playwright `test` every e2e spec uses (and the CSP run, which reuses these specs).
 * It fails any test whose pages log a browser console message mentioning a deprecation,
 * of any level (three.js, for one, reports deprecated APIs with `console.warn`). The
 * check is on the browser context, so pages a test opens itself are covered too.
 */
const DEPRECATION = /deprecat/i;

export const test = base.extend<{ failOnDeprecations: void }>({
  failOnDeprecations: [
    async ({ context }, use) => {
      const found: string[] = [];
      const onConsole = (m: ConsoleMessage) => {
        if (!DEPRECATION.test(m.text())) return;
        const at = m.location();
        found.push(`[console.${m.type()}] ${m.text()} (${at.url}:${at.lineNumber}:${at.columnNumber})`);
      };
      context.on('console', onConsole);
      await use();
      context.off('console', onConsole);
      expect(found, 'browser console deprecation warnings').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
