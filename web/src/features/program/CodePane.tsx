import { memo, type ReactNode, type Ref } from 'react';
import { GUTTER_COLOR, HIGHLIGHT_ACCENT, HIGHLIGHT_BACKGROUND } from './theme';
import type { HighlightedFile, HighlightedToken, LineRange, StatementLink } from './types';

const HIGHLIGHT_STYLE = { background: HIGHLIGHT_BACKGROUND, boxShadow: `inset 3px 0 0 ${HIGHLIGHT_ACCENT}` };

/**
 * Field stitch colour (teal-300): 12:1 on the pane background, so the accent bar and
 * the stitch clear 3:1 (Requirement 14.2). The line tint is darker than
 * HIGHLIGHT_BACKGROUND, so every token colour still clears 4.5:1 on it.
 */
export const STITCH_COLOR = '#5eead4';
const FIELD_STYLE = { background: 'rgb(94 234 212 / 0.08)', boxShadow: `inset 3px 0 0 ${STITCH_COLOR}` };

/**
 * Field stitch marks for one pane (Requirement 6.4). Field lines get pointer hover only:
 * the keyboard route is the Fields listbox, so they add no tab stops.
 */
export interface FieldMarks {
  /** 1-based line → index into `ProgramSource.fields`. */
  readonly byLine: ReadonlyMap<number, number>;
  /** The active field's line in this pane, or null. */
  readonly activeLine: number | null;
  /** The line that may take programmatic focus ("Show in COBOL / port"), or null. */
  readonly focusLine: number | null;
  readonly onHover: (index: number | null) => void;
}

interface FrameProps {
  readonly headingId: string;
  /** The scrolling element, for the stitch overlay. */
  readonly paneRef?: Ref<HTMLDivElement>;
  readonly title: string;
  readonly file: HighlightedFile;
  readonly background: string;
  readonly foreground: string;
  readonly children: ReactNode;
}

/** Heading plus a keyboard-scrollable code block. Code is real text in the DOM (Requirement 2.4). */
function CodeFrame({ headingId, paneRef, title, file, background, foreground, children }: FrameProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <h2 id={headingId} className="mb-2 flex items-baseline gap-2 text-lg font-semibold">
        {title} <span className="font-mono text-sm font-normal text-zinc-300">{file.path}</span>
      </h2>
      {/* Focusable so keyboard users can scroll it. */}
      <div
        ref={paneRef}
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        className="max-h-[70vh] overflow-auto rounded border border-zinc-800"
        style={{ background, color: foreground }}
      >
        <pre className="py-3 font-mono text-sm leading-6">
          <code className="block w-max min-w-full">{children}</code>
        </pre>
      </div>
    </div>
  );
}

interface LinesProps {
  readonly file: HighlightedFile;
  readonly range: LineRange;
  readonly marks?: FieldMarks | undefined;
  /** False inside a statement button: a focusable line there would be nested interactive content. */
  readonly focusable?: boolean;
}

function Lines({ file, range, marks, focusable = true }: LinesProps) {
  const lines: ReactNode[] = [];
  for (let n = range.start; n <= range.end; n++) {
    const field = marks?.byLine.get(n);
    lines.push(
      <Line
        key={n}
        number={n}
        tokens={file.lines[n - 1] ?? []}
        field={field}
        active={marks?.activeLine === n}
        focusable={focusable && marks?.focusLine === n}
        onFieldHover={field === undefined ? undefined : marks?.onHover}
      />,
    );
  }
  return lines;
}

interface LineProps {
  readonly number: number;
  readonly tokens: readonly HighlightedToken[];
  readonly field?: number | undefined;
  readonly active?: boolean;
  readonly focusable?: boolean;
  readonly onFieldHover?: ((index: number | null) => void) | undefined;
}

