import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EquivalenceResult, ShrinkStep } from '../../../../src/harness/equivalence.types';
import { MAX_SHRINK_STEPS } from '../../../../src/harness/shrinkPath';
import V1_FIXTURE from './fixtures/PAYROLL.half-up-tax.v1.json';
import { applyProgress, finalizeProgress, INITIAL_PROGRESS_STATE } from './progressModel';
import {
  fetchRecording,
  MAX_RECORDED_EVENTS,
  parseRecording,
  RECORDING_TIMEOUT_MS,
  RECORDING_VERSIONS,
  recordingFileName,
  recordingUrl,
  type Recording,
} from './recording';
import { DIVERGED_RESULT, EQUIVALENT_RESULT, recordingOf } from './testing';

const VALID = recordingOf(EQUIVALENT_RESULT, {
  progress: [
    { type: 'progress', executions: 400, divergences: 0, elapsedMs: 250 },
    { type: 'progress', executions: 2000, divergences: 0, elapsedMs: 1412 },
  ],
});

const withEvents = (events: unknown[]) => ({ version: 1, events });
const [STARTED_EVENT, P1, P2, RESULT_EVENT] = VALID.events;

describe('recordingFileName', () => {
  it('names program and mutant recordings', () => {
    expect(recordingFileName({ program: 'PAYROLL' })).toBe('PAYROLL.json');
    expect(recordingFileName({ program: 'PAYROLL', mutant: null })).toBe('PAYROLL.json');
    expect(recordingFileName({ program: 'PAYROLL', mutant: 'half-up-tax' })).toBe('PAYROLL.half-up-tax.json');
    expect(recordingUrl({ program: 'PAYROLL', mutant: 'half-up-tax' })).toBe('/recorded/PAYROLL.half-up-tax.json');
  });
});

describe('parseRecording', () => {
  it('splits a recording into started, progress snapshots and result', () => {
    const recording = parseRecording(VALID, { program: 'PAYROLL' });
    expect(recording?.started).toMatchObject({ program: 'PAYROLL', seed: 42 });
    expect(recording?.progress.map((p) => p.executions)).toEqual([400, 2000]);
    expect(recording?.result).toEqual(EQUIVALENT_RESULT);
  });

  it('accepts a mutant recording for that mutant only', () => {
    const file = recordingOf(DIVERGED_RESULT, { mutant: 'half-up-tax' });
    expect(parseRecording(file, { program: 'PAYROLL', mutant: 'half-up-tax' })?.result.status).toBe('diverged');
    expect(parseRecording(file, { program: 'PAYROLL' })).toBeNull();
    expect(parseRecording(file, { program: 'PAYROLL', mutant: 'ignore-size-error' })).toBeNull();
    expect(parseRecording(VALID, { program: 'PAYROLL', mutant: 'half-up-tax' })).toBeNull();
  });

  it('drops unknown fields', () => {
    const file = withEvents([{ ...STARTED_EVENT, extra: '<script>' }, RESULT_EVENT]);
    expect(parseRecording(file)?.started).not.toHaveProperty('extra');
  });

  it.each([
    ['null', null],
    ['an array', [VALID]],
    ['a bare result', EQUIVALENT_RESULT],
    ['version 0', { ...VALID, version: 0 }],
    ['version 3', { ...VALID, version: 3 }],
    ['a string version', { ...VALID, version: '1' }],
    ['no events', withEvents([])],
    ['no result', withEvents([STARTED_EVENT, P1])],
    ['no started', withEvents([P1, RESULT_EVENT])],
    ['an invalid event', withEvents([STARTED_EVENT, { type: 'progress', executions: -1 }, RESULT_EVENT])],
    ['an error event', withEvents([STARTED_EVENT, { type: 'error', message: 'x' }, RESULT_EVENT])],
    ['two results', withEvents([STARTED_EVENT, RESULT_EVENT, RESULT_EVENT])],
    ['progress going back in time', withEvents([STARTED_EVENT, P2, P1, RESULT_EVENT])],
    ['a result for another program', withEvents([STARTED_EVENT, { type: 'result', result: { ...EQUIVALENT_RESULT, program: 'INVOICE' } }])],
    ['a result with another seed', withEvents([STARTED_EVENT, { type: 'result', result: { ...EQUIVALENT_RESULT, seed: 7 } }])],
    ['an undatable result', withEvents([STARTED_EVENT, { type: 'result', result: { ...EQUIVALENT_RESULT, generatedAt: 'soon' } }])],
    ['too many events', withEvents([STARTED_EVENT, ...Array<unknown>(600).fill(P1), RESULT_EVENT])],
  ])('rejects %s', (_name, value) => {
    expect(parseRecording(value)).toBeNull();
  });

  it('rejects a recording of another program', () => {
    expect(parseRecording(VALID, { program: 'INVOICE' })).toBeNull();
  });
});

