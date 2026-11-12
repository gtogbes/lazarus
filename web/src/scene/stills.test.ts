import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneMood } from './sceneLook';
import { FAULT_FILTER, STILL_NAMES, stillForMood, stillUrls } from './stills';
import { detectWebGL } from './webgl';

describe('stillForMood', () => {
  it('has one still per status and maps fault to a dimmed Buried, never Relapsed', () => {
    const moods: SceneMood[] = ['buried', 'reanimating', 'alive', 'relapsed', 'fault'];
    expect(moods.map((m) => stillForMood(m).name)).toEqual(['buried', 'reanimating', 'alive', 'relapsed', 'buried']);
    expect(stillForMood('fault').filter).toBe(FAULT_FILTER);
    expect(stillForMood('relapsed').filter).toBeUndefined();
    expect(STILL_NAMES).toHaveLength(4);
  });

  it('serves AVIF and WebP from fixed paths under the base URL', () => {
    expect(stillUrls('alive', '/lab/')).toEqual({ avif: '/lab/stills/alive.avif', webp: '/lab/stills/alive.webp' });
  });
});

describe('detectWebGL', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is false when no WebGL context can be created', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(detectWebGL()).toBe(false);
  });

  it('is false when creating a context throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(detectWebGL()).toBe(false);
  });

  it('is true with WebGL 1 only, and releases the probe context', () => {
    const loseContext = vi.fn();
    const gl = { getExtension: () => ({ loseContext }) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((id: string) =>
      id === 'webgl' ? gl : null) as unknown as HTMLCanvasElement['getContext']);
    expect(detectWebGL()).toBe(true);
    expect(loseContext).toHaveBeenCalledOnce();
  });
});
