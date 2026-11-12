/**
 * Requirement 5.4: a shell command that replays a divergence locally.
 *
 * Replays use the existing equivalence tests, which read LAZARUS_SEED and
 * LAZARUS_RUNS (src/harness/equivalence.ts) over any seed or case count in the
 * test. fast-check generates the same cases for the same seed whatever the run
 * count, so LAZARUS_RUNS is set to the cases the proof ran, which includes the
 * failing case, and the replay stops there and shrinks the same way.
 *
 * - Real port: `src/ports/<prog>.equivalence.test.ts`.
 * - Mutant: the one test for that mutant in `src/ports/mutants.equivalence.test.ts`,
 *   picked with `-t`. Vitest joins suite and test names with " > ".
 *
 * `npm run test:equivalence` is not used: it runs every file under src/ports,
 * and an extra file argument widens the filter rather than narrowing it.
 */
export interface ReplayInput {
  readonly program: string;
  /** Null for the real port. */
  readonly mutant: string | null;
  readonly seed: number;
  /** Cases the proof ran, up to and including the failure. */
  readonly cases: number;
}

export interface Replay {
  readonly command: string;
  readonly env: { readonly LAZARUS_SEED: string; readonly LAZARUS_RUNS: string };
  /** Test file, relative to the repository root. */
  readonly file: string;
  /** Vitest `-t` pattern, only for mutants. */
  readonly testNamePattern?: string;
  /** Side effects worth knowing before running it. */
  readonly note: string;
}

export type ReplayResult = { readonly ok: true; readonly replay: Replay } | { readonly ok: false; readonly reason: string };

// Only ids that need no shell quoting or regex escaping go into a command.
const PROGRAM_ID = /^[A-Z][A-Z0-9]*$/;
const MUTANT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function replayCommand({ program, mutant, seed, cases }: ReplayInput): ReplayResult {
  if (!PROGRAM_ID.test(program) || (mutant !== null && !MUTANT_ID.test(mutant))) {
    return { ok: false, reason: 'This run cannot be replayed with an existing command: its program or mutant id is not one the tests know.' };
  }
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(cases) || cases < 1) {
    return { ok: false, reason: 'This run cannot be replayed: its seed or case count is missing.' };
  }
  const env = { LAZARUS_SEED: String(seed), LAZARUS_RUNS: String(cases) };
  const prefix = `LAZARUS_SEED=${env.LAZARUS_SEED} LAZARUS_RUNS=${env.LAZARUS_RUNS} npx vitest --run`;
  if (mutant === null) {
    const file = `src/ports/${program.toLowerCase()}.equivalence.test.ts`;
    return {
      ok: true,
      replay: {
        command: `${prefix} ${file}`,
        env,
        file,
        note: `Run it from the repository root. It needs Docker and the GnuCOBOL image (npm run cobol:image), fails with the same counterexample, and rewrites results/${program}.json.`,
      },
    };
  }
  const file = 'src/ports/mutants.equivalence.test.ts';
  const testNamePattern = `^${program} mutants against GnuCOBOL > ${mutant} is `;
  return {
    ok: true,
    replay: {
      command: `${prefix} ${file} -t "${testNamePattern}"`,
      env,
      file,
      testNamePattern,
      note: 'Run it from the repository root. It needs Docker and the GnuCOBOL image (npm run cobol:image). The test passes because it expects the mutant to be caught, and logs the same counterexample.',
    },
  };
}
