/**
 * Serves the production build (web/dist) the way the hosted lab will (task 21):
 * - every response carries the CloudFront response headers policy headers
 *   (infra/lib/security-headers.ts, the same object SiteStack deploys);
 * - non-API paths go through the same CloudFront Function source
 *   (infra/lib/spa-rewrite.cf.js), so deep links get index.html and missing
 *   files get a real 404;
 * - /api/* is proxied to the local dev server with only the headers that reach
 *   the Function URL hosted: Content-Type (the origin request policy) and
 *   x-amz-content-sha256 (not allowlistable; OAC signs with the viewer's value).
 *
 * Run: `npx tsx e2e-csp/serve-dist.ts` from web/ (Playwright does it, see playwright.config.ts).
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { SECURITY_HEADERS } from '../../infra/lib/security-headers.ts';
import { loadSpaRewrite } from '../../infra/lib/spa-rewrite.ts';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.LAZARUS_CSP_PORT || 4175);
const API_HOST = process.env.LAZARUS_API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.LAZARUS_API_PORT || 8787);
/**
 * API_FORWARDED_HEADERS in infra/lib/site-stack.ts, plus x-amz-content-sha256 (part of the OAC-signed
 * origin request) and content-length (CloudFront always sends it with a body).
 */
const FORWARDED = ['content-type', 'x-amz-content-sha256', 'content-length'] as const;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Text types, which CloudFront compresses. Binary files (GLB, WASM, images) are sent as they are. */
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg\+xml)/;

const rewrite = loadSpaRewrite();

function withSecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

function proxyApi(req: IncomingMessage, res: ServerResponse): void {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED) {
    const value = req.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  const upstream = httpRequest(
    { host: API_HOST, port: API_PORT, method: req.method, path: req.url, headers },
    (apiRes) => {
      for (const [name, value] of Object.entries(apiRes.headers)) {
        if (value !== undefined && name !== 'connection' && name !== 'transfer-encoding') res.setHeader(name, value);
      }
      withSecurityHeaders(res); // the policy overrides origin headers (override: true)
      res.writeHead(apiRes.statusCode ?? 502);
      apiRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502).end();
    else res.destroy();
  });
  req.pipe(upstream);
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  // The default behaviour allows GET and HEAD only; CloudFront answers 403 to anything else.
  if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(403).end();
  const { uri } = rewrite({ request: { uri: pathname } });
  const file = normalize(join(DIST, uri));
  if (!file.startsWith(DIST + sep)) return void res.writeHead(404).end();
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return void res.writeHead(404).end();
    size = stat.size;
  } catch {
    return void res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  // Like CloudFront (`compress: true` on the site behaviour): gzip text types when the client accepts it,
  // so local Lighthouse runs see realistic transfer sizes.
  const gzip = COMPRESSIBLE.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  res.writeHead(200, gzip ? { 'content-type': type, 'content-encoding': 'gzip', vary: 'accept-encoding' } : { 'content-type': type, 'content-length': size });
  if (req.method === 'HEAD') return void res.end();
  if (gzip) createReadStream(file).pipe(createGzip()).pipe(res);
  else createReadStream(file).pipe(res);
}

createServer((req, res) => {
  withSecurityHeaders(res);
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', `http://${HOST}`).pathname);
  } catch {
    return void res.writeHead(400).end();
  }
  if (pathname.startsWith('/api/')) proxyApi(req, res);
  else serveStatic(req, res, pathname);
}).listen(PORT, HOST, () => {
  console.log(`Serving ${DIST} with the CloudFront headers on http://${HOST}:${PORT}`);
});
