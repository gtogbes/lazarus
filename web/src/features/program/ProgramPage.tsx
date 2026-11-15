import { Suspense, use, useCallback, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
// Fast-check-free metadata. Never import src/ports/registry.ts into the web bundle.
import { PROGRAM_META } from '../../../../src/ports/programs.meta';
import { NotFoundPage } from '../../app/NotFoundPage';
import { PANEL } from '../../app/surface';
import { CounterexampleCard } from '../counterexample/CounterexampleCard';
import { DemoBar } from '../demo/DemoBar';
import { DEMO_PROGRAM } from '../demo/demoScript';
import { useDemo } from '../demo/useDemo';
import { ProvePanel } from '../proof/ProvePanel';
import { SabotagePanel } from '../sabotage/SabotagePanel';
import { VitalsPanel } from '../vitals/VitalsPanel';
import { loadProgramSource } from './loadProgramSource';
import { SourcePanes } from './SourcePanes';

/**
 * Requirement 2: the program's COBOL beside its TypeScript port. Unknown ids get the not-found page.
 *
 * graphical-proof Requirement 11: `?demo=1` (exactly, and only on the demo's program) mounts the
 * demo bar, which runs the demo. Exit stops it, drops `?demo` and focuses the heading (11.8). A live
 * Prove or Revive ends the demo first and keeps what is on screen; its own run replaces the replay.
 */
export function ProgramPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const program = PROGRAM_META.find((p) => p.id === id);
  const demo = program?.id === DEMO_PROGRAM && params.get('demo') === '1';

  const leaveDemo = useCallback(
    (keepProof: boolean) => {
      useDemo.getState().exit({ keepProof });
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete('demo');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const exitDemo = useCallback(() => {
    leaveDemo(false);
    headingRef.current?.focus();
  }, [leaveDemo]);
  const endDemoForLiveRun = useCallback(() => leaveDemo(true), [leaveDemo]);

  if (!program) return <NotFoundPage />;
  return (
    <section aria-labelledby="program-title" className={`${PANEL} p-4 sm:p-6`}>
      <p className="text-sm">
        <Link to="/morgue" className="text-amber-300 underline underline-offset-4">
          Back to the morgue
        </Link>
      </p>
      <h1 id="program-title" ref={headingRef} tabIndex={-1} className="mt-2 font-mono text-2xl font-semibold">
        {program.id}
      </h1>
      <p className="mt-1 text-zinc-300">{program.description}</p>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-300" data-testid="program-summary">
        {program.summary}
      </p>
      {/* Outside the Suspense boundary: a proof can start, and be watched, while the sources still load. */}
      <ProvePanel programId={program.id} {...(demo ? { onBeforeRun: endDemoForLiveRun } : {})} />
      <VitalsPanel programId={program.id} />
      <Suspense fallback={<p className="mt-6 text-zinc-300">Exhuming the sources…</p>}>
        <ProgramSources id={program.id} />
      </Suspense>
      {demo && <DemoBar onExit={exitDemo} />}
    </section>
  );
}

/** The step index from which the demo's Shrink viewer has been restarted for its own step. */
const SHRINK_STEP = useDemo.getState().script.findIndex((step) => step.cues.some(({ cue }) => cue.kind === 'shrink'));

function ProgramSources({ id }: { readonly id: string }) {
  const source = use(loadProgramSource(id));
  // Demo cues (graphical-proof Requirement 11.2), as plain values so only a new cue changes them.
  const cue = useDemo((s) => s.cue);
  const shrinkRestarted = useDemo((s) => SHRINK_STEP >= 0 && s.stepIndex >= SHRINK_STEP);
  return (
    <>
      {/* Right after the Prove panel, so the divergence sits next to the Relapsed status. */}
      <CounterexampleCard
        source={source}
        inspectField={cue?.kind === 'inspect' ? cue.field : undefined}
        shrinkKey={shrinkRestarted ? 'demo-shrink' : undefined}
      />
      <SabotagePanel source={source} />
      <SourcePanes
        source={source}
        focusField={cue?.kind === 'field' ? cue.name : null}
        focusStatement={cue?.kind === 'statement' ? cue.index : null}
      />
    </>
  );
}
