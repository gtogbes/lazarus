/** Record layouts from the FD entries in cobol/programs/PAYROLL.cbl. */
import { recordLayout, type ProgramLayout } from '../semantics/layout.js';

export const LAYOUT: ProgramLayout = {
  input: recordLayout('IN-REC', [
    { name: 'IN-EMP-ID', picture: 'X(6)' },
    { name: 'IN-HOURS', picture: '9(2)V99' },
    { name: 'IN-RATE', picture: '9(3)V99' },
    { name: 'IN-ADJUST', picture: 'S9(5)V99 SIGN LEADING SEPARATE' },
  ]),
  output: recordLayout('OUT-REC', [
    { name: 'OUT-EMP-ID', picture: 'X(6)' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-STATUS', picture: 'X(2)' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-GROSS', picture: '9(5)V99' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-TAX', picture: '9(5)V99' },
    { name: 'FILLER', picture: 'X' },
    { name: 'OUT-NET', picture: 'S9(5)V99 SIGN LEADING SEPARATE' },
  ]),
};