/** One code line. `data-line` lets the stitch overlay and "Show in …" find it. Memoised: hover re-renders only the lines that change. */
const Line = memo(function Line({ number, tokens, field, active = false, focusable = false, onFieldHover }: LineProps) {
  // The gutter is aria-hidden, so its marker (• field line, ▸ active field) is a visual cue next to the tint and bar.
  const marker =
    field === undefined ? '' : active ? "before:content-['▸'] before:mr-1" : "before:content-['•'] before:mr-1 before:opacity-70";
  return (
    <span
      data-line={number}
      data-field={field}
      data-field-active={active || undefined}
      tabIndex={focusable ? -1 : undefined}
      className={`flex pr-4${focusable ? ' focus:outline-2 focus:-outline-offset-2 focus:outline-amber-300' : ''}`}
      style={active ? FIELD_STYLE : undefined}
      onMouseEnter={
        onFieldHover && field !== undefined
          ? () => {
              onFieldHover(field);
            }
          : undefined
      }
      onMouseLeave={
        onFieldHover
          ? () => {
              onFieldHover(null);
            }
          : undefined
      }
    >
      <span
        aria-hidden="true"
        className={`w-12 shrink-0 select-none pr-4 text-right ${marker}`}
        style={{ color: active ? STITCH_COLOR : GUTTER_COLOR }}
      >
        {number}
      </span>
      <span data-code="">
        {tokens.length === 0
          ? ' '
          : tokens.map(([text, color], i) => (
              <span key={i} style={{ color }}>
                {text}
              </span>
            ))}
      </span>
    </span>
  );
});

/** Splits a file into plain line runs and the given ranges, in order. Ranges must not overlap. */
function segments(lineCount: number, ranges: readonly LineRange[]) {
  const sorted = ranges.map((range, index) => ({ range, index })).sort((a, b) => a.range.start - b.range.start);
  const out: ({ kind: 'plain'; range: LineRange } | { kind: 'range'; range: LineRange; index: number })[] = [];
  let next = 1;
  for (const { range, index } of sorted) {
    if (range.start > next) out.push({ kind: 'plain', range: { start: next, end: range.start - 1 } });
    out.push({ kind: 'range', range, index });
    next = range.end + 1;
  }
  if (next <= lineCount) out.push({ kind: 'plain', range: { start: next, end: lineCount } });
  return out;
}

interface CobolPaneProps extends Omit<FrameProps, 'children' | 'title'> {
  readonly highlight: LineRange | null;
  readonly highlightRef: Ref<HTMLElement>;
  readonly marks?: FieldMarks;
}

export function CobolPane({ highlight, highlightRef, marks, ...frame }: CobolPaneProps) {
  return (
    <CodeFrame {...frame} title="COBOL">
      {segments(frame.file.lines.length, highlight ? [highlight] : []).map((part) =>
        part.kind === 'plain' ? (
          <Lines key={part.range.start} file={frame.file} range={part.range} marks={marks} />
        ) : (
          <mark
            key={part.range.start}
            ref={highlightRef}
            tabIndex={-1}
            className="block"
            style={{ ...HIGHLIGHT_STYLE, color: 'inherit' }}
          >
            <Lines file={frame.file} range={part.range} marks={marks} />
          </mark>
        ),
      )}
    </CodeFrame>
  );
}

interface PortPaneProps extends Omit<FrameProps, 'children' | 'title'> {
  readonly links: readonly StatementLink[];
  readonly activeLink: number | null;
  readonly hintId: string;
  readonly onActivate: (index: number) => void;
  readonly onReveal: (index: number) => void;
  readonly marks?: FieldMarks;
}

/** Each port statement that quotes COBOL is a button: focus or hover highlights the COBOL, Enter or click shows it. */
export function PortPane({ links, activeLink, hintId, onActivate, onReveal, marks, ...frame }: PortPaneProps) {
  return (
    <CodeFrame {...frame} title="TypeScript port">
      {segments(
        frame.file.lines.length,
        links.map((link) => link.port),
      ).map((part) =>
        part.kind === 'plain' ? (
          <Lines key={part.range.start} file={frame.file} range={part.range} marks={marks} />
        ) : (
          <button
            key={part.range.start}
            type="button"
            aria-describedby={hintId}
            data-link={part.index}
            className="block w-full cursor-pointer whitespace-pre text-left hover:bg-white/5"
            style={part.index === activeLink ? HIGHLIGHT_STYLE : undefined}
            onFocus={() => {
              onActivate(part.index);
            }}
            onMouseEnter={() => {
              onActivate(part.index);
            }}
            onClick={() => {
              onReveal(part.index);
            }}
          >
            <Lines file={frame.file} range={part.range} marks={marks} focusable={false} />
          </button>
        ),
      )}
    </CodeFrame>
  );
}
