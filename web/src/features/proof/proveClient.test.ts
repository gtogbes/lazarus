import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProveEvent } from '../../../../src/api/events';
import { buildProveRequest, PROVE_URL, ProveRequestError, sha256Hex, streamProve } from './proveClient';
import { EQUIVALENT_RESULT, fakeStream, jsonResponse, STARTED, stubFetch } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Computed independently with `printf '%s' '<body>' | shasum -a 256`.
const SHA256 = {
  '{"program":"PAYROLL","mutant":"half-up-tax"}': 'aa848d51f08217beb9368e38c5fb9ffecfccaa3b68fe1c852252aede85abcb42',
  '{"program":"PAYROLL"}': '6b13a97319d766c163037884bc877acdb4468fd3d94c58f82dbde5e4fa877989',
} as const;

describe('proof request', () => {
  it('hashes bytes to lowercase hex SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('sends JSON with an x-amz-content-sha256 header that matches the exact body bytes', async () => {
    const request = await buildProveRequest({ program: 'PAYROLL', mutant: 'half-up-tax' });
    expect(new TextDecoder().decode(request.body)).toBe('{"program":"PAYROLL","mutant":"half-up-tax"}');
    expect(request.headers['x-amz-content-sha256']).toBe(SHA256['{"program":"PAYROLL","mutant":"half-up-tax"}']);

    const stream = fakeStream();
    const { calls } = stubFetch(() => stream);
    stream.send({ type: 'error', message: 'x' });
    await streamProve({ program: 'PAYROLL' }, () => {}, new AbortController().signal);
    const [call] = calls;
    expect(call?.url).toBe(PROVE_URL);
    expect(call?.init.method).toBe('POST');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    const sent = call?.init.body as Uint8Array;
    expect(new TextDecoder().decode(sent)).toBe('{"program":"PAYROLL"}');
    expect(headers['x-amz-content-sha256']).toBe(SHA256['{"program":"PAYROLL"}']);
  });
});

describe('streamProve', () => {
  it('delivers valid events in order, skips bad lines and invalid events, and stops after the result', async () => {
    const stream = fakeStream();
    stubFetch(() => stream);
    const events: ProveEvent[] = [];
    stream.raw(`${JSON.stringify(STARTED)}\ngarbage\n{"type":"progress","executions":-1}\n{"type":"mystery"}\n`);
    stream.raw('{"type":"progress","executions":5,"divergences":0,"elapsedMs":250,"extra":"ignored"}\n{"type":"res');
    stream.raw(`ult","result":${JSON.stringify(EQUIVALENT_RESULT)}}\n`);
    stream.send({ type: 'progress', executions: 99, divergences: 0, elapsedMs: 9 });
    await streamProve({ program: 'PAYROLL' }, (event) => events.push(event), new AbortController().signal);
    expect(events).toEqual([
      STARTED,
      { type: 'progress', executions: 5, divergences: 0, elapsedMs: 250 },
      { type: 'result', result: EQUIVALENT_RESULT },
    ]);
  });

  it('rejects with the server message for an HTTP error before the stream', async () => {
    stubFetch(() => jsonResponse(400, { error: 'Unknown program' }));
    const error = await streamProve({ program: 'NOPE' }, () => {}, new AbortController().signal).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProveRequestError);
    expect(error).toMatchObject({ kind: 'http', status: 400, message: 'Unknown program' });
  });

  it('rejects as a network error when the service cannot be reached', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(streamProve({ program: 'PAYROLL' }, () => {}, new AbortController().signal)).rejects.toMatchObject({
      kind: 'network',
    });
  });
});
