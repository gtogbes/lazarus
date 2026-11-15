/**
 * The ECG strip (graphical-proof design, "Heartbeat.tsx"; Requirement 4).
 *
 * A canvas drawn like a monitor: dark phosphor screen, faint grid, a sweep head
 * that writes the trace left to right and erases a gap ahead of itself, and an
 * afterglow that fades with age. Beats come from `scheduleBeats` (beats.ts): one
 * per 500 ms tick of display time at most, with nothing drawn for a tick without
 * cases (4.1, 4.2, 4.6).
 *
 * - generating: green trace, label "✓ 1,240 matched".
 * - shrinking or Relapsed: flatline in red, a red alarm band that pulses at 1 Hz
 *   (one smooth rise and fall per second, under the 3 flashes per second limit of
 *   14.5), label "✗ case 37 diverged". After Relapsed the alarm runs for
 *   `ALARM_TAIL_MS` more, then holds steady so the frame loop can stop (15.4).
 * - Alive: a steady trace, label "✓ 2,000 / 2,000 matched" (4.4).
 * - error, cancelled, or a run stopped at the cap without a divergence: the trace
 *   freezes in grey with a "■" label and no alarm (4.5). An error never looks red.
 * - Reduced motion: a static strip for the current state, redrawn only when the
 *   state changes (4.7, 14.3).
 *
 * Rendering (15.3): the component renders once. The trace and the label are drawn
 * by the shared frame loop (frameLoop.ts), which reads `useProofRun.getState()`;
 * the label changes through `textContent` on a ref, so 4 Hz or 50 Hz progress
 * never re-renders React. Every number in the label comes from the store (13.1).
 *
 * The whole strip is `aria-hidden` (14.4): the Prove panel already gives the
 * counters and status in text. Without a 2D canvas (old browsers, jsdom) only the
 * label is shown, which still carries every state.
 */
import { useEffect, useRef } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { COUNT_FORMAT } from '../proof/proofMessages';
import type { ProofRunState } from '../proof/useProofRun';
import { BEAT_INTERVAL_MS, scheduleBeats, type Beat, type BeatSnapshot } from './beats';
import { frameLoop as sharedFrameLoop, type Drawer, type FrameLoop } from './frameLoop';
import { VITALS_GRAPHICS, VITALS_TEXT } from './palette';

export type HeartbeatTone = 'pass' | 'fail' | 'neutral';
export type HeartbeatMode = 'idle' | 'beating' | 'flatline' | 'steady' | 'stopped';

export interface HeartbeatLabel {
  readonly text: string;
  readonly tone: HeartbeatTone;
}

/** How long the alarm keeps pulsing after the Relapsed result, before it holds steady. */
export const ALARM_TAIL_MS = 6000;
/** Alarm period: 1 Hz (Requirement 4.6). */
export const ALARM_PERIOD_MS = 1000;

type LabelState = Pick<ProofRunState, 'status' | 'phase' | 'cases' | 'result' | 'run'>;

const count = (n: number) => COUNT_FORMAT.format(n);
const diverged = (n: number): HeartbeatLabel => ({ text: `✗ case ${count(n)} diverged`, tone: 'fail' });

/** The label text and colour for a state (Requirements 4.1, 4.3, 4.4, 4.5, 14.1). */
export function heartbeatLabel({ status, phase, cases, result, run }: LabelState): HeartbeatLabel {
  switch (status) {
    case 'reanimating':
      return phase === 'shrinking' ? diverged(cases) : { text: `✓ ${count(cases)} matched`, tone: 'pass' };
    case 'relapsed':
      return diverged(result?.cases ?? cases);
    case 'alive': {
      const matched = result?.cases ?? cases;
      const total = run?.numRuns ?? matched;
      return result?.truncated
        ? { text: `■ stopped early, ${count(matched)} / ${count(total)} matched`, tone: 'neutral' }
        : { text: `✓ ${count(matched)} / ${count(total)} matched`, tone: 'pass' };
    }
    case 'error':
      return { text: '■ stopped, no result', tone: 'neutral' };
    case 'cancelled':
      return { text: '■ stopped', tone: 'neutral' };
    case 'idle':
      return { text: '', tone: 'neutral' };
  }
}

