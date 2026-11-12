import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProvePanel } from './ProvePanel';
import { EQUIVALENT_RESULT, fakeStream, jsonResponse, recordingOf, serveFiles, STARTED, stubFetch } from './testing';
import { useProofRun } from './useProofRun';

afterEach(() => {
  useProofRun.getState().reset();
  vi.unstubAllGlobals();
});

const proveButton = () => screen.getByRole('button', { name: /^Prove/ });
const cancelButton = () => screen.queryByRole('button', { name: 'Cancel' });
const status = () => screen.getByTestId('proof-status');

describe('Prove panel', () => {
  it('runs a proof with live counters and shows the Alive summary (3.2, 3.3)', async () => {
    const user = userEvent.setup();
    const stream = fakeStream();
    const { calls } = stubFetch(() => stream);
    render(<ProvePanel programId="PAYROLL" />);
    expect(status()).toHaveTextContent('Not yet proven');

    await user.click(proveButton());
    expect(status()).toHaveTextContent('Reanimating…');
    expect(proveButton()).toHaveAttribute('aria-disabled', 'true');
    expect(cancelButton()).toBeInTheDocument();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(new TextDecoder().decode(calls[0]?.init.body as Uint8Array)).toBe('{"program":"PAYROLL"}');

    stream.send(STARTED, { type: 'progress', executions: 412, divergences: 0, elapsedMs: 250 });
    expect(await screen.findByText('412')).toBeInTheDocument();
    expect(screen.getByTestId('proof-elapsed')).toHaveTextContent('0.3 s');

    stream.send({ type: 'progress', executions: 2000, divergences: 0, elapsedMs: 1400 });
    stream.send({ type: 'result', result: EQUIVALENT_RESULT });
    await vi.waitFor(() => expect(status()).toHaveTextContent('Alive'));
    expect(cancelButton()).not.toBeInTheDocument();
    const summary = screen.getByTestId('proof-summary');
    expect(summary).toHaveTextContent('2,000 cases matched GnuCOBOL record for record.');
    expect(within(summary).getByText('1.4 s')).toBeInTheDocument();
    expect(within(summary).getByText('42')).toBeInTheDocument();
    expect(within(summary).getByText('gnucobol 3.1.2 (native)')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('PAYROLL is alive');
    expect(proveButton()).toHaveTextContent('Prove again');
  });

  it('cancels a running proof from the keyboard and returns focus to Prove (3.5)', async () => {
    const user = userEvent.setup();
    const stream = fakeStream();
    const { calls } = stubFetch(() => stream);
    render(<ProvePanel programId="PAYROLL" />);

    proveButton().focus();
    await user.keyboard('{Enter}');
    stream.send(STARTED, { type: 'progress', executions: 120, divergences: 0, elapsedMs: 250 });
    await screen.findByText('120');
    expect(proveButton()).toHaveFocus();

    await user.tab();
    expect(cancelButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(status()).toHaveTextContent('Cancelled');
    expect(cancelButton()).not.toBeInTheDocument();
    expect(proveButton()).toHaveFocus();
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Proof cancelled after 120 cases.');
  });

  it('shows a failure, not a relapse, when the service rejects the request', async () => {
    const user = userEvent.setup();
    stubFetch(() => jsonResponse(400, { error: 'Unknown program' }));
    render(<ProvePanel programId="PAYROLL" />);
    await user.click(proveButton());
    await vi.waitFor(() => expect(status()).toHaveTextContent('Proof failed'));
    expect(screen.getByTestId('proof-error')).toHaveTextContent('Unknown program');
    expect(proveButton()).not.toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Prove panel recorded fallback (Requirement 6)', () => {
  const offer = () => screen.queryByRole('button', { name: 'Replay the recorded proof' });

  const failures = {
    network: () => stubFetch(() => Promise.reject(new TypeError('Failed to fetch'))),
    http: () => stubFetch(() => jsonResponse(503, { error: 'Service Unavailable' })),
    run: () => {
      const stream = fakeStream();
      stream.send(STARTED, { type: 'error', message: 'The proof run failed before it could finish.' });
      return stubFetch(() => stream);
    },
    stream: () => {
      const stream = fakeStream();
      stream.send(STARTED);
      stream.close();
      return stubFetch(() => stream);
    },
  };

  it.each(Object.keys(failures) as (keyof typeof failures)[])('offers the recorded proof after a %s error (6.1)', async (kind) => {
    const user = userEvent.setup();
    failures[kind]();
    render(<ProvePanel programId="PAYROLL" />);
    expect(offer()).not.toBeInTheDocument();
    await user.click(proveButton());
    await vi.waitFor(() => expect(status()).toHaveTextContent('Proof failed'));
    expect(useProofRun.getState().error?.kind).toBe(kind);
    expect(offer()).toBeInTheDocument();
    expect(screen.getByTestId('recorded-offer')).toHaveTextContent('the real port');
  });

  it('replays the recording for the same mutant, labelled Recorded with its date (6.1, 6.2)', async () => {
    const user = userEvent.setup();
    useProofRun.getState().selectMutant('strict-band-edge');
    failures.network();
    render(<ProvePanel programId="PAYROLL" />);
    await user.click(proveButton());
    await vi.waitFor(() => expect(offer()).toBeInTheDocument());
    expect(screen.getByTestId('recorded-offer')).toHaveTextContent('the mutant strict-band-edge');

    const fetchMock = serveFiles({
      '/recorded/PAYROLL.strict-band-edge.json': recordingOf({ ...EQUIVALENT_RESULT, durationMs: 50 }, { mutant: 'strict-band-edge' }),
    });
    await user.click(offer()!);
    expect(proveButton()).toHaveFocus();

    await vi.waitFor(() => expect(status()).toHaveTextContent('Alive'));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/recorded/PAYROLL.strict-band-edge.json');
    const label = screen.getByTestId('proof-recorded');
    expect(label).toHaveTextContent('Recorded');
    expect(within(label).getByText('8 Nov 2026')).toHaveAttribute('datetime', EQUIVALENT_RESULT.generatedAt);
    expect(label).toHaveTextContent('This is not a live run.');
    expect(screen.getByTestId('proof-summary')).toHaveTextContent('2,000 cases matched GnuCOBOL');
    expect(screen.getByRole('status')).toHaveTextContent('Recorded proof: PAYROLL is alive');
    expect(offer()).not.toBeInTheDocument();
  });

  it('says so when no recording exists, without offering it again', async () => {
    const user = userEvent.setup();
    failures.http();
    render(<ProvePanel programId="PAYROLL" />);
    await user.click(proveButton());
    await vi.waitFor(() => expect(offer()).toBeInTheDocument());
    serveFiles({});
    await user.click(offer()!);
    await vi.waitFor(() => expect(screen.getByTestId('proof-error')).toHaveTextContent('No recorded proof could be loaded'));
    expect(offer()).not.toBeInTheDocument();
    expect(screen.queryByTestId('proof-recorded')).not.toBeInTheDocument();
  });

  it('labels a live run as neither recorded nor offers a replay', async () => {
    const user = userEvent.setup();
    const stream = fakeStream();
    stream.send(STARTED, { type: 'result', result: EQUIVALENT_RESULT });
    stubFetch(() => stream);
    render(<ProvePanel programId="PAYROLL" />);
    await user.click(proveButton());
    await vi.waitFor(() => expect(status()).toHaveTextContent('Alive'));
    expect(screen.queryByTestId('proof-recorded')).not.toBeInTheDocument();
    expect(offer()).not.toBeInTheDocument();
  });
});
