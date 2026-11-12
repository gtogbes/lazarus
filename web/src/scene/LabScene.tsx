/**
 * The lab scene (task 19): the Blender hero GLB (`public/models/lab.glb`, node
 * contract in `labModel.ts` and art/lab/README.md), lit at runtime from
 * `sceneFrame` in `sceneLook.ts`, with bloom on the emissives and subtle grain.
 *
 * Loaded lazily by `LabSceneSlot`, the full-viewport background layer that
 * AppShell mounts once for every page; this module is the only one that imports
 * three.js, so three stays out of the entry bundle. If the GLB or a decoder
 * fails to load, the error reaches the slot's `SceneBoundary`, which shows the
 * still instead.
 *
 * Full-screen cost control: the camera is framed per aspect and the pixel ratio
 * is capped by a pixel budget (sceneFraming.ts), steady moods render at 30 fps
 * (sceneLook `targetFps`), and nothing renders while the tab is hidden.
 *
 * The Draco decoder is served from this site, never from a CDN (see `loadLabModel`).
 *
 * The scene reads `useProofRun` inside the frame loop (`getState`), so the 4 Hz
 * progress updates never re-render React. No text, logos or source code are
 * drawn in 3D (Requirements 2.4, 7.5).
 *
 * Plain three.js, no React renderer: React owns the `<canvas>` and its lifetime,
 * `startLab` owns everything drawn on it. The frame loop is our own
 * requestAnimationFrame loop timed by `THREE.Timer` (React Three Fiber 9 builds a
 * deprecated `THREE.Clock` for every canvas, whether or not its loop runs).
 */
import { BlendFunction, BloomEffect, EffectComposer, EffectPass, NoiseEffect, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  Group,
  HalfFloatType,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  SpotLight,
  Timer,
  WebGLRenderer,
  type Material,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DRACO_GLTF_CONFIG, DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useProofRun } from '../features/proof/useProofRun';
import * as model from './labModel';
import { frameCamera, renderDpr } from './sceneFraming';
import {
  advancePhase,
  casesPerSecond,
  flickerHz,
  moodForStatus,
  sceneFrame,
  targetFps,
  withNudge,
  type SceneMood,
} from './sceneLook';
import { useSceneNudge } from './sceneNudge';

/** Longest frame step we animate; after a pause the scene resumes instead of jumping. */
const MAX_DT_SEC = 0.1;
const MOTE_COUNT = 240;

/**
 * sceneLook intensity 1.0 in three.js units (candela for the lights, emissive
 * multiplier for the glowing materials). Tuned by eye against the Cycles stills
 * (art/lab/build_lab.py: KEY_WATTS, ARC_WATTS, BULB_EMISSION and so on).
 */
const KEY_CANDELA = 200;
const ARC_CANDELA = 9;
const ALARM_CANDELA = 14;
const AMBIENT = 0.7;
const BULB_EMISSION = 14;
const BEACON_EMISSION = 8;
const SLAB_EMISSION = 0.9;
/** Fixed glow of the panel lamps and the CRT (Blender emission strengths). */
const INDICATOR_EMISSION: Readonly<Record<string, number>> = {
  [model.MATERIALS.indicatorAmber]: 3,
  [model.MATERIALS.indicatorGreen]: 2,
  [model.MATERIALS.crt]: 0.6,
};
/** Environment reflections on the metal reels and slab, and on the gloss panels. */
const METAL_ENV = 0.08;
const GLOSS_ENV = 0.08;
/** Emissive colours the GLB does not carry (exported at strength 0, so its factor is black). */
const SLAB_EMISSIVE = 0xffd9a8;
const ALARM_EMISSIVE = 0xff2a1a;

/** Only emissives (HDR values above 1) bloom; lit surfaces stay below the threshold. */
const BLOOM = { intensity: 0.7, luminanceThreshold: 1, luminanceSmoothing: 0.25, radius: 0.6 } as const;
/** Film grain strength (0 to 1). Subtle on purpose. */
const GRAIN_OPACITY = 0.06;
/**
 * Horizontal extent kept in frame on narrow (portrait) viewports: the arc lamps'
 * offset from the centre line, plus this share again as margin for their stands.
 */
const LAMP_MARGIN = 1.15;
/** Frame-rate limiter slack: a frame that arrives this early still counts as due. */
const FRAME_SLACK_SEC = 0.002;
const BACKGROUND = 0x07080a;
const FOG = { near: 7, far: 18 } as const;
/** Where the camera starts; `frameCamera` moves it once the GLB is in. */
const CAMERA = { position: [0, 2.4, 6.5], fov: 40, near: 0.1, far: 40 } as const;

