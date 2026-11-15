/**
 * Records the proofs the lab replays when the live proof API is unavailable
 * (reanimation-lab Requirement 6). For every program and every mutant it runs the
 * real proof path (`prove`, the same code the API runs) against GnuCOBOL with a
 * fixed seed, captures the event stream, and writes:
 *
 *   web/public/recorded/<PROG>.json            the real port
 *   web/public/recorded/<PROG>.<mutant>.json   each mutant
 *
 * Each file is `{ "version": 2, "events": [started, progress..., result] }`, the
 * format web/src/features/proof/recording.ts validates and replays. Version 2
 * (graphical-proof Requirement 3) snapshots progress every 20 ms, carries
 * `cases` and `phase` on every progress event and a Shrink_Path on a diverged
 * result.
 *
 * A recording whose outcome contradicts what the registry says (the real port and
 * equivalent mutants must be equivalent, every other mutant must diverge), or that
 * hit the time cap, or that the web client would reject (more than 500 events,
 * bad phase or case data, a missing or invalid Shrink_Path), is not written, and
 * the script exits non-zero.
 *
 *   npm run record:proofs                         # docker runner (local reference image)
 *   LAZARUS_RUNNER=native npm run record:proofs   # binaries in LAZARUS_BIN_DIR
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CobolRunner } from '../src/harness/cobol.js';
import { prove, type ProveEvent, type ProveOptions } from '../src/api/prove.js';
import type { Mutant } from '../src/ports/mutant.js';
import { validateShrinkPath } from '../src/harness/shrinkPath.js';
import { PROGRAMS, type Program } from '../src/ports/registry.js';

/** One seed for every recording, so each can be reproduced with `LAZARUS_SEED`. */
export const RECORDING_SEED = 20261204;
export const RECORDING_VERSION = 2;
/** Progress snapshot interval for recordings. The live API stays at 4 Hz (Requirement 3.2). */
export const RECORDING_PROGRESS_INTERVAL_MS = 20;
/** Must match `MAX_RECORDED_EVENTS` in web/src/features/proof/recording.ts. */
export const MAX_RECORDED_EVENTS = 500;
export const RECORDED_DIR = fileURLToPath(new URL('../web/public/recorded/', import.meta.url));

export interface RecordingTarget {
  readonly program: Program;
  readonly mutant?: Mutant;
}

export interface RecordingFile {
  readonly version: typeof RECORDING_VERSION;
  readonly events: readonly ProveEvent[];
}

/** Every program, then each of its mutants, in registry order. */
export function recordingTargets(programs: readonly Program[] = PROGRAMS): RecordingTarget[] {
  return programs.flatMap((program) => [{ program }, ...program.mutants.map((mutant) => ({ program, mutant }))]);
}

/** Must match `recordingFileName` in web/src/features/proof/recording.ts. */
export function recordingFileName({ program, mutant }: RecordingTarget): string {
  return mutant ? `${program.id}.${mutant.id}.json` : `${program.id}.json`;
}

export function describeTarget({ program, mutant }: RecordingTarget): string {
  return mutant ? `${program.id} mutant ${mutant.id}` : `${program.id} real port`;
}

/** The real port and equivalent mutants must prove equivalent; every other mutant must diverge. */
export function expectedStatus({ mutant }: RecordingTarget): 'equivalent' | 'diverged' {
  return mutant === undefined || mutant.equivalent !== undefined ? 'equivalent' : 'diverged';
}