describe('version 1 fixture', () => {
  // A copy of web/public/recorded/PAYROLL.half-up-tax.json as recorded before version 2.
  it('replays with derived phase and cases', () => {
    const recording = parseRecording(V1_FIXTURE, { program: 'PAYROLL', mutant: 'half-up-tax' });
    expect(recording).not.toBeNull();
    if (!recording) return;
    expect(recording.result.status).toBe('diverged');
    const state = recording.progress.reduce<typeof INITIAL_PROGRESS_STATE | null>(
      (s, p) => s && applyProgress(s, p, recording.started.numRuns),
      INITIAL_PROGRESS_STATE,
    );
    expect(state?.phase).toBe('shrinking');
    expect(state && finalizeProgress(state, recording.result)).toMatchObject({ phase: 'shrinking', cases: 1 });
  });
});

describe('version 2', () => {
  const V2_DIVERGED = {
    ...DIVERGED_RESULT,
    shrinkPath: {
      total: 13,
      steps: [
        { step: 0, records: ['FIRST', 'IN'], line: 1 },
        { step: 12, records: ['IN'], line: 0 },
      ],
    },
  };
  const BAD_PATH = { ...V2_DIVERGED, shrinkPath: { ...V2_DIVERGED.shrinkPath, total: 5 } };
  const progress = (executions: number, divergences: number, cases: number, phase: string, elapsedMs: number) => ({
    type: 'progress',
    executions,
    divergences,
    cases,
    phase,
    elapsedMs,
  });
  const GENERATING = progress(30, 0, 30, 'generating', 20);
  const SHRINKING = progress(49, 13, 37, 'shrinking', 40);
  const v2 = (result: Parameters<typeof recordingOf>[0], events: readonly object[] = [GENERATING, SHRINKING]) => ({
    ...recordingOf(result, { mutant: 'half-up-tax', progress: events }),
    version: 2,
  });

  it('accepts a diverged run with phases and a shrink path', () => {
    const recording = parseRecording(v2(V2_DIVERGED), { program: 'PAYROLL', mutant: 'half-up-tax' });
    expect(recording?.progress.map((p) => [p.cases, p.phase])).toEqual([
      [30, 'generating'],
      [37, 'shrinking'],
    ]);
    expect(recording?.result.shrinkPath).toEqual(V2_DIVERGED.shrinkPath);
  });

  it('accepts an equivalent run', () => {
    const file = { ...recordingOf(EQUIVALENT_RESULT, { progress: [progress(2000, 0, 2000, 'generating', 600)] }), version: 2 };
    expect(parseRecording(file, { program: 'PAYROLL' })?.result.status).toBe('equivalent');
  });

  it.each([
    ['progress without cases and phase', v2(V2_DIVERGED, [{ type: 'progress', executions: 30, divergences: 0, elapsedMs: 20 }])],
    ['a diverged result without a shrink path', v2(DIVERGED_RESULT)],
    ['an invalid shrink path', v2(BAD_PATH)],
    ['cases above numRuns', v2(V2_DIVERGED, [progress(2001, 0, 2001, 'generating', 20)])],
    ['decreasing cases', v2(V2_DIVERGED, [GENERATING, progress(31, 0, 29, 'generating', 30)])],
    ['a return to generating', v2(V2_DIVERGED, [SHRINKING, progress(50, 13, 37, 'generating', 50)])],
    ['progress cases above the result', v2(V2_DIVERGED, [progress(49, 13, 38, 'shrinking', 40)])],
  ])('rejects %s', (_name, value) => {
    expect(parseRecording(value)).toBeNull();
  });
});

// Records of 1-3 short strings with a line in range; 24 steps of these stay under the path byte cap.
const stepRecords = fc
  .array(fc.string({ maxLength: 8 }), { minLength: 1, maxLength: 3 })
  .chain((records) => fc.record({ records: fc.constant(records), line: fc.nat({ max: records.length - 1 }) }));

/** Indices 0 < i < shrinks for the interior steps of a Shrink_Path, sorted. */
const interiorSteps = (shrinks: number) =>
  shrinks < 2
    ? fc.constant<number[]>([])
    : fc
        .uniqueArray(fc.integer({ min: 1, max: shrinks - 1 }), { maxLength: MAX_SHRINK_STEPS - 2 })
        .map((idx) => [...idx].sort((a, b) => a - b));

/**
 * A valid recording of version 1 or 2, as the record script would write it.
 * Progress follows the same model as progressModel.test.ts: before the first
 * failure `cases` follows executions; from it on `cases` is the failure's
 * position and the phase is `shrinking`. Version 1 drops `cases` and `phase`,
 * and a diverged result may lack its Shrink_Path; version 2 always has one.
 */
