import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EquivalenceResult, ShrinkPath, ShrinkStep } from '../../../../src/harness/equivalence.types';
import { MAX_SHRINK_PATH_BYTES, MAX_SHRINK_STEPS } from '../../../../src/harness/shrinkPath';
import { parseEquivalenceResult, parseProveEvent } from './proveEvent';

const progress = { type: 'progress', executions: 10, divergences: 2, elapsedMs: 5 };

describe('parseProveEvent progress', () => {
  it('keeps a legacy event without cases or phase', () => {
    expect(parseProveEvent(progress)).toEqual(progress);
  });

  it('copies valid cases and phase', () => {
    const event = { ...progress, cases: 4, phase: 'shrinking' };
    expect(parseProveEvent({ ...event, extra: 1 })).toEqual(event);
  });

  it.each([
    ['only cases', { cases: 4 }],
    ['only phase', { phase: 'generating' }],
    ['cases above executions', { cases: 11, phase: 'shrinking' }],
    ['negative cases', { cases: -1, phase: 'generating' }],
    ['fractional cases', { cases: 1.5, phase: 'generating' }],
    ['unknown phase', { cases: 4, phase: 'done' }],
    ['null phase', { cases: 4, phase: null }],
  ])('rejects %s', (_, fields) => {
    expect(parseProveEvent({ ...progress, ...fields })).toBeNull();
  });
});

const records = ['A', 'B'];
const diverged = {
  program: 'PAYROLL',
  status: 'diverged',
  reference: 'ref',
  generatedAt: '2026-11-12T00:00:00.000Z',
  seed: 1,
  cases: 3,
  shrinks: 2,
  durationMs: 9,
  counterexample: { records, cobol: ['x'], port: ['y'], line: 1, column: 0 },
};
const shrinkPath = {
  total: 3,
  steps: [
    { step: 0, records: ['A', 'B', 'C'], line: 2 },
    { step: 2, records, line: 1 },
  ],
};

describe('parseEquivalenceResult shrinkPath', () => {
  it('keeps a valid path, copying only known fields', () => {
    const steps = shrinkPath.steps.map((s) => ({ ...s, extra: true }));
    expect(parseEquivalenceResult({ ...diverged, shrinkPath: { ...shrinkPath, steps, extra: 1 } })).toEqual({
      ...diverged,
      shrinkPath,
    });
  });

  it.each([
    ['a wrong total', { ...shrinkPath, total: 4 }],
    ['a last step that is not the counterexample', { total: 3, steps: [{ step: 2, records: ['Z'], line: 0 }] }],
    ['a non-object', 'path'],
    ['too many steps', { total: 3, steps: Array.from({ length: 25 }, (_, step) => ({ step, records, line: 0 })) }],
  ])('drops a path with %s and keeps the result', (_, path) => {
    expect(parseEquivalenceResult({ ...diverged, shrinkPath: path })).toEqual(diverged);
  });

  it('ignores a path on an equivalent result', () => {
    const { counterexample: _, ...rest } = diverged;
    const equivalent = { ...rest, status: 'equivalent' };
    expect(parseEquivalenceResult({ ...equivalent, shrinkPath })).toEqual(equivalent);
  });
});

// Records of 1-4 strings with a line in range. 24 steps of these stay well under the byte cap.
const stepRecords = fc
  .array(fc.string({ maxLength: 20, unit: 'binary' }), { minLength: 1, maxLength: 4 })
  .chain((recs) => fc.record({ records: fc.constant(recs), line: fc.nat({ max: recs.length - 1 }) }));

