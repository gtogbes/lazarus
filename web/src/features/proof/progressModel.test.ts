import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EquivalenceResult } from '../../../../src/harness/equivalence.types';
import { applyProgress, finalizeProgress, INITIAL_PROGRESS_STATE, type ProgressState } from './progressModel';
import { parseProveEvent } from './proveEvent';
import { DIVERGED_RESULT, EQUIVALENT_RESULT } from './testing';

const at = (patch: Partial<ProgressState>): ProgressState => ({ ...INITIAL_PROGRESS_STATE, ...patch });
const tick = (executions: number, divergences: number, extra: object = {}) => ({
  executions,
  divergences,
  elapsedMs: executions,
  ...extra,
});

describe('applyProgress with cases and phase (Requirement 1.7)', () => {
  it('accepts a valid generating then shrinking sequence', () => {
    const a = applyProgress(INITIAL_PROGRESS_STATE, tick(10, 0, { cases: 10, phase: 'generating' }), 2000);
    expect(a).toEqual({ executions: 10, divergences: 0, elapsedMs: 10, cases: 10, phase: 'generating' });
    const b = applyProgress(a!, tick(60, 5, { cases: 37, phase: 'shrinking' }), 2000);
    expect(b).toMatchObject({ cases: 37, phase: 'shrinking' });
    expect(applyProgress(b!, tick(80, 6, { cases: 37, phase: 'shrinking' }), 2000)).toMatchObject({ executions: 80 });
  });

  it('rejects cases above numRuns, but cannot check before started', () => {
    const event = tick(2001, 0, { cases: 2001, phase: 'generating' });
    expect(applyProgress(INITIAL_PROGRESS_STATE, event, 2000)).toBeNull();
    expect(applyProgress(INITIAL_PROGRESS_STATE, event, null)).toMatchObject({ cases: 2001 });
  });

  it('rejects decreasing cases', () => {
    expect(applyProgress(at({ cases: 40 }), tick(50, 0, { cases: 39, phase: 'generating' }), 2000)).toBeNull();
  });

  it('rejects a return to generating', () => {
    const shrinking = at({ executions: 50, divergences: 2, cases: 37, phase: 'shrinking' });
    expect(applyProgress(shrinking, tick(60, 2, { cases: 37, phase: 'generating' }), 2000)).toBeNull();
  });
});

describe('legacy derivation (Requirement 1.8)', () => {
  it('follows executions while generating, clamped to numRuns', () => {
    const a = applyProgress(INITIAL_PROGRESS_STATE, tick(412, 0), 2000);
    expect(a).toMatchObject({ cases: 412, phase: 'generating' });
    expect(applyProgress(a!, tick(2001, 0), 2000)).toMatchObject({ cases: 2000 });
  });

  it('switches to shrinking once divergences exceed 0 and freezes cases', () => {
    const a = applyProgress(INITIAL_PROGRESS_STATE, tick(20, 0), 2000)!;
    const b = applyProgress(a, tick(49, 1), 2000)!;
    expect(b).toMatchObject({ executions: 49, cases: 20, phase: 'shrinking' });
    // Stays shrinking even if a later snapshot reports no divergences.
    expect(applyProgress(b, tick(60, 0), 2000)).toMatchObject({ cases: 20, phase: 'shrinking' });
  });

  it('takes the final cases from the result', () => {
    const shrinking = at({ executions: 49, divergences: 1, cases: 20, phase: 'shrinking' });
    expect(finalizeProgress(shrinking, DIVERGED_RESULT as EquivalenceResult)).toMatchObject({ cases: 37, phase: 'shrinking' });
    const generating = at({ executions: 1990, cases: 1990 });
    expect(finalizeProgress(generating, EQUIVALENT_RESULT)).toMatchObject({ cases: 2000, phase: 'generating' });
  });

  it('marks a diverged result as shrinking when no progress said so', () => {
    expect(finalizeProgress(INITIAL_PROGRESS_STATE, DIVERGED_RESULT as EquivalenceResult).phase).toBe('shrinking');
  });
});

