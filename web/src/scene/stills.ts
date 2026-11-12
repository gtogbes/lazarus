/**
 * Pre-rendered stills shown instead of the 3D scene under reduced motion or
 * without WebGL (Requirement 7.4). Pure: no React, no three.js.
 *
 * Files live in `web/public/stills/` and ship at fixed paths, so the Blender
 * renders (task 18, `npm run art:lab`) drop in by replacing files; no code changes:
 *
 * | Still       | Moods shown         | Files                                   |
 * |-------------|---------------------|-----------------------------------------|
 * | buried      | buried, fault       | `stills/buried.avif`, `buried.webp`     |
 * | reanimating | reanimating         | `stills/reanimating.avif`, `.webp`      |
 * | alive       | alive (steady glow) | `stills/alive.avif`, `alive.webp`       |
 * | relapsed    | relapsed            | `stills/relapsed.avif`, `relapsed.webp` |
 *
 * There are four stills, one per status in the design. `fault` (a run error)
 * has no still of its own: it shows the Buried still desaturated and dimmed,
 * matching the scene's dim neutral fault light. It never uses the Relapsed
 * still, because an error is not a divergence.
 *
 * See `docs/stills.md` for sizes and formats.
 */
import type { SceneMood } from './sceneLook';

export type StillName = 'buried' | 'reanimating' | 'alive' | 'relapsed';

export const STILL_NAMES: readonly StillName[] = ['buried', 'reanimating', 'alive', 'relapsed'];

/** Intrinsic size of the stills (3:1). Only the aspect ratio matters: the full-viewport layer crops to cover. */
export const STILL_WIDTH = 2400;
export const STILL_HEIGHT = 800;

/** CSS filter that turns the Buried still into the fault look: grey, dim, no colour. */
export const FAULT_FILTER = 'grayscale(1) brightness(0.55)';

export interface StillChoice {
  readonly name: StillName;
  /** CSS filter applied over the image, or undefined for none. */
  readonly filter: string | undefined;
}

export function stillForMood(mood: SceneMood): StillChoice {
  switch (mood) {
    case 'fault':
      return { name: 'buried', filter: FAULT_FILTER };
    case 'buried':
    case 'reanimating':
    case 'alive':
    case 'relapsed':
      return { name: mood, filter: undefined };
  }
}

export function stillUrls(name: StillName, base: string = import.meta.env.BASE_URL): { avif: string; webp: string } {
  return { avif: `${base}stills/${name}.avif`, webp: `${base}stills/${name}.webp` };
}
