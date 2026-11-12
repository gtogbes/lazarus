/**
 * `useProofRun`: the one store for the current proof run (reanimation-lab
 * design, "Web app"). The program view drives it; the lab scene (task 16)
 * subscribes to `status` so its lighting always matches the real run.
 *
 * Status transitions:
 *
 *   idle ──start──► reanimating ──result equivalent──► alive
 *                        │      ──result diverged────► relapsed
 *                        │      ──error event, HTTP or network failure,
 *                        │        stream ended without a result──► error
 *                        └──cancel──► cancelled
 *
 * `replayRecorded` (Requirement 6) replays the recorded proof for the program and
 * mutant of the last run through the same transitions and fields, with
 * `source: 'recorded'` and `recordedAt` set. The progress snapshots are replayed
 * at their recorded pace. A missing or invalid recording ends in `error` with
 * kind `recorded`. The UI only offers the replay after a live run failed.
 *
 * `start` from any status begins a fresh run (aborting one in flight).
 * `reset` aborts any run, returns to idle and clears the sabotage selection.
 *
 * `selectedMutant` is the sabotage panel's choice (Requirement 4.2): null for the
 * real port. It is separate from `mutant`, the mutant of the current or last run,
 * so changing the selection never relabels a run already in flight. `start`
 * keeps the selection.
 *
 * A run can finish before any 4 Hz tick: the server always sends a final
 * `progress` before `result`, so the counters are right either way.
 * An `error` is never a divergence: it never sets `relapsed` (design, "Error handling").
 */
import { create } from 'zustand';
import type { EquivalenceResult } from '../../../../src/harness/equivalence.types';
import { ProveRequestError, streamProve } from './proveClient';
import { fetchRecording } from './recording';

export type ProofStatus = 'idle' | 'reanimating' | 'alive' | 'relapsed' | 'error' | 'cancelled';

/** Why a run produced no result. The UI offers the recorded proof for any live failure (Requirement 6.1). */
export interface ProofError {
  /**
   * `network`: unreachable or the connection dropped. `http`: rejected before
   * the stream (`httpStatus` is set). `stream`: ended without a result.
   * `run`: the server reported the run failed (for example COBOL crashed).
   * `recorded`: a recorded proof was asked for but none could be loaded.
   */
  readonly kind: 'network' | 'http' | 'stream' | 'run' | 'recorded';
  readonly message: string;
  readonly httpStatus?: number;
}

/** From the `started` event. */
export interface ProofRunInfo {
  readonly seed: number;
  /** The GnuCOBOL build used as reference, e.g. `gnucobol 3.1.2 (native)`. */
  readonly reference: string;
  /** Cases the server will run (Requirement 3.6). */
  readonly numRuns: number;
}

export interface ProofRunState {
  readonly status: ProofStatus;
  /** Program and mutant of the current or last run; null when idle. */
  readonly program: string | null;
  readonly mutant: string | null;
  /** Null until the `started` event arrives. */
  readonly run: ProofRunInfo | null;
  /** Live counters (Requirement 3.2). `executions` includes shrinking attempts. */
  readonly executions: number;
  readonly divergences: number;
  readonly elapsedMs: number;
  /** Set when status is `alive` or `relapsed`. `result.truncated` marks a run stopped at the 25 s cap. */
  readonly result: EquivalenceResult | null;
  /** `recorded` while replaying or showing a recorded proof (Requirement 6). */
  readonly source: 'live' | 'recorded';
  /** ISO 8601 date of the recorded proof being replayed; null for live runs (Requirement 6.2). */
  readonly recordedAt: string | null;
  /** Set when status is `error`. */
  readonly error: ProofError | null;
  /** Mutant id the next Prove runs (Requirement 4.2); null proves the real port. */
  readonly selectedMutant: string | null;

  selectMutant(mutant: string | null): void;
  start(program: string, mutant?: string): Promise<void>;
  /** Replay the recorded proof for the program and mutant of the last run (Requirement 6.1). */
  replayRecorded(): Promise<void>;
  cancel(): void;
  reset(): void;
}