/** What the strip shows for a state. A truncated Alive run is `stopped`: no claim of a full proof. */
export function heartbeatMode({ status, phase, result }: Pick<ProofRunState, 'status' | 'phase' | 'result'>): HeartbeatMode {
  switch (status) {
    case 'reanimating':
      return phase === 'shrinking' ? 'flatline' : 'beating';
    case 'relapsed':
      return 'flatline';
    case 'alive':
      return result?.truncated ? 'stopped' : 'steady';
    case 'error':
    case 'cancelled':
      return 'stopped';
    case 'idle':
      return 'idle';
  }
}

export interface HeartbeatProps {
  /** The frame loop to draw in; the page's shared loop by default. Tests pass their own. */
  readonly loop?: FrameLoop;
}

export function Heartbeat({ loop }: HeartbeatProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLParagraphElement>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const label = labelRef.current;
    if (!root || !canvas || !label) return;
    const strip = createStrip({ root, canvas, label, reduced });
    const unregister = (loop ?? sharedFrameLoop()).register(root, strip.drawer);
    const stopResize = observeSize(canvas, strip.resize);
    return () => {
      stopResize();
      unregister();
    };
  }, [loop, reduced]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-testid="heartbeat"
      data-motion={reduced ? 'reduced' : 'full'}
      className="relative h-28 overflow-hidden rounded-md border border-emerald-950 bg-[#040806] shadow-[inset_0_0_28px_rgba(0,0,0,0.85)]"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <p
        ref={labelRef}
        data-testid="heartbeat-label"
        className="pointer-events-none absolute top-2 left-2 rounded bg-black/75 px-2 py-0.5 font-mono text-sm font-semibold tabular-nums"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer: tracks the run in display time and turns each frame into a Scene.

interface StripParts {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly label: HTMLElement;
  readonly reduced: boolean;
}

interface RunTrack {
  readonly startMs: number;
  readonly snapshots: BeatSnapshot[];
  /** Run-relative display time of the first `shrinking` (or Relapsed) frame. */
  flatAt: number | null;
  /** Run-relative display time the run left `reanimating`. */
  endAt: number | null;
}

interface View {
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  readonly backdrop: HTMLCanvasElement | null;
}

