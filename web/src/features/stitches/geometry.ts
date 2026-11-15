/**
 * Pure geometry for the stitch overlay (Requirement 6.3). No DOM access:
 * callers pass rectangles (a `DOMRect` fits `Rect`) and set the returned
 * string as a path's `d`.
 */

/** The parts of a `DOMRect` the geometry needs, in viewport pixels. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Minimum horizontal pull of the curve's control points, in pixels. */
export const MIN_CONTROL_OFFSET = 16;

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * The part of a code line that shows through its scrolling pane, or `null`
 * when the line is out of view. A line counts as in view while its vertical
 * centre is inside the pane, so a stitch never ends on a half-hidden line.
 */
export function clipToPane(line: Rect, pane: Rect): Rect | null {
  const centre = line.top + line.height / 2;
  if (line.height <= 0 || centre < pane.top || centre > pane.top + pane.height) return null;
  const left = Math.max(line.left, pane.left);
  const right = Math.min(line.left + line.width, pane.left + pane.width);
  if (right <= left) return null;
  const top = Math.max(line.top, pane.top);
  const bottom = Math.min(line.top + line.height, pane.top + pane.height);
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * A cubic path from the right edge of the COBOL line to the left edge of the
 * port line, at each line's vertical centre, in the overlay's coordinates.
 */
export function stitchPath(cobolRect: Rect, portRect: Rect, overlayRect: Rect): string {
  const x0 = cobolRect.left + cobolRect.width - overlayRect.left;
  const y0 = cobolRect.top + cobolRect.height / 2 - overlayRect.top;
  const x1 = portRect.left - overlayRect.left;
  const y1 = portRect.top + portRect.height / 2 - overlayRect.top;
  const k = Math.max(Math.abs(x1 - x0) / 2, MIN_CONTROL_OFFSET);
  const p = [x0, y0, x0 + k, y0, x1 - k, y1, x1, y1].map(round);
  return `M ${p[0]} ${p[1]} C ${p[2]} ${p[3]}, ${p[4]} ${p[5]}, ${p[6]} ${p[7]}`;
}

/**
 * The stitch for a pair of lines, clipped to their panes, or `null` unless
 * both lines are in view.
 */
export function visibleStitchPath(
  cobolLine: Rect,
  cobolPane: Rect,
  portLine: Rect,
  portPane: Rect,
  overlayRect: Rect,
): string | null {
  const cobol = clipToPane(cobolLine, cobolPane);
  const port = clipToPane(portLine, portPane);
  return cobol && port ? stitchPath(cobol, port, overlayRect) : null;
}
