import type { ProxyOptions } from 'vite';

/**
 * Dev proxy for `/api` to the local proof API (`npm run api:dev`, src/api/dev-server.ts).
 *
 * When the API is not running, Vite's proxy answers 502 with an empty body, so the
 * page could only say "The proof service answered HTTP 502." This answers in the
 * API's own error shape (`{ "error": ... }`, which the prove client displays) and
 * says how to start it. Vite's own error listener still logs the failure and skips
 * the response because headers have been sent.
 */
export function proveApiProxy(target: string): ProxyOptions {
  return {
    target,
    // The dev server streams NDJSON. Vite's proxy pipes the response through
    // without buffering, and the dev server sends cache-control: no-store.
    configure(proxy) {
      proxy.on('error', (error, _req, res) => {
        // `res` is a socket for WebSocket upgrades, which /api does not use.
        if (!('writeHead' in res) || res.headersSent || res.writableEnded) return;
        const code = (error as NodeJS.ErrnoException).code;
        const message =
          code === 'ECONNREFUSED'
            ? `The local proof API is not running at ${target}. Start it in another terminal with: npm run api:dev`
            : `The local proof API at ${target} could not be reached (${code ?? error.message}). Is npm run api:dev running?`;
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: message }));
      });
    },
  };
}
