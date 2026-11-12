import { equivalenceSuite } from '../harness/equivalence-suite.js';
import { processRecord } from './payroll.js';
import { PAYROLL_RECORD } from './records.js';

equivalenceSuite('PAYROLL', processRecord, PAYROLL_RECORD);
