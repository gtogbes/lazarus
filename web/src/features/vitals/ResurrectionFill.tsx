/**
 * The Resurrection_Fill (graphical-proof design, "ResurrectionFill.tsx"; Requirement 8).
 *
 * A body lying on a slab, drawn as our own inline SVG (no third-party art). The body
 * is drawn twice: grey underneath and lit on top, with the lit copy clipped by a
 * rect whose width is the share of cases passed out of numRuns (8.1). The text under
 * it reads "1,240 / 2,000 cases passed (62%)", rounded down so it says 100% only when
 * every case passed (8.2, `fillText` in fill.ts).
 *
 * Passed cases come from `cellStates` (cells.ts), the same count as the case grid:
 * from the divergence on (the switch to `shrinking`, and on Relapsed) the failing
 * case is not counted, so the fill stops at the cases passed before it (8.3). The
 * status line pairs every colour with an icon and words (14.1):
 * - running: "✓ Coming back to life" (green);
 * - shrinking or Relapsed: "✗ Relapsed" (red);
 * - Alive: "✓ Alive" (green); Alive but stopped at the 25 s limit: "■ Stopped at the 25 s limit";
 * - error and cancelled: "■ …" in neutral grey. An error never looks red.
 *
 * Rendering (15.3): the component renders once. The shared frame loop (frameLoop.ts)
 * calls the drawer after each store update; it sets the clip rect's width and the
 * text through refs, so progress events never re-render React. The drawer never asks
 * for extra frames, so the loop stops when the store is quiet (15.4). Every number
 * comes from the store (13.1).
 *
 * The SVG is `aria-hidden`; the text below it carries the state (14.4). No live
 * region (14.6). The fill steps with the counts and has no transition, so there is
 * no motion to remove under reduced motion.
 *
 * Revive (Requirements 10.3, 10.5): when `revival.revivedAt` changes to a time (the
 * run started by Revive ended Alive), the art plays one shock pulse (the `shock`
 * class, index.css, 800 ms) and the lab scene gets a revive event (sceneNudge.ts).
 * Pulses pass through `acceptPulse` (at most one a second, WCAG 2.3.1). Under reduced
 * motion there is no pulse and no scene event: the caption shows a static
 * "Revived ✓" instead, and the scene slot already shows the still.
 */
import { useEffect, useId, useRef } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useSceneNudge } from '../../scene/sceneNudge';
import { useProofRun, type ProofRunState } from '../proof/useProofRun';
import { cellStates } from './cells';
import { fillFraction, fillText } from './fill';
import { frameLoop as sharedFrameLoop, type Drawer, type FrameLoop } from './frameLoop';
import { VITALS_GRAPHICS, VITALS_TEXT } from './palette';
import { acceptPulse } from './pulseGate';

export type FillTone = 'pass' | 'fail' | 'neutral';

export interface FillLabel {
  readonly status: string;
  readonly tone: FillTone;
  /** "1,240 / 2,000 cases passed (62%)", or a waiting message before `started`. */
  readonly count: string;
  /** Lit share of the body, in [0, 1]. */
  readonly fraction: number;
}

type LabelState = Pick<ProofRunState, 'status' | 'phase' | 'cases' | 'result' | 'run'>;

/** The text and fill for a state (Requirements 8.1, 8.2, 8.3, 14.1). */
export function resurrectionLabel({ status, phase, cases, result, run }: LabelState): FillLabel {
  const numRuns = run?.numRuns ?? null;
  const truncated = result?.truncated ?? false;
  const passed = numRuns === null ? 0 : cellStates(numRuns, cases, status, truncated, phase).passed;
  const count = numRuns === null ? 'Waiting for the run to start.' : fillText(passed, numRuns);
  const fraction = numRuns === null ? 0 : fillFraction(passed, numRuns);
  const of = (text: string, tone: FillTone): FillLabel => ({ status: text, tone, count, fraction });
  switch (status) {
    case 'reanimating':
      return phase === 'shrinking' ? of('✗ Relapsed', 'fail') : of('✓ Coming back to life', 'pass');
    case 'relapsed':
      return of('✗ Relapsed', 'fail');
    case 'alive':
      return truncated ? of('■ Stopped at the 25 s limit', 'neutral') : of('✓ Alive', 'pass');
    case 'error':
      return of('■ Stopped, no result', 'neutral');
    case 'cancelled':
      return of('■ Stopped', 'neutral');
    case 'idle':
      return { status: '', tone: 'neutral', count: '', fraction: 0 };
  }
}

// ---------------------------------------------------------------------------
// Drawing. viewBox units; the body spans BODY_LEFT .. BODY_LEFT + BODY_WIDTH.

const VIEW = { width: 320, height: 140 } as const;
const BODY_LEFT = 32;
const BODY_WIDTH = 258;
/** The slab: steel outline and a top only a little lighter than the panel, so the body stands out. */
const SLAB_FILL = '#27272a';
const SLAB_EDGE = '#52525b';

/** The body, head on the left, lying on its back with the feet up. Filled by the parent `<g>`. */
function Body() {
  return (
    <>
      <circle cx="52" cy="70" r="14" />
      <rect x="62" y="70" width="14" height="12" rx="3" />
      {/* Torso, shoulders to hips. */}
      <rect x="72" y="61" width="102" height="27" rx="13" />
      {/* Legs, tapering from the hips to the ankles. */}
      <path d="M160 63 C 200 64, 240 70, 276 73 L 276 87 C 240 88, 200 88, 160 88 Z" />
      {/* Feet, toes up. */}
      <rect x="272" y="57" width="14" height="31" rx="7" />
    </>
  );
}

