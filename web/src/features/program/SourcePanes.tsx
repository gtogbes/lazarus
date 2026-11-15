import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { fieldCaption, FieldStitches, scrollLineIntoPane, type StitchPane } from '../stitches/FieldStitches';
import { StitchOverlay } from '../stitches/StitchOverlay';
import { CobolPane, PortPane, type FieldMarks } from './CodePane';
import type { LineRange, ProgramSource } from './types';

/** Requirement 2.3: below this width the panes stack behind a switch. */
export const SIDE_BY_SIDE_QUERY = '(min-width: 900px)';

type PaneId = StitchPane;
const PANES: readonly { id: PaneId; label: string }[] = [
  { id: 'cobol', label: 'COBOL' },
  { id: 'port', label: 'TypeScript port' },
];

function lines(range: LineRange): string {
  return range.start === range.end ? `line ${range.start}` : `lines ${range.start}–${range.end}`;
}

interface SourcePanesProps {
  readonly source: ProgramSource;
  /** Demo_Mode: select this field's stitch (COBOL data name) and bring both lines into view. */
  readonly focusField?: string | null;
  /** Demo_Mode: activate the statement link at this index of `source.links`. */
  readonly focusStatement?: number | null;
}

export function SourcePanes({ source, focusField = null, focusStatement = null }: SourcePanesProps) {
  const sideBySide = useMediaQuery(SIDE_BY_SIDE_QUERY, true);
  const [pane, setPane] = useState<PaneId>('cobol');
  const [activeLink, setActiveLink] = useState<number | null>(null);
  const [revealRequest, setRevealRequest] = useState(0);
  const highlightRef = useRef<HTMLElement>(null);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // Field stitches (Requirement 6): the listbox selection, a pointer hover, and a "Show in …" focus request.
  const [selectedField, setSelectedField] = useState<number | null>(null);
  const [hoverFieldIndex, setHoverFieldIndex] = useState<number | null>(null);
  const [lineFocus, setLineFocus] = useState<{ pane: PaneId; line: number } | null>(null);
  // The caption describes whichever of the statement link and the field the user touched last.
  const [captionFor, setCaptionFor] = useState<'link' | 'field'>('link');
  const cobolPaneRef = useRef<HTMLDivElement>(null);
  const portPaneRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<PaneId, HTMLButtonElement | null>>>({});
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const active = activeLink === null ? undefined : source.links[activeLink];

  // Keep the highlighted COBOL in view inside its scrolling pane.
  useEffect(() => {
    highlightRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeLink]);

  // Enter or click on a port statement: when stacked, switch to the COBOL pane and move focus there.
  useEffect(() => {
    if (revealRequest === 0 || sideBySide) return;
    highlightRef.current?.focus();
  }, [revealRequest, sideBySide]);

  const activeFieldIndex = hoverFieldIndex ?? selectedField;
  const activeField = activeFieldIndex === null ? undefined : source.fields[activeFieldIndex];
  const selected = selectedField === null ? undefined : source.fields[selectedField];
  const captionField = activeField && (captionFor === 'field' || !active) ? activeField : undefined;

  // Stable: the memoised code lines take it as a prop.
  const activateLink = useCallback((index: number) => {
    setActiveLink(index);
    setCaptionFor('link');
  }, []);
  const selectField = useCallback((index: number | null) => {
    setSelectedField(index);
    if (index !== null) setCaptionFor('field');
  }, []);
  // Pointer on a field line or option. Hover never scrolls a pane: only Enter or a click does (revealField),
  // so a hovered field's stitch is drawn only when both of its lines are already in view.
  const hoverField = useCallback((index: number | null) => {
    setHoverFieldIndex(index);
    if (index !== null) setCaptionFor('field');
  }, []);
  const fieldLines = useMemo(() => {
    const cobol = new Map<number, number>();
    const port = new Map<number, number>();
    source.fields.forEach((f, i) => {
      if (!cobol.has(f.cobolLine)) cobol.set(f.cobolLine, i);
      const primary = f.portLines[0];
      if (primary !== undefined && !port.has(primary)) port.set(primary, i);
    });
    return { cobol, port };
  }, [source.fields]);
  const cobolMarks = useMemo<FieldMarks>(
    () => ({
      byLine: fieldLines.cobol,
      activeLine: activeField?.cobolLine ?? null,
      focusLine: selected?.cobolLine ?? null,
      onHover: hoverField,
    }),
    [fieldLines, activeField, selected, hoverField],
  );
  const portMarks = useMemo<FieldMarks>(
    () => ({
      byLine: fieldLines.port,
      activeLine: activeField?.portLines[0] ?? null,
      focusLine: selected?.portLines[0] ?? null,
      onHover: hoverField,
    }),
    [fieldLines, activeField, selected, hoverField],
  );

  // "Show in COBOL / port" (stacked): after the tab switch renders, focus the line, or the statement button holding it.
  useEffect(() => {
    if (!lineFocus) return;
    const pane = (lineFocus.pane === 'cobol' ? cobolPaneRef : portPaneRef).current;
    const line = pane?.querySelector<HTMLElement>(`[data-line="${lineFocus.line}"]`);
    (line?.closest<HTMLElement>('button') ?? line)?.focus();
  }, [lineFocus]);

  // Demo cues (graphical-proof Requirement 11.2): the same state a user's selection sets.
  useEffect(() => {
    if (focusField === null) return;
    const index = source.fields.findIndex((f) => f.name === focusField);
    if (index < 0) return;
    setHoverFieldIndex(null);
    selectField(index);
    revealField(index);
    // Only a new cue moves the panes.
  }, [focusField, source.fields]);
  useEffect(() => {
    const link = focusStatement === null ? undefined : source.links[focusStatement];
    if (focusStatement === null || !link) return;
    setHoverFieldIndex(null);
    setSelectedField(null);
    activateLink(focusStatement);
    if (sideBySide) scrollLineIntoPane(portPaneRef.current, link.port.start, !reducedMotion);
  }, [focusStatement, source.links]);

  function revealField(index: number) {
    const field = source.fields[index];
    if (!field || !sideBySide) return;
    scrollLineIntoPane(cobolPaneRef.current, field.cobolLine, !reducedMotion);
    scrollLineIntoPane(portPaneRef.current, field.portLines[0], !reducedMotion);
  }

  function showField(target: PaneId, index: number) {
    const field = source.fields[index];
    const line = target === 'cobol' ? field?.cobolLine : field?.portLines[0];
    if (line === undefined) return;
    selectField(index);
    setPane(target);
    setLineFocus({ pane: target, line });
  }

  function reveal(index: number) {
    activateLink(index);
    if (!sideBySide) setPane('cobol');
    setRevealRequest((n) => n + 1);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const current = PANES.findIndex((p) => p.id === pane);
    const target = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: PANES.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = PANES[(target + PANES.length) % PANES.length];
    if (!next) return;
    setPane(next.id);
    tabRefs.current[next.id]?.focus();
  }

  const frame = { background: source.background, foreground: source.foreground };
  const panels = {
    cobol: (
      <CobolPane
        {...frame}
        headingId={`${baseId}-cobol`}
        file={source.cobol}
        highlight={active?.cobol ?? null}
        highlightRef={highlightRef}
        paneRef={cobolPaneRef}
        marks={cobolMarks}
      />
    ),
    port: (
      <PortPane
        {...frame}
        headingId={`${baseId}-port`}
        file={source.port}
        links={source.links}
        activeLink={activeLink}
        hintId={hintId}
        onActivate={activateLink}
        onReveal={reveal}
        paneRef={portPaneRef}
        marks={portMarks}
      />
    ),
  };

  return (
    <div className="mt-6" data-testid="source-panes">
      <p id={hintId} className="sr-only">
        Highlights the COBOL statement quoted in this code&apos;s comment. Press Enter to show it.
      </p>
      <p className="mb-4 min-h-6 text-sm text-zinc-300" data-testid="link-caption">
        {captionField
          ? fieldCaption(captionField)
          : active
            ? `COBOL ${lines(active.cobol)} highlighted for port ${lines(active.port)}: ${active.quote}`
            : 'Focus or point at a port statement with a COBOL comment to highlight the COBOL it translates.'}
      </p>
      <FieldStitches
        source={source}
        selected={selectedField}
        active={activeFieldIndex}
        stacked={!sideBySide}
        onSelect={selectField}
        onHover={hoverField}
        onReveal={revealField}
        onShow={showField}
      />
      {sideBySide ? (
        <div className="relative grid grid-cols-2 gap-4">
          {panels.cobol}
          {panels.port}
          <StitchOverlay
            source={source}
            activeField={activeFieldIndex}
            activeLink={activeLink}
            cobolPane={cobolPaneRef}
            portPane={portPaneRef}
          />
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Source" className="mb-3 flex gap-2">
            {PANES.map((p) => (
              <button
                key={p.id}
                ref={(el) => {
                  tabRefs.current[p.id] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${p.id}`}
                aria-controls={`${baseId}-panel-${p.id}`}
                aria-selected={pane === p.id}
                tabIndex={pane === p.id ? 0 : -1}
                onClick={() => {
                  setPane(p.id);
                }}
                onKeyDown={onTabKeyDown}
                className={`rounded border px-3 py-1.5 text-sm ${
                  pane === p.id ? 'border-amber-300 bg-zinc-800 text-zinc-100' : 'border-zinc-700 text-zinc-300 hover:text-zinc-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {PANES.map((p) => (
            <div
              key={p.id}
              role="tabpanel"
              id={`${baseId}-panel-${p.id}`}
              aria-labelledby={`${baseId}-tab-${p.id}`}
              hidden={pane !== p.id}
            >
              {panels[p.id]}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
