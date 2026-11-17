import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';

/** jsdom has no layout: report media queries as a viewport of `width` px would. */
function setViewportWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: width >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function openProgram(id: string) {
  // Awaited act lets the view that suspends on `use(promise)` resolve. With a plain render,
  // a view suspending on a fresh promise after an earlier test never re-rendered under jsdom.
  await act(async () => {
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [`/program/${id}`] })} />);
  });
  // The route and the per-program sources are lazy chunks; the first load in a run also warms Shiki.
  await screen.findByRole('heading', { level: 1, name: id }, { timeout: 10_000 });
  // Wait for a code pane, not any h2: the Prove panel's heading renders before the sources load.
  await screen.findAllByRole('region', { name: /^(COBOL|TypeScript port)/ }, { timeout: 10_000 });
}

const cobolPane = () => screen.getByRole('region', { name: /^COBOL/ });
const portPane = () => screen.getByRole('region', { name: /^TypeScript port/ });
const highlighted = () => cobolPane().querySelector('mark');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('program view', () => {
  it('shows the COBOL and the port side by side as highlighted text (2.1, 2.4)', async () => {
    setViewportWidth(1280);
    await openProgram('PAYROLL');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(cobolPane()).toHaveTextContent('COMPUTE WS-NET = WS-GROSS - WS-TAX + IN-ADJUST');
    expect(cobolPane()).toHaveAccessibleName('COBOL cobol/programs/PAYROLL.cbl');
    expect(portPane()).toHaveTextContent('export function processRecord(record: string): string {');
    expect(portPane()).toHaveAccessibleName('TypeScript port src/ports/payroll.ts');
    // Syntax highlighting: keywords are coloured spans, not one plain block.
    const keyword = within(portPane()).getAllByText('export')[0];
    expect(keyword?.style.color).not.toBe('');
    // Code is DOM text in a <pre>, never a canvas or 3D texture.
    expect(cobolPane().querySelector('pre')).not.toBeNull();
    expect(document.querySelector('canvas')).toBeNull();
    // Requirement 3: the Prove panel sits in the program view.
    expect(screen.getByRole('button', { name: 'Prove it' })).toBeInTheDocument();
  });

  it('shows the first sentence of the summary, with the rest behind Read more', async () => {
    setViewportWidth(1280);
    const user = userEvent.setup();
    await openProgram('INVOICE');
    const summary = screen.getByTestId('program-summary');
    expect(within(summary).getByTestId('program-summary-lead')).toHaveTextContent(
      'Prices one invoice line: quantity times unit price, less a percentage discount, plus VAT at 17.5%, 5% or 0% by code.',
    );
    const rest = within(summary).getByTestId('program-summary-rest');
    expect(rest).not.toBeVisible();
    await user.click(within(summary).getByText('Read more'));
    expect(rest).toBeVisible();
    expect(rest).toHaveTextContent('Two mutants: round VAT halves up, or round the discount instead of cutting it.');
    expect(within(summary).getByText('Show less')).toBeVisible();
  });

  it('highlights the quoted COBOL statement when a port statement gets keyboard focus (2.2)', async () => {
    setViewportWidth(1280);
    const user = userEvent.setup();
    await openProgram('PAYROLL');
    expect(highlighted()).toBeNull();

    // Tab: the COBOL pane, the port pane, then the first linked port statement.
    cobolPane().focus();
    await user.tab();
    expect(portPane()).toHaveFocus();
    await user.tab();
    const first = within(portPane()).getAllByRole('button')[0];
    expect(first).toHaveFocus();
    expect(first).toHaveAccessibleDescription(/Highlights the COBOL statement/);
    expect(highlighted()).toHaveTextContent('MOVE "OK" TO OUT-STATUS');
    expect(highlighted()).toHaveTextContent('MOVE ZERO TO WS-GROSS WS-TAX');

    const net = within(portPane()).getByRole('button', { name: /COMPUTE WS-NET/ });
    act(() => {
      net.focus();
    });
    expect(highlighted()).toHaveTextContent(/^\d+\s*COMPUTE WS-NET = WS-GROSS - WS-TAX \+ IN-ADJUST$/);
    expect(screen.getByTestId('link-caption')).toHaveTextContent(
      'COBOL line 101 highlighted for port lines 75–76: COMPUTE WS-NET = WS-GROSS - WS-TAX + IN-ADJUST',
    );
  });

  it('highlights on hover too, for pointer users (2.2)', async () => {
    setViewportWidth(1280);
    const user = userEvent.setup();
    await openProgram('INVOICE');
    await user.hover(within(portPane()).getByRole('button', { name: /EVALUATE IN-VAT-CODE/ }));
    expect(highlighted()).toHaveTextContent(/EVALUATE IN-VAT-CODE.*MOVE "VC" TO OUT-STATUS.*END-EVALUATE/);
  });

  it('stacks the panes below 900 px with a keyboard-operable switch (2.3)', async () => {
    setViewportWidth(899);
    const user = userEvent.setup();
    await openProgram('INTCALC');
    const tabs = within(screen.getByRole('tablist', { name: 'Source' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['COBOL', 'TypeScript port']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(cobolPane()).toBeVisible();
    expect(screen.queryByRole('region', { name: /^TypeScript port/ })).not.toBeInTheDocument();

    tabs[0]?.focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(portPane()).toBeVisible();
    expect(screen.queryByRole('region', { name: /^COBOL/ })).not.toBeInTheDocument();

    await user.click(tabs[0] as HTMLElement);
    expect(cobolPane()).toBeVisible();
  });

  it('when stacked, Enter on a port statement switches to the COBOL and focuses the match (2.2, 2.3)', async () => {
    setViewportWidth(600);
    const user = userEvent.setup();
    await openProgram('INTCALC');
    await user.click(screen.getByRole('tab', { name: 'TypeScript port' }));
    act(() => {
      within(portPane()).getByRole('button', { name: /COMPUTE WS-NEW-BAL/ }).focus();
    });
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'COBOL' })).toHaveAttribute('aria-selected', 'true');
    expect(highlighted()).toHaveFocus();
    expect(highlighted()).toHaveTextContent('COMPUTE WS-NEW-BAL = IN-BALANCE + WS-INTEREST');
  });

  it('shows the not-found page for an unknown program id', async () => {
    setViewportWidth(1280);
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/program/payroll'] })} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nothing buried here' })).toBeInTheDocument();
  });
});
