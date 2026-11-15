import { act, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIVERGED_RESULT, EQUIVALENT_RESULT } from '../proof/testing';
import { useProofRun } from '../proof/useProofRun';
import { CaseGrid, EVERY_EARLIER_CASE_PASSED, gridColumns } from './CaseGrid';
import { createFrameLoop } from './frameLoop';

/**
 * jsdom has no layout and no 2D canvas, so these tests cover the text and the draw
 * bookkeeping. The cells themselves are checked in a real browser (screenshots).
 * Task 12.4 adds the per-status, truncation and reduced-motion cases.
 */
function harness() {
  let queued: (() => void) | null = null;
  const loop = createFrameLoop({
    now: () => 0,
    requestFrame: (callback) => {
      queued = callback;
      return 1;
    },
    cancelFrame: () => {
      queued = null;
    },
    observe: () => () => {},
  });
  const frame = () => {
    const callback = queued;
    queued = null;
    act(() => callback?.());
  };
  return { loop, frame };
}

const RUN = { seed: 1, reference: 'gnucobol 3.1.2 (native)', numRuns: 2000 } as const;
const text = (id: string) => screen.getByTestId(id).textContent;

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
const grid = () => screen.getByTestId('case-grid');
beforeEach(() => stubReducedMotion(false));
afterEach(() => {
  useProofRun.getState().reset();
  vi.unstubAllGlobals();
});

