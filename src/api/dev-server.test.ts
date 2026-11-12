import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findProgram } from '../ports/registry.js';
import { createDevServer, PROVE_PATH, type LogEntry } from './dev-server.js';
import { MAX_BODY_BYTES, RUN_FAILED_MESSAGE, type ProveSession } from './prove.js';

const payroll = findProgram('PAYROLL');
if (!payroll) throw new Error('missing PAYROLL');

/**
 * Answers with the real port, but the first `send` waits until `release()`,
 * so a test can observe the stream while the run is still in progress.
 */
function gatedSession() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const state = {
    closed: false,
    release,
    session: {
      send: async (records: readonly string[]) => {
        await gate;
        return records.map((r) => payroll!.port(r));
      },
      close: async () => {
        state.closed = true;
        return 0;
      },
    } satisfies ProveSession,
  };
  return state;
}

let server: Server;
let url: string;
let logs: LogEntry[];
let session: ProveSession;

async function start(): Promise<void> {
  logs = [];
  server = createDevServer({ prove: { startSession: () => session }, log: (entry) => logs.push(entry) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (body: string, init: RequestInit = {}) =>
  fetch(`${url}${PROVE_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, ...init });

/** Reads NDJSON lines as they arrive. */
function lineReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return async (): Promise<Record<string, unknown> | undefined> => {
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        return JSON.parse(line) as Record<string, unknown>;
      }
      const { value, done } = await reader.read();
      if (done) return undefined;
      buffer += decoder.decode(value, { stream: true });
    }
  };
}

async function waitForLog(msg: string): Promise<LogEntry> {
  await vi.waitFor(() => expect(logs.some((l) => l.msg === msg)).toBe(true), { timeout: 5000 });
  return logs.find((l) => l.msg === msg)!;
}

beforeEach(async () => {
  vi.stubEnv('LAZARUS_RUNS', '');
  vi.stubEnv('LAZARUS_SEED', '');
  session = gatedSession().session;
  await start();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('dev server: rejects client errors before streaming', () => {
  it.each([
    ['unknown program', '{"program":"NOPE"}'],
    ['unknown mutant', '{"program":"PAYROLL","mutant":"nope"}'],
    ['non-integer seed', '{"program":"PAYROLL","seed":1.5}'],
    ['client-chosen case count', '{"program":"PAYROLL","numRuns":9}'],
    ['not JSON', '{program'],
    ['empty body', ''],
  ])('400 for %s', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it('404 for another path, 405 for another method, 415 for a non-JSON content type', async () => {
    expect((await fetch(`${url}/api/other`, { method: 'POST' })).status).toBe(404);
    const get = await fetch(`${url}${PROVE_PATH}`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const text = await post('{"program":"PAYROLL"}', { headers: { 'content-type': 'text/plain' } });
    expect(text.status).toBe(415);
  });

  it('413 for a body over 1 KB, declared or chunked', async () => {
    const big = JSON.stringify({ program: 'PAYROLL', pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect((await post(big)).status).toBe(413);

    // Chunked, no Content-Length: the server stops reading once the limit is passed.
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${url}${PROVE_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' } });
      req.on('response', (res) => resolve(res.statusCode ?? 0)).on('error', reject);
      for (let i = 0; i < 4; i++) req.write('x'.repeat(512));
      // Never end the request: an unbounded sender must still get an answer.
    });
    expect(status).toBe(413);
  });

  it('never logs the request body', async () => {
    await post('{"program":"PAYROLL","secret":"hunter2"}');
    expect(JSON.stringify(logs)).not.toContain('hunter2');
    expect(logs[0]).toMatchObject({ level: 'warn', status: 400, requestId: expect.any(String) });
  });
});

describe('dev server: streams NDJSON', () => {
  it('sends started and progress lines while the run is in progress, then the result', async () => {
    const gated = gatedSession();
    session = gated.session;
    const res = await post('{"program":"PAYROLL","seed":42}');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-ndjson');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const next = lineReader(res.body!);
    expect(await next()).toMatchObject({ type: 'started', program: 'PAYROLL', seed: 42, numRuns: 2000 });
    // The run is blocked on its first COBOL call, so this line can only come from the 4 Hz ticker.
    expect(await next()).toMatchObject({ type: 'progress', executions: 0 });

    gated.release();
    const rest: Record<string, unknown>[] = [];
    for (let line = await next(); line; line = await next()) rest.push(line);
    expect(rest.at(-1)).toMatchObject({ type: 'result', result: { status: 'equivalent', cases: 2000, seed: 42 } });
    expect(await waitForLog('proof finished')).toMatchObject({ program: 'PAYROLL', seed: 42, outcome: 'completed' });
  });

  it('aborts the run and closes the session when the client disconnects', async () => {
    const gated = gatedSession();
    session = gated.session;
    const client = new AbortController();
    const res = await post('{"program":"PAYROLL"}', { signal: client.signal });
    const next = lineReader(res.body!);
    expect(await next()).toMatchObject({ type: 'started' });

    client.abort();
    expect(await waitForLog('proof cancelled')).toMatchObject({ outcome: 'cancelled' });
    expect(gated.closed).toBe(true);
    gated.release();
  });

  it('sends only the generic message for a failed run and keeps the real error in the logs', async () => {
    session = {
      send: async () => {
        throw new Error('PAYROLL exited with code 139. stderr: /secret/path');
      },
      close: async () => 139,
    };
    const res = await post('{"program":"PAYROLL"}');
    const text = await res.text();
    expect(text).not.toContain('/secret/path');
    expect(text.trim().split('\n').at(-1)).toBe(JSON.stringify({ type: 'error', message: RUN_FAILED_MESSAGE }));
    const failed = await waitForLog('proof failed');
    expect(JSON.stringify(failed.error)).toContain('/secret/path');
  });
});