/** Problems that make a recording unusable or wrong for `target`. Empty when it is good. */
export function checkRecording(target: RecordingTarget, file: RecordingFile, seed = RECORDING_SEED): string[] {
  const problems: string[] = [];
  const { events } = file;
  if (file.version !== RECORDING_VERSION) problems.push(`version is ${String(file.version)}, expected ${RECORDING_VERSION}`);
  const started = events[0];
  const last = events.at(-1);
  if (started?.type !== 'started') return [...problems, 'first event is not "started"'];
  if (last?.type !== 'result') return [...problems, 'last event is not "result"'];
  if (events.slice(1, -1).some((event) => event.type !== 'progress')) problems.push('events between started and result are not all progress');

  if (started.program !== target.program.id) problems.push(`recorded program ${started.program}, expected ${target.program.id}`);
  if (started.mutant !== target.mutant?.id) {
    problems.push(`recorded mutant ${started.mutant ?? '(none)'}, expected ${target.mutant?.id ?? '(none)'}`);
  }
  problems.push(...checkClientRules(file));
  const { result } = last;
  if (started.seed !== seed || result.seed !== seed) problems.push(`seed ${result.seed}, expected ${seed} (is LAZARUS_SEED set?)`);
  if (result.reference !== started.reference) problems.push('result reference differs from the started reference');
  if (result.truncated) problems.push('the run hit the time cap; a recording must be a complete proof');
  const expected = expectedStatus(target);
  if (result.status !== expected) {
    problems.push(
      expected === 'equivalent'
        ? `diverged, but ${target.mutant ? 'the mutant is marked equivalent' : 'the real port must be equivalent'}`
        : `equivalent after ${result.cases} cases, but the mutant is not marked equivalent (Requirement 4.5)`,
    );
  }
  return problems;
}

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * The checks `parseRecording` in web/src/features/proof/recording.ts applies to
 * a version 2 recording (with parseProveEvent and progressModel's applyProgress),
 * replicated here because the web modules are not importable under the Node
 * build. Both are tested against the same fixtures
 * (web/src/features/proof/fixtures/recordingV2Corruptions.ts).
 */
function checkClientRules(file: RecordingFile): string[] {
  const problems: string[] = [];
  const { events } = file;
  if (events.length > MAX_RECORDED_EVENTS) problems.push(`${events.length} events, more than ${MAX_RECORDED_EVENTS}`);
  const started = events[0];
  const last = events.at(-1);
  if (started?.type !== 'started' || last?.type !== 'result') return problems;
  let elapsedMs = 0;
  let cases = 0;
  let shrinking = false;
  events.slice(1, -1).forEach((event, i) => {
    if (event.type !== 'progress') return;
    const at = `progress event ${i + 1}`;
    if (!isCount(event.executions) || !isCount(event.divergences)) problems.push(`${at}: bad counts`);
    if (!(Number.isFinite(event.elapsedMs) && event.elapsedMs >= elapsedMs)) problems.push(`${at}: elapsedMs decreases`);
    else elapsedMs = event.elapsedMs;
    const phase: unknown = event.phase;
    if (event.cases === undefined || phase === undefined) {
      problems.push(`${at}: missing cases or phase`);
      return;
    }
    if (phase !== 'generating' && phase !== 'shrinking') problems.push(`${at}: unknown phase ${String(phase)}`);
    if (!isCount(event.cases)) problems.push(`${at}: cases is not a count`);
    else {
      if (event.cases > event.executions) problems.push(`${at}: cases ${event.cases} above executions ${event.executions}`);
      if (event.cases > started.numRuns) problems.push(`${at}: cases ${event.cases} above numRuns ${started.numRuns}`);
      if (event.cases < cases) problems.push(`${at}: cases decrease from ${cases} to ${event.cases}`);
      cases = Math.max(cases, event.cases);
    }
    if (shrinking && phase === 'generating') problems.push(`${at}: returns from shrinking to generating`);
    if (phase === 'shrinking') shrinking = true;
  });
  const { result } = last;
  if (cases > result.cases) problems.push(`progress reached ${cases} cases, result has ${result.cases}`);
  if (Number.isNaN(Date.parse(result.generatedAt))) problems.push('result generatedAt is not a date');
  if (result.status === 'diverged') {
    if (result.shrinkPath === undefined) problems.push('diverged result has no shrinkPath');
    else problems.push(...validateShrinkPath(result.shrinkPath, result).map((p) => `shrinkPath: ${p}`));
  }
  return problems;
}

/** Run one proof through `prove` and return its event stream. Throws if the run failed. */
export async function recordProof(
  target: RecordingTarget,
  options: ProveOptions = {},
  seed = RECORDING_SEED,
): Promise<RecordingFile> {
  const events: ProveEvent[] = [];
  const outcome = await prove(
    { program: target.program, ...(target.mutant ? { mutant: target.mutant } : {}), seed },
    (event) => events.push(event),
    new AbortController().signal,
    { progressIntervalMs: RECORDING_PROGRESS_INTERVAL_MS, ...options },
  );
  if (outcome.status === 'failed') {
    throw new Error(`${describeTarget(target)}: the proof run failed`, { cause: outcome.error });
  }
  return { version: RECORDING_VERSION, events };
}

export interface RecordAllOptions {
  readonly outDir?: string;
  readonly targets?: readonly RecordingTarget[];
  readonly prove?: ProveOptions;
  readonly log?: (line: string) => void;
}

export interface RecordAllReport {
  /** File names written. */
  readonly written: readonly string[];
  readonly failures: readonly { readonly file: string; readonly problems: readonly string[] }[];
}

/** Record every target, write the good ones, and report the rest. Never writes a bad recording. */
export async function recordAll(options: RecordAllOptions = {}): Promise<RecordAllReport> {
  const outDir = options.outDir ?? RECORDED_DIR;
  const log = options.log ?? (() => undefined);
  const written: string[] = [];
  const failures: { file: string; problems: string[] }[] = [];
  await mkdir(outDir, { recursive: true });

  for (const target of options.targets ?? recordingTargets()) {
    const file = recordingFileName(target);
    let recording: RecordingFile;
    try {
      recording = await recordProof(target, options.prove);
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
      failures.push({ file, problems: [`${error instanceof Error ? error.message : String(error)}${cause}`] });
      log(`FAIL ${file}: the proof run failed${cause}`);
      continue;
    }
    const problems = checkRecording(target, recording);
    if (problems.length > 0) {
      failures.push({ file, problems });
      log(`FAIL ${file}: ${problems.join('; ')}`);
      continue;
    }
    // Write then rename, so a crash never leaves a half-written recording for the site to ship.
    const destination = path.join(outDir, file);
    await writeFile(`${destination}.tmp`, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
    await rename(`${destination}.tmp`, destination);
    written.push(file);
    const last = recording.events.at(-1);
    if (last?.type === 'result') {
      const { status, cases, shrinks, durationMs, reference } = last.result;
      log(
        `ok   ${file}: ${status} after ${cases} cases, ${shrinks} shrinks, in ${durationMs} ms (${reference}); ` +
          `${recording.events.length} events`,
      );
    }
  }
  return { written, failures };
}

function parseRunner(value: string | undefined): CobolRunner {
  if (value === undefined || value === '' || value === 'docker') return 'docker';
  if (value === 'native') return 'native';
  throw new Error(`LAZARUS_RUNNER must be "docker" or "native", got ${JSON.stringify(value)}`);
}

async function main(): Promise<void> {
  // The harness lets these override the case count and seed, which would make the recordings lie.
  for (const name of ['LAZARUS_RUNS', 'LAZARUS_SEED']) {
    if (process.env[name]) throw new Error(`Unset ${name} before recording proofs.`);
  }
  const runner = parseRunner(process.env.LAZARUS_RUNNER);
  console.log(`Recording proofs with the ${runner} runner and seed ${RECORDING_SEED} into ${RECORDED_DIR}`);
  const report = await recordAll({ prove: { runner }, log: (line) => console.log(line) });
  console.log(`${report.written.length} written, ${report.failures.length} failed.`);
  if (report.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
