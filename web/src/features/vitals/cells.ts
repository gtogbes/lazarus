/**
 * Cell states for the Case_Grid (graphical-proof design, "cells.ts").
 *
 * The grid draws one cell per case the server runs (`numRuns` from `started`,
 * Requirement 7.1). Cells count cases, not executions: shrinking attempts never
 * fill a cell (Requirement 7.2). fast-check stops at the first failing case, so on
 * a divergence every earlier case passed, the last case run is the failing cell and
 * every later cell is not run (Requirement 7.3). A truncated run leaves the
 * remaining cells not run (Requirement 7.4).
 *
 * The failing cell shows from the moment the divergence is found: the switch to
 * the `shrinking` phase (Requirement 1.2), the same moment the heartbeat flatlines
 * (4.3), and stays on Relapsed. An error or cancelled run is never a divergence,
 * even if it stopped while shrinking: its cells are passed or not run, with no red
 * cell (design, "Error handling").
 *
 * Pure: the CaseGrid calls it on each frame and for its caption, so the drawn
 * cells and the text counts always agree.
 */
import type { ProofPhase } from '../../../../src/harness/equivalence.types';
import type { ProofStatus } from '../proof/useProofRun';

export interface CellStates {
  /** Cells drawn: `numRuns`. */
  readonly total: number;
  /** Cells 0 .. passed - 1 are green. */
  readonly passed: number;
  /** Index of the red ✗ cell (`passed`), or null when nothing diverged. */
  readonly failedIndex: number | null;
  /** Cells after the passed and failing ones. */
  readonly notRun: number;
  /** The run stopped at the 25 s limit (Requirement 7.4). */
  readonly truncated: boolean;
}

/** A non-negative integer no larger than `max`; anything else (NaN, negative, fractional) is clamped down. */
function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), max);
}

/**
 * Counts and the failing index for a grid of `numRuns` cells after `cases` cases.
 * `cases` above `numRuns` is clamped, so the counts always add up to `total`.
 */
export function cellStates(
  numRuns: number,
  cases: number,
  status: ProofStatus,
  truncated: boolean,
  phase: ProofPhase,
): CellStates {
  const total = clampCount(numRuns, Number.MAX_SAFE_INTEGER);
  const run = clampCount(cases, total);
  const diverged = run > 0 && (status === 'relapsed' || (status === 'reanimating' && phase === 'shrinking'));
  const passed = diverged ? run - 1 : run;
  const failedIndex = diverged ? run - 1 : null;
  return { total, passed, failedIndex, notRun: total - run, truncated };
}
