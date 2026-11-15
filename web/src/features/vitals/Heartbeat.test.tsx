import { act, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EQUIVALENT_RESULT } from '../proof/testing';
import { useProofRun } from '../proof/useProofRun';
import { createFrameLoop } from './frameLoop';
import { ALARM_TAIL_MS, Heartbeat, heartbeatLabel } from './Heartbeat';
import { VITALS_TEXT } from './palette';

/**
 * jsdom has no layout and no 2D canvas, so these tests cover what the strip says and
 * when it asks for frames: the label, its tone, the mode, and the loop registration.
 * The drawing itself is checked in a real browser (screenshots).
 *
 * The loop is a real `createFrameLoop` on the real store, with the rAF queue and the
 * display clock driven by hand (same harness as frameLoop.test.ts).
 */
function harness() {
  let queued: (() => void) | null = null;
  let now = 0;
  const loop = createFrameLoop({
    now: () => now,
    requestFrame: (callback) => {
      queued = callback;
      return 1;
    },
    cancelFrame: () => {
      queued = null;
    },
    observe: () => () => {},
  });
  const frame = (atMs = now) => {
    now = atMs;
    const callback = queued;
    queued = null;
    act(() => callback?.());
  };
  return { loop, frame };
}

const RUN = { seed: 1, reference: 'gnucobol 3.1.2 (native)', numRuns: 2000 } as const;
const DIVERGED = { ...EQUIVALENT_RESULT, status: 'diverged' as const, cases: 37 };

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const label = () => screen.getByTestId('heartbeat-label');
const strip = () => screen.getByTestId('heartbeat');

beforeEach(() => stubReducedMotion(false));
afterEach(() => {
  useProofRun.getState().reset();
  vi.unstubAllGlobals();
});

describe('heartbeatLabel', () => {
  const base = { status: 'reanimating', phase: 'generating', cases: 0, result: null, run: RUN } as const;

  it('counts matches, then names the diverging case, then the verdict (4.1, 4.3, 4.4)', () => {
    expect(heartbeatLabel({ ...base, cases: 1240 })).toEqual({ text: '✓ 1,240 matched', tone: 'pass' });
    expect(heartbeatLabel({ ...base, phase: 'shrinking', cases: 37 })).toEqual({ text: '✗ case 37 diverged', tone: 'fail' });
    expect(heartbeatLabel({ ...base, status: 'relapsed', phase: 'shrinking', cases: 37, result: DIVERGED })).toEqual({
      text: '✗ case 37 diverged',
      tone: 'fail',
    });
    expect(heartbeatLabel({ ...base, status: 'alive', cases: 2000, result: EQUIVALENT_RESULT })).toEqual({
      text: '✓ 2,000 / 2,000 matched',
      tone: 'pass',
    });
  });

  it('is neutral for error, cancelled and a run stopped at the cap (4.5, 13.2)', () => {
    expect(heartbeatLabel({ ...base, status: 'error' })).toEqual({ text: '■ stopped, no result', tone: 'neutral' });
    expect(heartbeatLabel({ ...base, status: 'cancelled', phase: 'shrinking' })).toEqual({ text: '■ stopped', tone: 'neutral' });
    const truncated = { ...EQUIVALENT_RESULT, cases: 1400, truncated: true as const };
    expect(heartbeatLabel({ ...base, status: 'alive', cases: 1400, result: truncated })).toEqual({
      text: '■ stopped early, 1,400 / 2,000 matched',
      tone: 'neutral',
    });
  });
});

