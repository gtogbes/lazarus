#!/usr/bin/env node
/**
 * CDK entry point (cdk.json "app"). Region us-east-1; account from CDK_DEFAULT_ACCOUNT.
 *   npx cdk synth -c budgetEmail=you@example.com
 *   npx cdk diff  -c budgetEmail=you@example.com
 * Deploying is high risk and needs the owner's explicit approval (design.md, "Infrastructure").
 */
import { buildApp } from '../lib/app.js';

buildApp();
