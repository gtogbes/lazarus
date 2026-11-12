/**
 * Transient "nudge" from the 2D UI to the lab scene: a program card was hovered or
 * focused (MorguePage). The scene reads `startedAt` in its frame loop and plays one
 * soft arc pulse (`withNudge` in sceneLook.ts). No three.js here, so the morgue can
 * import it without pulling in the scene chunk.
 */
import { create } from 'zustand';
import { acceptNudge } from './sceneLook';

interface SceneNudgeState {
  /** `performance.now()` when the current pulse started, or null if none yet. */
  readonly startedAt: number | null;
  /** Start a pulse, unless one started under `NUDGE_MIN_INTERVAL_MS` ago (flash safety). */
  nudge(nowMs?: number): void;
}

export const useSceneNudge = create<SceneNudgeState>()((set, get) => ({
  startedAt: null,
  nudge(nowMs = performance.now()) {
    if (acceptNudge(nowMs, get().startedAt)) set({ startedAt: nowMs });
  },
}));
