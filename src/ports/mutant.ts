import type { Port } from '../harness/equivalence.js';

/**
 * A copy of a port with one realistic migration mistake (Requirement 4).
 * Each mutant port is a full copy of `processRecord` with the changed line
 * marked `// MUTANT:`, so the UI can diff it against the real port.
 */
export interface Mutant {
  /** Kebab-case identifier, unique within its program. Used by the proof API. */
  readonly id: string;
  /** Plain-English name of the mistake, shown in the sabotage panel. */
  readonly title: string;
  /** Which COBOL rule the mistake breaks and what it does to the output. */
  readonly explanation: string;
  /** The COBOL statement or phrase the mistake breaks, as written in the source. */
  readonly rule: string;
  /** Present only when no input can expose the mutant: the reason why. */
  readonly equivalent?: string;
  readonly port: Port;
}
