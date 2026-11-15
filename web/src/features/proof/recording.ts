/**
 * Recorded proofs (Requirement 6), written by scripts/record-proofs.ts and shipped
 * with the site at `recorded/<PROG>.json` (real port) and
 * `recorded/<PROG>.<mutant>.json` (mutant). A recording is the event stream of a
 * real proof run, so the store can replay it through the same fields as a live run:
 *
 *   { "version": 1 | 2, "events": [started, progress..., result] }
 *
 * Version 2 (graphical-proof Requirement 3) requires `cases` and `phase` on
 * every progress event and a valid `shrinkPath` on a diverged result. Version 1
 * has neither; the store derives them (progressModel.ts). Progress of either
 * version goes through the same cross-event checks as a live stream.
 *
 * The date shown for a recording is its result's `generatedAt`. Files are
 * untrusted input: every event goes through parseProveEvent, and anything that
 * does not form one complete run is rejected.
 */
import type { ProveEvent } from '../../../../src/api/events';
import type { EquivalenceResult } from '../../../../src/harness/equivalence.types';
import { applyProgress, INITIAL_PROGRESS_STATE } from './progressModel';
import { parseProveEvent } from './proveEvent';

/** The newest version (scripts/record-proofs.ts switches to it in graphical-proof task 4.2). */
export const RECORDING_VERSION = 2;
export const RECORDING_VERSIONS: readonly number[] = [1, 2];
/**
 * Version 2 snapshots every 20 ms. The slowest recorded proof takes about
 * 0.7 s, about 35 events, so 500 still allows a 10 s run.
 */
export const MAX_RECORDED_EVENTS = 500;

type Started = Extract<ProveEvent, { type: 'started' }>;
type ProgressEvent = Extract<ProveEvent, { type: 'progress' }>;

export interface Recording {
  readonly started: Started;
  /** In order, with non-decreasing `elapsedMs`. */
  readonly progress: readonly ProgressEvent[];
  readonly result: EquivalenceResult;
}

export interface RecordingTarget {
  readonly program: string;
  /** Null or absent for the real port. */
  readonly mutant?: string | null;
}

/** File name of a recording, relative to `recorded/`. Shared with scripts/record-proofs.ts by convention. */
export function recordingFileName({ program, mutant }: RecordingTarget): string {
  return mutant == null ? `${program}.json` : `${program}.${mutant}.json`;
}

export function recordingUrl(target: RecordingTarget): string {
  return `${import.meta.env.BASE_URL}recorded/${encodeURIComponent(recordingFileName(target))}`;
}

/**
 * The recording, or null if the value is not one complete run. With `expected`,
 * the recording must also be for exactly that program and mutant, so a misplaced
 * file is never replayed under the wrong label.
 */
export function parseRecording(value: unknown, expected?: RecordingTarget): Recording | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { version, events } = value as Record<string, unknown>;
  if (typeof version !== 'number' || !RECORDING_VERSIONS.includes(version) || !Array.isArray(events)) return null;
  if (events.length < 2 || events.length > MAX_RECORDED_EVENTS) return null;

  const parsed = events.map(parseProveEvent);
  const first = parsed[0];
  const last = parsed.at(-1);
  if (first?.type !== 'started' || last?.type !== 'result') return null;

  const progress: ProgressEvent[] = [];
  let state = INITIAL_PROGRESS_STATE;
  for (const event of parsed.slice(1, -1)) {
    if (event?.type !== 'progress' || event.elapsedMs < state.elapsedMs) return null;
    if (version === 2 && (event.cases === undefined || event.phase === undefined)) return null;
    const next = applyProgress(state, event, first.numRuns);
    if (!next) return null;
    state = next;
    progress.push(event);
  }

  const { result } = last;
  // parseProveEvent drops an invalid shrinkPath, so none here means missing or invalid.
  if (version === 2 && (state.cases > result.cases || (result.status === 'diverged' && !result.shrinkPath))) {
    return null;
  }
  if (result.program !== first.program || result.seed !== first.seed || result.reference !== first.reference) return null;
  if (Number.isNaN(Date.parse(result.generatedAt))) return null;
  if (expected) {
    if (first.program !== expected.program) return null;
    if ((first.mutant ?? null) !== (expected.mutant ?? null)) return null;
  }
  return { started: first, progress, result };
}

/**
 * How long a recording may take to arrive. Recordings are a few tens of KB from
 * the same origin; a server that accepts the request and never answers (a
 * stopped dev server, a stuck proxy) would otherwise leave the replay waiting
 * for ever.
 */
export const RECORDING_TIMEOUT_MS = 10_000;

/**
 * Fetch and validate a recording. Resolves null when there is none, it is
 * invalid (a missing file on the dev server comes back as index.html, which is
 * not JSON), or it has not fully arrived within `timeoutMs`. Aborts of `signal`
 * propagate.
 */
export async function fetchRecording(
  target: RecordingTarget,
  signal?: AbortSignal,
  timeoutMs = RECORDING_TIMEOUT_MS,
): Promise<Recording | null> {
  const request = new AbortController();
  const stop = () => request.abort();
  if (signal?.aborted) stop();
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(recordingUrl(target), { signal: request.signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
    if (!response.ok) return null;
    try {
      return parseRecording(await response.json(), target);
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