type RawProgress = Record<string, unknown>;

/**
 * What the client does with one raw progress value: the single-event checks in
 * `parseProveEvent`, then the cross-event checks in `applyProgress`. Null means
 * the event was rejected.
 */
function clientApply(state: ProgressState, raw: RawProgress, numRuns: number): ProgressState | null {
  const event = parseProveEvent(raw);
  if (!event || event.type !== 'progress') return null;
  const { type: _type, ...input } = event;
  return applyProgress(state, input, numRuns);
}

/**
 * A valid version 2 run: snapshots at increasing execution counts. Before the
 * first failure `cases` follows executions; from it on `cases` is fixed at the
 * failure's position and the phase is `shrinking`.
 */
const validRun = fc
  .integer({ min: 1, max: 2000 })
  .chain((numRuns) =>
    fc.record({
      numRuns: fc.constant(numRuns),
      failAt: fc.option(fc.integer({ min: 1, max: numRuns }), { nil: null }),
      shrinkAttempts: fc.nat({ max: 300 }),
      points: fc.uniqueArray(fc.nat({ max: numRuns + 300 }), { minLength: 1, maxLength: 30 }),
    }),
  )
  .map(({ numRuns, failAt, shrinkAttempts, points }) => {
    const total = failAt === null ? numRuns : failAt + shrinkAttempts;
    const executions = [...new Set(points.map((p) => Math.min(p, total)))].sort((a, b) => a - b);
    const events: RawProgress[] = executions.map((e) => {
      const shrinking = failAt !== null && e >= failAt;
      return {
        type: 'progress',
        executions: e,
        divergences: shrinking ? 1 + Math.floor((e - failAt) / 2) : 0,
        elapsedMs: e * 0.3,
        cases: shrinking ? failAt : e,
        phase: shrinking ? 'shrinking' : 'generating',
      };
    });
    return { numRuns, events };
  });

/** States before each event when the whole run is applied. */
function statesBefore(events: readonly RawProgress[], numRuns: number): ProgressState[] {
  const states: ProgressState[] = [INITIAL_PROGRESS_STATE];
  let state = INITIAL_PROGRESS_STATE;
  for (const raw of events) {
    const next = clientApply(state, raw, numRuns);
    if (!next) throw new Error(`valid event rejected: ${JSON.stringify(raw)}`);
    states.push((state = next));
  }
  return states;
}

type Corruption =
  | 'above-executions'
  | 'above-numRuns'
  | 'decreasing'
  | 'unknown-phase'
  | 'back-to-generating'
  | 'only-cases'
  | 'only-phase';

function corruptionsFor(prev: ProgressState): Corruption[] {
  const kinds: Corruption[] = ['above-executions', 'above-numRuns', 'unknown-phase', 'only-cases', 'only-phase'];
  if (prev.cases > 0) kinds.push('decreasing');
  if (prev.phase === 'shrinking') kinds.push('back-to-generating');
  return kinds;
}

function corrupt(raw: RawProgress, prev: ProgressState, numRuns: number, kind: Corruption, k: number, badPhase: string): RawProgress {
  const executions = raw.executions as number;
  switch (kind) {
    case 'above-executions':
      return { ...raw, cases: executions + 1 + k };
    case 'above-numRuns': {
      // Raise executions too, so only the numRuns bound is broken.
      const cases = numRuns + 1 + k;
      return { ...raw, executions: Math.max(executions, cases), cases };
    }
    case 'decreasing':
      return { ...raw, cases: k % prev.cases };
    case 'unknown-phase':
      return { ...raw, phase: badPhase };
    case 'back-to-generating':
      return { ...raw, phase: 'generating' };
    case 'only-cases': {
      const { phase: _phase, ...rest } = raw;
      return rest;
    }
    case 'only-phase': {
      const { cases: _cases, ...rest } = raw;
      return rest;
    }
  }
}

