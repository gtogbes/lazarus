import { describe, expect, it } from 'vitest';
import { ADJACENT_GRAPHICS, PANEL_BACKGROUNDS, VITALS_GRAPHICS, VITALS_TEXT } from './palette';

/** WCAG 2.x contrast ratio between two #rrggbb colours (same formula as build/programSources.test.ts). */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const backgrounds = Object.values(PANEL_BACKGROUNDS);

describe('vitals palette (Requirement 14.2)', () => {
  it('derives the light end of the panel from zinc-950 at 88% over white', () => {
    // 0.88 * 9 + 0.12 * 255 = 38.5, 0.88 * 11 + 0.12 * 255 = 40.3 (surface.ts)
    expect(PANEL_BACKGROUNDS.lightest).toBe('#272728');
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it.each(Object.entries(VITALS_TEXT))('text %s (%s) clears 4.5:1 on the panel', (_, color) => {
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    for (const background of backgrounds) {
      expect(contrast(color, background), `${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(Object.entries(VITALS_GRAPHICS))('graphic %s (%s) clears 3:1 on the panel', (_, color) => {
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    for (const background of backgrounds) {
      expect(contrast(color, background), `${color} on ${background}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(ADJACENT_GRAPHICS)('adjacent graphics %s and %s clear 3:1', (a, b) => {
    expect(contrast(VITALS_GRAPHICS[a], VITALS_GRAPHICS[b])).toBeGreaterThanOrEqual(3);
  });
});
