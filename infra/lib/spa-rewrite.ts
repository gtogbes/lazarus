/**
 * Loads the CloudFront Function source (spa-rewrite.cf.js) so tests and the
 * local CSP server run the exact code CloudFront runs. No CDK imports.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SPA_REWRITE_PATH = fileURLToPath(new URL('./spa-rewrite.cf.js', import.meta.url));

export interface ViewerRequest {
  uri: string;
}

export type ViewerRequestHandler = (event: { request: ViewerRequest }) => ViewerRequest;

export function loadSpaRewrite(): ViewerRequestHandler {
  const source = readFileSync(SPA_REWRITE_PATH, 'utf8');
  // Trusted, repo-local source; evaluated the way the CloudFront runtime does (a top-level `handler`).
  return new Function(`${source}\nreturn handler;`)() as ViewerRequestHandler;
}