const IDLE = {
  status: 'idle',
  program: null,
  mutant: null,
  run: null,
  executions: 0,
  divergences: 0,
  elapsedMs: 0,
  result: null,
  source: 'live',
  recordedAt: null,
  error: null,
} as const satisfies Partial<ProofRunState>;

const MAX_MESSAGE = 300;
const NO_RECORDING = 'No recorded proof could be loaded for this program and mutant.';

/** Resolves after `ms`, or at once when `signal` aborts (callers then see the run is no longer current). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

// Module state, not store state: the controller is not something views render.
let controller: AbortController | null = null;

function abortCurrent(): void {
  controller?.abort();
  controller = null;
}

export const useProofRun = create<ProofRunState>()((set, get) => ({
  ...IDLE,
  selectedMutant: null,

  selectMutant(mutant) {
    set({ selectedMutant: mutant });
  },

  async start(program, mutant) {
    abortCurrent();
    const own = new AbortController();
    controller = own;
    set({ ...IDLE, status: 'reanimating', program, mutant: mutant ?? null });
    // Every update checks it still belongs to this run, so a cancelled or replaced run never writes.
    const current = () => controller === own && !own.signal.aborted && get().status === 'reanimating';
    const fail = (error: ProofError) => {
      if (current()) set({ status: 'error', error });
    };
    try {
      await streamProve(
        { program, ...(mutant === undefined ? {} : { mutant }) },
        (event) => {
          if (!current()) return;
          switch (event.type) {
            case 'started':
              set({ run: { seed: event.seed, reference: event.reference, numRuns: event.numRuns } });
              break;
            case 'progress':
              set({ executions: event.executions, divergences: event.divergences, elapsedMs: event.elapsedMs });
              break;
            case 'result': {
              // Seed and reference for the summary come from the result itself, so `started` is not required.
              const { result } = event;
              set({ status: result.status === 'equivalent' ? 'alive' : 'relapsed', result });
              break;
            }
            case 'error':
              fail({ kind: 'run', message: event.message.slice(0, MAX_MESSAGE) });
              break;
          }
        },
        own.signal,
      );
      fail({ kind: 'stream', message: 'The proof stream ended before a result arrived.' });
    } catch (error) {
      if (error instanceof ProveRequestError) {
        fail({ kind: error.kind, message: error.message, ...(error.status === undefined ? {} : { httpStatus: error.status }) });
      } else {
        // Aborts land here too; `current()` is false for them, so nothing is written.
        fail({ kind: 'network', message: 'The proof could not be run in this browser.' });
      }
    } finally {
      if (controller === own) controller = null;
    }
  },

  async replayRecorded() {
    const { program, mutant } = get();
    if (program === null) return;
    abortCurrent();
    const own = new AbortController();
    controller = own;
    set({ ...IDLE, status: 'reanimating', source: 'recorded', program, mutant });

    const current = () => controller === own && !own.signal.aborted && get().status === 'reanimating';
    const fail = () => {
      if (current()) set({ status: 'error', error: { kind: 'recorded', message: NO_RECORDING } });
    };
    try {
      const recording = await fetchRecording({ program, mutant }, own.signal);
      if (!recording) {
        fail();
        return;
      }
      const { started, progress, result } = recording;
      if (!current()) return;
      set({
        run: { seed: started.seed, reference: started.reference, numRuns: started.numRuns },
        recordedAt: result.generatedAt,
      });
      let previousMs = 0;
      for (const snapshot of progress) {
        await sleep(snapshot.elapsedMs - previousMs, own.signal);
        if (!current()) return;
        previousMs = snapshot.elapsedMs;
        set({ executions: snapshot.executions, divergences: snapshot.divergences, elapsedMs: snapshot.elapsedMs });
      }
      set({ status: result.status === 'equivalent' ? 'alive' : 'relapsed', result });
    } catch {
      // Aborts land here too; `current()` is false for them, so nothing is written.
      fail();
    } finally {
      if (controller === own) controller = null;
    }
  },
  cancel() {
    if (get().status !== 'reanimating') return;
    abortCurrent();
    set({ status: 'cancelled' });
  },

  reset() {
    abortCurrent();
    set({ ...IDLE, selectedMutant: null });
  },
}));
