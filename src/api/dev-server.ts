/**
 * Local development server for the proof API (reanimation-lab task 7).
 *
 * Exposes the same `POST /api/prove` contract as the Lambda handler, over
 * plain `node:http`, so the web app's dev proxy sees real NDJSON streaming.
 * The Lambda emulator buffers responses (ADR 0001), so it cannot stand in.
 *
 * Every client error is answered before the stream starts: 404 unknown path,
 * 405 wrong method, 415 not JSON, 413 body over 1 KB (read no further), 400
 * invalid request. A client disconnect aborts the run (Requirement 3.5).
 *
 *   npm run api:dev                        # docker runner (local reference image)
 *   LAZARUS_RUNNER=native npm run api:dev  # binaries in LAZARUS_BIN_DIR
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import type { CobolRunner } from '../harness/cobol.js';
import { describeError, jsonLog, logProofOutcome, type Log } from './log.js';
import { MAX_BODY_BYTES, parseProveRequest, prove, PROVE_PATH, type ProveEvent, type ProveOptions } from './prove.js';

export { jsonLog, type Log, type LogEntry } from './log.js';
export { PROVE_PATH } from './prove.js';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;
/** Time allowed to receive the whole request. The streamed response is not limited by this. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface DevServerOptions {
  readonly prove?: ProveOptions;
  readonly log?: Log;
}

class BodyTooLarge extends Error {}

/** Read at most MAX_BODY_BYTES; reject as soon as the limit is passed instead of buffering the rest. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        cleanup();
        req.pause();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      req.off('data', onData).off('end', onEnd).off('error', onError);
    };
    req.on('data', onData).on('end', onEnd).on('error', onError);
  });
}

function sendJson(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse, options: DevServerOptions, log: Log): Promise<void> {
  const requestId = randomUUID();
  const started = performance.now();
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const base = { requestId, method: req.method, path };
  res.setHeader('x-request-id', requestId);

  const reject = (status: number, message: string, headers: Record<string, string> = {}) => {
    sendJson(res, status, { error: message }, headers);
    log({ level: 'warn', msg: 'request rejected', ...base, status, reason: message });
  };

  if (path !== PROVE_PATH) return reject(404, 'Not found');
  if (req.method !== 'POST') return reject(405, 'Method not allowed', { allow: 'POST' });
  // Requiring JSON also stops other web pages posting "simple" cross-origin requests to localhost.
  const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') return reject(415, 'Content-Type must be application/json');
  const declared = Number(req.headers['content-length']);
  // Close the connection so the unread body is never consumed.
  if (declared > MAX_BODY_BYTES) {
    return reject(413, `Request body must be at most ${MAX_BODY_BYTES} bytes`, { connection: 'close' });
  }

  let body: string;
  try {
    body = await readBody(req);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      return reject(413, `Request body must be at most ${MAX_BODY_BYTES} bytes`, { connection: 'close' });
    }
    // The client aborted or the socket failed while sending: nobody is left to answer.
    log({ level: 'warn', msg: 'request body not received', ...base, error: describeError(error) });
    res.destroy();
    return;
  }

  const parsed = parseProveRequest(body);
  if (!parsed.ok) return reject(parsed.status, parsed.message);
  const { request } = parsed;

  const controller = new AbortController();
  // `close` before `finish` means the client went away mid-stream.
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  res.writeHead(200, {
    'content-type': 'application/x-ndjson',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.flushHeaders();
  // Send each line as its own packet instead of waiting to coalesce.
  req.socket.setNoDelay(true);

  let seed: number | undefined;
  const emit = (event: ProveEvent) => {
    if (event.type === 'started') seed = event.seed;
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };

  const run = { ...base, program: request.program.id, mutant: request.mutant?.id };
  log({ level: 'info', msg: 'proof started', ...run });
  const outcome = await prove(request, emit, controller.signal, options.prove);
  if (!res.writableEnded && !res.destroyed) res.end();

  logProofOutcome(log, { ...run, seed, durationMs: Math.round(performance.now() - started) }, outcome);
}

/** Create the server without listening, so tests can bind it to a free port. */
export function createDevServer(options: DevServerOptions = {}): Server {
  const log = options.log ?? jsonLog;
  const server = createServer((req, res) => {
    handle(req, res, options, log).catch((error: unknown) => {
      log({ level: 'error', msg: 'unhandled server error', path: req.url, error: describeError(error) });
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
      else res.destroy();
    });
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS;
  return server;
}

function parseRunner(value: string | undefined): CobolRunner {
  if (value === undefined || value === '' || value === 'docker') return 'docker';
  if (value === 'native') return 'native';
  throw new Error(`LAZARUS_RUNNER must be "docker" or "native", got ${JSON.stringify(value)}`);
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`LAZARUS_API_PORT must be an integer from 0 to 65535, got ${JSON.stringify(value)}`);
  }
  return port;
}

function main(): void {
  const runner = parseRunner(process.env.LAZARUS_RUNNER);
  const host = process.env.LAZARUS_API_HOST || DEFAULT_HOST;
  const port = parsePort(process.env.LAZARUS_API_PORT);
  const server = createDevServer({ prove: { runner } });

  server.listen(port, host, () => {
    const address = server.address();
    const bound = typeof address === 'object' && address ? address.port : port;
    jsonLog({ level: 'info', msg: 'dev server listening', url: `http://${host}:${bound}${PROVE_PATH}`, runner });
  });

  const shutdown = (signal: string) => {
    jsonLog({ level: 'info', msg: 'dev server stopping', signal });
    // Dropping the sockets aborts in-flight runs, which closes their COBOL sessions.
    server.close();
    server.closeAllConnections();
  };
  process.once('SIGINT', shutdown).once('SIGTERM', shutdown);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
