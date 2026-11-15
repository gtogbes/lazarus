// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activePlaybackClock } from '../proof/playbackClock';
import { jsonResponse } from '../proof/testing';
import { useProofRun } from '../proof/useProofRun';
import { DEMO_SCRIPT } from './demoScript';
import { useDemo } from './useDemo';

const recordedDir = new URL('../../../public/recorded/', import.meta.url);
const committed = (file: string): unknown => JSON.parse(readFileSync(new URL(file, recordedDir), 'utf8'));

const demo = () => useDemo.getState();
const proof = () => useProofRun.getState();

/** Serves the committed recordings at `/recorded/<file>`; `missing` files are 404s. Records every URL. */
function serveRecorded(missing: readonly string[] = []) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const file = url.replace(/^\/recorded\//, '');
      if (!url.startsWith('/recorded/') || missing.includes(file)) return jsonResponse(404, {});
      return jsonResponse(200, committed(file));
    }),
  );
  return urls;
}

/** Display time at which each step started, from the (fake) performance clock. */
function stepStarts() {
  const starts: [string, number][] = [];
  const unsubscribe = useDemo.subscribe((state, previous) => {
    if (state.stepIndex !== previous.stepIndex && state.stepIndex >= 0) {
      starts.push([state.script[state.stepIndex]!.id, performance.now()]);
    }
  });
  return { starts, unsubscribe };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
});

afterEach(() => {
  demo().exit();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useDemo', () => {
  it('plays the whole story from recordings in 130 s, without calling the Proof_API (11.2, 11.3, 11.12)', async () => {
    const urls = serveRecorded();
    const { starts, unsubscribe } = stepStarts();
    const t0 = performance.now();
    const done = demo().run();

    await advance(30_000);
    expect(demo()).toMatchObject({ stepIndex: 2, cue: { kind: 'vitals' } });
    expect(activePlaybackClock()?.rate).toBe(1 / 40);
    await advance(40_000);
    expect(proof()).toMatchObject({ status: 'alive', source: 'recorded', mutant: null, cases: 2000 });
    await advance(10_000);
    expect(proof()).toMatchObject({ status: 'relapsed', mutant: 'half-up-tax', source: 'recorded' });
    await advance(50_000);
    await done;
    unsubscribe();

    expect(demo()).toMatchObject({ running: false, done: true, error: null, stepIndex: DEMO_SCRIPT.length - 1 });
    expect(proof()).toMatchObject({ status: 'alive', mutant: null, selectedMutant: null });
    expect(proof().revival.revivedAt).toEqual(expect.any(Number));
    expect(starts.map(([id, at]) => [id, Math.round((at - t0) / 1000)])).toEqual([
      ['program', 0],
      ['stitches', 8],
      ['prove-real', 30],
      ['sabotage', 70],
      ['prove-mutant', 74],
      ['shrink', 80],
      ['autopsy', 90],
      ['revive', 110],
    ]);
    expect(urls.every((url) => url.startsWith('/recorded/'))).toBe(true);
    expect(new Set(urls)).toEqual(new Set(['/recorded/PAYROLL.json', '/recorded/PAYROLL.half-up-tax.json']));
    expect(demo().recordings['PAYROLL.json']).toMatchObject({ durationMs: expect.any(Number), recordedAt: expect.any(String) });
  });

  it('holds the replay, the step and the active clock while paused, and resumes from the same point (11.7)', async () => {
    serveRecorded();
    void demo().run();
    await advance(40_000); // 10 s into prove-real: the 1/40 replay is mid-run
    const mid = proof().executions;
    expect(proof().status).toBe('reanimating');
    demo().pause();
    const frozen = activePlaybackClock()!.now();
    await advance(60_000);
    expect(demo()).toMatchObject({ paused: true, stepIndex: 2 });
    expect(proof().executions).toBe(mid);
    expect(activePlaybackClock()!.now()).toBe(frozen);

    demo().resume();
    await advance(29_000); // 39 s into the step
    expect(demo().stepIndex).toBe(2);
    expect(proof().status).toBe('alive');
    await advance(1_000);
    expect(demo().stepIndex).toBe(3);
  });

  it('skips to the next step with the replay at its recorded result', async () => {
    serveRecorded();
    void demo().run();
    await advance(31_000);
    expect(proof().status).toBe('reanimating');
    demo().skip();
    await advance(0);
    expect(proof()).toMatchObject({ status: 'alive', cases: 2000 });
    expect(demo().stepIndex).toBe(3);
    expect(proof().selectedMutant).toBe('half-up-tax');

    // A skip while paused moves on and stays paused.
    demo().exit();
    void demo().run();
    await advance(9_000);
    demo().pause();
    demo().skip();
    await advance(0);
    expect(demo()).toMatchObject({ stepIndex: 2, paused: true });
  });

  it('stops, resets the proof store and does nothing more on exit (11.8)', async () => {
    serveRecorded();
    void demo().run();
    await advance(75_000); // in prove-mutant
    expect(proof().status).toBe('reanimating');
    demo().exit();
    expect(demo()).toMatchObject({ running: false, stepIndex: -1, cue: null });
    expect(proof()).toMatchObject({ status: 'idle', selectedMutant: null });
    expect(activePlaybackClock()).toBeNull();
    await advance(60_000);
    expect(demo().stepIndex).toBe(-1);
    expect(proof().status).toBe('idle');
  });

  it('replays the recordings it checked, so a server that stops answering after the load cannot stall a step', async () => {
    // Each file is served once; any later request is accepted and never answered (a stopped dev server).
    const served = new Set<string>();
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        urls.push(url);
        const file = url.replace(/^\/recorded\//, '');
        if (!served.has(file)) {
          served.add(file);
          return Promise.resolve(jsonResponse(200, committed(file)));
        }
        return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }),
    );
    const done = demo().run();
    await advance(31_000); // 1 s into prove-real: the replay already knows the run
    expect(proof()).toMatchObject({ status: 'reanimating', run: { numRuns: 2000 } });
    await advance(100_000);
    await done;
    expect(demo()).toMatchObject({ running: false, done: true, error: null });
    expect(proof().status).toBe('alive');
    expect(urls).toHaveLength(2);
  });

  it('stops before the first step and names a missing recording (11.11)', async () => {
    serveRecorded(['PAYROLL.half-up-tax.json']);
    await demo().run();
    expect(demo()).toMatchObject({
      running: false,
      stepIndex: -1,
      error: { recording: 'recorded/PAYROLL.half-up-tax.json', message: expect.stringContaining('recorded/PAYROLL.half-up-tax.json') },
    });
    expect(proof().status).toBe('idle');
  });
});
