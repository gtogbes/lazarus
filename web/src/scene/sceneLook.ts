/**
 * What the lab scene looks like for each proof status (reanimation-lab design,
 * "Lab scene"). Pure: no three.js, no React. The placeholder scene (task 16) and
 * the GLB scene (task 19) both drive their lights from `sceneFrame`.
 *
 * | Mood        | From status          | Look                                              |
 * |-------------|----------------------|---------------------------------------------------|
 * | buried      | idle, cancelled      | cold key light, dim arcs, idle reels, dust motes  |
 * | reanimating | reanimating          | arcs flicker at a rate tied to cases/s, reels spin |
 * | alive       | alive                | arc burst into warm steady light, slab glows      |
 * | relapsed    | relapsed             | red alarm pulse, reels stop                       |
 * | fault       | error                | dim neutral light, reels stop, no alarm           |
 *
 * `fault` exists because an error is never a divergence (design, "Error
 * handling"): a crashed run must not look like Relapsed.
 *
 * Flash safety (WCAG 2.3.1, three flashes): the arc flicker is capped at 3 Hz
 * and only modulates part of the arc intensity; the alarm pulses at 1 Hz.
 */
import type { ProofStatus } from '../features/proof/useProofRun';

export type SceneMood = 'buried' | 'reanimating' | 'alive' | 'relapsed' | 'fault';

/** Light and motion values for one frame. Colours are 0xRRGGBB. */
export interface SceneLighting {
  readonly keyColor: number;
  readonly keyIntensity: number;
  readonly arcColor: number;
  readonly arcIntensity: number;
  /** 0 means the alarm light is off. */
  readonly alarmIntensity: number;
  /** Emissive strength of the slab, 0 to 1. */
  readonly slabGlow: number;
  /** Tape reel speed in radians per second. */
  readonly reelSpeed: number;
  /** Dust mote drift speed in radians per second. */
  readonly moteDrift: number;
}

export interface SceneClock {
  /** Seconds since the mood last changed. */
  readonly sinceMoodSec: number;
  /** Arc flicker phase in cycles; advance it with `advancePhase`. */
  readonly flickerPhase: number;
}

/** Arc flicker rate bounds, Hz. The upper bound is the WCAG 2.3.1 flash limit. */
export const MIN_FLICKER_HZ = 0.5;
export const MAX_FLICKER_HZ = 3;
/** Flicker Hz per case/s. A local PAYROLL run (about 3,000 cases/s) flickers near the cap. */
export const FLICKER_HZ_PER_CASE_PER_SEC = 1 / 1000;
/** Length of the Alive reanimation moment (Requirement 7.3: under 3 s). */
export const REANIMATION_MS = 2400;
/** Relapsed alarm pulse rate. */
export const ALARM_HZ = 1;
/** Share of the arc intensity the flicker removes at its trough. */
export const FLICKER_DEPTH = 0.35;

const COLD = 0x8fb3ff;
const ARC_COLD = 0xd6e4ff;
const WARM = 0xffc58a;
const ARC_WARM = 0xffd9a8;
const ALARM_RED = 0xff2a1a;
const FAULT_GREY = 0xb4b4b4;

const ALIVE_STEADY = { keyIntensity: 1, arcIntensity: 0.9, slabGlow: 0.6 } as const;
const ARC_BURST = 4;

export function moodForStatus(status: ProofStatus): SceneMood {
  switch (status) {
    case 'idle':
    case 'cancelled':
      return 'buried';
    case 'reanimating':
      return 'reanimating';
    case 'alive':
      return 'alive';
    case 'relapsed':
      return 'relapsed';
    case 'error':
      return 'fault';
  }
}

/** Cases per second from the live counters; 0 before any time has passed. */
export function casesPerSecond(executions: number, elapsedMs: number): number {
  if (!(elapsedMs > 0) || !(executions > 0)) return 0;
  return (executions * 1000) / elapsedMs;
}

/** Arc flicker rate for a case rate: proportional, clamped to [MIN_FLICKER_HZ, MAX_FLICKER_HZ]. */
export function flickerHz(casesPerSec: number): number {
  const hz = Number.isFinite(casesPerSec) ? casesPerSec * FLICKER_HZ_PER_CASE_PER_SEC : MAX_FLICKER_HZ;
  return Math.min(MAX_FLICKER_HZ, Math.max(MIN_FLICKER_HZ, hz));
}

/**
 * Advance the flicker phase by `dtSec` at `hz`, wrapped to [0, 1). Integrating
 * the phase (rather than using `sin(hz * t)`) keeps the flicker smooth when the
 * rate changes mid-run.
 */
export function advancePhase(phase: number, hz: number, dtSec: number): number {
  const next = phase + hz * Math.max(0, dtSec);
  return next - Math.floor(next);
}

