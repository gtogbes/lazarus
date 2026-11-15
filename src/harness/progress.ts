/**
 * Progress accounting (graphical-proof Requirement 1.1 to 1.3). The only place
 * the phase and case rules live. Import-free apart from types, so the web app
 * can reuse it.
 *
 * fast-check stops generating at the first failure, so every later execution
 * is a shrink attempt: `cases` is the execution count at the first divergence.
 */
import type { Progress } from './equivalence.types.js';

export const INITIAL_PROGRESS: Progress = { executions: 0, divergences: 0, cases: 0, phase: 'generating' };

/** Progress after one more execution, which `failed` (diverged) or passed. */
export function nextProgress(p: Progress, failed: boolean): Progress {
  const executions = p.executions + 1;
  const divergences = p.divergences + (failed ? 1 : 0);
  const cases = p.phase === 'generating' ? p.cases + 1 : p.cases;
  const phase = p.phase === 'shrinking' || failed ? 'shrinking' : 'generating';
  return { executions, divergences, cases, phase };
}
