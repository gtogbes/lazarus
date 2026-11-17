import { summaryExcerpt } from './summaryExcerpt';

interface ProgramSummaryProps {
  readonly summary: string;
  readonly className?: string;
}

/**
 * A program's plain-English summary: the first sentence (or about 140 characters),
 * then the rest behind a native <details> "Read more", which is keyboard operable
 * and announces its expanded state without any script. The split is computed from
 * static text, so nothing moves on load; only opening it grows the card.
 */
export function ProgramSummary({ summary, className = '' }: ProgramSummaryProps) {
  const { lead, rest } = summaryExcerpt(summary);
  return (
    <div className={`text-sm leading-relaxed text-zinc-300 ${className}`} data-testid="program-summary">
      <p data-testid="program-summary-lead">{lead}</p>
      {rest !== '' && (
        <details className="group">
          {/* relative z-10 lifts it above a morgue card's full-card link overlay, so a click toggles it. */}
          <summary className="relative z-10 mt-1 w-fit cursor-pointer rounded text-amber-300 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
            <span className="group-open:hidden">Read more</span>
            <span className="hidden group-open:inline">Show less</span>
          </summary>
          <p className="mt-1" data-testid="program-summary-rest">
            {rest}
          </p>
        </details>
      )}
    </div>
  );
}
