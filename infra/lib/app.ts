/**
 * Builds the CDK app. Shared by bin/lazarus.ts (cdk synth/diff) and the tests.
 */
import { App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import {
  BUDGET_EMAIL_CONTEXT,
  DOMAIN_NAME_CONTEXT,
  HOSTED_ZONE_DOMAIN_CONTEXT,
  REGION,
  resolveBudgetEmail,
  resolveSiteDomain,
  TAGS,
} from './config.js';
import { addNagSuppressions } from './nag-suppressions.js';
import { ProofApiStack } from './proof-api-stack.js';
import { SiteStack } from './site-stack.js';

export interface LazarusAppOptions {
  readonly app?: App;
  /** Overrides for tests. */
  readonly siteDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Import the hosted zone by id instead of looking it up (tests, no AWS credentials). */
  readonly hostedZoneId?: string;
}

export interface LazarusApp {
  readonly app: App;
  readonly proofApi: ProofApiStack;
  readonly site: SiteStack;
}

export function buildApp(options: LazarusAppOptions = {}): LazarusApp {
  const app = options.app ?? new App();
  const env = options.env ?? process.env;
  const budgetEmail = resolveBudgetEmail(app.node.tryGetContext(BUDGET_EMAIL_CONTEXT), env);
  const domain = resolveSiteDomain(
    app.node.tryGetContext(DOMAIN_NAME_CONTEXT),
    app.node.tryGetContext(HOSTED_ZONE_DOMAIN_CONTEXT),
  );
  // Account from the CLI's credentials at synth time; never hardcoded.
  const stackEnv = { account: env.CDK_DEFAULT_ACCOUNT, region: REGION };

  const proofApi = new ProofApiStack(app, 'Lazarus-ProofApi', {
    env: stackEnv,
    description: 'Lazarus proof API (reanimation lab): Lambda container image, Function URL, budget',
    budgetEmail,
  });
  const site = new SiteStack(app, 'Lazarus-Site', {
    env: stackEnv,
    description: 'Lazarus reanimation lab: S3 + CloudFront, /api/* to the proof API',
    functionUrl: proofApi.functionUrl,
    domain,
    ...(options.siteDir === undefined ? {} : { siteDir: options.siteDir }),
    ...(options.hostedZoneId === undefined ? {} : { hostedZoneId: options.hostedZoneId }),
  });

  for (const [key, value] of Object.entries(TAGS)) Tags.of(app).add(key, value);
  addNagSuppressions(proofApi, site);
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
  return { app, proofApi, site };
}