describe('Property 3: Invalid progress fields are rejected', () => {
  /** **Validates: Requirements 1.7, 16.3** */
  it('accepts every valid version 2 sequence', () => {
    fc.assert(
      fc.property(validRun, ({ numRuns, events }) => {
        const states = statesBefore(events, numRuns);
        expect(states).toHaveLength(events.length + 1);
      }),
    );
  });

  /** **Validates: Requirements 1.7, 16.3** */
  it('rejects an event whose cases or phase is replaced by an invalid value', () => {
    fc.assert(
      fc.property(
        validRun,
        fc.nat(),
        fc.nat(),
        fc.nat({ max: 1000 }),
        fc.string().filter((s) => s !== 'generating' && s !== 'shrinking'),
        ({ numRuns, events }, indexSeed, kindSeed, k, badPhase) => {
          const states = statesBefore(events, numRuns);
          const i = indexSeed % events.length;
          const prev = states[i]!;
          const kinds = corruptionsFor(prev);
          const kind = kinds[kindSeed % kinds.length]!;
          const bad = corrupt(events[i]!, prev, numRuns, kind, k, badPhase);
          expect(clientApply(prev, bad, numRuns)).toBeNull();
        },
      ),
    );
  });
});

/**
 * A valid version 1 run: snapshots with no `cases` or `phase`, at increasing
 * execution counts. Divergences are 0 before the first failure and at least 1
 * from it on, while executions keep counting shrink attempts.
 */
const legacyRun = fc
  .integer({ min: 1, max: 2000 })
  .chain((numRuns) =>
    fc.record({
      numRuns: fc.constant(numRuns),
      failAt: fc.option(fc.integer({ min: 1, max: numRuns }), { nil: null }),
      shrinkAttempts: fc.nat({ max: 300 }),
      points: fc.uniqueArray(fc.nat({ max: numRuns + 300 }), { minLength: 1, maxLength: 30 }),
    }),
  )
  .map(({ numRuns, failAt, shrinkAttempts, points }) => {
    const total = failAt === null ? numRuns : failAt + shrinkAttempts;
    const executions = [...new Set(points.map((p) => Math.min(p, total)))].sort((a, b) => a - b);
    const events: RawProgress[] = executions.map((e) => ({
      type: 'progress',
      executions: e,
      divergences: failAt !== null && e >= failAt ? 1 + Math.floor((e - failAt) / 2) : 0,
      elapsedMs: e * 0.3,
    }));
    const result: EquivalenceResult =
      failAt === null
        ? { ...EQUIVALENT_RESULT, cases: numRuns }
        : ({ ...DIVERGED_RESULT, cases: failAt } as EquivalenceResult);
    return { numRuns, events, result };
  });

describe('Property 2: Legacy progress derivation', () => {
  /** **Validates: Requirements 1.8, 3.5** */
  it('derives phase from divergences and keeps cases monotonic and bounded', () => {
    fc.assert(
      fc.property(legacyRun, ({ numRuns, events, result }) => {
        const states = statesBefore(events, numRuns);
        let diverged = false;
        for (let i = 1; i < states.length; i++) {
          const prev = states[i - 1]!;
          const state = states[i]!;
          diverged ||= state.divergences > 0;
          expect(state.phase).toBe(diverged ? 'shrinking' : 'generating');
          expect(state.cases).toBeGreaterThanOrEqual(prev.cases);
          expect(state.cases).toBeLessThanOrEqual(state.executions);
          expect(state.cases).toBeLessThanOrEqual(numRuns);
          if (state.phase === 'generating') expect(state.cases).toBe(Math.min(state.executions, numRuns));
          else expect(state.cases).toBe(prev.cases);
        }
        const final = finalizeProgress(states.at(-1)!, result);
        expect(final.cases).toBe(result.cases);
        expect(final.phase).toBe(result.status === 'diverged' ? 'shrinking' : 'generating');
      }),
    );
  });
});
