import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUDGET_EMAIL_ENV,
  DOMAIN_NAME_ENV,
  HOSTED_ZONE_DOMAIN_ENV,
  HOSTED_ZONE_ID_ENV,
  resolveBudgetEmail,
  resolveHostedZoneId,
  resolveSiteDomain,
  REPO_ROOT,
} from '../lib/config.js';
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

describe('resolveSiteDomain', () => {
  it('normalises case and a trailing dot', () => {
    expect(resolveSiteDomain(' Lazarus.Example.com. ', 'example.com')).toEqual({
      domainName: 'lazarus.example.com',
      hostedZoneDomain: 'example.com',
    });
  });

  it('is optional: undefined when neither part is set', () => {
    expect(resolveSiteDomain(undefined, undefined, {})).toBeUndefined();
    expect(resolveSiteDomain('', ' ', {})).toBeUndefined();
  });

  it('falls back to LAZARUS_DOMAIN and LAZARUS_HOSTED_ZONE_DOMAIN', () => {
    const env = { [DOMAIN_NAME_ENV]: 'lab.example.com', [HOSTED_ZONE_DOMAIN_ENV]: 'example.com' };
    expect(resolveSiteDomain(undefined, undefined, env)).toEqual({ domainName: 'lab.example.com', hostedZoneDomain: 'example.com' });
    expect(resolveSiteDomain('other.example.com', undefined, env)?.domainName).toBe('other.example.com');
  });

  it('throws when only one part is set, malformed, or outside the zone', () => {
    expect(() => resolveSiteDomain(undefined, 'example.com')).toThrow(/-c domainName=.*hostedZoneDomain=/);
    expect(() => resolveSiteDomain('lazarus.example.com', '')).toThrow(/needs both parts/);
    expect(() => resolveSiteDomain('bad_name.example.com', 'example.com')).toThrow(/not a valid DNS name/);
    expect(() => resolveSiteDomain('lazarus.example.org', 'example.com')).toThrow(/not inside the hosted zone/);
    expect(() => resolveSiteDomain('lazarusexample.com', 'example.com')).toThrow(/not inside the hosted zone/);
  });
});

describe('resolveHostedZoneId', () => {
  it('is optional, accepts the /hostedzone/ prefix, and rejects malformed ids', () => {
    expect(resolveHostedZoneId(undefined, {})).toBeUndefined();
    expect(resolveHostedZoneId('/hostedzone/Z0000000000TESTZONE')).toBe('Z0000000000TESTZONE');
    expect(resolveHostedZoneId(undefined, { [HOSTED_ZONE_ID_ENV]: 'Z123' })).toBe('Z123');
    expect(() => resolveHostedZoneId('not-a-zone')).toThrow(/not a Route 53 hosted zone id/);
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
