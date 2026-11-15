/**
 * Result types of the equivalence harness, with no imports, so the web app can
 * `import type` them without type-checking Node-only harness code.
 * `equivalence.ts` re-exports them; harness code may import from either.
 */

/** `generating`: running cases. `shrinking`: running shrink attempts after the first divergence. */
export type ProofPhase = 'generating' | 'shrinking';

/** Live counters for the UI. `executions` includes shrinking attempts. */
export interface Progress {
  readonly executions: number;
  readonly divergences: number;
  /** Generated cases run, including the first failure. Fixed once shrinking starts. */
  readonly cases: number;
  readonly phase: ProofPhase;
}

/** One failing input fast-check reached while shrinking. */
export interface ShrinkStep {
  /** 0 = first failure; total - 1 = the counterexample. Real index, kept after sampling. */
  readonly step: number;
  readonly records: readonly string[];
  /** 0-based index of the first differing record in this step. */
  readonly line: number;
}

/** The failing inputs from the first failure to the counterexample, sampled within caps. */
export interface ShrinkPath {
  /** Every failing input fast-check reached: shrinks + 1. */
  readonly total: number;
  /** At most 24, step strictly increasing, first 0 (unless only the last fits), last total - 1. */
  readonly steps: readonly ShrinkStep[];
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
  /** Diverged results only: the inputs fast-check went through while shrinking. */
  readonly shrinkPath?: ShrinkPath;
}
