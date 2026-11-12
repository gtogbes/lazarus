import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ProofStatus } from '../features/proof/useProofRun';
import {
  ALARM_HZ,
  MAX_FLICKER_HZ,
  MIN_FLICKER_HZ,
  FULL_FPS,
  NUDGE_ARC_BOOST,
  NUDGE_MIN_INTERVAL_MS,
  NUDGE_MS,
  REANIMATION_MS,
  STEADY_FPS,
  acceptNudge,
  advancePhase,
  casesPerSecond,
  flickerHz,
  moodForStatus,
  sceneFrame,
  targetFps,
  withNudge,
  type SceneMood,
} from './sceneLook';

const STATUSES: readonly ProofStatus[] = ['idle', 'reanimating', 'alive', 'relapsed', 'error', 'cancelled'];
const seconds = fc.double({ min: 0, max: 600, noNaN: true });
const phase = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });

describe('moodForStatus', () => {
  it('maps every status to a mood, and error to fault rather than relapsed', () => {
    expect(STATUSES.map(moodForStatus)).toEqual(['buried', 'reanimating', 'alive', 'relapsed', 'fault', 'buried']);
  });
});

describe('flicker rate (Requirement 7.2)', () => {
  it('derives cases per second from the live counters', () => {
    expect(casesPerSecond(734, 251)).toBeCloseTo(2924.3, 1);
    expect(casesPerSecond(0, 0)).toBe(0);
    expect(casesPerSecond(10, 0)).toBe(0);
  });

  it('is proportional to cases per second inside the clamp', () => {
    expect(flickerHz(1000)).toBeCloseTo(1);
    expect(flickerHz(2000)).toBeCloseTo(2);
    expect(flickerHz(0)).toBe(MIN_FLICKER_HZ);
    expect(flickerHz(50_000)).toBe(MAX_FLICKER_HZ);
    expect(flickerHz(Number.POSITIVE_INFINITY)).toBe(MAX_FLICKER_HZ);
  });

  it('never decreases as the case rate rises and stays within 0.5-3 Hz', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.double({ min: 0, max: 1e6, noNaN: true }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(flickerHz(lo)).toBeLessThanOrEqual(flickerHz(hi));
        expect(flickerHz(hi)).toBeGreaterThanOrEqual(MIN_FLICKER_HZ);
        expect(flickerHz(hi)).toBeLessThanOrEqual(MAX_FLICKER_HZ);
      }),
    );
  });

  it('flickers the arcs with one cycle per phase turn, so the rate is the phase speed', () => {
    fc.assert(
      fc.property(phase, fc.double({ min: MIN_FLICKER_HZ, max: MAX_FLICKER_HZ, noNaN: true }), (p, hz) => {
        // Advancing by one period returns to the same phase and the same arc intensity.
        const next = advancePhase(p, hz, 1 / hz);
        const at = (flickerPhase: number) => sceneFrame('reanimating', { sinceMoodSec: 0, flickerPhase }).arcIntensity;
        expect(at(next)).toBeCloseTo(at(p), 6);
      }),
    );
    const trough = sceneFrame('reanimating', { sinceMoodSec: 0, flickerPhase: 0.25 }).arcIntensity;
    const crest = sceneFrame('reanimating', { sinceMoodSec: 0, flickerPhase: 0.75 }).arcIntensity;
    expect(crest).toBeGreaterThan(trough);
  });
});

describe('reanimation moment (Requirement 7.3)', () => {
  it('lasts under 3 seconds', () => {
    expect(REANIMATION_MS).toBeLessThan(3000);
  });

  it('bursts the arcs at the start, then holds warm steady light', () => {
    const start = sceneFrame('alive', { sinceMoodSec: 0, flickerPhase: 0 });
    const end = sceneFrame('alive', { sinceMoodSec: REANIMATION_MS / 1000, flickerPhase: 0 });
    expect(start.arcIntensity).toBeGreaterThan(end.arcIntensity);
    expect(start.slabGlow).toBeGreaterThan(end.slabGlow);
    fc.assert(
      fc.property(seconds, phase, (extra, p) => {
        const later = sceneFrame('alive', { sinceMoodSec: REANIMATION_MS / 1000 + extra, flickerPhase: p });
        expect(later).toEqual(end);
      }),
    );
    expect(end.keyColor).not.toBe(sceneFrame('buried', { sinceMoodSec: 0, flickerPhase: 0 }).keyColor);
  });
});

