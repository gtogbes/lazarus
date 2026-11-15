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
 * `replayRecorded(target)` replays an explicit program and mutant instead.
 * `replayRecorded(target, { rate, clock })` (graphical-proof Requirement 11)
 * replays at a Playback_Rate on a playback clock (playbackClock.ts), which it
 * makes the page's active clock so the Visuals slow down and pause with it. A
 * rate alone gets a fresh clock. Every other run, and `reset`, clears the active
 * clock. With no options the replay keeps its plain timers (Requirement 6).
 * `{ recording }` replays a recording the caller already loaded instead of
 * fetching it again (Demo_Mode).
 *
 * `revive` (graphical-proof Requirement 10.2) selects "No sabotage" and proves
 * the real port live, also when the relapsed run was a recorded replay. Only if
 * that live run ends in `error` does it replay the recorded proof of the real
 * port. With `{ recorded: true }` (Demo_Mode, Requirement 11.3) it replays the
 * recording directly and never calls the Proof_API; `rate`, `clock` or `recording` imply it
 * and go to `replayRecorded`. While it runs,
 * `revival.pending` is true; when it ends Alive, `revival.revivedAt` is set (the
 * shock pulse and the scene's revive mood key off it). Any other outcome leaves
 * `revivedAt` null. Any other `start`, `replayRecorded` or `reset` clears
 * `revival`, so a stale revive never pulses.
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
 *
 * `cases` and `phase` (graphical-proof Requirement 1) go through
 * `progressModel` for live and recorded runs alike: a progress event whose
 * `cases` or `phase` conflicts with the run so far is ignored, like any invalid
 * event. Events without them (older servers, version 1 recordings) get derived
 * values, and the result sets the final `cases`.
 *
 * Readers: the program view and Prove panel subscribe to fields; the lab scene
 * and the vitals frame loop read `getState()` each frame instead, so 4 Hz (or
 * 50 Hz recorded) progress never re-renders them.
 * An `error` is never a divergence: it never sets `relapsed` (design, "Error handling").
 */
import { create } from 'zustand';
import type { EquivalenceResult, ProofPhase } from '../../../../src/harness/equivalence.types';
import { applyProgress, finalizeProgress, INITIAL_PROGRESS_STATE, type ProgressState } from './progressModel';
import { ProveRequestError, streamProve } from './proveClient';
import { createPlaybackClock, setActivePlaybackClock, type PlaybackClock } from './playbackClock';
import { fetchRecording, type Recording } from './recording';

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

export interface ReviveState {
  readonly pending: boolean;
  readonly revivedAt: number | null;
}

/** How a recorded proof is replayed (graphical-proof Requirement 11). */
export interface ReplayOptions {
  /** Playback_Rate; 1 is the recorded pace. Must match `clock.rate` when both are given. */
  readonly rate?: number;
  /** The clock to replay on; it becomes the active clock. Default: a new clock at `rate`. */
  readonly clock?: PlaybackClock;
  /**
   * The recording for the target, already fetched and checked (Demo_Mode loads
   * them all before its first step). Replayed without fetching it again, so the
   * replay does not depend on the server still answering, and `run` is set at once.
   */
  readonly recording?: Recording;
}
export interface ReviveOptions extends ReplayOptions {
  /** Replay the recording without calling the Proof_API (Demo_Mode, Requirement 11.3). Implied by `rate` or `clock`. */
  readonly recorded?: boolean;
}

/** A program and mutant to replay; null proves the real port. */
export interface ProofTarget {
  readonly program: string;
  readonly mutant: string | null;
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
  /**
   * Generated cases, including the first failure; shrink attempts are not
   * cases (graphical-proof Requirement 1). Derived for events without it, and
   * set from the result at the end.
   */
  readonly cases: number;
  /** `shrinking` from the first divergence on. */
  readonly phase: ProofPhase;
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
  /** The run started by `revive` (Requirement 10): in progress, or when it ended Alive (`Date.now()`). */
  readonly revival: ReviveState;

  selectMutant(mutant: string | null): void;
  start(program: string, mutant?: string): Promise<void>;
  /** Replay the recorded proof for the program and mutant of the last run (Requirement 6.1), or `target`. */
  replayRecorded(target?: ProofTarget, options?: ReplayOptions): Promise<void>;
  /** Restore the real port and prove it (Requirement 10.2). `recorded`: Demo_Mode, replay only. */
  revive(options?: ReviveOptions): Promise<void>;
  cancel(): void;
  reset(): void;
}

const IDLE = {
  status: 'idle',
  program: null,
  mutant: null,
  run: null,
  ...INITIAL_PROGRESS_STATE,
  result: null,
  source: 'live',
  recordedAt: null,
  error: null,
  revival: { pending: false, revivedAt: null },
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

const progressOf = ({ executions, divergences, elapsedMs, cases, phase }: ProgressState): ProgressState => ({
  executions,
  divergences,
  elapsedMs,
  cases,
  phase,
});

/** The store update for a result: its status, and its final case count. */
const settle = (state: ProgressState, result: EquivalenceResult) => ({
  ...finalizeProgress(progressOf(state), result),
  status: result.status === 'equivalent' ? ('alive' as const) : ('relapsed' as const),
  result,
});

// Module state, not store state: the controller is not something views render.
let controller: AbortController | null = null;
// Bumped by each `revive` call, so an older revive that was replaced never writes.
let reviveToken = 0;
const REVIVE_PENDING: ReviveState = { pending: true, revivedAt: null };

function abortCurrent(): void {
  controller?.abort();
  controller = null;
}
/** The clock a replay runs on, or null for the plain recorded pace. Throws on a rate that does not match the clock. */
function replayClock({ rate, clock }: ReplayOptions): PlaybackClock | null {
  if (clock) {
    if (rate !== undefined && rate !== clock.rate) throw new RangeError(`Rate ${rate} does not match the clock's rate ${clock.rate}.`);
    return clock;
  }
  return rate === undefined ? null : createPlaybackClock({ rate });
}

export const useProofRun = create<ProofRunState>()((set, get) => ({
  ...IDLE,
  selectedMutant: null,

  selectMutant(mutant) {
    set({ selectedMutant: mutant });
  },

  async start(program, mutant) {
    abortCurrent();
    setActivePlaybackClock(null);
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
            case 'progress': {
              const state = get();
              const next = applyProgress(progressOf(state), event, state.run?.numRuns ?? null);
              if (next) set(next);
              break;
            }
            case 'result':
              // Seed and reference for the summary come from the result itself, so `started` is not required.
              set(settle(get(), event.result));
              break;
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

  async replayRecorded(target, options = {}) {
    const { program, mutant } = target ?? get();
    if (program === null) return;
    const clock = replayClock(options);
    abortCurrent();
    setActivePlaybackClock(clock);
    const own = new AbortController();
    controller = own;
    set({ ...IDLE, status: 'reanimating', source: 'recorded', program, mutant });

    const current = () => controller === own && !own.signal.aborted && get().status === 'reanimating';
    const fail = () => {
      if (current()) set({ status: 'error', error: { kind: 'recorded', message: NO_RECORDING } });
    };
    try {
      const recording = options.recording ?? (await fetchRecording({ program, mutant }, own.signal));
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
      // Recorded time 0 is when the replay starts showing, not when the fetch began.
      clock?.start();
      let previousMs = 0;
      for (const snapshot of progress) {
        // `elapsedMs` itself is kept: elapsed times show as recorded at any rate (13.5).
        await (clock ? clock.sleepUntil(snapshot.elapsedMs, own.signal) : sleep(snapshot.elapsedMs - previousMs, own.signal));
        if (!current()) return;
        previousMs = snapshot.elapsedMs;
        const next = applyProgress(progressOf(get()), snapshot, started.numRuns);
        if (next) set(next);
      }
      set(settle(get(), result));
    } catch {
      // Aborts land here too; `current()` is false for them, so nothing is written.
      fail();
    } finally {
      if (controller === own) controller = null;
    }
  },
  async revive(options = {}) {
    const { program } = get();
    if (program === null) return;
    const token = ++reviveToken;
    get().selectMutant(null);
    // Still this revive's run: no newer revive, and no other run or reset cleared `pending`.
    const mine = () => token === reviveToken && get().revival.pending;
    // `start` and `replayRecorded` reset the store synchronously, so mark pending after the call.
    const recorded =
      options.recorded === true || options.rate !== undefined || options.clock !== undefined || options.recording !== undefined;
    // `replayRecorded` only reads `rate`, `clock` and `recording`.
    const run = recorded ? get().replayRecorded({ program, mutant: null }, options) : get().start(program);
    set({ revival: REVIVE_PENDING });
    await run;
    if (!mine()) return;
    if (!recorded && get().status === 'error') {
      // The live run failed (Requirement 6.1): the last run is now the real port, so replay its recording.
      const replay = get().replayRecorded({ program, mutant: null });
      set({ revival: REVIVE_PENDING });
      await replay;
      if (!mine()) return;
    }
    set({ revival: { pending: false, revivedAt: get().status === 'alive' ? Date.now() : null } });
  },

  cancel() {
    if (get().status !== 'reanimating') return;
    abortCurrent();
    set({ status: 'cancelled' });
  },

  reset() {
    abortCurrent();
    setActivePlaybackClock(null);
    set({ ...IDLE, selectedMutant: null });
  },
}));
