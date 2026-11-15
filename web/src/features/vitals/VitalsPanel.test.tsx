import { Profiler } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EQUIVALENT_RESULT, fakeStream, STARTED, stubFetch } from '../proof/testing';
import { useProofRun } from '../proof/useProofRun';
import { VitalsPanel } from './VitalsPanel';

afterEach(() => {
  useProofRun.getState().reset();
  vi.unstubAllGlobals();
});

const panel = () => screen.queryByTestId('vitals-panel');

describe('Vitals panel', () => {
  it('is absent before a run, and absent for another program', () => {
    const { rerender } = render(<VitalsPanel programId="PAYROLL" />);
    expect(panel()).not.toBeInTheDocument();
    useProofRun.setState({ status: 'reanimating', program: 'INTCALC' });
    rerender(<VitalsPanel programId="PAYROLL" />);
    expect(panel()).not.toBeInTheDocument();
  });

  it('lays out the heartbeat, grid and fill slots under a "Vitals" heading', async () => {
    const stream = fakeStream();
    stubFetch(() => stream);
    render(<VitalsPanel programId="PAYROLL" />);
    void useProofRun.getState().start('PAYROLL');
    expect(await screen.findByRole('region', { name: 'Vitals' })).toHaveAttribute('data-status', 'reanimating');
    for (const slot of ['heartbeat', 'grid', 'fill']) expect(screen.getByTestId(`vitals-${slot}-slot`)).toBeInTheDocument();
    stream.send(STARTED);
    await vi.waitFor(() => expect(screen.getByTestId('vitals-grid-slot')).toHaveAttribute('data-num-runs', '2000'));
  });

  it('does not re-render on progress events, only on status and run changes (15.3)', async () => {
    const stream = fakeStream();
    stubFetch(() => stream);
    let commits = 0;
    render(
      <Profiler id="vitals" onRender={() => (commits += 1)}>
        <VitalsPanel programId="PAYROLL" />
      </Profiler>,
    );
    void useProofRun.getState().start('PAYROLL');
    stream.send(STARTED);
    await vi.waitFor(() => expect(useProofRun.getState().run).not.toBeNull());
    await vi.waitFor(() => expect(screen.getByTestId('vitals-grid-slot')).toHaveAttribute('data-num-runs', '2000'));
    const before = commits;
    for (let i = 1; i <= 20; i++) {
      stream.send({ type: 'progress', executions: i * 100, divergences: 0, elapsedMs: i * 50, cases: i * 100, phase: 'generating' });
    }
    await vi.waitFor(() => expect(useProofRun.getState().executions).toBe(2000));
    expect(commits).toBe(before);
    stream.send({ type: 'result', result: EQUIVALENT_RESULT });
    await vi.waitFor(() => expect(panel()).toHaveAttribute('data-status', 'alive'));
    expect(commits).toBe(before + 1);
  });
});
