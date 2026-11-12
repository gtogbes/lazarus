// @vitest-environment node
/// <reference types="node" />
/**
 * The shipped GLB honours the node contract `LabScene` relies on (art/lab/README.md).
 * Read with gltf-transform, Draco decoded, so a corrupt export also fails here.
 */
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CAMERA_TARGET,
  EMPTY_NODES,
  HERO_CAMERA,
  LAB_MODEL_PATH,
  MATERIALS,
  MESH_NODES,
  REELS,
  STATIC_MESHES,
} from './labModel';

const glbPath = fileURLToPath(new URL(`../../public/${LAB_MODEL_PATH}`, import.meta.url));

let doc: Document;
const byName = new Map<string, Node>();

beforeAll(async () => {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
  doc = await io.read(glbPath);
  for (const node of doc.getRoot().listNodes()) byName.set(node.getName(), node);
});

describe('lab.glb node contract', () => {
  it('has every mesh node, each with a mesh, at the scene root', () => {
    const roots = new Set(doc.getRoot().listScenes()[0]?.listChildren().map((n) => n.getName()));
    for (const name of MESH_NODES) {
      expect(byName.get(name)?.getMesh(), name).toBeTruthy();
      expect(roots.has(name), `${name} at the root`).toBe(true);
    }
    expect(STATIC_MESHES).toHaveLength(3);
    expect(REELS).toHaveLength(8);
  });

  it('has every light and aim empty', () => {
    for (const name of EMPTY_NODES) {
      const node = byName.get(name);
      expect(node, name).toBeDefined();
      expect(node?.getMesh(), `${name} has no mesh`).toBeNull();
    }
  });

  it('has the hero camera the stills use: [0, 2.4, 6.5], 40 degree vertical fov, aimed at [0, 1.45, 0]', () => {
    const camera = byName.get(HERO_CAMERA);
    const yfov = camera?.getCamera()?.getYFov() ?? 0;
    expect((yfov * 180) / Math.PI).toBeCloseTo(40, 3);
    expectVec(camera?.getTranslation(), [0, 2.4, 6.5]);
    expectVec(byName.get(CAMERA_TARGET)?.getTranslation(), [0, 1.45, 0]);
  });

  it('has the materials the scene drives, with reel hubs at the cabinet reels', () => {
    const materials = new Set(doc.getRoot().listMaterials().map((m) => m.getName()));
    for (const name of Object.values(MATERIALS)) expect(materials.has(name), name).toBe(true);
    for (const name of REELS) expect(byName.get(name)?.getTranslation()[1]).toBeCloseTo(1.85, 4);
  });

  it('stays inside the 3D asset budget on its own (Requirement 9.4: under 8 MB in total)', () => {
    expect(statSync(glbPath).size).toBeLessThan(2 * 1024 * 1024);
  });
});

function expectVec(actual: readonly number[] | undefined, expected: readonly number[]) {
  expect(actual).toBeDefined();
  expected.forEach((v, i) => expect(actual?.[i]).toBeCloseTo(v, 4));
}
