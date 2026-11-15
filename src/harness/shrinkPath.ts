/**
 * Shrink path recording, sampling and validation (graphical-proof
 * Requirement 2). Import-free apart from types, so the web app and the record
 * script can reuse `validateShrinkPath`.
 *
 * Each failing call of the equivalence property is one entry of fast-check's
 * `details.failures`, so recording them in order gives the path from the first
 * failure (step 0) to the counterexample (step total - 1).
 */
import type { EquivalenceResult, ShrinkPath, ShrinkStep } from './equivalence.types.js';

/** Most steps stored in a Shrink_Path. */
export const MAX_SHRINK_STEPS = 24;
/** Most UTF-8 bytes of JSON-encoded records across the stored steps. */
export const MAX_SHRINK_PATH_BYTES = 16_384;
/** Most failing inputs the recorder holds in memory. */
export const MAX_RECORDED_FAILURES = 2_048;

export interface ShrinkCaps {
  readonly maxSteps: number;
  readonly maxBytes: number;
}

const DEFAULT_CAPS: ShrinkCaps = { maxSteps: MAX_SHRINK_STEPS, maxBytes: MAX_SHRINK_PATH_BYTES };

/** UTF-8 size of a step's records as JSON. */
function recordBytes(step: ShrinkStep): number {
  const json = JSON.stringify(step.records);
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < json.length) {
      const next = json.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function totalBytes(steps: readonly ShrinkStep[]): number {
  return steps.reduce((sum, step) => sum + recordBytes(step), 0);
}

/**
 * Holds failing inputs in push order, at most `capacity` at a time. When full
 * it keeps every other held step and doubles the stride, so it always holds
 * step 0, evenly spaced steps with their real indices, and the latest step.
 */
export class ShrinkRecorder {
  #held: ShrinkStep[] = [];
  /** The latest step when it is not on the stride, so not in `#held`. */
  #tail: ShrinkStep | undefined;
  #stride = 1;
  #total = 0;

  constructor(readonly capacity: number = MAX_RECORDED_FAILURES) {
    if (!Number.isSafeInteger(capacity) || capacity < 2) throw new RangeError('capacity must be an integer >= 2');
  }

  /** Failing inputs pushed so far. */
  get total(): number {
    return this.#total;
  }

  /** Steps held in memory, never more than `capacity`. */
  get size(): number {
    return this.#held.length + (this.#tail ? 1 : 0);
  }

  push(failure: { readonly records: readonly string[]; readonly line: number }): void {
    const step: ShrinkStep = { step: this.#total++, records: [...failure.records], line: failure.line };
    this.#tail = undefined;
    // Leave one slot for the tail, so held + tail never exceeds capacity.
    if (step.step % this.#stride === 0 && this.#held.length === this.capacity - 1) {
      this.#stride *= 2;
      this.#held = this.#held.filter((s) => s.step % this.#stride === 0);
    }
    if (step.step % this.#stride === 0) this.#held.push(step);
    else this.#tail = step;
  }

  /** Held steps in order; the last is the latest pushed. */
  steps(): ShrinkStep[] {
    return this.#tail ? [...this.#held, this.#tail] : [...this.#held];
  }

  /** The held steps sampled within the caps; undefined when the last step alone exceeds the byte cap. */
  path(caps: ShrinkCaps = DEFAULT_CAPS): ShrinkPath | undefined {
    return sampleShrinkPath(this.steps(), this.#total, caps);
  }
}

/**
 * Sample steps (in order, with real indices, the last being step total - 1)
 * down to the caps. Keeps the last step and the first step. With more than
 * `maxSteps`, keeps `maxSteps - 2` evenly spaced interior steps. Then drops
 * interior steps nearest the middle until the records fit `maxBytes`. If the
 * first and last steps alone do not fit, keeps only the last. If the last step
 * alone does not fit, returns undefined: there is no path to show.
 */
export function sampleShrinkPath(
  steps: readonly ShrinkStep[],
  total: number,
  caps: ShrinkCaps = DEFAULT_CAPS,
): ShrinkPath | undefined {
  const last = steps.at(-1);
  if (last === undefined) return { total, steps: [] };
  if (recordBytes(last) > caps.maxBytes) return undefined;
  const first = steps[0]!;
  if (steps.length === 1 || caps.maxSteps < 2) return { total, steps: [last] };

  let interior = steps.slice(1, -1);
  const room = caps.maxSteps - 2;
  if (interior.length > room) {
    const m = interior.length;
    // (j + 1) * m / (room + 1) grows by at least 1 because m > room, so the picks are distinct.
    interior = Array.from({ length: room }, (_, j) => interior[Math.floor(((j + 1) * m) / (room + 1))]!);
  }
  let bytes = recordBytes(first) + recordBytes(last) + totalBytes(interior);
  while (bytes > caps.maxBytes && interior.length > 0) {
    const [dropped] = interior.splice(Math.floor(interior.length / 2), 1);
    bytes -= recordBytes(dropped!);
  }
  if (bytes > caps.maxBytes) return { total, steps: [last] };
  return { total, steps: [first, ...interior, last] };
}

const isIndex = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/**
 * Problems with a received Shrink_Path for `result`; empty when valid
 * (Requirement 2.8). `path` is untrusted, for example parsed JSON.
 */
export function validateShrinkPath(
  path: unknown,
  result: Pick<EquivalenceResult, 'shrinks' | 'counterexample'>,
  caps: ShrinkCaps = DEFAULT_CAPS,
): string[] {
  if (typeof path !== 'object' || path === null) return ['shrinkPath is not an object'];
  const { total, steps } = path as { total?: unknown; steps?: unknown };
  const problems: string[] = [];
  if (!isIndex(total) || total < 1) problems.push('total is not a positive integer');
  else if (total !== result.shrinks + 1) problems.push(`total ${total} is not shrinks + 1 (${result.shrinks + 1})`);
  if (!Array.isArray(steps)) return [...problems, 'steps is not an array'];
  if (steps.length === 0) problems.push('steps is empty');
  if (steps.length > caps.maxSteps) problems.push(`more than ${caps.maxSteps} steps`);

  const valid: ShrinkStep[] = [];
  steps.forEach((s: unknown, i) => {
    const { step, records, line } = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
    if (!isIndex(step)) problems.push(`step ${i}: index is not a non-negative integer`);
    else if (!Array.isArray(records) || records.length === 0 || !records.every((r) => typeof r === 'string')) {
      problems.push(`step ${i}: records are not a non-empty list of strings`);
    } else if (!isIndex(line) || line >= records.length) problems.push(`step ${i}: line is out of range`);
    else valid.push({ step, records: records as string[], line });
  });
  if (valid.length !== steps.length) return problems;

  for (let i = 1; i < valid.length; i++) {
    if (valid[i]!.step <= valid[i - 1]!.step) problems.push(`step ${i}: index does not increase`);
  }
  const first = valid[0];
  const last = valid.at(-1);
  if (first && valid.length > 1 && first.step !== 0) problems.push('first step is not 0');
  if (last && isIndex(total) && last.step !== total - 1) problems.push('last step is not total - 1');
  if (totalBytes(valid) > caps.maxBytes) problems.push(`records exceed ${caps.maxBytes} bytes`);
  const expected = result.counterexample?.records;
  if (!expected) problems.push('result has no counterexample');
  else if (last && (last.records.length !== expected.length || last.records.some((r, i) => r !== expected[i]))) {
    problems.push("last step's records are not the counterexample's");
  }
  return problems;
}
