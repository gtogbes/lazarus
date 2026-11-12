/**
 * Pane colours used alongside the Shiki theme's own background. Every token colour
 * must clear 4.5:1 against both the pane background and HIGHLIGHT_BACKGROUND
 * (web/build/programSources.test.ts checks this).
 */
export const HIGHLIGHT_BACKGROUND = '#3b3100';
/** Accent bar on the highlighted statements (amber, matching the focus ring). */
export const HIGHLIGHT_ACCENT = '#fcd34d';
export const GUTTER_COLOR = '#9ea7b3';
/**
 * Mutant diff line backgrounds (Requirement 4.3). Colour is a second cue only: every
 * line also has a `-` or `+` marker and a screen-reader label. Token and gutter colours
 * must clear 4.5:1 on both (web/build/programSources.test.ts checks this).
 */
export const DIFF_REMOVED_BACKGROUND = '#3d0b12';
export const DIFF_ADDED_BACKGROUND = '#0a2e19';
