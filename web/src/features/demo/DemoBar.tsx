/**
 * The demo bar (graphical-proof design, "DemoBar.tsx"; Requirements 11.4-11.10,
 * 13.3, 13.5 and 14.6). Mounted by ProgramPage for `?demo=1`.
 *
 * - Mounting starts the demo; unmounting (leaving the route, or `?demo` going
 *   away) exits it (11.8). Exit is the page's `onExit`, which also removes
 *   `?demo` and moves focus to the heading.
 * - Labels: "Demo: recorded replay", "Recorded" with the date of the recording
 *   on screen, and for a slowed replay the rate and the real run's duration as
 *   recorded (11.4, 11.5, 13.5).
 * - Controls: native buttons, so they are keyboard operable and get the global
 *   focus ring (11.6).
 * - The caption is plain text. Its announcement goes through ProofAnnouncer, the
 *   page's one polite live region (11.9, 14.6); this bar adds none.
 * - While paused, `data-demo-paused` on the root element holds the revive shock
 *   pulse's CSS animation (11.7, index.css). The replay timers and the Visuals'
 *   frame loop are held by the playback clock (useDemo).
 * - Cues: the bar scrolls the part of the page the current cue is about into
 *   view (instantly under reduced motion). Selecting fields, statements and the
 *   inspected digit field is ProgramPage's job, through component props.
 *
 * `data-demo-step` holds the current step id for the capture script. The bar is
 * a labelled region portalled into <body>, so it stays fixed to the viewport.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { DATE_FORMAT } from '../proof/proofMessages';
import { stepRate, stepRecording, type DemoCue, type DemoRecording, type DemoStep } from './demoScript';
import { useDemo, type DemoRecordingInfo } from './useDemo';

/** "Slow motion, 1/40 speed. The real run took 0.55 s." (11.5). Empty at rate 1. */
export function rateText(rate: number, realMs: number): string {
  if (rate === 1) return '';
  const speed = rate < 1 ? `Slow motion, 1/${Math.round(1 / rate)} speed.` : `Sped up, ${rate}× speed.`;
  return `${speed} The real run took ${(realMs / 1000).toFixed(2)} s.`;
}

interface LabelSource {
  readonly recording: DemoRecording;
  /** The rate it is or was replayed at; null when it has not been replayed yet. */
  readonly rate: number | null;
}

/** The recording on screen: the current step's, else the last one replayed, else the first one coming. */
export function labelSource(script: readonly DemoStep[], stepIndex: number): LabelSource | null {
  for (let i = Math.min(stepIndex, script.length - 1); i >= 0; i--) {
    const step = script[i]!;
    const recording = stepRecording(step);
    if (recording) return { recording, rate: stepRate(step) };
  }
  for (const step of script) {
    const recording = stepRecording(step);
    if (recording) return { recording, rate: null };
  }
  return null;
}

/** `data-demo-beat` on the bar for the capture script: "program", "field:OUT-TAX", "inspect:OUT-TAX". */
export function cueBeat(cue: DemoCue | null): string | undefined {
  if (!cue) return undefined;
  switch (cue.kind) {
    case 'field':
      return `field:${cue.name}`;
    case 'statement':
      return `statement:${cue.index}`;
    case 'inspect':
      return `inspect:${cue.field}`;
    default:
      return cue.kind;
  }
}

/** Where on the page a cue points. */
function cueTarget(cue: DemoCue): { selector: string; block: ScrollLogicalPosition } {
  switch (cue.kind) {
    case 'program':
      return { selector: '#program-title', block: 'center' };
    case 'field':
    case 'statement':
      return { selector: '[data-testid="source-panes"]', block: 'start' };
    case 'mutant-diff':
      return { selector: '[data-testid="mutant-details"]', block: 'center' };
    case 'vitals':
      // The bottom of the vitals (grid caption) just above the bar; scroll-padding-bottom reserves the bar.
      return { selector: '[data-testid="vitals-panel"]', block: 'end' };
    case 'shrink':
      return { selector: '[data-testid="shrink-viewer"]', block: 'center' };
    case 'autopsy':
      return { selector: '[data-testid="counterexample-card"]', block: 'start' };
    case 'inspect':
      return { selector: '[data-testid="digit-inspector"]', block: 'center' };
  }
}

const BUTTON =
  'rounded border border-zinc-500 px-3 py-1.5 text-sm font-semibold text-zinc-100 hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60';

export interface DemoBarProps {
  /** Exit pressed: stop the demo, drop `?demo` and move focus (ProgramPage). */
  readonly onExit: () => void;
}

