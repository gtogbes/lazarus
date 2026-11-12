import type { LineRange, StatementLink } from '../src/features/program/types.ts';

/**
 * Statement linking (design: "Code panes"). A port quotes the COBOL it translates
 * in a whole-line `//` comment that starts with a COBOL verb:
 *
 *     // COMPUTE WS-NET = WS-GROSS - WS-TAX + IN-ADJUST
 *     const net = ...
 *
 * Each quote is paired with the first matching statement in the COBOL
 * PROCEDURE DIVISION, comparing whitespace-normalised, case-insensitive tokens.
 *
 * - Consecutive comment lines at the same indent continue the quote.
 * - `...` skips ahead: `EVALUATE TRUE ... END-EVALUATE` spans the whole EVALUATE.
 * - A trailing parenthetical in prose, such as `(truncated to the penny)`, is a note, not COBOL.
 *
 * A quote that matches nothing is a broken claim about the COBOL, so linking
 * fails with every broken quote listed rather than silently dropping it.
 */

/** Upper-case COBOL verbs that mark a comment as a quote. Prose comments do not start with these. */
const COBOL_VERBS = new Set([
  'ACCEPT', 'ADD', 'CALL', 'CLOSE', 'COMPUTE', 'CONTINUE', 'DISPLAY', 'DIVIDE', 'EVALUATE', 'EXIT',
  'GO', 'IF', 'INITIALIZE', 'INSPECT', 'MOVE', 'MULTIPLY', 'OPEN', 'PERFORM', 'READ', 'REWRITE',
  'SEARCH', 'SET', 'START', 'STOP', 'STRING', 'SUBTRACT', 'UNSTRING', 'WRITE',
]);

const WHOLE_LINE_COMMENT = /^(\s*)\/\/ ?(.*)$/;
/** A closing parenthetical that contains a lower-case word is a prose note. */
const TRAILING_NOTE = /\s*\([^()]*\b[a-z]{2,}\b[^()]*\)\s*$/;
const ELLIPSIS = /\s*(?:\.\.\.|…)\s*/;

export class StatementLinkError extends Error {
  constructor(
    readonly file: string,
    readonly problems: readonly string[],
  ) {
    super(`Statement linking failed for ${file}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'StatementLinkError';
  }
}

interface CobolToken {
  readonly text: string;
  readonly line: number;
}

/** COBOL separators: whitespace, and a comma or semicolon followed by a space. A separator period ends a statement. */
function tokenize(text: string): string[] {
  return text
    .replace(/[,;](?=\s|$)/g, ' ')
    .split(/\s+/)
    .map((token) => (token.length > 1 && token.endsWith('.') ? token.slice(0, -1) : token))
    .filter((token) => token !== '' && token !== '.')
    .map((token) => token.toUpperCase());
}

/** Tokens of the PROCEDURE DIVISION in fixed format: skips comment lines (indicator `*` or `/` in column 7). */
function procedureTokens(cobolSource: string): CobolToken[] | null {
  const lines = cobolSource.split(/\r?\n/);
  const tokens: CobolToken[] = [];
  let inProcedure = false;
  lines.forEach((raw, index) => {
    const indicator = raw[6];
    if (indicator === '*' || indicator === '/') return;
    const words = tokenize(raw.slice(7, 72));
    if (!inProcedure) {
      inProcedure = words[0] === 'PROCEDURE' && words[1] === 'DIVISION';
      return;
    }
    for (const text of words) tokens.push({ text, line: index + 1 });
  });
  return inProcedure ? tokens : null;
}

function indexOfRun(haystack: readonly CobolToken[], needle: readonly string[], from: number): number {
  outer: for (let i = from; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j]?.text !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

interface Quote {
  readonly text: string;
  readonly indent: number;
  /** 1-based line numbers of the comment block. */
  readonly start: number;
  readonly end: number;
}

function findQuotes(portLines: readonly string[]): Quote[] {
  const quotes: Quote[] = [];
  for (let i = 0; i < portLines.length; i++) {
    const match = WHOLE_LINE_COMMENT.exec(portLines[i] ?? '');
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    const firstWord = (match[2] ?? '').trim().split(/\s+/)[0] ?? '';
    // Later lines of a prose comment block are not quotes either; skip the whole block.
    let end = i;
    const parts = [match[2] ?? ''];
    while (end + 1 < portLines.length) {
      const next = WHOLE_LINE_COMMENT.exec(portLines[end + 1] ?? '');
      if (!next || (next[1]?.length ?? 0) !== indent) break;
      parts.push(next[2] ?? '');
      end++;
    }
    if (COBOL_VERBS.has(firstWord)) {
      quotes.push({ text: parts.join(' ').replace(/\s+/g, ' ').trim(), indent, start: i + 1, end: end + 1 });
    }
    i = end;
  }
  return quotes;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * The port statement a quote annotates: the comment block plus the code after it,
 * up to a blank line, a line indented less than the comment (a closing brace),
 * a comment at the same or lower indent, or the next quote.
 */
function portRange(portLines: readonly string[], quote: Quote, quoteStarts: ReadonlySet<number>): LineRange | null {
  let end = quote.end;
  for (let line = quote.end + 1; line <= portLines.length; line++) {
    const text = portLines[line - 1] ?? '';
    if (text.trim() === '' || quoteStarts.has(line) || indentOf(text) < quote.indent) break;
    if (WHOLE_LINE_COMMENT.test(text) && indentOf(text) <= quote.indent) break;
    end = line;
  }
  return end === quote.end ? null : { start: quote.start, end };
}

/**
 * Pairs every COBOL quote in `portSource` with its statement in `cobolSource`.
 * Line numbers are 1-based and inclusive. Throws `StatementLinkError` listing every broken quote.
 */
export function linkStatements(
  cobolSource: string,
  portSource: string,
  file = 'port',
): StatementLink[] {
  const tokens = procedureTokens(cobolSource);
  if (tokens === null) throw new StatementLinkError(file, ['the COBOL source has no PROCEDURE DIVISION']);

  const portLines = portSource.split(/\r?\n/);
  const quotes = findQuotes(portLines);
  const quoteStarts = new Set(quotes.map((q) => q.start));
  const links: StatementLink[] = [];
  const problems: string[] = [];

  for (const quote of quotes) {
    const where = `line ${quote.start} "${quote.text}"`;
    const segments = quote.text.replace(TRAILING_NOTE, '').split(ELLIPSIS).map(tokenize);
    if (segments.some((segment) => segment.length === 0)) {
      problems.push(`${where}: empty segment around "..."`);
      continue;
    }
    let from = 0;
    let first: CobolToken | undefined;
    let last: CobolToken | undefined;
    for (const segment of segments) {
      const at = indexOfRun(tokens, segment, from);
      if (at < 0) {
        first = undefined;
        problems.push(
          `${where}: no COBOL statement matches "${segment.join(' ')}"${from > 0 ? ' after the previous segment' : ''}`,
        );
        break;
      }
      first ??= tokens[at];
      from = at + segment.length;
      last = tokens[from - 1];
    }
    if (first === undefined || last === undefined) continue;

    const port = portRange(portLines, quote, quoteStarts);
    if (port === null) {
      problems.push(`${where}: the comment is not followed by any code`);
      continue;
    }
    links.push({ quote: quote.text, port, cobol: { start: first.line, end: last.line } });
  }

  if (problems.length > 0) throw new StatementLinkError(file, problems);
  return links;
}
