import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import payrollMutantRecording from '../../../public/recorded/PAYROLL.half-up-tax.json';
import payrollRecording from '../../../public/recorded/PAYROLL.json';
import { routes } from '../../app/routes';
import { DATE_FORMAT } from '../proof/proofMessages';
import { fakeStream, jsonResponse } from '../proof/testing';
import { useProofRun } from '../proof/useProofRun';
import { labelSource, rateText } from './DemoBar';
import { DEMO_SCRIPT } from './demoScript';
import { useDemo } from './useDemo';

describe('demo bar labels', () => {
  it('states the rate and the real duration as recorded (11.5, 13.5)', () => {
    expect(rateText(1 / 40, 549)).toBe('Slow motion, 1/40 speed. The real run took 0.55 s.');
    expect(rateText(1 / 20, 612)).toBe('Slow motion, 1/20 speed. The real run took 0.61 s.');
    expect(rateText(1, 549)).toBe('');
  });

  it('labels the recording on screen: upcoming, current, then the last one replayed (11.4)', () => {
    const at = (id: string) => DEMO_SCRIPT.findIndex((s) => s.id === id);
    expect(labelSource(DEMO_SCRIPT, -1)).toMatchObject({ recording: { file: 'PAYROLL.json' }, rate: null });
    expect(labelSource(DEMO_SCRIPT, at('stitches'))).toMatchObject({ recording: { file: 'PAYROLL.json' }, rate: null });
    expect(labelSource(DEMO_SCRIPT, at('prove-real'))).toMatchObject({ recording: { file: 'PAYROLL.json' }, rate: 1 / 40 });
    expect(labelSource(DEMO_SCRIPT, at('sabotage'))).toMatchObject({ recording: { file: 'PAYROLL.json' }, rate: 1 / 40 });
    expect(labelSource(DEMO_SCRIPT, at('autopsy'))).toMatchObject({
      recording: { file: 'PAYROLL.half-up-tax.json' },
      rate: 1 / 40,
    });
    expect(labelSource(DEMO_SCRIPT, at('revive'))).toMatchObject({ recording: { file: 'PAYROLL.json' }, rate: 1 / 20 });
  });
});

// RTL for the bar as the page mounts it: /program/PAYROLL?demo=1 with the committed recordings.
// useDemo.test.ts covers the controller's timing in detail; these check what the user sees and does.

interface CommittedRecording {
  readonly events: readonly { readonly type: string; readonly result?: { generatedAt: string; durationMs: number } }[];
}
// The committed recordings, served at `/recorded/<file>` as the hosted site serves them.
const COMMITTED: Readonly<Record<string, CommittedRecording>> = {
  'PAYROLL.json': payrollRecording as CommittedRecording,
  'PAYROLL.half-up-tax.json': payrollMutantRecording as CommittedRecording,
};
const resultOf = (file: string) => COMMITTED[file]!.events.find((e) => e.type === 'result')!.result!;
const REAL = resultOf('PAYROLL.json');
const MUTANT = resultOf('PAYROLL.half-up-tax.json');
const at = (id: string) => DEMO_SCRIPT.findIndex((s) => s.id === id);
const startOf = (id: string) => DEMO_SCRIPT.slice(0, at(id)).reduce((ms, s) => ms + s.durationMs, 0);
const caption = (id: string) => DEMO_SCRIPT[at(id)]!.caption;
/** The slow-motion line as the bar prints it, from the committed recording's real duration. */
const slowMotion = (rate: number, ms: number) => `Slow motion, 1/${1 / rate} speed. The real run took ${(ms / 1000).toFixed(2)} s.`;

/** Serves `/recorded/<file>` from disk (`missing` ones are 404s) and a live stream for `/api/prove`. Records URLs. */
function serve(missing: readonly string[] = []) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      urls.push(url);
      if (url === '/api/prove') {
        const stream = fakeStream();
        init.signal?.addEventListener('abort', () => stream.fail(new DOMException('Aborted', 'AbortError')), { once: true });
        return stream.response;
      }
      const file = decodeURIComponent(url.replace(/^\/recorded\//, ''));
      if (!url.startsWith('/recorded/') || missing.includes(file) || !(file in COMMITTED)) return jsonResponse(404, {});
      return jsonResponse(200, COMMITTED[file]);
    }),
  );
  return { urls, proveCalls: () => urls.filter((url) => url.includes('/api/')) };
}

