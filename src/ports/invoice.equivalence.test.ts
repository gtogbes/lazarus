import fc from 'fast-check';
import { equivalenceSuite } from '../harness/equivalence-suite.js';
import { picDisplay } from '../semantics/arbitraries.js';
import { PICS, processRecord } from './invoice.js';

const record = fc
  .tuple(
    fc.stringMatching(/^[A-Z0-9]{6}$/),
    picDisplay(PICS.qty),
    picDisplay(PICS.price),
    picDisplay(PICS.discPct),
    // Known codes, plus unknown, lower-case and blank codes from bad data.
    fc.constantFrom('S', 'R', 'Z', 's', 'X', ' '),
  )
  .map((fields) => fields.join(''));

equivalenceSuite('INVOICE', processRecord, record);
