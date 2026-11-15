import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { FieldLink, HighlightedToken, ProgramSource } from '../program/types';

/**
 * Field stitches (Requirement 6.4, 6.6, 6.7): the "Fields" listbox and the details text.
 * The SVG lines between the side-by-side panes are in StitchOverlay.tsx.
 */

export type StitchPane = 'cobol' | 'port';

const SECTIONS: readonly { id: FieldLink['section']; label: string; noun: string }[] = [
  { id: 'input', label: 'Input record', noun: 'Input record field' },
  { id: 'output', label: 'Output record', noun: 'Output record field' },
  { id: 'working', label: 'Working storage', noun: 'Working-storage item' },
];

const sectionNoun = (section: FieldLink['section']) => SECTIONS.find((s) => s.id === section)?.noun ?? section;

/** "offset 6, width 9 (columns 7–15)" for record fields, null for working storage. */
export function recordText(field: FieldLink): string | null {
  if (field.offset === undefined || field.length === undefined) return null;
  const first = field.offset + 1;
  const last = field.offset + field.length;
  const columns = first === last ? `column ${first}` : `columns ${first}–${last}`;
  return `offset ${field.offset}, width ${field.length} (${columns})`;
}

/** "COBOL line 23, port line 80; the port also uses it on lines 45 and 60". */
export function linesText(field: FieldLink): string {
  const [primary, ...uses] = field.portLines;
  const base = `COBOL line ${field.cobolLine}, port line ${primary ?? '?'}`;
  if (uses.length === 0) return base;
  const list = uses.length === 1 ? `${uses[0]}` : `${uses.slice(0, -1).join(', ')} and ${uses.at(-1)}`;
  return `${base}; the port also uses it on line${uses.length === 1 ? '' : 's'} ${list}`;
}

