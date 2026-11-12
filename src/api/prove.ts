/**
 * The proof API core (reanimation-lab design, "API contract"), independent of
 * transport so the Lambda handler and the local dev server share it:
 *
 * 1. `parseProveRequest` validates the raw body against the registry
 *    (Requirement 8.2). The transport answers 400 when it fails.
 * 2. `prove` runs one proof and emits NDJSON-ready events: `started`,
 *    `progress` at 4 Hz (Requirement 3.2), then `result` or `error`.
 *
 * The server fixes the case count and the 25 s cap (Requirement 3.6). Aborting
 * `signal` (the client went away) cancels the run and emits nothing further
 * (Requirement 3.5). No LLM or paid third-party API is called (Requirement 8.3).
 */
import { randomInt } from 'node:crypto';
import { CobolSession, GNUCOBOL_IMAGE, type CobolSessionOptions } from '../harness/cobol.js';
import { checkEquivalence, type EquivalenceResult, type Progress } from '../harness/equivalence.js';
import { findMutant, findProgram, type Program } from '../ports/registry.js';
import type { Mutant } from '../ports/mutant.js';

/** The only route, on both transports. */
export const PROVE_PATH = '/api/prove';

/** Cases per proof. Decided by the server, never by the client (Requirement 3.6). */
export const PROVE_NUM_RUNS = 2000;
/** Wall-clock cap per proof (Requirement 3.6). The Lambda timeout is 30 s. */
export const PROVE_TIME_LIMIT_MS = 25_000;
/** 4 Hz progress (Requirement 3.2). */
export const PROGRESS_INTERVAL_MS = 250;
/** Largest accepted request body, in UTF-8 bytes. */
export const MAX_BODY_BYTES = 1024;
/** Seeds are 32-bit signed integers, matching what the harness generates. */
const SEED_MIN = -(2 ** 31);
const SEED_MAX = 2 ** 31 - 1;
const ALLOWED_KEYS: ReadonlySet<string> = new Set(['program', 'mutant', 'seed']);

/** Labels for `reference`. The native runner runs the Lambda image's Debian gnucobol3 3.1.2 build. */
export const REFERENCE_LABELS = {
  docker: GNUCOBOL_IMAGE,
  native: 'gnucobol 3.1.2 (native)',
} as const;

export interface ProveRequest {
  readonly program: Program;
  readonly mutant?: Mutant;
  readonly seed?: number;
}

export type ParseResult =
  | { readonly ok: true; readonly request: ProveRequest }
  | { readonly ok: false; readonly status: 400; readonly message: string };

import type { ProveEvent } from './events.js';

export type { ProveErrorBody, ProveEvent, ProveRequestBody } from './events.js';

/** What happened, for the transport's logs. `error` is never sent to the client. */
export type ProveOutcome =
  | { readonly status: 'completed' | 'truncated'; readonly result: EquivalenceResult }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly error: unknown };

/** The subset of CobolSession that `prove` uses, so tests can supply a fake. */
export type ProveSession = Pick<CobolSession, 'send' | 'close'>;

export interface ProveOptions {
  readonly runner?: CobolSessionOptions['runner'];
  readonly binDir?: string;
  /** Overrides the reference label for the runner. */
  readonly reference?: string;
  /** Test seam. Defaults to `CobolSession.start`. */
  readonly startSession?: (program: string, options: CobolSessionOptions) => ProveSession;
}

/** Message sent to the client when the run fails. Details stay in server logs. */
export const RUN_FAILED_MESSAGE = 'The proof run failed before it could finish. This is not a divergence.';

const invalid = (message: string): ParseResult => ({ ok: false, status: 400, message });

