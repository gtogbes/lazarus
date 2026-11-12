/**
 * A pass-through proxy between aws-lambda-ric and the Runtime API (ADR 0001).
 * Logs the headers of each /response POST and the time each body chunk arrives,
 * which shows whether the RIC streams (chunked, spread over time) or buffers.
 * Used by `npm run lambda:smoke` and the ADR's reproduce steps. Dependency-free
 * so the image's Node runs it directly (type stripping).
 *
 * Usage inside the container:
 *   node runtime-api-tap.ts &   (listens on 127.0.0.1:9002, forwards to $AWS_LAMBDA_RUNTIME_API)
 *   AWS_LAMBDA_RUNTIME_API=127.0.0.1:9002 node .../aws-lambda-ric/index.mjs handler.handler
 */
import { createServer, request } from 'node:http';

const upstream = process.env.AWS_LAMBDA_RUNTIME_API ?? '127.0.0.1:9001';
const [host, port] = upstream.split(':');
const log = (msg: string) => process.stderr.write(`[tap] ${msg}\n`);

createServer((req, res) => {
  const isResponse = req.method === 'POST' && req.url?.endsWith('/response') === true;
  const started = performance.now();
  if (isResponse) {
    const h = req.headers;
    log(`POST ${req.url} mode=${String(h['lambda-runtime-function-response-mode'])} transfer-encoding=${String(h['transfer-encoding'])} content-length=${String(h['content-length'])}`);
  }
  const out = request(
    { host, port: Number(port), method: req.method, path: req.url, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  out.on('error', (err) => {
    log(`upstream error: ${err.message}`);
    res.destroy(err);
  });
  let n = 0;
  req.on('data', (chunk: Buffer) => {
    if (isResponse) log(`chunk ${++n} +${Math.round(performance.now() - started)} ms ${chunk.length} B`);
    out.write(chunk);
  });
  req.on('end', () => {
    if (isResponse) log(`end +${Math.round(performance.now() - started)} ms, ${n} chunks`);
    out.end();
  });
}).listen(9002, '127.0.0.1', () => log(`listening on 127.0.0.1:9002 -> ${upstream}`));
