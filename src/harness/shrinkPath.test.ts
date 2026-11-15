import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ShrinkStep } from './equivalence.types.js';
import {
  MAX_RECORDED_FAILURES,
  MAX_SHRINK_PATH_BYTES,
  MAX_SHRINK_STEPS,
  ShrinkRecorder,
  sampleShrinkPath,
  validateShrinkPath,
} from './shrinkPath.js';

const step = (n: number, records: readonly string[] = [`R${n}`]): ShrinkStep => ({ step: n, records, line: 0 });
const steps = (n: number) => Array.from({ length: n }, (_, i) => step(i));

describe('ShrinkRecorder', () => {
  it('holds every step while under capacity', () => {
    const recorder = new ShrinkRecorder();
    for (const s of steps(5)) recorder.push(s);
    expect(recorder.total).toBe(5);
    expect(recorder.steps().map((s) => s.step)).toEqual([0, 1, 2, 3, 4]);
  });

  it('stays within capacity and keeps step 0 and the latest step', () => {
    const recorder = new ShrinkRecorder();
    for (let i = 0; i < 10_000; i++) {
      recorder.push(step(i));
      expect(recorder.size).toBeLessThanOrEqual(MAX_RECORDED_FAILURES);
    }
    const held = recorder.steps().map((s) => s.step);
    expect(held[0]).toBe(0);
    expect(held.at(-1)).toBe(9_999);
    expect(held.every((s, i) => i === 0 || s > held[i - 1]!)).toBe(true);
    expect(recorder.total).toBe(10_000);
  });

  it('copies the records it is given', () => {
    const recorder = new ShrinkRecorder();
    const records = ['A'];
    recorder.push({ records, line: 0 });
    records[0] = 'B';
    expect(recorder.steps()[0]!.records).toEqual(['A']);
  });
});

