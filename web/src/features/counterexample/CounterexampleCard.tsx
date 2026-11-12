import { useShallow } from 'zustand/react/shallow';
import type { Counterexample } from '../../../../src/harness/equivalence.types';
import { decodeRecord, type ProgramLayout } from '../../../../src/semantics/layout';
import type { ProgramSource } from '../program/types';
import { COUNT_FORMAT } from '../proof/proofMessages';
import { useProofRun } from '../proof/useProofRun';
import { layoutFor } from './layouts';
import { RecordTables } from './RecordTables';
import { ReplayCommand } from './ReplayCommand';
import { replayCommand } from './replay';

/**
 * Requirement 5: explains a divergence field by field. Shown only for a
 * relapsed run of this program. The explanation is for the run's mutant
 * (`mutant` in the store), not the current sabotage selection.
 */
export function CounterexampleCard({ source }: { readonly source: ProgramSource }) {
  const { status, program, mutant, result } = useProofRun(
    useShallow((s) => ({ status: s.status, program: s.program, mutant: s.mutant, result: s.result })),
  );
  if (status !== 'relapsed' || program !== source.id || !result) return null;
  const counterexample = result.counterexample;
  const layout = layoutFor(source.id);
  const mutantInfo = mutant === null ? null : source.mutants.find((m) => m.id === mutant);
  const replay = replayCommand({ program: source.id, mutant, seed: result.seed, cases: result.cases });

  return (
    <section
      aria-labelledby="counterexample-title"
      className="mt-6 rounded border border-red-300 bg-zinc-900 p-4"
      data-testid="counterexample-card"
    >
      <h2 id="counterexample-title" className="text-lg font-semibold">
        Counterexample
      </h2>
      {counterexample && layout ? (
        <Divergence counterexample={counterexample} layout={layout} />
      ) : (
        <p className="mt-1 text-sm text-zinc-300">This run did not record the records that differ.</p>
      )}

      <h3 className="mt-4 font-semibold">Why it diverged</h3>
      {mutant === null ? (
        <p className="mt-1 max-w-prose text-sm">No sabotage was planted: the real port differs from COBOL here.</p>
      ) : mutantInfo ? (
        <div className="mt-1 max-w-prose text-sm" data-testid="counterexample-mutant">
          <p className="font-semibold">Sabotage: {mutantInfo.title}</p>
          <p className="mt-1 text-zinc-300">
            Breaks <code className="font-mono text-zinc-100">{mutantInfo.rule}</code>
          </p>
          <p className="mt-1">{mutantInfo.explanation}</p>
        </div>
      ) : (
        <p className="mt-1 text-sm">
          Sabotage: mutant <code className="font-mono">{mutant}</code>.
        </p>
      )}

      <h3 className="mt-4 font-semibold">Replay it locally</h3>
      <p className="mt-1 text-sm" data-testid="shrink-summary">
        Found after {COUNT_FORMAT.format(result.cases)} cases and shrunk in {COUNT_FORMAT.format(result.shrinks)}{' '}
        {result.shrinks === 1 ? 'step' : 'steps'}. Seed <code className="font-mono">{result.seed}</code>.
      </p>
      {result.truncated && (
        <p className="mt-1 max-w-prose text-sm text-amber-200">
          The 25 s limit stopped shrinking early, so the replay may shrink to a smaller counterexample.
        </p>
      )}
      <ReplayCommand result={replay} />
    </section>
  );
}

function Divergence({ counterexample: c, layout }: { counterexample: Counterexample; layout: ProgramLayout }) {
  const position = `${c.line + 1} of ${c.records.length}`;
  const cobol = c.cobol[c.line];
  const port = c.port[c.line];
  const lengthOff = [cobol, port].some((r) => r !== undefined && !decodeRecord(layout.output, r).lengthMatches);
  return (
    <>
      <p className="mt-1 text-sm" data-testid="counterexample-position">
        Record {position} is the first that differs, at column {c.column + 1}.
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
      <RecordTables layout={layout} position={position} input={c.records[c.line]} cobol={cobol} port={port} />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-amber-300">
          Raw records
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono">
          <dt className="text-zinc-300">Input</dt>
          <dd className="whitespace-pre">{JSON.stringify(c.records[c.line] ?? null)}</dd>
          <dt className="text-zinc-300">COBOL</dt>
          <dd className="whitespace-pre">{JSON.stringify(cobol ?? null)}</dd>
          <dt className="text-zinc-300">Port</dt>
          <dd className="whitespace-pre">{JSON.stringify(port ?? null)}</dd>
        </dl>
      </details>
    </>
  );
}
