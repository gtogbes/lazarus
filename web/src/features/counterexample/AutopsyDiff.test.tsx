import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { processRecord } from '../../../../src/ports/payroll';
import { MUTANTS } from '../../../../src/ports/payroll.mutants';
import type { MutantInfo } from '../program/types';
import { AutopsyDiff, REAL_PORT_CAUSE } from './AutopsyDiff';
import { HALF_UP_TAX, NEGATIVE_ZERO } from './fixtures';
import { layoutFor } from './layouts';

const PAYROLL = layoutFor('PAYROLL')!;
const MUTANT = { id: 'half-up-tax', title: 'Half up', rule: 'ROUNDED MODE NEAREST-EVEN', explanation: 'So 0.005 becomes 0.01.' };

function autopsy(result = HALF_UP_TAX, mutant: string | null = 'half-up-tax', info: unknown = mutant ? MUTANT : undefined) {
  render(
    <AutopsyDiff
      counterexample={result.counterexample}
      layout={PAYROLL}
      mutant={mutant}
      mutantInfo={(info ?? undefined) as MutantInfo | undefined}
    />,
  );
  return screen.getByRole('region', { name: 'Autopsy' });
}

describe('AutopsyDiff', () => {
  it('aligns COBOL above the port under a column ruler, with ^ under each differing column (9.1, 9.2)', () => {
    const region = autopsy();
    const cobol = 'EMP001 OK 0100002 0000000 +0100002';
    const port = 'EMP001 OK 0100002 0000001 +0100001';
    expect(within(region).getByTestId('autopsy-cobol')).toHaveTextContent(`COBOL${cobol}`, { normalizeWhitespace: false });
    expect(within(region).getByTestId('autopsy-port')).toHaveTextContent(`Port${port}`, { normalizeWhitespace: false });
    const ruler = within(region).getByTestId('autopsy-ruler').textContent!;
    expect(ruler).toContain('1234567890123456789012345678901234');
    const markers = within(region).getByTestId('autopsy-markers').textContent!.trimStart();
    // Marker row text, past its blank label: a ^ at columns 25 and 34 only.
    expect(markers).toBe('^        ^');
    expect(within(region).getByTestId('autopsy-markers')).toHaveAttribute('aria-hidden', 'true');
    // The outlined cells are the differing ones, on both rows.
    const outlined = [...region.querySelectorAll('[data-testid="autopsy-grid"] .outline')].map((c) => c.textContent);
    expect(outlined).toEqual(['0', '2', '1', '1']);
  });

  it('names each differing column and the first place each field differs (9.5)', () => {
    const region = autopsy();
    expect(within(region).getByTestId('autopsy-columns')).toHaveTextContent(
      '2 characters differ: column 25 (COBOL "0", port "1"), column 34 (COBOL "2", port "1").',
    );
    const lines = within(within(region).getByTestId('autopsy-fields')).getAllByRole('listitem');
    expect(lines.map((li) => li.textContent)).toEqual([
      'OUT-TAX first differs in the decimal places (the 0.01 place): COBOL 0.00, port 0.01.',
      'OUT-NET first differs in the decimal places (the 0.01 place): COBOL +1000.02, port +1000.01.',
    ]);
  });

  it("shows the mutant's explanation as the cause (9.3)", () => {
    const region = autopsy();
    expect(within(region).getByTestId('counterexample-mutant')).toHaveTextContent('So 0.005 becomes 0.01.');
  });

  it('says COBOL is the source of truth for the real port, and names a sign difference (9.4, 9.5)', () => {
    const region = autopsy(NEGATIVE_ZERO, null);
    expect(within(region).getByTestId('autopsy-cause')).toHaveTextContent(REAL_PORT_CAUSE);
    expect(within(region).getByTestId('autopsy-fields')).toHaveTextContent('OUT-NET first differs in the sign');
  });

  it('marks a missing tail and a differing space in text', () => {
    const region = autopsy({
      ...HALF_UP_TAX,
      counterexample: { ...HALF_UP_TAX.counterexample!, cobol: ['AB C'], port: ['ABXCD'], line: 0, column: 2 },
    });
    expect(within(region).getByTestId('autopsy-columns')).toHaveTextContent(
      '2 characters differ: column 3 (COBOL a space, port "X"), column 5 (COBOL nothing, port "D").',
    );
    expect(within(region).getByTestId('autopsy-markers').textContent!.trimStart()).toBe('^ ^');
  });
  it('gives the markers in words, and keeps the grid reachable by keyboard (9.2, 14.1, 14.4, 14.7)', async () => {
    const region = autopsy();
    // Ruler and ^ row are hidden; the column summary says the same in text.
    expect(within(region).getByTestId('autopsy-ruler')).toHaveAttribute('aria-hidden', 'true');
    expect(within(region).getByTestId('autopsy-columns')).not.toHaveAttribute('aria-hidden');
    expect(within(region).getByTestId('autopsy-columns')).toHaveTextContent(/column 25 .*column 34/);
    // The outline is a shape, not a colour: every differing cell has one, no same cell does.
    const grid = within(region).getByTestId('autopsy-grid');
    expect(grid.querySelectorAll('[data-testid="autopsy-cobol"] .outline')).toHaveLength(2);
    expect(grid.querySelectorAll('[data-testid="autopsy-port"] .outline')).toHaveLength(2);
    const user = userEvent.setup();
    await user.tab();
    expect(within(region).getByRole('region', { name: 'COBOL and port output, character by character' })).toHaveFocus();
  });
  it("shows a real mutant's explanation and not the real-port cause (9.3)", () => {
    const mutant = MUTANTS.find((m) => m.id === 'half-up-tax')!;
    const region = autopsy(HALF_UP_TAX, mutant.id, mutant);
    const cause = within(region).getByTestId('counterexample-mutant');
    expect(cause).toHaveTextContent(`Sabotage: ${mutant.title}`);
    expect(cause).toHaveTextContent(`Breaks ${mutant.rule}`);
    expect(cause).toHaveTextContent(mutant.explanation);
    expect(region).not.toHaveTextContent(REAL_PORT_CAUSE);
  });
  it('shows no mutant section for the real port (9.4)', () => {
    const region = autopsy(NEGATIVE_ZERO, null);
    expect(within(region).queryByTestId('counterexample-mutant')).toBeNull();
    expect(region).not.toHaveTextContent('Sabotage');
  });
  it('names the mutant by id when its metadata is missing', () => {
    const region = autopsy(HALF_UP_TAX, 'half-up-tax', null);
    expect(within(region).getByTestId('autopsy-cause')).toHaveTextContent('Sabotage: mutant half-up-tax.');
    expect(region).not.toHaveTextContent(REAL_PORT_CAUSE);
  });
  it('names a high-order difference on a real ignore-size-error divergence (9.5)', () => {
    const input = 'EMP001999999999+0000000'; // 99.99 h at 999.99 overflows OUT-GROSS 9(5)V99
    const region = autopsy(
      {
        ...HALF_UP_TAX,
        counterexample: {
          records: [input],
          cobol: [processRecord(input)],
          port: [MUTANTS.find((m) => m.id === 'ignore-size-error')!.port(input)],
          line: 0,
          column: 7,
        },
      },
      'ignore-size-error',
    );
    const fields = within(within(region).getByTestId('autopsy-fields')).getAllByRole('listitem');
    expect(fields.map((li) => [li.dataset.field, li.dataset.kind])).toEqual([
      ['OUT-STATUS', 'text'],
      ['OUT-GROSS', 'high-order'],
      ['OUT-TAX', 'high-order'],
      ['OUT-NET', 'high-order'],
    ]);
    expect(fields[1]).toHaveTextContent(
      'OUT-GROSS first differs in the high-order digits (the leftmost integer digit): COBOL 0.00, port 29983.70.',
    );
  });
});
