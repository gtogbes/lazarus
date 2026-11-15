/**
 * The one requestAnimationFrame loop shared by every canvas and SVG of the Visuals
 * (graphical-proof design, "frameLoop.ts"; Requirements 15.3 and 15.4).
 *
 * Same pattern as the lab scene (scene/LabScene.tsx): our own rAF loop that reads
 * `useProofRun.getState()` each frame, so progress events at 4 Hz (or 50 Hz in a
 * slow-motion replay) never re-render React. Unlike the scene it does not use
 * `THREE.Timer`: the Visuals live in the program chunk, and importing three there
 * would pull it out of the lazy scene chunk. Drawers get an absolute display time
 * instead of a delta. By default it comes from the active playback clock
 * (proof/playbackClock.ts), so a slow-motion replay's Visuals hold when it pauses,
 * and from `performance.now()` when no clock is active.
 *
 * A drawer registers with the element it draws into. Each frame, every drawer whose
 * element is in view is drawn if it is animating or something changed since its last
 * draw (a store update, coming into view, registering). The loop keeps running only
 * while some drawer in view is animating, and stops otherwise. A store update or an
 * element coming back into view starts it again for at least one frame, so a
 * reduced-motion drawer (never animating) still redraws on every state change.
 * A drawer out of view is not drawn; on a store update it gets `updateText` instead,
 * so its captions stay current for screen readers (Requirement 14.4).
 *
 * Visibility comes from one shared `IntersectionObserver`. Where there is none
 * (old browsers, jsdom), every element counts as in view. The browser already stops
 * rAF in a hidden tab, so no visibility listener is needed here.
 */
import type { ProofRunState } from '../proof/useProofRun';
import { displayNow } from '../proof/playbackClock';
import { useProofRun } from '../proof/useProofRun';

export interface Drawer {
  /** Draw the current state. `displayMs` is the display clock, in milliseconds. */
  draw(state: ProofRunState, displayMs: number): void;
  /** Whether the drawer needs the next frame even if nothing changes (a moving trace, a pulse). */
  animating(state: ProofRunState): boolean;
  /**
   * Update only the drawer's text (captions, labels), without drawing. The loop calls
   * it instead of `draw` while the element is out of view, so the text never goes
   * stale for screen readers (Requirement 14.4) while drawing still stops (15.4).
   */
  updateText?(state: ProofRunState): void;
}

/** The part of a zustand store the loop needs. */
export interface ProofRunStore {
  getState(): ProofRunState;
  subscribe(listener: () => void): () => void;
}

/** Calls `onChange(true | false)` when `element` enters or leaves the viewport. Returns the stop function. */
export type ObserveVisibility = (element: Element, onChange: (visible: boolean) => void) => () => void;

export interface FrameLoopDeps {
  readonly store: ProofRunStore;
  readonly now: () => number;
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (id: number) => void;
  readonly observe: ObserveVisibility;
}

export interface FrameLoop {
  /** Start drawing `drawer` into `element`. Returns the function that unregisters it. */
  register(element: Element, drawer: Drawer): () => void;
  /** Replace the display clock (the demo's playback clock); null restores the default. */
  setClock(now: (() => number) | null): void;
  /** Whether a frame is scheduled. */
  readonly running: boolean;
}

interface Entry {
  readonly drawer: Drawer;
  visible: boolean;
  /** Something changed since the last draw. */
  dirty: boolean;
  stopObserving: () => void;
}

export function createFrameLoop(overrides: Partial<FrameLoopDeps> = {}): FrameLoop {
  const deps: FrameLoopDeps = { ...defaultDeps(), ...overrides };
  const entries = new Set<Entry>();
  let clock: (() => number) | null = null;
  let frame: number | undefined;
  let unsubscribe: (() => void) | null = null;

  const schedule = () => {
    frame ??= deps.requestFrame(tick);
  };

  const markAllDirty = () => {
    for (const entry of entries) entry.dirty = true;
    schedule();
  };

  function tick() {
    frame = undefined;
    const state = deps.store.getState();
    const displayMs = (clock ?? deps.now)();
    let again = false;
    for (const entry of entries) {
      if (!entry.visible) {
        // Out of view: keep the text current, draw nothing, ask for no more frames.
        if (entry.dirty) {
          entry.dirty = false;
          entry.drawer.updateText?.(state);
        }
        continue;
      }
      const animating = entry.drawer.animating(state);
      if (animating || entry.dirty) {
        entry.dirty = false;
        entry.drawer.draw(state, displayMs);
      }
      again ||= animating;
    }
    if (again) schedule();
  }

  return {
    register(element, drawer) {
      const entry: Entry = { drawer, visible: true, dirty: true, stopObserving: () => {} };
      entries.add(entry);
      entry.stopObserving = deps.observe(element, (visible) => {
        if (!entries.has(entry) || visible === entry.visible) return;
        entry.visible = visible;
        // Coming back into view: draw the current state once, even when nothing animates.
        if (visible) {
          entry.dirty = true;
          schedule();
        }
      });
      unsubscribe ??= deps.store.subscribe(markAllDirty);
      schedule();
      return () => {
        if (!entries.delete(entry)) return;
        entry.stopObserving();
        if (entries.size > 0) return;
        unsubscribe?.();
        unsubscribe = null;
        if (frame !== undefined) deps.cancelFrame(frame);
        frame = undefined;
      };
    },
    setClock(now) {
      clock = now;
      markAllDirty();
    },
    get running() {
      return frame !== undefined;
    },
  };
}

function defaultDeps(): FrameLoopDeps {
  return {
    store: useProofRun,
    now: displayNow,
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    observe: observeWithIntersection(),
  };
}

/** One shared IntersectionObserver for every registered element; everything is in view without one. */
function observeWithIntersection(): ObserveVisibility {
  if (typeof IntersectionObserver === 'undefined') return () => () => {};
  const listeners = new Map<Element, Set<(visible: boolean) => void>>();
  let observer: IntersectionObserver | null = null;
  return (element, onChange) => {
    observer ??= new IntersectionObserver((records) => {
      for (const record of records) {
        for (const listener of listeners.get(record.target) ?? []) listener(record.isIntersecting);
      }
    });
    const forElement = listeners.get(element) ?? new Set();
    if (forElement.size === 0) {
      listeners.set(element, forElement);
      observer.observe(element);
    }
    forElement.add(onChange);
    return () => {
      forElement.delete(onChange);
      if (forElement.size > 0) return;
      listeners.delete(element);
      observer?.unobserve(element);
    };
  };
}

let shared: FrameLoop | null = null;

/** The page's loop, created on first use. Every Visual registers here. */
export function frameLoop(): FrameLoop {
  shared ??= createFrameLoop();
  return shared;
}
