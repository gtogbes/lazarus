import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ShrinkPath } from '../../../../src/harness/equivalence.types';
import { LAYOUT } from '../../../../src/ports/intcalc.layout';
import { recordLayout, type FieldSpec, type RecordLayout } from '../../../../src/semantics/layout';
import { MAX_SHRINK_STEPS } from '../../../../src/harness/shrinkPath';
import { FIELD_MS, MAX_TOTAL_MS, STEP_MS, shrinkSteps, stepTimings } from './shrinkSteps';

// IN-ACCT-ID X(8), IN-BALANCE S9(9)V99 SLS, IN-RATE 9(2)V9(4), IN-DAYS 9(3).
const rec = (acct: string, bal: string, rate: string, days: string) => acct.padEnd(8) + bal + rate + days;
const A = rec('ACCT0001', '+00001234567', '050000', '365');
const B = rec('ACCT0001', '+00000000001', '050000', '365');
const C = rec('A       ', '+00000000000', '000000', '365');
const OTHER = rec('ZZZZZZZZ', '+00000000000', '000000', '000');

describe('shrinkSteps', () => {
  const path: ShrinkPath = {
    total: 12,
    steps: [
      { step: 0, records: [OTHER, OTHER, A], line: 2 },
      { step: 5, records: [B, OTHER], line: 0 },
      { step: 11, records: [C], line: 0 },
    ],
  };

  it('decodes each step from records[line] and keeps real indices and counts', () => {
    const steps = shrinkSteps(path, LAYOUT.input);
    expect(steps.map((s) => [s.step, s.line, s.recordCount])).toEqual([
      [0, 2, 3],
      [5, 0, 2],
      [11, 0, 1],
    ]);
    expect(steps[0]?.record.fields.map((f) => f.value)).toEqual(['ACCT0001', '+12345.67', '5.0000', '365']);
  });

  it('marks exactly the fields whose raw text changed since the previous step', () => {
    const steps = shrinkSteps(path, LAYOUT.input);
    expect(steps.map((s) => s.changed)).toEqual([[], [1], [0, 1, 2]]);
  });

  it('handles an empty path and a missing record without throwing', () => {
    expect(shrinkSteps({ total: 0, steps: [] }, LAYOUT.input)).toEqual([]);
    const [only] = shrinkSteps({ total: 1, steps: [{ step: 0, records: [], line: 0 }] }, LAYOUT.input);
    expect(only?.record.lengthMatches).toBe(false);
  });
});

describe('stepTimings', () => {
  const total = (counts: number[]) => stepTimings(counts).reduce((s, t) => s + t.durationMs, 0);

  it('uses 400 ms per step and 120 ms per changed field when under 10 s', () => {
    expect(stepTimings([0, 2])).toEqual([
      { durationMs: STEP_MS, fieldMs: FIELD_MS },
      { durationMs: STEP_MS + 2 * FIELD_MS, fieldMs: FIELD_MS },
    ]);
  });

  it('scales a long path down to at most 10 s, keeping field fades inside each step', () => {
    const counts = Array.from({ length: 24 }, () => 4);
    const timings = stepTimings(counts);
    expect(total(counts)).toBeLessThanOrEqual(MAX_TOTAL_MS);
    expect(total(counts)).toBeGreaterThan(MAX_TOTAL_MS - counts.length);
    for (const t of timings) expect(t.fieldMs * 4).toBeLessThanOrEqual(t.durationMs);
  });

  it('returns nothing for no steps', () => {
    expect(stepTimings([])).toEqual([]);
  });
});

