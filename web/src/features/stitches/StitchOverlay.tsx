import { useEffect, useId, useMemo, useRef, type RefObject } from 'react';
import { STITCH_COLOR } from '../program/CodePane';
import { HIGHLIGHT_ACCENT } from '../program/theme';
import type { HighlightedFile, HighlightedToken, LineRange, ProgramSource } from '../program/types';
import { visibleStitchPath, type Rect } from './geometry';

/**
 * The stitch overlay (Requirement 6.3, 6.5, 14.2, 14.4): a decorative SVG over the
 * side-by-side panes. Every field's COBOL line and port line are joined while both are
 * in view; the active field stitch glows teal, and the active statement link (the port
 * statement focused or hovered, reanimation-lab Requirement 2.2) gets an amber stitch from
 * the highlighted COBOL to the port statement. Both colours clear 3:1 on the pane and page
 * backgrounds (teal-300 about 12:1, amber-300 about 13:1).
 *
 * aria-hidden: the same information is text on the page (the "Fields" listbox and its
 * details, the highlighted COBOL and the link caption).
 *
 * Redraws: paths are set through refs in one rAF-throttled draw, scheduled by scroll
 * (passive listeners on both panes), ResizeObserver, web-font loading and a change of the
 * active field or link. Scrolling never re-renders React. This is deliberately not the
 * shared `frameLoop` of the Visuals: that loop marks every drawer dirty on each store
 * update, so a registered overlay would re-measure ~30 lines (layout reads) on every
 * progress event during a proof, 4 to 50 times a second, while nothing here has moved.
 * The overlay needs the opposite trigger set (DOM events, not the store), and one rAF
 * per burst of events gives the same at-most-once-per-frame guarantee.
 *
 * Hovering a field or a line never scrolls the panes (only Enter or a click on a field
 * does, through `scrollLineIntoPane`), so a hovered field's stitch shows only when both
 * of its lines are already in view.
 */

/** Gap between the code text and a stitch end, in pixels. */
const END_GAP = 6;

const lineText = (tokens: readonly HighlightedToken[] | undefined) => (tokens ?? []).map(([t]) => t).join('');

/** Text columns of one line: first and past-last non-blank character, and the full length. */
interface Columns {
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly length: number;
}

/** One end of a stitch: the non-blank lines of a range, as character columns. */
type Anchor = readonly Columns[];

function anchorFor(file: HighlightedFile, range: LineRange): Anchor {
  const out: Columns[] = [];
  for (let line = range.start; line <= range.end; line++) {
    const text = lineText(file.lines[line - 1]);
    const end = text.trimEnd().length;
    if (end > 0) out.push({ line, start: text.length - text.trimStart().length, end, length: text.length });
  }
  return out;
}

const single = (line: number): LineRange => ({ start: line, end: line });

/**
 * The text extent of a range of lines, from character columns: the panes are monospace,
 * so a code span's width over its length is the character width. No per-character DOM.
 * `pad` pushes the stitch end off the text on the side it attaches to.
 */
function textRect(pane: Element, anchor: Anchor, pad: 'left' | 'right'): Rect | null {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const c of anchor) {
    const lineEl = pane.querySelector(`[data-line="${c.line}"]`);
    const code = lineEl?.querySelector('[data-code]');
    if (!lineEl || !code) continue;
    const box = lineEl.getBoundingClientRect();
    const text = code.getBoundingClientRect();
    const cw = c.length > 0 ? text.width / c.length : 0;
    left = Math.min(left, text.left + c.start * cw);
    right = Math.max(right, text.left + c.end * cw);
    top = Math.min(top, box.top);
    bottom = Math.max(bottom, box.bottom);
  }
  if (!Number.isFinite(left)) return null;
  if (pad === 'right') right += END_GAP;
  else left -= END_GAP;
  return { left, top, width: Math.max(right - left, 1), height: bottom - top };
}

/** "M x0 y0 C …, x1 y1" → the two ends. */
function ends(d: string): [number, number, number, number] | null {
  const n = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!n || n.length < 8) return null;
  return [n[0]!, n[1]!, n[6]!, n[7]!];
}

interface Pair {
  readonly cobol: Anchor;
  readonly port: Anchor;
}

/** Sets a highlighted stitch (core path, optional halo, end dots); hides its group when `d` is null. */
function setStitch(
  group: SVGGElement | null,
  paths: readonly (SVGPathElement | null)[],
  dots: readonly (SVGCircleElement | null)[],
  d: string | null,
): boolean {
  const end = d ? ends(d) : null;
  if (group) group.style.display = d && end ? '' : 'none';
  if (!d || !end) return false;
  for (const path of paths) path?.setAttribute('d', d);
  dots.forEach((dot, k) => {
    dot?.setAttribute('cx', String(end[k * 2]));
    dot?.setAttribute('cy', String(end[k * 2 + 1]));
  });
  return true;
}

interface StitchOverlayProps {
  readonly source: ProgramSource;
  /** The field to emphasise (hovered, else selected), as an index into `source.fields`. */
  readonly activeField: number | null;
  /** The active statement link, as an index into `source.links`. */
  readonly activeLink: number | null;
  readonly cobolPane: RefObject<HTMLDivElement | null>;
  readonly portPane: RefObject<HTMLDivElement | null>;
}

