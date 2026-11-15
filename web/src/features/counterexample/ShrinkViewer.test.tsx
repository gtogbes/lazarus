import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShrinkPath } from '../../../../src/harness/equivalence.types';
import { LAYOUT } from '../../../../src/ports/payroll.layout';
import V1_RECORDING from '../proof/fixtures/PAYROLL.half-up-tax.v1.json';
import { serveFiles, stubFetch } from '../proof/testing';
import { useProofRun } from '../proof/useProofRun';
import { HALF_UP_TAX } from './fixtures';
import { ShrinkViewer } from './ShrinkViewer';

/** A sampled PAYROLL path: 245 failing inputs, 4 stored, real step indices kept. */
const PATH: ShrinkPath = {
  total: 245,
  steps: [
    { step: 0, line: 2, records: ['A', 'B', 'JW6K40066822659-4655816', 'C', 'D', 'E', 'F'] },
    { step: 40, line: 0, records: ['AW6K40066822659-4655816', 'X'] },
    { step: 200, line: 0, records: ['AA0A00049122648-4655816', 'X'] },
    { step: 244, line: 0, records: ['AA0A00049122648+0000000', 'X'] },
  ],
};

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const show = (path: ShrinkPath | undefined) =>
  render(<ShrinkViewer path={path} layout={LAYOUT.input} counterexample={HALF_UP_TAX.counterexample} />);
const stepText = () => screen.getByTestId('shrink-step').textContent;

/** The viewer fed from the store, as the counterexample card feeds it. */
function StoreShrinkViewer() {
  const result = useProofRun((s) => s.result);
  if (result?.status !== 'diverged') return null;
  return <ShrinkViewer path={result.shrinkPath} layout={LAYOUT.input} counterexample={result.counterexample} />;
}

