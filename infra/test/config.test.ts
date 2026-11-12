import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BUDGET_EMAIL_ENV, resolveBudgetEmail, REPO_ROOT } from '../lib/config.js';
import { lambdaContextExcludes } from '../lib/docker-context.js';
import { loadSpaRewrite } from '../lib/spa-rewrite.js';

describe('resolveBudgetEmail', () => {
  it('prefers CDK context, falls back to the env var, and trims', () => {
    expect(resolveBudgetEmail(' a@example.com ', { [BUDGET_EMAIL_ENV]: 'b@example.com' })).toBe('a@example.com');
    expect(resolveBudgetEmail(undefined, { [BUDGET_EMAIL_ENV]: 'b@example.com' })).toBe('b@example.com');
    expect(resolveBudgetEmail('', { [BUDGET_EMAIL_ENV]: 'b@example.com' })).toBe('b@example.com');
  });

  it('throws when missing or malformed', () => {
    expect(() => resolveBudgetEmail(undefined, {})).toThrow(/Missing the budget alert email/);
    expect(() => resolveBudgetEmail('not-an-email', {})).toThrow(/does not look like an email/);
  });
});

describe('lambdaContextExcludes', () => {
  it('is the Dockerfile.dockerignore allowlist plus the Dockerfile itself', () => {
    const excludes = lambdaContextExcludes(REPO_ROOT);
    expect(excludes[0]).toBe('**');
    expect(excludes).toContain('!src/**');
    expect(excludes).toContain('src/**/*.test.ts');
    expect(excludes).toContain('!docker/lambda/Dockerfile');
    expect(excludes.some((l) => l.startsWith('#'))).toBe(false);
  });
});

describe('SPA rewrite (CloudFront Function)', () => {
  const rewrite = loadSpaRewrite();
  const uri = (path: string) => rewrite({ request: { uri: path } }).uri;

  it('serves app routes from /index.html and leaves files alone', () => {
    expect(uri('/')).toBe('/index.html');
    expect(uri('/morgue')).toBe('/index.html');
    expect(uri('/program/PAYROLL')).toBe('/index.html');
    expect(uri('/program/PAYROLL/')).toBe('/index.html');
    expect(uri('/assets/index-CfusUEbT.js')).toBe('/assets/index-CfusUEbT.js');
    expect(uri('/recorded/PAYROLL.half-up-tax.json')).toBe('/recorded/PAYROLL.half-up-tax.json');
    expect(uri('/assets/missing.js')).toBe('/assets/missing.js');
  });

  const segment = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);
  const dirs = fc.array(segment, { maxLength: 4 }).map((parts) => parts.map((p) => `/${p}`).join(''));

  it('property: a path whose last segment has an extension is passed through unchanged', () => {
    fc.assert(
      fc.property(dirs, segment, segment, (dir, name, ext) => {
        const path = `${dir}/${name}.${ext}`;
        expect(uri(path)).toBe(path);
      }),
    );
  });

  it('property: a path whose last segment has no dot is rewritten to /index.html', () => {
    fc.assert(
      fc.property(dirs, fc.option(segment, { nil: '' }), (dir, last) => {
        expect(uri(`${dir}/${last}`)).toBe('/index.html');
      }),
    );
  });
});
