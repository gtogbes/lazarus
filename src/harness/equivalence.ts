import fc from 'fast-check';
import { GNUCOBOL_IMAGE, type CobolSession } from './cobol.js';
import { compareOutputs, type Comparison } from './compare.js';

export type Port = (record: string) => string;

/** Live counters for the UI. `executions` includes shrinking attempts. */
export interface Progress {
  readonly executions: number;
  readonly divergences: number;
}

export interface Counterexample {
  readonly records: readonly string[];
  readonly cobol: readonly string[];
  readonly port: readonly string[];
  /** 0-based record and column of the first difference. */
  readonly line: number;
  readonly column: number;
}

/** Written to results/<PROGRAM>.json for the UI (Requirement 5.2). */
export interface EquivalenceResult {
  readonly program: string;
  readonly status: 'equivalent' | 'diverged';
  readonly reference: string;
  readonly generatedAt: string;
  readonly seed: number;
  /** Generated cases run, up to and including the first failure. */
  readonly cases: number;
  readonly shrinks: number;
  readonly durationMs: number;
  readonly counterexample?: Counterexample;
}

export interface EquivalenceOptions {
  readonly program: string;
  readonly session: CobolSession;
  readonly port: Port;
  /** Generator for one valid input record. */
  readonly record: fc.Arbitrary<string>;
  readonly numRuns?: number;
  readonly seed?: number;
  /** Maximum records sent per generated case. */
  readonly maxRecords?: number;
  readonly onProgress?: (progress: Progress) => void;
}

export class DivergenceError extends Error {
  constructor(readonly counterexample: Counterexample) {
    const { records, line, column, cobol, port } = counterexample;
    super(
      [
        `Port diverges from COBOL at record ${line}, column ${column}`,
        `  input: ${JSON.stringify(records[line])}`,
        `  cobol: ${JSON.stringify(cobol[line])}`,
        `  port:  ${JSON.stringify(port[line])}`,
      ].join('\n'),
    );
    this.name = 'DivergenceError';
  }
}

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be an integer, got "${raw}"`);
  return value;
}

function divergence(records: readonly string[], cobol: string[], port: string[], diff: Extract<Comparison, { equal: false }>) {
  return new DivergenceError({ records, cobol, port, line: diff.line, column: diff.column });
}

/**
 * Generate batches of records, run them through COBOL and the port, and
 * return the result with the shrunk counterexample and replay seed if any
 * output differs. LAZARUS_RUNS and LAZARUS_SEED override numRuns and seed.
 * Errors other than divergences (for example a crashed container) are rethrown.
 */
export async function checkEquivalence(options: EquivalenceOptions): Promise<EquivalenceResult> {
  const progress = { executions: 0, divergences: 0 };
  const numRuns = envInt('LAZARUS_RUNS') ?? options.numRuns ?? 1000;
  const seed = envInt('LAZARUS_SEED') ?? options.seed ?? Date.now() ^ (Math.random() * 0x100000000);
  const started = performance.now();

  const property = fc.asyncProperty(
    fc.array(options.record, { minLength: 1, maxLength: options.maxRecords ?? 10 }),
    async (records) => {
      const cobol = await options.session.send(records);
      const port = records.map(options.port);
      const diff = compareOutputs(cobol, port);
      progress.executions++;
      if (!diff.equal) progress.divergences++;
      options.onProgress?.({ ...progress });
      if (!diff.equal) throw divergence(records, cobol, port, diff);
    },
  );

  const details = await fc.check(property, { numRuns, seed });
  const base = {
    program: options.program,
    reference: GNUCOBOL_IMAGE,
    generatedAt: new Date().toISOString(),
    seed: details.seed,
    cases: details.numRuns,
    shrinks: details.numShrinks,
    durationMs: Math.round(performance.now() - started),
  };
  if (!details.failed) return { ...base, status: 'equivalent' };
  if (details.errorInstance instanceof DivergenceError) {
    return { ...base, status: 'diverged', counterexample: details.errorInstance.counterexample };
  }
  throw details.errorInstance instanceof Error
    ? details.errorInstance
    : new Error(fc.defaultReportMessage(details) ?? 'Equivalence check failed');
}
