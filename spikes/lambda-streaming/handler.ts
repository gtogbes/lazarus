/**
 * Spike (reanimation-lab task 1): does Lambda response streaming work from a
 * Debian bookworm image with the Node runtime interface client (aws-lambda-ric)?
 *
 * Runs one INTCALC equivalence proof against the native GnuCOBOL binary and
 * streams NDJSON progress at 4 Hz. Throwaway code: task 5 adds the real native
 * runner, task 6 the real `prove`, task 20 the real Dockerfile.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Writable } from 'node:stream';
import fc from 'fast-check';
import type { CobolSession } from '../../src/harness/cobol.js';
import { checkEquivalence, type Progress } from '../../src/harness/equivalence.js';
import { PICS, processRecord } from '../../src/ports/intcalc.js';
import { picDisplay } from '../../src/semantics/arbitraries.js';

interface ResponseStream extends Writable {
  setContentType(type: string): void;
}
interface FunctionUrlEvent {
  readonly body?: string;
}
declare const awslambda: {
  streamifyResponse(
    handler: (event: FunctionUrlEvent, stream: ResponseStream) => Promise<void>,
  ): unknown;
  HttpResponseStream: {
    from(stream: ResponseStream, metadata: { statusCode: number; headers: Record<string, string> }): ResponseStream;
  };
};

const BIN_DIR = process.env.LAZARUS_BIN_DIR ?? '/opt/lazarus/bin';
const PROGRESS_INTERVAL_MS = 250; // 4 Hz, Requirement 3.2

/** Minimal native stand-in for CobolSession: same send/close contract. */
class NativeSession {
  private readonly lines: string[] = [];
  private readonly waiting: Array<(line: string) => void> = [];
  private readonly child;
  private failure: Error | undefined;

  constructor(program: string) {
    this.child = spawn('stdbuf', ['-oL', `${BIN_DIR}/${program}`]);
    let stderr = '';
    this.child.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
    this.child.on('exit', (code) => (this.failure ??= new Error(`${program} exited ${code}: ${stderr}`)));
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const next = this.waiting.shift();
      if (next) next(line);
      else this.lines.push(line);
    });
  }

  async send(records: readonly string[]): Promise<string[]> {
    if (this.failure) throw this.failure;
    this.child.stdin.write(records.map((r) => `${r}\n`).join(''));
    const out: string[] = [];
    for (let i = 0; i < records.length; i++) {
      out.push(this.lines.shift() ?? (await new Promise<string>((res) => this.waiting.push(res))));
    }
    return out;
  }

  close(): Promise<number | null> {
    return new Promise((res) => {
      this.child.on('exit', res);
      this.child.stdin.end();
    });
  }
}

const record = fc
  .tuple(fc.stringMatching(/^[A-Z0-9]{8}$/), picDisplay(PICS.balance), picDisplay(PICS.rate), picDisplay(PICS.days))
  .map((fields) => fields.join(''));

function intField(body: string | undefined, name: 'seed' | 'numRuns'): number | undefined {
  if (!body) return undefined;
  const parsed: unknown = JSON.parse(body);
  const value = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)[name] : undefined;
  return Number.isSafeInteger(value) ? (value as number) : undefined;
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
  const started = performance.now();
  const emit = (e: object) => stream.write(`${JSON.stringify(e)}\n`);
  const seed = intField(event.body, 'seed');
  // Spike only: a longer run makes buffering visible. The real API fixes 2,000 (Req 3.6).
  const numRuns = Math.min(Math.max(intField(event.body, 'numRuns') ?? 2000, 1), 200_000);

  emit({ type: 'started', program: 'INTCALC', seed, numRuns, reference: 'gnucobol 3.1.2' });
  let latest: Progress = { executions: 0, divergences: 0 };
  const timer = setInterval(() => {
    emit({ type: 'progress', ...latest, elapsedMs: Math.round(performance.now() - started) });
  }, PROGRESS_INTERVAL_MS);

  const native = new NativeSession('INTCALC');
  try {
    const result = await checkEquivalence({
      program: 'INTCALC',
      // Spike only: NativeSession matches CobolSession's public contract. Task 5 makes this a real option.
      session: native as unknown as CobolSession,
      port: processRecord,
      record,
      numRuns,
      ...(seed === undefined ? {} : { seed }),
      onProgress: (p) => (latest = p),
    });
    clearInterval(timer);
    emit({ type: 'progress', ...latest, elapsedMs: Math.round(performance.now() - started) });
    emit({ type: 'result', result: { ...result, reference: 'gnucobol 3.1.2 (native, Lambda image)' } });
  } catch (err) {
    emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    clearInterval(timer);
    await native.close();
    stream.end();
  }
});
