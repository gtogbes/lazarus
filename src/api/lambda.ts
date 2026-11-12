/**
 * Lambda handler for the proof API (reanimation-lab task 20, ADR 0001).
 *
 * Function URL (invoke mode RESPONSE_STREAM) event, payload format 2.0.
 * Same contract as the dev server: 404 unknown path, 405 wrong method, 415 not
 * JSON, 413 body over 1 KB, 400 invalid request, all as `{ error }` JSON before
 * any streaming. A valid request gets `200 application/x-ndjson` with the
 * events from `prove`, run natively against the GnuCOBOL binaries baked into
 * the image (`docker/lambda/Dockerfile`).
 *
 * Client disconnect: if the runtime closes or errors the response stream before
 * the handler ends it, the run is aborted (Requirement 3.5). Whether a real
 * Function URL propagates a viewer disconnect that way cannot be checked
 * locally, because the Runtime Interface Emulator buffers the whole response
 * (ADR 0001); task 22 checks it on AWS. The 25 s cap in `prove` bounds the cost
 * either way.
 */
import type { Writable } from 'node:stream';
import { DEFAULT_NATIVE_BIN_DIR } from '../harness/cobol.js';
import { describeError, jsonLog, logProofOutcome, type Log } from './log.js';
import {
  MAX_BODY_BYTES,
  parseProveRequest,
  prove as runProof,
  PROVE_PATH,
  REFERENCE_LABELS,
  type ProveErrorBody,
  type ProveEvent,
  type ProveOptions,
} from './prove.js';

/** The parts of a Function URL event (payload format 2.0) the handler reads. */
export interface FunctionUrlEvent {
  readonly rawPath?: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
  readonly requestContext?: { readonly http?: { readonly method?: string; readonly path?: string } };
}

export interface LambdaContext {
  readonly awsRequestId: string;
}

export interface ResponseMetadata {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
}

/** `awslambda.HttpResponseStream.from`: writes the status and headers prelude. */
export type HttpResponseStreamFrom = (stream: Writable, metadata: ResponseMetadata) => Writable;

export type StreamingHandler = (event: FunctionUrlEvent, responseStream: Writable, context: LambdaContext) => Promise<void>;

/** The `awslambda` global the Node runtime interface client installs before loading the handler. */
interface AwsLambdaGlobal {
  streamifyResponse(handler: StreamingHandler): unknown;
  HttpResponseStream: { from: HttpResponseStreamFrom };
}

export interface ProveHandlerDeps {
  readonly from: HttpResponseStreamFrom;
  readonly log?: Log;
  /** Test seam. Defaults to the real `prove`. */
  readonly prove?: typeof runProof;
  /** Defaults to the native runner over the image's baked binaries. */
  readonly proveOptions?: ProveOptions;
}

/** How the handler runs proofs inside the Lambda image. */
export const LAMBDA_PROVE_OPTIONS: ProveOptions = {
  runner: 'native',
  binDir: DEFAULT_NATIVE_BIN_DIR,
  reference: REFERENCE_LABELS.native,
};

const COMMON_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

class BodyTooLarge extends Error {}

/** Decode the event body to UTF-8 text, refusing anything over MAX_BODY_BYTES without decoding it all. */
function decodeBody(event: FunctionUrlEvent): string | undefined {
  const { body } = event;
  if (body === undefined) return undefined;
  if (!event.isBase64Encoded) {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new BodyTooLarge();
    return body;
  }
  // Base64 is 4 characters per 3 bytes; check the bound before allocating.
  if (body.length > Math.ceil(MAX_BODY_BYTES / 3) * 4 + 4) throw new BodyTooLarge();
  const bytes = Buffer.from(body, 'base64');
  if (bytes.length > MAX_BODY_BYTES) throw new BodyTooLarge();
  return bytes.toString('utf8');
}

export function createProveHandler(deps: ProveHandlerDeps): StreamingHandler {
  const log = deps.log ?? jsonLog;
  const prove = deps.prove ?? runProof;
  const proveOptions = deps.proveOptions ?? LAMBDA_PROVE_OPTIONS;

  return async (event, responseStream, context) => {
    const requestId = context.awsRequestId;
    const started = performance.now();
    const method = event.requestContext?.http?.method;
    const path = event.rawPath ?? event.requestContext?.http?.path;
    const base = { requestId, method, path };

    const sendJson = (statusCode: number, body: ProveErrorBody, headers: Record<string, string> = {}) => {
      const stream = deps.from(responseStream, {
        statusCode,
        headers: { 'content-type': 'application/json; charset=utf-8', ...COMMON_HEADERS, 'x-request-id': requestId, ...headers },
      });
      // The runtime writes the status/headers prelude on the first write() call;
      // end(chunk) would bypass it and the response would lose its status code.
      stream.write(JSON.stringify(body));
      stream.end();
    };
    const reject = (statusCode: number, message: string, headers: Record<string, string> = {}) => {
      sendJson(statusCode, { error: message }, headers);
      log({ level: 'warn', msg: 'request rejected', ...base, status: statusCode, reason: message });
    };

    if (path !== PROVE_PATH) return reject(404, 'Not found');
    if (method !== 'POST') return reject(405, 'Method not allowed', { allow: 'POST' });
    const contentType = event.headers?.['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') return reject(415, 'Content-Type must be application/json');

    let body: string | undefined;
    try {
      body = decodeBody(event);
    } catch (error) {
      if (error instanceof BodyTooLarge) return reject(413, `Request body must be at most ${MAX_BODY_BYTES} bytes`);
      throw error;
    }
    const parsed = parseProveRequest(body);
    if (!parsed.ok) return reject(parsed.status, parsed.message);
    const { request } = parsed;

    const stream = deps.from(responseStream, {
      statusCode: 200,
      headers: { 'content-type': 'application/x-ndjson', ...COMMON_HEADERS, 'x-request-id': requestId },
    });
    const controller = new AbortController();
    let ended = false;
    // The runtime closed or broke the stream before we ended it: the client is gone.
    const onGone = () => {
      if (!ended) controller.abort();
    };
    stream.once('close', onGone).once('error', (error: Error) => {
      log({ level: 'warn', msg: 'response stream error', ...base, error: describeError(error) });
      onGone();
    });

    let seed: number | undefined;
    const emit = (event: ProveEvent) => {
      if (event.type === 'started') seed = event.seed;
      if (!stream.writableEnded && !stream.destroyed) stream.write(`${JSON.stringify(event)}\n`);
    };
    const run = { ...base, program: request.program.id, mutant: request.mutant?.id };
    log({ level: 'info', msg: 'proof started', ...run });
    const outcome = await prove(request, emit, controller.signal, proveOptions);
    ended = true;
    if (!stream.writableEnded && !stream.destroyed) stream.end();
    logProofOutcome(log, { ...run, seed, durationMs: Math.round(performance.now() - started) }, outcome);
  };
}

const runtime = (globalThis as { awslambda?: AwsLambdaGlobal }).awslambda;

/**
 * The entry point (`index.handler` in the image). Only defined inside the
 * Lambda runtime, where the runtime interface client provides `awslambda`.
 */
export const handler: unknown = runtime
  ? runtime.streamifyResponse(createProveHandler({ from: (s, m) => runtime.HttpResponseStream.from(s, m) }))
  : undefined;