export function sceneFrame(mood: SceneMood, clock: SceneClock): SceneLighting {
  switch (mood) {
    case 'buried':
      return {
        keyColor: COLD,
        keyIntensity: 0.6,
        arcColor: ARC_COLD,
        arcIntensity: 0.15,
        alarmIntensity: 0,
        slabGlow: 0,
        reelSpeed: 0.4,
        moteDrift: 0.05,
      };
    case 'reanimating': {
      const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * clock.flickerPhase);
      return {
        keyColor: COLD,
        keyIntensity: 0.5,
        arcColor: ARC_COLD,
        arcIntensity: 1.2 * (1 - FLICKER_DEPTH * wave),
        alarmIntensity: 0,
        slabGlow: 0.2,
        reelSpeed: 6,
        moteDrift: 0.15,
      };
    }
    case 'alive': {
      // 0 at the start of the moment, 1 once it is over.
      const t = Math.min(1, Math.max(0, (clock.sinceMoodSec * 1000) / REANIMATION_MS));
      const fade = (1 - t) ** 2;
      return {
        keyColor: mixHex(COLD, WARM, t),
        keyIntensity: 0.5 + (ALIVE_STEADY.keyIntensity - 0.5) * t,
        arcColor: mixHex(ARC_COLD, ARC_WARM, t),
        arcIntensity: ALIVE_STEADY.arcIntensity + (ARC_BURST - ALIVE_STEADY.arcIntensity) * fade,
        alarmIntensity: 0,
        // The slab flares with the burst and settles to its steady glow.
        slabGlow: ALIVE_STEADY.slabGlow + (1 - ALIVE_STEADY.slabGlow) * fade,
        reelSpeed: 1.5,
        moteDrift: 0.05,
      };
    }
    case 'relapsed': {
      const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * ALARM_HZ * clock.sinceMoodSec);
      return {
        keyColor: ALARM_RED,
        keyIntensity: 0.25,
        arcColor: ARC_COLD,
        arcIntensity: 0,
        alarmIntensity: 0.3 + 0.7 * pulse,
        slabGlow: 0,
        reelSpeed: 0,
        moteDrift: 0.02,
      };
    }
    case 'fault':
      return {
        keyColor: FAULT_GREY,
        keyIntensity: 0.35,
        arcColor: ARC_COLD,
        arcIntensity: 0.05,
        alarmIntensity: 0,
        slabGlow: 0,
        reelSpeed: 0,
        moteDrift: 0.02,
      };
  }
}

/** Linear mix of two 0xRRGGBB colours, `t` in [0, 1]. */
export function mixHex(a: number, b: number, t: number): number {
  const channel = (shift: number) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/**
 * Morgue feedback: hovering or focusing a program card "nudges" the scene, a single
 * soft arc pulse (see `sceneNudge.ts` for the store). Flash safety: one pulse per
 * nudge, nudges at most once per `NUDGE_MIN_INTERVAL_MS` (1 Hz, under the 3 Hz limit),
 * and the pulse only adds `NUDGE_ARC_BOOST` to the dim Buried arcs.
 */
export const NUDGE_MS = 450;
export const NUDGE_MIN_INTERVAL_MS = 1000;
export const NUDGE_ARC_BOOST = 0.6;

/** Whether a nudge at `nowMs` should start a pulse, given the last accepted nudge. */
export function acceptNudge(nowMs: number, lastMs: number | null): boolean {
  return lastMs === null || nowMs - lastMs >= NUDGE_MIN_INTERVAL_MS;
}

/**
 * `look` with the nudge pulse applied, `sinceNudgeSec` after it started (null: none).
 * Only the idle Buried lab reacts; a running or finished proof owns the lights.
 */
export function withNudge(look: SceneLighting, mood: SceneMood, sinceNudgeSec: number | null): SceneLighting {
  if (mood !== 'buried' || sinceNudgeSec === null) return look;
  const t = (sinceNudgeSec * 1000) / NUDGE_MS;
  if (!(t >= 0 && t < 1)) return look;
  // One half sine: up and back down once, no hard edges.
  return { ...look, arcIntensity: look.arcIntensity + NUDGE_ARC_BOOST * Math.sin(Math.PI * t) };
}

/** Frames per second the scene renders at. Steady moods need less: reels and dust move slowly. */
export const FULL_FPS = 60;
export const STEADY_FPS = 30;

/**
 * Render rate for this frame: full while something changes quickly (a running proof,
 * the Alive burst, a nudge pulse), half otherwise to save GPU and battery.
 */
export function targetFps(mood: SceneMood, sinceMoodSec: number, sinceNudgeSec: number | null): number {
  if (mood === 'reanimating') return FULL_FPS;
  if (mood === 'alive' && sinceMoodSec * 1000 < REANIMATION_MS) return FULL_FPS;
  if (mood === 'buried' && sinceNudgeSec !== null && sinceNudgeSec * 1000 < NUDGE_MS) return FULL_FPS;
  return STEADY_FPS;
}
