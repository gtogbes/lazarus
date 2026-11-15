/**
 * Pure numbers for the Resurrection_Fill (graphical-proof design, "fill.ts").
 *
 * The slab fills in proportion to cases passed out of numRuns (Requirement 8.1).
 * The percentage rounds down to 0.1%, so it reads 100% only when every case
 * passed: 1,999 of 2,000 is 99.9%, never a rounded-up 100% (Requirement 8.2).
 */
import { COUNT_FORMAT } from '../proof/proofMessages';

/** Clamp to whole cases in [0, total]; a non-positive or non-finite total counts as none. */
function clampCases(passed: number, total: number): { passed: number; total: number } {
  const t = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const p = Number.isFinite(passed) ? Math.min(Math.max(Math.floor(passed), 0), t) : 0;
  return { passed: p, total: t };
}

/** Lit share of the silhouette, in [0, 1]. */
export function fillFraction(passed: number, total: number): number {
  const c = clampCases(passed, total);
  return c.total === 0 ? 0 : c.passed / c.total;
}

/**
 * Percentage in tenths, rounded down. Integer arithmetic: 1000 × passed / total is
 * exact whenever the true value is a whole number, so the floor never drops a tenth.
 */
function percentTenths(passed: number, total: number): number {
  return total === 0 ? 0 : Math.floor((1000 * passed) / total);
}

/** "62.5%", "50%", "100%": one decimal place, without a trailing ".0". */
function formatTenths(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  const tenth = tenths % 10;
  return tenth === 0 ? `${whole}%` : `${whole}.${tenth}%`;
}

/** "1,240 / 2,000 cases passed (62%)" (Requirement 8.1). */
export function fillText(passed: number, total: number): string {
  const c = clampCases(passed, total);
  const percent = formatTenths(percentTenths(c.passed, c.total));
  return `${COUNT_FORMAT.format(c.passed)} / ${COUNT_FORMAT.format(c.total)} cases passed (${percent})`;
}
