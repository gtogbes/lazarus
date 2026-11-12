/**
 * Test helpers: a fake network for `POST /api/prove`. The response is a real
 * `Response` over a `ReadableStream` the test writes to, so the real client,
 * parser and store run unmodified. Not imported by app code.
 */
import { vi } from 'vitest';

const encoder = new TextEncoder();

export interface FakeStream {
  readonly response: Response;
  /** Send events as NDJSON lines in one chunk. */
  send(...events: readonly object[]): void;
  /** Send raw text as one chunk. */
  raw(text: string): void;
  close(): void;
  /** Fail the stream as an aborted or dropped connection would. */
  fail(error: unknown): void;
}

export function fakeStream(): FakeStream {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      open = false;
    },
  });
  const raw = (text: string) => {
    if (open) controller.enqueue(encoder.encode(text));
  };
  return {
    response: new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }),
    send: (...events) => raw(events.map((event) => `${JSON.stringify(event)}\n`).join('')),
    raw,
    close: () => {
      if (open) controller.close();
      open = false;
    },
    fail: (error) => {
      if (open) controller.error(error);
      open = false;
    },
  };
}

export interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * Replace `fetch` with one that answers every call with `respond()`. Like the
 * real fetch, aborting the signal fails the pending body of a FakeStream.
 */
export function stubFetch(respond: () => Response | FakeStream | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const answer = await respond();
    if (answer instanceof Response) return answer;
    init.signal?.addEventListener('abort', () => answer.fail(new DOMException('Aborted', 'AbortError')), {
      once: true,
    });
    return answer.response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Replace `fetch` with one that serves JSON `files` by URL; anything else is a 404. */
export function serveFiles(files: Readonly<Record<string, unknown>>) {
  const fetchMock = vi.fn(async (url: string) => (url in files ? jsonResponse(200, files[url]) : jsonResponse(404, {})));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const STARTED = {
  type: 'started',
  program: 'PAYROLL',
  seed: 42,
  reference: 'gnucobol 3.1.2 (native)',
  numRuns: 2000,
} as const;

export const EQUIVALENT_RESULT = {
  program: 'PAYROLL',
  status: 'equivalent',
  reference: 'gnucobol 3.1.2 (native)',
  generatedAt: '2026-11-08T10:00:00.000Z',
  seed: 42,
  cases: 2000,
  shrinks: 0,
  durationMs: 1412,
} as const;

interface RecordableResult {
  readonly program: string;
  readonly seed: number;
  readonly reference: string;
}

/**
 * A recording file (see ./recording.ts) for `result`: `started`, the given
 * progress snapshots (default: one final snapshot), then `result`.
 */
export function recordingOf(
  result: RecordableResult & { readonly cases: number; readonly durationMs: number },
  options: { readonly mutant?: string; readonly progress?: readonly object[] } = {},
) {
  return {
    version: 1,
    events: [
      {
        type: 'started',
        program: result.program,
        ...(options.mutant === undefined ? {} : { mutant: options.mutant }),
        seed: result.seed,
        reference: result.reference,
        numRuns: 2000,
      },
      ...(options.progress ?? [{ type: 'progress', executions: result.cases, divergences: 0, elapsedMs: result.durationMs }]),
      { type: 'result', result },
    ],
  };
}

export const DIVERGED_RESULT = {
  ...EQUIVALENT_RESULT,
  status: 'diverged',
  cases: 37,
  shrinks: 12,
  durationMs: 240,
  counterexample: { records: ['IN'], cobol: ['A'], port: ['B'], line: 0, column: 3 },
} as const;
