import { expect, test, type Page } from '@playwright/test';
import { ImageUtils } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';

// Gives ImageUtils the WebP header reader (lab.glb's textures are WebP).
EXTTextureWebP.register();
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MAX_FLICKER_HZ, FLICKER_DEPTH } from '../src/scene/sceneLook';

/**
 * Frame times of the lab scene on a production build (task 19, Requirement 9.4), idle
 * (Buried) and while a proof runs (Reanimating, counters updated at 4 Hz like the real
 * client), at DPR 1 and 2, with and without 4x CPU throttling. Plus a flash-safety check
 * (WCAG 2.3.1): the measured flicker rate and depth on screen, after bloom and tone mapping.
 *
 * The proof is simulated through the store, because the landing page (the only page with
 * the scene) never runs a proof itself; the scene reads the same store fields either way.
 */

const SAMPLE_MS = 5000;
/** A frame counts as dropped when it took longer than 1.5 refresh intervals at 60 Hz. */
const DROPPED_MS = 1.5 * (1000 / 60);
/** Simulated case rate: a local PAYROLL run, which flickers at the 3 Hz cap. */
const CASES_PER_SEC = 3000;

interface StoreHandle {
  setState(partial: Record<string, unknown>): void;
}
type PerfWindow = Window & { __lazarusProofRun?: StoreHandle; __perfTimer?: number };

interface FrameStats {
  readonly frames: number;
  readonly fps: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly droppedShare: number;
}

const results: Record<string, unknown> = {};

test.afterAll(() => {
  mkdirSync('perf/results', { recursive: true });
  const file = process.env.PERF_UNCAPPED ? 'lab-scene-perf-uncapped.json' : 'lab-scene-perf.json';
  writeFileSync(`perf/results/${file}`, `${JSON.stringify(results, null, 2)}\n`);
});

async function openScene(page: Page) {
  const glb = page.waitForResponse((r) => r.url().endsWith('/models/lab.glb'));
  await page.goto('/');
  await glb;
  await expect(page.locator('canvas')).toHaveCount(1);
  // Decode, shader compile and the first frames.
  await page.waitForTimeout(2000);
  await expect.poll(() => page.evaluate(() => typeof (window as PerfWindow).__lazarusProofRun)).toBe('function');
}

async function renderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
}

async function startProof(page: Page) {
  await page.evaluate((casesPerSec) => {
    const w = window as PerfWindow;
    const store = w.__lazarusProofRun;
    if (!store) throw new Error('perf build expected');
    let elapsedMs = 0;
    store.setState({ status: 'reanimating', executions: 0, elapsedMs: 0 });
    w.__perfTimer = window.setInterval(() => {
      elapsedMs += 250;
      store.setState({ status: 'reanimating', executions: Math.round((elapsedMs * casesPerSec) / 1000), elapsedMs });
    }, 250);
  }, CASES_PER_SEC);
}

async function stopProof(page: Page) {
  await page.evaluate(() => {
    const w = window as PerfWindow;
    window.clearInterval(w.__perfTimer);
    w.__lazarusProofRun?.setState({ status: 'idle', executions: 0, elapsedMs: 0 });
  });
}

async function frameTimes(page: Page): Promise<FrameStats> {
  const stamps = await page.evaluate(
    (ms) =>
      new Promise<number[]>((resolve) => {
        const t: number[] = [];
        const tick = (now: number) => {
          t.push(now);
          if (now - (t[0] ?? now) < ms) requestAnimationFrame(tick);
          else resolve(t);
        };
        requestAnimationFrame(tick);
      }),
    SAMPLE_MS,
  );
  const deltas = stamps.slice(1).map((s, i) => s - (stamps[i] ?? s));
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const span = (stamps.at(-1) ?? 0) - (stamps[0] ?? 0);
  return {
    frames: deltas.length,
    fps: round((deltas.length * 1000) / span),
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    droppedShare: round(deltas.filter((d) => d > DROPPED_MS).length / deltas.length, 3),
  };
}

function round(n: number, digits = 1) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Requirement 9.4: everything the scene downloads. */
const SCENE_ASSET_BUDGET_BYTES = 8 * 1024 * 1024;
const SCENE_ASSET = /\/assets\/(LabScene|draco_)[^/]*$|\/models\/[^/]+\.glb$/;

