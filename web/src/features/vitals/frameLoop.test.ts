import { afterEach, describe, expect, it } from 'vitest';
import { createPlaybackClock, setActivePlaybackClock } from '../proof/playbackClock';
import { useProofRun, type ProofRunState } from '../proof/useProofRun';
import { createFrameLoop, type Drawer } from './frameLoop';

/** A manual rAF queue and visibility switch, driving the real `useProofRun` store. */
function harness() {
  let queued: (() => void) | null = null;
  let nextId = 1;
  const visibility = new Map<Element, (visible: boolean) => void>();
  let now = 0;
  const loop = createFrameLoop({
    now: () => now,
    requestFrame: (callback) => {
      queued = callback;
      return nextId++;
    },
    cancelFrame: () => {
      queued = null;
    },
    observe: (element, onChange) => {
      visibility.set(element, onChange);
      return () => visibility.delete(element);
    },
  });
  return {
    loop,
    visibility,
    setNow: (ms: number) => (now = ms),
    /** Runs the scheduled frame; false when none was scheduled. */
    frame(): boolean {
      const callback = queued;
      queued = null;
      callback?.();
      return callback !== null;
    },
  };
}

function recordingDrawer(animating: (state: ProofRunState) => boolean = () => false) {
  const draws: { status: string; displayMs: number }[] = [];
  const drawer: Drawer = { draw: (state, displayMs) => draws.push({ status: state.status, displayMs }), animating };
  return { drawer, draws };
}

afterEach(() => useProofRun.getState().reset());

describe('frameLoop (Requirements 15.3, 15.4)', () => {
  it('draws once on register and stops when nothing animates', () => {
    const h = harness();
    const { drawer, draws } = recordingDrawer();
    h.loop.register(document.createElement('canvas'), drawer);
    expect(h.loop.running).toBe(true);
    expect(h.frame()).toBe(true);
    expect(draws).toEqual([{ status: 'idle', displayMs: 0 }]);
    expect(h.loop.running).toBe(false);
  });

  it('keeps running while a drawer animates, reading the store each frame', () => {
    const h = harness();
    const { drawer, draws } = recordingDrawer((s) => s.status === 'reanimating');
    h.loop.register(document.createElement('canvas'), drawer);
    useProofRun.setState({ status: 'reanimating' });
    h.frame();
    h.setNow(16);
    h.frame();
    expect(h.loop.running).toBe(true);
    useProofRun.setState({ status: 'alive' });
    h.setNow(32);
    h.frame();
    expect(draws.map((d) => [d.status, d.displayMs])).toEqual([
      ['reanimating', 0],
      ['reanimating', 16],
      ['alive', 32],
    ]);
    expect(h.loop.running).toBe(false);
  });

  it('wakes on a store update for one draw, without React', () => {
    const h = harness();
    const { drawer, draws } = recordingDrawer();
    h.loop.register(document.createElement('canvas'), drawer);
    h.frame();
    useProofRun.setState({ executions: 40 });
    expect(h.loop.running).toBe(true);
    h.frame();
    expect(h.frame()).toBe(false);
    expect(draws).toHaveLength(2);
  });

  it('skips off-screen drawers, stops, and redraws once back in view', () => {
    const h = harness();
    const element = document.createElement('canvas');
    const { drawer, draws } = recordingDrawer(() => true);
    h.loop.register(element, drawer);
    h.frame();
    h.visibility.get(element)?.(false);
    h.frame();
    expect(h.loop.running).toBe(false);
    useProofRun.setState({ executions: 10 });
    h.frame();
    expect(draws).toHaveLength(1);
    h.visibility.get(element)?.(true);
    expect(h.loop.running).toBe(true);
    h.frame();
    expect(draws).toHaveLength(2);
  });

  it('calls updateText instead of draw for an off-screen drawer on each store update (14.4)', () => {
    const h = harness();
    const element = document.createElement('canvas');
    const { drawer, draws } = recordingDrawer(() => true);
    const texts: string[] = [];
    h.loop.register(element, { ...drawer, updateText: (state) => texts.push(state.status) });
    h.frame();
    h.visibility.get(element)?.(false);
    useProofRun.setState({ status: 'alive' });
    h.frame();
    expect(draws).toHaveLength(1);
    expect(texts).toEqual(['alive']);
    expect(h.loop.running).toBe(false);
  });

  it('uses the replacement clock for display time', () => {
    const h = harness();
    const { drawer, draws } = recordingDrawer();
    h.loop.register(document.createElement('canvas'), drawer);
    h.loop.setClock(() => 1234);
    h.frame();
    expect(draws).toEqual([{ status: 'idle', displayMs: 1234 }]);
  });

  it('reads display time from the active playback clock by default, frozen while it is paused (11.7)', () => {
    let wall = 5000;
    const clock = createPlaybackClock({ rate: 1 / 40, now: () => wall });
    setActivePlaybackClock(clock);
    const draws: number[] = [];
    let queued: (() => void) | null = null;
    const loop = createFrameLoop({
      requestFrame: (callback) => ((queued = callback), 1),
      cancelFrame: () => (queued = null),
      observe: () => () => {},
    });
    loop.register(document.createElement('canvas'), { draw: (_s, ms) => draws.push(ms), animating: () => true });
    const frame = () => {
      const callback = queued;
      queued = null;
      callback?.();
    };
    frame();
    clock.pause();
    wall += 300;
    frame();
    clock.resume();
    wall += 100;
    frame();
    expect(draws).toEqual([5000, 5000, 5100]);
    setActivePlaybackClock(null);
  });

  it('stops observing, unsubscribes and cancels the frame when the last drawer leaves', () => {
    const h = harness();
    const element = document.createElement('canvas');
    const { drawer, draws } = recordingDrawer(() => true);
    const unregister = h.loop.register(element, drawer);
    unregister();
    expect(h.loop.running).toBe(false);
    expect(h.visibility.has(element)).toBe(false);
    useProofRun.setState({ executions: 5 });
    expect(h.loop.running).toBe(false);
    expect(h.frame()).toBe(false);
    expect(draws).toHaveLength(0);
  });
});
