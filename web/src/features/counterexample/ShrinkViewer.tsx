/**
 * The Shrink viewer (graphical-proof design, "ShrinkViewer.tsx"; Requirements 5,
 * 13.4, 14.3, 14.4).
 *
 * Plays the Shrink_Path as one record row of named fields: the first differing
 * record of each stored step. On each step the changed fields cross-fade from the
 * old value to the new one, one field at a time, and stay marked "changed" (an
 * outline and the word, not colour alone). The record count shows as text
 * ("10 records → 6") beside a strip of record bars that collapses with it.
 *
 * Honesty (13.4): every label uses the real step index and total from the path,
 * and when sampling dropped steps the viewer says how many are shown.
 *
 * Timing: one timer per step from `stepTimings`, so all steps play within 10 s
 * (5.5). The frame loop is for the canvases fed by 4 Hz progress; this view
 * changes only a few times a second, on its own timer. The timer runs in display
 * time (`afterDisplay`), so it holds while a demo's playback clock is paused
 * (11.7); with no active clock it is a plain `setTimeout`.
 * Cross-fades use the Web Animations API, so no stylesheet is needed and a
 * browser without it simply shows the new value.
 *
 * Accessibility: the animated stage is `aria-hidden` (14.4) because the ordered
 * step list holds the same text. The list is always in the page for assistive
 * technology, and is the visible view under Reduced_Motion (5.6, 14.3), where
 * nothing plays. The current step carries `aria-current="step"`, so the controls
 * mean something to a screen reader too. No live region is added (14.6).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Counterexample, ShrinkPath } from '../../../../src/harness/equivalence.types';
import { decodeRecord, type DecodedField, type DecodedRecord, type RecordLayout } from '../../../../src/semantics/layout';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { afterDisplay } from '../proof/playbackClock';
import { COUNT_FORMAT } from '../proof/proofMessages';
import { shrinkSteps, stepTimings, type ShrinkStepView, type StepTiming } from './shrinkSteps';

/** Record bars drawn at most; a longer input shows the count in text only. */
const MAX_BARS = 40;

const count = (n: number) => COUNT_FORMAT.format(n);
const records = (n: number) => `${count(n)} ${n === 1 ? 'record' : 'records'}`;

/** Alphanumeric values are quoted so spaces show, as in the record tables. */
function display(field: DecodedField): string {
  return field.valid && !field.picture.startsWith('X') ? field.value : JSON.stringify(field.raw);
}

/** "Step k of N": 1-based real index and the real total. */
const stepLabel = (step: number, total: number) => `Step ${count(step + 1)} of ${count(total)}`;

export interface ShrinkViewerProps {
  readonly path: ShrinkPath | undefined;
  readonly layout: RecordLayout;
  readonly counterexample: Counterexample | undefined;
}

export function ShrinkViewer({ path, layout, counterexample }: ShrinkViewerProps) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const steps = useMemo(() => (path ? shrinkSteps(path, layout) : []), [path, layout]);
  return (
    <section aria-labelledby="shrink-title" className="mt-4" data-testid="shrink-viewer">
      <h3 id="shrink-title" className="font-semibold">
        Shrinking to the smallest failing input
      </h3>
      {path && steps.length > 0 ? (
        <Playback path={path} steps={steps} reduced={reduced} />
      ) : (
        <NoPath layout={layout} counterexample={counterexample} />
      )}
    </section>
  );
}

