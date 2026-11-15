import { afterEach, describe, expect, it } from 'vitest';
import { NUDGE_MIN_INTERVAL_MS, REVIVE_MS } from './sceneLook';
import { useSceneNudge } from './sceneNudge';

afterEach(() => useSceneNudge.setState({ startedAt: null, revivedAt: null }));

describe('useSceneNudge', () => {
  it('records the start of a pulse and ignores nudges inside the minimum interval', () => {
    const { nudge } = useSceneNudge.getState();
    nudge(1000);
    expect(useSceneNudge.getState().startedAt).toBe(1000);
    nudge(1000 + NUDGE_MIN_INTERVAL_MS - 1);
    expect(useSceneNudge.getState().startedAt).toBe(1000);
    nudge(1000 + NUDGE_MIN_INTERVAL_MS);
    expect(useSceneNudge.getState().startedAt).toBe(1000 + NUDGE_MIN_INTERVAL_MS);
  });
  it('records a revive and ignores another while the first plays', () => {
    const { revive } = useSceneNudge.getState();
    revive(1000);
    expect(useSceneNudge.getState().revivedAt).toBe(1000);
    revive(1000 + REVIVE_MS - 1);
    expect(useSceneNudge.getState().revivedAt).toBe(1000);
    revive(1000 + REVIVE_MS);
    expect(useSceneNudge.getState().revivedAt).toBe(1000 + REVIVE_MS);
  });
});
