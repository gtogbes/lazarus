import { Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findProgram } from '../ports/registry.js';
import type { LogEntry } from './log.js';
import { createProveHandler, handler, LAMBDA_PROVE_OPTIONS, type FunctionUrlEvent, type ResponseMetadata } from './lambda.js';
import { MAX_BODY_BYTES, RUN_FAILED_MESSAGE, type prove, type ProveSession } from './prove.js';

const payroll = findProgram('PAYROLL');
if (!payroll) throw new Error('missing PAYROLL');

/**
 * Stands in for the runtime's response stream and `HttpResponseStream.from`.
 * Like aws-lambda-ric 4.0.2, the prelude (status and headers) is only sent by
 * the first `write()` call; data passed straight to `end(chunk)` skips it.
 */
function fakeResponse() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  let pending: ResponseMetadata | undefined;
  const write = stream.write.bind(stream);
  stream.write = ((chunk: string) => {
    if (pending) {
      res.metadata = pending;
      pending = undefined;
    }
    return write(chunk);
  }) as Writable['write'];
  const res = {
    stream,
    metadata: undefined as ResponseMetadata | undefined,
    text: () => chunks.join(''),
    lines: () => chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>),
    from: (s: Writable, metadata: ResponseMetadata) => {
      if (res.metadata || pending) throw new Error('prelude set twice');
      pending = metadata;
      return s;
    },
  };
  return res;
}

/** GnuCOBOL stand-in that answers with the real port, so PAYROLL is equivalent. */
function portSession(): ProveSession & { closed: boolean } {
  const session = {
    closed: false,
    send: async (records: readonly string[]) => records.map((r) => payroll!.port(r)),
    close: async () => {
      session.closed = true;
      return 0;
    },
  };
  return session;
}

const SECRET_BODY = JSON.stringify({ program: 'PAYROLL', seed: 424242 });

function event(overrides: Partial<FunctionUrlEvent> = {}): FunctionUrlEvent {
  return {
    rawPath: '/api/prove',
    headers: { 'content-type': 'application/json' },
    body: SECRET_BODY,
    isBase64Encoded: false,
    requestContext: { http: { method: 'POST', path: '/api/prove' } },
    ...overrides,
  };
}

const context = { awsRequestId: 'req-123' };
let logs: LogEntry[];

function setup(deps: { session?: ProveSession; prove?: typeof prove } = {}) {
  const res = fakeResponse();
  const h = createProveHandler({
    from: res.from,
    log: (entry) => logs.push(entry),
    ...(deps.prove ? { prove: deps.prove } : {}),
    proveOptions: { ...LAMBDA_PROVE_OPTIONS, startSession: () => deps.session ?? portSession() },
  });
  return { res, invoke: (e: FunctionUrlEvent) => h(e, res.stream, context) };
}

beforeEach(() => {
  logs = [];
  vi.stubEnv('LAZARUS_RUNS', '');
  vi.stubEnv('LAZARUS_SEED', '');
});

