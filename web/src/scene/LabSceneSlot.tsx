/**
 * The lab scene as a fixed, full-viewport background layer behind every page.
 * AppShell mounts it once, so it survives route changes: the GLB loads once and
 * a proof on the program page visibly drives the arcs and alarm (Requirements
 * 7.2, 7.3). The 3D chunk loads once the 2D interface is interactive (Requirement
 * 7.1): after the first paint, when the browser is idle. Nothing here imports three.js.
 *
 * `data-mood` mirrors the mood the scene (or still) is showing, so tests can
 * follow it without reading pixels; `data-scene` says which of the two is up.
 *
 * Under `prefers-reduced-motion: reduce`, without WebGL, or once the scene has
 * failed (chunk error, WebGL start-up error, lost context), the slot shows a
 * pre-rendered still for the current status instead (Requirement 7.4). The
 * branch happens before `<LabScene />` renders, so the 3D chunk is never
 * fetched while a still is shown.
 *
 * The scene is decorative: hidden from assistive tech and inert, so it never
 * takes focus or pointer events.
 */
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useProofRun } from '../features/proof/useProofRun';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { LabStill } from './LabStill';
import { moodForStatus } from './sceneLook';
import { hasWebGL } from './webgl';

const LabScene = lazy(() => import('./LabScene'));

/** Upper bound on waiting for idle time before loading anyway. */
const IDLE_TIMEOUT_MS = 2000;

export function LabSceneSlot() {
  const mood = useProofRun((s) => moodForStatus(s.status));
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const ready = useAfterFirstPaintAndIdle();
  const [sceneFailed, setSceneFailed] = useState(false);
  const slot = useRef<HTMLDivElement>(null);

  // The WebGL probe waits for idle too, and is skipped when motion is reduced.
  const still = reducedMotion || sceneFailed || (ready && !hasWebGL());

  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    // Context events do not bubble; listen in the capture phase.
    const onLost = () => setSceneFailed(true);
    element.addEventListener('webglcontextlost', onLost, true);
    return () => element.removeEventListener('webglcontextlost', onLost, true);
  }, []);

  return (
    <div
      ref={slot}
      aria-hidden="true"
      inert
      data-testid="lab-scene-layer"
      data-mood={mood}
      data-scene={still ? 'still' : ready ? 'canvas' : 'pending'}
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-zinc-950"
    >
      {still ? (
        <LabStill />
      ) : (
        ready && (
          <SceneBoundary onFail={() => setSceneFailed(true)}>
            <Suspense fallback={null}>
              <LabScene />
            </Suspense>
          </SceneBoundary>
        )
      )}
      {/* Vignette: darkens the edges only, so it can never lower text contrast. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgb(9_9_11/0.7)_100%)]" />
    </div>
  );
}

function useAfterFirstPaintAndIdle(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let frame: number | undefined;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => setReady(true);
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === 'function') {
        idle = window.requestIdleCallback(done, { timeout: IDLE_TIMEOUT_MS });
      } else {
        timer = setTimeout(done, 0);
      }
    };
    if (typeof window.requestAnimationFrame === 'function') {
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        whenIdle();
      });
    } else {
      whenIdle();
    }
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
  return ready;
}

/**
 * The scene is decoration: if its chunk fails to load or WebGL cannot start,
 * report it so the slot shows the still, rather than replacing the landing
 * page with the route error.
 */
class SceneBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.warn('Lab scene unavailable; showing a still instead.', error);
    this.props.onFail();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