/** Validate a raw request body. Anything not explicitly allowed is rejected. */
export function parseProveRequest(body: string | undefined): ParseResult {
  if (body === undefined || body === '') return invalid('Request body is required');
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return invalid(`Request body must be at most ${MAX_BODY_BYTES} bytes`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return invalid('Request body must be JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return invalid('Request body must be a JSON object');
  }
  const fields = parsed as Record<string, unknown>;
  const unknownKey = Object.keys(fields).find((key) => !ALLOWED_KEYS.has(key));
  if (unknownKey !== undefined) return invalid(`Unknown field: ${JSON.stringify(unknownKey).slice(0, 40)}`);

  const program = findProgram(fields.program);
  if (!program) return invalid('Unknown program');

  let mutant: Mutant | undefined;
  if ('mutant' in fields) {
    mutant = findMutant(program, fields.mutant);
    if (!mutant) return invalid('Unknown mutant for this program');
  }

  const { seed } = fields;
  if ('seed' in fields && (!Number.isInteger(seed) || (seed as number) < SEED_MIN || (seed as number) > SEED_MAX)) {
    return invalid('Seed must be a 32-bit integer');
  }

  return {
    ok: true,
    request: { program, ...(mutant ? { mutant } : {}), ...(seed === undefined ? {} : { seed: seed as number }) },
  };
}

/**
 * Run one proof. Never throws for run failures: they become an `error` event.
 * Always emits a final `progress` before `result`, because a fast proof can
 * finish before the first 250 ms tick.
 */
export async function prove(
  request: ProveRequest,
  emit: (event: ProveEvent) => void,
  signal: AbortSignal,
  options: ProveOptions = {},
): Promise<ProveOutcome> {
  if (signal.aborted) return { status: 'cancelled' };
  const started = performance.now();
  const elapsedMs = () => Math.round(performance.now() - started);
  const runner = options.runner ?? 'docker';
  const reference = options.reference ?? REFERENCE_LABELS[runner];
  const seed = request.seed ?? randomInt(SEED_MIN, SEED_MAX + 1);
  const { program, mutant } = request;

  const stop = new AbortController();
  let timedOut = false;
  const onCancel = () => stop.abort();
  signal.addEventListener('abort', onCancel, { once: true });
  const deadline = setTimeout(() => {
    timedOut = true;
    stop.abort();
  }, PROVE_TIME_LIMIT_MS);

  let latest: Progress = { executions: 0, divergences: 0 };
  let ticker: ReturnType<typeof setInterval> | undefined;
  let session: ProveSession | undefined;
  try {
    const startSession = options.startSession ?? CobolSession.start;
    session = startSession(program.id, { runner, ...(options.binDir === undefined ? {} : { binDir: options.binDir }) });
    emit({
      type: 'started',
      program: program.id,
      ...(mutant ? { mutant: mutant.id } : {}),
      seed,
      reference,
      numRuns: PROVE_NUM_RUNS,
    });
    ticker = setInterval(() => emit({ type: 'progress', ...latest, elapsedMs: elapsedMs() }), PROGRESS_INTERVAL_MS);

    const result = await checkEquivalence({
      program: program.id,
      session,
      port: mutant?.port ?? program.port,
      record: program.record,
      numRuns: PROVE_NUM_RUNS,
      seed,
      reference,
      signal: stop.signal,
      onProgress: (progress) => (latest = progress),
    });
    clearInterval(ticker);
    if (signal.aborted && !timedOut) return { status: 'cancelled' };
    emit({ type: 'progress', ...latest, elapsedMs: elapsedMs() });
    emit({ type: 'result', result });
    return { status: result.truncated ? 'truncated' : 'completed', result };
  } catch (error) {
    if (signal.aborted) return { status: 'cancelled' };
    emit({ type: 'error', message: RUN_FAILED_MESSAGE });
    return { status: 'failed', error };
  } finally {
    clearInterval(ticker);
    clearTimeout(deadline);
    signal.removeEventListener('abort', onCancel);
    // Closing stdin ends the COBOL process; a failed close must not mask the outcome.
    await session?.close().catch(() => undefined);
  }
}
