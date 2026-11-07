import fc from 'fast-check';
import { equivalenceSuite } from '../harness/equivalence-suite.js';
import { picDisplay } from '../semantics/arbitraries.js';
import { PICS, processRecord } from './payroll.js';

const record = fc
  .tuple(
    fc.stringMatching(/^[A-Z0-9]{6}$/),
    picDisplay(PICS.hours),
    picDisplay(PICS.rate),
    picDisplay(PICS.adjust),
  )
  .map((fields) => fields.join(''));

equivalenceSuite('PAYROLL', processRecord, record);
