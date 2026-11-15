import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EQUIVALENT_RESULT } from '../proof/testing';
import { useProofRun } from '../proof/useProofRun';
import { CaseGrid } from './CaseGrid';
import { createFrameLoop } from './frameLoop';
import { Heartbeat } from './Heartbeat';
import { ResurrectionFill } from './ResurrectionFill';

/**
 * The Visuals draw only on screen (Requirement 15.4), but their text must not go
 * stale off screen: a screen reader reads it wherever it is (Requirement 14.4).
 * This loop reports every element as out of view and runs frames by hand.
 */
function offscreenHarness() {
  let queued: (() => void) | null = null;
  const loop = createFrameLoop({
    now: () => 0,
    requestFrame: (callback) => ((queued = callback), 1),
    cancelFrame: () => (queued = null),
    observe: (_element, onChange) => {
      onChange(false);
      return () => {};
    },
  });
  const frame = () => {
    const callback = queued;
    queued = null;
    act(() => callback?.());
  };
  return { loop, frame };
}

const RUN = { seed: 42, reference: 'gnucobol 3.1.2 (native)', numRuns: 2000 } as const;
const text = (id: string) => screen.getByTestId(id).textContent;

afterEach(() => useProofRun.getState().reset());

describe('Visuals text off screen (14.4, 15.4)', () => {
  it('keeps the fill, heartbeat and grid text current at Alive without drawing', () => {
    const { loop, frame } = offscreenHarness();
    render(
      <>
        <ResurrectionFill loop={loop} />
        <Heartbeat loop={loop} />
        <CaseGrid loop={loop} />
      </>,
    );
    act(() => useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN, phase: 'generating', cases: 0 }));
    frame();
    act(() => useProofRun.setState({ status: 'alive', cases: 2000, result: EQUIVALENT_RESULT }));
    frame();

    expect(text('resurrection-fill-status')).toBe('✓ Alive');
    expect(text('resurrection-fill-count')).toBe('2,000 / 2,000 cases passed (100%)');
    expect(text('heartbeat-label')).toBe('✓ 2,000 / 2,000 matched');
    expect(text('case-grid-caption')).toBe('All 2,000 cases passed.');
    expect(text('case-grid-passed')).toBe('✓ 2,000 passed');
    expect(text('case-grid-not-run')).toBe('0 not run');

    // Drawing stayed off: the clip was never widened, the drawers never ran, and the loop stopped.
    expect(Number(document.querySelector('clipPath rect')?.getAttribute('width'))).toBe(0);
    expect(screen.getByTestId('resurrection-fill').dataset['status']).toBeUndefined();
    expect(screen.getByTestId('heartbeat').dataset['mode']).toBeUndefined();
    expect(screen.getByTestId('case-grid').dataset['draws']).toBeUndefined();
    expect(loop.running).toBe(false);
  });
});