/** 5.7: a version 1 recording, or a path the client dropped as invalid. */
function NoPath({ layout, counterexample }: { layout: RecordLayout; counterexample: Counterexample | undefined }) {
  const record = counterexample?.records[counterexample.line];
  return (
    <>
      <p className="mt-1 max-w-prose text-sm text-zinc-300" data-testid="shrink-no-path">
        No shrink path was recorded for this run, so only the final counterexample is shown.
      </p>
      {record !== undefined && counterexample && (
        <dl
          aria-label={`Final failing input, record ${count(counterexample.line + 1)} of ${count(counterexample.records.length)}`}
          className="mt-2 flex flex-wrap gap-2 text-sm"
        >
          {decodeRecord(layout, record).fields.map((f, i) => (
            <div key={i} className="rounded border border-zinc-700 px-2 py-1">
              <dt className="text-xs text-zinc-300">{f.name}</dt>
              <dd className="font-mono whitespace-pre">{display(f)}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

interface PlaybackProps {
  readonly path: ShrinkPath;
  readonly steps: readonly ShrinkStepView[];
  readonly reduced: boolean;
}

function Playback({ path, steps, reduced }: PlaybackProps) {
  const timings = useMemo(() => stepTimings(steps.map((s) => s.changed.length)), [steps]);
  const playback = useShrinkPlayback(timings, !reduced);
  const first = steps[0];
  const shrinks = path.total - 1;
  return (
    <>
      <p className="mt-1 max-w-prose text-sm">
        fast-check reached {count(path.total)} failing {path.total === 1 ? 'input' : 'inputs'}: the first failure
        {shrinks > 0 && ` and ${count(shrinks)} smaller ${shrinks === 1 ? 'one' : 'ones'} that still fail`}. Each
        step shows the input's first differing record.
        {first && ` The first failure had ${records(first.recordCount)}.`}
      </p>
      {steps.length < path.total && (
        <p className="mt-1 text-sm text-zinc-300" data-testid="shrink-dropped">
          Showing {count(steps.length)} of {count(path.total)} steps. The others were dropped to keep the result small;
          step numbers are the real ones.
        </p>
      )}
      {!reduced && <Stage path={path} steps={steps} timings={timings} playback={playback} />}
      <StepList path={path} steps={steps} current={reduced ? undefined : playback.index} visible={reduced} />
    </>
  );
}

interface PlaybackState {
  readonly index: number;
  /** The step shown before this one, for the cross-fade; undefined on first show. */
  readonly from: number | undefined;
  readonly playing: boolean;
  go(index: number): void;
  toggle(): void;
  replay(): void;
}

/** Which step is shown and whether it plays. One timer per step, cleared on any change. */
function useShrinkPlayback(timings: readonly StepTiming[], autoplay: boolean): PlaybackState {
  const last = timings.length - 1;
  const [shown, setShown] = useState<{ index: number; from: number | undefined }>({ index: 0, from: undefined });
  const [playing, setPlaying] = useState(autoplay && last > 0);
  const { index } = shown;
  useEffect(() => {
    if (!playing || index >= last) return;
    return afterDisplay(timings[index]?.durationMs ?? 0, () => {
      setShown({ index: index + 1, from: index });
      if (index + 1 >= last) setPlaying(false);
    });
  }, [playing, index, last, timings]);
  const show = (next: number) => setShown((s) => (s.index === next ? s : { index: next, from: s.index }));
  return {
    index,
    from: shown.from,
    playing,
    go(next) {
      setPlaying(false);
      show(Math.max(0, Math.min(last, next)));
    },
    toggle() {
      if (playing) return setPlaying(false);
      if (last <= 0) return;
      if (index >= last) setShown({ index: 0, from: undefined });
      setPlaying(true);
    },
    replay() {
      setShown({ index: 0, from: undefined });
      setPlaying(last > 0);
    },
  };
}

interface StageProps {
  readonly path: ShrinkPath;
  readonly steps: readonly ShrinkStepView[];
  readonly timings: readonly StepTiming[];
  readonly playback: PlaybackState;
}

/** The animated view and its controls. Only the controls are exposed to assistive technology. */
function Stage({ path, steps, timings, playback }: StageProps) {
  const { index, from, playing } = playback;
  const step = steps[index];
  const before = from === undefined ? undefined : steps[from];
  if (!step) return null;
  const last = steps.length - 1;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') playback.go(index - 1);
    else if (e.key === 'ArrowRight') playback.go(index + 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className="mt-3 rounded border border-zinc-700 bg-zinc-950/60 p-3">
      <div
        aria-hidden="true"
        data-testid="shrink-stage"
        // Beat marker for the capture script (web/video/capture.spec.ts): playing, half way or more.
        data-demo-beat={playing && index > 0 && index * 2 >= last && index < last ? 'shrink-midway' : undefined}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-mono text-sm font-semibold" data-testid="shrink-step">
            {stepLabel(step.step, path.total)}
            {step.step === 0 && <span className="ml-2 font-sans font-normal text-zinc-300">first failure</span>}
            {step.step === path.total - 1 && (
              <span className="ml-2 font-sans font-normal text-red-200">✗ smallest failing input</span>
            )}
          </p>
          <p className="text-sm" data-testid="shrink-count">
            {before && before.recordCount !== step.recordCount
              ? `${records(before.recordCount)} → ${count(step.recordCount)}`
              : records(step.recordCount)}
            <span className="text-zinc-300">, record {count(step.line + 1)} shown</span>
          </p>
        </div>
        <Timeline path={path} steps={steps} index={index} />
        <RecordBars steps={steps} step={step} />
        <FieldRow step={step} before={before} fieldMs={timings[index]?.fieldMs ?? 0} />
        {before && step.changed.length === 0 && (
          <p className="mt-2 text-xs text-zinc-300">No field of this record changed at this step.</p>
        )}
      </div>
      <div
        role="group"
        aria-label="Shrink playback"
        className="mt-3 flex flex-wrap gap-2"
        onKeyDown={onKeyDown}
        data-testid="shrink-controls"
      >
        <ControlButton onClick={playback.toggle} disabled={last === 0} icon={playing ? '❚❚' : '▶'}>
          {playing ? 'Pause' : 'Play'}
        </ControlButton>
        <ControlButton onClick={() => playback.go(index - 1)} disabled={index === 0} icon="◀">
          Previous step
        </ControlButton>
        <ControlButton onClick={() => playback.go(index + 1)} disabled={index === last} icon="▶▏">
          Next step
        </ControlButton>
        <ControlButton onClick={playback.replay} disabled={last === 0} icon="↺">
          Replay
        </ControlButton>
      </div>
    </div>
  );
}

/**
 * `aria-disabled`, not `disabled`: a disabled button drops focus, and Previous
 * and Next become unavailable at the ends while the user is on them.
 */
function ControlButton({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: string;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className="inline-flex min-h-9 items-center gap-1.5 rounded border border-zinc-500 px-3 text-sm hover:bg-zinc-800 aria-disabled:cursor-not-allowed aria-disabled:border-zinc-700 aria-disabled:text-zinc-400 aria-disabled:hover:bg-transparent"
    >
      <span aria-hidden="true" className="text-xs">
        {icon}
      </span>
      {children}
    </button>
  );
}

/** Ticks at each stored step's real position along the whole path, so dropped steps show as gaps. */
function Timeline({ path, steps, index }: { path: ShrinkPath; steps: readonly ShrinkStepView[]; index: number }) {
  const span = Math.max(1, path.total - 1);
  const at = (step: number) => `${(step / span) * 100}%`;
  const current = steps[index]?.step ?? 0;
  return (
    <div className="relative mx-1 mt-3 h-3">
      <div className="absolute inset-x-0 top-1/2 h-px bg-zinc-600" />
      <div
        className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 bg-amber-300 motion-safe:transition-[width] motion-safe:duration-300"
        style={{ width: at(current) }}
      />
      {steps.map((s, i) => (
        <span
          key={s.step}
          className={`absolute top-1/2 h-2 w-0.5 -translate-x-1/2 -translate-y-1/2 ${i <= index ? 'bg-amber-300' : 'bg-zinc-500'}`}
          style={{ left: at(s.step) }}
        />
      ))}
      <span
        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-950 bg-amber-300 motion-safe:transition-[left] motion-safe:duration-300"
        style={{ left: at(current) }}
      />
    </div>
  );
}

/** One bar per record of the input; bars past the count fade and fold away as the input shrinks. */
function RecordBars({ steps, step }: { steps: readonly ShrinkStepView[]; step: ShrinkStepView }) {
  const slots = Math.min(MAX_BARS, Math.max(...steps.map((s) => s.recordCount)));
  return (
    <div className="mt-3 flex h-4 items-end gap-0.5">
      {Array.from({ length: slots }, (_, i) => {
        const present = i < step.recordCount;
        const shown = i === step.line;
        return (
          <span
            key={i}
            className={`h-full w-2 origin-bottom rounded-sm transition-[opacity,transform,background-color] duration-300 ${
              shown ? 'bg-red-300' : 'bg-zinc-400'
            } ${present ? 'opacity-100' : 'scale-y-0 opacity-0'}`}
          />
        );
      })}
    </div>
  );
}

/**
 * The value change: the old value wipes up and out in the first half, the new
 * one wipes up and in during the second. Opacity is only ever 1 or 0 (a step at
 * the midpoint), never in between, so text that can be seen keeps its full
 * contrast (14.2) and axe never measures a half-faded value.
 */
const WIPE_OUT: Keyframe[] = [
  { offset: 0, opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'none' },
  { offset: 0.5, opacity: 1, clipPath: 'inset(0 0 100% 0)', transform: 'translateY(-0.6em)' },
  { offset: 0.5, opacity: 0 },
  { offset: 1, opacity: 0 },
];
const WIPE_IN: Keyframe[] = [
  { offset: 0, opacity: 0 },
  { offset: 0.5, opacity: 0 },
  { offset: 0.5, opacity: 1, clipPath: 'inset(100% 0 0 0)', transform: 'translateY(0.6em)' },
  { offset: 1, opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'none' },
];

/** The record row. Changed fields wipe from old to new one at a time and keep an outline and a "changed" tag. */
function FieldRow({ step, before, fieldMs }: { step: ShrinkStepView; before: ShrinkStepView | undefined; fieldMs: number }) {
  const cells = useRef<(HTMLElement | null)[]>([]);
  // The fields that differ from what was on screen: the step's own changes when
  // playing forward, the real difference after a jump.
  const fading = useMemo(() => (before ? differing(before.record, step.record) : []), [before, step]);
  useLayoutEffect(() => {
    const running: Animation[] = [];
    fading.forEach((field, order) => {
      const cell = cells.current[field];
      const [old, next] = [cell?.querySelector('[data-old]'), cell?.querySelector('[data-new]')];
      if (!cell || typeof cell.animate !== 'function' || !old || !next) return;
      const timing = { duration: Math.max(1, fieldMs), delay: order * fieldMs, fill: 'both' as const, easing: 'ease-out' };
      running.push(
        old.animate(WIPE_OUT, timing),
        next.animate(WIPE_IN, timing),
        cell.animate({ transform: ['scale(1)', 'scale(1.06)', 'scale(1)'] }, { ...timing, fill: 'none' }),
      );
    });
    return () => running.forEach((a) => a.cancel());
  }, [fading, fieldMs]);
  const changed = new Set(step.changed);
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {step.record.fields.map((field, i) => {
        const isChanged = changed.has(i);
        const old = before?.record.fields[i];
        const was = old && old.raw !== field.raw ? old : undefined;
        return (
          <div
            key={i}
            ref={(el) => {
              cells.current[i] = el;
            }}
            className={`min-w-28 rounded px-2.5 py-1.5 ${
              isChanged ? 'border-2 border-dashed border-amber-300 bg-amber-300/10' : 'border-2 border-zinc-700'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2 text-xs text-zinc-300">
              <span>{field.name}</span>
              <span className="font-mono">{field.picture.split(' ')[0]}</span>
            </div>
            <div className="relative mt-0.5 font-mono text-base whitespace-pre">
              <span data-new className="block">
                {display(field)}
              </span>
              {was && (
                <span data-old className="absolute inset-0 opacity-0">
                  {display(was)}
                </span>
              )}
            </div>
            <div className="mt-0.5 h-4 text-xs">
              {isChanged && (
                <span className="text-amber-200">
                  ✎ changed{was ? <span className="text-zinc-300">, was {display(was)}</span> : null}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function differing(a: DecodedRecord, b: DecodedRecord): number[] {
  return b.fields.flatMap((f, i) => (f.raw === a.fields[i]?.raw ? [] : [i]));
}

/**
 * Every stored step in order, changed fields marked in text (5.6). Visible under
 * Reduced_Motion; otherwise only for assistive technology.
 */
function StepList({
  path,
  steps,
  current,
  visible,
}: {
  path: ShrinkPath;
  steps: readonly ShrinkStepView[];
  current: number | undefined;
  visible: boolean;
}) {
  return (
    <ol
      aria-label="Shrink steps"
      className={visible ? 'mt-3 space-y-2 text-sm' : 'sr-only'}
      data-testid="shrink-list"
    >
      {steps.map((s, i) => {
        const changed = new Set(s.changed);
        return (
          <li
            key={s.step}
            aria-current={i === current ? 'step' : undefined}
            className="rounded border border-zinc-700 px-3 py-2"
          >
            <p>
              <span className="font-semibold">{stepLabel(s.step, path.total)}</span>
              {s.step === path.total - 1 && ', the smallest failing input'}: {records(s.recordCount)}, record{' '}
              {count(s.line + 1)} shown.
              {i > 0 && s.changed.length === 0 && ' No field of this record changed.'}
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {s.record.fields.map((f, j) => (
                <li key={j}>
                  {f.name} <span className="font-mono whitespace-pre">{display(f)}</span>
                  {changed.has(j) && <strong className="ml-1 font-semibold text-amber-200">changed</strong>}
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
