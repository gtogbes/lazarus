/** Record layouts from the FD entries in cobol/programs/INVOICE.cbl. */
import { recordLayout, type ProgramLayout } from '../semantics/layout.js';

export const LAYOUT: ProgramLayout = {
  input: recordLayout('IN-REC', [
    { name: 'IN-INV-ID', picture: 'X(6)' },
    { name: 'IN-QTY', picture: '9(4)' },
    { name: 'IN-PRICE', picture: '9(5)V99' },
    { name: 'IN-DISC-PCT', picture: '9(2)V9' },
    { name: 'IN-VAT-CODE', picture: 'X' },
  ]),
  output: recordLayout('OUT-REC', [
    { name: 'OUT-INV-ID', picture: 'X(6)' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-STATUS', picture: 'X(2)' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-LINE', picture: '9(7)V99' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-DISC', picture: '9(7)V99' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-VAT', picture: '9(7)V99' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-TOTAL', picture: '9(7)V99' },
  ]),
};
