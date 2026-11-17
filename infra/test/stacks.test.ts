import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type LazarusApp } from '../lib/app.js';
import { BUDGET_LIMIT_USD, PROOF_API, TAGS } from '../lib/config.js';
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from '../lib/security-headers.js';

const EMAIL = 'owner@example.com';
const ACCOUNT = '111111111111'; // test-only placeholder
// Test-only domain and zone: imported by id, so no Route 53 lookup and no AWS credentials.
const DOMAIN = { domainName: 'lazarus.example.com', hostedZoneDomain: 'example.com' };
const ZONE_ID = 'Z0000000000TESTZONE';

function fixtureSite(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lazarus-site-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>fixture</title>');
  return dir;
}

function build(
  context: Record<string, string> = { budgetEmail: EMAIL, ...DOMAIN },
  env: NodeJS.ProcessEnv = { CDK_DEFAULT_ACCOUNT: ACCOUNT },
) {
  return buildApp({ app: new App({ context }), siteDir: fixtureSite(), env, hostedZoneId: ZONE_ID });
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => statSync(join(dir, p)).isFile())
    .map((p) => p.split('\\').join('/'));
}

let built: LazarusApp;
let api: Template;
let site: Template;
let assemblyDir: string;

beforeAll(() => {
  built = build();
  api = Template.fromStack(built.proofApi);
  site = Template.fromStack(built.site);
  assemblyDir = built.app.synth().directory;
});

describe('ProofApiStack', () => {
  it('runs the image on arm64 with 1,024 MB, 30 s and reserved concurrency 1', () => {
    api.resourceCountIs('AWS::Lambda::Function', 1);
    api.hasResourceProperties('AWS::Lambda::Function', {
      PackageType: 'Image',
      Architectures: ['arm64'],
      MemorySize: PROOF_API.memoryMb,
      Timeout: PROOF_API.timeoutSec,
      ReservedConcurrentExecutions: PROOF_API.reservedConcurrency,
    });
    expect(PROOF_API).toMatchObject({ memoryMb: 1024, timeoutSec: 30, reservedConcurrency: 1 });
  });

  it('exposes a Function URL with AWS_IAM auth and response streaming', () => {
    api.resourceCountIs('AWS::Lambda::Url', 1);
    api.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM', InvokeMode: 'RESPONSE_STREAM' });
    // No resource policy in this stack: the only grants are SiteStack's, scoped to the distribution.
    api.resourceCountIs('AWS::Lambda::Permission', 0);
  });

  it('logs to its own log group kept for 90 days', () => {
    api.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 90 });
    const logGroupId = Object.keys(api.findResources('AWS::Logs::LogGroup'))[0];
    api.hasResourceProperties('AWS::Lambda::Function', { LoggingConfig: { LogGroup: { Ref: logGroupId } } });
  });

  it('gives the function role only log writes (plus ECR pull for its image), no managed policies', () => {
    api.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({ Principal: { Service: 'lambda.amazonaws.com' } })],
      }),
      ManagedPolicyArns: Match.absent(),
    });
    const statements = Object.values(api.findResources('AWS::IAM::Policy')).flatMap(
      (p) => p['Properties'].PolicyDocument.Statement as { Action: string | string[]; Resource: unknown }[],
    );
    const actions = statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));
    for (const action of actions) expect(action).toMatch(/^(logs:(CreateLogStream|PutLogEvents)|ecr:[A-Za-z]+)$/);
    const logStatement = statements.find((s) => JSON.stringify(s.Action).includes('logs:'));
    expect(JSON.stringify(logStatement?.Resource)).toContain('ProveLogs');
  });

  it('sets a USD 10 monthly budget with an email alert at 100%', () => {
    api.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: { BudgetType: 'COST', TimeUnit: 'MONTHLY', BudgetLimit: { Amount: BUDGET_LIMIT_USD, Unit: 'USD' } },
      NotificationsWithSubscribers: [
        {
          Notification: { NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', Threshold: 100, ThresholdType: 'PERCENTAGE' },
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: EMAIL }],
        },
      ],
    });
    expect(BUDGET_LIMIT_USD).toBe(10);
  });

  it('stages a small Docker context: the dockerignore allowlist, no tests, no node_modules', () => {
    const manifest = JSON.parse(readFileSync(join(assemblyDir, 'Lazarus-ProofApi.assets.json'), 'utf8')) as {
      dockerImages: Record<string, { source: { directory: string; dockerFile?: string } }>;
    };
    const images = Object.values(manifest.dockerImages);
    expect(images).toHaveLength(1);
    const image = images[0];
    if (!image) throw new Error('no docker image asset');
    expect(image.source.dockerFile).toBe('docker/lambda/Dockerfile');
    const context = join(assemblyDir, image.source.directory);
    const files = filesUnder(context);
    expect(files).toContain('docker/lambda/Dockerfile');
    expect(files).toContain('package-lock.json');
    expect(files).toContain('src/api/lambda.ts');
    expect(files).toContain('cobol/programs/PAYROLL.cbl');
    for (const file of files) {
      expect(file).toMatch(/^(package\.json|package-lock\.json|web\/package\.json|src\/.+\.ts|cobol\/programs\/[A-Z]+\.cbl|docker\/lambda\/.+)$/);
      expect(file).not.toMatch(/\.test\.ts$/);
    }
    const bytes = files.reduce((sum, f) => sum + statSync(join(context, f)).size, 0);
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
    expect(relative(assemblyDir, context)).not.toContain('..');
  });
});

