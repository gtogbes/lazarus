/**
 * The Digit inspector (graphical-proof design, "DigitInspector.tsx";
 * Requirements 9.6-9.9, 14.1, 14.2, 14.4).
 *
 * For the first differing output record, a radio group picks one of the
 * numeric fields that differ (the first by default). The field is drawn as
 * boxes from its PIC with `digitBoxes`: a sign box for a separate sign, one box
 * per integer digit, the decimal point, one box per decimal digit. COBOL is the
 * top row and the port the bottom row. Differing boxes get a thick outline and
 * a ✗, so the difference does not rest on colour alone (14.1).
 *
 * When the leftmost integer digit differs, a note says the field differs at its
 * high-order limit and how COBOL truncates (9.7). When either side does not fit
 * the PIC, both sides are drawn as raw characters and the card says which side
 * is not valid (9.8).
 *
 * Accessibility (14.4): the boxes are an HTML table with a caption, column
 * headers (place values) and row headers (COBOL, Port), so the table is its own
 * text alternative. Each ✗ has the hidden text "differs". No live region (14.6).
 */
import { useEffect, useId, useState } from 'react';
import type { Counterexample } from '../../../../src/harness/equivalence.types';
import type { Pic } from '../../../../src/semantics/decimal';
import { compareRecords, type FieldDifference, type RecordLayout } from '../../../../src/semantics/layout';
import { digitBoxes, type DigitBox } from './digitBoxes';

interface Candidate {
  readonly index: number;
  readonly pic: Pic;
  readonly row: FieldDifference;
}

export interface DigitInspectorProps {
  readonly counterexample: Counterexample | undefined;
  /** The output record layout. */
  readonly layout: RecordLayout | undefined;
  /** Field to show when it differs, e.g. `OUT-TAX` (Demo_Mode). A new value replaces the user's pick. */
  readonly preferredField?: string | undefined;
}

