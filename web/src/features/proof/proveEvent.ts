/**
 * Validation for proof stream events. Every value from the stream is untrusted:
 * anything that does not match the contract becomes null, and only known
 * fields are copied, so unknown fields never reach the UI.
 */
import type { ProveEvent } from '../../../../src/api/events';
import type { Counterexample, EquivalenceResult } from '../../../../src/harness/equivalence.types';

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isInt = (value: unknown): value is number => Number.isSafeInteger(value);
const isDuration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isString = (value: unknown): value is string => typeof value === 'string';
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

function parseCounterexample(value: unknown): Counterexample | null {
  if (!isObject(value)) return null;
  const { records, cobol, port, line, column } = value;
  if (!isStringArray(records) || !isStringArray(cobol) || !isStringArray(port)) return null;
  if (!isCount(line) || !isCount(column)) return null;
  return { records, cobol, port, line, column };
}

export function parseEquivalenceResult(value: unknown): EquivalenceResult | null {
  if (!isObject(value)) return null;
  const { program, status, reference, generatedAt, seed, cases, shrinks, durationMs, counterexample, truncated } =
    value;
  if (!isString(program) || !isString(reference) || !isString(generatedAt)) return null;
  if (!isInt(seed) || !isCount(cases) || !isCount(shrinks) || !isDuration(durationMs)) return null;
  if (truncated !== undefined && truncated !== true) return null;
  const base = {
    program,
    reference,
    generatedAt,
    seed,
    cases,
    shrinks,
    durationMs,
    ...(truncated === true ? { truncated: true as const } : {}),
  };
  if (status === 'equivalent') return { ...base, status };
  if (status === 'diverged') {
    // A divergence without a usable counterexample cannot be explained (Requirement 5), so reject it.
    const parsed = parseCounterexample(counterexample);
    return parsed ? { ...base, status, counterexample: parsed } : null;
  }
  return null;
}

/** The event, or null if the value is not a valid proof stream event. */
export function parseProveEvent(value: unknown): ProveEvent | null {
  if (!isObject(value)) return null;
  switch (value.type) {
    case 'started': {
      const { program, mutant, seed, reference, numRuns } = value;
      if (!isString(program) || !isInt(seed) || !isString(reference) || !isCount(numRuns)) return null;
      if (mutant !== undefined && !isString(mutant)) return null;
      return { type: 'started', program, ...(mutant === undefined ? {} : { mutant }), seed, reference, numRuns };
    }
    case 'progress': {
      const { executions, divergences, elapsedMs } = value;
      if (!isCount(executions) || !isCount(divergences) || !isDuration(elapsedMs)) return null;
      return { type: 'progress', executions, divergences, elapsedMs };
    }
    case 'result': {
      const result = parseEquivalenceResult(value.result);
      return result ? { type: 'result', result } : null;
    }
    case 'error': {
      return isString(value.message) ? { type: 'error', message: value.message } : null;
    }
    default:
      return null;
  }
}
