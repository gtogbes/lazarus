import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EquivalenceResult } from '../../../../src/harness/equivalence.types';
import { routes } from '../../app/routes';
import { useProofRun } from '../proof/useProofRun';
import { HALF_UP_TAX, NEGATIVE_ZERO } from './fixtures';

/** Open the program view, wait for its source chunk, then put a finished relapsed run in the store. */
async function showDivergence(result: EquivalenceResult, mutant: string | null, selectedMutant: string | null = mutant) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  await act(async () => {
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [`/program/${result.program}`] })} />);
  });
  await screen.findByRole('group', { name: 'Port to prove' }, { timeout: 10_000 });
  act(() => {
    useProofRun.setState({ status: 'relapsed', program: result.program, mutant, result, selectedMutant });
  });
  return screen.getByRole('region', { name: 'Counterexample' });
}

/** Table rows as arrays of cell text. */
function rows(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''));
}

afterEach(() => {
  useProofRun.getState().reset();
  vi.unstubAllGlobals();
});

describe('counterexample card', () => {
  it('is hidden until a run relapses', async () => {
    await act(async () => {
      render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/program/PAYROLL'] })} />);
    });
    await screen.findByRole('group', { name: 'Port to prove' }, { timeout: 10_000 });
    expect(screen.queryByRole('region', { name: 'Counterexample' })).not.toBeInTheDocument();
  });

  it('decodes the input and both outputs of the differing record into named fields (5.1)', async () => {
    const card = await showDivergence(HALF_UP_TAX, 'half-up-tax');
    expect(within(card).getByTestId('counterexample-position')).toHaveTextContent(
      'Record 2 of 2 is the first that differs, at column 25.',
    );
    const input = within(card).getByRole('table', { name: 'Input record 2 of 2 (IN-REC)' });
    expect(within(input).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Field', 'PIC', 'Value']);
    expect(rows(input)).toEqual([
      ['IN-EMP-ID', 'X(6)', '"EMP001"'],
      ['IN-HOURS', '9(2)V99', '2.00'],
      ['IN-RATE', '9(3)V99', '500.01'],
      ['IN-ADJUST', 'S9(5)V99 SIGN LEADING SEPARATE', '+0.00'],
    ]);
    const output = within(card).getByRole('table', { name: /^Output record 2 of 2 \(OUT-REC\)/ });
    expect(within(output).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Field',
      'PIC',
      'COBOL',
      'Port',
      'Match',
    ]);
    // FILLER separators are hidden because they match.
    expect(within(output).getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'OUT-EMP-ID',
      'OUT-STATUS',
      'OUT-GROSS',
      'OUT-TAX',
      'OUT-NET',
    ]);
  });

  it('marks each differing field in text and shows both values as decimals (5.2)', async () => {
    const card = await showDivergence(HALF_UP_TAX, 'half-up-tax');
    const output = within(card).getByRole('table', { name: /2 fields differ$/ });
    expect(rows(output)).toEqual([
      ['OUT-EMP-ID', 'X(6)', '"EMP001"', '"EMP001"', 'Same'],
      ['OUT-STATUS', 'X(2)', '"OK"', '"OK"', 'Same'],
      ['OUT-GROSS', '9(5)V99', '1000.02', '1000.02', 'Same'],
      ['OUT-TAX', '9(5)V99', '0.00', '0.01', '≠ Differs'],
      ['OUT-NET', 'S9(5)V99 SIGN LEADING SEPARATE', '+1000.02', '+1000.01', '≠ Differs'],
    ]);
  });

  it('shows a negative zero against a positive zero as a difference (5.2)', async () => {
    const card = await showDivergence(NEGATIVE_ZERO, null);
    const output = within(card).getByRole('table', { name: /1 field differs$/ });
    const net = within(output).getByRole('rowheader', { name: 'OUT-NET' }).closest('tr');
    expect([...(net?.querySelectorAll('td') ?? [])].map((td) => td.textContent)).toEqual([
      'S9(5)V99 SIGN LEADING SEPARATE',
      '-0.00',
      '+0.00',
      '≠ Differs',
    ]);
    expect(within(card).getByText('No sabotage was planted: the real port differs from COBOL here.')).toBeVisible();
  });

  it("explains the run's mutant, not the current sabotage selection (5.3)", async () => {
    const card = await showDivergence(HALF_UP_TAX, 'half-up-tax', 'ignore-size-error');
    const explanation = within(card).getByTestId('counterexample-mutant');
    expect(explanation).toHaveTextContent("Sabotage: Use normal rounding instead of banker's rounding");
    expect(explanation).toHaveTextContent('Breaks COMPUTE WS-TAX ROUNDED MODE NEAREST-EVEN');
    expect(explanation).toHaveTextContent('so 0.005 becomes 0.00');
    expect(explanation).not.toHaveTextContent('ON SIZE ERROR');
  });

  it('shows the shrink count and copies a replay command with the seed (5.4)', async () => {
    const user = userEvent.setup();
    const card = await showDivergence(HALF_UP_TAX, 'half-up-tax');
    expect(within(card).getByTestId('shrink-summary')).toHaveTextContent(
      'Found after 213 cases and shrunk in 17 steps. Seed -1501918552.',
    );
    const command =
      'LAZARUS_SEED=-1501918552 LAZARUS_RUNS=213 npx vitest --run src/ports/mutants.equivalence.test.ts ' +
      '-t "^PAYROLL mutants against GnuCOBOL > half-up-tax is "';
    expect(within(card).getByTestId('replay-command')).toHaveTextContent(command, { normalizeWhitespace: false });
    await user.click(within(card).getByRole('button', { name: 'Copy command' }));
    expect(await navigator.clipboard.readText()).toBe(command);
    expect(within(card).getByRole('status')).toHaveTextContent('Copied the replay command.');
  });

  it('selects the command and says so when the clipboard is refused (5.4)', async () => {
    const user = userEvent.setup();
    const card = await showDivergence(NEGATIVE_ZERO, null);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const command = within(card).getByTestId('replay-command');
    expect(command).toHaveTextContent('LAZARUS_SEED=42 LAZARUS_RUNS=5 npx vitest --run src/ports/payroll.equivalence.test.ts');
    await user.click(within(card).getByRole('button', { name: 'Copy command' }));
    expect(within(card).getByRole('status')).toHaveTextContent('Could not copy automatically. The command is selected');
    expect(window.getSelection()?.toString()).toBe(command.textContent);
  });
});