// Performance runs (`vite build --mode perf`, web/perf/) drive the store from Playwright.
// Vite replaces MODE at build time, so this block is removed from normal builds.
if (import.meta.env.MODE === 'perf') {
  (window as unknown as Record<string, unknown>)['__lazarusProofRun'] = useProofRun;
}

export default function LabScene() {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Thrown while rendering, so a WebGL start-up or GLB load error reaches the slot's `SceneBoundary`.
  const [failure, setFailure] = useState<{ readonly error: unknown } | null>(null);
  if (failure) throw failure.error;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    try {
      return startLab(element, (error) => setFailure({ error }));
    } catch (error) {
      setFailure({ error });
      return undefined;
    }
  }, []);
  return (
    <canvas
      ref={canvas}
      style={{ display: 'block', position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}

let labModel: Promise<GLTF> | undefined;

/**
 * Loads the GLB once per page; the Draco decoder runs in workers that are freed once it has loaded.
 *
 * Decoder files: three's DRACOLoader points at them with `new URL('../libs/...', import.meta.url)`,
 * so Vite copies them from the installed (pinned) three package into `assets/` with a
 * content hash and the loader fetches them from this site, never from a CDN. Draco uses the
 * smaller glTF-only decoder. The baked textures are WebP (EXT_texture_webp), decoded by the
 * browser: KTX2 was dropped because three's Basis transcoder needs `new Function`, which the
 * site CSP blocks (task 21, art/lab/build.ts).
 */
function loadLabModel(): Promise<GLTF> {
  labModel ??= (async () => {
    const base = import.meta.env.BASE_URL;
    const draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
    try {
      return await new GLTFLoader().setDRACOLoader(draco).loadAsync(base + model.LAB_MODEL_PATH);
    } finally {
      draco.dispose();
    }
  })();
  return labModel;
}

interface LabRig {
  readonly root: Object3D;
  readonly heroCamera: PerspectiveCamera;
  readonly cameraTarget: Object3D;
  readonly keyLight: Object3D;
  readonly keyTarget: Object3D;
  readonly arcLights: readonly Object3D[];
  readonly alarmLight: Object3D;
  readonly arcBulb: MeshStandardMaterial;
  readonly alarm: MeshStandardMaterial;
  readonly slab: MeshStandardMaterial;
  readonly reels: readonly Object3D[];
  /** Materials that get the environment map, with their strength. */
  readonly reflective: readonly (readonly [MeshStandardMaterial, number])[];
}

/** Finds the contract nodes; a missing one throws, so the slot falls back to the still. */
function rigLab(root: Object3D): LabRig {
  const node = (name: string): Object3D => {
    const found = root.getObjectByName(name);
    if (!found) throw new Error(`lab.glb has no node ${name}`);
    return found;
  };
  const materials = new Map<string, MeshStandardMaterial>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of ([] as Material[]).concat(o.material)) {
      if (m instanceof MeshStandardMaterial) materials.set(m.name, m);
    }
  });
  const material = (name: string): MeshStandardMaterial => {
    const found = materials.get(name);
    if (!found) throw new Error(`lab.glb has no material ${name}`);
    return found;
  };
  for (const name of model.MESH_NODES) node(name);
  // GLTFLoader only warns when a texture fails (for example the WebP image was blocked or corrupt).
  for (const name of [model.MATERIALS.roomBaked, model.MATERIALS.propsBaked]) {
    if (!material(name).map) throw new Error(`lab.glb material ${name} has no baked texture`);
  }
  const heroCamera = node(model.HERO_CAMERA);
  if (!(heroCamera instanceof PerspectiveCamera)) throw new Error('Camera_Hero is not a perspective camera');

  const slab = material(model.MATERIALS.slab);
  slab.emissive.setHex(SLAB_EMISSIVE);
  slab.emissiveIntensity = 0;
  const alarm = material(model.MATERIALS.alarm);
  alarm.emissive.setHex(ALARM_EMISSIVE);
  alarm.emissiveIntensity = 0;
  for (const [name, strength] of Object.entries(INDICATOR_EMISSION)) material(name).emissiveIntensity = strength;

  return {
    root,
    heroCamera,
    cameraTarget: node(model.CAMERA_TARGET),
    keyLight: node(model.KEY_LIGHT),
    keyTarget: node(model.KEY_LIGHT_TARGET),
    arcLights: model.ARC_LIGHTS.map(node),
    alarmLight: node(model.ALARM_LIGHT),
    arcBulb: material(model.MATERIALS.arcBulb),
    alarm,
    slab,
    reels: model.REELS.map(node),
    reflective: [
      [material(model.MATERIALS.reelMetal), METAL_ENV],
      [slab, METAL_ENV],
      [material(model.MATERIALS.propsGloss), GLOSS_ENV],
    ],
  };
}

