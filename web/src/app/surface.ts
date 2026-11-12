/**
 * Surfaces for 2D content over the full-viewport lab scene (Requirement 9.1).
 *
 * axe cannot read canvas pixels, so text contrast over the scene is guaranteed by
 * construction: every text element sits on zinc-950 at 88% opacity or more. Over the
 * worst-case scene pixel (pure white, at least as bright as the Alive burst or the
 * Relapsed alarm can get after tone mapping) that composites to rgb(39 39 40), where
 * the dimmest text colour used, zinc-400, still has about 5.7:1. The
 * blur and the vignette only average or darken the scene, so they cannot make it worse.
 * e2e/full-ui.spec.ts recomputes this in the browser for every text element.
 */

/** Page panel: opaque enough for 4.5:1 over any scene pixel, translucent enough to see the lab. */
export const PANEL = 'rounded-xl border border-zinc-800/80 bg-zinc-950/88 shadow-2xl shadow-black/40 backdrop-blur-md';

/** The header bar: the same guarantee, full width. */
export const BAR = 'border-b border-zinc-800/80 bg-zinc-950/88 backdrop-blur-md';
