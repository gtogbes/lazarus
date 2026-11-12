/**
 * Build-context exclusions for the proof API image.
 *
 * CDK's DockerImageAsset stages the context directory itself and only reads a
 * `.dockerignore` at the context root; it ignores the per-Dockerfile
 * `docker/lambda/Dockerfile.dockerignore` that `npm run lambda:image` relies on.
 * Without this, the repo root (node_modules, .git, web/, cdk.out) would be
 * copied into cdk.out and uploaded. So the same allowlist is passed as
 * `exclude` (IgnoreMode.DOCKER), read from that one file so the two cannot drift.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LAMBDA_DOCKERFILE = 'docker/lambda/Dockerfile';
export const LAMBDA_DOCKERIGNORE = `${LAMBDA_DOCKERFILE}.dockerignore`;

/** dockerignore lines (comments and blanks removed), plus the Dockerfile itself, which CDK passes as `--file`. */
export function lambdaContextExcludes(repoRoot: string): string[] {
  const lines = readFileSync(join(repoRoot, LAMBDA_DOCKERIGNORE), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines[0] !== '**') {
    throw new Error(`${LAMBDA_DOCKERIGNORE} must start with "**" (allowlist); refusing to stage the whole repo.`);
  }
  return [...lines, `!${LAMBDA_DOCKERFILE}`, `!${LAMBDA_DOCKERIGNORE}`];
}
