/**
 * Full-viewport framing and render resolution for the lab scene. Pure: no three.js.
 *
 * The hero camera (Camera_Hero, 40° vertical field of view) was framed for the wide
 * 3:1 stills. three.js keeps the vertical field of view fixed when the aspect changes,
 * so a portrait phone would see only the middle of the room and lose the arc lamps.
 * `frameCamera` widens the view just enough to keep a given horizontal extent (the
 * lamps plus a margin) in frame, up to `MAX_FOV_DEG`, then steps the camera back along
 * its view line. Nothing is stretched: the aspect itself always matches the canvas.
 */

/** Widest vertical field of view before we dolly instead: wider looks distorted. */
export const MAX_FOV_DEG = 62;

export interface Framing {
  /** Vertical field of view, degrees. */
  readonly fovDeg: number;
  /** Multiplier on the camera's distance from its target (1 = the hero position). */
  readonly dolly: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * @param aspect canvas width / height
 * @param heroFovDeg the hero camera's vertical field of view
 * @param minHalfTanX tan of the half-angle that must stay visible horizontally
 */
export function frameCamera(aspect: number, heroFovDeg: number, minHalfTanX: number): Framing {
  const heroHalfTanY = Math.tan(toRad(heroFovDeg) / 2);
  if (!(aspect > 0) || heroHalfTanY * aspect >= minHalfTanX) return { fovDeg: heroFovDeg, dolly: 1 };
  const needHalfTanY = minHalfTanX / aspect;
  const maxHalfTanY = Math.tan(toRad(MAX_FOV_DEG) / 2);
  if (needHalfTanY <= maxHalfTanY) return { fovDeg: toDeg(2 * Math.atan(needHalfTanY)), dolly: 1 };
  return { fovDeg: MAX_FOV_DEG, dolly: needHalfTanY / maxHalfTanY };
}

/**
 * Highest device pixel ratio the scene renders at. The scene sits behind dimmed,
 * blurred panels, so 1.5 is sharp enough and costs about half of DPR 2.
 */
export const MAX_DPR = 1.5;
/** Render budget in device pixels: a 1920 x 1080 viewport at DPR 1.25. Larger screens render below DPR 1. */
export const MAX_RENDER_PIXELS = 1920 * 1080 * 1.25;
/** Never below this, or the scene turns to mush when upscaled. */
export const MIN_DPR = 0.5;

/** Pixel ratio for a canvas of `cssWidth` x `cssHeight` on a `deviceDpr` screen. */
export function renderDpr(deviceDpr: number, cssWidth: number, cssHeight: number): number {
  const device = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  const area = Math.max(1, cssWidth) * Math.max(1, cssHeight);
  const byBudget = Math.sqrt(MAX_RENDER_PIXELS / area);
  return Math.max(MIN_DPR, Math.min(device, MAX_DPR, byBudget));
}