export function DigitInspector({ counterexample: c, layout, preferredField }: DigitInspectorProps) {
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const name = useId();
  useEffect(() => {
    if (preferredField !== undefined) setPicked(undefined);
  }, [preferredField]);
  if (!c || !layout) return null;
  const rows = compareRecords(layout, c.cobol[c.line] ?? '', c.port[c.line] ?? '');
  const candidates = rows.flatMap((row, index): Candidate[] => {
    const type = layout.fields[index]!.type;
    return type.kind === 'numeric' && row.differs ? [{ index, pic: type.pic, row }] : [];
  });
  const current =
    candidates.find((x) => x.index === picked) ?? candidates.find((x) => x.row.name === preferredField) ?? candidates[0];
  return (
    <section aria-labelledby="digit-inspector-title" className="mt-4" data-testid="digit-inspector">
      <h3 id="digit-inspector-title" className="font-semibold">
        Digit inspector
      </h3>
      {current ? (
        <>
          <fieldset className="mt-2">
            <legend className="text-sm text-zinc-300">Differing numeric field</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {candidates.map((x) => (
                <label
                  key={x.index}
                  className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded border border-zinc-500 px-3 text-sm has-checked:border-amber-300 has-checked:bg-amber-300/10"
                >
                  <input
                    type="radio"
                    name={name}
                    value={x.index}
                    checked={x === current}
                    onChange={() => setPicked(x.index)}
                    className="accent-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                  />
                  <code className="font-mono">{x.row.name}</code>
                  <span className="font-mono text-xs text-zinc-300">{shortPicture(x.row.picture)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <FieldBoxes candidate={current} />
        </>
      ) : (
        <NoNumericField rows={rows} />
      )}
    </section>
  );
}

/** "S9(5)V99 SIGN LEADING SEPARATE" shows as "S9(5)V99". */
const shortPicture = (picture: string) => picture.split(' ')[0]!;

function NoNumericField({ rows }: { rows: readonly FieldDifference[] }) {
  const text = rows.filter((r) => r.differs).map((r) => r.name);
  return (
    <p className="mt-1 max-w-prose text-sm text-zinc-300" data-testid="digit-none">
      No numeric field differs in this record, so there are no digits to inspect.
      {text.length > 0 && ` The difference is in the text of ${list(text)}.`}
    </p>
  );
}

/** "a", "a and b", "a, b and c". */
function list(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function FieldBoxes({ candidate: { pic, row } }: { candidate: Candidate }) {
  const cobol = digitBoxes(pic, row.cobol.raw);
  const port = digitBoxes(pic, row.port.raw);
  const picture = shortPicture(row.picture);
  if (!cobol.valid || !port.valid) {
    const invalid = [
      ...(cobol.valid ? [] : [`COBOL text ${JSON.stringify(row.cobol.raw)}`]),
      ...(port.valid ? [] : [`port text ${JSON.stringify(row.port.raw)}`]),
    ];
    return (
      <>
        <BoxTable
          caption={`${row.name}, PIC ${picture}, as raw characters: COBOL above, port below.`}
          headers={rawHeaders(Math.max(row.cobol.raw.length, row.port.raw.length))}
          cobol={rawCells(row.cobol.raw, row.port.raw)}
          port={rawCells(row.port.raw, row.cobol.raw)}
          form="invalid"
        />
        <p className="mt-2 max-w-prose text-sm text-amber-200" data-testid="digit-invalid">
          The {list(invalid)} {invalid.length === 1 ? 'is' : 'are'} not valid for PIC {picture}, so the field is shown
          as raw characters.
        </p>
      </>
    );
  }
  const differs = cobol.boxes.map((b, i) => b.char !== port.boxes[i]!.char);
  const leftmost = cobol.boxes.findIndex((b) => b.kind === 'int');
  const intDigits = cobol.boxes.filter((b) => b.kind === 'int').length;
  const named = cobol.boxes.flatMap((b, i) => (differs[i] ? [b.kind === 'sign' ? 'the sign' : `the ${b.place} digit`] : []));
  return (
    <>
      <BoxTable
        caption={`${row.name}, PIC ${picture}: COBOL above, port below. ${capitalise(list(named))} ${named.length === 1 ? 'differs' : 'differ'}.`}
        headers={cobol.boxes.map(header)}
        cobol={cobol.boxes.map((b, i) => ({ char: b.char, differs: differs[i]!, point: b.kind === 'point' }))}
        port={port.boxes.map((b, i) => ({ char: b.char, differs: differs[i]!, point: b.kind === 'point' }))}
        form="valid"
      />
      {leftmost >= 0 && differs[leftmost] && (
        <p className="mt-2 max-w-prose text-sm text-amber-200" data-testid="digit-high-order">
          <span aria-hidden="true">⚠ </span>
          {row.name} differs at its high-order limit, the leftmost of its {intDigits} integer{' '}
          {intDigits === 1 ? 'digit' : 'digits'}. COBOL drops digits on the left of a value too large for the PIC
          unless ON SIZE ERROR is coded.
        </p>
      )}
    </>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Header {
  readonly visible: string;
  /** Read by assistive technology in place of `visible`, when set. */
  readonly spoken?: string;
}

function header(box: DigitBox): Header {
  switch (box.kind) {
    case 'sign':
      return { visible: 'sign' };
    case 'point':
      return { visible: '', spoken: 'decimal point' };
    default:
      return box.place ? { visible: box.place, spoken: `${box.place} place` } : { visible: '' };
  }
}

const rawHeaders = (n: number): Header[] =>
  Array.from({ length: n }, (_, i) => ({ visible: String(i + 1), spoken: `character ${i + 1}` }));

interface Cell {
  readonly char: string | undefined;
  readonly differs: boolean;
  readonly point?: boolean;
}

/** One cell per character, padded to the other side's length; a missing character differs. */
function rawCells(raw: string, other: string): Cell[] {
  return Array.from({ length: Math.max(raw.length, other.length) }, (_, i) => ({
    char: raw[i],
    differs: raw[i] !== other[i],
  }));
}

function BoxTable({
  caption,
  headers,
  cobol,
  port,
  form,
}: {
  caption: string;
  headers: readonly Header[];
  cobol: readonly Cell[];
  port: readonly Cell[];
  form: 'valid' | 'invalid';
}) {
  return (
    <div
      role="region"
      aria-label="Digit boxes"
      tabIndex={0}
      // `relative`: the header cells' sr-only spans are absolute; without it they escape this
      // scroll box and widen the page on a 390 px phone.
      className="relative mt-3 overflow-x-auto rounded border border-zinc-700 p-2 focus-visible:outline-2 focus-visible:outline-amber-300"
    >
      <table className="border-separate border-spacing-x-1 border-spacing-y-1.5" data-form={form} data-testid="digit-table">
        <caption className="mb-1 max-w-prose caption-top text-left text-sm">{caption}</caption>
        <thead>
          <tr>
            <td />
            {headers.map((h, i) => (
              <th key={i} scope="col" className="px-0.5 text-center font-mono text-xs font-normal text-zinc-300">
                {h.spoken ? (
                  <>
                    <span aria-hidden="true">{h.visible}</span>
                    <span className="sr-only">{h.spoken}</span>
                  </>
                ) : (
                  h.visible
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <BoxRow label="COBOL" cells={cobol} />
          <BoxRow label="Port" cells={port} />
        </tbody>
      </table>
    </div>
  );
}

function BoxRow({ label, cells }: { label: string; cells: readonly Cell[] }) {
  return (
    <tr>
      <th scope="row" className="pr-2 text-left text-sm font-normal text-zinc-300">
        {label}
      </th>
      {cells.map((cell, i) => (
        <td key={i} className="p-0 text-center" data-differs={cell.differs || undefined}>
          {cell.point ? (
            <span className="font-mono text-2xl leading-none font-bold">.</span>
          ) : (
            <span
              className={`relative mx-auto flex h-10 w-9 items-center justify-center rounded-sm border-2 font-mono text-lg whitespace-pre ${
                cell.differs ? 'border-red-300 bg-red-950 text-red-100' : 'border-zinc-500 text-zinc-100'
              }`}
            >
              {cell.char === undefined ? '' : cell.char === ' ' ? '␣' : cell.char}
              {cell.differs && (
                <>
                  <span
                    aria-hidden="true"
                    className="absolute -top-2 -right-2 rounded-full border border-red-300 bg-zinc-900 px-1 text-xs leading-4 text-red-200"
                  >
                    ✗
                  </span>
                  <span className="sr-only">, differs</span>
                </>
              )}
            </span>
          )}
        </td>
      ))}
    </tr>
  );
}
