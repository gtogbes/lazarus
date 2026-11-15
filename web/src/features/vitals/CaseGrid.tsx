/**
 * The case grid (graphical-proof design, "CaseGrid.tsx"; Requirement 7).
 *
 * One cell per case the server runs: `numRuns` from `started`, 50 × 40 for 2,000
 * (7.1). Cells fill green in order as cases pass, counting cases and not executions
 * (7.2). From the first divergence (the switch to `shrinking`) the failing case's
 * cell is red with a ✗ and a thick light outline, and the later cells stay not run
 * (7.3). The counts come from `cellStates` (cells.ts), so the drawing and the text
 * always agree, and every number comes from the store (13.1, 13.2).
 *
 * Text (7.4, 7.5, 14.1): a legend with the ✓ passed, ✗ diverged and not run counts,
 * a caption sentence, the 25 s truncation text when the run was cut short, and the
 * note that fast-check stops at the first failing case. The canvas is `aria-hidden`:
 * the text below it carries every state (14.4). No live region (14.6).
 *
 * Rendering (15.3): the component renders once. The shared frame loop (frameLoop.ts)
 * calls the drawer after each store update; it paints only the cells that changed
 * since the last draw and sets the text through refs, so progress events never
 * re-render React. The drawer never asks for extra frames, so the loop stops as soon
 * as the store is quiet (15.4).
 *
 * Reduced motion (7.6, 14.3): the drawer redraws only when the status changes (or
 * when the grid size becomes known with `started`), ending on the final state.
 * While the proof runs it says the grid is drawn at the end, rather than show stale
 * counts.
 *
 * Without a 2D canvas (old browsers, jsdom) only the text is shown.
 */
import { useEffect, useRef } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { COUNT_FORMAT } from '../proof/proofMessages';
import type { ProofRunState } from '../proof/useProofRun';
import { cellStates, type CellStates } from './cells';
import { frameLoop as sharedFrameLoop, type Drawer, type FrameLoop } from './frameLoop';
import { VITALS_GRAPHICS, VITALS_TEXT } from './palette';

const count = (n: number) => COUNT_FORMAT.format(n);

/** The note required by Requirement 7.5. */
export const EVERY_EARLIER_CASE_PASSED = 'fast-check stops at the first failing case, so every earlier case passed.';

type TextState = Pick<ProofRunState, 'status' | 'phase'>;

/** The caption sentence for a state; `cells` is null before `started` gives numRuns. */
export function caseGridCaption(state: TextState, cells: CellStates | null, reduced: boolean): string {
  if (state.status === 'idle') return '';
  if (cells === null) return state.status === 'reanimating' ? 'Waiting for the run to start.' : 'No cases were run.';
  const total = count(cells.total);
  const failed = cells.failedIndex === null ? null : count(cells.failedIndex + 1);
  if (state.status === 'reanimating' && reduced) {
    return 'Proof running. With reduced motion the grid is drawn when the proof finishes; the Prove panel shows the live count.';
  }
  switch (state.status) {
    case 'reanimating':
      return failed === null
        ? `${count(cells.passed)} of ${total} cases passed so far.`
        : `Case ${failed} of ${total} diverged. Shrinking it to the smallest failing input.`;
    case 'relapsed':
      return failed === null
        ? `The port diverged; no case count was reported.`
        : `Case ${failed} of ${total} diverged after ${count(cells.passed)} passed. The later cases were not run.`;
    case 'alive':
      return cells.truncated
        ? `${count(cells.passed)} of ${total} cases passed before the run stopped.`
        : `All ${total} cases passed.`;
    case 'cancelled':
      return `Stopped after ${count(cells.passed)} of ${total} cases.`;
    case 'error':
      return `The proof stopped with an error after ${count(cells.passed)} of ${total} cases. No result.`;
  }
}

