import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROGRAM_META } from '../../../../src/ports/programs.meta';
import { routes } from '../../app/routes';
import { useSceneNudge } from '../../scene/sceneNudge';
import { summaryExcerpt } from '../program/summaryExcerpt';
import { recordingOf } from '../proof/testing';

const PAYROLL_PROOF = {
  program: 'PAYROLL',
  reference: 'lazarus-gnucobol:3.1.2',
  generatedAt: '2026-11-07T16:35:32.942Z',
  seed: -825795920,
  cases: 2000,
  shrinks: 0,
  durationMs: 1736,
  status: 'equivalent',
};

const INVOICE_PROOF = {
  ...PAYROLL_PROOF,
  program: 'INVOICE',
  cases: 37,
  durationMs: 412,
  shrinks: 9,
  status: 'diverged',
  counterexample: { records: ['IN'], cobol: ['A'], port: ['B'], line: 0, column: 0 },
};

const PAYROLL_FILE = recordingOf(PAYROLL_PROOF);
const INVOICE_FILE = recordingOf(INVOICE_PROOF);

/** Serves recorded proofs by path; anything else gets the dev server's index.html fallback. */
function serveRecorded(files: Record<string, unknown>) {
  const fetchMock = vi.fn((url: string) => {
    const body = files[url];
    return Promise.resolve(
      body === undefined
        ? new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderMorgue() {
  const router = createMemoryRouter(routes, { initialEntries: ['/morgue'] });
  render(<RouterProvider router={router} />);
  return router;
}

function card(id: string) {
  return screen.getByRole('listitem', { name: id });
}

afterEach(() => {
  vi.unstubAllGlobals();
  useSceneNudge.setState({ startedAt: null });
});

describe('morgue', () => {
  it('explains what each program does in plain English, first sentence shown and the rest behind Read more', () => {
    serveRecorded({});
    renderMorgue();
    for (const program of PROGRAM_META) {
      const { lead, rest } = summaryExcerpt(program.summary);
      const summary = within(card(program.id)).getByTestId('program-summary');
      expect(within(summary).getByTestId('program-summary-lead')).toHaveTextContent(lead);
      expect(within(summary).getByTestId('program-summary-rest')).toHaveTextContent(rest);
      expect(within(summary).getByTestId('program-summary-rest')).not.toBeVisible();
    }
  });

  // jsdom does not run <summary>'s Enter/Space activation; full-ui.spec.ts checks the keys in a browser.
  it('puts Read more in the tab order after the card link, and toggles the rest', async () => {
    const user = userEvent.setup();
    serveRecorded({});
    renderMorgue();
    const payroll = within(card('PAYROLL'));
    const more = payroll.getByText('Read more').closest('summary');
    if (!more) throw new Error('no <summary>');
    payroll.getByRole('link', { name: 'PAYROLL' }).focus();
    await user.tab();
    expect(more).toHaveFocus();
    await user.click(more);
    expect(more.closest('details')).toHaveAttribute('open');
    expect(payroll.getByTestId('program-summary-rest')).toBeVisible();
    await user.click(more);
    expect(more.closest('details')).not.toHaveAttribute('open');
  });

  it('nudges the lab scene when a card is hovered or focused', async () => {
    const user = userEvent.setup();
    serveRecorded({});
    renderMorgue();
    expect(useSceneNudge.getState().startedAt).toBeNull();
    await user.hover(card('PAYROLL'));
    expect(useSceneNudge.getState().startedAt).not.toBeNull();
    useSceneNudge.setState({ startedAt: null });
    await user.tab(); // skip link
    await user.tab(); // Lazarus
    await user.tab(); // Morgue
    await user.tab(); // first card's link
    expect(within(card('INTCALC')).getByRole('link', { name: 'INTCALC' })).toHaveFocus();
    expect(useSceneNudge.getState().startedAt).not.toBeNull();
  });

  it('lists every program with its name, description, behaviours and status (1.1)', async () => {
    serveRecorded({ '/recorded/PAYROLL.json': PAYROLL_FILE, '/recorded/INVOICE.json': INVOICE_FILE });
    renderMorgue();

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(
      PROGRAM_META.map((p) => p.id),
    );

    for (const program of PROGRAM_META) {
      const item = within(card(program.id));
      expect(item.getByText(program.description)).toBeInTheDocument();
      const behaviours = item.getByRole('list', { name: 'COBOL behaviours' });
      expect(within(behaviours).getAllByRole('listitem').map((li) => li.textContent)).toEqual(program.behaviours);
    }

    expect(await within(card('PAYROLL')).findByText('Alive')).toBeInTheDocument();
    expect(await within(card('INVOICE')).findByText('Relapsed')).toBeInTheDocument();
    // No recorded proof for INTCALC: the dev server would answer with index.html.
    expect(await within(card('INTCALC')).findByText('Unproven')).toBeInTheDocument();
  });

  it('shows case count, duration and date for programs with a recorded proof (1.2)', async () => {
    const fetchMock = serveRecorded({ '/recorded/PAYROLL.json': PAYROLL_FILE, '/recorded/INVOICE.json': INVOICE_FILE });
    renderMorgue();

    const payroll = within(card('PAYROLL'));
    expect(await payroll.findByText('2,000')).toBeInTheDocument();
    expect(payroll.getByText('1.7 s')).toBeInTheDocument();
    expect(payroll.getByText('7 Nov 2026')).toHaveAttribute('datetime', PAYROLL_PROOF.generatedAt);

    const invoice = within(card('INVOICE'));
    expect(await invoice.findByText('37')).toBeInTheDocument();
    expect(invoice.getByText('412 ms')).toBeInTheDocument();

    const intcalc = within(card('INTCALC'));
    expect(await intcalc.findByText('No recorded proof yet.')).toBeInTheDocument();
    expect(intcalc.queryByText('Cases')).not.toBeInTheDocument();

    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(
      PROGRAM_META.map((p) => `/recorded/${p.id}.json`).sort(),
    );
  });

  it('treats a malformed recorded proof as no proof', async () => {
    serveRecorded({ '/recorded/PAYROLL.json': recordingOf({ ...PAYROLL_PROOF, cases: -1 }) });
    renderMorgue();
    expect(await within(card('PAYROLL')).findByText('Unproven')).toBeInTheDocument();
  });

  it('opens the program view when a program is selected with the mouse (1.3)', async () => {
    serveRecorded({});
    const user = userEvent.setup();
    const router = renderMorgue();

    await user.click(within(card('PAYROLL')).getByRole('link', { name: 'PAYROLL' }));

    expect(router.state.location.pathname).toBe('/program/PAYROLL');
    // The program view is a lazy route chunk.
    expect(await screen.findByRole('heading', { level: 1, name: 'PAYROLL' })).toBeInTheDocument();
  });

  it('opens the program view from the keyboard (1.3)', async () => {
    serveRecorded({});
    const user = userEvent.setup();
    const router = renderMorgue();

    const link = screen.getByRole('link', { name: 'INVOICE' });
    link.focus();
    await user.keyboard('{Enter}');

    expect(router.state.location.pathname).toBe('/program/INVOICE');
  });

  it('is usable before anything else has loaded (1.4)', async () => {
    // Recorded proofs never arrive; the list and its links must not wait for them.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const user = userEvent.setup();
    const router = renderMorgue();

    for (const program of PROGRAM_META) {
      expect(screen.getByRole('link', { name: program.id })).toHaveAttribute('href', `/program/${program.id}`);
    }
    expect(screen.getAllByText('Checking for a recorded proof…')).toHaveLength(PROGRAM_META.length);

    await user.click(screen.getByRole('link', { name: 'INTCALC' }));
    expect(router.state.location.pathname).toBe('/program/INTCALC');
  });
});
