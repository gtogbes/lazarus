import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIVERGED_RESULT,
  EQUIVALENT_RESULT,
  fakeStream,
  jsonResponse,
  recordingOf,
  serveFiles,
  STARTED,
  stubFetch,
} from './testing';
import { useProofRun } from './useProofRun';

const state = () => useProofRun.getState();

afterEach(() => {
  state().reset();
  vi.unstubAllGlobals();
});

describe('useProofRun', () => {
  it('goes reanimating, updates counters, then alive on an equivalent result (3.2, 3.3)', async () => {
    const stream = fakeStream();
    stubFetch(() => stream);
    const done = state().start('PAYROLL');
    expect(state()).toMatchObject({ status: 'reanimating', program: 'PAYROLL', mutant: null, executions: 0 });

    stream.send(STARTED, { type: 'progress', executions: 412, divergences: 0, elapsedMs: 250 });
    await vi.waitFor(() => expect(state().executions).toBe(412));
    expect(state()).toMatchObject({ status: 'reanimating', run: { seed: 42, numRuns: 2000 }, elapsedMs: 250 });

    stream.send({ type: 'progress', executions: 2000, divergences: 0, elapsedMs: 1400 });
    stream.send({ type: 'result', result: EQUIVALENT_RESULT });
    await done;
    expect(state()).toMatchObject({ status: 'alive', executions: 2000, elapsedMs: 1400, result: EQUIVALENT_RESULT, error: null });
  });

  it('handles a fast run that finishes before any progress tick', async () => {
    const stream = fakeStream();
    stubFetch(() => stream);
    stream.send(
      STARTED,
      { type: 'progress', executions: 2000, divergences: 0, elapsedMs: 140 },
      { type: 'result', result: { ...EQUIVALENT_RESULT, durationMs: 140 } },
    );
    stream.close();
    await state().start('PAYROLL');
    expect(state()).toMatchObject({ status: 'alive', executions: 2000, elapsedMs: 140 });
  });

  it('keeps a truncated run as alive with the truncated flag', async () => {
    const stream = fakeStream();
    stubFetch(() => stream);
    stream.send(STARTED, { type: 'result', result: { ...EQUIVALENT_RESULT, cases: 900, truncated: true } });
    await state().start('PAYROLL');
    expect(state().status).toBe('alive');
    expect(state().result?.truncated).toBe(true);
  });

  it('goes relapsed on a divergence and exposes the counterexample (3.4)', async () => {
    const stream = fakeStream();
    stubFetch(() => stream);
    stream.send({ ...STARTED, mutant: 'half-up-tax' }, { type: 'progress', executions: 50, divergences: 1, elapsedMs: 240 });
    stream.send({ type: 'result', result: DIVERGED_RESULT });
    await state().start('PAYROLL', 'half-up-tax');
    expect(state()).toMatchObject({ status: 'relapsed', mutant: 'half-up-tax', divergences: 1 });
    expect(state().result?.counterexample).toEqual(DIVERGED_RESULT.counterexample);
  });

  it('treats an error event as a failed run, never as relapsed', async () => {
    const stream = fakeStream();
    stubFetch(() => stream);
    stream.send(STARTED, { type: 'error', message: 'The proof run failed before it could finish.' });
    await state().start('PAYROLL');
    expect(state()).toMatchObject({ status: 'error', result: null, error: { kind: 'run' } });
  });

  it('goes to error with the status and message for an HTTP 400', async () => {
    stubFetch(() => jsonResponse(400, { error: 'Unknown mutant for this program' }));
    await state().start('PAYROLL', 'nope');
    expect(state()).toMatchObject({
      status: 'error',
      error: { kind: 'http', httpStatus: 400, message: 'Unknown mutant for this program' },
    });
  });

  it('goes to error when the network fails or the stream ends without a result', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await state().start('PAYROLL');
    expect(state().error?.kind).toBe('network');

    const stream = fakeStream();
    stubFetch(() => stream);
    stream.send(STARTED, { type: 'progress', executions: 3, divergences: 0, elapsedMs: 250 });
    stream.close();
    await state().start('PAYROLL');
    expect(state()).toMatchObject({ status: 'error', error: { kind: 'stream' }, executions: 3 });
  });

  it('cancel aborts the request and ignores anything that arrives later (3.5)', async () => {
    const stream = fakeStream();
    const { calls } = stubFetch(() => stream);
    const done = state().start('PAYROLL');
    stream.send(STARTED, { type: 'progress', executions: 10, divergences: 0, elapsedMs: 250 });
    await vi.waitFor(() => expect(state().executions).toBe(10));

    state().cancel();
    expect(state().status).toBe('cancelled');
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    stream.send({ type: 'result', result: EQUIVALENT_RESULT });
    await done;
    expect(state()).toMatchObject({ status: 'cancelled', executions: 10, result: null, error: null });
  });

  it('starting again abandons the previous run', async () => {
    const first = fakeStream();
    const second = fakeStream();
    const streams = [first, second];
    stubFetch(() => streams.shift() ?? fakeStream());
    const firstDone = state().start('PAYROLL');
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    const secondDone = state().start('INTCALC');
    first.send({ type: 'result', result: DIVERGED_RESULT });
    second.send({ type: 'result', result: { ...EQUIVALENT_RESULT, program: 'INTCALC' } });
    await Promise.all([firstDone, secondDone]);
    expect(state()).toMatchObject({ status: 'alive', program: 'INTCALC' });
  });

  it('keeps the sabotage selection across runs and clears it on reset (4.2)', async () => {
    const stream = fakeStream();
    const { calls } = stubFetch(() => stream);
    state().selectMutant('half-up-tax');
    const done = state().start('PAYROLL', 'half-up-tax');
    expect(state()).toMatchObject({ status: 'reanimating', mutant: 'half-up-tax', selectedMutant: 'half-up-tax' });
    // Changing the selection mid-run does not relabel the run in flight.
    state().selectMutant(null);
    expect(state()).toMatchObject({ mutant: 'half-up-tax', selectedMutant: null });
    state().selectMutant('half-up-tax');
    // Abort only once the request is out, as the fake stream fails on abort from then on.
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    state().reset();
    await done;
    expect(state()).toMatchObject({ status: 'idle', mutant: null, selectedMutant: null });
  });
});

