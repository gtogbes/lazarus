/** Record layouts from the FD entries in cobol/programs/INTCALC.cbl. */
import { recordLayout, type ProgramLayout } from '../semantics/layout.js';

export const LAYOUT: ProgramLayout = {
  input: recordLayout('IN-REC', [
    { name: 'IN-ACCT-ID', picture: 'X(8)' },
    { name: 'IN-BALANCE', picture: 'S9(9)V99 SIGN LEADING SEPARATE' },
    { name: 'IN-RATE', picture: '9(2)V9(4)' },
    { name: 'IN-DAYS', picture: '9(3)' },
  ]),
  output: recordLayout('OUT-REC', [
    { name: 'OUT-ACCT-ID', picture: 'X(8)' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-RATE', picture: '9(2)V9(4)' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-INTEREST', picture: 'S9(7)V99 SIGN LEADING SEPARATE' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-NEW-BAL', picture: 'S9(9)V99 SIGN LEADING SEPARATE' },
  ]),
};
