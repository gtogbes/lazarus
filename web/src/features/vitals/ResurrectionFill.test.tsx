import { act, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSceneNudge } from '../../scene/sceneNudge';
import { DIVERGED_RESULT, EQUIVALENT_RESULT, fakeStream, jsonResponse, STARTED, stubFetch } from '../proof/testing';
import { useProofRun } from '../proof/useProofRun';
import { createFrameLoop } from './frameLoop';
import { ResurrectionFill, resurrectionLabel } from './ResurrectionFill';

/**
 * jsdom has no layout, so these tests cover the text, the clip width set through the
 * ref and the render count. The silhouette itself is checked in a real browser
 * (screenshots). Task 13.4 adds the per-status RTL cases.
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
const clipWidth = () => Number(document.querySelector('clipPath rect')?.getAttribute('width'));

afterEach(() => useProofRun.getState().reset());

describe('resurrectionLabel', () => {
  const base = { status: 'reanimating', phase: 'generating', cases: 0, result: null, run: RUN } as const;

  it('fills in proportion to cases passed and rounds the percentage down (8.1, 8.2)', () => {
    expect(resurrectionLabel({ ...base, cases: 1240 })).toEqual({
      status: '✓ Coming back to life',
      tone: 'pass',
      count: '1,240 / 2,000 cases passed (62%)',
      fraction: 0.62,
    });
    expect(resurrectionLabel({ ...base, cases: 1999 }).count).toBe('1,999 / 2,000 cases passed (99.9%)');
  });

  it('stops at the cases passed before the divergence and says Relapsed with ✗ (8.3, 14.1)', () => {
    const shrinking = resurrectionLabel({ ...base, phase: 'shrinking', cases: 37 });
    expect(shrinking).toMatchObject({ status: '✗ Relapsed', tone: 'fail', count: '36 / 2,000 cases passed (1.8%)' });
    const relapsed = resurrectionLabel({ ...base, status: 'relapsed', phase: 'shrinking', cases: 37 });
    expect(relapsed).toEqual({ ...shrinking, fraction: 36 / 2000 });
  });

  it('keeps error and a truncated Alive neutral, never red', () => {
    expect(resurrectionLabel({ ...base, status: 'error', cases: 10 })).toMatchObject({ tone: 'neutral', status: '■ Stopped, no result' });
    const truncated = { ...EQUIVALENT_RESULT, truncated: true as const, cases: 900 };
    expect(resurrectionLabel({ ...base, status: 'alive', cases: 900, result: truncated })).toMatchObject({
      tone: 'neutral',
      count: '900 / 2,000 cases passed (45%)',
    });
  });
});

describe('ResurrectionFill', () => {
  it('sets the clip and the text through refs, with no re-render per progress update (15.3)', () => {
    const { loop, frame } = harness();
    let commits = 0;
    render(
      <Profiler id="fill" onRender={() => (commits += 1)}>
        <ResurrectionFill loop={loop} />
      </Profiler>,
    );
    const before = commits;
    act(() => useProofRun.setState({ status: 'reanimating', program: 'PAYROLL', run: RUN, phase: 'generating', cases: 0 }));
    for (let i = 1; i <= 20; i++) {
      act(() => useProofRun.setState({ cases: i * 50, executions: i * 50 }));
      frame();
    }
    expect(commits).toBe(before);
    expect(text('resurrection-fill-count')).toBe('1,000 / 2,000 cases passed (50%)');
    expect(clipWidth()).toBeCloseTo(0.5 * 258, 1);
    expect(screen.getByTestId('resurrection-fill').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows ✗ Relapsed in text on a divergence, and ✓ Alive with a full body on a pass', () => {
    const { loop, frame } = harness();
    render(<ResurrectionFill loop={loop} />);
    act(() =>
      useProofRun.setState({ status: 'relapsed', program: 'PAYROLL', run: RUN, phase: 'shrinking', cases: 37, result: DIVERGED_RESULT }),
    );
    frame();
    expect(text('resurrection-fill-status')).toBe('✗ Relapsed');
    expect(screen.getByTestId('resurrection-fill-status')).toHaveAttribute('data-tone', 'fail');
    act(() => useProofRun.setState({ status: 'alive', phase: 'generating', cases: 2000, result: EQUIVALENT_RESULT }));
    frame();
    expect(text('resurrection-fill-status')).toBe('✓ Alive');
    expect(text('resurrection-fill-count')).toBe('2,000 / 2,000 cases passed (100%)');
    expect(clipWidth()).toBe(258);
  });

  // Statuses not already rendered above. Each pairs a glyph with words, not colour alone (14.1).
  const TRUNCATED = { ...EQUIVALENT_RESULT, truncated: true as const, cases: 900 };
  it.each([
    ['running', { status: 'reanimating', phase: 'generating', cases: 500 }, '✓ Coming back to life', 'pass', '500 / 2,000 cases passed (25%)'],
    ['shrinking', { status: 'reanimating', phase: 'shrinking', cases: 37 }, '✗ Relapsed', 'fail', '36 / 2,000 cases passed (1.8%)'],
    ['alive-truncated', { status: 'alive', phase: 'generating', cases: 900, result: TRUNCATED }, '■ Stopped at the 25 s limit', 'neutral', '900 / 2,000 cases passed (45%)'],
    ['error', { status: 'error', phase: 'generating', cases: 10 }, '■ Stopped, no result', 'neutral', '10 / 2,000 cases passed (0.5%)'],
    ['cancelled', { status: 'cancelled', phase: 'generating', cases: 10 }, '■ Stopped', 'neutral', '10 / 2,000 cases passed (0.5%)'],
  ] as const)('renders the %s status as a glyph plus words', (_name, state, status, tone, count) => {
    const { loop, frame } = harness();
    render(<ResurrectionFill loop={loop} />);
    act(() => useProofRun.setState({ program: 'PAYROLL', run: RUN, result: null, ...state }));
    frame();
    expect(text('resurrection-fill-status')).toBe(status);
    expect(text('resurrection-fill-status')).toMatch(/^[✓✗■] \w/);
    expect(screen.getByTestId('resurrection-fill-status')).toHaveAttribute('data-tone', tone);
    expect(text('resurrection-fill-count')).toBe(count);
  });

  it('shows no status, no count and an empty body when idle', () => {
    const { loop, frame } = harness();
    render(<ResurrectionFill loop={loop} />);
    act(() => useProofRun.setState({ status: 'idle', cases: 0 }));
    frame();
    expect(text('resurrection-fill-status')).toBe('');
    expect(text('resurrection-fill-count')).toBe('');
    expect(clipWidth()).toBe(0);
  });

  it('puts the state in a figcaption beside an aria-hidden SVG, with no live region (14.4, 14.6)', () => {
    const { loop } = harness();
    render(<ResurrectionFill loop={loop} />);
    const figure = screen.getByTestId('resurrection-fill');
    expect(figure.tagName).toBe('FIGURE');
    expect(figure.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    const caption = figure.querySelector('figcaption');
    expect(caption).toContainElement(screen.getByTestId('resurrection-fill-status'));
    expect(caption).toContainElement(screen.getByTestId('resurrection-fill-count'));
    expect(figure.querySelector('[aria-live], [role="status"], [role="alert"], [role="log"]')).toBeNull();
  });

  describe('revive shock pulse (10.3, 10.5, 14.5)', () => {
    const art = () => screen.getByTestId('resurrection-fill-art');
    const revived = (at: number) =>
      act(() => useProofRun.setState({ status: 'alive', revival: { pending: false, revivedAt: at } }));
    const stubReducedMotion = (matches: boolean) =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: matches && query.includes('reduce'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      useSceneNudge.setState({ startedAt: null, revivedAt: null });
    });

    it('pulses the art and revives the scene when revivedAt changes, at most once a second', () => {
      stubReducedMotion(false);
      let now = 10_000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      render(<ResurrectionFill loop={harness().loop} />);
      expect(art()).not.toHaveClass('shock');
      revived(1);
      expect(art()).toHaveClass('shock');
      expect(useSceneNudge.getState().revivedAt).toBe(10_000);
      expect(screen.queryByTestId('resurrection-fill-revived')).toBeNull();
      art().classList.remove('shock');
      now += 500;
      revived(2);
      expect(art()).not.toHaveClass('shock');
      now += 500;
      revived(3);
      expect(art()).toHaveClass('shock');
    });

    it.each([
      ['Relapsed', () => {
        const stream = fakeStream();
        stream.send(STARTED, { type: 'result', result: DIVERGED_RESULT });
        return stream;
      }, 'relapsed'],
      // The live run and the recorded fallback both answer 503.
      ['in error', () => jsonResponse(503, { error: 'Service Unavailable' }), 'error'],
    ] as const)('plays no pulse, no scene event and no "Revived ✓" when the revive ends %s (10.4)', async (_name, respond, ended) => {
      for (const reduced of [false, true]) {
        stubReducedMotion(reduced);
        const { unmount } = render(<ResurrectionFill loop={harness().loop} />);
        act(() => useProofRun.setState({ status: 'relapsed', program: 'PAYROLL', mutant: 'half-up-tax', run: RUN, result: DIVERGED_RESULT }));
        stubFetch(respond);
        await act(() => useProofRun.getState().revive());
        expect(useProofRun.getState()).toMatchObject({ status: ended, revival: { pending: false, revivedAt: null } });
        expect(art()).not.toHaveClass('shock');
        expect(useSceneNudge.getState().revivedAt).toBeNull();
        expect(screen.queryByTestId('resurrection-fill-revived')).toBeNull();
        unmount();
        useProofRun.getState().reset();
      }
    });
    it('shows a static "Revived ✓" with no pulse and no scene event under reduced motion', () => {
      stubReducedMotion(true);
      render(<ResurrectionFill loop={harness().loop} />);
      revived(1);
      expect(art()).not.toHaveClass('shock');
      expect(useSceneNudge.getState().revivedAt).toBeNull();
      expect(text('resurrection-fill-revived')).toBe('Revived ✓');
    });
  });
});
