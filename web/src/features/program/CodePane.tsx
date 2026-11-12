import type { ReactNode, Ref } from 'react';
import { GUTTER_COLOR, HIGHLIGHT_ACCENT, HIGHLIGHT_BACKGROUND } from './theme';
import type { HighlightedFile, HighlightedToken, LineRange, StatementLink } from './types';

const HIGHLIGHT_STYLE = { background: HIGHLIGHT_BACKGROUND, boxShadow: `inset 3px 0 0 ${HIGHLIGHT_ACCENT}` };

interface FrameProps {
  readonly headingId: string;
  readonly title: string;
  readonly file: HighlightedFile;
  readonly background: string;
  readonly foreground: string;
  readonly children: ReactNode;
}

/** Heading plus a keyboard-scrollable code block. Code is real text in the DOM (Requirement 2.4). */
function CodeFrame({ headingId, title, file, background, foreground, children }: FrameProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <h2 id={headingId} className="mb-2 flex items-baseline gap-2 text-lg font-semibold">
        {title} <span className="font-mono text-sm font-normal text-zinc-300">{file.path}</span>
      </h2>
      {/* Focusable so keyboard users can scroll it. */}
      <div
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

function Lines({ file, range }: { readonly file: HighlightedFile; readonly range: LineRange }) {
  const lines: ReactNode[] = [];
  for (let n = range.start; n <= range.end; n++) {
    lines.push(<Line key={n} number={n} tokens={file.lines[n - 1] ?? []} />);
  }
  return lines;
}

function Line({ number, tokens }: { readonly number: number; readonly tokens: readonly HighlightedToken[] }) {
  return (
    <span className="flex pr-4">
      <span aria-hidden="true" className="w-12 shrink-0 select-none pr-4 text-right" style={{ color: GUTTER_COLOR }}>
        {number}
      </span>
      <span>
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
}

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
}

export function CobolPane({ highlight, highlightRef, ...frame }: CobolPaneProps) {
  return (
    <CodeFrame {...frame} title="COBOL">
      {segments(frame.file.lines.length, highlight ? [highlight] : []).map((part) =>
        part.kind === 'plain' ? (
          <Lines key={part.range.start} file={frame.file} range={part.range} />
        ) : (
          <mark
            key={part.range.start}
            ref={highlightRef}
            tabIndex={-1}
            className="block"
            style={{ ...HIGHLIGHT_STYLE, color: 'inherit' }}
          >
            <Lines file={frame.file} range={part.range} />
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
}

/** Each port statement that quotes COBOL is a button: focus or hover highlights the COBOL, Enter or click shows it. */
export function PortPane({ links, activeLink, hintId, onActivate, onReveal, ...frame }: PortPaneProps) {
  return (
    <CodeFrame {...frame} title="TypeScript port">
      {segments(
        frame.file.lines.length,
        links.map((link) => link.port),
      ).map((part) =>
        part.kind === 'plain' ? (
          <Lines key={part.range.start} file={frame.file} range={part.range} />
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
            <Lines file={frame.file} range={part.range} />
          </button>
        ),
      )}
    </CodeFrame>
  );
}
