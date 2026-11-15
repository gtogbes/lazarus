/**
 * `useDemo`: the Demo_Mode controller (graphical-proof design, "Demo mode";
 * Requirements 11.2, 11.3, 11.7, 11.8, 11.11, 11.12 and 16.4). It runs
 * `demoScript.ts` step by step on playback clocks and drives `useProofRun`.
 *
 * - `run()` first loads and checks every recording the script names (same
 *   origin, `recorded/<file>`, through `fetchRecording`), so a missing or invalid
 *   one stops the demo before it starts and is named in `error` (11.11). It also
 *   keeps each recording's date and real duration for the labels (11.4, 11.5).
 *   Nothing here calls the Proof_API (11.3): replays use `replayRecorded`, and
 *   the revive uses `revive({ clock })`, which replays the recording.
 * - Each step gets its own clock at the step's rate (1 when it replays
 *   nothing). The step's hold and cues run on it in display time, and a replay
 *   or revive runs on it too, which makes it the page's active clock. The next
 *   step starts when the hold has ended and the replay has finished.
 * - `pause`/`resume` pause the step clock and the active clock, which holds the
 *   replay timers, the hold, the cues, the frame loop and the Shrink viewer's
 *   steps, and carries on from the same point (11.7).
 * - `skip` ends the current step at once: its replay runs straight to its
 *   recorded result and the step's last cue is shown. Skipping while paused
 *   moves on and stays paused.
 * - `exit` stops the demo, aborts any replay and resets the proof store (11.8).
 *   The view (task 19.2) calls it when the user exits or leaves the route, then
 *   removes `?demo` and moves focus.
 * - A replay that does not end with the outcome the step expects stops the
 *   demo and names the recording (11.11).
 *
 * The revive shock pulse (ResurrectionFill, an 800 ms CSS animation) is not on
 * the playback clock: the demo bar holds it with `data-demo-paused` on the root
 * element (`animation-play-state: paused`, index.css). Known limitation: the
 * scene's revive mood is not held by a pause.
 */
import { create } from 'zustand';
import { activePlaybackClock, createPlaybackClock, type PlaybackClock } from '../proof/playbackClock';
import { fetchRecording, type Recording } from '../proof/recording';
import { useProofRun } from '../proof/useProofRun';
import {
  DEMO_SCRIPT,
  demoRecordings,
  stepRate,
  stepRecording,
  type DemoCue,
  type DemoOutcome,
  type DemoRecording,
  type DemoStep,
} from './demoScript';

/** What the labels need from a recording (Requirements 11.4, 11.5 and 13.5). */
export interface DemoRecordingInfo {
  /** The result's `generatedAt`, ISO 8601. */
  readonly recordedAt: string;
  /** The real run's duration, as recorded. */
  readonly durationMs: number;
}

/** Why the demo stopped early (11.11). */
export interface DemoError {
  /** Path of the recording that failed, e.g. `recorded/PAYROLL.json`. */
  readonly recording: string;
  readonly message: string;
}

export interface DemoState {
  /** From `run` until the last step ends, `exit`, or a failure. */
  readonly running: boolean;
  readonly paused: boolean;
  /** Index into `script`; -1 before the first step (and while the recordings load). */
  readonly stepIndex: number;
  /** What the program view shows now. */
  readonly cue: DemoCue | null;
  readonly script: readonly DemoStep[];
  /** Keyed by file name relative to `recorded/` (`DemoRecording.file`). */
  readonly recordings: Readonly<Record<string, DemoRecordingInfo>>;
  readonly error: DemoError | null;
  /** The last step ended; the final state stays on screen. */
  readonly done: boolean;

  run(script?: readonly DemoStep[]): Promise<void>;
  pause(): void;
  resume(): void;
  skip(): void;
  /**
   * Stop the demo. `keepProof` leaves the proof store alone: a live Prove or
   * Revive that ends the demo starts its own run at once, which aborts the replay.
   */
  exit(options?: { readonly keepProof?: boolean }): void;
}

/** A playback clock whose replay waits can be ended at once (`skip`). */
interface DemoClock extends PlaybackClock {
  /** Every current and later `sleepUntil` resolves at once, paused or not. */
  finish(): void;
}

function createDemoClock(rate: number): DemoClock {
  const base = createPlaybackClock({ rate });
  const finishing = new AbortController();
  return {
    rate: base.rate,
    get paused() {
      return base.paused;
    },
    now: () => base.now(),
    start: () => base.start(),
    after: (displayMs, callback) => base.after(displayMs, callback),
    pause: () => base.pause(),
    resume: () => base.resume(),
    sleepUntil(recordedMs, signal) {
      if (finishing.signal.aborted || signal?.aborted) return Promise.resolve();
      const either = new AbortController();
      const stop = () => either.abort();
      finishing.signal.addEventListener('abort', stop, { once: true });
      signal?.addEventListener('abort', stop, { once: true });
      return base.sleepUntil(recordedMs, either.signal).finally(() => {
        finishing.signal.removeEventListener('abort', stop);
        signal?.removeEventListener('abort', stop);
      });
    },
    finish: () => finishing.abort(),
  };
}

