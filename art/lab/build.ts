/**
 * Builds the lab hero scene assets (reanimation-lab task 18):
 *
 * 1. Blender (headless) runs `build_lab.py`: saves `art/lab/lab.blend`, renders the four
 *    Cycles stills, bakes static ambient light and exports `art/lab/build/lab-raw.glb`.
 * 2. Textures -> WebP (EXT_texture_webp, `cwebp`), meshes -> Draco, written to
 *    `web/public/models/lab.glb`. Not KTX2: three's Basis transcoder uses `new Function`
 *    (Emscripten embind) in a blob: worker, which the site CSP blocks (task 21; owner
 *    decision 2026-11-10 to keep script-src free of 'unsafe-eval').
 * 3. Stills -> AVIF (`avifenc`) and WebP (`cwebp`) in `web/public/stills/`, each at the
 *    highest quality that fits STILL_BUDGET_BYTES.
 *
 * Run: `npm run art:lab` (all steps) or e.g. `npm run art:lab -- --steps stills --moods alive`.
 * Extra flags are passed to build_lab.py (`--samples`, `--scale`, `--bake-size`, ...).
 *
 * Needs: Blender 5.2 (BLENDER env var, else /Applications/Blender.app), and on PATH
 * `cwebp`, `avifenc` (macOS: `brew install webp libavif`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, draco, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const BUILD = join(HERE, 'build');
const GLB_OUT = join(ROOT, 'web/public/models/lab.glb');
const STILLS_OUT = join(ROOT, 'web/public/stills');
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';

/** Requirement 9.4: all 3D assets under 8 MB. */
const GLB_BUDGET_BYTES = 8 * 1024 * 1024;
/** docs/stills.md: aim for 150 KB or less per file. */
const STILL_BUDGET_BYTES = 150 * 1024;
/** cwebp quality (0-100) for the baked base colour textures. */
const TEXTURE_WEBP_QUALITY = '90';

const args = process.argv.slice(2);
const stepsArg = args.indexOf('--steps');
const steps = new Set((stepsArg >= 0 ? (args[stepsArg + 1] ?? '') : 'blend,stills,bake,export').split(','));
const moodsArg = args.indexOf('--moods');
const moods = (moodsArg >= 0 ? (args[moodsArg + 1] ?? '') : 'buried,reanimating,alive,relapsed').split(',');

function run(cmd: string, argv: string[]): string {
  return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
}

function blender(): void {
  const version = run(BLENDER, ['--version']).split('\n')[0];
  console.log(`blender: ${version}`);
  const out = run(BLENDER, ['--background', '--factory-startup', '--python', join(HERE, 'build_lab.py'), '--', '--out', BUILD, ...args]);
  for (const line of out.split('\n')) if (line.startsWith('[lab]')) console.log(line);
  if (!out.includes('[lab] report')) throw new Error('build_lab.py did not finish; see the Blender output above');
}

function toWebp(png: Uint8Array): Uint8Array {
  const work = join(tmpdir(), `lab-webp-${process.pid}`);
  mkdirSync(work, { recursive: true });
  try {
    const src = join(work, 'in.png');
    const dst = join(work, 'out.webp');
    writeFileSync(src, png);
    run('cwebp', ['-quiet', '-q', TEXTURE_WEBP_QUALITY, '-m', '6', '-sharp_yuv', src, '-o', dst]);
    return readFileSync(dst);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function compressGlb(): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });
  const doc = await io.read(join(BUILD, 'lab-raw.glb'));
  doc.createExtension(EXTTextureWebP).setRequired(true);
  // Blender writes its render aspect (16:9); the live canvas decides the aspect instead.
  for (const camera of doc.getRoot().listCameras()) camera.setAspectRatio(null);
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image || texture.getMimeType() === 'image/webp') continue;
    // The only textures are the baked base colours (sRGB); three builds the mipmaps.
    texture.setImage(toWebp(image)).setMimeType('image/webp').setURI(texture.getURI().replace(/\.\w+$/, '.webp'));
  }
  // keepLeaves: the light/camera empties (ArcLamp_*_Light, AlarmBeacon_Light, KeyLight,
  // Camera_Target) are leaf nodes that task 19 attaches to. dedup lets the eight reels share one mesh.
  await doc.transform(dedup(), prune({ keepLeaves: true }), draco({ method: 'edgebreaker' }));
  mkdirSync(dirname(GLB_OUT), { recursive: true });
  await io.write(GLB_OUT, doc);
  report(doc);
}

function report(doc: Document): void {
  const root = doc.getRoot();
  let triangles = 0;
  let primitives = 0;
  for (const node of root.listNodes()) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      primitives++;
      const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0;
      triangles += count / 3;
    }
  }
  const size = statSync(GLB_OUT).size;
  const summary = {
    file: 'web/public/models/lab.glb',
    bytes: size,
    triangles,
    drawCalls: primitives,
    materials: root.listMaterials().map((m) => m.getName()),
    textures: root.listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage()?.byteLength })),
    nodes: root.listNodes().map((n) => n.getName()),
  };
  writeFileSync(join(BUILD, 'glb-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`lab.glb: ${(size / 1024 / 1024).toFixed(2)} MB, ${triangles} triangles, ${primitives} draw calls, ${summary.materials.length} materials`);
  if (size > GLB_BUDGET_BYTES) throw new Error(`lab.glb is ${size} bytes, over the 8 MB budget (Requirement 9.4)`);
}

/** Highest quality whose output fits the budget; returns the bytes written. */
function encodeWithin(encode: (q: number, out: string) => void, out: string, qualities: number[]): number {
  for (const q of qualities) {
    encode(q, out);
    const bytes = statSync(out).size;
    if (bytes <= STILL_BUDGET_BYTES) return bytes;
  }
  return statSync(out).size;
}

function encodeStills(): void {
  for (const mood of moods) {
    const png = join(BUILD, 'stills', `${mood}.png`);
    if (!existsSync(png)) throw new Error(`missing render ${png}`);
    const webp = join(STILLS_OUT, `${mood}.webp`);
    const avif = join(STILLS_OUT, `${mood}.avif`);
    const webpBytes = encodeWithin((q, out) => run('cwebp', ['-quiet', '-q', String(q), '-m', '6', png, '-o', out]), webp, [82, 76, 70, 64, 58, 50]);
    const avifBytes = encodeWithin((q, out) => run('avifenc', ['-q', String(q), '-s', '4', png, out]), avif, [66, 60, 55, 50, 45, 40]);
    console.log(`stills/${mood}: avif ${(avifBytes / 1024).toFixed(0)} KB, webp ${(webpBytes / 1024).toFixed(0)} KB`);
  }
}

blender();
if (steps.has('export')) await compressGlb();
if (steps.has('stills')) encodeStills();