function createStrip({ root, canvas, label, reduced }: StripParts) {
  let view: View | null = null;
  let run: RunTrack | null = null;
  let prevStatus: ProofRunState['status'] | null = null;
  let lastCases = 0;
  let lastPhase: ProofRunState['phase'] = 'generating';
  /** The last drawn frame was a final form: nothing moves until the state changes. */
  let settled = false;
  let lastState: ProofRunState | null = null;
  let lastNow = 0;
  let labelText: string | null = null;
  let labelTone: HeartbeatTone | null = null;
  let staticKey = '';

  function track(state: ProofRunState, now: number) {
    if (state.status === 'reanimating') {
      const restarted =
        prevStatus !== 'reanimating' || run === null || state.cases < lastCases || (lastPhase === 'shrinking' && state.phase === 'generating');
      if (restarted) run = { startMs: now, snapshots: [], flatAt: null, endAt: null };
      const r = run!;
      const t = now - r.startMs;
      if (restarted || state.cases !== lastCases || state.phase !== lastPhase) {
        r.snapshots.push({ atMs: t, cases: state.cases, phase: state.phase });
      }
      if (state.phase === 'shrinking') r.flatAt ??= t;
      settled = false;
    } else if (state.status === 'idle') {
      run = null;
    } else if (run && prevStatus === 'reanimating') {
      run.endAt = now - run.startMs;
      if (state.status === 'relapsed') run.flatAt ??= run.endAt;
    }
    prevStatus = state.status;
    lastCases = state.cases;
    lastPhase = state.phase;
  }

  function updateLabel(state: ProofRunState) {
    const { text, tone } = heartbeatLabel(state);
    if (text !== labelText) label.textContent = labelText = text;
    if (tone !== labelTone) {
      labelTone = tone;
      label.style.color = VITALS_TEXT[tone];
      label.dataset['tone'] = tone;
    }
  }

  /** The frame to draw. Also decides `settled`, so the loop stops even without a canvas. */
  function sceneFor(state: ProofRunState, now: number, periodMs: number): Scene | null {
    const mode = heartbeatMode(state);
    if (reduced || run === null) {
      settled = true;
      return staticScene(mode, periodMs);
    }
    const r = run;
    const live = now - r.startMs;
    switch (mode) {
      case 'idle':
        settled = true;
        return null;
      case 'beating':
        return sweepScene(r, live, periodMs, { tone: 'pass', head: true, alarm: null });
      case 'flatline': {
        const alarmEnd = r.endAt === null ? Infinity : r.endAt + ALARM_TAIL_MS;
        if (live >= alarmEnd) {
          settled = true;
          return sweepScene(r, alarmEnd, periodMs, { tone: 'pass', head: false, alarm: STEADY_ALARM });
        }
        return sweepScene(r, live, periodMs, { tone: 'pass', head: true, alarm: alarmPulse(live - (r.flatAt ?? live)) });
      }
      case 'steady':
        settled = true;
        return staticScene('steady', periodMs);
      case 'stopped':
        settled = true;
        // Neutral: no red and no alarm, even if the run had started shrinking.
        return { ...sweepScene(r, r.endAt ?? live, periodMs, { tone: 'neutral', head: false, alarm: null }), flatAt: null };
    }
  }

  function render(state: ProofRunState, now: number) {
    const scene = sceneFor(state, now, periodFor(view?.w ?? 0));
    if (!view) return;
    if (reduced || run === null) {
      // Static forms: repaint only when the form or the size changes.
      const key = `${heartbeatMode(state)}:${view.w}x${view.h}`;
      if (key === staticKey) return;
      staticKey = key;
    }
    paint(view, scene);
  }

  const drawer: Drawer = {
    draw(state, now) {
      lastState = state;
      lastNow = now;
      track(state, now);
      updateLabel(state);
      const mode = heartbeatMode(state);
      root.dataset['mode'] = mode;
      // Beat marker for the capture script (web/video/capture.spec.ts).
      root.dataset['demoBeat'] = mode === 'beating' && state.cases > 0 ? 'heartbeat' : mode === 'flatline' ? 'flatline' : '';
      render(state, now);
    },
    updateText: updateLabel,
    animating(state) {
      if (reduced) return false;
      return state.status === 'reanimating' || !settled;
    },
  };

  function resize(w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const ctx = view?.ctx ?? context2d(canvas);
    if (!ctx) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    view = { ctx, w, h, dpr, backdrop: drawBackdrop(canvas.width, canvas.height, dpr) };
    staticKey = '';
    if (lastState) render(lastState, lastNow);
  }

  return { drawer, resize };
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/** Calls `onSize(cssWidth, cssHeight)` now and on every resize. Without ResizeObserver, once. */
function observeSize(element: HTMLElement, onSize: (w: number, h: number) => void): () => void {
  onSize(element.clientWidth, element.clientHeight);
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1]?.contentRect;
    if (box) onSize(box.width, box.height);
  });
  observer.observe(element);
  return () => observer.disconnect();
}

// ---------------------------------------------------------------------------
// Scenes: what to draw, independent of the canvas.

interface Scene {
  readonly beats: readonly Beat[];
  /** Run-relative ms at the sweep head (sweep) or at the right edge (static). */
  readonly t: number;
  /** Display time across the full strip width. */
  readonly periodMs: number;
  /** Wrap around with an erase gap and afterglow (a sweeping monitor); false: a static strip, oldest on the left. */
  readonly sweep: boolean;
  readonly head: boolean;
  /** From this run-relative time on, the trace is the red flatline. */
  readonly flatAt: number | null;
  /** Trace colour before `flatAt`. */
  readonly tone: 'pass' | 'neutral';
  /** Alarm band intensity, 0 to 1; null for none. */
  readonly alarm: number | null;
}

const STEADY_ALARM = 0.45;
const STEADY_INTERVAL_MS = 800;
const STEADY_BATCH = 1000;

/** Wider strips show more time, so a beat keeps about the same width (3 to 6 s across). */
function periodFor(width: number): number {
  return Math.min(6000, Math.max(3000, width * 6));
}

/** One smooth rise and fall per second, starting dark at the flatline. */
function alarmPulse(sinceMs: number): number {
  const phase = (((sinceMs % ALARM_PERIOD_MS) + ALARM_PERIOD_MS) % ALARM_PERIOD_MS) / ALARM_PERIOD_MS;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
}

