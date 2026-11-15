import { expect, test } from './fixtures';
import { MUTANTS } from '../../src/ports/payroll.mutants';

/**
 * Task 23, Requirement 9.1: the roles and accessible names a screen reader gets for the
 * key views (Chromium's accessibility tree, via Playwright ARIA snapshots). This is not a
 * VoiceOver test: see docs/a11y.md for the manual VoiceOver checklist.
 *
 * Templates match partially: listed nodes must be present, in order; others may sit between.
 */

const halfUpTax = MUTANTS.find((m) => m.id === 'half-up-tax');
if (!halfUpTax) throw new Error('PAYROLL mutant half-up-tax not found');

test('landing: skip link, landmarks, headline; the 3D scene is not in the tree', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('body')).toMatchAriaSnapshot(`
    - link "Skip to content"
    - banner:
      - navigation "Primary":
        - link "Lazarus"
        - link "Morgue"
    - main:
      - region "Reanimation lab":
        - heading "Reanimation lab" [level=1]
        - link "Enter the morgue"
  `);
  // aria-hidden scene: nothing of it reaches the tree.
  expect(await page.locator('main').ariaSnapshot()).not.toMatch(/img|canvas/);
});

test('morgue: each program is a named list item with a link, behaviours and status', async ({ page }) => {
  await page.goto('/morgue');
  await expect(page.getByText('Checking for a recorded proof…')).toHaveCount(0);
  await expect(page.locator('main')).toMatchAriaSnapshot(`
    - region "The morgue":
      - heading "The morgue" [level=1]
      - list:
        - listitem "PAYROLL":
          - heading "PAYROLL" [level=2]:
            - link "PAYROLL"
          - list "COBOL behaviours"
          - term: Status
          - definition: Alive
          - term: Cases
          - term: Recorded
  `);
});

test('program view: Prove panel, sabotage radio group, code regions; then the counterexample', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/program/PAYROLL');
  await expect(page.getByRole('region', { name: 'Sabotage the port' })).toBeVisible();
  await expect(page.locator('main')).toMatchAriaSnapshot(`
    - region "PAYROLL":
      - paragraph:
        - link "Back to the morgue"
      - heading "PAYROLL" [level=1]
      - region "Prove it":
        - heading "Prove it" [level=2]
        - button "Prove it"
        - term: Status
        - definition: Not yet proven
        - status
      - region "Sabotage the port":
        - heading "Sabotage the port" [level=2]
        - group "Port to prove":
          - list:
            - listitem:
              - radio /^No sabotage/ [checked]
      - heading /^COBOL/ [level=2]
      - region /^COBOL/
      - heading /^TypeScript port/ [level=2]
      - region /^TypeScript port/
  `);

  await page.getByRole('radio', { name: halfUpTax.title }).check();
  await expect(page.getByRole('region', { name: 'Sabotage the port' })).toMatchAriaSnapshot(`
    - region "Sabotage the port":
      - group "Port to prove":
        - list:
          - listitem:
            - radio "${halfUpTax.title}" [checked]
          - listitem:
            - radio /tax band Equivalent$/
      - heading "${halfUpTax.title}" [level=3]
      - heading /^Changes against the real port/ [level=4]
      - region /^Changes against the real port/
  `);

  await page.getByRole('button', { name: 'Prove it', exact: true }).click();
  await expect(page.getByTestId('proof-status')).toHaveText('Relapsed', { timeout: 60_000 });
  const card = page.getByRole('region', { name: 'Counterexample' });
  await card.getByText('Records field by field').click();
  await expect(card).toMatchAriaSnapshot(`
    - heading "Counterexample" [level=2]
    - region "Autopsy":
      - heading "Autopsy" [level=3]
      - paragraph: /^Record \\d+ of \\d+ is the first that differs/
      - region "COBOL and port output, character by character"
      - paragraph: /characters? differs?:/
      - list:
        - listitem:
          - code: OUT-TAX
          - text: /^first differs in the decimal places/
      - heading "Why it diverged" [level=3]
    - group:
      - region "Input record":
        - table /^Input record/:
          - rowgroup:
            - row:
              - columnheader "Field"
              - columnheader "PIC"
              - columnheader "Value"
          - rowgroup:
            - row:
              - rowheader "IN-EMP-ID"
      - region "Output records":
        - table /^Output record .*COBOL against the port/:
          - rowgroup:
            - row:
              - columnheader "Field"
              - columnheader "COBOL"
              - columnheader "Port"
              - columnheader "Match"
    - heading "Replay it locally" [level=3]
    - region "Replay command"
    - button "Copy command"
    - status
  `);
  // The differing output field reads as "Differs" in words, not only in colour.
  const taxRow = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'OUT-TAX' }) });
  await expect(taxRow).toMatchAriaSnapshot(`
    - row:
      - rowheader "OUT-TAX"
      - cell /Differs/
  `);
});
