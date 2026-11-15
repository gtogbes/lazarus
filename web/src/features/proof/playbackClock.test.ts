import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlaybackClock } from './playbackClock';

// Fake timers also fake Date.now, and set it to each timer's due time before the
// timer runs, so `now: () => Date.now()` is a wall clock that moves with the timers.
const wall = () => Date.now();

afterEach(() => {
  vi.useRealTimers();
});

describe('createPlaybackClock', () => {
  it('rejects a rate that is not a positive number', () => {
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createPlaybackClock({ rate, now: wall })).toThrow(RangeError);
    }
  });

  it('shows a snapshot recorded at 20 ms after 800 ms at rate 1/40', async () => {
    vi.useFakeTimers({ now: 0 });
    const clock = createPlaybackClock({ rate: 1 / 40, now: wall });
    let shownAt: number | null = null;
    void clock.sleepUntil(20).then(() => (shownAt = Date.now()));
    await vi.advanceTimersByTimeAsync(799);
    expect(shownAt).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(shownAt).toBe(800);
  });

  it('holds display time while paused and delays every later snapshot by the pause', async () => {
    vi.useFakeTimers({ now: 0 });
    const clock = createPlaybackClock({ rate: 1 / 10, now: wall });
    const shown: number[] = [];
    void clock.sleepUntil(20).then(() => shown.push(Date.now()));
    void clock.sleepUntil(30).then(() => shown.push(Date.now()));
    await vi.advanceTimersByTimeAsync(150);
    clock.pause();
    expect(clock.paused).toBe(true);
    expect(clock.now()).toBe(150);
    await vi.advanceTimersByTimeAsync(500);
    expect(clock.now()).toBe(150);
    expect(shown).toEqual([]);
    clock.resume();
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown).toEqual([700, 800]);
    expect(clock.now()).toBe(1150);
  });

  it('measures recorded times from start(), and resolves at once on abort', async () => {
    vi.useFakeTimers({ now: 0 });
    const clock = createPlaybackClock({ rate: 1 / 2, now: wall });
    await vi.advanceTimersByTimeAsync(100);
    clock.start();
    let shownAt: number | null = null;
    void clock.sleepUntil(50).then(() => (shownAt = Date.now()));
    const controller = new AbortController();
    let aborted = false;
    void clock.sleepUntil(1000, controller.signal).then(() => (aborted = true));
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(shownAt).toBe(200);
  });

  it('after() counts display time only, and its cancel stops the callback', async () => {
    vi.useFakeTimers({ now: 0 });
    const clock = createPlaybackClock({ now: wall });
    const fired: string[] = [];
    clock.after(100, () => fired.push(`a@${Date.now()}`));
    const cancel = clock.after(100, () => fired.push('cancelled'));
    cancel();
    await vi.advanceTimersByTimeAsync(40);
    clock.pause();
    await vi.advanceTimersByTimeAsync(1000);
    clock.resume();
    await vi.advanceTimersByTimeAsync(100);
    expect(fired).toEqual(['a@1100']);
  });
});

type Op = { kind: 'advance'; ms: number } | { kind: 'pause' } | { kind: 'resume' };

const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 400 }).map((ms) => ({ kind: 'advance' as const, ms })) },
  { weight: 1, arbitrary: fc.constant({ kind: 'pause' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'resume' as const }) },
);

describe('playback clock property', () => {
  // Feature: graphical-proof, Property 17: Playback clock keeps recorded times and pauses exactly
  // **Validates: Requirements 11.7, 13.5**
  it('keeps display time monotonic, holds it while paused, and shows each snapshot at recorded / rate plus the pause before it, in order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 1 / 50, max: 1, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 200, noNaN: true }), { maxLength: 12 }).map((ts) => [...ts].sort((a, b) => a - b)),
        fc.integer({ min: 0, max: 1000 }),
        fc.array(op, { maxLength: 30 }),
        async (rate, recorded, startDelay, ops) => {
          vi.useFakeTimers({ now: 0 });
          try {
            const clock = createPlaybackClock({ rate, now: wall });
            await vi.advanceTimersByTimeAsync(startDelay);
            clock.start();
            const startWall = Date.now();

            // Model: total paused wall time, and when the current pause began.
            let pausedTotal = 0;
            let pausedAt: number | null = null;
            const snapshots = recorded.map((elapsedMs) => ({ elapsedMs }));
            const shown: { index: number; elapsedMs: number; display: number; wallMinusPause: number; paused: boolean }[] = [];
            snapshots.forEach((snapshot, index) => {
              void clock.sleepUntil(snapshot.elapsedMs).then(() => {
                shown.push({ index, elapsedMs: snapshot.elapsedMs, display: clock.now(), wallMinusPause: Date.now() - pausedTotal, paused: pausedAt !== null });
              });
            });

            let last = clock.now();
            const step = async (o: Op) => {
              if (o.kind === 'advance') await vi.advanceTimersByTimeAsync(o.ms);
              else if (o.kind === 'pause') {
                clock.pause();
                if (pausedAt === null) pausedAt = Date.now();
              } else {
                clock.resume();
                if (pausedAt !== null) {
                  pausedTotal += Date.now() - pausedAt;
                  pausedAt = null;
                }
              }
              const display = clock.now();
              expect(display).toBeGreaterThanOrEqual(last);
              expect(clock.paused).toBe(pausedAt !== null);
              expect(display).toBe((pausedAt ?? Date.now()) - pausedTotal);
              last = display;
            };

            for (const o of ops) {
              const before = clock.now();
              await step(o);
              // Held while paused: an advance during a pause leaves display time where it was.
              if (o.kind === 'advance' && pausedAt !== null) expect(clock.now()).toBe(before);
            }
            // Play out the rest so every snapshot is shown.
            await step({ kind: 'resume' });
            await step({ kind: 'advance', ms: 201 * 50 + 1 });

            // Recorded times are sorted, so in order means by index (ties keep scheduling order).
            expect(shown.map((s) => s.index)).toEqual(snapshots.map((_, i) => i));
            for (const s of shown) {
              const target = startWall + s.elapsedMs / rate;
              expect(s.paused).toBe(false);
              // Whole-ms clock: shown at the first ms at or after the target, never early.
              expect(s.display).toBeGreaterThanOrEqual(target);
              expect(s.display).toBeLessThanOrEqual(Math.ceil(target));
              expect(s.wallMinusPause).toBe(s.display);
            }
            // Recorded elapsed times are never changed.
            expect(snapshots.map((s) => s.elapsedMs)).toEqual(recorded);
          } finally {
            vi.useRealTimers();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
