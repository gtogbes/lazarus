import type { ReactNode } from 'react';
import {
  compareRecords,
  decodeRecord,
  type DecodedField,
  type ProgramLayout,
} from '../../../../src/semantics/layout';

/** Alphanumeric values are quoted so leading and trailing spaces show. */
function display(field: DecodedField, numeric: boolean): string {
  if (!field.valid) return JSON.stringify(field.raw);
  return numeric ? field.value : JSON.stringify(field.value);
}

function Value({ field, numeric, missing }: { field: DecodedField; numeric: boolean; missing: boolean }) {
  if (missing) return <span className="text-zinc-300">(no record)</span>;
  return (
    <>
      <span className="font-mono whitespace-pre">{display(field, numeric)}</span>
      {!field.valid && <span className="ml-2 text-xs text-amber-200">(does not fit the PIC)</span>}
    </>
  );
}

const TH = 'border-b border-zinc-700 px-3 py-1.5 text-left font-semibold text-zinc-100';
const TD = 'border-b border-zinc-800 px-3 py-1.5 align-top';

/** Wide tables scroll inside a focusable region, so keyboard users can scroll them too. */
function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="mt-3 overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-amber-300"
    >
      {children}
    </div>
  );
}

const isNumeric = (layout: ProgramLayout['input' | 'output'], i: number) => layout.fields[i]?.type.kind === 'numeric';

interface RecordTablesProps {
  readonly layout: ProgramLayout;
  /** 1-based record number and the record count, for captions. */
  readonly position: string;
  readonly input: string | undefined;
  readonly cobol: string | undefined;
  readonly port: string | undefined;
}

/** Requirement 5.1-5.2: the input record and both outputs, field by field, differences marked in text. */
export function RecordTables({ layout, position, input, cobol, port }: RecordTablesProps) {
  const inputFields = decodeRecord(layout.input, input ?? '').fields;
  const rows = compareRecords(layout.output, cobol ?? '', port ?? '')
    .map((row, i) => ({ ...row, numeric: isNumeric(layout.output, i), key: `${row.name}-${i}` }))
    // FILLER separators only matter when they differ.
    .filter((row) => row.name !== 'FILLER' || row.differs);
  const differing = rows.filter((row) => row.differs).length;

  return (
    <>
      <Scroll label="Input record">
        <table className="w-full border-collapse text-sm">
          <caption className="text-left font-semibold">
            Input record {position} ({layout.input.name})
          </caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Field</th>
              <th scope="col" className={TH}>PIC</th>
              <th scope="col" className={TH}>Value</th>
            </tr>
          </thead>
          <tbody>
            {inputFields.map((field, i) => (
              <tr key={`${field.name}-${i}`}>
                <th scope="row" className={`${TD} text-left font-mono font-normal`}>{field.name}</th>
                <td className={`${TD} font-mono text-zinc-300`}>{field.picture}</td>
                <td className={TD}>
                  <Value field={field} numeric={isNumeric(layout.input, i)} missing={input === undefined} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
      <Scroll label="Output records">
        <table className="w-full border-collapse text-sm">
          <caption className="text-left font-semibold">
            Output record {position} ({layout.output.name}): COBOL against the port, {differing}{' '}
            {differing === 1 ? 'field differs' : 'fields differ'}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Field</th>
              <th scope="col" className={TH}>PIC</th>
              <th scope="col" className={TH}>COBOL</th>
              <th scope="col" className={TH}>Port</th>
              <th scope="col" className={TH}>Match</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} data-differs={row.differs} className={row.differs ? 'bg-red-950' : undefined}>
                <th scope="row" className={`${TD} text-left font-mono font-normal`}>{row.name}</th>
                <td className={`${TD} font-mono text-zinc-300`}>{row.picture}</td>
                <td className={TD}>
                  <Value field={row.cobol} numeric={row.numeric} missing={cobol === undefined} />
                </td>
                <td className={TD}>
                  <Value field={row.port} numeric={row.numeric} missing={port === undefined} />
                </td>
                <td className={TD}>
                  {row.differs ? (
                    <strong className="text-red-200">
                      <span aria-hidden="true">≠ </span>Differs
                    </strong>
                  ) : (
                    <span className="text-zinc-300">Same</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </>
  );
}
