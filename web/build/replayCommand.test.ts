// @vitest-environment node
/**
 * Requirement 5.4: the replay command must name a real test and select exactly
 * the right one. Checked against the repository with `vitest list`, which
 * collects tests without running them (no Docker needed). Lives in build/ for
 * the Node types, like the other tests that read the repository.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MUTANTS as INTCALC_MUTANTS } from '../../src/ports/intcalc.mutants';
import { MUTANTS as INVOICE_MUTANTS } from '../../src/ports/invoice.mutants';
import { MUTANTS as PAYROLL_MUTANTS } from '../../src/ports/payroll.mutants';
import { PROGRAM_META } from '../../src/ports/programs.meta';
import { replayCommand, type Replay } from '../src/features/counterexample/replay';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const VITEST = path.join(REPO_ROOT, 'node_modules/.bin/vitest');
const MUTANT_IDS: Record<string, readonly string[]> = {
  INTCALC: INTCALC_MUTANTS.map((m) => m.id),
  PAYROLL: PAYROLL_MUTANTS.map((m) => m.id),
  INVOICE: INVOICE_MUTANTS.map((m) => m.id),
};

function replayFor(program: string, mutant: string | null): Replay {
  const result = replayCommand({ program, mutant, seed: -7, cases: 120 });
  if (!result.ok) throw new Error(result.reason);
  return result.replay;
}

/** Full names of the tests the command would run, as `file > suite > test`. */
async function listed(replay: Replay): Promise<string[]> {
  const args = ['list', '--staticParse=false', replay.file];
  if (replay.testNamePattern !== undefined) args.push('-t', replay.testNamePattern);
  const { stdout } = await promisify(execFile)(VITEST, args, { cwd: REPO_ROOT, env: { ...process.env, ...replay.env } });
  return stdout.split('\n').filter((line) => line.includes(' > '));
}

describe('replay command', () => {
  it('sets the env vars the harness reads, and vitest is a root dev dependency', async () => {
    const harness = await readFile(path.join(REPO_ROOT, 'src/harness/equivalence.ts'), 'utf8');
    expect(harness).toContain("envInt('LAZARUS_SEED')");
    expect(harness).toContain("envInt('LAZARUS_RUNS')");
    const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies).toHaveProperty('vitest');
    expect(replayFor('PAYROLL', null).command).toBe(
      'LAZARUS_SEED=-7 LAZARUS_RUNS=120 npx vitest --run src/ports/payroll.equivalence.test.ts',
    );
  });

  it.each(PROGRAM_META.map((p) => p.id))('selects only the %s real-port and per-mutant tests', async (program) => {
    expect(await listed(replayFor(program, null))).toEqual([
      `${replayFor(program, null).file} > ${program} port matches GnuCOBOL on generated records`,
    ]);
    const ids = MUTANT_IDS[program] ?? [];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const tests = await listed(replayFor(program, id));
      expect(tests, id).toHaveLength(1);
      expect(tests[0], id).toMatch(new RegExp(`^src/ports/mutants\\.equivalence\\.test\\.ts > ${program} mutants against GnuCOBOL > ${id} is `));
    }
  }, 60_000);

  it('refuses ids that would need quoting instead of inventing a command', () => {
    expect(replayCommand({ program: 'PAYROLL', mutant: 'x"; rm -rf ~', seed: 1, cases: 1 }).ok).toBe(false);
    expect(replayCommand({ program: '../etc', mutant: null, seed: 1, cases: 1 }).ok).toBe(false);
    expect(replayCommand({ program: 'PAYROLL', mutant: null, seed: 1.5, cases: 1 }).ok).toBe(false);
  });
});