// Feature: graphical-proof, Property 9: Shrink steps show real changes within 10 s
describe('Property 9: shrink steps show real changes within 10 s', () => {
  /** Validates: Requirements 5.1, 5.2, 5.5 */
  const fieldSpec: fc.Arbitrary<FieldSpec> = fc.oneof(
    fc.integer({ min: 1, max: 6 }).map((n) => ({ name: 'FILLER', picture: `X(${n})` })),
    fc.integer({ min: 1, max: 6 }).map((n) => ({ name: 'F-X', picture: `X(${n})` })),
    fc
      .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 3 }))
      .map(([i, d]) => ({ name: 'F-9', picture: d > 0 ? `9(${i})V9(${d})` : `9(${i})` })),
    fc
      .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 3 }))
      .map(([i, d]) => ({ name: 'F-S', picture: `S9(${i})V9(${d}) SIGN LEADING SEPARATE` })),
  );
  const layoutArb: fc.Arbitrary<RecordLayout> = fc
    .array(fieldSpec, { minLength: 1, maxLength: 6 })
    .map((specs) => recordLayout('GEN-REC', specs));
  // A small alphabet so fields often repeat between steps and both branches are hit.
  const recordArb = (length: number) =>
    fc.array(fc.constantFrom('0', '1', ' ', '+', 'A'), { minLength: length, maxLength: length }).map((c) => c.join(''));
  // A valid Shrink_Path: 1 to 24 steps, step indices strictly increasing, the
  // first 0 (unless only the last fits), the last total - 1, line in range.
  const pathArb = (layout: RecordLayout): fc.Arbitrary<ShrinkPath> =>
    fc
      .tuple(
        fc.uniqueArray(fc.integer({ min: 1, max: 400 }), { maxLength: MAX_SHRINK_STEPS - 1 }),
        fc.boolean(),
        fc.array(
          fc
            .array(recordArb(layout.length), { minLength: 1, maxLength: 4 })
            .chain((records) => fc.record({ records: fc.constant(records), line: fc.nat(records.length - 1) })),
          { minLength: MAX_SHRINK_STEPS, maxLength: MAX_SHRINK_STEPS },
        ),
      )
      .map(([later, onlyLast, bodies]) => {
        const sorted = [...later].sort((a, b) => a - b);
        const total = (sorted.at(-1) ?? 0) + 1;
        const indices = onlyLast ? [total - 1] : [0, ...sorted];
        return {
          total,
          steps: indices.map((step, i) => ({ step, records: bodies[i]!.records, line: bodies[i]!.line })),
        };
      });
  const caseArb = layoutArb.chain((layout) => fc.record({ layout: fc.constant(layout), path: pathArb(layout) }));

  it('returns one view per stored step, from records[line], with exactly the changed fields', () => {
    fc.assert(
      fc.property(caseArb, ({ layout, path }) => {
        const views = shrinkSteps(path, layout);
        expect(views).toHaveLength(path.steps.length);
        const raws = path.steps.map((s) =>
          layout.fields.map((f) => s.records[s.line]!.slice(f.offset, f.offset + f.length)),
        );
        views.forEach((v, i) => {
          const s = path.steps[i]!;
          expect([v.step, v.line, v.recordCount]).toEqual([s.step, s.line, s.records.length]);
          expect(v.record.fields.map((f) => f.raw)).toEqual(raws[i]);
          const expected =
            i === 0 ? [] : layout.fields.map((_, k) => k).filter((k) => raws[i]![k] !== raws[i - 1]![k]);
          expect(v.changed).toEqual(expected);
        });
      }),
      { numRuns: 200 },
    );
  });

  it('times the steps within 10 s, one timing per step, fades inside each step', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(40), { maxLength: MAX_SHRINK_STEPS }), (counts) => {
        const timings = stepTimings(counts);
        expect(timings).toHaveLength(counts.length);
        expect(timings.reduce((sum, t) => sum + t.durationMs, 0)).toBeLessThanOrEqual(MAX_TOTAL_MS);
        timings.forEach((t, i) => {
          expect(t.durationMs).toBeGreaterThan(0);
          expect(t.fieldMs * counts[i]!).toBeLessThanOrEqual(t.durationMs);
        });
      }),
      { numRuns: 200 },
    );
  });
});
