/**
 * Flash gate shared by the one-shot pulses of the Visuals: the Resurrection_Fill
 * shock pulse and the scene revive event (graphical-proof design, "pulseGate.ts").
 *
 * WCAG 2.3.1 allows at most 3 flashes in any 1 s. A pulse is one rise and fall, so
 * letting at most one start per `MIN_PULSE_INTERVAL_MS` keeps every pulse source
 * under the limit (Requirement 14.5). Same rule as `acceptNudge` in sceneLook.ts.
 */
export const MIN_PULSE_INTERVAL_MS = 1000;

/**
 * Whether a pulse requested at `nowMs` may start, given when the last accepted pulse
 * started (null: none yet). A clock that went backwards is refused, not trusted.
 */
export function acceptPulse(nowMs: number, lastMs: number | null): boolean {
  return lastMs === null || nowMs - lastMs >= MIN_PULSE_INTERVAL_MS;
}
