/**
 * Local smoke test of the proof API Lambda image (reanimation-lab task 20).
 * Local only: no AWS calls, no AWS resources.
 *
 * Runs the image under the Lambda Runtime Interface Emulator with Lambda's
 * constraints (read-only root, writable /tmp only, non-root user, 1,024 MB),
 * with `runtime-api-tap.ts` between the runtime interface client and the
 * emulator, and checks:
 *   1. the image does not set LAZARUS_RUNS or LAZARUS_SEED;
 *   2. its libcob4 is the reference image's (lazarus-gnucobol:3.1.2), if present;
 *   3. PAYROLL: 200 NDJSON with started, progress, and an equivalent result of 2,000 cases;
 *   3a. every progress line has `cases` and `phase`; the last one's cases equal the result's;
 *   4. PAYROLL half-up-tax mutant: diverged, with `shrinking` progress and a `shrinkPath`;
 *   5. a bad body: 400 with `{ error }`;
 *   6. the function sent the 200 responses in streaming mode (the tap's view);
 *   7. the function's logs are JSON with the request id and never the body;
 *   8. Node printed no deprecation warnings (run with --trace-deprecation).
 *
 * The emulator buffers its own HTTP front end (ADR 0001): the client gets the
 * whole response at the end, prelude bytes included. Timing of chunks is only
 * visible through the tap.
 *
 *   npm run lambda:image && npm run lambda:smoke
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE = process.env.LAZARUS_LAMBDA_IMAGE ?? 'lazarus-proof-api:local';
const REFERENCE_IMAGE = 'lazarus-gnucobol:3.1.2';
const CONTAINER = 'lazarus-proof-api-smoke';
const PORT = 9000;
const INVOKE_URL = `http://127.0.0.1:${PORT}/2015-03-31/functions/function/invocations`;
const RIE_DIR = join(homedir(), '.aws-lambda-rie');
const RIE_BINARY = join(RIE_DIR, 'aws-lambda-rie');
/** Runtime Interface Emulator v1.38, arm64 (ADR 0001). */
const RIE_SHA256 = '65ade4687c22c308ff7acac6974d088d8aafaadea59e61985a083bad86f921d2';
const TAP = fileURLToPath(new URL('./lambda/runtime-api-tap.ts', import.meta.url));
const PRELUDE_DELIMITER = '\0'.repeat(8);

const failures: string[] = [];
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(label);
}

