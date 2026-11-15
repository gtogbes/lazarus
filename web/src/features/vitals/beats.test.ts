import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BeatSnapshot } from './beats';
import { BEAT_INTERVAL_MS, scheduleBeats } from './beats';

const gen = (atMs: number, cases: number): BeatSnapshot => ({ atMs, cases, phase: 'generating' });

describe('scheduleBeats', () => {
  it('ticks every 500 ms with the cases since the last tick', () => {
    expect(BEAT_INTERVAL_MS).toBe(500);
    const snapshots = [gen(100, 10), gen(300, 30), gen(600, 45), gen(1200, 100)];
    expect(scheduleBeats(snapshots, 1500)).toEqual([
      { atMs: 500, batch: 30 },
      { atMs: 1000, batch: 15 },
      { atMs: 1500, batch: 55 },
    ]);
  });

  it('counts a snapshot exactly on a tick in that tick', () => {
    expect(scheduleBeats([gen(500, 7)], 500)).toEqual([{ atMs: 500, batch: 7 }]);
  });

  it('draws no beat for an interval with no completed case', () => {
    const snapshots = [gen(200, 20), gen(700, 20), gen(1400, 25)];
    expect(scheduleBeats(snapshots, 1500)).toEqual([
      { atMs: 500, batch: 20 },
      { atMs: 1500, batch: 5 },
    ]);
  });

  it('only includes ticks at or before the display time', () => {
    expect(scheduleBeats([gen(100, 5), gen(800, 9)], 999)).toEqual([{ atMs: 500, batch: 5 }]);
    expect(scheduleBeats([gen(100, 5)], 499)).toEqual([]);
  });

  it('draws no beat at display time 0, even for a snapshot at 0 ms', () => {
    // Property 8 counterexample: no tick has happened yet at 0 ms.
    expect(scheduleBeats([gen(0, 1)], 0)).toEqual([]);
  });

  it('stops beating from the first shrinking snapshot', () => {
    const snapshots: BeatSnapshot[] = [gen(100, 40), gen(600, 60), { atMs: 700, cases: 61, phase: 'shrinking' }, gen(1200, 90)];
    expect(scheduleBeats(snapshots, 2000)).toEqual([
      { atMs: 500, batch: 40 },
      { atMs: 1000, batch: 20 },
    ]);
  });

  it('ignores cases that go down', () => {
    expect(scheduleBeats([gen(100, 10), gen(600, 4), gen(1100, 12)], 1500)).toEqual([
      { atMs: 500, batch: 10 },
      { atMs: 1500, batch: 2 },
    ]);
  });

  it('returns nothing for no snapshots or a bad clock', () => {
    expect(scheduleBeats([], 5000)).toEqual([]);
    expect(scheduleBeats([gen(100, 1)], Number.NaN)).toEqual([]);
    expect(scheduleBeats([gen(100, 1)], Number.POSITIVE_INFINITY)).toEqual([]);
    expect(scheduleBeats([gen(100, 1)], -1)).toEqual([]);
  });
});

// Non-decreasing generating snapshots: sorted display times paired with running case totals.
const generatingRun = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 20_000 }), fc.integer({ min: 0, max: 500 })), { maxLength: 100 })
  .map((steps) => {
    const times = steps.map(([t]) => t).sort((a, b) => a - b);
    let cases = 0;
    return steps.map(([, added], i): BeatSnapshot => {
      cases += added;
      return gen(times[i]!, cases);
    });
  });

describe('scheduleBeats properties', () => {
  // Feature: graphical-proof, Property 8: Beats conserve cases and respect the rate limit
  // **Validates: Requirements 4.1, 4.2, 4.6**
  it('has positive batches summing to the cases at the last tick, at least 500 ms apart', () => {
    fc.assert(
      fc.property(generatingRun, fc.integer({ min: 0, max: 25_000 }), (snapshots, displayMs) => {
        const beats = scheduleBeats(snapshots, displayMs);
        const lastTick = Math.floor(displayMs / BEAT_INTERVAL_MS) * BEAT_INTERVAL_MS;
        // Ticks are positive multiples of 500 ms, so before the first tick nothing has beaten.
        const casesAtLastTick =
          lastTick > 0 ? snapshots.filter((s) => s.atMs <= lastTick).reduce((max, s) => Math.max(max, s.cases), 0) : 0;

        for (const beat of beats) {
          expect(beat.batch).toBeGreaterThan(0);
          expect(beat.atMs % BEAT_INTERVAL_MS).toBe(0);
          expect(beat.atMs).toBeGreaterThan(0);
          expect(beat.atMs).toBeLessThanOrEqual(displayMs);
        }
        expect(beats.reduce((sum, beat) => sum + beat.batch, 0)).toBe(casesAtLastTick);
        for (let i = 1; i < beats.length; i += 1) {
          expect(beats[i]!.atMs - beats[i - 1]!.atMs).toBeGreaterThanOrEqual(BEAT_INTERVAL_MS);
        }
      }),
      { numRuns: 200 },
    );
  });
});
