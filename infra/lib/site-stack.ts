/**
 * SiteStack: the static lab (web/dist) in a private S3 bucket behind CloudFront,
 * plus the /api/* behaviour that forwards to the proof API Function URL.
 *
 * Both origins use Origin Access Control: S3 only answers this distribution,
 * and the Function URL (AWS_IAM auth) only accepts requests CloudFront signs.
 *
 * SPA fallback: a CloudFront Function rewrites app routes (no file extension)
 * to /index.html on the default behaviour only. Error-response mapping
 * (403/404 -> /index.html, 200) was rejected because custom error responses
 * apply to the whole distribution: they would also turn the API's own 404/403
 * answers into an HTML page with status 200, and missing assets into 200 HTML
 * that the browser then fails to parse as JavaScript. With the function, a
 * missing /assets/x.js stays a 404; LIST access lets S3 say 404 rather than 403.
 *
 * No WAF (owner decision, task 21): its fixed monthly charge would use the whole
 * budget. See the AwsSolutions-CFR2 acknowledgement in nag-suppressions.ts.
 *
 * Custom domain (task 22): an ACM certificate validated by DNS in the existing
 * Route 53 zone, the name as a distribution alias with TLSv1.2_2021, and A/AAAA
 * alias records. The stack is in us-east-1, where CloudFront requires the certificate.
 */
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AccessLevel,
  AllowedMethods,
  CachePolicy,
  Distribution,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  Function as CloudFrontFunction,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  OriginRequestCookieBehavior,
  PriceClass,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
  type BehaviorOptions,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import type { IFunctionUrl } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AaaaRecord, ARecord, HostedZone, type IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import { assertSiteBuilt, DEFAULT_SITE_DIR, type SiteDomain } from './config.js';
import { CONTENT_SECURITY_POLICY, HSTS_MAX_AGE_SEC, SECURITY_HEADERS } from './security-headers.js';
import { SPA_REWRITE_PATH } from './spa-rewrite.js';

export interface SiteStackProps extends StackProps {
  readonly functionUrl: IFunctionUrl;
  /** Directory with the production web build. Defaults to web/dist. */
  readonly siteDir?: string;
  readonly domain: SiteDomain;
  /**
   * Hosted zone id for `domain.hostedZoneDomain`. When set, the zone is imported by id and no
   * lookup happens (tests). When unset, it is looked up at synth time and cached in cdk.context.json.
   */
  readonly hostedZoneId?: string;
}

/**
 * Headers the proof API needs from the viewer. Host is excluded: OAC signs for the Function URL host.
 *
 * x-amz-content-sha256 is deliberately absent. The browser still sends it (Lambda OAC needs the
 * viewer's payload hash for POST), but CloudFront consumes it when it SigV4-signs the origin
 * request; it is not, and cannot be, allowlisted. CloudFront rejects X-Amz-* names in an origin
 * request policy ("The parameter Headers contains x-amz-content-sha256 that is not allowed").
 * https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html
 */
export const API_FORWARDED_HEADERS = ['Content-Type'] as const;

/** Headers set as CloudFront "custom headers" (the rest map to its security-header fields). */
const CUSTOM_HEADER_NAMES = ['permissions-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy'] as const;

function header(name: string): string {
  const value = SECURITY_HEADERS[name];
  if (value === undefined) throw new Error(`security-headers.ts has no ${name}`);
  return value;
}