function docker(args: string[], allowFailure = false): string {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`docker ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const libcobVersion = (image: string) =>
  docker(['run', '--rm', '--network', 'none', '--entrypoint', 'dpkg-query', image, '-W', '-f=${Version}', 'libcob4']);

function preflight(): void {
  if (!existsSync(RIE_BINARY)) {
    throw new Error(
      `Runtime Interface Emulator not found at ${RIE_BINARY}. Download v1.38 (see docs/adr/0001-proof-api-response-streaming.md, "Reproduce").`,
    );
  }
  const hash = createHash('sha256').update(readFileSync(RIE_BINARY)).digest('hex');
  if (hash !== RIE_SHA256) throw new Error(`${RIE_BINARY} has sha256 ${hash}, expected ${RIE_SHA256}`);
  docker(['image', 'inspect', IMAGE]);
}

interface Invocation {
  readonly prelude: { statusCode?: number; headers?: Record<string, string> };
  readonly body: string;
  readonly ms: number;
}

/** Wrap a body in a Function URL (payload 2.0) event and invoke through the emulator. */
async function invoke(body: string, path = '/api/prove'): Promise<Invocation> {
  const event = {
    version: '2.0',
    rawPath: path,
    headers: { 'content-type': 'application/json' },
    requestContext: { http: { method: 'POST', path } },
    body: Buffer.from(body).toString('base64'),
    isBase64Encoded: true,
  };
  const started = performance.now();
  const response = await fetch(INVOKE_URL, { method: 'POST', body: JSON.stringify(event) });
  const raw = await response.text();
  const ms = Math.round(performance.now() - started);
  const split = raw.indexOf(PRELUDE_DELIMITER);
  if (split === -1) throw new Error(`No response prelude in: ${raw.slice(0, 200)}`);
  return { prelude: JSON.parse(raw.slice(0, split)) as Invocation['prelude'], body: raw.slice(split + PRELUDE_DELIMITER.length), ms };
}

type Line = { type: string; result?: { status: string; cases: number; seed: number }; [key: string]: unknown };
const lines = (body: string) =>
  body
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);

async function waitForEmulator(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Emulator did not start');
}

async function main(): Promise<void> {
  preflight();

  const env = JSON.parse(docker(['image', 'inspect', IMAGE, '--format', '{{json .Config.Env}}'])) as string[];
  check(!env.some((e) => /^LAZARUS_(RUNS|SEED)=/.test(e)), 'image does not set LAZARUS_RUNS or LAZARUS_SEED', env);

  const lambdaLibcob = libcobVersion(IMAGE);
  if (docker(['image', 'inspect', REFERENCE_IMAGE], true)) {
    const referenceLibcob = libcobVersion(REFERENCE_IMAGE);
    check(lambdaLibcob === referenceLibcob, `libcob4 matches ${REFERENCE_IMAGE}`, { lambda: lambdaLibcob, reference: referenceLibcob });
  } else {
    console.log(`SKIP  libcob4 comparison: ${REFERENCE_IMAGE} not built (npm run cobol:image)`);
  }

  docker(['rm', '-f', CONTAINER], true);
  docker([
    'run', '-d', '--name', CONTAINER,
    '-p', `127.0.0.1:${PORT}:8080`,
    '--read-only', '--tmpfs', '/tmp', '--user', '993:990', '--memory', '1024m', '--network', 'bridge',
    '-v', `${RIE_DIR}:/aws-lambda:ro`,
    '-v', `${TAP}:/smoke/runtime-api-tap.ts:ro`,
    '-e', 'NODE_OPTIONS=--trace-deprecation',
    '--entrypoint', '/aws-lambda/aws-lambda-rie',
    IMAGE,
    '/bin/sh', '-c',
    // The emulator sets _HANDLER to this whole command line; Lambda sets it from CMD.
    'node /smoke/runtime-api-tap.ts & sleep 0.5; export _HANDLER=index.handler AWS_LAMBDA_RUNTIME_API=127.0.0.1:9002; exec node /var/task/node_modules/aws-lambda-ric/index.mjs index.handler',
  ]);
  try {
    await waitForEmulator();

    const proof = await invoke(JSON.stringify({ program: 'PAYROLL', seed: 123 }));
    const proofLines = lines(proof.body);
    const result = proofLines.at(-1)?.result;
    check(proof.prelude.statusCode === 200, 'PAYROLL: status 200', proof.prelude.statusCode);
    check(proof.prelude.headers?.['content-type'] === 'application/x-ndjson', 'PAYROLL: content-type application/x-ndjson', proof.prelude.headers);
    check(proof.prelude.headers?.['cache-control'] === 'no-store', 'PAYROLL: cache-control no-store');
    check(proofLines[0]?.type === 'started' && proofLines[0].reference === 'gnucobol 3.1.2 (native)', 'PAYROLL: started, native reference', proofLines[0]);
    check(proofLines.some((l) => l.type === 'progress'), 'PAYROLL: at least one progress line', proofLines.filter((l) => l.type === 'progress').length);
    check(result?.status === 'equivalent' && result.cases === 2000 && result.seed === 123, 'PAYROLL: equivalent, 2,000 cases, seed 123', {
      ...result && { status: result.status, cases: result.cases, seed: result.seed },
      ms: proof.ms,
    });

    // graphical-proof Requirements 1.4, 1.5: every progress line carries cases and phase.
    const progressOk = (all: Line[]) =>
      all
        .filter((l) => l.type === 'progress')
        .every((l) => Number.isSafeInteger(l.cases) && (l.cases as number) >= 0 && (l.phase === 'generating' || l.phase === 'shrinking'));
    const lastProgress = proofLines.filter((l) => l.type === 'progress').at(-1);
    check(progressOk(proofLines) && lastProgress?.cases === result?.cases, 'PAYROLL: progress has cases and phase; last cases = result cases', {
      last: lastProgress && { cases: lastProgress.cases, phase: lastProgress.phase },
    });

    const mutant = await invoke(JSON.stringify({ program: 'PAYROLL', mutant: 'half-up-tax', seed: 123 }));
    const mutantLines = lines(mutant.body);
    const mutantResult = mutantLines.at(-1)?.result;
    check(mutant.prelude.statusCode === 200 && mutantResult?.status === 'diverged', 'PAYROLL half-up-tax: diverged', {
      status: mutantResult?.status,
      cases: mutantResult?.cases,
      ms: mutant.ms,
    });
    // graphical-proof Requirements 1.2, 2.1: the shrinking phase is reported and the result has a shrink path.
    const shrinkPath = (mutantResult as { shrinkPath?: { total: number; steps: { step: number }[] } } | undefined)?.shrinkPath;
    check(
      progressOk(mutantLines) &&
        mutantLines.some((l) => l.type === 'progress' && l.phase === 'shrinking') &&
        shrinkPath !== undefined &&
        shrinkPath.steps.length > 0 &&
        shrinkPath.steps.at(-1)?.step === shrinkPath.total - 1,
      'PAYROLL half-up-tax: shrinking progress and a shrinkPath ending at the counterexample',
      shrinkPath && { total: shrinkPath.total, steps: shrinkPath.steps.length },
    );

    const bad = await invoke(JSON.stringify({ program: 'PAYROLL', seed: 'hunter2' }));
    check(
      bad.prelude.statusCode === 400 && typeof (JSON.parse(bad.body) as { error?: unknown }).error === 'string',
      'bad body: 400 with { error }',
      { status: bad.prelude.statusCode, body: bad.body },
    );

    const logged = spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' });
    const output = `${logged.stdout}\n${logged.stderr}`;
    const tap = output.split('\n').filter((l) => l.startsWith('[tap] POST') && l.includes('/response'));
    check(
      tap.length >= 3 && tap.every((l) => l.includes('mode=streaming') && l.includes('transfer-encoding=chunked')),
      'runtime interface client sent every response in streaming mode (chunked)',
      tap.length,
    );
    const chunkLines = output.split('\n').filter((l) => l.startsWith('[tap] chunk'));
    console.log(`      tap: ${chunkLines.length} response chunks; first PAYROLL run: ${chunkLines.slice(0, 6).map((l) => l.replace('[tap] ', '')).join(' | ')}`);

    const logs = output
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const finished = logs.filter((l) => l.msg === 'proof finished');
    check(
      finished.length === 2 && finished.every((l) => typeof l.requestId === 'string' && l.requestId !== ''),
      'logs: JSON "proof finished" lines with the request id',
      finished.map((l) => ({ requestId: l.requestId, result: l.result, cases: l.cases })),
    );
    check(logs.some((l) => l.msg === 'request rejected' && l.status === 400), 'logs: the 400 is logged as rejected');
    check(!output.includes('hunter2') && !output.includes('"body"'), 'logs: no request body');
    const deprecations = output.split('\n').filter((l) => /DeprecationWarning|\bDEP0\d{3}\b/.test(l));
    check(deprecations.length === 0, 'logs: no Node deprecation warnings', deprecations);
  } finally {
    docker(['rm', '-f', CONTAINER], true);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed');
  }
}

await main();