describe('CaseGrid', () => {
  it('lays 2,000 cells out as 50 × 40', () => {
    expect(gridColumns(2000)).toBe(50);
    expect(Math.ceil(2000 / gridColumns(2000))).toBe(40);
  });

  it('counts passes, then marks the failing case from the first divergence (7.2, 7.3, 7.5)', () => {
    const { loop, frame } = harness();
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN, cases: 640, phase: 'generating' });
    render(<CaseGrid loop={loop} />);
    frame();
    expect(text('case-grid-passed')).toBe('✓ 640 passed');
    expect(text('case-grid-failed')).toBe('✗ 0 diverged');
    expect(text('case-grid-not-run')).toBe('1,360 not run');
    expect(text('case-grid-caption')).toBe('640 of 2,000 cases passed so far.');
    expect(text('case-grid-note')).toBe(EVERY_EARLIER_CASE_PASSED);

    act(() => useProofRun.setState({ cases: 37, phase: 'shrinking', executions: 140 }));
    frame();
    expect(screen.getByTestId('case-grid')).toHaveAttribute('data-failed-index', '36');
    expect(text('case-grid-passed')).toBe('✓ 36 passed');
    expect(text('case-grid-failed')).toBe('✗ 1 diverged');
    expect(text('case-grid-caption')).toMatch(/^Case 37 of 2,000 diverged\./);

    act(() => useProofRun.setState({ status: 'relapsed', result: { ...DIVERGED_RESULT, cases: 37 } }));
    frame();
    expect(text('case-grid-caption')).toBe('Case 37 of 2,000 diverged after 36 passed. The later cases were not run.');
    expect(screen.getByTestId('case-grid-truncated')).not.toBeVisible();
  });

  it('draws progress without re-rendering React (15.3)', () => {
    const { loop, frame } = harness();
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN, cases: 0, phase: 'generating' });
    let commits = 0;
    render(
      <Profiler id="grid" onRender={() => (commits += 1)}>
        <CaseGrid loop={loop} />
      </Profiler>,
    );
    frame();
    const before = commits;
    for (let i = 1; i <= 20; i++) {
      act(() => useProofRun.setState({ cases: i * 100, executions: i * 100 }));
      frame();
    }
    expect(commits).toBe(before);
    expect(text('case-grid-passed')).toBe('✓ 2,000 passed');
    expect(screen.getByTestId('case-grid')).toHaveAttribute('data-draws', '21');
  });

  it.each([
    ['idle, before any run', { status: 'idle' }, ''],
    ['reanimating, before started', { status: 'reanimating', phase: 'generating' }, 'Waiting for the run to start.'],
    [
      'reanimating, generating',
      { status: 'reanimating', run: RUN, cases: 640, phase: 'generating' },
      '640 of 2,000 cases passed so far.',
    ],
    [
      'reanimating, shrinking',
      { status: 'reanimating', run: RUN, cases: 37, phase: 'shrinking' },
      'Case 37 of 2,000 diverged. Shrinking it to the smallest failing input.',
    ],
    [
      'alive',
      { status: 'alive', run: RUN, cases: 2000, phase: 'generating', result: EQUIVALENT_RESULT },
      'All 2,000 cases passed.',
    ],
    [
      'relapsed',
      { status: 'relapsed', run: RUN, cases: 37, phase: 'shrinking', result: DIVERGED_RESULT },
      'Case 37 of 2,000 diverged after 36 passed. The later cases were not run.',
    ],
    [
      'error while shrinking',
      { status: 'error', run: RUN, cases: 37, phase: 'shrinking' },
      'The proof stopped with an error after 37 of 2,000 cases. No result.',
    ],
    ['error before started', { status: 'error', phase: 'generating' }, 'No cases were run.'],
    [
      'cancelled while shrinking',
      { status: 'cancelled', run: RUN, cases: 37, phase: 'shrinking' },
      'Stopped after 37 of 2,000 cases.',
    ],
  ] as const)('captions %s (7.5)', (_, state, caption) => {
    const { loop, frame } = harness();
    useProofRun.setState({ program: 'PAYROLL', ...state });
    render(<CaseGrid loop={loop} />);
    frame();
    expect(text('case-grid-caption')).toBe(caption);
    expect(grid()).toHaveAttribute('data-status', state.status);
    // Only a divergence gets the red cell; an error or cancel mid-shrink never does.
    const diverged = state.status === 'relapsed' || (state.status === 'reanimating' && state.phase === 'shrinking');
    expect(grid()).toHaveAttribute('data-failed-index', diverged ? '36' : '');
    expect(screen.getByTestId('case-grid-truncated')).not.toBeVisible();
  });

  it('says how far a truncated run got and leaves the rest not run (7.4)', () => {
    const { loop, frame } = harness();
    useProofRun.setState({
      status: 'alive',
      program: 'PAYROLL',
      run: RUN,
      cases: 1500,
      phase: 'generating',
      result: { ...EQUIVALENT_RESULT, cases: 1500, truncated: true },
    });
    render(<CaseGrid loop={loop} />);
    frame();
    expect(text('case-grid-caption')).toBe('1,500 of 2,000 cases passed before the run stopped.');
    expect(screen.getByTestId('case-grid-truncated')).toBeVisible();
    expect(text('case-grid-truncated')).toBe(
      'The run stopped at the 25 s limit after 1,500 cases, so the other 500 were not run.',
    );
    expect(text('case-grid-not-run')).toBe('500 not run');
    expect(grid()).toHaveAttribute('data-passed', '1500');
    expect(grid()).toHaveAttribute('data-not-run', '500');
    expect(grid()).toHaveAttribute('data-failed-index', '');
  });

  it('under reduced motion redraws only when the status or grid size changes, with no counts mid-run (7.6, 14.3)', () => {
    stubReducedMotion(true);
    const { loop, frame } = harness();
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', phase: 'generating' });
    render(<CaseGrid loop={loop} />);
    frame();
    expect(grid()).toHaveAttribute('data-motion', 'reduced');
    expect(grid()).toHaveAttribute('data-draws', '1');

    // `started` gives the grid size: one draw.
    act(() => useProofRun.setState({ run: RUN }));
    frame();
    expect(grid()).toHaveAttribute('data-draws', '2');

    // Progress and the switch to shrinking draw nothing.
    for (let i = 1; i <= 5; i++) {
      act(() => useProofRun.setState({ cases: i * 7, executions: i * 7 }));
      frame();
    }
    act(() => useProofRun.setState({ phase: 'shrinking', executions: 80 }));
    frame();
    expect(grid()).toHaveAttribute('data-draws', '2');
    expect(text('case-grid-passed')).toBe('✓ passed');
    expect(text('case-grid-failed')).toBe('✗ diverged');
    expect(text('case-grid-not-run')).toBe('not run');
    expect(text('case-grid-caption')).toMatch(/^Proof running\. With reduced motion the grid is drawn when the proof finishes/);

    // The final status draws once, with the counts.
    act(() => useProofRun.setState({ status: 'relapsed', cases: 37, result: DIVERGED_RESULT }));
    frame();
    expect(grid()).toHaveAttribute('data-draws', '3');
    expect(grid()).toHaveAttribute('data-failed-index', '36');
    expect(text('case-grid-passed')).toBe('✓ 36 passed');
    expect(text('case-grid-failed')).toBe('✗ 1 diverged');
    expect(text('case-grid-not-run')).toBe('1,963 not run');
    expect(text('case-grid-caption')).toBe('Case 37 of 2,000 diverged after 36 passed. The later cases were not run.');
  });
});
