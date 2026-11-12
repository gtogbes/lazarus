/**
 * The hosted proof must use the identical COBOL reference as local
 * development (reanimation-lab design, "Reference build in Lambda"). Fails if
 * docker/lambda/Dockerfile drifts from docker/gnucobol/Dockerfile.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const reference = read('docker/gnucobol/Dockerfile');
const lambda = read('docker/lambda/Dockerfile');

function only(text: string, pattern: RegExp, what: string): string {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) throw new Error(`Expected exactly one ${what}, found ${matches.length}`);
  return matches[0][1];
}

const referenceBase = only(reference, /^FROM\s+(\S+)/gm, 'FROM in docker/gnucobol/Dockerfile');
const referenceGnucobol = only(reference, /gnucobol3=(\S+)/g, 'gnucobol3 pin in docker/gnucobol/Dockerfile');
const lambdaBase = only(lambda, /^ARG DEBIAN_IMAGE=(\S+)$/gm, 'DEBIAN_IMAGE in docker/lambda/Dockerfile');
const lambdaGnucobol = only(lambda, /^ARG GNUCOBOL_VERSION=(\S+)$/gm, 'GNUCOBOL_VERSION in docker/lambda/Dockerfile');

describe('Lambda image reference build', () => {
  it('pins the reference base image by digest', () => {
    expect(referenceBase).toMatch(/^debian:bookworm-slim@sha256:[0-9a-f]{64}$/);
  });

  it('uses the same base image digest as the reference', () => {
    expect(lambdaBase).toBe(referenceBase);
  });

  it('uses the same gnucobol3 package version as the reference', () => {
    expect(lambdaGnucobol).toBe(referenceGnucobol);
  });

  it('builds the COBOL stage and the runtime stage from that base, with that version', () => {
    const debianStages = [...lambda.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]).filter((from) => from?.startsWith('${DEBIAN_IMAGE}'));
    expect(debianStages).toEqual(['${DEBIAN_IMAGE}', '${DEBIAN_IMAGE}']);
    expect(lambda).toContain('gnucobol3=${GNUCOBOL_VERSION}');
    expect(lambda).toContain('libcob4=${GNUCOBOL_VERSION}');
    expect(lambda).not.toMatch(/(gnucobol3|libcob4)=(?!\$\{GNUCOBOL_VERSION\})/);
  });

  it('does not bake in harness overrides', () => {
    expect(lambda).not.toMatch(/LAZARUS_(RUNS|SEED)/);
  });
});