describe('Heartbeat', () => {
  it('is hidden from assistive technology and adds no live region (14.4, 14.6)', () => {
    const { loop } = harness();
    const { container } = render(<Heartbeat loop={loop} />);
    expect(strip()).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('updates the label from the store in the frame loop, through the ref', () => {
    const h = harness();
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN });
    render(<Heartbeat loop={h.loop} />);
    h.frame(0);
    expect(label()).toHaveTextContent('✓ 0 matched');
    expect(strip()).toHaveAttribute('data-mode', 'beating');

    useProofRun.setState({ cases: 1240, executions: 1240 });
    expect(label()).toHaveTextContent('✓ 0 matched'); // nothing until the next frame
    h.frame(250);
    expect(label()).toHaveTextContent('✓ 1,240 matched');
    expect(label()).toHaveAttribute('data-tone', 'pass');
    expect(label().style.color).toBe(hexToRgb(VITALS_TEXT.pass));
  });

  it('flatlines with an alarm on shrinking, pulses for a bounded time after Relapsed, then stops the loop', () => {
    const h = harness();
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN, cases: 36 });
    render(<Heartbeat loop={h.loop} />);
    h.frame(0);
    useProofRun.setState({ cases: 37, phase: 'shrinking', divergences: 1 });
    h.frame(500);
    expect(strip()).toHaveAttribute('data-mode', 'flatline');
    expect(label()).toHaveTextContent('✗ case 37 diverged');
    expect(label()).toHaveAttribute('data-tone', 'fail');

    useProofRun.setState({ status: 'relapsed', result: DIVERGED });
    h.frame(1000);
    expect(label()).toHaveTextContent('✗ case 37 diverged');
    h.frame(1000 + ALARM_TAIL_MS - 1);
    expect(h.loop.running).toBe(true); // the alarm still pulses
    h.frame(1000 + ALARM_TAIL_MS);
    h.frame(1000 + ALARM_TAIL_MS + 16);
    expect(h.loop.running).toBe(false);
  });

  it('shows a steady trace on Alive and stops animating (4.4, 15.4)', () => {
    const h = harness();
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN });
    render(<Heartbeat loop={h.loop} />);
    h.frame(0);
    h.frame(16);
    expect(h.loop.running).toBe(true);
    useProofRun.setState({ status: 'alive', cases: 2000, result: EQUIVALENT_RESULT });
    h.frame(32);
    h.frame(48);
    expect(strip()).toHaveAttribute('data-mode', 'steady');
    expect(label()).toHaveTextContent('✓ 2,000 / 2,000 matched');
    expect(h.loop.running).toBe(false);
  });

  it('stops neutral on error, even mid-shrink: never the Relapsed look (4.5)', () => {
    const h = harness();
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN, cases: 12, phase: 'shrinking' });
    render(<Heartbeat loop={h.loop} />);
    h.frame(0);
    useProofRun.setState({ status: 'error', error: { kind: 'stream', message: 'ended' } });
    h.frame(16);
    h.frame(32);
    expect(strip()).toHaveAttribute('data-mode', 'stopped');
    expect(label()).toHaveTextContent('■ stopped, no result');
    expect(label()).toHaveAttribute('data-tone', 'neutral');
    expect(label().textContent).not.toContain('✗');
    expect(h.loop.running).toBe(false);
  });

  it('does not re-render React across 20 progress updates: frames write through the ref (15.3)', () => {
    const h = harness();
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN });
    let commits = 0;
    render(
      <Profiler id="heartbeat" onRender={() => (commits += 1)}>
        <Heartbeat loop={h.loop} />
      </Profiler>,
    );
    h.frame(0);
    const before = commits;
    for (let i = 1; i <= 20; i++) {
      useProofRun.setState({ cases: i * 100, executions: i * 100, elapsedMs: i * 50 });
      h.frame(i * 50);
    }
    expect(label()).toHaveTextContent('✓ 2,000 matched');
    expect(commits).toBe(before);
  });

  it('shows the neutral stopped form for cancelled and for a run stopped at the cap (4.5, 13.2)', () => {
    const h = harness();
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN, cases: 300 });
    render(<Heartbeat loop={h.loop} />);
    h.frame(0);
    useProofRun.setState({ status: 'cancelled' });
    h.frame(16);
    expect(strip()).toHaveAttribute('data-mode', 'stopped');
    expect(label()).toHaveTextContent('■ stopped');
    expect(label()).toHaveAttribute('data-tone', 'neutral');

    useProofRun.setState({ status: 'reanimating', cases: 0 });
    h.frame(32);
    useProofRun.setState({ status: 'alive', cases: 1400, result: { ...EQUIVALENT_RESULT, cases: 1400, truncated: true } });
    h.frame(48);
    expect(strip()).toHaveAttribute('data-mode', 'stopped');
    expect(label()).toHaveTextContent('■ stopped early, 1,400 / 2,000 matched');
    expect(label().style.color).toBe(hexToRgb(VITALS_TEXT.neutral));
  });

  it('registers once and unregisters on unmount', () => {
    const h = harness();
    const register = vi.spyOn(h.loop, 'register');
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN });
    const { unmount } = render(<Heartbeat loop={h.loop} />);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]![0]).toBe(strip());
    unmount();
    expect(h.loop.running).toBe(false);
    useProofRun.setState({ cases: 5 });
    expect(h.loop.running).toBe(false); // no longer subscribed
  });

  it('under reduced motion, draws a static strip per state and never asks for another frame (4.7, 14.3)', () => {
    stubReducedMotion(true);
    const h = harness();
    useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN });
    render(<Heartbeat loop={h.loop} />);
    expect(strip()).toHaveAttribute('data-motion', 'reduced');
    h.frame(0);
    expect(h.loop.running).toBe(false);
    useProofRun.setState({ cases: 800 });
    h.frame(250);
    expect(label()).toHaveTextContent('✓ 800 matched');
    expect(h.loop.running).toBe(false);
    useProofRun.setState({ status: 'relapsed', cases: 37, phase: 'shrinking', result: DIVERGED });
    h.frame(500);
    expect(strip()).toHaveAttribute('data-mode', 'flatline');
    expect(label()).toHaveTextContent('✗ case 37 diverged');
    expect(h.loop.running).toBe(false);
  });
});

function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
