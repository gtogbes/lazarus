import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EquivalenceResult } from './equivalence.js';

export const RESULTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../results');

/** Write results/<PROGRAM>.json and return its path. */
export function writeResult(result: EquivalenceResult, dir: string = RESULTS_DIR): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${result.program}.json`);
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return path;
}

/** One-line human summary for test output and logs. */
export function describeResult(result: EquivalenceResult): string {
  const head = `${result.program}: ${result.cases} cases in ${result.durationMs} ms, seed ${result.seed}`;
  if (result.status === 'equivalent') return `${head}, equivalent`;
  const c = result.counterexample;
  if (!c) return `${head}, diverged`;
  return [
    `${head}, DIVERGED after ${result.shrinks} shrinks at record ${c.line}, column ${c.column}`,
    `  input: ${JSON.stringify(c.records[c.line])}`,
    `  cobol: ${JSON.stringify(c.cobol[c.line])}`,
    `  port:  ${JSON.stringify(c.port[c.line])}`,
    `  replay: LAZARUS_SEED=${result.seed} npm run test:equivalence`,
  ].join('\n');
}