/** The truncation text (Requirement 7.4), or null for a run that was not cut short. */
export function caseGridTruncation(state: TextState, cells: CellStates | null): string | null {
  if (!cells?.truncated) return null;
  return cells.failedIndex === null
    ? `The run stopped at the 25 s limit after ${count(cells.passed)} cases, so the other ${count(cells.notRun)} were not run.`
    : 'The run stopped at the 25 s limit while shrinking the failing input.';
}

export interface CaseGridProps {
  /** The frame loop to draw in; the page's shared loop by default. Tests pass their own. */
  readonly loop?: FrameLoop;
}

export function CaseGrid({ loop }: CaseGridProps) {
  const rootRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const passedRef = useRef<HTMLSpanElement>(null);
  const failedRef = useRef<HTMLSpanElement>(null);
  const notRunRef = useRef<HTMLSpanElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const truncatedRef = useRef<HTMLParagraphElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    const parts = {
      root: rootRef.current,
      frame: frameRef.current,
      canvas: canvasRef.current,
      passed: passedRef.current,
      failed: failedRef.current,
      notRun: notRunRef.current,
      caption: captionRef.current,
      truncated: truncatedRef.current,
    };
    if (Object.values(parts).some((part) => part === null)) return;
    const grid = createGrid(parts as GridParts, reduced);
    const unregister = (loop ?? sharedFrameLoop()).register(parts.root!, grid.drawer);
    const stopResize = observeWidth(parts.frame!, grid.resize);
    return () => {
      stopResize();
      unregister();
    };
  }, [loop, reduced]);

  return (
    <figure ref={rootRef} data-testid="case-grid" data-motion={reduced ? 'reduced' : 'full'} className="m-0">
      <div ref={frameRef} aria-hidden="true" className="flex justify-center">
        <canvas ref={canvasRef} data-testid="case-grid-canvas" className="block max-w-full" />
      </div>
      <figcaption className="mt-3 space-y-1 text-sm text-zinc-300">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono tabular-nums" data-testid="case-grid-legend">
          <li className="flex items-center gap-1.5">
            <Swatch fill={VITALS_GRAPHICS.pass} />
            <span ref={passedRef} data-testid="case-grid-passed" style={{ color: VITALS_TEXT.pass }} />
          </li>
          <li className="flex items-center gap-1.5">
            <Swatch fill={VITALS_GRAPHICS.fail} outlined />
            <span ref={failedRef} data-testid="case-grid-failed" style={{ color: VITALS_TEXT.fail }} />
          </li>
          <li className="flex items-center gap-1.5">
            <Swatch fill={VITALS_GRAPHICS.notRun} />
            <span ref={notRunRef} data-testid="case-grid-not-run" style={{ color: VITALS_TEXT.neutral }} />
          </li>
        </ul>
        <p ref={captionRef} data-testid="case-grid-caption" />
        <p ref={truncatedRef} data-testid="case-grid-truncated" hidden />
        <p className="text-zinc-400" data-testid="case-grid-note">
          {EVERY_EARLIER_CASE_PASSED}
        </p>
      </figcaption>
    </figure>
  );
}