function sweepScene(
  r: RunTrack,
  t: number,
  periodMs: number,
  { tone, head, alarm }: { tone: 'pass' | 'neutral'; head: boolean; alarm: number | null },
): Scene {
  const beats = scheduleBeats(r.snapshots, t);
  let flatAt = r.flatAt;
  // A beat drawn in the tick that saw the divergence finishes before the line goes flat.
  const lastBeat = beats[beats.length - 1];
  if (flatAt !== null && lastBeat) flatAt = Math.max(flatAt, lastBeat.atMs + BEAT_INTERVAL_MS);
  return { beats, t, periodMs, sweep: true, head, flatAt, tone, alarm };
}

function steadyBeats(untilMs: number): Beat[] {
  const beats: Beat[] = [];
  for (let at = 200; at + BEAT_INTERVAL_MS <= untilMs; at += STEADY_INTERVAL_MS) beats.push({ atMs: at, batch: STEADY_BATCH });
  return beats;
}

/** The reduced-motion strip for each state; also used when the strip mounts after the run ended. */
function staticScene(mode: HeartbeatMode, periodMs: number): Scene | null {
  const base = { t: periodMs, periodMs, sweep: false, head: false, alarm: null, flatAt: null, tone: 'pass' as const };
  const knee = periodMs * 0.55;
  switch (mode) {
    case 'idle':
      return null;
    case 'beating':
    case 'steady':
      return { ...base, beats: steadyBeats(periodMs) };
    case 'flatline':
      return { ...base, beats: steadyBeats(knee), flatAt: knee, alarm: STEADY_ALARM };
    case 'stopped':
      return { ...base, beats: steadyBeats(knee), tone: 'neutral' };
  }
}

// ---------------------------------------------------------------------------
// Painting.

/** The R peak sits this far after its tick, so the whole complex is written by the head, not popped in. */
const R_OFFSET_MS = 180;
const WAVE_REACH_MS = 330;
const ERASE_GAP = 0.04;
const FADE_BUCKETS = 14;

const gauss = (x: number, s: number) => Math.exp(-(x * x) / (2 * s * s));

/** A PQRST complex, R peak at 0, in units of the R height. */
function complex(dt: number): number {
  return (
    0.11 * gauss(dt + 150, 22) - 0.1 * gauss(dt + 26, 8) + gauss(dt, 9) - 0.26 * gauss(dt - 24, 9) + 0.24 * gauss(dt - 175, 38)
  );
}

/** Bigger batches draw a taller R wave, so a fast stream looks stronger than a trickle. */
function amplitude(batch: number): number {
  return 0.55 + 0.45 * Math.min(1, Math.log10(Math.max(1, batch)) / Math.log10(250));
}

