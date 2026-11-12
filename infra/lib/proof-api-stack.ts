/**
 * ProofApiStack: the proof API Lambda (container image from docker/lambda/Dockerfile),
 * its Function URL, its log group, and the account's monthly cost budget.
 *
 * The Function URL uses AWS_IAM auth, so only signed callers get in. The only
 * caller granted access is the SiteStack CloudFront distribution: CDK's
 * FunctionUrlOrigin.withOriginAccessControl adds the lambda:InvokeFunctionUrl
 * and lambda:InvokeFunction permissions (source ARN = that distribution) in
 * SiteStack. Keeping them there makes SiteStack depend on this stack and not
 * the other way round, so there is no cross-stack cycle.
 *
 * No VPC, by design (owner decision, task 21): a Function URL stays publicly
 * reachable even when the function is attached to a VPC, because VPC config only
 * changes the function's outbound networking. A private subnet would add NAT or
 * endpoint cost and cold-start time without blocking a single request. The
 * function also needs no network access. What keeps callers out is the AWS_IAM
 * auth type plus a resource policy that admits only cloudfront.amazonaws.com with
 * AWS:SourceArn = this distribution (tested in infra/test/stacks.test.ts).
 */
import { Duration, IgnoreMode, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  DockerImageCode,
  DockerImageFunction,
  FunctionUrlAuthType,
  InvokeMode,
  type FunctionUrl,
} from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { BUDGET_LIMIT_USD, PROOF_API, REPO_ROOT } from './config.js';
import { LAMBDA_DOCKERFILE, lambdaContextExcludes } from './docker-context.js';

export interface ProofApiStackProps extends StackProps {
  /** Where the AWS Budget sends its alert (from context or env, never hardcoded). */
  readonly budgetEmail: string;
  /** Docker build context. Defaults to the repo root. */
  readonly repoRoot?: string;
}

const RETENTION: Record<number, RetentionDays> = { 90: RetentionDays.THREE_MONTHS };

export class ProofApiStack extends Stack {
  readonly functionUrl: FunctionUrl;

  constructor(scope: Construct, id: string, props: ProofApiStackProps) {
    super(scope, id, props);
    const repoRoot = props.repoRoot ?? REPO_ROOT;

    const retention = RETENTION[PROOF_API.logRetentionDays];
    if (retention === undefined) throw new Error(`No RetentionDays for ${PROOF_API.logRetentionDays} days`);
    const logGroup = new LogGroup(this, 'ProveLogs', { retention });

    // Least privilege: write to its own log group, nothing else. CDK adds the
    // ECR pull permissions for the image asset repository to this role.
    const role = new Role(this, 'ProveRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Lazarus proof API: write own logs only',
    });
    logGroup.grantWrite(role);

    const fn = new DockerImageFunction(this, 'Prove', {
      description: 'Lazarus proof API: runs the equivalence harness against GnuCOBOL 3.1.2',
      code: DockerImageCode.fromImageAsset(repoRoot, {
        file: LAMBDA_DOCKERFILE,
        platform: Platform.LINUX_ARM64,
        ignoreMode: IgnoreMode.DOCKER,
        exclude: lambdaContextExcludes(repoRoot),
      }),
      architecture: Architecture.ARM_64,
      memorySize: PROOF_API.memoryMb,
      timeout: Duration.seconds(PROOF_API.timeoutSec),
      reservedConcurrentExecutions: PROOF_API.reservedConcurrency,
      role,
      logGroup,
    });

    this.functionUrl = fn.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });

    // Account-wide (no cost filters): the lazarus tag is not usable as a budget
    // filter until it is activated as a cost allocation tag, which has no
    // CloudFormation resource. Account-wide over-reports, which is the safe side.
    new CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'lazarus-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: BUDGET_LIMIT_USD, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.budgetEmail }],
        },
      ],
    });
  }
}
