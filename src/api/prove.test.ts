import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findMutant, findProgram, type Program } from '../ports/registry.js';
import {
  MAX_BODY_BYTES,
  PROGRESS_INTERVAL_MS,
  PROVE_NUM_RUNS,
  PROVE_TIME_LIMIT_MS,
  REFERENCE_LABELS,
  RUN_FAILED_MESSAGE,
  parseProveRequest,
  prove,
  type ProveEvent,
  type ProveOptions,
  type ProveRequest,
  type ProveSession,
} from './prove.js';

function program(id: string): Program {
  const found = findProgram(id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

/**
 * Stands in for GnuCOBOL by answering with the real port after `delayMs`, so
 * the real port is equivalent and any non-equivalent mutant diverges.
 */
function fakeSession(target: Program, delayMs: number) {
  const session = {
    sends: 0,
    closed: false,
    send: async (records: readonly string[]) => {
      session.sends++;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return records.map(target.port);
    },
    close: async () => {
      session.closed = true;
      return 0;
    },
  };
  return session;
}

function run(request: ProveRequest, session: ProveSession, options: ProveOptions = {}) {
  const events: ProveEvent[] = [];
  const controller = new AbortController();
  const outcome = prove(request, (e) => events.push(e), controller.signal, {
    startSession: () => session,
    ...options,
  });
  return { events, controller, outcome };
}

const ofType = <T extends ProveEvent['type']>(events: ProveEvent[], type: T) =>
  events.filter((e): e is Extract<ProveEvent, { type: T }> => e.type === type);

beforeEach(() => {
  // The harness honours these overrides; keep them out of unit tests.
  vi.stubEnv('LAZARUS_RUNS', '');
  vi.stubEnv('LAZARUS_SEED', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('parseProveRequest', () => {
  it('accepts a known program with optional mutant and seed', () => {
    const minimal = parseProveRequest('{"program":"PAYROLL"}');
    expect(minimal.ok && minimal.request.program.id).toBe('PAYROLL');
    expect(minimal.ok && 'mutant' in minimal.request).toBe(false);

    const full = parseProveRequest('{"program":"PAYROLL","mutant":"half-up-tax","seed":-123}');
    expect(full.ok && full.request.mutant?.id).toBe('half-up-tax');
    expect(full.ok && full.request.seed).toBe(-123);
  });

  it.each([
    ['missing body', undefined],
    ['empty body', ''],
    ['not JSON', '{program:PAYROLL}'],
    ['JSON array', '["PAYROLL"]'],
    ['JSON string', '"PAYROLL"'],
    ['null', 'null'],
    ['missing program', '{}'],
    ['unknown program', '{"program":"PAYROLL2"}'],
    ['lower-case program', '{"program":"payroll"}'],
    ['inherited key as program', '{"program":"constructor"}'],
    ['non-string program', '{"program":1}'],
    ['unknown mutant', '{"program":"PAYROLL","mutant":"nope"}'],
    ['mutant of another program', '{"program":"PAYROLL","mutant":"half-up-vat"}'],
    ['null mutant', '{"program":"PAYROLL","mutant":null}'],
    ['non-integer seed', '{"program":"PAYROLL","seed":1.5}'],
    ['string seed', '{"program":"PAYROLL","seed":"1"}'],
    ['seed above int32', '{"program":"PAYROLL","seed":2147483648}'],
    ['client-chosen case count', '{"program":"PAYROLL","numRuns":100000}'],
    ['prototype key', '{"program":"PAYROLL","__proto__":{"x":1}}'],
    ['body over 1 KB', JSON.stringify({ program: 'PAYROLL', pad: 'x'.repeat(MAX_BODY_BYTES) })],
  ])('rejects %s with 400', (_name, body) => {
    const parsed = parseProveRequest(body);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.status).toBe(400);
  });

  it('measures the size limit in UTF-8 bytes', () => {
    // 3-byte characters: under 1,024 characters but over 1,024 bytes.
    const body = `{"program":"PAYROLL","x":"${'€'.repeat(340)}"}`;
    expect(body.length).toBeLessThan(MAX_BODY_BYTES);
    expect(parseProveRequest(body)).toMatchObject({ ok: false, message: expect.stringContaining('bytes') });
  });
});

describe('prove', () => {
  it('emits started, a final progress and an equivalent result for a fast run', async () => {
    const payroll = program('PAYROLL');
    const session = fakeSession(payroll, 0);
    const { events, outcome } = run({ program: payroll, seed: 42 }, session, { runner: 'native' });

    expect(await outcome).toMatchObject({ status: 'completed' });
    expect(events[0]).toEqual({
      type: 'started',
      program: 'PAYROLL',
      seed: 42,
      reference: REFERENCE_LABELS.native,
      numRuns: PROVE_NUM_RUNS,
    });
    const [last, beforeLast] = [events.at(-1), events.at(-2)];
    expect(beforeLast).toMatchObject({ type: 'progress', executions: PROVE_NUM_RUNS, divergences: 0 });
    expect(last).toMatchObject({
      type: 'result',
      result: { status: 'equivalent', cases: PROVE_NUM_RUNS, seed: 42, reference: REFERENCE_LABELS.native },
    });
    expect(last?.type === 'result' && 'truncated' in last.result).toBe(false);
    expect(session.closed).toBe(true);
  });

  it('proves the mutant port instead of the real port when a mutant is chosen', async () => {
    const payroll = program('PAYROLL');
    const mutant = findMutant(payroll, 'half-up-tax');
    const { events, outcome } = run({ program: payroll, ...(mutant ? { mutant } : {}), seed: 7 }, fakeSession(payroll, 0));

    expect(await outcome).toMatchObject({ status: 'completed', result: { status: 'diverged' } });
    expect(events[0]).toMatchObject({ type: 'started', mutant: 'half-up-tax' });
    expect(ofType(events, 'result')[0]?.result.counterexample).toBeDefined();
  });

  it('emits progress every 250 ms while running (4 Hz)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    const payroll = program('PAYROLL');
    const { events, controller, outcome } = run({ program: payroll, seed: 1 }, fakeSession(payroll, 5));

    await vi.advanceTimersByTimeAsync(1000);
    const progress = ofType(events, 'progress');
    expect(progress.map((p) => p.elapsedMs)).toEqual([250, 500, 750, 1000]);
    const executions = progress.map((p) => p.executions);
    expect(executions).toEqual([...executions].sort((a, b) => a - b));
    expect(executions[0]).toBeGreaterThan(0);
    expect(PROGRESS_INTERVAL_MS).toBe(250);

    controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toEqual({ status: 'cancelled' });
  });

  it('stops at 25 s and returns a truncated equivalent result with the cases reached', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    const payroll = program('PAYROLL');
    // 20 ms per case: 2,000 cases would take 40 s.
    const session = fakeSession(payroll, 20);
    const { events, outcome } = run({ program: payroll, seed: 3 }, session);

    await vi.advanceTimersByTimeAsync(PROVE_TIME_LIMIT_MS + 100);
    const result = await outcome;
    expect(result).toMatchObject({ status: 'truncated', result: { status: 'equivalent', truncated: true } });
    const cases = result.status === 'truncated' ? result.result.cases : -1;
    expect(cases).toBeGreaterThan(1000);
    expect(cases).toBeLessThan(PROVE_NUM_RUNS);
    expect(events.at(-2)).toMatchObject({ type: 'progress', executions: cases });
    expect(events.at(-1)).toMatchObject({ type: 'result', result: { cases, truncated: true } });
    expect(session.closed).toBe(true);
  });

  it('cancels when the signal aborts: no result, session closed, no events afterwards', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    const payroll = program('PAYROLL');
    const session = fakeSession(payroll, 5);
    const { events, controller, outcome } = run({ program: payroll }, session);

    await vi.advanceTimersByTimeAsync(300);
    controller.abort();
    const countAtAbort = events.length;
    await vi.advanceTimersByTimeAsync(5000);

    expect(await outcome).toEqual({ status: 'cancelled' });
    expect(events.length).toBe(countAtAbort);
    expect(ofType(events, 'result')).toHaveLength(0);
    expect(session.closed).toBe(true);
    expect(session.sends).toBeLessThan(100);
  });

  it('cancels even while a COBOL call never answers', async () => {
    let closed = false;
    const hung: ProveSession = { send: () => new Promise(() => {}), close: async () => ((closed = true), 0) };
    const { controller, outcome } = run({ program: program('INTCALC') }, hung);

    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    expect(await outcome).toEqual({ status: 'cancelled' });
    expect(closed).toBe(true);
  });

  it('does not start a session when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const startSession = vi.fn();
    const events: ProveEvent[] = [];
    const outcome = await prove({ program: program('INVOICE') }, (e) => events.push(e), controller.signal, { startSession });
    expect(outcome).toEqual({ status: 'cancelled' });
    expect(startSession).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('reports a crashed COBOL run as an error event, not a divergence', async () => {
    let closed = false;
    const crashing: ProveSession = {
      send: async () => {
        throw new Error('INTCALC exited with code 139. stderr: /opt/lazarus/bin secret detail');
      },
      close: async () => ((closed = true), 139),
    };
    const { events, outcome } = run({ program: program('INTCALC') }, crashing);

    expect(await outcome).toMatchObject({ status: 'failed', error: expect.any(Error) });
    expect(events.at(-1)).toEqual({ type: 'error', message: RUN_FAILED_MESSAGE });
    expect(ofType(events, 'result')).toHaveLength(0);
    expect(closed).toBe(true);
  });

  it('reports a session that cannot start as an error event', async () => {
    const events: ProveEvent[] = [];
    const outcome = await prove({ program: program('INTCALC') }, (e) => events.push(e), new AbortController().signal, {
      startSession: () => {
        throw new Error('COBOL binary not found: /opt/lazarus/bin/INTCALC');
      },
    });
    expect(outcome.status).toBe('failed');
    expect(events).toEqual([{ type: 'error', message: RUN_FAILED_MESSAGE }]);
  });
});