/** A diverged result with a valid Shrink_Path: indices from 0 to shrinks, the last step being the counterexample. */
const divergedWithPath = fc
  .record({
    program: fc.string(),
    reference: fc.string(),
    generatedAt: fc.string(),
    seed: fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
    cases: fc.nat(),
    shrinks: fc.nat({ max: 500 }),
    durationMs: fc.double({ min: 0, noNaN: true, noDefaultInfinity: true }).map(Math.abs),
    truncated: fc.boolean(),
    last: stepRecords,
    cobol: fc.array(fc.string()),
    port: fc.array(fc.string()),
    column: fc.nat(),
    keepFirst: fc.boolean(),
  })
  .chain((base) => {
    const { shrinks } = base;
    const interior =
      shrinks < 2
        ? fc.constant<number[]>([])
        : fc.uniqueArray(fc.integer({ min: 1, max: shrinks - 1 }), { maxLength: MAX_SHRINK_STEPS - 2 });
    return fc.record({
      base: fc.constant(base),
      middle: interior.chain((idx) =>
        fc.tuple(...[...idx].sort((a, b) => a - b).map((step) => stepRecords.map((r) => ({ step, ...r })))),
      ),
      first: stepRecords,
    });
  })
  .map(({ base, middle, first }): EquivalenceResult => {
    const { shrinks, last, truncated, cobol, port, column, keepFirst, ...rest } = base;
    const lastStep: ShrinkStep = { step: shrinks, ...last };
    // A lone last step needs no step 0; with more steps the first must be step 0.
    const alone = shrinks === 0 || (!keepFirst && middle.length === 0);
    const steps = alone ? [lastStep] : [{ step: 0, ...first }, ...middle, lastStep];
    const path: ShrinkPath = { total: shrinks + 1, steps };
    return {
      ...rest,
      status: 'diverged',
      shrinks,
      ...(truncated ? { truncated: true as const } : {}),
      counterexample: { records: [...last.records], cobol, port, line: last.line, column },
      shrinkPath: path,
    };
  });

type Corruption = (path: ShrinkPath, pick: number) => ShrinkPath | undefined;
const replaceStep = (path: ShrinkPath, i: number, step: ShrinkStep): ShrinkPath => ({
  ...path,
  steps: path.steps.map((s, j) => (j === i ? step : s)),
});
const CORRUPTIONS: Record<string, Corruption> = {
  'an extra step': (path) => {
    const last = path.steps.at(-1)!;
    return { ...path, steps: [...path.steps, { ...last, step: path.total }] };
  },
  'a reordered index': (path, pick) => {
    if (path.steps.length < 2) return undefined;
    const i = pick % (path.steps.length - 1);
    const [a, b] = [path.steps[i]!, path.steps[i + 1]!];
    return replaceStep(replaceStep(path, i, { ...a, step: b.step }), i + 1, { ...b, step: a.step });
  },
  'a wrong total': (path, pick) => ({ ...path, total: path.total + 1 + (pick % 5) }),
  'an oversized record': (path, pick) => {
    const i = pick % path.steps.length;
    const s = path.steps[i]!;
    const records = s.records.map((r, j) => (j === s.line ? 'x'.repeat(MAX_SHRINK_PATH_BYTES + 1) : r));
    return replaceStep(path, i, { ...s, records });
  },
  'a last step not matching the counterexample': (path) => {
    const i = path.steps.length - 1;
    const s = path.steps[i]!;
    return replaceStep(path, i, { ...s, records: s.records.map((r, j) => (j === 0 ? `${r}Z` : r)) });
  },
};

describe('parseEquivalenceResult round trip', () => {
  // Feature: graphical-proof, Property 6: Result round trip, and a corrupt path is dropped
  // **Validates: Requirements 2.8, 16.3**
  it('returns a valid result with a path unchanged after JSON', () => {
    fc.assert(
      fc.property(divergedWithPath, (r) => {
        expect(parseEquivalenceResult(JSON.parse(JSON.stringify(r)))).toStrictEqual(r);
      }),
      { numRuns: 200 },
    );
  });

  it.each(Object.keys(CORRUPTIONS))('drops the path after %s and keeps the rest', (name) => {
    fc.assert(
      fc.property(divergedWithPath, fc.nat(), (r, pick) => {
        const { shrinkPath: path, ...rest } = r as EquivalenceResult & { shrinkPath: ShrinkPath };
        const corrupt = CORRUPTIONS[name]!(path, pick);
        fc.pre(corrupt !== undefined);
        const parsed = parseEquivalenceResult(JSON.parse(JSON.stringify({ ...rest, shrinkPath: corrupt })));
        expect(parsed).toStrictEqual(rest);
      }),
      { numRuns: 100 },
    );
  });
});