export function StitchOverlay({ source, activeField, activeLink, cobolPane, portPane }: StitchOverlayProps) {
  const glowId = `${useId()}-glow`;
  const svgRef = useRef<SVGSVGElement>(null);
  const faintRefs = useRef<(SVGPathElement | null)[]>([]);
  const fieldGroupRef = useRef<SVGGElement>(null);
  const fieldPathRefs = useRef<(SVGPathElement | null)[]>([]);
  const fieldDotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const linkGroupRef = useRef<SVGGElement>(null);
  const linkPathRef = useRef<SVGPathElement>(null);
  const linkDotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const activeRef = useRef({ field: activeField, link: activeLink });
  const scheduleRef = useRef<() => void>(() => {});
  const { fields, links, cobol, port } = source;
  const fieldPairs = useMemo<(Pair | null)[]>(
    () =>
      fields.map((f) => {
        const portLine = f.portLines[0];
        if (portLine === undefined) return null;
        return { cobol: anchorFor(cobol, single(f.cobolLine)), port: anchorFor(port, single(portLine)) };
      }),
    [fields, cobol, port],
  );
  const linkPairs = useMemo<Pair[]>(
    () => links.map((l) => ({ cobol: anchorFor(cobol, l.cobol), port: anchorFor(port, l.port) })),
    [links, cobol, port],
  );

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = 0;
      const svg = svgRef.current;
      const cp = cobolPane.current;
      const pp = portPane.current;
      if (!svg || !cp || !pp) return;
      const overlay = svg.getBoundingClientRect();
      const cobolBox = cp.getBoundingClientRect();
      const portBox = pp.getBoundingClientRect();
      const pathFor = (pair: Pair | null | undefined) => {
        if (!pair) return null;
        const from = textRect(cp, pair.cobol, 'right');
        const to = textRect(pp, pair.port, 'left');
        return from && to ? visibleStitchPath(from, cobolBox, to, portBox, overlay) : null;
      };
      const current = activeRef.current;
      let visible = 0;
      let activeD: string | null = null;
      fieldPairs.forEach((pair, i) => {
        const d = pathFor(pair);
        if (d) visible++;
        if (i === current.field) activeD = d;
        const path = faintRefs.current[i];
        if (!path) return;
        const shown = d !== null && i !== current.field;
        if (shown) path.setAttribute('d', d!);
        path.style.display = shown ? '' : 'none';
      });
      svg.dataset.visibleStitches = String(visible);
      const fieldShown = setStitch(fieldGroupRef.current, fieldPathRefs.current, fieldDotRefs.current, activeD);
      svg.dataset.activeStitch = fieldShown ? 'visible' : 'none';
      const linkD = current.link === null ? null : pathFor(linkPairs[current.link]);
      const linkShown = setStitch(linkGroupRef.current, [linkPathRef.current], linkDotRefs.current, linkD);
      svg.dataset.linkStitch = linkShown ? 'visible' : 'none';
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(draw);
    };
    scheduleRef.current = schedule;
    const panes = [cobolPane.current, portPane.current].filter((p): p is HTMLDivElement => p !== null);
    for (const pane of panes) pane.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const container = svgRef.current?.parentElement;
    if (container) observer?.observe(container);
    for (const pane of panes) observer?.observe(pane);
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      for (const pane of panes) pane.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      scheduleRef.current = () => {};
    };
  }, [fieldPairs, linkPairs, cobolPane, portPane]);

  // Runs before SourcePanes' own effect scrolls the highlighted COBOL into view; that scroll schedules again.
  useEffect(() => {
    activeRef.current = { field: activeField, link: activeLink };
    scheduleRef.current();
  }, [activeField, activeLink]);

  const dots = (color: string, refs: RefObject<(SVGCircleElement | null)[]>) =>
    [0, 1].map((k) => (
      <circle
        key={k}
        ref={(el) => {
          refs.current[k] = el;
        }}
        r={3.5}
        fill={color}
        stroke="#0a0c10"
        strokeWidth={1.5}
      />
    ));

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      focusable="false"
      data-testid="stitch-overlay"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    >
      <defs>
        <filter id={glowId} filterUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <g fill="none" stroke={STITCH_COLOR} strokeLinecap="round">
        {fields.map((f, i) => (
          <path
            key={f.name}
            ref={(el) => {
              faintRefs.current[i] = el;
            }}
            style={{ display: 'none' }}
            strokeWidth={1.25}
            strokeOpacity={0.35}
            strokeDasharray="5 4"
          />
        ))}
      </g>
      <g ref={fieldGroupRef} style={{ display: 'none' }} data-stitch="field">
        <path
          ref={(el) => {
            fieldPathRefs.current[0] = el;
          }}
          fill="none"
          stroke={STITCH_COLOR}
          strokeWidth={7}
          strokeOpacity={0.45}
          filter={`url(#${glowId})`}
        />
        <path
          ref={(el) => {
            fieldPathRefs.current[1] = el;
          }}
          fill="none"
          stroke={STITCH_COLOR}
          strokeWidth={2}
          strokeLinecap="round"
        />
        {dots(STITCH_COLOR, fieldDotRefs)}
      </g>
      {/* Solid amber, no glow: it matches the statement highlight bars and stays distinct from field stitches. */}
      <g ref={linkGroupRef} style={{ display: 'none' }} data-stitch="link">
        <path ref={linkPathRef} fill="none" stroke={HIGHLIGHT_ACCENT} strokeWidth={2} strokeLinecap="round" />
        {dots(HIGHLIGHT_ACCENT, linkDotRefs)}
      </g>
    </svg>
  );
}