/**
 * Draws the lab on `canvas` until the returned function is called. Errors that happen
 * later (the GLB or a decoder fails to load, a contract node is missing) go to `fail`;
 * a WebGL start-up error is thrown straight away.
 */
function startLab(canvas: HTMLCanvasElement, fail: (error: unknown) => void): () => void {
  // The composer renders into its own buffers, so canvas antialiasing would be wasted.
  // Tone mapping happens in the effect pass, so the renderer keeps three's default (none).
  const renderer = new WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  scene.fog = new Fog(BACKGROUND, FOG.near, FOG.far);
  const camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.position.set(...CAMERA.position);
  camera.lookAt(0, 0, 0);
  const composer = createComposer(renderer, scene, camera);

  let lab: LabStage | null = null;
  let disposed = false;
  // Render at full rate only while something changes quickly; steady moods render at
  // half rate (sceneLook `targetFps`). Skipping a frame leaves the last one on screen.
  // `due` forces the next frame, after a resize has cleared the canvas.
  const renderLimiter = { sec: 0, mood: null as SceneMood | null, moodSec: 0, due: true };

  // Keeps the render resolution within budget as the canvas changes size (sceneFraming `renderDpr`).
  const resize = () => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(renderDpr(window.devicePixelRatio, width, height));
    composer.setSize(width, height, false);
    camera.aspect = width / height;
    if (lab) frameLab(camera, lab.rig, camera.aspect);
    camera.updateProjectionMatrix();
    renderLimiter.due = true;
    // Until the GLB is in, show the empty room colour.
    if (!lab) renderer.render(scene, camera);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  // Moving the window to another screen changes devicePixelRatio without a resize.
  let dprQuery: MediaQueryList | undefined;
  const onDprChange = () => {
    resize();
    watchDpr();
  };
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  };
  watchDpr();

  const step = (delta: number) => {
    const { status, executions, elapsedMs } = useProofRun.getState();
    const mood = moodForStatus(status);
    const nudgedAt = useSceneNudge.getState().startedAt;
    const sinceNudgeSec = nudgedAt === null ? null : (performance.now() - nudgedAt) / 1000;
    if (!lab) return;
    lab.animate(mood, Math.min(MAX_DT_SEC, delta), casesPerSecond(executions, elapsedMs), sinceNudgeSec);
    const p = renderLimiter;
    p.sec += delta;
    if (mood !== p.mood) {
      p.mood = mood;
      p.moodSec = 0;
    } else {
      p.moodSec += delta;
    }
    if (!p.due && p.sec + FRAME_SLACK_SEC < 1 / targetFps(mood, p.moodSec, sinceNudgeSec)) return;
    composer.render(Math.min(MAX_DT_SEC, p.sec));
    p.sec = 0;
    p.due = false;
  };

  // Our own loop, timed by THREE.Timer; nothing renders while the tab is hidden.
  const timer = new Timer();
  let frame: number | undefined;
  const tick = (timestamp: number) => {
    frame = requestAnimationFrame(tick);
    timer.update(timestamp);
    step(timer.getDelta());
  };
  const play = () => {
    if (frame !== undefined || document.visibilityState === 'hidden') return;
    // After a pause the scene resumes where it was instead of jumping.
    timer.reset();
    frame = requestAnimationFrame(tick);
  };
  const pause = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  const onVisibilityChange = () => (document.visibilityState === 'hidden' ? pause() : play());
  document.addEventListener('visibilitychange', onVisibilityChange);

  resize();
  loadLabModel()
    .then((gltf) => {
      if (disposed) return;
      lab = createLabStage(rigLab(gltf.scene), renderer);
      scene.add(lab.root);
      resize();
      play();
    })
    .catch((error: unknown) => {
      if (!disposed) fail(error);
    });

  return () => {
    disposed = true;
    pause();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    dprQuery?.removeEventListener('change', onDprChange);
    resizeObserver.disconnect();
    timer.dispose();
    if (lab) {
      scene.remove(lab.root);
      lab.dispose();
    }
    composer.dispose();
    renderer.dispose();
  };
}

/** Bloom on the emissives, then ACES tone mapping, then film grain. */
function createComposer(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): EffectComposer {
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 4 });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({ mipmapBlur: true, ...BLOOM });
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
  grain.blendMode.opacity.value = GRAIN_OPACITY;
  composer.addPass(new EffectPass(camera, bloom, toneMapping, grain));
  return composer;
}

/**
 * The view of the Cycles stills (hero camera aimed at Camera_Target), widened and
 * stepped back on narrow viewports so the slab, lamps and beacon stay in frame.
 * The caller updates the projection matrix.
 */