function Swatch({ fill, outlined = false }: { readonly fill: string; readonly outlined?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 ${outlined ? 'outline-2 outline-offset-1 outline-zinc-50' : ''}`}
      style={{ backgroundColor: fill }}
    />
  );
}

// ---------------------------------------------------------------------------
// Drawer.

interface GridParts {
  readonly root: HTMLElement;
  readonly frame: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly passed: HTMLElement;
  readonly failed: HTMLElement;
  readonly notRun: HTMLElement;
  readonly caption: HTMLElement;
  readonly truncated: HTMLElement;
}

/** Cells per row: 50 for 2,000 (50 × 40), about 5:4 for other sizes. */
export function gridColumns(numRuns: number): number {
  if (numRuns <= 0) return 0;
  return Math.min(numRuns, Math.ceil(Math.sqrt(numRuns * 1.25)));
}

/** Largest and smallest cell pitch (cell plus gap), CSS px. */
const MAX_PITCH = 12;
const MIN_PITCH = 3;
/** Room around the grid for the failing cell's outline, CSS px. */
const PAD = 3;
/** The failing cell's outline: light, 3:1 or more against the panel and the red cell. */
const OUTLINE = '#fafafa';
const CROSS = '#09090b';

interface Layout {
  readonly ctx: CanvasRenderingContext2D;
  readonly numRuns: number;
  readonly cols: number;
  readonly dpr: number;
  /** CSS px. */
  readonly pitch: number;
  readonly gap: number;
}

interface Painted {
  readonly layout: Layout;
  passed: number;
  failedIndex: number | null;
}

function createGrid(parts: GridParts, reduced: boolean) {
  let width = 0;
  let ctx: CanvasRenderingContext2D | null | undefined;
  let painted: Painted | null = null;
  let lastState: ProofRunState | null = null;
  let drawnKey: string | null = null;
  let draws = 0;
  const texts = new Map<HTMLElement, string>();

  const setText = (element: HTMLElement, text: string) => {
    if (texts.get(element) === text) return;
    texts.set(element, text);
    element.textContent = text;
  };

  function updateText(state: ProofRunState, cells: CellStates | null) {
    // While running under reduced motion the grid is not redrawn, so the legend gives no counts.
    const withCounts = cells !== null && !(reduced && state.status === 'reanimating');
    setText(parts.passed, withCounts ? `✓ ${count(cells.passed)} passed` : '✓ passed');
    setText(parts.failed, withCounts ? `✗ ${count(cells.failedIndex === null ? 0 : 1)} diverged` : '✗ diverged');
    setText(parts.notRun, withCounts ? `${count(cells.notRun)} not run` : 'not run');
    setText(parts.caption, caseGridCaption(state, cells, reduced));
    const truncation = caseGridTruncation(state, cells);
    setText(parts.truncated, truncation ?? '');
    parts.truncated.hidden = truncation === null;
  }

  function layoutFor(numRuns: number): Layout | null {
    if (width <= 0 || numRuns <= 0) return null;
    ctx ??= context2d(parts.canvas);
    if (!ctx) return null;
    const cols = gridColumns(numRuns);
    const rows = Math.ceil(numRuns / cols);
    const pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.floor((width - 2 * PAD) / cols)));
    const gap = pitch >= 8 ? 2 : 1;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const cssW = cols * pitch - gap + 2 * PAD;
    const cssH = rows * pitch - gap + 2 * PAD;
    parts.canvas.style.width = `${cssW}px`;
    parts.canvas.style.height = `${cssH}px`;
    parts.canvas.width = Math.round(cssW * dpr);
    parts.canvas.height = Math.round(cssH * dpr);
    return { ctx, numRuns, cols, dpr, pitch, gap };
  }

  function paint(cells: CellStates | null) {
    if (cells === null || cells.total === 0) {
      if (painted) clear(painted.layout);
      painted = null;
      return;
    }
    const same = painted?.layout.numRuns === cells.total ? painted : null;
    const incremental =
      same !== null && cells.passed >= same.passed && (same.failedIndex === null || same.failedIndex === cells.failedIndex);
    if (!incremental) {
      const layout = same?.layout ?? layoutFor(cells.total);
      if (!layout) {
        painted = null;
        return;
      }
      clear(layout);
      paintCells(layout, 0, layout.numRuns, VITALS_GRAPHICS.notRun);
      painted = { layout, passed: 0, failedIndex: null };
    }
    const p = painted!;
    if (cells.passed > p.passed) paintCells(p.layout, p.passed, cells.passed, VITALS_GRAPHICS.pass);
    p.passed = cells.passed;
    if (cells.failedIndex !== null && p.failedIndex === null) paintFailing(p.layout, cells.failedIndex);
    p.failedIndex = cells.failedIndex;
  }

  const cellsFor = (state: ProofRunState): CellStates | null => {
    const numRuns = state.run?.numRuns ?? null;
    return numRuns === null ? null : cellStates(numRuns, state.cases, state.status, state.result?.truncated ?? false, state.phase);
  };

  const drawer: Drawer = {
    // Out of view: the legend and caption stay current; the canvas waits until it is shown.
    updateText(state) {
      updateText(state, cellsFor(state));
    },
    draw(state) {
      lastState = state;
      const numRuns = state.run?.numRuns ?? null;
      const truncated = state.result?.truncated ?? false;
      // Reduced motion: only a status change (or the grid size arriving) redraws.
      const key = `${state.status}|${numRuns}|${truncated}|${width}`;
      if (reduced && key === drawnKey) return;
      drawnKey = key;
      const cells = cellsFor(state);
      updateText(state, cells);
      paint(cells);
      draws += 1;
      parts.root.dataset['status'] = state.status;
      parts.root.dataset['draws'] = String(draws);
      parts.root.dataset['passed'] = String(cells?.passed ?? 0);
      parts.root.dataset['failedIndex'] = String(cells?.failedIndex ?? '');
      parts.root.dataset['notRun'] = String(cells?.notRun ?? 0);
      // Beat marker for the capture script (web/video/capture.spec.ts): every cell green.
      parts.root.dataset['demoBeat'] =
        state.status === 'alive' && !truncated && numRuns !== null && cells?.passed === numRuns ? 'grid-alive' : '';
    },
    animating: () => false,
  };

  function resize(w: number) {
    const next = Math.floor(w);
    if (next <= 0 || next === width) return;
    width = next;
    // A new size repaints every cell at the new pitch.
    painted = null;
    drawnKey = null;
    if (lastState) drawer.draw(lastState, 0);
  }

  return { drawer, resize };
}

function clear({ ctx }: Layout) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Device-pixel box of cell `i`, snapped so every gap is a whole number of pixels. */
function cellBox({ cols, dpr, pitch, gap }: Layout, i: number) {
  const x = Math.round((PAD + (i % cols) * pitch) * dpr);
  const y = Math.round((PAD + Math.floor(i / cols) * pitch) * dpr);
  const size = Math.round((pitch - gap) * dpr);
  return { x, y, size };
}

function paintCells(layout: Layout, from: number, to: number, colour: string) {
  const { ctx } = layout;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colour;
  for (let i = from; i < to; i++) {
    const { x, y, size } = cellBox(layout, i);
    ctx.fillRect(x, y, size, size);
  }
}

function paintFailing(layout: Layout, i: number) {
  const { ctx, dpr } = layout;
  const { x, y, size } = cellBox(layout, i);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = VITALS_GRAPHICS.fail;
  ctx.fillRect(x, y, size, size);
  // ✗ inside the cell. Below 7 CSS px it would cover the red, so small cells rely on
  // the outline and the ✗ in the legend and caption.
  if (size >= 7 * dpr) {
    const inset = Math.max(1, Math.round(size * 0.22));
    ctx.strokeStyle = CROSS;
    ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr));
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(x + inset, y + inset);
    ctx.lineTo(x + size - inset, y + size - inset);
    ctx.moveTo(x + size - inset, y + inset);
    ctx.lineTo(x + inset, y + size - inset);
    ctx.stroke();
  }
  // Thick outline, drawn in the gap and just over it, so the cell is easy to find among 2,000.
  const ring = 2 * dpr;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = ring;
  ctx.strokeRect(x - ring / 2 - dpr * 0.5, y - ring / 2 - dpr * 0.5, size + ring + dpr, size + ring + dpr);
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/** Calls `onWidth(cssWidth)` now and on every resize. Without ResizeObserver, once. */
function observeWidth(element: HTMLElement, onWidth: (w: number) => void): () => void {
  onWidth(element.clientWidth);
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1]?.contentRect;
    if (box) onWidth(box.width);
  });
  observer.observe(element);
  return () => observer.disconnect();
}
