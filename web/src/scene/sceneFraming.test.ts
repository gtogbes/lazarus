import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_DPR, MAX_FOV_DEG, MAX_RENDER_PIXELS, MIN_DPR, frameCamera, renderDpr } from './sceneFraming';

const HERO_FOV = 40;
/** The arc lamps in lab.glb: x = 1.9 m, 5.9 m in front of the hero camera, with a 15% margin (LabScene LAMP_MARGIN). */
const LAMPS = (1.9 / 5.9) * 1.15;
const tanHalf = (deg: number) => Math.tan((deg * Math.PI) / 360);

describe('frameCamera', () => {
  it('keeps the hero view on wide screens', () => {
    for (const aspect of [16 / 9, 1.6, 21 / 9, 3]) {
      expect(frameCamera(aspect, HERO_FOV, LAMPS)).toEqual({ fovDeg: HERO_FOV, dolly: 1 });
    }
  });

  it('widens, then steps back, on portrait phones', () => {
    const tablet = frameCamera(1, HERO_FOV, LAMPS);
    expect(tablet.fovDeg).toBeGreaterThan(HERO_FOV);
    expect(tablet.dolly).toBe(1);
    const phone = frameCamera(390 / 844, HERO_FOV, LAMPS);
    expect(phone.fovDeg).toBe(MAX_FOV_DEG);
    expect(phone.dolly).toBeGreaterThan(1);
  });

  it('always keeps the lamps in frame, with the fov between the hero and the cap', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.3, max: 4, noNaN: true }), (aspect) => {
        const { fovDeg, dolly } = frameCamera(aspect, HERO_FOV, LAMPS);
        expect(fovDeg).toBeGreaterThanOrEqual(HERO_FOV - 1e-9);
        expect(fovDeg).toBeLessThanOrEqual(MAX_FOV_DEG + 1e-9);
        expect(dolly).toBeGreaterThanOrEqual(1);
        // Visible horizontal half-tan, scaled by the dolly (objects near the target shrink by 1 / dolly).
        expect(tanHalf(fovDeg) * aspect * dolly).toBeGreaterThanOrEqual(LAMPS - 1e-9);
      }),
    );
  });

  it('never steps back or widens more for a wider screen', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.3, max: 4, noNaN: true }), fc.double({ min: 0.3, max: 4, noNaN: true }), (a, b) => {
        const [narrow, wide] = a < b ? [a, b] : [b, a];
        const n = frameCamera(narrow, HERO_FOV, LAMPS);
        const w = frameCamera(wide, HERO_FOV, LAMPS);
        expect(w.fovDeg).toBeLessThanOrEqual(n.fovDeg + 1e-9);
        expect(w.dolly).toBeLessThanOrEqual(n.dolly + 1e-9);
      }),
    );
  });
});

describe('renderDpr', () => {
  it('caps the pixel ratio at 1.5 and the render size at the pixel budget', () => {
    expect(renderDpr(1, 1280, 800)).toBe(1);
    expect(renderDpr(2, 1280, 800)).toBe(MAX_DPR);
    expect(renderDpr(2, 1920, 1080)).toBeCloseTo(Math.sqrt(1.25), 5);
    // A 4K screen at DPR 2 (1920 x 1080 CSS px) renders the same pixels as 1920 x 1080 at 1.12.
    expect(renderDpr(1, 3840, 2160)).toBeCloseTo(Math.sqrt(MAX_RENDER_PIXELS / (3840 * 2160)), 5);
    expect(renderDpr(Number.NaN, 800, 600)).toBe(1);
  });

  it('stays within the bounds and the budget for any screen', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 4, noNaN: true }),
        fc.integer({ min: 200, max: 8000 }),
        fc.integer({ min: 200, max: 5000 }),
        (device, w, h) => {
          const dpr = renderDpr(device, w, h);
          expect(dpr).toBeGreaterThanOrEqual(MIN_DPR);
          expect(dpr).toBeLessThanOrEqual(Math.max(MIN_DPR, Math.min(device, MAX_DPR)));
          if (dpr > MIN_DPR) expect(w * h * dpr * dpr).toBeLessThanOrEqual(MAX_RENDER_PIXELS * (1 + 1e-9));
        },
      ),
    );
  });
});
