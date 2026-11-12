import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProofAnnouncer } from './ProofAnnouncer';
import { EQUIVALENT_RESULT } from './testing';
import { useProofRun } from './useProofRun';

const region = () => screen.getByRole('status');
const progress = (executions: number, elapsedMs: number) =>
  act(() => {
    useProofRun.setState({ executions, divergences: 0, elapsedMs });
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  useProofRun.getState().reset();
  vi.useRealTimers();
});

describe('proof live region (9.2)', () => {
  it('announces status changes at once and progress at most once every 5 s', () => {
    render(<ProofAnnouncer />);
    expect(region()).toHaveAttribute('aria-live', 'polite');
    expect(region()).toBeEmptyDOMElement();

    act(() => {
      useProofRun.setState({ status: 'reanimating', program: 'PAYROLL' });
    });
    expect(region()).toHaveTextContent('Proof started for PAYROLL.');

    // 4 Hz counter updates do not reach the live region in between.
    for (let tick = 1; tick < 20; tick++) {
      progress(tick * 100, tick * 250);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(region()).toHaveTextContent('Proof started for PAYROLL.');
    }
    progress(2000, 5000);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(region()).toHaveTextContent('2,000 cases run, 0 divergences, 5 seconds elapsed.');

    progress(3000, 7000);
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(region()).toHaveTextContent('2,000 cases run');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(region()).toHaveTextContent('3,000 cases run');

    act(() => {
      useProofRun.setState({ status: 'alive', result: EQUIVALENT_RESULT });
    });
    expect(region()).toHaveTextContent('PAYROLL is alive: 2,000 cases matched GnuCOBOL.');
    // No more progress announcements once the run is over.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(region()).toHaveTextContent('PAYROLL is alive');
  });
});
