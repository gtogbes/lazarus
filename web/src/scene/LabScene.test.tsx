/**
 * Teardown of the lab scene with a fake renderer, composer and GLB loader: everything
 * GPU-backed is disposed, the Timer follows page visibility, listeners are removed,
 * and a re-mount reuses the cached GLB.
 */
import { render, waitFor } from '@testing-library/react';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Texture,
  Timer,
  WebGLRenderTarget,
} from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LabScene from './LabScene';
import * as model from './labModel';

const fakes = vi.hoisted(() => ({
  renderers: [] as { dispose: ReturnType<typeof vi.fn> }[],
  composers: [] as { dispose: ReturnType<typeof vi.fn> }[],
  envTargets: [] as unknown[],
  loads: 0,
  gltf: null as unknown,
}));

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    readonly dispose = vi.fn();
    setPixelRatio() {}
    render() {}
    constructor() {
      fakes.renderers.push(this);
    }
  }
  class FakePMREMGenerator {
    fromScene() {
      const target = new three.WebGLRenderTarget(1, 1);
      fakes.envTargets.push(target);
      return target;
    }
    dispose() {}
  }
  return { ...three, WebGLRenderer: FakeRenderer, PMREMGenerator: FakePMREMGenerator };
});

vi.mock('postprocessing', () => {
  class Pass {}
  class EffectComposer {
    readonly dispose = vi.fn();
    addPass() {}
    setSize() {}
    render() {}
    constructor() {
      fakes.composers.push(this);
    }
  }
  class NoiseEffect {
    readonly blendMode = { opacity: { value: 1 } };
  }
  return {
    BlendFunction: { OVERLAY: 0 },
    ToneMappingMode: { ACES_FILMIC: 0 },
    BloomEffect: Pass,
    ToneMappingEffect: Pass,
    NoiseEffect,
    RenderPass: Pass,
    EffectPass: Pass,
    EffectComposer,
  };
});

vi.mock('three/examples/jsm/loaders/DRACOLoader.js', () => ({
  DRACO_GLTF_CONFIG: {},
  DRACOLoader: class {
    setDecoderPath() {
      return this;
    }
    dispose() {}
  },
}));

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setDRACOLoader() {
      return this;
    }
    loadAsync() {
      fakes.loads++;
      return Promise.resolve(fakes.gltf);
    }
  },
}));

/** A GLB stand-in with every contract node and material (labModel.ts). */
function fakeLab() {
  const scene = new Group();
  const map = new Texture({ width: 1, height: 1 });
  const materials = Object.values(model.MATERIALS).map((name) => {
    const m = new MeshStandardMaterial({ name });
    if (name === model.MATERIALS.roomBaked || name === model.MATERIALS.propsBaked) m.map = map;
    return m;
  });
  const geometry = new BoxGeometry();
  for (const name of model.MESH_NODES) {
    const mesh = new Mesh(geometry, name === model.STATIC_MESHES[0] ? materials : materials[0]);
    mesh.name = name;
    scene.add(mesh);
  }
  for (const name of model.EMPTY_NODES) scene.add(Object.assign(new Object3D(), { name }));
  scene.add(Object.assign(new PerspectiveCamera(40), { name: model.HERO_CAMERA }));
  return { scene, geometry, materials, map };
}

/** Counts `dispose` events per resource. */
function disposeCounter(resources: readonly { addEventListener(type: 'dispose', listener: () => void): void }[]) {
  const counts = new Map(resources.map((r) => [r, 0]));
  for (const r of resources) r.addEventListener('dispose', () => counts.set(r, (counts.get(r) ?? 0) + 1));
  return counts;
}

/** `visibilitychange` listeners currently on `document`. */
function trackVisibilityListeners() {
  const live = new Set<unknown>();
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'visibilitychange') live.add(listener);
    add(type, listener, options);
  });
  vi.spyOn(document, 'removeEventListener').mockImplementation((type, listener, options) => {
    if (type === 'visibilitychange') live.delete(listener);
    remove(type, listener, options);
  });
  return live;
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LabScene teardown', () => {
  it('disposes the renderer, composer, environment target, GLB GPU copies and Timer, and re-mounts from the cache', async () => {
    const lab = fakeLab();
    fakes.gltf = { scene: lab.scene };
    const slab = lab.materials.find((m) => m.name === model.MATERIALS.slab)!;
    const disposals = disposeCounter([lab.geometry, ...lab.materials, lab.map]);
    const listeners = trackVisibilityListeners();
    const connect = vi.spyOn(Timer.prototype, 'connect');
    const timerDispose = vi.spyOn(Timer.prototype, 'dispose');

    const first = render(<LabScene />);
    await waitFor(() => expect(slab.envMap).not.toBeNull());
    expect(connect).toHaveBeenCalledWith(document);
    expect(listeners.size).toBeGreaterThan(0);
    const env = fakes.envTargets.at(-1) as WebGLRenderTarget;
    const envDisposals = disposeCounter([env]);
    first.unmount();

    expect(fakes.renderers.at(-1)!.dispose).toHaveBeenCalledTimes(1);
    expect(fakes.composers.at(-1)!.dispose).toHaveBeenCalledTimes(1);
    expect(envDisposals.get(env)).toBe(1);
    expect(slab.envMap).toBeNull();
    for (const [resource, count] of disposals) expect(count, String((resource as { name?: string }).name)).toBe(1);
    expect(timerDispose).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    // CPU-side data stays, so the next renderer can upload it again.
    expect(lab.geometry.getAttribute('position').array.length).toBeGreaterThan(0);
    expect(lab.map.image).not.toBeNull();

    const second = render(<LabScene />);
    await waitFor(() => expect(slab.envMap).not.toBeNull());
    expect(fakes.loads).toBe(1);
    expect(lab.scene.parent).not.toBeNull();
    second.unmount();
    expect(fakes.renderers).toHaveLength(2);
    expect(fakes.renderers[1]!.dispose).toHaveBeenCalledTimes(1);
  });
});
