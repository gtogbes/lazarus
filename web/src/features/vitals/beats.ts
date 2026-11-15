/**
 * Beat schedule for the Heartbeat (graphical-proof design, "beats.ts").
 *
 * The strip ticks once every `BEAT_INTERVAL_MS` of display time. At each tick it
 * draws one beat whose batch is the cases completed since the previous tick, or no
 * beat when none completed (Requirements 4.1 and 4.2). One beat per tick at most
 * keeps the strip at 2 beats per second whatever the progress rate (Requirement 4.6).
 *
 * Pure: the Heartbeat calls it each frame with the snapshots seen so far and the
 * display clock, so the same input always draws the same strip (replays included).
 */
import type { ProofPhase } from '../../../../src/harness/equivalence.types';

export const BEAT_INTERVAL_MS = 500;

/** A progress snapshot at a display time, in ms since the run started. */
export interface BeatSnapshot {
  readonly atMs: number;
  readonly cases: number;
  readonly phase: ProofPhase;
}

export interface Beat {
  /** The tick's display time: a positive multiple of `BEAT_INTERVAL_MS`. */
  readonly atMs: number;
  /** Cases completed since the previous tick; always > 0. */
  readonly batch: number;
}

/**
 * The beats for every tick at or before `displayMs`. `snapshots` must be in display
 * time order. Only `generating` snapshots count: from the first `shrinking` snapshot
 * on, the strip flatlines and no tick beats. A snapshot whose cases went down is
 * ignored rather than drawn as a negative batch.
 */
export function scheduleBeats(snapshots: readonly BeatSnapshot[], displayMs: number): Beat[] {
  const beats: Beat[] = [];
  if (!Number.isFinite(displayMs)) return beats;
  let next = 0; // next snapshot to read
  let cases = 0; // cases at the latest generating snapshot read so far
  let counted = 0; // cases already drawn as beats
  let flatlined = false;
  for (let tick = BEAT_INTERVAL_MS; tick <= displayMs && !flatlined; tick += BEAT_INTERVAL_MS) {
    while (next < snapshots.length && snapshots[next]!.atMs <= tick) {
      const snapshot = snapshots[next]!;
      next += 1;
      if (snapshot.phase !== 'generating') {
        flatlined = true; // still beat this tick for the cases completed before it
        break;
      }
      cases = Math.max(cases, snapshot.cases);
    }
    if (cases > counted) {
      beats.push({ atMs: tick, batch: cases - counted });
      counted = cases;
    }
  }
  return beats;
}
