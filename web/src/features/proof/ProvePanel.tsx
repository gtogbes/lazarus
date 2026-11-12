import { useEffect, useRef, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ProofAnnouncer } from './ProofAnnouncer';
import { COUNT_FORMAT, DATE_FORMAT, formatDuration, formatElapsed } from './proofMessages';
import { useProofRun, type ProofStatus } from './useProofRun';

const STATUS_LABEL: Record<ProofStatus, string> = {
  idle: 'Not yet proven',
  reanimating: 'Reanimating…',
  alive: 'Alive',
  relapsed: 'Relapsed',
  error: 'Proof failed',
  cancelled: 'Cancelled',
};
const STATUS_CLASS: Record<ProofStatus, string> = {
  idle: 'text-zinc-300',
  reanimating: 'text-amber-300',
  alive: 'text-emerald-300',
  relapsed: 'text-red-300',
  error: 'text-red-300',
  cancelled: 'text-zinc-300',
};

/**
 * Requirement 3.2-3.5: start a live proof, watch the counters, cancel it.
 * Requirement 6: after a live failure, offer the recorded proof and label its replay.
 */
export function ProvePanel({ programId }: { readonly programId: string }) {
  const { status, truncated, executions, divergences, elapsedMs, selectedMutant, start, cancel, reset } = useProofRun(
    useShallow((s) => ({
      status: s.status,
      truncated: s.result?.truncated === true,
      executions: s.executions,
      divergences: s.divergences,
      elapsedMs: s.elapsedMs,
      selectedMutant: s.selectedMutant,
      start: s.start,
      cancel: s.cancel,
      reset: s.reset,
    })),
  );
  const proveRef = useRef<HTMLButtonElement>(null);
  const running = status === 'reanimating';

  // Leaving the program (or switching to another) abandons its run.
  useEffect(() => reset, [programId, reset]);

  return (
    <section aria-labelledby="prove-title" className="mt-6 rounded border border-zinc-800 bg-zinc-900 p-4">
      <h2 id="prove-title" className="text-lg font-semibold">
        Prove it
      </h2>
      <p className="mt-1 max-w-prose text-sm text-zinc-300">
        Runs the real GnuCOBOL program and the port on the same generated inputs and compares every output record.
      </p>
      {selectedMutant !== null && (
        <p className="mt-2 text-sm text-amber-300" data-testid="sabotage-notice">
          Sabotage is on: Prove runs the mutant <code className="font-mono">{selectedMutant}</code>, not the real port.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          ref={proveRef}
          type="button"
          // aria-disabled, not disabled, so keyboard focus stays on the button while the run starts.
          aria-disabled={running}
          onClick={() => {
            if (!running) void start(programId, selectedMutant ?? undefined);
          }}
          className="rounded bg-amber-300 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        >
          {status === 'idle' ? 'Prove it' : 'Prove again'}
        </button>
        {running && (
          <button
            type="button"
            onClick={() => {
              cancel();
              proveRef.current?.focus();
            }}
            className="rounded border border-zinc-500 px-4 py-2 font-semibold text-zinc-100 hover:border-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            Cancel
          </button>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-zinc-400">Status</dt>
        <dd className={`font-semibold ${STATUS_CLASS[status]}`} data-testid="proof-status">
          {status === 'alive' && truncated ? 'Alive (partial proof)' : STATUS_LABEL[status]}
        </dd>
        {status !== 'idle' && (
          <>
            <dt className="text-zinc-400">Cases run</dt>
            <dd className="tabular-nums" data-testid="proof-executions">
              {COUNT_FORMAT.format(executions)}
            </dd>
            <dt className="text-zinc-400">Divergences</dt>
            <dd className="tabular-nums" data-testid="proof-divergences">
              {COUNT_FORMAT.format(divergences)}
            </dd>
            <dt className="text-zinc-400">Elapsed</dt>
            <dd className="tabular-nums" data-testid="proof-elapsed">
              {formatElapsed(elapsedMs)}
            </dd>
          </>
        )}
      </dl>
      <RecordedLabel />
      <ProofOutcome />
      <RecordedOffer proveRef={proveRef} />
      <ProofAnnouncer />
    </section>
  );
}

/** What the finished run showed: the Alive or Relapsed summary, the failure, or the cancellation. */
function ProofOutcome() {
  const { status, result, error } = useProofRun(
    useShallow((s) => ({ status: s.status, result: s.result, error: s.error })),
  );
  if (status === 'error') {
    return (
      <p className="mt-4 text-sm text-red-300" data-testid="proof-error">
        {error?.message} This is not a divergence: nothing was proven either way.
      </p>
    );
  }
  if (status === 'cancelled') {
    return <p className="mt-4 text-sm text-zinc-300">Cancelled. Nothing was proven.</p>;
  }
  if ((status !== 'alive' && status !== 'relapsed') || !result) return null;
  return (
    <div className="mt-4 text-sm" data-testid="proof-summary">
      <p className={status === 'alive' ? 'text-emerald-300' : 'text-red-300'}>
        {status === 'alive'
          ? result.truncated
            ? `Stopped at the 25 s limit after ${COUNT_FORMAT.format(result.cases)} cases. No divergence in those cases, but this is a partial proof.`
            : `${COUNT_FORMAT.format(result.cases)} cases matched GnuCOBOL record for record.`
          : `The port diverged from COBOL after ${COUNT_FORMAT.format(result.cases)} cases, shrunk in ${COUNT_FORMAT.format(result.shrinks)} steps.`}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-zinc-400">Cases</dt>
        <dd className="tabular-nums">{COUNT_FORMAT.format(result.cases)}</dd>
        <dt className="text-zinc-400">Duration</dt>
        <dd className="tabular-nums">{formatDuration(result.durationMs)}</dd>
        <dt className="text-zinc-400">Seed</dt>
        <dd className="font-mono">{result.seed}</dd>
        <dt className="text-zinc-400">Reference</dt>
        <dd className="font-mono">{result.reference}</dd>
      </dl>
    </div>
  );
}

/** Requirement 6.2: a replayed run is labelled "Recorded" with its date, never passed off as live. */
function RecordedLabel() {
  const { source, status, recordedAt } = useProofRun(
    useShallow((s) => ({ source: s.source, status: s.status, recordedAt: s.recordedAt })),
  );
  if (source !== 'recorded' || status === 'error') return null;
  return (
    <p className="mt-4 text-sm text-zinc-300" data-testid="proof-recorded">
      <span className="mr-2 rounded border border-amber-300 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
        Recorded
      </span>
      {recordedAt === null ? (
        'Loading the recorded proof…'
      ) : (
        <>
          A replay of a proof recorded on <time dateTime={recordedAt}>{DATE_FORMAT.format(new Date(recordedAt))}</time>{' '}
          against GnuCOBOL. This is not a live run.
        </>
      )}
    </p>
  );
}

/** Requirement 6.1: when the live proof fails, offer the recorded proof for the same program and mutant. */
function RecordedOffer({ proveRef }: { readonly proveRef: RefObject<HTMLButtonElement | null> }) {
  const { offer, mutant, replayRecorded } = useProofRun(
    useShallow((s) => ({
      offer: s.status === 'error' && s.source === 'live' && s.error !== null && s.error.kind !== 'recorded',
      mutant: s.mutant,
      replayRecorded: s.replayRecorded,
    })),
  );
  if (!offer) return null;
  return (
    <div className="mt-3 text-sm" data-testid="recorded-offer">
      <p className="text-zinc-300">
        You can replay a proof of {mutant === null ? 'the real port' : <>the mutant <code className="font-mono">{mutant}</code></>}{' '}
        recorded earlier against the same GnuCOBOL build.
      </p>
      <button
        type="button"
        onClick={() => {
          // The offer disappears once the replay starts, so keep focus in the panel.
          proveRef.current?.focus();
          void replayRecorded();
        }}
        className="mt-2 rounded border border-amber-300 px-4 py-2 font-semibold text-amber-300 hover:bg-amber-300 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        Replay the recorded proof
      </button>
    </div>
  );
}