describe('relapsed and error lighting', () => {
  it('pulses the alarm when relapsed, with the reels stopped', () => {
    const quarter = 1 / (4 * ALARM_HZ);
    const peak = sceneFrame('relapsed', { sinceMoodSec: quarter, flickerPhase: 0 });
    const low = sceneFrame('relapsed', { sinceMoodSec: 3 * quarter, flickerPhase: 0 });
    expect(peak.alarmIntensity).toBeGreaterThan(low.alarmIntensity);
    expect(low.alarmIntensity).toBeGreaterThan(0);
    expect(peak.reelSpeed).toBe(0);
    expect(ALARM_HZ).toBeLessThanOrEqual(3);
  });

  it('never shows the alarm for an error, and uses a different key colour from relapsed', () => {
    const relapsedKey = sceneFrame('relapsed', { sinceMoodSec: 0, flickerPhase: 0 }).keyColor;
    fc.assert(
      fc.property(seconds, phase, (s, p) => {
        const fault = sceneFrame(moodForStatus('error'), { sinceMoodSec: s, flickerPhase: p });
        expect(fault.alarmIntensity).toBe(0);
        expect(fault.keyColor).not.toBe(relapsedKey);
      }),
    );
  });

  it('only the relapsed mood ever lights the alarm', () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATUSES.filter((s) => s !== 'relapsed')), seconds, phase, (status, s, p) => {
        expect(sceneFrame(moodForStatus(status), { sinceMoodSec: s, flickerPhase: p }).alarmIntensity).toBe(0);
      }),
    );
  });
});

const MOODS: readonly SceneMood[] = ['buried', 'reanimating', 'alive', 'relapsed', 'fault'];
const clock = fc.record({ sinceMoodSec: seconds, flickerPhase: phase });

describe('morgue nudge', () => {
  it('accepts the first nudge, then at most one per second (WCAG 2.3.1: well under 3 flashes a second)', () => {
    expect(acceptNudge(5000, null)).toBe(true);
    expect(acceptNudge(5000 + NUDGE_MIN_INTERVAL_MS - 1, 5000)).toBe(false);
    expect(acceptNudge(5000 + NUDGE_MIN_INTERVAL_MS, 5000)).toBe(true);
    expect(1000 / NUDGE_MIN_INTERVAL_MS).toBeLessThan(3);
  });

  it('plays one pulse on the Buried arcs: zero at both ends, at most the boost, nothing outside the pulse', () => {
    const base = sceneFrame('buried', { sinceMoodSec: 0, flickerPhase: 0 });
    expect(withNudge(base, 'buried', 0).arcIntensity).toBeCloseTo(base.arcIntensity);
    expect(withNudge(base, 'buried', NUDGE_MS / 2000).arcIntensity).toBeCloseTo(base.arcIntensity + NUDGE_ARC_BOOST);
    expect(withNudge(base, 'buried', NUDGE_MS / 1000)).toEqual(base);
    expect(withNudge(base, 'buried', null)).toEqual(base);
    fc.assert(
      fc.property(fc.double({ min: -10, max: 10, noNaN: true }), (since) => {
        const boost = withNudge(base, 'buried', since).arcIntensity - base.arcIntensity;
        expect(boost).toBeGreaterThanOrEqual(0);
        expect(boost).toBeLessThanOrEqual(NUDGE_ARC_BOOST + 1e-9);
      }),
    );
  });

  it('never changes a running or finished proof, and only touches the arcs', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MOODS), clock, fc.double({ min: 0, max: 1, noNaN: true }), (mood, c, since) => {
        const look = sceneFrame(mood, c);
        const nudged = withNudge(look, mood, since);
        if (mood !== 'buried') expect(nudged).toEqual(look);
        expect({ ...nudged, arcIntensity: look.arcIntensity }).toEqual(look);
      }),
    );
  });
});

describe('render rate', () => {
  it('renders at full rate while a proof runs, during the Alive burst and during a nudge', () => {
    expect(targetFps('reanimating', 100, null)).toBe(FULL_FPS);
    expect(targetFps('alive', 0, null)).toBe(FULL_FPS);
    expect(targetFps('alive', REANIMATION_MS / 1000, null)).toBe(STEADY_FPS);
    expect(targetFps('buried', 100, 0.1)).toBe(FULL_FPS);
    expect(targetFps('buried', 100, NUDGE_MS / 1000)).toBe(STEADY_FPS);
  });

  it('drops to the steady rate otherwise, and never renders slower than it', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MOODS), seconds, fc.option(seconds, { nil: null }), (mood, since, nudge) => {
        expect([FULL_FPS, STEADY_FPS]).toContain(targetFps(mood, since, nudge));
      }),
    );
    expect(targetFps('buried', 0, null)).toBe(STEADY_FPS);
    expect(targetFps('relapsed', 0, null)).toBe(STEADY_FPS);
    expect(targetFps('fault', 0, null)).toBe(STEADY_FPS);
  });
});