function waveAt(beats: readonly Beat[], tau: number): number {
  // Beats are in time order: binary search the first one that can reach tau.
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]!.atMs + R_OFFSET_MS + WAVE_REACH_MS < tau) lo = mid + 1;
    else hi = mid;
  }
  let sum = 0;
  for (let i = lo; i < beats.length; i++) {
    const beat = beats[i]!;
    const dt = tau - beat.atMs - R_OFFSET_MS;
    if (dt < -WAVE_REACH_MS) break;
    sum += amplitude(beat.batch) * complex(dt);
  }
  return sum;
}

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(3)})`;
}

/** Screen, grid, scanlines and vignette, drawn once per size. */
function drawBackdrop(width: number, height: number, dpr: number): HTMLCanvasElement | null {
  const backdrop = document.createElement('canvas');
  backdrop.width = width;
  backdrop.height = height;
  const ctx = context2d(backdrop);
  if (!ctx) return null;
  ctx.fillStyle = '#040806';
  ctx.fillRect(0, 0, width, height);
  const grid = (stepCss: number, alpha: number) => {
    const step = stepCss * dpr;
    ctx.strokeStyle = rgba(VITALS_GRAPHICS.pass, alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = step; x < width; x += step) {
      const px = Math.round(x) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
    }
    for (let y = step; y < height; y += step) {
      const py = Math.round(y) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
    }
    ctx.stroke();
  };
  grid(8, 0.04);
  grid(40, 0.1);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  for (let y = 0; y < height; y += 3) ctx.fillRect(0, y, width, 1);
  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, Math.max(width, height) * 0.62);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  return backdrop;
}

interface Segment {
  readonly alpha: number;
  readonly colour: string;
  readonly points: number[];
}

function paint(view: View, scene: Scene | null) {
  const { ctx, w, h, dpr, backdrop } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (backdrop) ctx.drawImage(backdrop, 0, 0);
  else {
    ctx.fillStyle = '#040806';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  if (!scene) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (scene.alarm !== null) paintAlarm(ctx, w, h, scene.alarm);

  const { periodMs: P, t } = scene;
  const baseline = h * 0.62;
  const gain = h * 0.46;
  const headX = scene.sweep ? ((((t % P) + P) % P) / P) * w : w;
  const toneColour = VITALS_GRAPHICS[scene.tone];
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let previous: [number, number] | null = null;
  const step = 1 / dpr;

  for (let x = 0; x <= w + 1e-6; x += step) {
    const age = scene.sweep ? ((((headX - x) % w) + w) % w) * (P / w) : (w - x) * (P / w);
    const tau = t - age;
    if ((scene.sweep && age > P * (1 - ERASE_GAP)) || tau < 0) {
      current = null;
      previous = null;
      continue;
    }
    const colour = scene.flatAt !== null && tau >= scene.flatAt ? VITALS_GRAPHICS.fail : toneColour;
    const bucket = scene.sweep ? Math.min(FADE_BUCKETS - 1, Math.floor((age / P) * FADE_BUCKETS)) : 0;
    const alpha = scene.sweep ? 1 - 0.8 * ((bucket + 0.5) / FADE_BUCKETS) : 1;
    const y = baseline - gain * waveAt(scene.beats, tau);
    if (!current || current.alpha !== alpha || current.colour !== colour) {
      current = { alpha, colour, points: previous ? [previous[0], previous[1]] : [] };
      segments.push(current);
    }
    current.points.push(x, y);
    previous = [x, y];
  }

  ctx.lineJoin = 'round';
  // Butt caps: round caps overlap where fade segments meet and show as dots on the line.
  ctx.lineCap = 'butt';
  // Glow pass, then the crisp core.
  for (const [width, strength] of [
    [5, 0.16],
    [2.6, 0.32],
    [1.4, 1],
  ] as const) {
    ctx.lineWidth = width;
    for (const segment of segments) {
      if (segment.points.length < 4) continue;
      ctx.globalAlpha = segment.alpha * strength;
      ctx.strokeStyle = segment.colour;
      ctx.beginPath();
      ctx.moveTo(segment.points[0]!, segment.points[1]!);
      for (let i = 2; i < segment.points.length; i += 2) ctx.lineTo(segment.points[i]!, segment.points[i + 1]!);
      ctx.stroke();
    }
  }

  if (scene.head && t >= 0) {
    const y = baseline - gain * waveAt(scene.beats, t);
    const colour = scene.flatAt !== null && t >= scene.flatAt ? VITALS_GRAPHICS.fail : toneColour;
    const glow = ctx.createRadialGradient(headX, y, 0, headX, y, 9);
    glow.addColorStop(0, rgba(colour, 0.85));
    glow.addColorStop(1, rgba(colour, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.fillRect(headX - 9, y - 9, 18, 18);
    ctx.fillStyle = '#f0fff4';
    ctx.beginPath();
    ctx.arc(headX, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Red band at the top and bottom edges, `intensity` 0 to 1. */
function paintAlarm(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const red = VITALS_GRAPHICS.fail;
  const edge = 0.05 + 0.3 * intensity;
  const band = ctx.createLinearGradient(0, 0, 0, h);
  band.addColorStop(0, rgba(red, edge));
  band.addColorStop(0.32, rgba(red, 0));
  band.addColorStop(0.68, rgba(red, 0));
  band.addColorStop(1, rgba(red, edge));
  ctx.globalAlpha = 1;
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.35 + 0.65 * intensity;
  ctx.fillStyle = red;
  ctx.fillRect(0, 0, w, 2);
  ctx.fillRect(0, h - 2, w, 2);
  ctx.globalAlpha = 1;
}