export function DemoBar({ onExit }: DemoBarProps) {
  const { running, paused, stepIndex, cue, script, recordings, error, done, pause, resume, skip } = useDemo(
    useShallow((s) => ({
      running: s.running,
      paused: s.paused,
      stepIndex: s.stepIndex,
      cue: s.cue,
      script: s.script,
      recordings: s.recordings,
      error: s.error,
      done: s.done,
      pause: s.pause,
      resume: s.resume,
      skip: s.skip,
    })),
  );
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const barRef = useRef<HTMLElement>(null);
  const [barHeight, setBarHeight] = useState(0);

  // Start on mount; leaving the route (or losing `?demo`) exits (11.8). A demo
  // already ended by a live Prove is idle, so this leaves that run alone.
  useEffect(() => {
    void useDemo.getState().run();
    return () => {
      const s = useDemo.getState();
      if (s.running || s.done || s.error) s.exit();
    };
  }, []);

  // Hold CSS animations (the revive shock pulse) while paused (11.7).
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-demo-paused', paused);
    return () => root.removeAttribute('data-demo-paused');
  }, [paused]);

  // Reserve the fixed bar's height: the page can scroll its end clear of the bar, and
  // scrollIntoView (scroll-padding-bottom) stops content above it, not under it.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setBarHeight(Math.ceil(bar.getBoundingClientRect().height)));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (barHeight === 0) return;
    const root = document.documentElement;
    root.style.scrollPaddingBottom = `${barHeight}px`;
    return () => void root.style.removeProperty('scroll-padding-bottom');
  }, [barHeight]);

  // Bring what the cue is about into view.
  useEffect(() => {
    if (!cue) return;
    const { selector, block } = cueTarget(cue);
    const scroll = () => {
      const el = document.querySelector(selector);
      el?.scrollIntoView?.({ block, behavior: reduced ? 'auto' : 'smooth' });
      return el !== null;
    };
    // The target can render a frame after the cue (the card after a result), and can move
    // after it (the Prove summary appears above the vitals at the result): scroll again when
    // the target or the page changes size.
    let observer: ResizeObserver | null = null;
    const follow = () => {
      const el = document.querySelector(selector);
      if (!el || typeof ResizeObserver === 'undefined') return;
      const pending = new Set<Element>([el, document.body]); // each observed element's initial callback
      observer = new ResizeObserver((entries) => {
        const initial = entries.every((entry) => pending.delete(entry.target));
        if (!initial) scroll();
      });
      observer.observe(el);
      observer.observe(document.body);
    };
    let frame = 0;
    if (scroll()) follow();
    else frame = requestAnimationFrame(() => void (scroll() && follow()));
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [cue, reduced, barHeight]);

  const step = stepIndex >= 0 ? script[stepIndex] : undefined;
  const source = labelSource(script, stepIndex);
  const info: DemoRecordingInfo | undefined = source ? recordings[source.recording.file] : undefined;
  const rate = source?.rate !== null && source?.rate !== undefined && info ? rateText(source.rate, info.durationMs) : '';
  const caption = error
    ? error.message
    : done
      ? 'The demo has finished. Exit to use the lab yourself.'
      : (step?.caption ?? 'Loading the recorded proofs…');

  const bar = (
    <section
      ref={barRef}
      aria-label="Demo"
      data-testid="demo-bar"
      data-demo-step={step?.id}
      data-demo-beat={cueBeat(cue)}
      data-demo-state={error ? 'error' : done ? 'done' : paused ? 'paused' : running ? 'running' : 'idle'}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-amber-300/60 bg-zinc-950/95 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1 text-sm">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="rounded border border-amber-300 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
              Demo: recorded replay
            </span>
            {step && !done && !error && (
              <span className="text-zinc-300" data-testid="demo-step-count">
                Step {stepIndex + 1} of {script.length}
              </span>
            )}
          </p>
          <p
            className={`mt-1.5 max-w-prose leading-snug ${error ? 'text-red-300' : 'text-zinc-100'}`}
            data-testid="demo-caption"
          >
            {caption}
          </p>
          {info && (
            <p className="mt-1.5 text-zinc-300" data-testid="demo-recorded">
              <span className="mr-2 rounded border border-amber-300 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
                Recorded
              </span>
              {source?.rate === null ? 'Replays proofs recorded on ' : 'Proof recorded on '}
              <time dateTime={info.recordedAt}>{DATE_FORMAT.format(new Date(info.recordedAt))}</time> against
              GnuCOBOL. {rate && <span data-testid="demo-rate">{rate}</span>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {running && (
            <>
              <button
                type="button"
                onClick={paused ? resume : pause}
                disabled={stepIndex < 0}
                className={BUTTON}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" onClick={skip} disabled={stepIndex < 0} className={BUTTON}>
                Skip step
              </button>
            </>
          )}
          <button type="button" onClick={onExit} className={`${BUTTON} border-amber-300 text-amber-300`}>
            Exit demo
          </button>
        </div>
      </div>
    </section>
  );

  return (
    <>
      {/* Keeps the end of the page clear of the fixed bar. */}
      <div aria-hidden="true" className="h-44" style={barHeight ? { height: barHeight } : undefined} />
      {/* In <body>: the page panel's backdrop filter would make it the bar's containing block. */}
      {createPortal(bar, document.body)}
    </>
  );
}