function frameLab(camera: PerspectiveCamera, rig: LabRig, aspect: number): void {
  const target = rig.cameraTarget.position;
  const toCamera = rig.heroCamera.position.clone().sub(target);
  const lamp = rig.arcLights[0]?.position;
  const lampDepth = lamp ? rig.heroCamera.position.z - lamp.z : toCamera.length();
  const lampHalfTan = lamp ? (Math.abs(lamp.x) / lampDepth) * LAMP_MARGIN : 0;
  const { fovDeg, dolly } = frameCamera(aspect, rig.heroCamera.fov, lampHalfTan);
  camera.position.copy(target).addScaledVector(toCamera, dolly);
  camera.fov = fovDeg;
  camera.near = rig.heroCamera.near;
  camera.lookAt(target);
}

interface LabStage {
  readonly rig: LabRig;
  /** The GLB plus the runtime lights and motes, as one group. */
  readonly root: Group;
  animate(mood: SceneMood, dt: number, casesPerSec: number, sinceNudgeSec: number | null): void;
  /** Frees what this stage created. The GLB stays loaded (and cached) for a later mount. */
  dispose(): void;
}

/** Lights the rigged GLB at runtime from `sceneFrame` (sceneLook.ts). */
function createLabStage(rig: LabRig, renderer: WebGLRenderer): LabStage {
  const root = new Group();
  root.add(rig.root);
  const ambient = new AmbientLight(0xffffff, AMBIENT);
  const key = new SpotLight(0xffffff, 0, 0, 0.6, 0.6, 2);
  key.position.copy(rig.keyLight.position);
  key.target = rig.keyTarget;
  const arcs = rig.arcLights.map((empty) => {
    const light = new PointLight(0xffffff, 0, 7, 2);
    light.position.copy(empty.position);
    return light;
  });
  const alarmLight = new PointLight(ALARM_EMISSIVE, 0, 10, 2);
  alarmLight.position.copy(rig.alarmLight.position);
  const motes = createMotes();
  root.add(ambient, key, ...arcs, alarmLight, motes.group);

  // A small procedural environment for the metals, instead of shipping an HDRI.
  // Only the reflective materials get it: the baked surfaces already carry their ambient light.
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  for (const [m, strength] of rig.reflective) {
    m.envMap = env.texture;
    m.envMapIntensity = strength;
    m.needsUpdate = true;
  }

  const clock = { mood: null as SceneMood | null, sinceMoodSec: 0, flickerPhase: 0 };
  return {
    rig,
    root,
    animate(mood, dt, casesPerSec, sinceNudgeSec) {
      if (mood !== clock.mood) {
        clock.mood = mood;
        clock.sinceMoodSec = 0;
      } else {
        clock.sinceMoodSec += dt;
      }
      clock.flickerPhase = advancePhase(clock.flickerPhase, flickerHz(casesPerSec), dt);
      const look = withNudge(sceneFrame(mood, clock), mood, sinceNudgeSec);

      key.color.setHex(look.keyColor);
      key.intensity = look.keyIntensity * KEY_CANDELA;
      ambient.color.setHex(look.keyColor);
      for (const light of arcs) {
        light.color.setHex(look.arcColor);
        light.intensity = look.arcIntensity * ARC_CANDELA;
      }
      // ArcBulb is shared by both lamps, so one update drives both.
      rig.arcBulb.emissive.setHex(look.arcColor);
      rig.arcBulb.emissiveIntensity = look.arcIntensity * BULB_EMISSION;
      alarmLight.intensity = look.alarmIntensity * ALARM_CANDELA;
      rig.alarm.emissiveIntensity = look.alarmIntensity * BEACON_EMISSION;
      rig.slab.emissiveIntensity = look.slabGlow * SLAB_EMISSION;
      for (const reel of rig.reels) reel.rotation.z -= look.reelSpeed * dt;
      motes.group.rotation.y += look.moteDrift * dt;
    },
    dispose() {
      root.remove(rig.root);
      for (const [m] of rig.reflective) {
        m.envMap = null;
        m.needsUpdate = true;
      }
      env.dispose();
      for (const light of [ambient, key, ...arcs, alarmLight]) light.dispose();
      motes.dispose();
    },
  };
}

function createMotes(): { readonly group: Group; dispose(): void } {
  // Deterministic positions, so every visit looks the same.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const positions = new Float32Array(MOTE_COUNT * 3);
  for (let i = 0; i < MOTE_COUNT; i++) {
    positions[i * 3] = (rand() - 0.5) * 8;
    positions[i * 3 + 1] = rand() * 3.5;
    positions[i * 3 + 2] = (rand() - 0.5) * 6;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: 0xc9d2dc,
    size: 0.02,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const group = new Group();
  group.add(new Points(geometry, material));
  return {
    group,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
