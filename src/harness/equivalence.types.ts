/**
 * Result types of the equivalence harness, with no imports, so the web app can
 * `import type` them without type-checking Node-only harness code.
 * `equivalence.ts` re-exports them; harness code may import from either.
 */

/** Live counters for the UI. `executions` includes shrinking attempts. */
export interface Progress {
  readonly executions: number;
  readonly divergences: number;
}

export interface Counterexample {
  readonly records: readonly string[];
  readonly cobol: readonly string[];
  readonly port: readonly string[];
  /** 0-based record and column of the first difference. */
  readonly line: number;
  readonly column: number;
}

/** Written to results/<PROGRAM>.json for the UI (Requirement 5.2). */
export interface EquivalenceResult {
  readonly program: string;
  readonly status: 'equivalent' | 'diverged';
  readonly reference: string;
  readonly generatedAt: string;
  readonly seed: number;
  /** Generated cases run, up to and including the first failure. */
  readonly cases: number;
  readonly shrinks: number;
  readonly durationMs: number;
  readonly counterexample?: Counterexample;
  /** Present when `signal` stopped the run before `numRuns` cases (or before shrinking finished). */
  readonly truncated?: true;
}
