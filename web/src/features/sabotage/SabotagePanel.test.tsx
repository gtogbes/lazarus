import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { fakeStream, stubFetch } from '../proof/testing';
import { useProofRun } from '../proof/useProofRun';

async function openProgram(id: string) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  await act(async () => {
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [`/program/${id}`] })} />);
  });
  // The sabotage panel comes with the program's lazy source chunk.
  return screen.findByRole('group', { name: 'Port to prove' }, { timeout: 10_000 });
}

const diff = () => screen.getByTestId('mutant-diff');
const diffLines = (kind: 'removed' | 'added') =>
  [...diff().querySelectorAll(`[data-kind="${kind}"]`)].map((line) => line.textContent ?? '');

afterEach(() => {
  useProofRun.getState().reset();
  vi.unstubAllGlobals();
});

describe('sabotage panel', () => {
  it("lists the program's mutants by plain-English title, real port first (4.1)", async () => {
    const group = await openProgram('PAYROLL');
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([
      'No sabotage: prove the real port',
      "Use normal rounding instead of banker's rounding",
      'Ignore ON SIZE ERROR and keep the overflowed gross',
      'Use "less than" instead of "up to" on the 1,000.00 tax band Equivalent',
    ]);
    // The badge is a separate word in the accessible name, not "…bandEquivalent".
    expect(
      within(group).getByRole('radio', { name: 'Use "less than" instead of "up to" on the 1,000.00 tax band Equivalent' }),
    ).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'No sabotage: prove the real port' })).toBeChecked();
    expect(screen.queryByTestId('mutant-diff')).not.toBeInTheDocument();
  });

  it('shows the changed lines as a diff against the real port, with text markers (4.3)', async () => {
    const user = userEvent.setup();
    const group = await openProgram('INTCALC');
    await user.click(within(group).getByRole('radio', { name: 'Truncate the interest instead of rounding it' }));
    const details = screen.getByTestId('mutant-details');
    expect(details).toHaveTextContent('Breaks COMPUTE WS-INTEREST ROUNDED');
    expect(details).toHaveTextContent('Without it the port cuts the extra digits off');
    expect(within(details).getByRole('region', { name: /^Changes against the real port/ })).toHaveAccessibleName(
      'Changes against the real port src/ports/intcalc.ts → src/ports/intcalc.mutants.ts',
    );
    // Removed and added lines say so in text, not only in colour.
    expect(diffLines('removed')).toEqual([
      expect.stringMatching(/^\d+-Removed: {3}const interest = store\(exactInterest, PICS\.interest, \{ rounded: true \}\);$/),
    ]);
    expect(diffLines('added')).toEqual([
      expect.stringMatching(/^\d+\+Added: {3}const interest = store\(exactInterest, PICS\.interest\); \/\/ MUTANT: ROUNDED dropped/),
    ]);
    // Context around the change comes from the real port.
    expect(diff()).toHaveTextContent('fromInt(365n)');
    // Tokens are highlighted spans, never injected HTML.
    expect(diff().querySelector('[data-kind="added"] span[style*="color"]')).not.toBeNull();
  });

  it('labels an equivalent mutant and explains why no input can expose it (4.4)', async () => {
    const user = userEvent.setup();
    const group = await openProgram('PAYROLL');
    const strict = within(group).getByRole('radio', { name: /less than.*Equivalent/ });
    await user.click(strict);
    expect(screen.getByTestId('equivalent-reason')).toHaveTextContent(
      /^Equivalent mutant: no input can expose it\. At exactly 1,000\.00 the 25% band charges .* no gross pay can tell the mutant from the real port\.$/,
    );
    expect(diffLines('added').join('\n')).toContain('// MUTANT: <= became <');
    // A mutant that is not equivalent has no such note.
    await user.click(within(group).getByRole('radio', { name: /banker's rounding/ }));
    expect(screen.queryByTestId('equivalent-reason')).not.toBeInTheDocument();
  });

  it('is keyboard operable and Prove sends the selected mutant id (4.2)', async () => {
    const user = userEvent.setup();
    const stream = fakeStream();
    const { calls } = stubFetch(() => stream);
    const group = await openProgram('PAYROLL');
    const real = within(group).getByRole('radio', { name: 'No sabotage: prove the real port' });
    act(() => {
      real.focus();
    });
    await user.keyboard('{ArrowDown}');
    const halfUp = within(group).getByRole('radio', { name: /banker's rounding/ });
    expect(halfUp).toHaveFocus();
    expect(halfUp).toBeChecked();
    expect(screen.getByTestId('sabotage-notice')).toHaveTextContent('Prove runs the mutant half-up-tax');

    await user.click(screen.getByRole('button', { name: 'Prove it' }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(new TextDecoder().decode(calls[0]?.init.body as Uint8Array)).toBe(
      '{"program":"PAYROLL","mutant":"half-up-tax"}',
    );
    expect(useProofRun.getState().mutant).toBe('half-up-tax');
    stream.close();
  });

  it('proves the real port again once sabotage is switched off', async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch(() => fakeStream());
    const group = await openProgram('INVOICE');
    await user.click(within(group).getAllByRole('radio')[1] as HTMLElement);
    await user.click(within(group).getByRole('radio', { name: 'No sabotage: prove the real port' }));
    expect(screen.queryByTestId('sabotage-notice')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Prove it' }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(new TextDecoder().decode(calls[0]?.init.body as Uint8Array)).toBe('{"program":"INVOICE"}');
  });
});
