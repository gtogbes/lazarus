/**
 * Progress across events (graphical-proof Requirement 1.7, 1.8). Pure, so the
 * store, the recording checks and the tests share one set of rules.
 *
 * `parseProveEvent` already checks what one event can show (both fields or
 * neither, a known phase, `cases <= executions`). This module checks what
 * needs the run so far: `cases` within `numRuns`, `cases` never decreasing,
 * and no return from `shrinking` to `generating`. An event that fails is
 * rejected (null), and the caller ignores it as it ignores any invalid event.
 *
 * Events with neither field come from older servers and version 1 recordings.
 * Their phase becomes `shrinking` once divergences exceed 0, and their cases
 * follow executions while generating. Once shrinking, executions also count
 * shrink attempts, so the derived cases stay at the last generating count
 * until `finalizeProgress` sets the result's count.
 */
import type { ProgressEvent } from '../../../../src/api/events';
import type { EquivalenceResult, ProofPhase } from '../../../../src/harness/equivalence.types';

export interface ProgressState {
  /** Includes shrink attempts. */
  readonly executions: number;
  readonly divergences: number;
  readonly elapsedMs: number;
  /** Generated cases, including the first failure. From events, or derived for legacy events. */
  readonly cases: number;
  readonly phase: ProofPhase;
}

export const INITIAL_PROGRESS_STATE: ProgressState = {
  executions: 0,
  divergences: 0,
  elapsedMs: 0,
  cases: 0,
  phase: 'generating',
};

type ProgressInput = Omit<ProgressEvent, 'type'>;

/**
 * The state after `event`, or null if the event's `cases` or `phase` conflicts
 * with the run so far. `numRuns` is null before the `started` event, when the
 * bound cannot be checked yet.
 */
export function applyProgress(state: ProgressState, event: ProgressInput, numRuns: number | null): ProgressState | null {
  const { executions, divergences, elapsedMs } = event;
  if (event.cases === undefined || event.phase === undefined) {
    const phase: ProofPhase = state.phase === 'shrinking' || divergences > 0 ? 'shrinking' : 'generating';
    const derived = phase === 'generating' ? Math.min(executions, numRuns ?? executions) : state.cases;
    return { executions, divergences, elapsedMs, cases: Math.max(state.cases, derived), phase };
  }
  const { cases, phase } = event;
  if (numRuns !== null && cases > numRuns) return null;
  if (cases < state.cases) return null;
  if (state.phase === 'shrinking' && phase === 'generating') return null;
  return { executions, divergences, elapsedMs, cases, phase };
}

/**
 * The state once the result arrives: the result's case count is final
 * (Requirement 1.5, 1.8). A diverged result is in the shrinking phase even
 * when no progress event said so.
 */
export function finalizeProgress(state: ProgressState, result: EquivalenceResult): ProgressState {
  return {
    ...state,
    cases: result.cases,
    phase: result.status === 'diverged' ? 'shrinking' : state.phase,
  };
}