export class SiteStack extends Stack {
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);
    const siteDir = props.siteDir ?? DEFAULT_SITE_DIR;
    assertSiteBuilt(siteDir);

    const bucket = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // No versioning: every deploy would keep old copies (and their cost) forever.
      versioned: false,
      // The site is rebuilt from git; on stack deletion keep the bucket (empty it by hand)
      // rather than adding another custom-resource Lambda to auto-delete objects.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const headers = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'Lazarus lab: CSP and security headers (infra/lib/security-headers.ts)',
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: CONTENT_SECURITY_POLICY, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.seconds(HSTS_MAX_AGE_SEC),
          includeSubdomains: true,
          override: true,
        },
        xssProtection: { protection: false, override: true },
      },
      customHeadersBehavior: {
        customHeaders: CUSTOM_HEADER_NAMES.map((name) => ({ header: name, value: header(name), override: true })),
      },
    });

    const spaRewrite = new CloudFrontFunction(this, 'SpaRewrite', {
      comment: 'SPA fallback: extensionless paths to /index.html',
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromFile({ filePath: SPA_REWRITE_PATH }),
    });

    const apiRequests = new OriginRequestPolicy(this, 'ApiOriginRequest', {
      comment: 'Lazarus proof API: forward only Content-Type (OAC signs with the viewer x-amz-content-sha256)',
      headerBehavior: OriginRequestHeaderBehavior.allowList(...API_FORWARDED_HEADERS),
      queryStringBehavior: OriginRequestQueryStringBehavior.none(),
      cookieBehavior: OriginRequestCookieBehavior.none(),
    });

    const api: BehaviorOptions = {
      origin: FunctionUrlOrigin.withOriginAccessControl(props.functionUrl, {
        // Covers the 25 s run cap plus cold start; progress lines keep the connection busy anyway.
        readTimeout: Duration.seconds(30),
      }),
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: apiRequests,
      responseHeadersPolicy: headers,
      // A redirect would turn the POST into a GET; the page is HTTPS and uses a relative URL.
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      // Do not risk CloudFront buffering the NDJSON stream to compress it (ADR 0001).
      compress: false,
    };

    const { domainName, hostedZoneDomain } = props.domain;
    const zone: IHostedZone =
      props.hostedZoneId === undefined
        ? HostedZone.fromLookup(this, 'Zone', { domainName: hostedZoneDomain })
        : HostedZone.fromHostedZoneAttributes(this, 'Zone', { hostedZoneId: props.hostedZoneId, zoneName: hostedZoneDomain });

    const certificate = new Certificate(this, 'Certificate', {
      domainName,
      validation: CertificateValidation.fromDns(zone),
    });

    this.distribution = new Distribution(this, 'Site', {
      comment: 'Lazarus reanimation lab',
      domainNames: [domainName],
      certificate,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultRootObject: 'index.html',
      priceClass: PriceClass.PRICE_CLASS_100,
      httpVersion: HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket, {
          originAccessLevels: [AccessLevel.READ, AccessLevel.LIST],
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        compress: true,
        functionAssociations: [{ function: spaRewrite, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: { '/api/*': api },
    });

    const target = RecordTarget.fromAlias(new CloudFrontTarget(this.distribution));
    new ARecord(this, 'AliasA', { zone, recordName: domainName, target });
    new AaaaRecord(this, 'AliasAAAA', { zone, recordName: domainName, target });

    new CfnOutput(this, 'SiteUrl', { value: `https://${domainName}`, description: 'The lab' });
    new CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront domain (the alias records point here)',
    });

    const deployLogs = new LogGroup(this, 'DeployLogs', {
      retention: RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Hashed build output: cache for a year and never prune, so a visitor on the
    // previous version can still lazy-load its chunks after a deploy.
    const assets = new BucketDeployment(this, 'DeployAssets', {
      sources: [Source.asset(siteDir)],
      destinationBucket: bucket,
      exclude: ['*'],
      include: ['assets/*'],
      prune: false,
      cacheControl: [CacheControl.setPublic(), CacheControl.maxAge(Duration.days(365)), CacheControl.immutable()],
      logGroup: deployLogs,
    });

    // Everything else (index.html, recorded proofs, models, stills): revalidate every time,
    // then invalidate CloudFront so the new index.html is served at once.
    const pages = new BucketDeployment(this, 'DeployPages', {
      sources: [Source.asset(siteDir)],
      destinationBucket: bucket,
      exclude: ['assets/*'],
      prune: true,
      cacheControl: [CacheControl.setPublic(), CacheControl.maxAge(Duration.seconds(0)), CacheControl.mustRevalidate()],
      distribution: this.distribution,
      distributionPaths: ['/*'],
      logGroup: deployLogs,
    });
    // index.html must never reference assets that are not uploaded yet.
    pages.node.addDependency(assets);
  }
}
