// @vitest-environment node
/**
 * The local two-terminal flow (`npm run api:dev` + `npm run web:dev`): when the
 * proof API is not running, Prove must say so and say how to start it, instead
 * of "The proof service answered HTTP 502." Runs the real vite.config.ts proxy.
 */
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** A port nothing listens on: bind an ephemeral one, then release it. */
async function closedPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('no port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe('dev proxy to the proof API', () => {
  let vite: ViteDevServer;
  let apiPort: number;
  let base: string;

  beforeAll(async () => {
    apiPort = await closedPort();
    // vite.config.ts reads these when it loads.
    process.env.LAZARUS_API_HOST = '127.0.0.1';
    process.env.LAZARUS_API_PORT = String(apiPort);
    vite = await createServer({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, hmr: false, ws: false },
    });
    await vite.listen();
    const url = vite.resolvedUrls?.local[0];
    if (!url) throw new Error('vite did not report a URL');
    base = url.replace(/\/$/, '');
  });

  afterAll(async () => {
    await vite?.close();
    delete process.env.LAZARUS_API_HOST;
    delete process.env.LAZARUS_API_PORT;
  });

  it('answers 502 with a JSON error that says to run npm run api:dev when the API is down', async () => {
    const response = await fetch(`${base}/api/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ program: 'PAYROLL' }),
    });
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    const body = (await response.json()) as { error?: unknown };
    expect(body.error).toBe(
      `The local proof API is not running at http://127.0.0.1:${apiPort}. Start it in another terminal with: npm run api:dev`,
    );
  });
});
