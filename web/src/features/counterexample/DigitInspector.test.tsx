import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Counterexample } from '../../../../src/harness/equivalence.types';
import { processRecord } from '../../../../src/ports/payroll';
import { MUTANTS } from '../../../../src/ports/payroll.mutants';
import { DigitInspector } from './DigitInspector';
import { HALF_UP_TAX } from './fixtures';
import { layoutFor } from './layouts';

const OUTPUT = layoutFor('PAYROLL')!.output;

/** One PAYROLL output record pair, COBOL first. */
const pair = (cobol: string, port: string): Counterexample => ({
  records: ['EMP001020050001+0000000'],
  cobol: [cobol],
  port: [port],
  line: 0,
  column: 0,
});

/**
 * A real high-order case: 99.99 hours at 999.99 overflows OUT-GROSS 9(5)V99.
 * COBOL takes ON SIZE ERROR (status SE, gross 0); the `ignore-size-error`
 * mutant keeps the truncated 29983.70.
 */
const OVERFLOW = 'EMP001999999999+0000000';
const SIZE_ERROR: Counterexample = {
  records: [OVERFLOW],
  cobol: [processRecord(OVERFLOW)],
  port: [MUTANTS.find((m) => m.id === 'ignore-size-error')!.port(OVERFLOW)],
  line: 0,
  column: 7,
};

function inspector(counterexample: Counterexample | undefined = HALF_UP_TAX.counterexample) {
  render(<DigitInspector counterexample={counterexample} layout={OUTPUT} />);
  return screen.getByRole('region', { name: 'Digit inspector' });
}

/** The characters of one table row, past its header, with the point as '.'. */
const rowChars = (table: HTMLElement, label: string) =>
  [...within(table).getByRole('rowheader', { name: label }).closest('tr')!.querySelectorAll('td')].map((td) =>
    td.textContent!.replace('✗, differs', ''),
  );

