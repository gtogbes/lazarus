/**
 * Settings shared by the CDK app and its tests (reanimation-lab design, "Infrastructure").
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Decided by the owner on 2026-11-07 (requirements.md, "Open decisions"). */
export const REGION = 'us-east-1';

/** Applied to every taggable resource in the app (Requirement 8.4, workspace cost standards). */
export const TAGS = {
  Project: 'lazarus',
  Environment: 'demo',
  Owner: 'gtogbes',
  CostCenter: 'kiroween-2026',
} as const;

/** Requirement 8.4: the budget alert fires at USD 10 per month. */
export const BUDGET_LIMIT_USD = 10;

/** Proof API sizing from the design. */
export const PROOF_API = {
  memoryMb: 1024,
  timeoutSec: 30,
  reservedConcurrency: 1,
  logRetentionDays: 90,
} as const;

/**
 * CDK context keys and environment variables for the optional custom domain. Never stored in
 * the repo: pass them at synth/deploy time. Without them the site uses the CloudFront domain.
 */
export const DOMAIN_NAME_CONTEXT = 'domainName';
export const HOSTED_ZONE_DOMAIN_CONTEXT = 'hostedZoneDomain';
export const HOSTED_ZONE_ID_CONTEXT = 'hostedZoneId';
export const DOMAIN_NAME_ENV = 'LAZARUS_DOMAIN';
export const HOSTED_ZONE_DOMAIN_ENV = 'LAZARUS_HOSTED_ZONE_DOMAIN';
export const HOSTED_ZONE_ID_ENV = 'LAZARUS_HOSTED_ZONE_ID';

export interface SiteDomain {
  /** The site's host name, e.g. lab.example.com. */
  readonly domainName: string;
  /** The public Route 53 hosted zone that holds it, e.g. example.com. */
  readonly hostedZoneDomain: string;
}

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** A Route 53 hosted zone id: upper-case letters and digits. */
const ZONE_ID = /^Z[A-Z0-9]{1,31}$/;

function contextOrEnv(contextValue: unknown, envValue: string | undefined): string {
  const raw = typeof contextValue === 'string' && contextValue.trim() !== '' ? contextValue : (envValue ?? '');
  return raw.trim();
}

/**
 * The optional custom domain from CDK context (`-c domainName=... -c hostedZoneDomain=...`)
 * or LAZARUS_DOMAIN / LAZARUS_HOSTED_ZONE_DOMAIN. Returns undefined when neither is set.
 * Throws when only one is set, either is malformed, or the name is not inside the zone.
 */
export function resolveSiteDomain(
  domainName: unknown,
  hostedZoneDomain: unknown,
  env: NodeJS.ProcessEnv = {},
): SiteDomain | undefined {
  const name = contextOrEnv(domainName, env[DOMAIN_NAME_ENV]).toLowerCase().replace(/\.$/, '');
  const zone = contextOrEnv(hostedZoneDomain, env[HOSTED_ZONE_DOMAIN_ENV]).toLowerCase().replace(/\.$/, '');
  if (!name && !zone) return undefined;
  if (!name || !zone) {
    throw new Error(
      `A custom domain needs both parts: \`-c ${DOMAIN_NAME_CONTEXT}=lab.example.com ` +
        `-c ${HOSTED_ZONE_DOMAIN_CONTEXT}=example.com\` (or ${DOMAIN_NAME_ENV} and ${HOSTED_ZONE_DOMAIN_ENV}). ` +
        `Leave both unset to use the CloudFront domain.`,
    );
  }
  for (const value of [name, zone]) if (!HOST.test(value)) throw new Error(`"${value}" is not a valid DNS name.`);
  if (name !== zone && !name.endsWith(`.${zone}`)) {
    throw new Error(`The site domain "${name}" is not inside the hosted zone "${zone}".`);
  }
  return { domainName: name, hostedZoneDomain: zone };
}

/**
 * Optional hosted zone id (`-c hostedZoneId=...` or LAZARUS_HOSTED_ZONE_ID). When set, the zone
 * is imported by id and synth needs no Route 53 lookup (and writes nothing to CDK's context cache).
 */
export function resolveHostedZoneId(contextValue: unknown, env: NodeJS.ProcessEnv = {}): string | undefined {
  const value = contextOrEnv(contextValue, env[HOSTED_ZONE_ID_ENV]).replace(/^\/hostedzone\//, '');
  if (!value) return undefined;
  if (!ZONE_ID.test(value)) throw new Error(`"${value}" is not a Route 53 hosted zone id.`);
  return value;
}

/** CDK context key and environment variable for the budget alert address. */
export const BUDGET_EMAIL_CONTEXT = 'budgetEmail';
export const BUDGET_EMAIL_ENV = 'LAZARUS_BUDGET_EMAIL';

// Deliberately loose: one @, no spaces, a dot in the domain. AWS Budgets validates it properly.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The budget alert address from CDK context (`-c budgetEmail=...`) or the
 * LAZARUS_BUDGET_EMAIL environment variable. Never stored in the repo.
 * Throws with instructions when it is missing or malformed, so synth fails early.
 */
export function resolveBudgetEmail(contextValue: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const raw = typeof contextValue === 'string' && contextValue.trim() !== '' ? contextValue : env[BUDGET_EMAIL_ENV];
  const value = raw?.trim();
  if (!value) {
    throw new Error(
      `Missing the budget alert email (Requirement 8.4). Pass it with ` +
        `\`npx cdk synth -c ${BUDGET_EMAIL_CONTEXT}=you@example.com\` or set ${BUDGET_EMAIL_ENV}.`,
    );
  }
  if (!EMAIL.test(value)) throw new Error(`The budget alert email "${value}" does not look like an email address.`);
  return value;
}

/** Repository root (infra/ is one level down). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The production web build that SiteStack deploys. */
export const DEFAULT_SITE_DIR = join(REPO_ROOT, 'web', 'dist');

/** Fails synth when the web build is missing, instead of deploying an empty site. */
export function assertSiteBuilt(siteDir: string): void {
  if (!existsSync(join(siteDir, 'index.html'))) {
    throw new Error(`No web build at ${siteDir} (index.html missing). Run \`npm run web:build\` from the repo root first.`);
  }
}
