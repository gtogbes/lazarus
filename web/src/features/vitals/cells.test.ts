import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cellStates } from './cells';
import type { ProofPhase } from '../../../../src/harness/equivalence.types';
import type { ProofStatus } from '../proof/useProofRun';

describe('cellStates', () => {
  it('marks the cases passed so far while a proof runs', () => {
    expect(cellStates(2000, 640, 'reanimating', false, 'generating')).toEqual({
      total: 2000,
      passed: 640,
      failedIndex: null,
      notRun: 1360,
      truncated: false,
    });
  });

  it('fills every cell when the port is alive', () => {
    expect(cellStates(2000, 2000, 'alive', false, 'generating')).toMatchObject({ passed: 2000, failedIndex: null, notRun: 0 });
  });

  it('marks the last case run as failing on a divergence and leaves later cells not run', () => {
    expect(cellStates(2000, 1, 'relapsed', false, 'shrinking')).toMatchObject({ passed: 0, failedIndex: 0, notRun: 1999 });
    expect(cellStates(2000, 37, 'relapsed', false, 'shrinking')).toMatchObject({ passed: 36, failedIndex: 36, notRun: 1963 });
  });

  it('leaves the remaining cells not run on a truncated run', () => {
    expect(cellStates(2000, 1500, 'alive', true, 'generating')).toMatchObject({ passed: 1500, notRun: 500, truncated: true });
  });

  it('shows the failing cell from the first divergence, while shrinking (1.2, 7.3)', () => {
    expect(cellStates(2000, 37, 'reanimating', false, 'shrinking')).toMatchObject({ passed: 36, failedIndex: 36, notRun: 1963 });
  });

  it('never shows a failing cell for an error or cancelled run, even one stopped while shrinking', () => {
    expect(cellStates(2000, 12, 'cancelled', false, 'shrinking').failedIndex).toBeNull();
    expect(cellStates(2000, 12, 'error', false, 'shrinking').failedIndex).toBeNull();
    expect(cellStates(2000, 12, 'error', false, 'generating').failedIndex).toBeNull();
    expect(cellStates(2000, 12, 'cancelled', false, 'generating')).toMatchObject({ passed: 12, failedIndex: null, notRun: 1988 });
  });

  it('clamps cases to [0, numRuns] so the counts add up', () => {
    expect(cellStates(100, 250, 'alive', false, 'generating')).toMatchObject({ total: 100, passed: 100, notRun: 0 });
    expect(cellStates(100, -3, 'reanimating', false, 'generating')).toMatchObject({ passed: 0, notRun: 100 });
    expect(cellStates(100, 0, 'relapsed', false, 'shrinking')).toMatchObject({ passed: 0, failedIndex: null, notRun: 100 });
  });
});

const STATUSES: readonly ProofStatus[] = ['idle', 'reanimating', 'alive', 'relapsed', 'error', 'cancelled'];

// Feature: graphical-proof, Property 12: Case grid cells match the counts
// **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 13.2**
describe('Property 12: case grid cells match the counts', () => {
  it('draws numRuns cells that add up, with a failing cell only once a divergence is found', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 0, max: 10_000 })
          .chain((numRuns) => fc.tuple(fc.constant(numRuns), fc.integer({ min: 0, max: numRuns }))),
        fc.constantFrom(...STATUSES),
        fc.boolean(),
        fc.constantFrom<ProofPhase>('generating', 'shrinking'),
        ([numRuns, cases], status, truncated, phase) => {
          const cells = cellStates(numRuns, cases, status, truncated, phase);
          expect(cells.total).toBe(numRuns);
          expect(cells.passed + (cells.failedIndex === null ? 0 : 1) + cells.notRun).toBe(numRuns);
          expect(cells.truncated).toBe(truncated);
          const diverged = status === 'relapsed' || (status === 'reanimating' && phase === 'shrinking');
          if (diverged && cases > 0) {
            expect(cells.failedIndex).toBe(cases - 1);
            expect(cells.passed).toBe(cases - 1);
          } else {
            expect(cells.failedIndex).toBeNull();
            expect(cells.passed).toBe(cases);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
