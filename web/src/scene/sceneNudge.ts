/**
 * Transient "nudge" from the 2D UI to the lab scene: a program card was hovered or
 * focused (MorguePage). The scene reads `startedAt` in its frame loop and plays one
 * soft arc pulse (`withNudge` in sceneLook.ts). No three.js here, so the morgue can
 * import it without pulling in the scene chunk.
 *
 * `revive` is the same idea for the revive mood (graphical-proof Requirement 10.3):
 * the Resurrection_Fill calls it when a revive ends Alive, and the scene plays
 * `withRevive` from `revivedAt`.
 */
import { create } from 'zustand';
import { acceptNudge, acceptRevive } from './sceneLook';

interface SceneNudgeState {
  /** `performance.now()` when the current pulse started, or null if none yet. */
  readonly startedAt: number | null;
  /** Start a pulse, unless one started under `NUDGE_MIN_INTERVAL_MS` ago (flash safety). */
  nudge(nowMs?: number): void;
  /** `performance.now()` when the current revive mood started, or null if none yet. */
  readonly revivedAt: number | null;
  /** Start the revive mood, unless the flash gate refuses it (`acceptRevive`). */
  revive(nowMs?: number): void;
}

export const useSceneNudge = create<SceneNudgeState>()((set, get) => ({
  startedAt: null,
  nudge(nowMs = performance.now()) {
    if (acceptNudge(nowMs, get().startedAt)) set({ startedAt: nowMs });
  },
  revivedAt: null,
  revive(nowMs = performance.now()) {
    if (acceptRevive(nowMs, get().revivedAt)) set({ revivedAt: nowMs });
  },
}));