describe('DigitInspector', () => {
  it('offers the differing numeric fields and picks the first by default (9.6)', () => {
    const region = inspector();
    const picker = within(region).getByRole('group', { name: 'Differing numeric field' });
    const radios = within(picker).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual(['OUT-TAX9(5)V99', 'OUT-NETS9(5)V99']);
    expect(radios[0]).toBeChecked();
  });

  it('draws 9(5)V99 as 5 boxes, a point and 2 boxes, COBOL above the port, with ✗ on the differing box (9.6)', () => {
    const region = inspector();
    const table = within(region).getByRole('table');
    expect(table).toHaveAccessibleName('OUT-TAX, PIC 9(5)V99: COBOL above, port below. The 0.01 digit differs.');
    for (const name of ['10000 place', '1000 place', '100 place', '10 place', '1 place', 'decimal point', '0.1 place', '0.01 place']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['COBOL', 'Port']);
    expect(rowChars(table, 'COBOL')).toEqual(['0', '0', '0', '0', '0', '.', '0', '0']);
    expect(rowChars(table, 'Port')).toEqual(['0', '0', '0', '0', '0', '.', '0', '1']);
    const marked = table.querySelectorAll('td[data-differs]');
    expect([...marked].map((td) => td.textContent)).toEqual(['0✗, differs', '1✗, differs']);
    expect(within(region).queryByTestId('digit-high-order')).toBeNull();
  });

  it('switches field from the picker, adding the sign box for S9(5)V99', () => {
    const region = inspector();
    fireEvent.click(within(region).getByRole('radio', { name: /OUT-NET/ }));
    const table = within(region).getByRole('table');
    expect(table).toHaveAccessibleName('OUT-NET, PIC S9(5)V99: COBOL above, port below. The 0.01 digit differs.');
    expect(rowChars(table, 'COBOL')).toEqual(['+', '0', '1', '0', '0', '0', '.', '0', '2']);
  });

  it('notes a high-order difference and how COBOL truncates (9.7)', () => {
    const region = inspector(pair('EMP001 SE 0000000 0000000 +0000000', 'EMP001 OK 2345678 0000000 +0000000'));
    expect(within(region).getByRole('radio', { name: /OUT-GROSS/ })).toBeChecked();
    expect(within(region).getByTestId('digit-high-order')).toHaveTextContent(
      'OUT-GROSS differs at its high-order limit, the leftmost of its 5 integer digits. COBOL drops digits on the left of a value too large for the PIC unless ON SIZE ERROR is coded.',
    );
  });

  it('shows raw characters and says the field is not valid for its PIC (9.8)', () => {
    const region = inspector(pair('EMP001 OK 0100002 0000000 +0100002', 'EMP001 OK 01A0002 0000000 +0100002'));
    const table = within(region).getByRole('table');
    expect(table).toHaveAttribute('data-form', 'invalid');
    expect(rowChars(table, 'Port')).toEqual(['0', '1', 'A', '0', '0', '0', '2']);
    expect(table.querySelectorAll('td[data-differs]')).toHaveLength(2);
    expect(within(region).getByTestId('digit-invalid')).toHaveTextContent(
      'The port text "01A0002" is not valid for PIC 9(5)V99, so the field is shown as raw characters.',
    );
  });

  it('says so when only text fields differ', () => {
    const region = inspector(pair('A0000A SE 0000000 0000000 +0000000', 'A0000A OK 0000000 0000000 +0000000'));
    expect(within(region).queryByRole('table')).toBeNull();
    expect(within(region).getByTestId('digit-none')).toHaveTextContent(
      'No numeric field differs in this record, so there are no digits to inspect. The difference is in the text of OUT-STATUS.',
    );
  });
  it('moves between fields with the arrow keys and marks the change in text (9.6, 14.1, 14.7)', async () => {
    const user = userEvent.setup();
    const region = inspector();
    await user.tab();
    expect(within(region).getByRole('radio', { name: /OUT-TAX/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const net = within(region).getByRole('radio', { name: /OUT-NET/ });
    expect(net).toHaveFocus();
    expect(net).toBeChecked();
    const table = within(region).getByRole('table');
    expect(table).toHaveAccessibleName('OUT-NET, PIC S9(5)V99: COBOL above, port below. The 0.01 digit differs.');
    // The ✗ is hidden; each differing box carries the words instead.
    const marked = [...table.querySelectorAll('td[data-differs]')];
    expect(marked.map((td) => td.querySelector('.sr-only')?.textContent)).toEqual([', differs', ', differs']);
    expect(marked.every((td) => td.querySelector('[aria-hidden="true"]')?.textContent === '✗')).toBe(true);
  });
  it('notes the high-order limit on a real ignore-size-error divergence (9.7)', () => {
    expect(SIZE_ERROR.cobol[0]).toBe('EMP001 SE 0000000 0000000 +0000000');
    expect(SIZE_ERROR.port[0]).toBe('EMP001 OK 2998370 1244266 +1754104');
    const region = inspector(SIZE_ERROR);
    expect(within(region).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual([
      'OUT-GROSS9(5)V99',
      'OUT-TAX9(5)V99',
      'OUT-NETS9(5)V99',
    ]);
    expect(within(region).getByRole('radio', { name: /OUT-GROSS/ })).toBeChecked();
    expect(within(region).getByRole('table')).toHaveAccessibleName(
      'OUT-GROSS, PIC 9(5)V99: COBOL above, port below. The 10000 digit, the 1000 digit, the 100 digit, the 10 digit, the 1 digit and the 0.1 digit differ.',
    );
    expect(within(region).getByTestId('digit-high-order')).toHaveTextContent(
      'OUT-GROSS differs at its high-order limit, the leftmost of its 5 integer digits. COBOL drops digits on the left of a value too large for the PIC unless ON SIZE ERROR is coded.',
    );
  });
  it('shows no high-order note when only the sign differs', () => {
    const region = inspector(pair('EMP001 OK 0000000 0000000 -0000000', 'EMP001 OK 0000000 0000000 +0000000'));
    expect(within(region).getByRole('table')).toHaveAccessibleName(
      'OUT-NET, PIC S9(5)V99: COBOL above, port below. The sign differs.',
    );
    expect(within(region).queryByTestId('digit-high-order')).toBeNull();
  });
  it('says when the COBOL side is the one not valid for its PIC (9.8)', () => {
    const region = inspector(pair('EMP001 OK 0000000 0000000 00000000', 'EMP001 OK 0000000 0000000 +0000000'));
    expect(within(region).getByRole('table')).toHaveAttribute('data-form', 'invalid');
    expect(within(region).getByTestId('digit-invalid')).toHaveTextContent(
      'The COBOL text "00000000" is not valid for PIC S9(5)V99, so the field is shown as raw characters.',
    );
  });
});