/** Width and height of every texture embedded in the GLB, read from the image headers. */
function glbTextures(glb: Buffer): { mimeType: string; bytes: number; width: number; height: number }[] {
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as {
    images?: { bufferView?: number; mimeType?: string }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  const bin = glb.subarray(20 + jsonLength + 8);
  return (json.images ?? []).map((image) => {
    const view = json.bufferViews[image.bufferView ?? -1];
    if (!view) throw new Error('external images are not expected in lab.glb');
    const data = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const size = ImageUtils.getSize(new Uint8Array(data), image.mimeType ?? '');
    if (!size) throw new Error(`cannot read the size of a ${image.mimeType} texture`);
    return { mimeType: image.mimeType ?? '', bytes: view.byteLength, width: size[0], height: size[1] };
  });
}

test('3D assets downloaded stay under 8 MB', async ({ page }) => {
  const assets: { url: string; bytes: number }[] = [];
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (SCENE_ASSET.test(path)) void r.body().then((b) => assets.push({ url: path, bytes: b.length }));
  });
  await openScene(page);
  await page.waitForTimeout(1000);
  const total = assets.reduce((sum, a) => sum + a.bytes, 0);
  const glb = assets.find((a) => a.url.endsWith('.glb'));
  expect(glb, 'GLB downloaded').toBeDefined();
  // GPU memory for the textures once decoded: RGBA8 plus a full mip chain (4/3).
  const textures = glbTextures(readFileSync(`perf/dist${glb?.url ?? ''}`));
  const textureGpuBytes = textures.reduce((sum, t) => sum + Math.round(t.width * t.height * 4 * (4 / 3)), 0);
  results['3D assets'] = {
    totalBytes: total,
    totalMB: round(total / 1024 / 1024, 2),
    files: assets.sort((a, b) => b.bytes - a.bytes),
    textures,
    textureGpuMB: round(textureGpuBytes / 1024 / 1024, 1),
  };
  console.log('3D assets', JSON.stringify(results['3D assets']));
  expect(total).toBeLessThan(SCENE_ASSET_BUDGET_BYTES);
});

for (const dpr of [1, 2]) {
  for (const cpuThrottle of [1, 4]) {
    const name = `dpr ${dpr}, cpu ${cpuThrottle}x`;
    test.describe(name, () => {
      test.use({ deviceScaleFactor: dpr, viewport: { width: 1280, height: 800 } });

      test('frame times idle and while a proof runs', async ({ page }) => {
        await openScene(page);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
        const canvas = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
        const idle = await frameTimes(page);
        await startProof(page);
        const proof = await frameTimes(page);
        await stopProof(page);
        results[name] = { renderer: await renderer(page), canvasPx: canvas, idle, proof };
        console.log(name, JSON.stringify(results[name]));
      });
    });
  }
}

test.describe('flash safety', () => {
  test.use({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });

  test(`flicker on screen stays at or under ${MAX_FLICKER_HZ} Hz and ${FLICKER_DEPTH * 100}% depth`, async ({ page }) => {
    await openScene(page);
    await startProof(page);
    await page.waitForTimeout(1000);
    // Mean relative luminance (WCAG definition) of the frame, and of the two lamp areas
    // with their bloom halos, read back every frame for 4 s.
    const samples = await page.evaluate(
      (ms) =>
        new Promise<[number, number, number][]>((resolve) => {
          const src = document.querySelector('canvas');
          if (!src) throw new Error('no canvas');
          const w = 160;
          const h = Math.round((w * src.height) / src.width);
          const probe = document.createElement('canvas');
          probe.width = w;
          probe.height = h;
          const ctx = probe.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('no 2d context');
          const lin = (v: number) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          // The two arc lamps sit at about 34% and 66% across, 20 to 45% down.
          const lamp = (x: number, y: number) => ((x > 0.28 && x < 0.42) || (x > 0.58 && x < 0.72)) && y > 0.15 && y < 0.5;
          const out: [number, number, number][] = [];
          const t0 = performance.now();
          const tick = (now: number) => {
            ctx.drawImage(src, 0, 0, w, h);
            const d = ctx.getImageData(0, 0, w, h).data;
            let all = 0;
            let lampSum = 0;
            let lampN = 0;
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const l = 0.2126 * lin(d[i] ?? 0) + 0.7152 * lin(d[i + 1] ?? 0) + 0.0722 * lin(d[i + 2] ?? 0);
                all += l;
                if (lamp(x / w, y / h)) {
                  lampSum += l;
                  lampN++;
                }
              }
            }
            out.push([now - t0, all / (w * h), lampSum / lampN]);
            if (now - t0 < ms) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
      4000,
    );
    await stopProof(page);

    const series = (k: 1 | 2) => samples.map((s) => s[k]);
    const stats = (values: number[]) => {
      const max = Math.max(...values);
      const min = Math.min(...values);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      // Upward crossings of the mean = flicker cycles.
      let cycles = 0;
      for (let i = 1; i < values.length; i++) if ((values[i - 1] ?? 0) < mean && (values[i] ?? 0) >= mean) cycles++;
      const seconds = ((samples.at(-1)?.[0] ?? 0) - (samples[0]?.[0] ?? 0)) / 1000;
      return { min: round(min, 4), max: round(max, 4), depth: round((max - min) / max, 3), absoluteChange: round(max - min, 4), hz: round(cycles / seconds, 2) };
    };
    const frame = stats(series(1));
    const lamps = stats(series(2));
    results['flash safety'] = { samples: samples.length, frame, lamps };
    console.log('flash safety', JSON.stringify(results['flash safety']));
    for (const s of [frame, lamps]) {
      // Small allowance for sampling jitter around the mean.
      expect(s.hz).toBeLessThanOrEqual(MAX_FLICKER_HZ + 0.3);
      expect(s.depth).toBeLessThanOrEqual(FLICKER_DEPTH);
    }
  });
});
