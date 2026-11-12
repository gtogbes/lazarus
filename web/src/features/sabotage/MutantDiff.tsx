import { DIFF_ADDED_BACKGROUND, DIFF_REMOVED_BACKGROUND, GUTTER_COLOR } from '../program/theme';
import type { DiffLine, MutantInfo } from '../program/types';

const LINE_STYLE: Record<DiffLine['kind'], { background?: string; marker: string; label: string }> = {
  context: { marker: ' ', label: 'Unchanged' },
  removed: { background: DIFF_REMOVED_BACKGROUND, marker: '-', label: 'Removed' },
  added: { background: DIFF_ADDED_BACKGROUND, marker: '+', label: 'Added' },
};

interface MutantDiffProps {
  readonly mutant: MutantInfo;
  readonly portPath: string;
  readonly background: string;
  readonly foreground: string;
}

/**
 * Requirement 4.3: the mutant's changed lines against the real port, unified-diff
 * style. Removed and added lines carry a `-`/`+` marker and a screen-reader label,
 * so colour is never the only cue.
 */
export function MutantDiff({ mutant, portPath, background, foreground }: MutantDiffProps) {
  const headingId = `diff-${mutant.id}`;
  return (
    <div className="mt-3">
      <h4 id={headingId} className="text-sm font-semibold">
        Changes against the real port{' '}
        <span className="font-mono font-normal text-zinc-300">
          {portPath} → {mutant.path}
        </span>
      </h4>
      <p className="mt-1 text-xs text-zinc-300">
        Lines marked − are the real port, lines marked + are the mutant. Line numbers are real port, then mutant.
      </p>
      {/* Focusable so keyboard users can scroll long lines. */}
      <div
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        className="mt-2 max-h-[50vh] overflow-auto rounded border border-zinc-800"
        style={{ background, color: foreground }}
        data-testid="mutant-diff"
      >
        <pre className="py-2 font-mono text-sm leading-6">
          <code className="block w-max min-w-full">
            {mutant.hunks.map((hunk, h) => (
              <span key={h} className="block">
                {h > 0 && (
                  <span className="block select-none px-4" style={{ color: GUTTER_COLOR }}>
                    ⋯
                  </span>
                )}
                {hunk.lines.map((line, i) => (
                  <DiffRow key={i} line={line} />
                ))}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

function DiffRow({ line }: { readonly line: DiffLine }) {
  const style = LINE_STYLE[line.kind];
  return (
    <span className="flex pr-4" style={style.background ? { background: style.background } : undefined} data-kind={line.kind}>
      <span aria-hidden="true" className="w-10 shrink-0 select-none pr-2 text-right" style={{ color: GUTTER_COLOR }}>
        {line.kind === 'added' ? '' : line.real}
      </span>
      <span aria-hidden="true" className="w-10 shrink-0 select-none pr-2 text-right" style={{ color: GUTTER_COLOR }}>
        {line.kind === 'removed' ? '' : line.mutant}
      </span>
      <span aria-hidden="true" className="w-6 shrink-0 select-none text-center font-bold">
        {style.marker}
      </span>
      {line.kind !== 'context' && <span className="sr-only">{style.label}: </span>}
      <span>
        {line.tokens.length === 0
          ? ' '
          : line.tokens.map(([text, color], i) => (
              <span key={i} style={{ color }}>
                {text}
              </span>
            ))}
      </span>
    </span>
  );
}
