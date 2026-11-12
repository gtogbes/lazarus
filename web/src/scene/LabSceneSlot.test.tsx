import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProofRun } from '../features/proof/useProofRun';
import { LabSceneSlot } from './LabSceneSlot';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const scene = vi.hoisted(() => ({ requested: false, throwOnRender: false }));
const gpu = vi.hoisted(() => ({ available: true }));

// Stand-in for the three.js chunk. `requested` records whether the chunk was imported at all.
vi.mock('./LabScene', () => {
  scene.requested = true;
  return {
    default: function FakeLabScene() {
      if (scene.throwOnRender) throw new Error('Error creating WebGL context.');
      return <canvas data-testid="lab-scene" />;
    },
  };
});

vi.mock('./webgl', () => ({ hasWebGL: () => gpu.available }));

/** A `matchMedia` whose reduced-motion answer the test can flip, firing `change` like a browser. */
function fakeReducedMotion(initial: boolean) {
  let reduce = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return query === REDUCED_MOTION && reduce;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }) as unknown as MediaQueryList;
  return {
    set(value: boolean) {
      reduce = value;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  gpu.available = true;
  scene.throwOnRender = false;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  act(() => useProofRun.getState().reset());
  vi.restoreAllMocks();
});

function still() {
  return screen.findByTestId('lab-still');
}

/** Let the first-paint and idle gate open. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

// These first two tests must run before any test that loads the scene: a module
// is imported once per file, so `scene.requested` stays true afterwards.
describe('LabSceneSlot stills (Requirement 7.4)', () => {
  it('shows the still under reduced motion and never requests the scene chunk', async () => {
    fakeReducedMotion(true);
    render(<LabSceneSlot />);
    const img = await still();
    await settle();
    expect(scene.requested).toBe(false);
    expect(screen.queryByTestId('lab-scene')).not.toBeInTheDocument();
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('src', '/stills/buried.webp');
    expect(img.closest('[aria-hidden="true"]')).toHaveAttribute('inert');
  });

  it('shows the still without WebGL and never requests the scene chunk', async () => {
    fakeReducedMotion(false);
    gpu.available = false;
    render(<LabSceneSlot />);
    await still();
    await settle();
    expect(scene.requested).toBe(false);
    expect(screen.queryByTestId('lab-scene')).not.toBeInTheDocument();
  });

  it('swaps the still when the status changes; an error is never the Relapsed still', async () => {
    fakeReducedMotion(true);
    render(<LabSceneSlot />);
    const img = await still();

    act(() => useProofRun.setState({ status: 'reanimating' }));
    expect(img).toHaveAttribute('src', '/stills/reanimating.webp');
    act(() => useProofRun.setState({ status: 'alive' }));
    expect(img).toHaveAttribute('src', '/stills/alive.webp');
    act(() => useProofRun.setState({ status: 'relapsed' }));
    expect(img).toHaveAttribute('src', '/stills/relapsed.webp');
    expect(img.style.filter).toBe('');

    act(() => useProofRun.setState({ status: 'error' }));
    expect(img).toHaveAttribute('data-mood', 'fault');
    expect(img).toHaveAttribute('src', '/stills/buried.webp');
    expect(img.style.filter).toContain('grayscale');

    // The AVIF source follows the same still.
    expect(img.parentElement?.querySelector('source')).toHaveAttribute('srcset', '/stills/buried.avif');
  });

  it('swaps between scene and still when reduced motion is toggled mid-session', async () => {
    const motion = fakeReducedMotion(false);
    render(<LabSceneSlot />);
    expect(await screen.findByTestId('lab-scene')).toBeInTheDocument();
    expect(screen.queryByTestId('lab-still')).not.toBeInTheDocument();

    motion.set(true);
    expect(screen.getByTestId('lab-still')).toBeInTheDocument();
    expect(screen.queryByTestId('lab-scene')).not.toBeInTheDocument();

    motion.set(false);
    expect(await screen.findByTestId('lab-scene')).toBeInTheDocument();
    expect(screen.queryByTestId('lab-still')).not.toBeInTheDocument();
  });

  it('is a fixed full-viewport layer whose data-mood follows the proof status', async () => {
    fakeReducedMotion(false);
    render(<LabSceneSlot />);
    await screen.findByTestId('lab-scene');
    const layer = screen.getByTestId('lab-scene-layer');
    expect(layer).toHaveClass('fixed', 'inset-0', 'pointer-events-none');
    expect(layer).toHaveAttribute('data-scene', 'canvas');
    expect(layer).toHaveAttribute('data-mood', 'buried');
    act(() => useProofRun.setState({ status: 'reanimating' }));
    expect(layer).toHaveAttribute('data-mood', 'reanimating');
    act(() => useProofRun.setState({ status: 'relapsed' }));
    expect(layer).toHaveAttribute('data-mood', 'relapsed');
    act(() => useProofRun.setState({ status: 'error' }));
    expect(layer).toHaveAttribute('data-mood', 'fault');
  });

  it('falls back to the still when the scene fails to start', async () => {
    fakeReducedMotion(false);
    scene.throwOnRender = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<LabSceneSlot />);
    expect(await still()).toBeInTheDocument();
    expect(screen.queryByTestId('lab-scene')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to the still when the WebGL context is lost', async () => {
    fakeReducedMotion(false);
    render(<LabSceneSlot />);
    const canvas = await screen.findByTestId('lab-scene');
    // Like the browser's event, it does not bubble.
    act(() => {
      canvas.dispatchEvent(new Event('webglcontextlost', { bubbles: false }));
    });
    expect(screen.getByTestId('lab-still')).toBeInTheDocument();
    expect(screen.queryByTestId('lab-scene')).not.toBeInTheDocument();
  });
});
