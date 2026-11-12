import type { ProofRunState } from './useProofRun';

export const COUNT_FORMAT = new Intl.NumberFormat('en-GB');
/** Same style as the morgue's recorded dates. */
export const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Elapsed time with a fixed tenth, so the live counter does not jump between units. */
export function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

type MessageState = Pick<ProofRunState, 'status' | 'program' | 'result' | 'error' | 'executions'> &
  Partial<Pick<ProofRunState, 'source'>>;

/**
 * One sentence for the live region when the status changes (Requirement 9.2). Empty when idle.
 * Recorded replays say so (Requirement 6.2).
 */
export function statusMessage(state: MessageState): string {
  const message = liveStatusMessage(state);
  if (state.source !== 'recorded' || message === '') return message;
  return state.status === 'reanimating'
    ? `Replaying the recorded proof for ${state.program ?? 'the program'}.`
    : `Recorded proof: ${message}`;
}

function liveStatusMessage({ status, program, result, error, executions }: MessageState): string {
  const name = program ?? 'The program';
  switch (status) {
    case 'idle':
      return '';
    case 'reanimating':
      return `Proof started for ${name}.`;
    case 'alive':
      if (!result) return `${name} is alive.`;
      return result.truncated
        ? `${name} is alive, but the proof stopped at the time limit after ${COUNT_FORMAT.format(result.cases)} cases with no divergence.`
        : `${name} is alive: ${COUNT_FORMAT.format(result.cases)} cases matched GnuCOBOL.`;
    case 'relapsed':
      return result
        ? `${name} relapsed: the port diverged from COBOL after ${COUNT_FORMAT.format(result.cases)} cases.`
        : `${name} relapsed.`;
    case 'error':
      return `The proof failed: ${error?.message ?? 'unknown error'}`;
    case 'cancelled':
      return `Proof cancelled after ${COUNT_FORMAT.format(executions)} cases. Nothing was proven.`;
  }
}

/** Counter summary for the live region while running. */
export function progressMessage({
  executions,
  divergences,
  elapsedMs,
}: Pick<ProofRunState, 'executions' | 'divergences' | 'elapsedMs'>): string {
  const plural = divergences === 1 ? 'divergence' : 'divergences';
  return `${COUNT_FORMAT.format(executions)} cases run, ${COUNT_FORMAT.format(divergences)} ${plural}, ${Math.round(elapsedMs / 1000)} seconds elapsed.`;
}
