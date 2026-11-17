#!/usr/bin/env node
/**
 * CDK entry point (cdk.json "app"). Region us-east-1; account from CDK_DEFAULT_ACCOUNT.
 *   npx cdk synth -c budgetEmail=you@example.com
 *   npx cdk diff  -c budgetEmail=you@example.com
 * Without a domain the site uses its CloudFront domain. For a custom domain add
 * `-c domainName=lab.example.com -c hostedZoneDomain=example.com` (or LAZARUS_DOMAIN and
 * LAZARUS_HOSTED_ZONE_DOMAIN), plus `-c hostedZoneId=Z...` to skip the Route 53 lookup.
 * The lookup needs AWS credentials once and caches the zone in CDK's context cache file,
 * which is gitignored because it holds the account id and zone id.
 * Deploying is high risk and needs the owner's explicit approval (design.md, "Infrastructure").
 */
import { buildApp } from '../lib/app.js';

buildApp();