/** One demo run. Module state, like `useProofRun`'s controller: views never render it. */
interface Session {
  /** Aborts the recording checks. */
  readonly loading: AbortController;
  clock: DemoClock | null;
  /** Ends the current step's hold at once. */
  endHold: (() => void) | null;
}
let session: Session | null = null;

const IDLE = {
  running: false,
  paused: false,
  stepIndex: -1,
  cue: null,
  recordings: {},
  error: null,
  done: false,
} as const satisfies Partial<DemoState>;

const proof = () => useProofRun.getState();

function shows(recording: Recording, expect: DemoOutcome): boolean {
  const { result } = recording;
  return expect === 'alive' ? result.status === 'equivalent' && result.truncated !== true : result.status === 'diverged';
}

/** The cue in force at `atMs` display ms into the step. */
function cueAt(step: DemoStep, atMs: number): DemoCue | null {
  let cue: DemoCue | null = null;
  for (const timed of step.cues) if (timed.atMs <= atMs) cue = timed.cue;
  return cue;
}

export const useDemo = create<DemoState>()((set, get) => {
  /** Stop `own` and show the failure, unless it was already replaced or stopped. */
  function fail(own: Session, { file }: DemoRecording, problem: string) {
    if (session !== own) return;
    session = null;
    activePlaybackClock()?.resume();
    set({
      running: false,
      paused: false,
      error: { recording: `recorded/${file}`, message: `The demo stopped: the recording recorded/${file} ${problem}.` },
    });
  }

  /** Check every recording the script names before the first step (11.11, 16.4). */
  async function load(own: Session, script: readonly DemoStep[]): Promise<boolean> {
    const needed = demoRecordings(script);
    const loaded = await Promise.all(
      needed.map((recording) => fetchRecording(recording.target, own.loading.signal).catch(() => null)),
    );
    if (session !== own) return false;
    const recordings: Record<string, DemoRecordingInfo> = {};
    for (const [i, recording] of needed.entries()) {
      const found = loaded[i];
      if (!found) {
        fail(own, recording, 'is missing or invalid');
        return false;
      }
      if (!shows(found, recording.expect)) {
        fail(own, recording, `does not show the ${recording.expect === 'alive' ? 'Alive' : 'Relapsed'} result this step needs`);
        return false;
      }
      recordings[recording.file] = { recordedAt: found.result.generatedAt, durationMs: found.result.durationMs };
    }
    set({ recordings });
    return true;
  }

  async function perform(step: DemoStep, clock: DemoClock): Promise<void> {
    const { action } = step;
    switch (action.kind) {
      case 'hold':
        return;
      case 'select-mutant':
        proof().selectMutant(action.mutant);
        return;
      case 'replay':
        await proof().replayRecorded(action.target, { clock });
        return;
      case 'revive':
        await proof().revive({ clock });
        return;
    }
  }

  /** Runs one step to its end. False when the demo stopped during it. */
  async function runStep(own: Session, step: DemoStep, index: number): Promise<boolean> {
    const clock = createDemoClock(stepRate(step) ?? 1);
    own.clock = clock;
    if (get().paused) clock.pause();
    set({ stepIndex: index, cue: cueAt(step, 0) });
    const cancels = step.cues
      .filter(({ atMs }) => atMs > 0)
      .map(({ atMs, cue }) =>
        clock.after(atMs, () => {
          if (session === own) set({ cue });
        }),
      );
    const held = new Promise<void>((resolve) => {
      const cancel = clock.after(step.durationMs, resolve);
      own.endHold = () => {
        cancel();
        resolve();
      };
    });
    await Promise.all([held, perform(step, clock)]);
    for (const cancel of cancels) cancel();
    own.endHold = null;
    if (session !== own) return false;
    const recording = stepRecording(step);
    if (recording && proof().status !== recording.expect) {
      fail(own, recording, proof().status === 'error' ? 'is missing or invalid' : 'did not replay to the result this step needs');
      return false;
    }
    return true;
  }

  /** Stop the current session, if any, without touching the proof store. */
  function stop() {
    const own = session;
    session = null;
    if (!own) return;
    own.loading.abort();
    own.endHold?.();
  }

  return {
    ...IDLE,
    script: DEMO_SCRIPT,

    async run(script = DEMO_SCRIPT) {
      stop();
      proof().reset();
      const own: Session = { loading: new AbortController(), clock: null, endHold: null };
      session = own;
      set({ ...IDLE, running: true, script });
      if (!(await load(own, script))) return;
      for (const [index, step] of script.entries()) {
        if (!(await runStep(own, step, index))) return;
      }
      session = null;
      // A skip while paused can end the last step paused; leave the final state moving.
      activePlaybackClock()?.resume();
      set({ running: false, paused: false, done: true });
    },

    pause() {
      if (!get().running || get().paused) return;
      set({ paused: true });
      session?.clock?.pause();
      activePlaybackClock()?.pause();
    },

    resume() {
      if (!get().paused) return;
      set({ paused: false });
      session?.clock?.resume();
      activePlaybackClock()?.resume();
    },

    skip() {
      const own = session;
      if (!own?.clock) return;
      const step = get().script[get().stepIndex];
      own.clock.finish();
      if (step) set({ cue: cueAt(step, Infinity) });
      own.endHold?.();
    },

    exit({ keepProof = false } = {}) {
      stop();
      if (!keepProof) proof().reset();
      set({ ...IDLE });
    },
  };
});
