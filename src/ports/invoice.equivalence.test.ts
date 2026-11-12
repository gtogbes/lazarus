import { equivalenceSuite } from '../harness/equivalence-suite.js';
import { processRecord } from './invoice.js';
import { INVOICE_RECORD } from './records.js';

equivalenceSuite('INVOICE', processRecord, INVOICE_RECORD);
