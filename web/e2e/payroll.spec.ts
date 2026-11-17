import { expect, test } from './fixtures';
import { MUTANTS } from '../../src/ports/payroll.mutants';

/**
 * Happy path against the real proof API and real GnuCOBOL (task 15, Requirements 3-5):
 * prove the real PAYROLL port (Alive), plant the half-up-tax mutant, prove again (Relapsed)
 * and read the counterexample.
 */
const halfUpTax = MUTANTS.find((m) => m.id === 'half-up-tax');
if (!halfUpTax) throw new Error('PAYROLL mutant half-up-tax not found');

// A proof runs at most 25 s on the server (Requirement 3.6); the first one also starts a container.
const PROOF_TIMEOUT = 60_000;
// src/api/prove.ts REFERENCE_LABELS: the dev server runs the docker image, Lambda the baked native binaries.
const REFERENCE = process.env.E2E_BASE_URL ? /Reference\s*gnucobol 3\.1\.2 \(native\)/ : /Reference\s*lazarus-gnucobol:3\.1\.2/;

test('PAYROLL: prove the port, sabotage it, and read the counterexample', async ({ page }) => {
  await page.goto('/morgue');
  await expect(page.getByRole('heading', { level: 1, name: 'The morgue' })).toBeVisible();
  await page.getByRole('link', { name: 'PAYROLL' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'PAYROLL' })).toBeVisible();
  const provePanel = page.getByRole('region', { name: 'Prove it' });
  // The status cell has no accessible name of its own (a <dd> after "Status").
  const status = provePanel.getByTestId('proof-status');
  await expect(status).toHaveText('Not yet proven');

  // Requirement 3.1, 3.3: the real port is proven Alive, with cases, duration, seed and reference.
  await provePanel.getByRole('button', { name: 'Prove it' }).click();
  await expect(status).toHaveText('Alive', { timeout: PROOF_TIMEOUT });
  const summary = provePanel.getByTestId('proof-summary');
  await expect(summary).toContainText(/[\d,]+ cases matched GnuCOBOL record for record\./);
  await expect(summary).toContainText(/Seed\s*-?\d+/);
  await expect(summary).toContainText(REFERENCE);

  // Requirement 4.1, 4.3: pick the mutant by its plain-English title and see its diff.
  const sabotage = page.getByRole('region', { name: 'Sabotage the port' });
  await sabotage.getByRole('radio', { name: halfUpTax.title }).check();
  const diff = sabotage.getByRole('region', { name: /Changes against the real port/ });
  await expect(diff).toBeVisible();
  await expect(diff).toContainText('Removed:');
  await expect(diff).toContainText('Added:');
  await expect(diff).toContainText('MUTANT:');
  await expect(provePanel).toContainText('Sabotage is on');

  // Requirement 4.2, 3.4: proving the mutant relapses.
  await provePanel.getByRole('button', { name: 'Prove again' }).click();
  await expect(status).toHaveText('Relapsed', { timeout: PROOF_TIMEOUT });

  // Requirement 5.1, 5.2: decoded input and output records, at least one field marked as differing.
  const card = page.getByRole('region', { name: 'Counterexample' });
  await expect(card).toBeVisible();
  // Requirement 9.1, 9.2: the Autopsy marks the differing columns in text; the tables are folded below it.
  await expect(card.getByTestId('autopsy-columns')).toContainText('column 25');
  await expect(card.getByTestId('autopsy-fields')).toContainText('OUT-TAX first differs in the decimal places');
  await card.getByText('Records field by field').click();
  const input = card.getByRole('table', { name: /^Input record/ });
  await expect(input.getByRole('rowheader', { name: 'IN-EMP-ID' })).toBeVisible();
  await expect(input.getByRole('rowheader', { name: 'IN-RATE' })).toBeVisible();
  const output = card.getByRole('table', { name: /^Output record/ });
  await expect(output).toBeVisible();
  await expect(output.getByRole('rowheader', { name: 'OUT-TAX' })).toBeVisible();
  const differing = output.getByRole('row').filter({ hasText: 'Differs' });
  expect(await differing.count()).toBeGreaterThanOrEqual(1);
  // Half-up rounding puts the tax a penny out.
  await expect(output.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'OUT-TAX' }) })).toContainText(
    'Differs',
  );

  // Requirement 5.3: the mutant's explanation of the COBOL rule it breaks.
  await expect(card).toContainText(`Sabotage: ${halfUpTax.title}`);
  await expect(card).toContainText(halfUpTax.rule);
  await expect(card).toContainText(halfUpTax.explanation);

  // Requirement 5.4: shrink count and a copyable replay command with the seed.
  await expect(card).toContainText(/shrunk in [\d,]+ steps?\. Seed -?\d+\./);
  await expect(card.getByText(/^LAZARUS_SEED=-?\d+ /)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Copy command' })).toBeVisible();
});
