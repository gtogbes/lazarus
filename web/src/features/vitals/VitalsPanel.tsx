import { useShallow } from 'zustand/react/shallow';
import { useProofRun } from '../proof/useProofRun';
import { CaseGrid } from './CaseGrid';
import { Heartbeat } from './Heartbeat';
import { ResurrectionFill } from './ResurrectionFill';

/**
 * The Visuals' container, under the Prove panel (graphical-proof design, "VitalsPanel.tsx").
 *
 * Layout: the heartbeat across the full width, then the case grid beside the
 * resurrection fill, stacked under 900 px.
 *
 * Requirement 15.3: this component subscribes only to `status`, `program` and `run`,
 * which change a few times per run, never per progress event. The visuals inside draw
 * the counters themselves through refs in the shared frame loop (frameLoop.ts), so a
 * 4 Hz (or 50 Hz replay) stream of progress events re-renders no React here.
 *
 * Requirement 15.1: imported only by ProgramPage, so it ships in the lazy program chunk.
 */
export function VitalsPanel({ programId }: { readonly programId: string }) {
  const { status, program, numRuns } = useProofRun(
    useShallow((s) => ({ status: s.status, program: s.program, numRuns: s.run?.numRuns ?? null })),
  );
  // Nothing to show before the first run of this program.
  if (status === 'idle' || program !== programId) return null;
  return (
    <section
      aria-labelledby="vitals-title"
      className="mt-6 rounded border border-zinc-800 bg-zinc-900 p-4"
      data-testid="vitals-panel"
      data-status={status}
    >
      <h2 id="vitals-title" className="text-lg font-semibold">
        Vitals
      </h2>
      <div className="mt-3 grid gap-4 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Heartbeat: aria-hidden canvas strip; the Prove panel carries the counters. */}
        <div className="min-w-0 min-[900px]:col-span-2" data-testid="vitals-heartbeat-slot">
          <Heartbeat />
        </div>
        {/* Case grid: numRuns cells once `started` arrives, with its own text legend and caption. */}
        <div className="min-w-0" data-testid="vitals-grid-slot" data-num-runs={numRuns ?? undefined}>
          <CaseGrid />
        </div>
        {/* Resurrection fill: aria-hidden slab silhouette with its own status and count text. */}
        <div className="min-w-0" data-testid="vitals-fill-slot">
          <ResurrectionFill />
        </div>
      </div>
    </section>
  );
}
