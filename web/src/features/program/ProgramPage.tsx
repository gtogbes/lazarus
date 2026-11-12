import { Suspense, use } from 'react';
import { Link, useParams } from 'react-router';
// Fast-check-free metadata. Never import src/ports/registry.ts into the web bundle.
import { PROGRAM_META } from '../../../../src/ports/programs.meta';
import { NotFoundPage } from '../../app/NotFoundPage';
import { PANEL } from '../../app/surface';
import { CounterexampleCard } from '../counterexample/CounterexampleCard';
import { ProvePanel } from '../proof/ProvePanel';
import { SabotagePanel } from '../sabotage/SabotagePanel';
import { loadProgramSource } from './loadProgramSource';
import { SourcePanes } from './SourcePanes';

/** Requirement 2: the program's COBOL beside its TypeScript port. Unknown ids get the not-found page. */
export function ProgramPage() {
  const { id } = useParams();
  const program = PROGRAM_META.find((p) => p.id === id);
  if (!program) return <NotFoundPage />;
  return (
    <section aria-labelledby="program-title" className={`${PANEL} p-4 sm:p-6`}>
      <p className="text-sm">
        <Link to="/morgue" className="text-amber-300 underline underline-offset-4">
          Back to the morgue
        </Link>
      </p>
      <h1 id="program-title" className="mt-2 font-mono text-2xl font-semibold">
        {program.id}
      </h1>
      <p className="mt-1 text-zinc-300">{program.description}</p>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-300" data-testid="program-summary">
        {program.summary}
      </p>
      {/* Outside the Suspense boundary: a proof can start while the sources still load. */}
      <ProvePanel programId={program.id} />
      <Suspense fallback={<p className="mt-6 text-zinc-300">Exhuming the sources…</p>}>
        <ProgramSources id={program.id} />
      </Suspense>
    </section>
  );
}

function ProgramSources({ id }: { readonly id: string }) {
  const source = use(loadProgramSource(id));
  return (
    <>
      {/* Right after the Prove panel, so the divergence sits next to the Relapsed status. */}
      <CounterexampleCard source={source} />
      <SabotagePanel source={source} />
      <SourcePanes source={source} />
    </>
  );
}