describe('useProofRun.replayRecorded (Requirement 6)', () => {
  const DIVERGED_FILE = recordingOf(DIVERGED_RESULT, {
    mutant: 'half-up-tax',
    progress: [
      { type: 'progress', executions: 20, divergences: 0, elapsedMs: 100 },
      { type: 'progress', executions: 49, divergences: 1, elapsedMs: 240 },
    ],
  });

  /** A failed live run of PAYROLL with the given mutant, then a fetch that serves `files` by URL. */
  async function failLiveRun(mutant: string | undefined, files: Record<string, unknown>) {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await state().start('PAYROLL', mutant);
    expect(state()).toMatchObject({ status: 'error', source: 'live', error: { kind: 'network' } });
    return serveFiles(files);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays the recording for the same program and mutant through the live fields, at its pace', async () => {
    const fetchMock = await failLiveRun('half-up-tax', { '/recorded/PAYROLL.half-up-tax.json': DIVERGED_FILE });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const done = state().replayRecorded();
    expect(state()).toMatchObject({ status: 'reanimating', source: 'recorded', program: 'PAYROLL', mutant: 'half-up-tax', error: null });
    await vi.waitFor(() => expect(state().recordedAt).toBe(DIVERGED_RESULT.generatedAt));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/recorded/PAYROLL.half-up-tax.json');
    expect(state()).toMatchObject({ run: { seed: 42, numRuns: 2000 }, executions: 0 });

    await vi.advanceTimersByTimeAsync(100);
    expect(state()).toMatchObject({ status: 'reanimating', executions: 20, divergences: 0, elapsedMs: 100 });
    await vi.advanceTimersByTimeAsync(140);
    await done;
    expect(state()).toMatchObject({ status: 'relapsed', source: 'recorded', executions: 49, divergences: 1, result: DIVERGED_RESULT });
  });

  it('ends in a recorded error when there is no valid recording', async () => {
    await failLiveRun(undefined, { '/recorded/PAYROLL.json': { version: 1, events: [] } });
    await state().replayRecorded();
    expect(state()).toMatchObject({ status: 'error', source: 'recorded', result: null, error: { kind: 'recorded' } });
  });

  it('rejects a recording of another mutant under this name', async () => {
    await failLiveRun('ignore-size-error', { '/recorded/PAYROLL.ignore-size-error.json': DIVERGED_FILE });
    await state().replayRecorded();
    expect(state().error?.kind).toBe('recorded');
  });

  it('can be cancelled, and a new live run is live again', async () => {
    await failLiveRun('half-up-tax', { '/recorded/PAYROLL.half-up-tax.json': DIVERGED_FILE });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const done = state().replayRecorded();
    await vi.waitFor(() => expect(state().recordedAt).not.toBeNull());
    state().cancel();
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(state()).toMatchObject({ status: 'cancelled', source: 'recorded', executions: 0, result: null });

    vi.useRealTimers();
    const stream = fakeStream();
    stubFetch(() => stream);
    stream.send(STARTED, { type: 'result', result: EQUIVALENT_RESULT });
    await state().start('PAYROLL');
    expect(state()).toMatchObject({ status: 'alive', source: 'live', recordedAt: null });
  });

  it('does nothing before any run', async () => {
    const { fetchMock } = stubFetch(() => jsonResponse(404, {}));
    await state().replayRecorded();
    expect(state().status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
