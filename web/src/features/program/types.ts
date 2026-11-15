/** 1-based, inclusive line range. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** A port statement whose comment quotes a COBOL statement, and where that statement is. */
export interface StatementLink {
  /** The quote as written in the port comment, whitespace-collapsed. */
  readonly quote: string;
  readonly port: LineRange;
  readonly cobol: LineRange;
}

/** One highlighted token: text and its CSS colour. */
export type HighlightedToken = readonly [text: string, color: string];

export interface HighlightedFile {
  /** Path relative to the repository root, e.g. `cobol/programs/PAYROLL.cbl`. */
  readonly path: string;
  readonly lines: readonly (readonly HighlightedToken[])[];
}

/**
 * One line of a mutant diff. `real` and `mutant` are 1-based line numbers in the real
 * port file and the mutants file. Context lines carry the real port's tokens.
 */
export type DiffLine =
  | { readonly kind: 'context'; readonly real: number; readonly mutant: number; readonly tokens: readonly HighlightedToken[] }
  | { readonly kind: 'removed'; readonly real: number; readonly tokens: readonly HighlightedToken[] }
  | { readonly kind: 'added'; readonly mutant: number; readonly tokens: readonly HighlightedToken[] };
/** A run of changed lines with up to 3 unchanged lines either side. */
export interface DiffHunk {
  readonly lines: readonly DiffLine[];
}
/** A mutant's metadata (from `src/ports/<prog>.mutants.ts`) and its diff against `processRecord`. */
export interface MutantInfo {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly rule: string;
  /** Present only when no input can expose the mutant: the reason why. */
  readonly equivalent?: string;
  /** The mutants file, relative to the repository root. */
  readonly path: string;
  /** Never empty: the build fails on a mutant identical to the real port. */
  readonly hunks: readonly DiffHunk[];
}
/**
 * One COBOL data item and the port code that represents it (Requirement 6.1).
 * Built and checked by `web/build/fieldLinks.ts`.
 */
export interface FieldLink {
  /** COBOL data name, e.g. `OUT-GROSS`. */
  readonly name: string;
  readonly section: 'input' | 'output' | 'working';
  /** PIC as written, without any VALUE clause, e.g. `9(5)V99` or `9(5)V99 COMP-3`. */
  readonly picture: string;
  /** 1-based line of the item in the COBOL source. */
  readonly cobolLine: number;
  /** 1-based port lines: the primary one first (slice, array element or `PICS` entry), then uses. */
  readonly portLines: readonly number[];
  /** The port code at the primary line, e.g. `formatDisplay(gross, PICS.gross)`. */
  readonly portCode: string;
  /** The TypeScript representation, e.g. `bigint scaled by 100, 0.00 to 99999.99, unsigned`. */
  readonly representation: string;
  /** Record fields only: 0-based offset and width in characters. */
  readonly offset?: number;
  readonly length?: number;
}

/** Build output for one program view: both sources pre-highlighted, plus statement links. */
export interface ProgramSource {
  readonly id: string;
  /** Theme background and default text colour for the panes. */
  readonly background: string;
  readonly foreground: string;
  readonly cobol: HighlightedFile;
  readonly port: HighlightedFile;
  readonly links: readonly StatementLink[];
  /** Sabotage options (Requirement 4), in the order the mutants module lists them. */
  readonly mutants: readonly MutantInfo[];
  /** Field map for the stitch lines (Requirement 6.1), in COBOL source order. */
  readonly fields: readonly FieldLink[];
}
