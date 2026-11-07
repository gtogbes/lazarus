import fc from 'fast-check';
import { equivalenceSuite } from '../harness/equivalence-suite.js';
import { picDisplay } from '../semantics/arbitraries.js';
import { PICS, processRecord } from './intcalc.js';

const record = fc
  .tuple(
    fc.stringMatching(/^[A-Z0-9]{8}$/),
    picDisplay(PICS.balance),
    picDisplay(PICS.rate),
    picDisplay(PICS.days),
  )
  .map((fields) => fields.join(''));

equivalenceSuite('INTCALC', processRecord, record);
