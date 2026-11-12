import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { CobolPane, PortPane } from './CodePane';
import type { LineRange, ProgramSource } from './types';

/** Requirement 2.3: below this width the panes stack behind a switch. */
export const SIDE_BY_SIDE_QUERY = '(min-width: 900px)';

type PaneId = 'cobol' | 'port';
const PANES: readonly { id: PaneId; label: string }[] = [
  { id: 'cobol', label: 'COBOL' },
  { id: 'port', label: 'TypeScript port' },
];

function lines(range: LineRange): string {
  return range.start === range.end ? `line ${range.start}` : `lines ${range.start}–${range.end}`;
}

export function SourcePanes({ source }: { readonly source: ProgramSource }) {
  const sideBySide = useMediaQuery(SIDE_BY_SIDE_QUERY, true);
  const [pane, setPane] = useState<PaneId>('cobol');
  const [activeLink, setActiveLink] = useState<number | null>(null);
  const [revealRequest, setRevealRequest] = useState(0);
  const highlightRef = useRef<HTMLElement>(null);
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

  function reveal(index: number) {
    setActiveLink(index);
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
        onActivate={setActiveLink}
        onReveal={reveal}
      />
    ),
  };

  return (
    <div className="mt-6">
      <p id={hintId} className="sr-only">
        Highlights the COBOL statement quoted in this code&apos;s comment. Press Enter to show it.
      </p>
      <p className="mb-4 min-h-6 text-sm text-zinc-300" data-testid="link-caption">
        {active
          ? `COBOL ${lines(active.cobol)} highlighted for port ${lines(active.port)}: ${active.quote}`
          : 'Focus or point at a port statement with a COBOL comment to highlight the COBOL it translates.'}
      </p>
      {sideBySide ? (
        <div className="grid grid-cols-2 gap-4">
          {panels.cobol}
          {panels.port}
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
