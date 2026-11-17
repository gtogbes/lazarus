import { Link } from 'react-router';
// Fast-check-free metadata shared with src/ports/registry.ts. Do not import the registry here:
// it pulls fast-check and the ports into the initial bundle.
import { PROGRAM_META, type ProgramMeta } from '../../../../src/ports/programs.meta';
import { PANEL } from '../../app/surface';
import { DemoButton } from '../demo/DemoButton';
import { ProgramSummary } from '../program/ProgramSummary';
import { useSceneNudge } from '../../scene/sceneNudge';
import type { RecordedProof } from './recordedProof';
import { useRecordedProofs } from './useRecordedProofs';

const PROGRAM_IDS = PROGRAM_META.map((p) => p.id);

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const COUNT_FORMAT = new Intl.NumberFormat('en-GB');
/** Delay between the cards' entrance animations. */
const CARD_STAGGER_MS = 70;

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Requirement 1: every program with its status and recorded proof. Rendered from
 * static metadata, so the list and its links work before any recorded proof
 * (or the 3D scene) has loaded.
 */
export function MorguePage() {
  const proofs = useRecordedProofs(PROGRAM_IDS);

  return (
    <section aria-labelledby="morgue-title" className={`${PANEL} p-4 sm:p-6`}>
      <h1 id="morgue-title" className="text-2xl font-semibold">
        The morgue
      </h1>
      <p className="mt-2 max-w-prose text-zinc-300">
        Each legacy COBOL program lies here with its TypeScript port. Pick one to see the two side by side and
        prove them equivalent.
      </p>
      <ul className="mt-6 grid gap-4 md:grid-cols-3">
        {PROGRAM_META.map((program, index) => (
          <ProgramCard key={program.id} program={program} proof={proofs[program.id]} index={index} />
        ))}
      </ul>
      {/* After the cards, so the programs stay first in the tab order. */}
      <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-300">
        <DemoButton />
        <span>A two-minute guided replay of recorded proofs of PAYROLL.</span>
      </p>
    </section>
  );
}

interface ProgramCardProps {
  readonly program: ProgramMeta;
  readonly proof: RecordedProof | null | undefined;
  readonly index: number;
}

/**
 * Hover or focus lights the card like a lamp (a warm glow, no motion) and nudges
 * the lab scene into one soft arc pulse (sceneNudge.ts, rate-limited to 1 Hz).
 */
function ProgramCard({ program, proof, index }: ProgramCardProps) {
  const titleId = `program-${program.id}-title`;
  const nudge = useSceneNudge((s) => s.nudge);
  return (
    // aria-labelledby names the list item after the program for screen readers.
    <li
      aria-labelledby={titleId}
      data-testid="program-card"
      onPointerEnter={() => nudge()}
      onFocus={() => nudge()}
      style={{ animationDelay: `${index * CARD_STAGGER_MS}ms` }}
      className="relative flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 p-4 focus-within:border-amber-300 focus-within:shadow-[0_0_28px_-6px_rgb(252_211_77/0.45)] hover:border-amber-300/60 hover:shadow-[0_0_28px_-6px_rgb(252_211_77/0.35)] motion-safe:animate-card-in motion-safe:transition-[border-color,box-shadow] motion-safe:duration-300"
    >
      <h2 id={titleId} className="font-mono text-lg font-semibold">
        {/* The ::after overlay makes the whole card the link's hit area, with one tab stop. */}
        <Link
          to={`/program/${program.id}`}
          className="after:absolute after:inset-0 after:rounded after:content-[''] hover:text-amber-300"
        >
          {program.id}
        </Link>
      </h2>
      <p className="mt-1 text-zinc-300">{program.description}</p>
      <ProgramSummary summary={program.summary} className="mt-2" />
      <ul aria-label="COBOL behaviours" className="mt-3 flex flex-wrap gap-2">
        {program.behaviours.map((behaviour) => (
          <li key={behaviour} className="rounded bg-zinc-800 px-2 py-0.5 text-sm text-zinc-200">
            {behaviour}
          </li>
        ))}
      </ul>
      <ProofSummary proof={proof} />
    </li>
  );
}

function ProofSummary({ proof }: { readonly proof: RecordedProof | null | undefined }) {
  if (proof === undefined) {
    return <p className="mt-4 text-sm text-zinc-400">Checking for a recorded proof…</p>;
  }
  if (proof === null) {
    return (
      <div className="mt-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3">
          <StatusRow label="Unproven" className="text-zinc-300" />
        </dl>
        <p className="mt-1 text-zinc-400">No recorded proof yet.</p>
      </div>
    );
  }
  const alive = proof.status === 'equivalent';
  return (
    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <StatusRow label={alive ? 'Alive' : 'Relapsed'} className={alive ? 'text-emerald-300' : 'text-red-300'} />
      <dt className="text-zinc-400">Cases</dt>
      <dd>{COUNT_FORMAT.format(proof.cases)}</dd>
      <dt className="text-zinc-400">Duration</dt>
      <dd>{formatDuration(proof.durationMs)}</dd>
      <dt className="text-zinc-400">Recorded</dt>
      <dd>
        <time dateTime={proof.generatedAt}>{DATE_FORMAT.format(new Date(proof.generatedAt))}</time>
      </dd>
    </dl>
  );
}

function StatusRow({ label, className }: { readonly label: string; readonly className: string }) {
  return (
    <>
      <dt className="text-zinc-400">Status</dt>
      <dd className={`font-semibold ${className}`}>{label}</dd>
    </>
  );
}