describe('SiteStack', () => {
  it('keeps the bucket private: all public access blocked, TLS enforced, S3-managed encryption, no versioning', () => {
    site.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      VersioningConfiguration: Match.absent(),
    });
    const [policy] = Object.values(site.findResources('AWS::S3::BucketPolicy'));
    const statements = policy?.['Properties'].PolicyDocument.Statement as { Effect: string; Principal: unknown; Condition?: unknown }[];
    expect(statements.some((s) => s.Effect === 'Deny' && JSON.stringify(s.Condition).includes('"aws:SecureTransport":"false"'))).toBe(true);
    // The only Allow is for CloudFront, conditioned on this distribution.
    const allows = statements.filter((s) => s.Effect === 'Allow');
    expect(allows).toHaveLength(1);
    expect(allows[0]?.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
    expect(JSON.stringify(allows[0]?.Condition)).toContain(':distribution/');
  });

  it('uses OAC for both origins and signs every request', () => {
    site.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: { OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' },
    });
    site.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: { OriginAccessControlOriginType: 'lambda', SigningBehavior: 'always', SigningProtocol: 'sigv4' },
    });
    const [dist] = Object.values(site.findResources('AWS::CloudFront::Distribution'));
    const origins = dist?.['Properties'].DistributionConfig.Origins as { OriginAccessControlId?: unknown }[];
    expect(origins).toHaveLength(2);
    for (const origin of origins) expect(origin.OriginAccessControlId).toBeDefined();
  });

  it('lets only this distribution invoke the AWS_IAM Function URL: one principal, AWS:SourceArn = the distribution', () => {
    // Function URL: IAM auth, so unsigned requests to the *.lambda-url host get 403 (no VPC needed; see proof-api-stack.ts).
    api.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
    api.resourceCountIs('AWS::Lambda::Permission', 0);
    api.hasResourceProperties('AWS::Lambda::Function', { VpcConfig: Match.absent() });
    // No WAF either (owner decision, cost): this policy, IAM auth and reserved concurrency are the protection.
    site.resourceCountIs('AWS::WAFv2::WebACL', 0);
    const [urlId] = Object.keys(api.findResources('AWS::Lambda::Url'));
    const [fnId] = Object.keys(api.findResources('AWS::Lambda::Function'));
    expect(api.toJSON()['Resources'][urlId ?? ''].Properties.TargetFunctionArn).toEqual({ 'Fn::GetAtt': [fnId, 'Arn'] });

    // The function's whole resource policy is these two statements, both in SiteStack.
    const distributionId = Object.keys(site.findResources('AWS::CloudFront::Distribution'))[0];
    const distributionArn = {
      'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':cloudfront::', { Ref: 'AWS::AccountId' }, ':distribution/', { Ref: distributionId }]],
    };
    const exportedUrlFunction = Object.values(api.toJSON()['Outputs'] as Record<string, { Value: unknown; Export: { Name: string } }>).find(
      (o) => JSON.stringify(o.Value) === JSON.stringify({ 'Fn::GetAtt': [urlId, 'FunctionArn'] }),
    );
    expect(exportedUrlFunction).toBeDefined();
    const permissions = Object.values(site.findResources('AWS::Lambda::Permission')).map((r) => r['Properties']);
    expect(permissions.map((p) => p.Action).sort()).toEqual(['lambda:InvokeFunction', 'lambda:InvokeFunctionUrl']);
    for (const p of permissions) {
      expect(p.Principal).toBe('cloudfront.amazonaws.com');
      expect(p.SourceArn).toEqual(distributionArn); // rendered as the AWS:SourceArn condition
      expect(p.SourceAccount).toBeUndefined();
      expect(p.FunctionName).toEqual({ 'Fn::ImportValue': exportedUrlFunction?.Export.Name });
    }
    expect(permissions.find((p) => p.Action === 'lambda:InvokeFunction')?.InvokedViaFunctionUrl).toBe(true);
  });

  it('routes /api/* to the Function URL uncached, POST allowed, forwarding only Content-Type (no Host, no X-Amz-*)', () => {
    const [dist] = Object.values(site.findResources('AWS::CloudFront::Distribution'));
    const config = dist?.['Properties'].DistributionConfig;
    const apiBehavior = (config.CacheBehaviors as Record<string, unknown>[]).find((b) => b['PathPattern'] === '/api/*');
    expect(apiBehavior).toMatchObject({
      CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // Managed-CachingDisabled
      AllowedMethods: expect.arrayContaining(['POST']),
      ViewerProtocolPolicy: 'https-only',
      Compress: false,
    });
    site.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', {
      OriginRequestPolicyConfig: {
        HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['Content-Type'] },
        QueryStringsConfig: { QueryStringBehavior: 'none' },
        CookiesConfig: { CookieBehavior: 'none' },
      },
    });
    const headerNames = Object.values(site.findResources('AWS::CloudFront::OriginRequestPolicy')).flatMap(
      (p) => (p['Properties'].OriginRequestPolicyConfig.HeadersConfig.Headers ?? []) as string[],
    );
    expect(headerNames.map((h) => h.toLowerCase())).not.toContain('host');
    // CloudFront rejects X-Amz-* in an origin request policy at create time (task 22 deploy failure).
    for (const name of headerNames) expect(name.toLowerCase()).not.toMatch(/^x-amz-/);
    expect(config.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
  });

  it('serves the SPA through a viewer-request CloudFront Function, not error-response mapping', () => {
    site.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionConfig: { Runtime: 'cloudfront-js-2.0' },
      FunctionCode: Match.stringLikeRegexp("request.uri = '/index.html'"),
    });
    const [dist] = Object.values(site.findResources('AWS::CloudFront::Distribution'));
    const config = dist?.['Properties'].DistributionConfig;
    expect(config.CustomErrorResponses).toBeUndefined();
    expect(config.DefaultCacheBehavior.FunctionAssociations).toEqual([
      { EventType: 'viewer-request', FunctionARN: { 'Fn::GetAtt': [expect.stringMatching(/^SpaRewrite/), 'FunctionARN'] } },
    ]);
  });

  it('sends the CSP and security headers from security-headers.ts', () => {
    site.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: {
          ContentSecurityPolicy: { ContentSecurityPolicy: CONTENT_SECURITY_POLICY, Override: true },
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
          StrictTransportSecurity: { AccessControlMaxAgeSec: 63072000, IncludeSubdomains: true, Override: true },
          XSSProtection: { Protection: false, Override: true },
        },
        CustomHeadersConfig: {
          Items: [
            { Header: 'permissions-policy', Value: SECURITY_HEADERS['permissions-policy'], Override: true },
            { Header: 'cross-origin-opener-policy', Value: 'same-origin', Override: true },
            { Header: 'cross-origin-resource-policy', Value: 'same-origin', Override: true },
          ],
        },
      },
    });
    // What the app needs (task 19), and nothing that re-enables script injection.
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).toContain("worker-src 'self' blob:");
    // blob: for the GLB's embedded WebP textures (GLTFLoader fetches or <img>-loads blob: URLs).
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self' blob:;");
    expect(CONTENT_SECURITY_POLICY).toContain("img-src 'self' blob:;");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-inline'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/'unsafe-eval'/);
    expect(CONTENT_SECURITY_POLICY.length).toBeLessThanOrEqual(1783); // CloudFront's CSP length limit
    const [dist] = Object.values(site.findResources('AWS::CloudFront::Distribution'));
    const config = dist?.['Properties'].DistributionConfig;
    const policyId = Object.keys(site.findResources('AWS::CloudFront::ResponseHeadersPolicy'))[0];
    for (const behavior of [config.DefaultCacheBehavior, ...config.CacheBehaviors]) {
      expect(behavior.ResponseHeadersPolicyId).toEqual({ Ref: policyId });
    }
  });

  it('issues a DNS-validated ACM certificate for the domain in the hosted zone (us-east-1, as CloudFront requires)', () => {
    site.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    site.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: DOMAIN.domainName,
      ValidationMethod: 'DNS',
      DomainValidationOptions: [{ DomainName: DOMAIN.domainName, HostedZoneId: ZONE_ID }],
      SubjectAlternativeNames: Match.absent(),
    });
    expect(built.site.region).toBe('us-east-1');
  });

  it('serves the domain as a distribution alias with that certificate over SNI and TLSv1.2_2021', () => {
    const [dist] = Object.values(site.findResources('AWS::CloudFront::Distribution'));
    const config = dist?.['Properties'].DistributionConfig;
    const certId = Object.keys(site.findResources('AWS::CertificateManager::Certificate'))[0];
    expect(config.Aliases).toEqual([DOMAIN.domainName]);
    expect(config.ViewerCertificate).toEqual({
      AcmCertificateArn: { Ref: certId },
      MinimumProtocolVersion: 'TLSv1.2_2021',
      SslSupportMethod: 'sni-only',
    });
  });

  it('points A and AAAA alias records for the domain at the distribution', () => {
    const distId = Object.keys(site.findResources('AWS::CloudFront::Distribution'))[0];
    for (const type of ['A', 'AAAA']) {
      site.hasResourceProperties('AWS::Route53::RecordSet', {
        Name: `${DOMAIN.domainName}.`,
        Type: type,
        HostedZoneId: ZONE_ID,
        AliasTarget: {
          DNSName: { 'Fn::GetAtt': [distId, 'DomainName'] },
          HostedZoneId: Match.anyValue(),
        },
      });
    }
    site.resourceCountIs('AWS::Route53::RecordSet', 2);
    expect(site.toJSON()['Outputs']['SiteUrl'].Value).toBe(`https://${DOMAIN.domainName}`);
    expect(site.toJSON()['Outputs']['DistributionDomainName'].Value).toEqual({ 'Fn::GetAtt': [distId, 'DomainName'] });
  });

  it('does not hardcode a cloudfront.net host: the CSP is same-origin only', () => {
    expect(JSON.stringify(site.toJSON())).not.toContain('cloudfront.net');
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
  });

  it('deploys hashed assets as immutable and everything else as must-revalidate, then invalidates', () => {
    const deployments = Object.values(site.findResources('Custom::CDKBucketDeployment')).map((r) => r['Properties']);
    expect(deployments).toHaveLength(2);
    const assets = deployments.find((d) => JSON.stringify(d.Include ?? []).includes('assets/*'));
    const pages = deployments.find((d) => JSON.stringify(d.Exclude ?? []).includes('assets/*'));
    expect(assets?.Prune).toBe(false);
    expect(JSON.stringify(assets?.SystemMetadata)).toContain('immutable');
    expect(pages?.DistributionPaths).toEqual(['/*']);
    expect(JSON.stringify(pages?.SystemMetadata)).toContain('must-revalidate');
  });
});

