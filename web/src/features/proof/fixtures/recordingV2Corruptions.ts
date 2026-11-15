/**
 * Single corruptions of a valid version 2 recording, shared by the web client's
 * `parseRecording` tests and scripts/record-proofs.ts's `checkRecording` tests,
 * so the record script rejects exactly what the client rejects (graphical-proof
 * Requirement 3.3). Import-free and untyped, so both builds can load it.
 *
 * `base` is a version 2 recording of a diverged run with at least two progress
 * events, a shrinking phase and a Shrink_Path, such as PAYROLL.half-up-tax.v2.json.
 */
type Json = Record<string, unknown>;
type Corrupt = (file: Json) => void;

const clone = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const events = (file: Json) => file.events as Json[];
const progress = (file: Json) => events(file).slice(1, -1);
const result = (file: Json) => (events(file).at(-1) as Json).result as Json;
const shrinkPath = (file: Json) => result(file).shrinkPath as Json;
const lastProgress = (file: Json) => progress(file).at(-1) as Json;

const CORRUPTIONS: Record<string, Corrupt> = {
  'more than 500 events': (file) => {
    const all = events(file);
    const filler = lastProgress(file);
    all.splice(all.length - 1, 0, ...Array.from({ length: 501 - all.length }, () => ({ ...filler })));
  },
  'a progress event without phase': (file) => {
    delete lastProgress(file).phase;
  },
  'a progress event without cases': (file) => {
    delete lastProgress(file).cases;
  },
  'an unknown phase': (file) => {
    lastProgress(file).phase = 'resting';
  },
  'cases above executions': (file) => {
    const p = lastProgress(file);
    p.cases = (p.executions as number) + 1;
  },
  'cases above numRuns': (file) => {
    const p = lastProgress(file);
    const numRuns = (events(file)[0] as Json).numRuns as number;
    p.cases = numRuns + 1;
    p.executions = Math.max(p.executions as number, numRuns + 1);
  },
  'decreasing cases': (file) => {
    const [first, second] = progress(file) as [Json, Json];
    first.cases = (second.cases as number) + 1;
    first.executions = Math.max(first.executions as number, first.cases as number);
  },
  'a return from shrinking to generating': (file) => {
    lastProgress(file).phase = 'generating';
  },
  'progress cases above the result cases': (file) => {
    result(file).cases = (lastProgress(file).cases as number) - 1;
  },
  'a diverged result without shrinkPath': (file) => {
    delete result(file).shrinkPath;
  },
  'a shrinkPath with a wrong total': (file) => {
    const path = shrinkPath(file);
    path.total = (path.total as number) + 1;
  },
  'a shrinkPath whose last step is not the counterexample': (file) => {
    const steps = shrinkPath(file).steps as Json[];
    const last = steps.at(-1) as Json;
    last.records = (last.records as string[]).map((r) => `${r}X`);
  },
  'a shrinkPath with a reordered step index': (file) => {
    const steps = shrinkPath(file).steps as Json[];
    if (steps.length > 2) (steps[1] as Json).step = (steps[2] as Json).step;
    else (steps[0] as Json).step = 99;
  },
};

/** `[name, corrupted copy]` for every corruption of `base`. `base` is not changed. */
export function recordingV2Corruptions(base: unknown): [string, Json][] {
  return Object.entries(CORRUPTIONS).map(([name, corrupt]) => {
    const file = clone(base);
    corrupt(file);
    return [name, file];
  });
}
