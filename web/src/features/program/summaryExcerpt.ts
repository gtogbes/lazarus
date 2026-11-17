/** The longest first sentence shown whole before it is cut at a word instead. */
export const LEAD_MAX_SENTENCE = 160;
/** Where a too-long first sentence is cut, at the last space before it. */
export const LEAD_CUT = 140;

export interface SummaryExcerpt {
  /** Shown at all times. */
  readonly lead: string;
  /** Behind "Read more"; empty when the lead is the whole summary. */
  readonly rest: string;
}

/**
 * Split a program summary into a short lead and the rest. The lead is the first
 * sentence when that is at most LEAD_MAX_SENTENCE characters; otherwise the text
 * is cut at a word near LEAD_CUT, with an ellipsis on both sides of the cut.
 * Pure and deterministic, so the collapsed card has its final size on first paint.
 */
export function summaryExcerpt(summary: string): SummaryExcerpt {
  const text = summary.trim();
  // A full stop followed by whitespace ends a sentence; "12.5" and "1,000.00," do not.
  const end = text.search(/\.\s/);
  const sentence = end === -1 ? text : text.slice(0, end + 1);
  if (sentence.length <= LEAD_MAX_SENTENCE) {
    return { lead: sentence, rest: text.slice(sentence.length).trim() };
  }
  const space = text.lastIndexOf(' ', LEAD_CUT);
  const cut = space > 0 ? space : LEAD_CUT;
  return { lead: `${text.slice(0, cut).trimEnd()}…`, rest: `…${text.slice(cut).trimStart()}` };
}
