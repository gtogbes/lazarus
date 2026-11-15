/**
 * Wire types of `POST /api/prove` (reanimation-lab design, "API contract"),
 * with type-only imports, so the web client can `import type` them without
 * type-checking the Node-only proof runner. `prove.ts` re-exports them.
 */
import type { EquivalenceResult, ProofPhase } from '../harness/equivalence.types.js';
export type { ProofPhase } from '../harness/equivalence.types.js';

/** The request body. Anything else is rejected with 400 (Requirement 8.2). */
export interface ProveRequestBody {
  readonly program: string;
  readonly mutant?: string;
  readonly seed?: number;
}

/**
 * A `progress` event as this server sends it (graphical-proof Requirement 1.4):
 * `cases` and `phase` are always present, beside the original fields.
 */
export interface ProveProgressEvent {
  readonly type: 'progress';
  readonly executions: number;
  readonly divergences: number;
  /** Generated cases run, including the first failure. Fixed once shrinking starts. */
  readonly cases: number;
  readonly phase: ProofPhase;
  readonly elapsedMs: number;
}
/**
 * A `progress` event as a client may receive it. `cases` and `phase` are
 * optional because older servers and version 1 recordings omit them; the
 * client then derives them (graphical-proof Requirement 1.8).
 */
export type ProgressEvent = Omit<ProveProgressEvent, 'cases' | 'phase'> &
  Partial<Pick<ProveProgressEvent, 'cases' | 'phase'>>;
/** One NDJSON line of a 200 response. */
export type ProveEvent =
  | {
      readonly type: 'started';
      readonly program: string;
      readonly mutant?: string;
      readonly seed: number;
      readonly reference: string;
      readonly numRuns: number;
    }
  | ProgressEvent
  | { readonly type: 'result'; readonly result: EquivalenceResult }
  | { readonly type: 'error'; readonly message: string };

/** Body of every non-200 response, sent before any stream starts. */
export interface ProveErrorBody {
  readonly error: string;
}
