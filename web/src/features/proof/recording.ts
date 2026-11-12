/**
 * Recorded proofs (Requirement 6), written by scripts/record-proofs.ts and shipped
 * with the site at `recorded/<PROG>.json` (real port) and
 * `recorded/<PROG>.<mutant>.json` (mutant). A recording is the event stream of a
 * real proof run, so the store can replay it through the same fields as a live run:
 *
 *   { "version": 1, "events": [started, progress..., result] }
 *
 * The date shown for a recording is its result's `generatedAt`. Files are
 * untrusted input: every event goes through parseProveEvent, and anything that
 * does not form one complete run is rejected.
 */
import type { ProveEvent } from '../../../../src/api/events';
import type { EquivalenceResult } from '../../../../src/harness/equivalence.types';
import { parseProveEvent } from './proveEvent';

export const RECORDING_VERSION = 1;
/** 25 s at 4 Hz is about 100 snapshots; anything far beyond that is not a recording. */
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
  if (version !== RECORDING_VERSION || !Array.isArray(events)) return null;
  if (events.length < 2 || events.length > MAX_RECORDED_EVENTS) return null;

  const parsed = events.map(parseProveEvent);
  const first = parsed[0];
  const last = parsed.at(-1);
  if (first?.type !== 'started' || last?.type !== 'result') return null;

  const progress: ProgressEvent[] = [];
  let previousMs = 0;
  for (const event of parsed.slice(1, -1)) {
    if (event?.type !== 'progress' || event.elapsedMs < previousMs) return null;
    previousMs = event.elapsedMs;
    progress.push(event);
  }

  const { result } = last;
  if (result.program !== first.program || result.seed !== first.seed || result.reference !== first.reference) return null;
  if (Number.isNaN(Date.parse(result.generatedAt))) return null;
  if (expected) {
    if (first.program !== expected.program) return null;
    if ((first.mutant ?? null) !== (expected.mutant ?? null)) return null;
  }
  return { started: first, progress, result };
}

/**
 * Fetch and validate a recording. Resolves null when there is none or it is
 * invalid (a missing file on the dev server comes back as index.html, which is
 * not JSON). Aborts propagate.
 */
export async function fetchRecording(target: RecordingTarget, signal?: AbortSignal): Promise<Recording | null> {
  let response: Response;
  try {
    response = await fetch(recordingUrl(target), signal ? { signal } : {});
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
}