afterEach(() => {
  useProofRun.getState().reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ShrinkViewer', () => {
  it('labels steps with the real index and total, and says how many were dropped (5.3, 13.4)', () => {
    stubReducedMotion(false);
    show(PATH);
    expect(stepText()).toContain('Step 1 of 245');
    expect(screen.getByTestId('shrink-dropped')).toHaveTextContent('Showing 4 of 245 steps.');
    const items = within(screen.getByRole('list', { name: 'Shrink steps' })).getAllByRole('listitem');
    const steps = items.filter((li) => li.parentElement?.tagName === 'OL');
    expect(steps.map((li) => li.querySelector('p')?.textContent?.split(':')[0])).toEqual([
      'Step 1 of 245',
      'Step 41 of 245',
      'Step 201 of 245',
      'Step 245 of 245, the smallest failing input',
    ]);
    expect(steps[0]).toHaveTextContent('7 records, record 3 shown.');
  });

  it('plays every stored step within 10 s and stops on the counterexample (5.2, 5.5)', () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    show(PATH);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    // One timer per step, so advance in small slices: 10 s in all.
    for (let t = 0; t < 10_000; t += 100) act(() => vi.advanceTimersByTime(100));
    expect(stepText()).toContain('Step 245 of 245');
    expect(screen.getByTestId('shrink-count')).toHaveTextContent('2 records, record 1 shown');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    // The animated row repeats the list, so it is hidden from assistive technology (14.4).
    expect(screen.getByTestId('shrink-stage')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is keyboard operable: buttons, Space, and arrow keys while a control has focus (5.4)', async () => {
    stubReducedMotion(false);
    const user = userEvent.setup();
    show(PATH);
    const pause = screen.getByRole('button', { name: 'Pause' });
    await user.tab();
    expect(pause).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(stepText()).toContain('Step 41 of 245');
    expect(screen.getByTestId('shrink-count')).toHaveTextContent('7 records → 2');
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(stepText()).toContain('Step 245 of 245');
    await user.keyboard('{ArrowLeft}');
    expect(stepText()).toContain('Step 201 of 245');
    // The current step is marked in the list, so the controls mean something to a screen reader.
    const current = screen.getByRole('list', { name: 'Shrink steps' }).querySelector('[aria-current="step"]');
    expect(current).toHaveTextContent('Step 201 of 245');
    // At the start Previous stays focusable but does nothing.
    await user.click(screen.getByRole('button', { name: 'Previous step' }));
    await user.click(screen.getByRole('button', { name: 'Previous step' }));
    const previous = screen.getByRole('button', { name: 'Previous step' });
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    await user.click(previous);
    expect(stepText()).toContain('Step 1 of 245');
    await user.click(screen.getByRole('button', { name: 'Replay' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('marks changed fields in text, not colour alone (5.2, 14.1)', async () => {
    stubReducedMotion(false);
    const user = userEvent.setup();
    show(PATH);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    const stage = screen.getByTestId('shrink-stage');
    expect(stage).toHaveTextContent('✎ changed, was "AW6K40"');
    expect(stage).toHaveTextContent('✎ changed, was 6.68');
  });

  it('shows an ordered list with changed fields marked, and nothing animated, under reduced motion (5.6, 14.3)', () => {
    stubReducedMotion(true);
    show(PATH);
    expect(screen.queryByTestId('shrink-stage')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Shrink playback' })).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Shrink steps' });
    expect(list).not.toHaveClass('sr-only');
    const last = [...list.children].at(-1) as HTMLElement;
    expect(last).toHaveTextContent('IN-ADJUST +0.00changed');
    expect(last).toHaveTextContent('IN-HOURS 4.91');
    expect(last).not.toHaveTextContent('IN-HOURS 4.91changed');
  });

  it('says no shrink path was recorded and shows the final counterexample (5.7)', () => {
    stubReducedMotion(false);
    const { container } = show(undefined);
    expect(screen.getByTestId('shrink-no-path')).toHaveTextContent('No shrink path was recorded for this run');
    const final = container.querySelector('dl');
    expect(final).toHaveAccessibleName('Final failing input, record 2 of 2');
    expect(final).toHaveTextContent('IN-EMP-ID"EMP001"');
    expect(screen.queryByRole('group', { name: 'Shrink playback' })).not.toBeInTheDocument();
  });

  it('says nothing about dropped steps when every step is stored (5.3)', () => {
    stubReducedMotion(true);
    show({ total: 2, steps: [PATH.steps[0]!, { ...PATH.steps[3]!, step: 1 }] });
    expect(screen.queryByTestId('shrink-dropped')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Shrink steps' });
    expect([...list.children].map((li) => li.querySelector('p span')?.textContent)).toEqual([
      'Step 1 of 2',
      'Step 2 of 2',
    ]);
  });

  it('replays a version 1 recording through the store and shows the no-path message (5.7, 3.7)', async () => {
    stubReducedMotion(false);
    const { container } = render(<StoreShrinkViewer />);
    // The UI offers the recorded replay only after a live run failed.
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await act(() => useProofRun.getState().start('PAYROLL', 'half-up-tax'));
    serveFiles({ '/recorded/PAYROLL.half-up-tax.json': V1_RECORDING });
    await act(() => useProofRun.getState().replayRecorded());
    expect(useProofRun.getState()).toMatchObject({ status: 'relapsed', source: 'recorded' });
    expect(useProofRun.getState().result).not.toHaveProperty('shrinkPath');
    expect(screen.getByTestId('shrink-no-path')).toHaveTextContent(
      'No shrink path was recorded for this run, so only the final counterexample is shown.',
    );
    const final = container.querySelector('dl');
    expect(final).toHaveAccessibleName('Final failing input, record 1 of 2');
    expect(final).toHaveTextContent('IN-EMP-ID"AA0A00"');
    expect(screen.queryByRole('group', { name: 'Shrink playback' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Shrink steps' })).not.toBeInTheDocument();
  });

  it('adds no live regions (14.6)', () => {
    stubReducedMotion(false);
    const { container } = show(PATH);
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"], [role="log"]')).toBeNull();
  });
});
