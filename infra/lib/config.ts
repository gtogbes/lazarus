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
