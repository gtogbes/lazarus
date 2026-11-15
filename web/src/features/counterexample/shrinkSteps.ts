/**
 * Requirement 5.1, 5.2 and 5.5: the data behind the Shrink viewer.
 *
 * `shrinkSteps` turns each stored step of a Shrink_Path into its first
 * differing record, decoded with the program's input layout, plus the record
 * count and the fields that changed since the previous stored step.
 * `stepTimings` spaces the animation out (about 400 ms per step and 120 ms per
 * changed field) and scales it down so all steps play within 10 s.
 *
 * Pure: no React, no DOM, so the viewer and the tests share it.
 */
import type { ShrinkPath } from '../../../../src/harness/equivalence.types';
import { decodeRecord, type DecodedRecord, type RecordLayout } from '../../../../src/semantics/layout';

export interface ShrinkStepView {
  /** Real step index (0 = first failure, total - 1 = counterexample). */
  readonly step: number;
  /** 0-based index of the record shown, `records[line]` of the step. */
  readonly line: number;
  /** Records in this step's failing input. */
  readonly recordCount: number;
  readonly record: DecodedRecord;
  /**
   * Indices into `record.fields` whose raw text differs from the previous
   * stored step, in layout order. Indices, not names, because a layout may
   * repeat FILLER. Empty for the first step.
   */
  readonly changed: readonly number[];
}

export function shrinkSteps(path: ShrinkPath, inputLayout: RecordLayout): ShrinkStepView[] {
  let previous: DecodedRecord | undefined;
  return path.steps.map((s) => {
    // A valid path always has records[line]; '' keeps the decoder total if not.
    const record = decodeRecord(inputLayout, s.records[s.line] ?? '');
    const before = previous;
    const changed: number[] = [];
    if (before !== undefined) {
      record.fields.forEach((f, i) => {
        if (f.raw !== before.fields[i]?.raw) changed.push(i);
      });
    }
    previous = record;
    return { step: s.step, line: s.line, recordCount: s.records.length, record, changed };
  });
}

export const STEP_MS = 400;
export const FIELD_MS = 120;
export const MAX_TOTAL_MS = 10_000;

export interface StepTiming {
  /** Time on this step, field cross-fades included. */
  readonly durationMs: number;
  /** Time for each changed field's cross-fade, one field at a time. */
  readonly fieldMs: number;
}

/**
 * One timing per step, from each step's changed-field count. Unscaled, a step
 * takes STEP_MS + FIELD_MS per changed field; when that totals more than
 * MAX_TOTAL_MS, every duration is scaled by the same factor.
 */
export function stepTimings(changedCounts: readonly number[]): StepTiming[] {
  const counts = changedCounts.map((n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0));
  const raw = counts.reduce((sum, n) => sum + STEP_MS + FIELD_MS * n, 0);
  const scale = raw > MAX_TOTAL_MS ? MAX_TOTAL_MS / raw : 1;
  // Whole milliseconds, rounded down, so float error cannot push the total past
  // the cap, and a step's field cross-fades still fit inside its duration.
  return counts.map((n) => ({
    durationMs: Math.floor((STEP_MS + FIELD_MS * n) * scale),
    fieldMs: Math.floor(FIELD_MS * scale),
  }));
}
