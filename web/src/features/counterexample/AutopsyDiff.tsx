/**
 * The Autopsy diff (graphical-proof design, "AutopsyDiff.tsx"; Requirements 9.1-9.5, 9.9, 14.1).
 *
 * Shows the first differing output record twice, COBOL above the port, one
 * monospace character per column under a column ruler. Every differing column
 * is outlined and has a `^` under it, so the difference does not rest on
 * colour alone (9.2, 14.1). Below the grid: the differing columns in words,
 * one first-difference line per differing field (`firstDifference`, 9.5), and
 * the cause: the run's mutant explanation (9.3) or, for the real port, that
 * COBOL is the source of truth (9.4).
 *
 * Accessibility (14.4): the ruler and the `^` row repeat what the column list
 * says in words, so they are hidden from assistive technology. The COBOL and
 * port rows stay readable. The grid scrolls in a focusable region for long
 * records, as the record tables do.
 */
import type { Counterexample } from '../../../../src/harness/equivalence.types';
import { compareRecords, decodeRecord, type ProgramLayout, type RecordLayout } from '../../../../src/semantics/layout';
import type { MutantInfo } from '../program/types';
import { charDiff } from './charDiff';
import { firstDifference, type FirstDifference } from './fieldDifference';

/** Differing columns named in words before "and N more". */
const MAX_LISTED_COLUMNS = 8;

export const REAL_PORT_CAUSE =
  "The port's output differs from COBOL. The COBOL output is the source of truth, so the port is wrong here.";

interface AutopsyDiffProps {
  readonly counterexample: Counterexample | undefined;
  readonly layout: ProgramLayout | undefined;
  /** The run's mutant id (`null` for the real port). */
  readonly mutant: string | null;
  /** The run's mutant metadata, when the program source lists it. */
  readonly mutantInfo: MutantInfo | undefined;
}

export function AutopsyDiff({ counterexample: c, layout, mutant, mutantInfo }: AutopsyDiffProps) {
  return (
    <section aria-labelledby="autopsy-title" className="mt-3" data-testid="autopsy">
      <h3 id="autopsy-title" className="font-semibold">
        Autopsy
      </h3>
      {c && layout ? (
        <Records counterexample={c} layout={layout} />
      ) : (
        <p className="mt-1 text-sm text-zinc-300">This run did not record the records that differ.</p>
      )}
      <h3 className="mt-4 font-semibold">Why it diverged</h3>
      <Cause mutant={mutant} mutantInfo={mutantInfo} />
    </section>
  );
}

function Records({ counterexample: c, layout }: { counterexample: Counterexample; layout: ProgramLayout }) {
  const cobol = c.cobol[c.line];
  const port = c.port[c.line];
  const lengthOff = [cobol, port].some((r) => r !== undefined && !decodeRecord(layout.output, r).lengthMatches);
  return (
    <>
      <p className="mt-1 text-sm" data-testid="counterexample-position">
        Record {c.line + 1} of {c.records.length} is the first that differs, at column {c.column + 1}.
      </p>
      {c.cobol.length !== c.port.length && (
        <p className="mt-1 text-sm text-amber-200">
          COBOL wrote {c.cobol.length} records and the port wrote {c.port.length}.
        </p>
      )}
      {lengthOff && (
        <p className="mt-1 text-sm text-amber-200">
          An output record is not {layout.output.length} characters long. See the raw records below.
        </p>
      )}
      <CharGrid cobol={cobol ?? ''} port={port ?? ''} />
      <FieldLines layout={layout.output} cobol={cobol ?? ''} port={port ?? ''} />
    </>
  );
}

interface Cell {
  readonly cobol: string | undefined;
  readonly port: string | undefined;
  readonly differs: boolean;
}

function cells(cobol: string, port: string): Cell[] {
  return charDiff(cobol, port).flatMap((segment) => {
    const width = Math.max(segment.cobol.length, segment.port.length);
    return Array.from({ length: width }, (_, i) => ({
      cobol: segment.cobol[i],
      port: segment.port[i],
      differs: segment.kind !== 'same',
    }));
  });
}

/** Tens digits at columns 10, 20, ... and units digits for every column, 1-based. */
function ruler(width: number): { tens: string; units: string } {
  let tens = '';
  let units = '';
  for (let col = 1; col <= width; col++) {
    tens += col % 10 === 0 ? String(Math.floor(col / 10) % 10) : ' ';
    units += String(col % 10);
  }
  return { tens, units };
}

const LABEL = 'inline-block w-16 pr-2 text-zinc-300';

