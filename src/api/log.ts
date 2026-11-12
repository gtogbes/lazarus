/**
 * Structured logging shared by the proof API transports (the dev server and
 * the Lambda handler). One JSON object per line on stdout; Lambda forwards
 * stdout to CloudWatch Logs. Request bodies are never logged.
 */
import type { ProveOutcome } from './prove.js';

export type LogEntry = { readonly level: 'info' | 'warn' | 'error'; readonly msg: string } & Record<string, unknown>;
export type Log = (entry: LogEntry) => void;

/** Structured JSON logs, one object per line. */
export const jsonLog: Log = (entry) => {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
};

export function describeError(error: unknown): Record<string, unknown> {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { value: String(error) };
}

/**
 * Log how a proof ended. A failure's real error is logged here only; the
 * client was sent `RUN_FAILED_MESSAGE`.
 */
export function logProofOutcome(log: Log, fields: Record<string, unknown>, outcome: ProveOutcome): void {
  const finished = { ...fields, outcome: outcome.status };
  if (outcome.status === 'failed') {
    log({ level: 'error', msg: 'proof failed', ...finished, error: describeError(outcome.error) });
  } else if (outcome.status === 'cancelled') {
    log({ level: 'info', msg: 'proof cancelled', ...finished });
  } else {
    log({
      level: 'info',
      msg: 'proof finished',
      ...finished,
      result: outcome.result.status,
      cases: outcome.result.cases,
    });
  }
}