describe('the app', () => {
  it('tags every taggable resource with Project, Environment, Owner and CostCenter', () => {
    expect(TAGS).toEqual({ Project: 'lazarus', Environment: 'demo', Owner: 'gtogbes', CostCenter: 'kiroween-2026' });
    const expected = Object.entries(TAGS).map(([Key, Value]) => ({ Key, Value }));
    const mustBeTagged = [
      'AWS::Lambda::Function',
      'AWS::IAM::Role',
      'AWS::Logs::LogGroup',
      'AWS::S3::Bucket',
      'AWS::CloudFront::Distribution',
    ];
    let checked = 0;
    for (const template of [api, site]) {
      for (const [id, resource] of Object.entries(template.toJSON()['Resources'] as Record<string, { Type: string; Properties?: Record<string, unknown> }>)) {
        const tags = resource.Properties?.['Tags'] ?? resource.Properties?.['ResourceTags'];
        if (mustBeTagged.includes(resource.Type)) expect(tags, `${id} (${resource.Type})`).toBeDefined();
        if (tags === undefined) continue;
        expect(tags, `${id} (${resource.Type})`).toEqual(expect.arrayContaining(expected));
        checked++;
      }
    }
    // Match.arrayWith is order-sensitive and CDK renders tags sorted by key.
    const sorted = [...expected].sort((a, b) => a.Key.localeCompare(b.Key));
    api.hasResourceProperties('AWS::Budgets::Budget', { ResourceTags: Match.arrayWith(sorted) });
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('puts both stacks in us-east-1 with the account from CDK_DEFAULT_ACCOUNT', () => {
    expect(built.proofApi.region).toBe('us-east-1');
    expect(built.site.region).toBe('us-east-1');
    expect(built.proofApi.account).toBe(ACCOUNT);
    expect(built.site.account).toBe(ACCOUNT);
  });

  it('has a one-way dependency, SiteStack on ProofApiStack (no cycle)', () => {
    expect(built.site.dependencies.map((s) => s.stackName)).toEqual(['Lazarus-ProofApi']);
    expect(built.proofApi.dependencies).toEqual([]);
  });

  it('passes cdk-nag AwsSolutions with every remaining finding acknowledged with a reason', () => {
    const report = JSON.parse(readFileSync(join(assemblyDir, 'validation-report.json'), 'utf8')) as {
      pluginReports: { pluginName: string; conclusion: string; violations: unknown[] }[];
    };
    const nag = report.pluginReports.find((r) => r.pluginName === 'AwsSolutions');
    expect(nag?.conclusion).toBe('success');
    expect(nag?.violations).toEqual([]);
  });

  it('fails synth with instructions when the budget email is missing', () => {
    expect(() => build({}, { CDK_DEFAULT_ACCOUNT: ACCOUNT })).toThrow(/-c budgetEmail=.*LAZARUS_BUDGET_EMAIL/);
  });

  it('fails synth when the web build is missing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'lazarus-empty-'));
    expect(() =>
      buildApp({ app: new App({ context: { budgetEmail: EMAIL, ...DOMAIN } }), siteDir: empty, env: {}, hostedZoneId: ZONE_ID }),
    ).toThrow(/npm run web:build/);
  });

  it('without a custom domain, serves the CloudFront domain with the default certificate and passes cdk-nag', () => {
    const plain = build({ budgetEmail: EMAIL });
    const template = Template.fromStack(plain.site);
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    template.resourceCountIs('AWS::Route53::RecordSet', 0);
    const [dist] = Object.values(template.findResources('AWS::CloudFront::Distribution'));
    const config = dist?.['Properties'].DistributionConfig;
    expect(config.Aliases).toBeUndefined();
    expect(config.ViewerCertificate).toBeUndefined();
    const distId = Object.keys(template.findResources('AWS::CloudFront::Distribution'))[0];
    expect(template.toJSON()['Outputs']['SiteUrl'].Value).toEqual({
      'Fn::Join': ['', ['https://', { 'Fn::GetAtt': [distId, 'DomainName'] }]],
    });
    const report = JSON.parse(readFileSync(join(plain.app.synth().directory, 'validation-report.json'), 'utf8')) as {
      pluginReports: { pluginName: string; conclusion: string; violations: unknown[] }[];
    };
    const nag = report.pluginReports.find((r) => r.pluginName === 'AwsSolutions');
    expect(nag?.conclusion).toBe('success');
    expect(nag?.violations).toEqual([]);
  });

  it('fails synth when only half of the custom domain is given', () => {
    expect(() => build({ budgetEmail: EMAIL, domainName: DOMAIN.domainName })).toThrow(/needs both parts/);
  });
});