describe('Lambda proof handler', () => {
  it('is only wired to the runtime inside Lambda', () => {
    expect(handler).toBeUndefined();
    expect(LAMBDA_PROVE_OPTIONS).toMatchObject({ runner: 'native', binDir: '/opt/lazarus/bin', reference: 'gnucobol 3.1.2 (native)' });
  });

  it('streams started, progress and an equivalent result as NDJSON with no-store', async () => {
    const { res, invoke } = setup();
    await invoke(event());
    expect(res.metadata).toEqual({
      statusCode: 200,
      headers: expect.objectContaining({
        'content-type': 'application/x-ndjson',
        'cache-control': 'no-store',
        'x-request-id': 'req-123',
      }) as Record<string, string>,
    });
    const lines = res.lines();
    expect(lines[0]).toMatchObject({ type: 'started', program: 'PAYROLL', seed: 424242, reference: 'gnucobol 3.1.2 (native)', numRuns: 2000 });
    expect(lines.at(-2)).toMatchObject({ type: 'progress', executions: 2000, divergences: 0 });
    expect(lines.at(-1)).toMatchObject({ type: 'result', result: { status: 'equivalent', cases: 2000, seed: 424242 } });
    expect(res.stream.writableEnded).toBe(true);
  });

  it('decodes a base64 body', async () => {
    const { res, invoke } = setup();
    await invoke(event({ body: Buffer.from(SECRET_BODY).toString('base64'), isBase64Encoded: true }));
    expect(res.metadata?.statusCode).toBe(200);
    expect(res.lines()[0]).toMatchObject({ type: 'started', seed: 424242 });
  });

  it.each([
    ['another path', event({ rawPath: '/api/other' }), 404, 'Not found'],
    ['another method', event({ requestContext: { http: { method: 'GET', path: '/api/prove' } } }), 405, 'Method not allowed'],
    ['a non-JSON content type', event({ headers: { 'content-type': 'text/plain' } }), 415, 'Content-Type must be application/json'],
    ['an unknown program', event({ body: '{"program":"NOPE"}' }), 400, 'Unknown program'],
    ['invalid JSON', event({ body: '{' }), 400, 'Request body must be JSON'],
    ['a missing body', (({ body: _omit, ...rest }) => rest)(event()), 400, 'Request body is required'],
    ['invalid base64 JSON', event({ body: Buffer.from('nope').toString('base64'), isBase64Encoded: true }), 400, 'Request body must be JSON'],
    ['a body over 1 KB', event({ body: ' '.repeat(MAX_BODY_BYTES + 1) }), 413, `Request body must be at most ${MAX_BODY_BYTES} bytes`],
    [
      'a base64 body over 1 KB',
      event({ body: Buffer.from(' '.repeat(MAX_BODY_BYTES + 1)).toString('base64'), isBase64Encoded: true }),
      413,
      `Request body must be at most ${MAX_BODY_BYTES} bytes`,
    ],
  ])('answers %s with a JSON error before streaming', async (_name, e, status, message) => {
    const { res, invoke } = setup();
    await invoke(e);
    expect(res.metadata?.statusCode).toBe(status);
    expect(res.metadata?.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.metadata?.headers['cache-control']).toBe('no-store');
    if (status === 405) expect(res.metadata?.headers.allow).toBe('POST');
    expect(JSON.parse(res.text())).toEqual({ error: message });
    expect(logs).toEqual([expect.objectContaining({ level: 'warn', msg: 'request rejected', requestId: 'req-123', status })]);
  });

  it('aborts the run when the response stream closes before the handler ends it', async () => {
    let seen: AbortSignal | undefined;
    const fakeProve: typeof prove = (_request, emit, signal) => {
      seen = signal;
      emit({ type: 'started', program: 'PAYROLL', seed: 1, reference: 'x', numRuns: 2000 });
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true }));
    };
    const { res, invoke } = setup({ prove: fakeProve });
    const done = invoke(event());
    await vi.waitFor(() => expect(seen).toBeDefined());
    res.stream.destroy();
    await done;
    expect(seen?.aborted).toBe(true);
    expect(logs.at(-1)).toMatchObject({ msg: 'proof cancelled', requestId: 'req-123', outcome: 'cancelled' });
  });

  it('sends only the generic message for a failed run and keeps the real error in the logs', async () => {
    const session: ProveSession = {
      send: () => Promise.reject(new Error('PAYROLL exited with code 139')),
      close: async () => 0,
    };
    const { res, invoke } = setup({ session });
    await invoke(event());
    expect(res.lines().at(-1)).toEqual({ type: 'error', message: RUN_FAILED_MESSAGE });
    expect(res.text()).not.toContain('139');
    const failed = logs.find((l) => l.msg === 'proof failed');
    expect(failed).toMatchObject({ level: 'error', requestId: 'req-123', error: { message: 'PAYROLL exited with code 139' } });
  });

  it('never logs the request body', async () => {
    await setup().invoke(event());
    await setup().invoke(event({ body: '{"program":"NOPE","secret":"hunter2"}' }));
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(SECRET_BODY);
    expect(logged).not.toContain('hunter2');
    expect(logs.every((l) => !('body' in l))).toBe(true);
    expect(logs.find((l) => l.msg === 'proof finished')).toMatchObject({ requestId: 'req-123', program: 'PAYROLL', seed: 424242, cases: 2000 });
  });
});
