/**
 * Colours for the Visuals (heartbeat, case grid, resurrection fill). Colour is never
 * the only cue: every state also has ✓, ✗, "not run" or a label (Requirement 14.1).
 *
 * The Visuals sit inside a `PANEL` (app/surface.ts): zinc-950 at 88% over the lab
 * scene. Its colour therefore ranges from `PANEL_BACKGROUNDS.darkest` (black scene)
 * to `PANEL_BACKGROUNDS.lightest` (a pure white scene pixel). Contrast is monotonic in
 * luminance, so a colour that clears a ratio against both ends clears it everywhere
 * in between. `palette.test.ts` checks (Requirement 14.2):
 * - every `VITALS_TEXT` colour at 4.5:1 against both ends;
 * - every `VITALS_GRAPHICS` colour at 3:1 against both ends;
 * - every pair in `ADJACENT_GRAPHICS` at 3:1 against each other.
 *
 * Case grid cells are drawn with a gap, so a cell's adjacent colour is the panel,
 * not the next cell. The resurrection fill's lit part meets its grey part directly,
 * so that pair is checked too.
 *
 * Values are #rrggbb strings, usable as canvas `fillStyle` and SVG `fill`.
 */

/** The two ends of the panel colour behind the Visuals (see surface.ts for the white case). */
export const PANEL_BACKGROUNDS = {
  /** zinc-950 #09090b, the panel over a black scene pixel. */
  darkest: '#09090b',
  /** zinc-950 at 88% over pure white: rgb(39 39 40). */
  lightest: '#272728',
} as const;

/** Text and icons (✓, ✗) drawn on a canvas or next to it. */
export const VITALS_TEXT = {
  /** ✓ labels: "✓ 1,240 matched". green-400. */
  pass: '#4ade80',
  /** ✗ labels: "✗ case 1 diverged", "Relapsed". red-400. */
  fail: '#f87171',
  /** Stopped, cancelled, error and "not run" labels. zinc-400. */
  neutral: '#a1a1aa',
} as const;

/** Lines and fills. */
export const VITALS_GRAPHICS = {
  /** Heartbeat trace while matching, passed grid cells. green-400. */
  pass: '#4ade80',
  /** Flatline alarm band, the failing grid cell. red-400. */
  fail: '#f87171',
  /** Grid cells not run. zinc-500. */
  notRun: '#71717a',
  /** Heartbeat trace when stopped (error, cancelled, idle). zinc-400. */
  neutral: '#a1a1aa',
  /** Resurrection fill, lit part and shock pulse. amber-200. */
  lit: '#fde68a',
  /** Resurrection fill, unlit part of the slab silhouette. zinc-500. */
  grey: '#71717a',
} as const;

export type VitalsGraphic = keyof typeof VITALS_GRAPHICS;

/** Graphic colours that touch each other directly, so they need 3:1 between them. */
export const ADJACENT_GRAPHICS: readonly (readonly [VitalsGraphic, VitalsGraphic])[] = [['lit', 'grey']];
