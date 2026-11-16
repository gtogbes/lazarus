#!/usr/bin/env node
/**
 * CDK entry point (cdk.json "app"). Region us-east-1; account from CDK_DEFAULT_ACCOUNT.
 *   npx cdk synth -c budgetEmail=you@example.com
 *   npx cdk diff  -c budgetEmail=you@example.com
 * The site domain defaults to cdk.json's domainName / hostedZoneDomain; override with
 * `-c domainName=lazarus.example.com -c hostedZoneDomain=example.com`. The zone lookup
 * needs AWS credentials once, then reads cdk.context.json.
 * Deploying is high risk and needs the owner's explicit approval (design.md, "Infrastructure").
 */
import { buildApp } from '../lib/app.js';

buildApp();
