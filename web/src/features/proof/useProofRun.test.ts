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
import { activePlaybackClock, createPlaybackClock } from './playbackClock';
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

  it('tracks cases and phase and ignores progress that conflicts with the run (graphical-proof 1.7)', async () => {
    const stream = fakeStream();
    stubFetch(() => stream);
    const done = state().start('PAYROLL', 'half-up-tax');
    stream.send(STARTED, { type: 'progress', executions: 30, divergences: 0, cases: 30, phase: 'generating', elapsedMs: 100 });
    await vi.waitFor(() => expect(state()).toMatchObject({ cases: 30, phase: 'generating' }));

    stream.send(
      { type: 'progress', executions: 45, divergences: 3, cases: 37, phase: 'shrinking', elapsedMs: 150 },
      // Each of these conflicts with the run so far and is ignored.
      { type: 'progress', executions: 50, divergences: 3, cases: 2001, phase: 'shrinking', elapsedMs: 160 },
      { type: 'progress', executions: 50, divergences: 3, cases: 36, phase: 'shrinking', elapsedMs: 170 },
      { type: 'progress', executions: 50, divergences: 3, cases: 37, phase: 'generating', elapsedMs: 180 },
      { type: 'progress', executions: 49, divergences: 13, cases: 37, phase: 'shrinking', elapsedMs: 240 },
      { type: 'result', result: DIVERGED_RESULT },
    );
    await done;
    expect(state()).toMatchObject({ status: 'relapsed', executions: 49, divergences: 13, cases: 37, phase: 'shrinking', elapsedMs: 240 });
  });

  it('derives cases and phase for an older server and takes the final cases from the result (graphical-proof 1.8)', async () => {
    const stream = fakeStream();
    stubFetch(() => stream);
    const done = state().start('PAYROLL');
    stream.send(STARTED, { type: 'progress', executions: 412, divergences: 0, elapsedMs: 250 });
    await vi.waitFor(() => expect(state()).toMatchObject({ cases: 412, phase: 'generating' }));
    stream.send({ type: 'progress', executions: 1990, divergences: 0, elapsedMs: 1300 }, { type: 'result', result: EQUIVALENT_RESULT });
    await done;
    expect(state()).toMatchObject({ status: 'alive', executions: 1990, cases: 2000, phase: 'generating' });
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
    expect(state()).toMatchObject({ status: 'reanimating', executions: 20, divergences: 0, elapsedMs: 100, cases: 20, phase: 'generating' });
    const seen: object[] = [];
    const unsubscribe = useProofRun.subscribe(({ status, executions, cases, phase }) => seen.push({ status, executions, cases, phase }));
    await vi.advanceTimersByTimeAsync(140);
    await done;
    unsubscribe();
    // Version 1 recording: shrinking once a divergence shows, cases frozen until the result.
    expect(seen[0]).toEqual({ status: 'reanimating', executions: 49, cases: 20, phase: 'shrinking' });
    expect(state()).toMatchObject({
      status: 'relapsed',
      source: 'recorded',
      executions: 49,
      divergences: 1,
      cases: 37,
      phase: 'shrinking',
      result: DIVERGED_RESULT,
    });
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

  it('replays an explicit target in slow motion on a pausable clock, keeping recorded elapsed times (graphical-proof 11.7, 13.5)', async () => {
    serveFiles({ '/recorded/PAYROLL.half-up-tax.json': DIVERGED_FILE });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const clock = createPlaybackClock({ rate: 1 / 40, now: () => Date.now() });

    const done = state().replayRecorded({ program: 'PAYROLL', mutant: 'half-up-tax' }, { rate: 1 / 40, clock });
    expect(activePlaybackClock()).toBe(clock);
    // Not `vi.waitFor`: it advances fake timers, which would move the clock after it starts.
    for (let i = 0; i < 50 && state().recordedAt === null; i++) await vi.advanceTimersByTimeAsync(0);
    expect(state().recordedAt).not.toBeNull();

    // Recorded 100 ms shows at 4000 ms of display time.
    await vi.advanceTimersByTimeAsync(3990);
    expect(state().executions).toBe(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(state()).toMatchObject({ executions: 20, elapsedMs: 100 });

    // Paused time does not count: recorded 240 ms is still 5600 ms of display time away.
    clock.pause();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state()).toMatchObject({ status: 'reanimating', executions: 20 });
    clock.resume();
    await vi.advanceTimersByTimeAsync(5590);
    expect(state().executions).toBe(20);
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(state()).toMatchObject({ status: 'relapsed', source: 'recorded', mutant: 'half-up-tax', executions: 49, elapsedMs: 240 });

    state().reset();
    expect(activePlaybackClock()).toBeNull();
  });

  it('rejects a rate that does not match the clock, and a rate alone gets its own clock', async () => {
    serveFiles({ '/recorded/PAYROLL.json': recordingOf({ ...EQUIVALENT_RESULT, durationMs: 1 }) });
    const clock = createPlaybackClock({ rate: 1 / 20 });
    await expect(state().replayRecorded({ program: 'PAYROLL', mutant: null }, { rate: 1 / 40, clock })).rejects.toThrow(RangeError);
    expect(state().status).toBe('idle');

    const done = state().replayRecorded({ program: 'PAYROLL', mutant: null }, { rate: 1 / 20 });
    expect(activePlaybackClock()?.rate).toBe(1 / 20);
    await done;
    expect(state().status).toBe('alive');
  });

  it('does nothing before any run', async () => {
    const { fetchMock } = stubFetch(() => jsonResponse(404, {}));
    await state().replayRecorded();
    expect(state().status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useProofRun.revive (graphical-proof Requirement 10.2, 10.4)', () => {
  const REAL_FILE = recordingOf({ ...EQUIVALENT_RESULT, durationMs: 50 });

  /** Leave the store Relapsed after a live run of the half-up-tax mutant. */
  async function relapse() {
    state().selectMutant('half-up-tax');
    const stream = fakeStream();
    stubFetch(() => stream);
    stream.send(STARTED, { type: 'result', result: DIVERGED_RESULT });
    await state().start('PAYROLL', 'half-up-tax');
    expect(state()).toMatchObject({ status: 'relapsed', mutant: 'half-up-tax' });
  }

  /** `/api/prove` answers with `prove()`; recordings are served from `files`. */
  function route(prove: () => Promise<Response> | Response, files: Record<string, unknown> = {}) {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url === '/api/prove') return prove();
        return url in files ? jsonResponse(200, files[url]) : jsonResponse(404, {});
      }),
    );
    return urls;
  }

  it('selects No sabotage and proves the real port live, then sets revivedAt on Alive', async () => {
    await relapse();
    const stream = fakeStream();
    const { calls } = stubFetch(() => stream);
    stream.send(STARTED, { type: 'result', result: EQUIVALENT_RESULT });
    const done = state().revive();
    expect(state()).toMatchObject({ selectedMutant: null, mutant: null, status: 'reanimating', revival: { pending: true, revivedAt: null } });
    await done;
    expect(new TextDecoder().decode(calls[0]?.init.body as Uint8Array)).toBe('{"program":"PAYROLL"}');
    expect(state()).toMatchObject({ status: 'alive', source: 'live', revival: { pending: false } });
    expect(state().revival.revivedAt).toEqual(expect.any(Number));
  });

  it('tries live first after a recorded relapse, and replays the real port only when the live run fails', async () => {
    await relapse();
    serveFiles({ '/recorded/PAYROLL.half-up-tax.json': recordingOf(DIVERGED_RESULT, { mutant: 'half-up-tax' }) });
    await state().replayRecorded();
    expect(state()).toMatchObject({ status: 'relapsed', source: 'recorded' });

    const urls = route(() => Promise.reject(new TypeError('Failed to fetch')), { '/recorded/PAYROLL.json': REAL_FILE });
    await state().revive();
    expect(urls).toEqual(['/api/prove', '/recorded/PAYROLL.json']);
    expect(state()).toMatchObject({ status: 'alive', source: 'recorded', mutant: null, revival: { pending: false } });
    expect(state().revival.revivedAt).toEqual(expect.any(Number));
  });

  it('replays the recording without calling the Proof_API in Demo_Mode', async () => {
    await relapse();
    const urls = route(() => jsonResponse(500, {}), { '/recorded/PAYROLL.json': REAL_FILE });
    await state().revive({ recorded: true });
    expect(urls).toEqual(['/recorded/PAYROLL.json']);
    expect(state()).toMatchObject({ status: 'alive', source: 'recorded', selectedMutant: null });
    expect(state().revival.revivedAt).toEqual(expect.any(Number));
  });

  it('passes a Demo_Mode rate to the recorded replay, which implies recorded (11.3)', async () => {
    await relapse();
    const urls = route(() => jsonResponse(500, {}), { '/recorded/PAYROLL.json': recordingOf({ ...EQUIVALENT_RESULT, durationMs: 1 }) });
    const done = state().revive({ rate: 1 / 20 });
    expect(activePlaybackClock()?.rate).toBe(1 / 20);
    await done;
    expect(urls).toEqual(['/recorded/PAYROLL.json']);
    expect(state()).toMatchObject({ status: 'alive', source: 'recorded', mutant: null });
    expect(state().revival.revivedAt).toEqual(expect.any(Number));
  });

  it('leaves revivedAt null when the revive run does not end Alive (10.4)', async () => {
    await relapse();
    route(() => jsonResponse(503, { error: 'Service Unavailable' }));
    await state().revive();
    expect(state()).toMatchObject({ status: 'error', error: { kind: 'recorded' }, revival: { pending: false, revivedAt: null } });

    await relapse();
    const stream = fakeStream();
    stubFetch(() => stream);
    stream.send(STARTED, { type: 'result', result: DIVERGED_RESULT });
    await state().revive();
    expect(state()).toMatchObject({ status: 'relapsed', revival: { pending: false, revivedAt: null } });
  });

  it('is abandoned by a newer run, which clears the revive state', async () => {
    await relapse();
    const stream = fakeStream();
    stream.send(STARTED, { type: 'result', result: EQUIVALENT_RESULT });
    const streams = [fakeStream(), stream];
    const { calls } = stubFetch(() => streams.shift()!);
    const done = state().revive();
    expect(state().revival.pending).toBe(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await state().start('PAYROLL');
    await done;
    expect(state()).toMatchObject({ status: 'alive', revival: { pending: false, revivedAt: null } });
  });
});