describe('sampleShrinkPath', () => {
  it('keeps short paths whole', () => {
    expect(sampleShrinkPath(steps(3), 3)).toEqual({ total: 3, steps: steps(3) });
  });

  it('keeps the first, the last and 22 evenly spaced steps from a long path', () => {
    const path = sampleShrinkPath(steps(245), 245)!;
    const indices = path.steps.map((s) => s.step);
    expect(indices).toHaveLength(MAX_SHRINK_STEPS);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(244);
    expect(indices.every((s, i) => i === 0 || s > indices[i - 1]!)).toBe(true);
    const gaps = indices.slice(1).map((s, i) => s - indices[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(2);
  });

  it('drops interior steps until the records fit the byte cap', () => {
    const big = (n: number) => step(n, ['x'.repeat(4_000)]);
    const path = sampleShrinkPath([0, 1, 2, 3, 4, 5].map(big), 6)!;
    expect(path.steps.map((s) => s.step)).toEqual([0, 1, 4, 5]);
    expect(JSON.stringify(path.steps.map((s) => s.records)).length).toBeLessThanOrEqual(MAX_SHRINK_PATH_BYTES);
  });

  it('keeps only the last step when the first and last alone do not fit', () => {
    const huge = (n: number) => step(n, ['x'.repeat(9_000)]);
    expect(sampleShrinkPath([huge(0), huge(1)], 2)!.steps.map((s) => s.step)).toEqual([1]);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // 3,000 two-byte characters per step: 6,000+ bytes each, so three steps exceed 16 KiB.
    const wide = (n: number) => step(n, ['é'.repeat(3_000)]);
    expect(sampleShrinkPath([0, 1, 2].map(wide), 3)!.steps.map((s) => s.step)).toEqual([0, 2]);
  });

  it('returns no path when the last step alone exceeds the byte cap', () => {
    // ["…"] around 8,191 two-byte characters is 16,386 bytes, 2 over the cap.
    const oversized = step(1, ['é'.repeat(8_191)]);
    expect(sampleShrinkPath([step(0), step(1, ['é'.repeat(8_190)])], 2)).toBeDefined(); // exactly 16,384 fits
    expect(sampleShrinkPath([step(0), oversized], 2)).toBeUndefined();
    expect(sampleShrinkPath([oversized], 1)).toBeUndefined();
    const recorder = new ShrinkRecorder();
    recorder.push(step(0));
    recorder.push(oversized);
    expect(recorder.path()).toBeUndefined();
  });
});

describe('validateShrinkPath', () => {
  const counterexample = { records: ['R2'], cobol: ['a'], port: ['b'], line: 0, column: 0 };
  const result = { shrinks: 2, counterexample };
  const valid = { total: 3, steps: steps(3) };

  it('accepts a valid path, including one with only the last step', () => {
    expect(validateShrinkPath(valid, result)).toEqual([]);
    expect(validateShrinkPath({ total: 3, steps: [step(2)] }, result)).toEqual([]);
  });

  it.each([
    ['not an object', null],
    ['wrong total', { ...valid, total: 4 }],
    ['first step not 0', { total: 3, steps: [step(1), step(2)] }],
    ['indices not increasing', { total: 3, steps: [step(0), step(0), step(2)] }],
    ['last step not total - 1', { total: 3, steps: [step(0), step(1)] }],
    ['last records not the counterexample', { total: 3, steps: [step(0), step(1), step(2, ['X'])] }],
    ['line out of range', { total: 3, steps: [step(0), { step: 2, records: ['R2'], line: 1 }] }],
    ['oversized records', { total: 3, steps: [step(0, ['x'.repeat(17_000)]), step(2, ['R2'])] }],
  ])('rejects a path with %s', (_, path) => {
    expect(validateShrinkPath(path, result)).not.toEqual([]);
  });

  it('rejects a path with more than 24 steps', () => {
    const r = { shrinks: 25, counterexample: { ...counterexample, records: ['R25'] } };
    expect(validateShrinkPath({ total: 26, steps: [...steps(23), step(25)] }, r)).toEqual([]);
    expect(validateShrinkPath({ total: 26, steps: [...steps(24), step(25)] }, r)).not.toEqual([]);
  });

  it('rejects a path on a result without a counterexample', () => {
    expect(validateShrinkPath(valid, { shrinks: 2 })).not.toEqual([]);
  });
});

describe('Property 5: Shrink path sampling keeps the story within caps', () => {
  /** **Validates: Requirements 2.2, 2.3, 2.5, 13.4** */
  const utf8 = new TextEncoder();
  const bytesOf = (s: readonly ShrinkStep[]) => s.reduce((n, x) => n + utf8.encode(JSON.stringify(x.records)).length, 0);
  // Record lists from tiny to over 16 KiB alone, with any UTF-16 code units (lone surrogates included).
  const recordList = fc.oneof(
    { weight: 6, arbitrary: fc.array(fc.string({ unit: 'binary', maxLength: 40 }), { minLength: 1, maxLength: 5 }) },
    { weight: 2, arbitrary: fc.array(fc.string({ unit: 'binary', maxLength: 3_000 }), { minLength: 1, maxLength: 3 }) },
    { weight: 1, arbitrary: fc.integer({ min: 4_000, max: 17_000 }).map((n) => ['é'.repeat(n)]) },
  );
  // Step i uses pool[pick[i % pick.length]], so 10,000 steps cost a small pool, not 10,000 generated lists.
  const pushes = fc.record({
    total: fc.oneof(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 10_000 })),
    pool: fc.array(recordList, { minLength: 1, maxLength: 8 }),
    pick: fc.array(fc.nat(), { minLength: 1, maxLength: 16 }),
    lineSeed: fc.nat(),
  });

  it('holds, stores and samples within the caps with real indices', () => {
    fc.assert(
      fc.property(pushes, ({ total, pool, pick, lineSeed }) => {
        const pushed = (i: number) => {
          const records = pool[pick[i % pick.length]! % pool.length]!;
          return { records, line: (lineSeed + i) % records.length };
        };
        const recorder = new ShrinkRecorder();
        for (let i = 0; i < total; i++) {
          recorder.push(pushed(i));
          if (recorder.size > MAX_RECORDED_FAILURES) return false;
        }
        expect(recorder.total).toBe(total);

        const path = recorder.path();
        if (total === 0) {
          expect(path).toEqual({ total: 0, steps: [] });
          return;
        }
        const first = { step: 0, ...pushed(0) };
        const last = { step: total - 1, ...pushed(total - 1) };
        // The counterexample alone is over the byte cap: no path (Requirement 2.3).
        if (bytesOf([last]) > MAX_SHRINK_PATH_BYTES) {
          expect(path).toBeUndefined();
          return;
        }
        expect(path).toBeDefined();
        expect(path!.total).toBe(total);
        const stored = path!.steps;
        expect(stored.length).toBeGreaterThanOrEqual(1);
        expect(stored.length).toBeLessThanOrEqual(MAX_SHRINK_STEPS);
        expect(bytesOf(stored)).toBeLessThanOrEqual(MAX_SHRINK_PATH_BYTES);

        // Every stored step is the real pushed step at its index, in strictly increasing order.
        stored.forEach((s, i) => {
          if (i > 0) expect(s.step).toBeGreaterThan(stored[i - 1]!.step);
          expect(s.step).toBeLessThan(total);
          expect({ records: s.records, line: s.line }).toEqual(pushed(s.step));
        });
        expect(stored.at(-1)!.step).toBe(total - 1);

        // Step 0 is kept whenever it fits beside the last step.
        if (total > 1 && bytesOf([first, last]) <= MAX_SHRINK_PATH_BYTES) expect(stored[0]!.step).toBe(0);

        // The client accepts what the harness produces.
        const counterexample = { records: [...last.records], cobol: [], port: [], line: last.line, column: 0 };
        expect(validateShrinkPath(path, { shrinks: total - 1, counterexample })).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
