/**
 * Wire types of `POST /api/prove` (reanimation-lab design, "API contract"),
 * with type-only imports, so the web client can `import type` them without
 * type-checking the Node-only proof runner. `prove.ts` re-exports them.
 */
import type { EquivalenceResult } from '../harness/equivalence.types.js';

/** The request body. Anything else is rejected with 400 (Requirement 8.2). */
export interface ProveRequestBody {
  readonly program: string;
  readonly mutant?: string;
  readonly seed?: number;
}

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
  | { readonly type: 'progress'; readonly executions: number; readonly divergences: number; readonly elapsedMs: number }
  | { readonly type: 'result'; readonly result: EquivalenceResult }
  | { readonly type: 'error'; readonly message: string };

/** Body of every non-200 response, sent before any stream starts. */
export interface ProveErrorBody {
  readonly error: string;
}