/** The whole details text in one string, used as each option's accessible description. */
export function fieldDescription(field: FieldLink): string {
  const record = recordText(field);
  return [
    `${sectionNoun(field.section)}.`,
    `PIC ${field.picture}.`,
    record ? `Record ${record}.` : null,
    `TypeScript: ${field.representation}.`,
    `Port code: ${field.portCode}.`,
    `${linesText(field)}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** The pane caption for the active field: "OUT-TAX: PIC 9(5)V99 on COBOL line 40, bigint … on port line 80 (code)". */
export function fieldCaption(field: FieldLink): string {
  const portLine = field.portLines[0];
  const port = portLine === undefined ? 'no port line' : `port line ${portLine}`;
  return `${field.name}: PIC ${field.picture} on COBOL line ${field.cobolLine}, ${field.representation} on ${port} (${field.portCode})`;
}

/** A line's tokens without leading whitespace, for the details text form. */
export function trimLeading(tokens: readonly HighlightedToken[]): HighlightedToken[] {
  const out: HighlightedToken[] = [];
  for (const [text, color] of tokens) {
    if (out.length === 0) {
      const trimmed = text.trimStart();
      if (trimmed) out.push([trimmed, color]);
    } else out.push([text, color]);
  }
  return out;
}

function CodeLine({ tokens }: { readonly tokens: readonly HighlightedToken[] | undefined }) {
  const trimmed = trimLeading(tokens ?? []);
  return (
    // Wraps rather than scrolls: a scrolling element would need its own tab stop.
    <code className="block min-w-0 whitespace-pre-wrap py-0.5 [overflow-wrap:anywhere] font-mono text-sm">
      {trimmed.length === 0
        ? ' '
        : trimmed.map(([text, color], i) => (
            <span key={i} style={{ color }}>
              {text}
            </span>
          ))}
    </code>
  );
}

interface FieldStitchesProps {
  readonly source: ProgramSource;
  /** The listbox selection (focus or click), or null after Escape. */
  readonly selected: number | null;
  /** What the details show: the hovered field, else the selection. */
  readonly active: number | null;
  /** Panes stacked behind tabs: add the "Show in …" buttons (Requirement 6.7). */
  readonly stacked: boolean;
  readonly onSelect: (index: number | null) => void;
  readonly onHover: (index: number | null) => void;
  /** Enter or click: bring both lines into view. */
  readonly onReveal: (index: number) => void;
  /** Stacked only: switch to a pane and focus the field's line there. */
  readonly onShow: (pane: StitchPane, index: number) => void;
}

/** One Tab stop (roving tabindex): arrows and Home/End move, Enter reveals, Escape clears (Requirement 6.6). */
export function FieldStitches({ source, selected, active, stacked, onSelect, onHover, onReveal, onShow }: FieldStitchesProps) {
  const baseId = useId();
  const { fields } = source;
  // Arrow order follows the visible grouping.
  const order = useMemo(
    () => SECTIONS.flatMap((s) => fields.flatMap((f, i) => (f.section === s.id ? [i] : []))),
    [fields],
  );
  const [focusIndex, setFocusIndex] = useState<number>(order[0] ?? 0);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const tabStop = selected ?? focusIndex;

  if (fields.length === 0) return null;

  function move(index: number) {
    setFocusIndex(index);
    onSelect(index);
    optionRefs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = Math.max(0, order.indexOf(tabStop));
    const step: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowRight: at + 1,
      ArrowUp: at - 1,
      ArrowLeft: at - 1,
      Home: 0,
      End: order.length - 1,
    };
    const target = step[event.key];
    if (target !== undefined) {
      event.preventDefault();
      const next = order[Math.min(Math.max(target, 0), order.length - 1)];
      if (next !== undefined) move(next);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(tabStop);
      onReveal(tabStop);
    } else if (event.key === 'Escape' && (selected !== null || active !== null)) {
      event.preventDefault();
      onSelect(null);
      onHover(null);
    }
  }

  const field = active === null ? undefined : fields[active];
  const hintId = `${baseId}-hint`;

  return (
    <section
      aria-labelledby={`${baseId}-title`}
      className="mb-4 grid gap-4 rounded border border-zinc-800 bg-zinc-900/60 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
    >
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={`${baseId}-title`} className="text-base font-semibold">
            Field stitches
          </h2>
          <p id={hintId} className="text-xs text-zinc-300">
            Arrow keys move. Enter shows both lines. Escape clears.
          </p>
        </div>
        <div
          role="listbox"
          aria-label="Fields"
          aria-describedby={hintId}
          onKeyDown={onKeyDown}
          onMouseLeave={() => {
            onHover(null);
          }}
          className="flex flex-col gap-2"
        >
          {SECTIONS.map((section) => {
            const members = order.filter((i) => fields[i]?.section === section.id);
            if (members.length === 0) return null;
            const labelId = `${baseId}-${section.id}`;
            return (
              <div key={section.id} role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1.5">
                <span id={labelId} className="w-full shrink-0 text-xs text-zinc-300 sm:w-32">
                  {section.label}
                </span>
                {members.map((i) => {
                  const f = fields[i];
                  if (!f) return null;
                  const isSelected = selected === i;
                  const isActive = active === i;
                  return (
                    <div
                      key={f.name}
                      ref={(el) => {
                        optionRefs.current[i] = el;
                      }}
                      role="option"
                      id={`${baseId}-option-${i}`}
                      aria-selected={isSelected}
                      aria-describedby={`${baseId}-desc-${i}`}
                      tabIndex={i === tabStop ? 0 : -1}
                      data-field-option={f.name}
                      onFocus={() => {
                        setFocusIndex(i);
                        onSelect(i);
                      }}
                      onClick={() => {
                        setFocusIndex(i);
                        onSelect(i);
                        onReveal(i);
                      }}
                      onMouseEnter={() => {
                        onHover(i);
                      }}
                      className={`cursor-pointer select-none rounded border px-2 py-0.5 font-mono text-xs motion-safe:transition-colors ${
                        isActive
                          ? 'border-teal-300 bg-teal-300/15 text-teal-100'
                          : 'border-zinc-600 text-zinc-200 hover:border-teal-300/70'
                      } ${isSelected ? 'border-2 px-[7px] py-px font-semibold' : ''}`}
                    >
                      {isSelected && (
                        <span aria-hidden="true" className="mr-1 text-teal-300">
                          ▸
                        </span>
                      )}
                      {f.name}
                      <span id={`${baseId}-desc-${i}`} hidden>
                        {fieldDescription(f)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <FieldDetails source={source} field={field} index={active} stacked={stacked} onShow={onShow} />
    </section>
  );
}

interface FieldDetailsProps {
  readonly source: ProgramSource;
  readonly field: FieldLink | undefined;
  readonly index: number | null;
  readonly stacked: boolean;
  readonly onShow: (pane: StitchPane, index: number) => void;
}

/** Plain text: PIC, record position, TypeScript representation, port code, and both lines (Requirement 6.4, 6.7, 6.8). */
function FieldDetails({ source, field, index, stacked, onShow }: FieldDetailsProps) {
  if (!field || index === null) {
    return (
      <div data-testid="field-details" className="flex items-center text-sm text-zinc-300">
        <p>
          Choose a field, or point at a COBOL data item, to see its PIC clause, its TypeScript representation and the port
          code that reads or writes it.
        </p>
      </div>
    );
  }
  const record = recordText(field);
  const portLine = field.portLines[0];
  const rows: [string, string, boolean][] = [
    ['PIC', field.picture, true],
    ...(record ? ([['Record', record, false]] as [string, string, boolean][]) : []),
    ['TypeScript', field.representation, false],
    ['Port code', field.portCode, true],
    ['Lines', linesText(field), false],
  ];
  return (
    <div data-testid="field-details" className="min-w-0 text-sm">
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-base font-semibold text-teal-200">{field.name}</span>
        <span className="text-zinc-300">{sectionNoun(field.section)}</span>
      </p>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        {rows.map(([term, value, mono]) => (
          <div key={term} className="contents">
            <dt className="text-zinc-300">{term}</dt>
            <dd className={`min-w-0 break-words text-zinc-100 ${mono ? 'font-mono' : ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div
        className="mt-2 rounded border border-zinc-800 px-2 py-1"
        style={{ background: source.background, color: source.foreground }}
        data-testid="field-lines"
      >
        <div className="flex items-baseline gap-2">
          <span className="w-16 shrink-0 text-xs text-zinc-300 sm:w-20">COBOL {field.cobolLine}</span>
          <CodeLine tokens={source.cobol.lines[field.cobolLine - 1]} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="w-16 shrink-0 text-xs text-zinc-300 sm:w-20">Port {portLine}</span>
          <CodeLine tokens={portLine === undefined ? undefined : source.port.lines[portLine - 1]} />
        </div>
      </div>
      {stacked && (
        <div className="mt-2 flex flex-wrap gap-2">
          {(['cobol', 'port'] as const).map((pane) => (
            <button
              key={pane}
              type="button"
              onClick={() => {
                onShow(pane, index);
              }}
              className="rounded border border-zinc-600 px-3 py-1.5 text-sm text-zinc-100 hover:border-teal-300"
            >
              {pane === 'cobol' ? 'Show in COBOL' : 'Show in port'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Scroll a pane (not the page) so `line` is in view, centred when it was out of view. */
export function scrollLineIntoPane(pane: HTMLElement | null, line: number | undefined, smooth: boolean): void {
  if (!pane || line === undefined) return;
  const el = pane.querySelector(`[data-line="${line}"]`);
  if (!el) return;
  const box = pane.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top >= box.top && r.bottom <= box.bottom) return;
  const top = pane.scrollTop + (r.top - box.top) - (box.height - r.height) / 2;
  if (typeof pane.scrollTo === 'function') pane.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  else pane.scrollTop = top;
}
