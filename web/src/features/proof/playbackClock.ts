/**
 * The playback clock for slow-motion recorded replays (graphical-proof design,
 * "playbackClock.ts"; Requirements 11.7 and 13.5).
 *
 * Display time is wall time with the paused time taken out: it runs at the
 * normal pace, stops while paused, and carries on from the same point on resume.
 * The rate only stretches recorded times: `sleepUntil(recordedMs)` resolves when
 * `recordedMs / rate` of display time has passed since `start()`. So at rate
 * 1/40 a snapshot recorded at 20 ms shows 800 ms in, and a pause of p ms delays
 * every later snapshot by exactly p. The snapshot's `elapsedMs` is never
 * changed, so elapsed times stay as recorded (13.5).
 *
 * The page has at most one active clock: the one the current slow replay runs on
 * (`useProofRun.replayRecorded(target, { rate, clock })` sets it, and any other
 * run or `reset` clears it). The Visuals read display time from it through
 * `displayNow()` (the shared frame loop) and `afterDisplay()` (the Shrink viewer's
 * step timer), so pausing the clock holds the replay timers and the animations
 * together (11.7). With no active clock both fall back to `performance.now()` and
 * `setTimeout`, which is the normal live and fallback behaviour.
 *
 * Display time starts at `now()` and only ever loses the paused time, so it never
 * runs ahead of `performance.now()`, and a switch between clocks never moves the
 * frame loop's time backwards.
 */

export interface PlaybackClockOptions {
  /** Playback_Rate: display ms per recorded ms is 1 / rate. 1 is real time. */
  readonly rate?: number;
  /** Wall clock in ms. Default `performance.now()`, the frame loop's own clock. */
  readonly now?: () => number;
}

export interface PlaybackClock {
  readonly rate: number;
  readonly paused: boolean;
  /** Display time in ms: wall time minus the time spent paused. Frozen while paused. */
  now(): number;
  /** Make the current display time recorded time 0 for `sleepUntil`. The clock starts at creation. */
  start(): void;
  /** Resolves once the replay reaches `recordedMs` (display time `recordedMs / rate` after `start`), or at once on abort. */
  sleepUntil(recordedMs: number, signal?: AbortSignal): Promise<void>;
  /** Calls `callback` after `displayMs` of display time (paused time does not count). Returns the cancel function. */
  after(displayMs: number, callback: () => void): () => void;
  pause(): void;
  resume(): void;
}

interface Waiter {
  /** Display time to wake at. */
  readonly target: number;
  readonly callback: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function createPlaybackClock({ rate = 1, now = () => performance.now() }: PlaybackClockOptions = {}): PlaybackClock {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`Playback rate must be a positive number, got ${rate}.`);
  let pausedTotal = 0;
  let pausedAt: number | null = null;
  const display = () => (pausedAt ?? now()) - pausedTotal;
  let origin = display();
  const waiters = new Set<Waiter>();

  // Timers only ever wake a check; the check fires the callback, or re-arms when the
  // clock was paused in between. Whole ms, rounded up, so a timer never wakes early
  // forever under coarse (or fake) timers.
  function arm(waiter: Waiter) {
    if (pausedAt !== null) return;
    const left = waiter.target - display();
    waiter.timer = setTimeout(() => check(waiter), left > 0 ? Math.ceil(left) : 0);
  }
  function check(waiter: Waiter) {
    waiter.timer = undefined;
    if (!waiters.has(waiter) || pausedAt !== null) return;
    if (display() < waiter.target) {
      arm(waiter);
      return;
    }
    waiters.delete(waiter);
    waiter.callback();
  }
  function wakeAt(target: number, callback: () => void): () => void {
    const waiter: Waiter = { target, callback, timer: undefined };
    waiters.add(waiter);
    arm(waiter);
    return () => {
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
    };
  }

  return {
    rate,
    get paused() {
      return pausedAt !== null;
    },
    now: display,
    start() {
      origin = display();
    },
    sleepUntil(recordedMs, signal) {
      return new Promise((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        const cancel = wakeAt(origin + recordedMs / rate, done);
        signal?.addEventListener('abort', done, { once: true });
        function done() {
          cancel();
          signal?.removeEventListener('abort', done);
          resolve();
        }
      });
    },
    after(displayMs, callback) {
      return wakeAt(display() + Math.max(0, displayMs), callback);
    },
    pause() {
      if (pausedAt !== null) return;
      pausedAt = now();
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.timer = undefined;
      }
    },
    resume() {
      if (pausedAt === null) return;
      pausedTotal += now() - pausedAt;
      pausedAt = null;
      for (const waiter of waiters) arm(waiter);
    },
  };
}

let active: PlaybackClock | null = null;

/** The clock the current slow replay runs on, or null. Set by `useProofRun`. */
export function activePlaybackClock(): PlaybackClock | null {
  return active;
}

export function setActivePlaybackClock(clock: PlaybackClock | null): void {
  active = clock;
}

/** Display time for the Visuals: the active clock's, else `performance.now()`. */
export function displayNow(): number {
  return active ? active.now() : performance.now();
}

/** `setTimeout` in display time: held while the active clock is paused. Returns the cancel function. */
export function afterDisplay(displayMs: number, callback: () => void): () => void {
  if (active) return active.after(displayMs, callback);
  const id = setTimeout(callback, displayMs);
  return () => clearTimeout(id);
}
