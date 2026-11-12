import { equivalenceSuite } from '../harness/equivalence-suite.js';
import { processRecord } from './intcalc.js';
import { INTCALC_RECORD } from './records.js';

equivalenceSuite('INTCALC', processRecord, INTCALC_RECORD);
