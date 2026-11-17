/**
 * Client for `POST /api/prove` (reanimation-lab design, "API contract").
 *
 * Hosted, CloudFront signs the request to the Lambda Function URL with Origin
 * Access Control, and Lambda OAC requires the viewer to send the SHA-256 of the
 * body in `x-amz-content-sha256`. The hash is computed over the exact bytes sent.
 */
import type { ProveErrorBody, ProveEvent, ProveRequestBody } from '../../../../src/api/events';
import { createNdjsonDecoder } from './ndjson';
import { parseProveEvent } from './proveEvent';

export const PROVE_URL = '/api/prove';

/** Why a proof request failed before or outside the run itself. */
export class ProveRequestError extends Error {
  constructor(
    readonly kind: 'network' | 'http',
    message: string,
    /** HTTP status, for `http` failures. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProveRequestError';
  }
}

/** Lowercase hex SHA-256 of `bytes`. Web Crypto only exists in secure contexts (HTTPS or localhost). */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The body bytes and headers for one request. Exported so tests can check the hash against the body. */
export async function buildProveRequest(body: ProveRequestBody): Promise<{ body: Uint8Array<ArrayBuffer>; headers: Record<string, string> }> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    body: bytes,
    headers: {
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
      'x-amz-content-sha256': await sha256Hex(bytes),
    },
  };
}

const MAX_ERROR_MESSAGE = 300;

export const BUSY_MESSAGE = 'The lab is busy running another proof. Try again in a moment, or replay the recorded proof.';
export const UNAVAILABLE_MESSAGE =
  'The proof service is unavailable right now. Try again in a moment, or replay the recorded proof.';

/**
 * Statuses the proof API itself never sends. Hosted, AWS sends them in front of it:
 * 429 when another proof holds Lambda's only reserved concurrency slot, and
 * 502/503/504 from CloudFront when the origin fails. Their bodies are not ours,
 * so the message is fixed.
 */
const INFRASTRUCTURE_MESSAGES: Readonly<Record<number, string>> = {
  429: BUSY_MESSAGE,
  502: UNAVAILABLE_MESSAGE,
  503: UNAVAILABLE_MESSAGE,
  504: UNAVAILABLE_MESSAGE,
};

/** The `{error}` message of a non-200 response, or a generic one if the body is not that shape. */
async function errorMessage(response: Response): Promise<string> {
  const fixed = INFRASTRUCTURE_MESSAGES[response.status];
  if (fixed !== undefined) return fixed;
  const fallback = `The proof service answered HTTP ${response.status}.`;
  try {
    const body: unknown = await response.json();
    const { error } = (body ?? {}) as Partial<ProveErrorBody>;
    return typeof error === 'string' && error !== '' ? error.slice(0, MAX_ERROR_MESSAGE) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Send one proof request and call `onEvent` for each valid event, in order.
 * Invalid lines and events are skipped. Resolves when the stream ends or after
 * the first `result` or `error` event (anything after it is ignored).
 * Rejects with ProveRequestError for network and HTTP failures, and with the
 * abort reason when `signal` aborts.
 */
export async function streamProve(
  body: ProveRequestBody,
  onEvent: (event: ProveEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const request = await buildProveRequest(body);
  let response: Response;
  try {
    response = await fetch(PROVE_URL, { method: 'POST', body: request.body, headers: request.headers, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ProveRequestError('network', 'The proof service could not be reached.');
  }
  if (!response.ok) throw new ProveRequestError('http', await errorMessage(response), response.status);
  if (!response.body) throw new ProveRequestError('network', 'The proof service sent no stream.');

  const reader = response.body.getReader();
  const decoder = createNdjsonDecoder();
  // Returns true once a terminal event has been delivered.
  const deliver = (values: unknown[]): boolean => {
    for (const value of values) {
      const event = parseProveEvent(value);
      if (!event) continue;
      onEvent(event);
      if (event.type === 'result' || event.type === 'error') return true;
    }
    return false;
  };
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ProveRequestError('network', 'The connection to the proof service dropped.');
      }
      if (chunk.done) {
        deliver(decoder.end());
        return;
      }
      if (deliver(decoder.push(chunk.value))) return;
    }
  } finally {
    // Release the connection whether we finished, stopped early or failed.
    reader.cancel().catch(() => undefined);
  }
}
