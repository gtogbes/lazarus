import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Progress } from './equivalence.types.js';
import { INITIAL_PROGRESS, nextProgress } from './progress.js';

const fold = (outcomes: readonly boolean[]): Progress => outcomes.reduce(nextProgress, INITIAL_PROGRESS);

describe('nextProgress', () => {
  it('counts every execution as a case while generating', () => {
    expect(fold([false, false, false])).toEqual({ executions: 3, divergences: 0, cases: 3, phase: 'generating' });
  });

  it('counts the first divergence as the last case and switches to shrinking', () => {
    expect(fold([false, false, true])).toEqual({ executions: 3, divergences: 1, cases: 3, phase: 'shrinking' });
  });

  it('keeps cases and the shrinking phase fixed during shrink attempts', () => {
    expect(fold([false, true, false, true, false])).toEqual({
      executions: 5,
      divergences: 2,
      cases: 2,
      phase: 'shrinking',
    });
  });

  it('does not mutate its input', () => {
    const before = { ...INITIAL_PROGRESS };
    nextProgress(INITIAL_PROGRESS, true);
    expect(INITIAL_PROGRESS).toEqual(before);
  });
});

/**
 * Property 1: Progress accounting.
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
 */
describe('Property 1: progress accounting', () => {
  it('counts executions and divergences, and fixes cases and phase at the first failure', () => {
    // Bias towards passes so many sequences have a long generating prefix.
    const outcome = fc.oneof({ arbitrary: fc.constant(false), weight: 3 }, { arbitrary: fc.constant(true), weight: 1 });
    fc.assert(
      fc.property(fc.array(outcome, { maxLength: 200 }), (outcomes) => {
        const firstFailure = outcomes.indexOf(true);
        let p = INITIAL_PROGRESS;
        outcomes.forEach((failed, i) => {
          p = nextProgress(p, failed);
          const executions = i + 1;
          expect(p.executions).toBe(executions);
          expect(p.divergences).toBe(outcomes.slice(0, executions).filter(Boolean).length);
          if (firstFailure === -1 || i < firstFailure) {
            expect(p.cases).toBe(executions);
            expect(p.phase).toBe('generating');
          } else {
            expect(p.cases).toBe(firstFailure + 1);
            expect(p.phase).toBe('shrinking');
          }
        });
        expect(p).toEqual(fold(outcomes));
        expect(p.executions).toBe(outcomes.length);
        expect(p.divergences).toBe(outcomes.filter(Boolean).length);
      }),
      { numRuns: 500 },
    );
  });
});
