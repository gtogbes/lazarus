/**
 * The node contract of the Blender hero GLB (`public/models/lab.glb`), from
 * `art/lab/README.md`. `LabScene` looks these nodes up by name, and
 * `labModel.test.ts` checks the shipped GLB has all of them. No three.js here.
 */

/** Site-relative URL of the GLB (task 18 output). */
export const LAB_MODEL_PATH = 'models/lab.glb';

/** Static meshes: drawn as they come, no runtime changes. */
export const STATIC_MESHES = ['Lab_Room', 'Lab_Props', 'Lab_Indicators'] as const;

export const SLAB = 'Slab';
export const ARC_BULBS = ['ArcLamp_L_Bulb', 'ArcLamp_R_Bulb'] as const;
export const ALARM_BEACON = 'AlarmBeacon';
/** Origin at the hub; spun about local z. */
export const REELS = [0, 1, 2, 3].flatMap((i) => [`Reel_${i}_L`, `Reel_${i}_R`]);

/** Empties where the runtime lights go. */
export const ARC_LIGHTS = ['ArcLamp_L_Light', 'ArcLamp_R_Light'] as const;
export const ALARM_LIGHT = 'AlarmBeacon_Light';
export const KEY_LIGHT = 'KeyLight';
export const KEY_LIGHT_TARGET = 'KeyLight_Target';

/** The stills camera and its aim point; the live camera copies both. */
export const HERO_CAMERA = 'Camera_Hero';
export const CAMERA_TARGET = 'Camera_Target';

/** Every mesh node the scene draws or drives. */
export const MESH_NODES: readonly string[] = [...STATIC_MESHES, SLAB, ...ARC_BULBS, ALARM_BEACON, ...REELS];
/** Every node without a mesh the scene reads. */
export const EMPTY_NODES: readonly string[] = [...ARC_LIGHTS, ALARM_LIGHT, KEY_LIGHT, KEY_LIGHT_TARGET, CAMERA_TARGET];

/** Materials the scene changes or treats specially, by name. */
export const MATERIALS = {
  slab: 'Slab_Top',
  arcBulb: 'ArcBulb',
  alarm: 'AlarmBeacon_Glass',
  reelMetal: 'Reel_Metal',
  propsGloss: 'Props_Gloss',
  /** Baked (WebP) base colour textures; without them the room renders flat grey. */
  roomBaked: 'Room_Baked',
  propsBaked: 'Props_Baked',
  indicatorAmber: 'Indicator_Amber',
  indicatorGreen: 'Indicator_Green',
  crt: 'CRT_Glow',
} as const;