const validRecording = fc
  .record({
    version: fc.constantFrom(...RECORDING_VERSIONS),
    numRuns: fc.integer({ min: 1, max: 2000 }),
    program: fc.string({ minLength: 1, maxLength: 10 }),
    mutant: fc.option(fc.string({ maxLength: 10 }), { nil: undefined }),
    seed: fc.integer(),
    reference: fc.string({ maxLength: 20 }),
    generatedAt: fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }).map((d) => d.toISOString()),
    durationMs: fc.nat({ max: 10_000 }),
    shrinks: fc.nat({ max: 200 }),
    truncated: fc.boolean(),
    withPath: fc.boolean(),
    last: stepRecords,
    first: stepRecords,
    cobol: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
    port: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
    column: fc.nat({ max: 80 }),
  })
  .chain((base) =>
    fc.record({
      base: fc.constant(base),
      failAt: fc.option(fc.integer({ min: 1, max: base.numRuns }), { nil: null }),
      shrinkAttempts: fc.nat({ max: 300 }),
      points: fc.uniqueArray(fc.nat({ max: base.numRuns + 300 }), { maxLength: MAX_RECORDED_EVENTS - 2 }),
      middle: interiorSteps(base.shrinks).chain((idx) =>
        fc.tuple(...idx.map((step) => stepRecords.map((r): ShrinkStep => ({ step, ...r })))),
      ),
    }),
  )
  .map(({ base, failAt, shrinkAttempts, points, middle }) => {
    const { version, numRuns, program, mutant, seed, reference, generatedAt, durationMs, shrinks, last } = base;
    const started = { type: 'started' as const, program, ...(mutant === undefined ? {} : { mutant }), seed, reference, numRuns };
    const total = failAt === null ? numRuns : failAt + shrinkAttempts;
    const executions = [...new Set(points.map((p) => Math.min(p, total)))].sort((a, b) => a - b);
    const progress = executions.map((e) => {
      const shrinking = failAt !== null && e >= failAt;
      const event = {
        type: 'progress' as const,
        executions: e,
        divergences: shrinking ? 1 + Math.floor((e - failAt) / 2) : 0,
        elapsedMs: e * 0.3,
      };
      return version === 1 ? event : { ...event, cases: shrinking ? failAt : e, phase: shrinking ? 'shrinking' : 'generating' };
    });
    const common = { program, reference, generatedAt, seed, durationMs };
    let result: EquivalenceResult;
    if (failAt === null) {
      result = { ...common, status: 'equivalent', cases: numRuns, shrinks: 0 };
    } else {
      const lastStep: ShrinkStep = { step: shrinks, ...last };
      const steps = shrinks === 0 ? [lastStep] : [{ step: 0, ...base.first }, ...middle, lastStep];
      result = {
        ...common,
        status: 'diverged',
        cases: failAt,
        shrinks,
        ...(base.truncated ? { truncated: true as const } : {}),
        counterexample: { records: [...last.records], cobol: base.cobol, port: base.port, line: last.line, column: base.column },
        ...(version === 2 || base.withPath ? { shrinkPath: { total: shrinks + 1, steps } } : {}),
      };
    }
    return { version, events: [started, ...progress, { type: 'result' as const, result }], started, progress, result };
  });

describe('Property 7: Recording round trip for both versions', () => {
  /** **Validates: Requirements 3.4, 3.6** */
  it('parses a serialised valid recording back to the same events, and rejects any other version', () => {
    fc.assert(
      fc.property(
        validRecording,
        fc.oneof(fc.integer(), fc.double(), fc.string(), fc.constant(null)).filter((v) => !RECORDING_VERSIONS.includes(v as number)),
        ({ version, events, started, progress, result }, otherVersion) => {
          const file = JSON.parse(JSON.stringify({ version, events })) as unknown;
          expect(parseRecording(file, { program: started.program, mutant: started.mutant ?? null })).toEqual({
            started,
            progress,
            result,
          });
          expect(parseRecording({ ...(file as object), version: otherVersion })).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });
});

/**
 * The files scripts/record-proofs.ts wrote must parse in the browser. Skipped while
 * web/public/recorded/ holds no recordings; completeness is checked by
 * scripts/record-proofs.test.ts at the root.
 */
const shipped = Object.entries(
  import.meta.glob<unknown>('../../../public/recorded/*.json', { eager: true, import: 'default' }),
).map(([path, value]) => [path.slice(path.lastIndexOf('/') + 1), value] as const);

describe.skipIf(shipped.length === 0)('shipped recordings', () => {
  it.each(shipped)('%s parses as the recording its name says', (name, value) => {
    const [program = '', mutant] = name.replace(/\.json$/, '').split('.');
    expect(parseRecording(value, { program, mutant: mutant ?? null })).not.toBeNull();
  });
});

describe('fetchRecording', () => {
  /** A server that accepts the request and never answers; the request ends only when aborted. */
  function stubSilentServer() {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
          ),
      ),
    );
  }
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('gives up on a server that never answers, so a replay ends instead of waiting for ever', async () => {
    vi.useFakeTimers();
    stubSilentServer();
    let settled: Recording | null | 'pending' = 'pending';
    void fetchRecording({ program: 'PAYROLL' }).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(RECORDING_TIMEOUT_MS - 1);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeNull();
  });

  it("still rejects when the caller's signal aborts", async () => {
    stubSilentServer();
    const caller = new AbortController();
    const pending = fetchRecording({ program: 'PAYROLL' }, caller.signal);
    caller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });
});