function CharGrid({ cobol, port }: { cobol: string; port: string }) {
  const row = cells(cobol, port);
  const { tens, units } = ruler(row.length);
  const differing = row.flatMap((cell, i) => (cell.differs ? [i] : []));
  const charCell = (char: string | undefined, differs: boolean, key: number) =>
    differs ? (
      <span key={key} className="bg-red-950 text-red-100 outline outline-1 -outline-offset-1 outline-red-300">
        {char === undefined ? ' ' : char === ' ' ? '␣' : char}
      </span>
    ) : (
      <span key={key}>{char}</span>
    );
  return (
    <>
      <div
        role="region"
        aria-label="COBOL and port output, character by character"
        tabIndex={0}
        className="mt-3 overflow-x-auto rounded border border-zinc-700 p-2 focus-visible:outline-2 focus-visible:outline-amber-300"
      >
        <pre className="font-mono text-sm leading-6 text-zinc-100" data-testid="autopsy-grid">
          <span aria-hidden="true" className="block text-zinc-400" data-testid="autopsy-ruler">
            <span className={LABEL}> </span>
            {tens}
            {'\n'}
            <span className={LABEL}>Column</span>
            {units}
          </span>
          <span className="block" data-testid="autopsy-cobol">
            <span className={LABEL}>COBOL</span>
            {row.map((cell, i) => charCell(cell.cobol, cell.differs, i))}
          </span>
          <span className="block" data-testid="autopsy-port">
            <span className={LABEL}>Port</span>
            {row.map((cell, i) => charCell(cell.port, cell.differs, i))}
          </span>
          <span aria-hidden="true" className="block font-bold text-red-200" data-testid="autopsy-markers">
            <span className={LABEL}> </span>
            {row.map((cell) => (cell.differs ? '^' : ' ')).join('')}
          </span>
        </pre>
      </div>
      <p className="mt-2 text-sm" data-testid="autopsy-columns">
        {columnSummary(row, differing)}
      </p>
    </>
  );
}

const quoted = (char: string | undefined) => (char === undefined ? 'nothing' : char === ' ' ? 'a space' : `"${char}"`);

function columnSummary(row: readonly Cell[], differing: readonly number[]): string {
  if (differing.length === 0) return 'The two records are the same, character for character.';
  const listed = differing
    .slice(0, MAX_LISTED_COLUMNS)
    .map((i) => `column ${i + 1} (COBOL ${quoted(row[i]!.cobol)}, port ${quoted(row[i]!.port)})`);
  const more = differing.length - listed.length;
  const noun = differing.length === 1 ? 'character differs' : 'characters differ';
  return `${differing.length} ${noun}: ${listed.join(', ')}${more > 0 ? `, and ${more} more` : ''}.`;
}

function describe(difference: FirstDifference): string {
  switch (difference.kind) {
    case 'sign':
      return 'the sign';
    case 'high-order':
      return 'the high-order digits (the leftmost integer digit)';
    case 'low-order':
      return `the low-order digits (the ${difference.place} place)`;
    case 'decimal-places':
      return `the decimal places (the ${difference.place} place)`;
    case 'text':
      return 'the text';
  }
}

function FieldLines({ layout, cobol, port }: { layout: RecordLayout; cobol: string; port: string }) {
  const lines = compareRecords(layout, cobol, port).flatMap((row, i) => {
    const difference = firstDifference(layout.fields[i]!, row.cobol.raw, row.port.raw);
    return difference ? [{ row, difference, key: `${row.name}-${i}` }] : [];
  });
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm" data-testid="autopsy-fields">
      {lines.map(({ row, difference, key }) => (
        <li key={key} data-field={row.name} data-kind={difference.kind}>
          <code className="font-mono font-semibold">{row.name}</code> first differs in {describe(difference)}: COBOL{' '}
          <code className="font-mono whitespace-pre">{row.cobol.value || '(empty)'}</code>, port{' '}
          <code className="font-mono whitespace-pre">{row.port.value || '(empty)'}</code>.
        </li>
      ))}
    </ul>
  );
}

function Cause({ mutant, mutantInfo }: { mutant: string | null; mutantInfo: MutantInfo | undefined }) {
  if (mutant === null) {
    return (
      <p className="mt-1 max-w-prose text-sm" data-testid="autopsy-cause">
        {REAL_PORT_CAUSE}
      </p>
    );
  }
  if (!mutantInfo) {
    return (
      <p className="mt-1 text-sm" data-testid="autopsy-cause">
        Sabotage: mutant <code className="font-mono">{mutant}</code>.
      </p>
    );
  }
  return (
    <div className="mt-1 max-w-prose text-sm" data-testid="counterexample-mutant">
      <p className="font-semibold">Sabotage: {mutantInfo.title}</p>
      <p className="mt-1 text-zinc-300">
        Breaks <code className="font-mono text-zinc-100">{mutantInfo.rule}</code>
      </p>
      <p className="mt-1">{mutantInfo.explanation}</p>
    </div>
  );
}