/** jsdom has no layout: a wide viewport, motion allowed. */
function stubMatchMedia() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function openDemo() {
  const router = createMemoryRouter(routes, { initialEntries: ['/program/PAYROLL?demo=1'] });
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  await advance(0);
  // The route chunk and the sources were warmed in beforeAll, so the page is up after a flush.
  expect(screen.getByRole('heading', { level: 1, name: 'PAYROLL' })).toBeInTheDocument();
  return router;
}

const bar = () => screen.getByRole('region', { name: 'Demo' });
const button = (name: string | RegExp) => within(bar()).getByRole('button', { name });
const announcer = () => screen.getByTestId('proof-announcer');
const proof = () => useProofRun.getState();

beforeAll(async () => {
  // Warm the lazy route, the PAYROLL source chunk and Shiki with real timers, outside any test's clock.
  stubMatchMedia();
  const router = createMemoryRouter(routes, { initialEntries: ['/program/PAYROLL'] });
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  await screen.findAllByRole('region', { name: /^(COBOL|TypeScript port)/ }, { timeout: 15_000 });
  vi.unstubAllGlobals();
}, 20_000);

beforeEach(() => {
  stubMatchMedia();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
});

afterEach(() => {
  act(() => {
    useDemo.getState().exit();
    useProofRun.getState().reset();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('demo bar on the program page (11.4-11.9, 11.11)', () => {
  it('labels the replay: "Demo: recorded replay", the step, the recording date and the slow-motion rate (11.4, 11.5)', async () => {
    const { proveCalls } = serve();
    await openDemo();
    expect(within(bar()).getByText('Demo: recorded replay')).toBeInTheDocument();
    expect(within(bar()).getByText(`Step 1 of ${DEMO_SCRIPT.length}`)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Recorded');
    expect(bar()).toHaveTextContent(DATE_FORMAT.format(new Date(REAL.generatedAt)));
    // Nothing replayed yet: no rate.
    expect(bar()).not.toHaveTextContent('Slow motion');

    await advance(startOf('prove-real') + 1_000);
    expect(within(bar()).getByText(`Step ${at('prove-real') + 1} of ${DEMO_SCRIPT.length}`)).toBeInTheDocument();
    expect(bar()).toHaveTextContent(slowMotion(1 / 40, REAL.durationMs));

    await advance(startOf('autopsy') - startOf('prove-real'));
    expect(bar()).toHaveTextContent(DATE_FORMAT.format(new Date(MUTANT.generatedAt)));
    expect(bar()).toHaveTextContent(slowMotion(1 / 40, MUTANT.durationMs));

    await advance(startOf('revive') - startOf('autopsy'));
    expect(bar()).toHaveTextContent(slowMotion(1 / 20, REAL.durationMs));
    expect(proveCalls()).toEqual([]);
  });

  it('pause holds the step, the replay and CSS animations; resume carries on from the same point (11.6, 11.7)', async () => {
    const { proveCalls } = serve();
    await openDemo();
    await advance(startOf('prove-real') + 10_000); // mid-replay at 1/40
    expect(proof().status).toBe('reanimating');

    fireEvent.click(button('Pause'));
    await advance(0);
    const executions = proof().executions;
    const shown = screen.getByTestId('proof-executions').textContent;
    expect(button('Resume')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-demo-paused');

    await advance(120_000); // far past the end of the demo
    expect(within(bar()).getByText(`Step ${at('prove-real') + 1} of ${DEMO_SCRIPT.length}`)).toBeInTheDocument();
    expect(within(bar()).getByText(caption('prove-real'))).toBeInTheDocument();
    expect(proof()).toMatchObject({ status: 'reanimating', executions });
    expect(screen.getByTestId('proof-executions').textContent).toBe(shown);

    fireEvent.click(button('Resume'));
    await advance(0);
    expect(document.documentElement).not.toHaveAttribute('data-demo-paused');
    await advance(29_000); // 39 s into the 40 s step
    expect(within(bar()).getByText(caption('prove-real'))).toBeInTheDocument();
    expect(proof().status).toBe('alive');
    await advance(1_000);
    expect(within(bar()).getByText(caption('sabotage'))).toBeInTheDocument();
    expect(proveCalls()).toEqual([]);
  });

  it('skip moves to the next step at once, with a replay at its recorded result', async () => {
    serve();
    await openDemo();
    fireEvent.click(button('Skip step'));
    await advance(0);
    expect(within(bar()).getByText(`Step 2 of ${DEMO_SCRIPT.length}`)).toBeInTheDocument();
    expect(within(bar()).getByText(caption('stitches'))).toBeInTheDocument();

    fireEvent.click(button('Skip step'));
    await advance(1_000);
    expect(proof().status).toBe('reanimating');
    fireEvent.click(button('Skip step'));
    await advance(0);
    expect(proof()).toMatchObject({ status: 'alive', source: 'recorded', cases: 2000 });
    expect(within(bar()).getByText(caption('sabotage'))).toBeInTheDocument();
  });

  it('exit stops the demo, resets the proof, drops ?demo and focuses the heading (11.8)', async () => {
    serve();
    const router = await openDemo();
    await advance(startOf('prove-real') + 5_000);
    fireEvent.click(button('Pause'));
    await advance(0);
    const exit = button('Exit demo');
    exit.focus();
    fireEvent.click(exit);
    await advance(0);

    expect(screen.queryByRole('region', { name: 'Demo' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/program/PAYROLL');
    expect(new URLSearchParams(router.state.location.search).has('demo')).toBe(false);
    expect(screen.getByRole('heading', { level: 1, name: 'PAYROLL' })).toHaveFocus();
    expect(document.documentElement).not.toHaveAttribute('data-demo-paused');
    expect(useDemo.getState()).toMatchObject({ running: false, stepIndex: -1, error: null });
    expect(proof().status).toBe('idle');
    // Nothing carries on after exit.
    await advance(150_000);
    expect(proof().status).toBe('idle');
  });

  it('announces each step caption through the one polite region, and the bar adds no live region (11.9, 14.6)', async () => {
    serve();
    await openDemo();
    expect(announcer()).toHaveAttribute('aria-live', 'polite');
    expect(bar().querySelector('[aria-live]')).toBeNull();
    for (const role of ['status', 'alert', 'log'] as const) expect(within(bar()).queryAllByRole(role)).toEqual([]);

    for (const id of ['program', 'stitches', 'prove-real', 'sabotage'] as const) {
      if (id !== 'program') await advance(DEMO_SCRIPT[at(id) - 1]!.durationMs);
      // The visible caption and the announcement agree; at prove-real the caption beats "Proof started".
      expect(within(bar()).getByText(caption(id))).toBeInTheDocument();
      expect(announcer()).toHaveTextContent(caption(id));
    }
  });

  it('a live Prove ends the demo first and runs against the Proof_API (onBeforeRun)', async () => {
    const { proveCalls } = serve();
    const router = await openDemo();
    await advance(startOf('stitches') + 1_000);
    fireEvent.click(within(screen.getByTestId('prove-panel')).getByRole('button', { name: /prove/i }));
    await advance(0);

    expect(screen.queryByRole('region', { name: 'Demo' })).not.toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).has('demo')).toBe(false);
    expect(useDemo.getState().running).toBe(false);
    expect(proveCalls()).toEqual(['/api/prove']);
    expect(proof()).toMatchObject({ status: 'reanimating', program: 'PAYROLL', source: 'live' });
    // The demo's steps do not come back and override the live run.
    await advance(startOf('prove-real'));
    expect(proof()).toMatchObject({ status: 'reanimating', source: 'live' });
  });

  it('stops before the first step and names a missing recording (11.11)', async () => {
    const { proveCalls } = serve(['PAYROLL.half-up-tax.json']);
    await openDemo();
    expect(bar()).toHaveTextContent('recorded/PAYROLL.half-up-tax.json');
    expect(bar()).toHaveAttribute('data-demo-state', 'error');
    expect(within(bar()).queryByRole('button', { name: /pause|skip/i })).not.toBeInTheDocument();
    expect(button('Exit demo')).toBeInTheDocument();
    expect(announcer()).toHaveTextContent('recorded/PAYROLL.half-up-tax.json');
    await advance(startOf('prove-real') + 5_000);
    expect(proof().status).toBe('idle');
    expect(proveCalls()).toEqual([]);
  });
});
