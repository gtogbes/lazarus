import { useShallow } from 'zustand/react/shallow';
import type { Counterexample } from '../../../../src/harness/equivalence.types';
import type { ProgramLayout } from '../../../../src/semantics/layout';
import type { ProgramSource } from '../program/types';
import { caseCount, COUNT_FORMAT } from '../proof/proofMessages';
import { useProofRun } from '../proof/useProofRun';
import { AutopsyDiff } from './AutopsyDiff';
import { DigitInspector } from './DigitInspector';
import { layoutFor } from './layouts';
import { RecordTables } from './RecordTables';
import { ShrinkViewer } from './ShrinkViewer';
import { ReplayCommand } from './ReplayCommand';
import { replayCommand } from './replay';

/**
 * Requirements 5 and 9: explains a divergence. Order (graphical-proof design):
 * Autopsy, Digit inspector, Shrink viewer, the record tables in a `details`,
 * replay command. Shown only for a relapsed run of this program. The cause is
 * for the run's mutant (`mutant` in the store), not the current sabotage
 * selection.
 */
export interface CounterexampleCardProps {
  readonly source: ProgramSource;
  /** Demo_Mode: the digit inspector's field. */
  readonly inspectField?: string | undefined;
  /** Demo_Mode: a new key restarts the Shrink viewer from its first step. */
  readonly shrinkKey?: string | undefined;
}

export function CounterexampleCard({ source, inspectField, shrinkKey }: CounterexampleCardProps) {
  const { status, program, mutant, result } = useProofRun(
    useShallow((s) => ({ status: s.status, program: s.program, mutant: s.mutant, result: s.result })),
  );
  if (status !== 'relapsed' || program !== source.id || !result) return null;
  const counterexample = result.counterexample;
  const layout = layoutFor(source.id);
  const mutantInfo = mutant === null ? undefined : source.mutants.find((m) => m.id === mutant);
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
      <AutopsyDiff counterexample={counterexample} layout={layout} mutant={mutant} mutantInfo={mutantInfo} />
      <DigitInspector counterexample={counterexample} layout={layout?.output} preferredField={inspectField} />
      {layout && <ShrinkViewer key={shrinkKey} path={result.shrinkPath} layout={layout.input} counterexample={counterexample} />}
      {counterexample && layout && <RecordDetails counterexample={counterexample} layout={layout} />}
      <h3 className="mt-4 font-semibold">Replay it locally</h3>
      <p className="mt-1 text-sm" data-testid="shrink-summary">
        Found after {caseCount(result.cases)} and shrunk in {COUNT_FORMAT.format(result.shrinks)}{' '}
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

/** The field-by-field tables and the raw records, folded away below the Autopsy. */
function RecordDetails({ counterexample: c, layout }: { counterexample: Counterexample; layout: ProgramLayout }) {
  const position = `${c.line + 1} of ${c.records.length}`;
  const cobol = c.cobol[c.line];
  const port = c.port[c.line];
  return (
    <>
      <details className="mt-4 text-sm" data-testid="record-tables">
        <summary className="cursor-pointer rounded font-semibold focus-visible:outline-2 focus-visible:outline-amber-300">
          Records field by field
        </summary>
        <RecordTables layout={layout} position={position} input={c.records[c.line]} cobol={cobol} port={port} />
      </details>
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