/** Arm along the side and the line between the legs, drawn in the slab colour over either copy. */
function Details() {
  return (
    <g fill="none" stroke={SLAB_FILL} strokeWidth="2" strokeLinecap="round">
      <path d="M86 79 H 168" />
      <path d="M190 81 C 220 81, 250 81, 274 81" />
    </g>
  );
}

export interface ResurrectionFillProps {
  /** The frame loop to draw in; the page's shared loop by default. Tests pass their own. */
  readonly loop?: FrameLoop;
}

export function ResurrectionFill({ loop }: ResurrectionFillProps) {
  const clipId = `resurrection-clip-${useId().replace(/:/g, '')}`;
  const rootRef = useRef<HTMLElement>(null);
  const clipRectRef = useRef<SVGRectElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const countRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const clipRect = clipRectRef.current;
    const status = statusRef.current;
    const count = countRef.current;
    if (!root || !clipRect || !status || !count) return;
    const drawer = createFillDrawer({ root, clipRect, status, count });
    return (loop ?? sharedFrameLoop()).register(root, drawer);
  }, [loop]);

  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const revivedAt = useProofRun((s) => s.revival.revivedAt);
  const artRef = useRef<HTMLDivElement>(null);
  const lastPulseRef = useRef<number | null>(null);
  useEffect(() => {
    const art = artRef.current;
    if (revivedAt === null || reduced || !art) return;
    const now = performance.now();
    if (!acceptPulse(now, lastPulseRef.current)) return;
    lastPulseRef.current = now;
    // Remove and re-add the class (with a reflow between) so a second revive replays it.
    art.classList.remove('shock');
    void art.offsetWidth;
    art.classList.add('shock');
    art.dataset['demoBeat'] = 'revive-pulse'; // for the capture script; cleared with the class
    useSceneNudge.getState().revive(now);
    // Only a new `revivedAt` pulses; turning reduced motion off later does not replay an old one.
  }, [revivedAt]);

  return (
    <figure ref={rootRef} data-testid="resurrection-fill" className="m-0">
      <div
        ref={artRef}
        data-testid="resurrection-fill-art"
        className="rounded"
        onAnimationEnd={(e) => {
          e.currentTarget.classList.remove('shock');
          delete e.currentTarget.dataset['demoBeat'];
        }}
      >
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          className="block h-auto w-full max-w-sm"
        >
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <rect ref={clipRectRef} x={BODY_LEFT} y="0" width="0" height={VIEW.height} />
            </clipPath>
          </defs>
          {/* Slab: top, rim and two legs. */}
          <g fill={SLAB_FILL} stroke={SLAB_EDGE} strokeWidth="1.5">
            <rect x="52" y="97" width="8" height="34" rx="1" />
            <rect x="260" y="97" width="8" height="34" rx="1" />
            <rect x="20" y="88" width="280" height="10" rx="3" />
          </g>
          {/* Head block. */}
          <rect x="34" y="83" width="34" height="5" rx="2" fill={SLAB_EDGE} />
          <g fill={VITALS_GRAPHICS.grey}>
            <Body />
          </g>
          <g fill={VITALS_GRAPHICS.lit} clipPath={`url(#${clipId})`} data-testid="resurrection-fill-lit">
            <Body />
          </g>
          <Details />
        </svg>
      </div>
      <figcaption className="mt-2 space-y-1 text-sm">
        <p ref={statusRef} data-testid="resurrection-fill-status" className="font-semibold" />
        <p ref={countRef} data-testid="resurrection-fill-count" className="font-mono tabular-nums text-zinc-300" />
        {reduced && revivedAt !== null && (
          <p data-testid="resurrection-fill-revived" className="font-semibold" style={{ color: VITALS_TEXT.pass }}>
            Revived ✓
          </p>
        )}
      </figcaption>
    </figure>
  );
}

interface FillParts {
  readonly root: HTMLElement;
  readonly clipRect: SVGRectElement;
  readonly status: HTMLElement;
  readonly count: HTMLElement;
}

function createFillDrawer({ root, clipRect, status, count }: FillParts): Drawer {
  let width: string | null = null;
  let statusText: string | null = null;
  let tone: FillTone | null = null;
  let countText: string | null = null;
  const setText = (label: FillLabel) => {
    if (label.status !== statusText) status.textContent = statusText = label.status;
    if (label.tone !== tone) {
      tone = label.tone;
      status.style.color = VITALS_TEXT[tone];
      status.dataset['tone'] = tone;
    }
    if (label.count !== countText) count.textContent = countText = label.count;
  };
  return {
    updateText(state) {
      setText(resurrectionLabel(state));
    },
    draw(state) {
      const label = resurrectionLabel(state);
      const w = (label.fraction * BODY_WIDTH).toFixed(2);
      if (w !== width) clipRect.setAttribute('width', (width = w));
      setText(label);
      root.dataset['status'] = state.status;
      root.dataset['fraction'] = String(label.fraction);
      // Beat marker for the capture script (web/video/capture.spec.ts): "2,000 / 2,000".
      root.dataset['demoBeat'] = label.fraction === 1 ? 'all-passed' : '';
    },
    animating: () => false,
  };
}
