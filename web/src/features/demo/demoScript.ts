/**
 * The demo script (graphical-proof design, "Demo mode"; Requirements 11.2 and
 * 11.12): a fixed list of steps that tells the PAYROLL story from recordings.
 *
 *   program → stitches → prove-real (Alive) → sabotage half-up-tax →
 *   prove-mutant (flatline, Relapsed) → shrink → autopsy + digit inspector →
 *   revive (Alive)
 *
 * Every step has a fixed duration; the steps add up to 130 s. A step's `action`
 * drives the proof store (useProofRun), and its `cues` tell the program view
 * what to show, at display times from the step's start. A replay must end
 * inside its step (the rest is a hold): at 1/40, the 549 ms real-port recording
 * takes about 22 s of a 40 s step and the 106 ms mutant recording about 4.2 s
 * of a 6 s step; at 1/20 the revive replay takes about 11 s of a 20 s step.
 *
 * The demo only replays the same-origin recordings this script names (16.4),
 * and never calls the Proof_API (11.3). Captions describe what the committed
 * recordings show (13): the half-up-tax counterexample differs from COBOL by one
 * penny in the 0.01 place of OUT-TAX and OUT-NET, not in a high-order digit.
 * They carry no counts: the numbers on screen come from the run itself (13.1).
 */
import { recordingFileName } from '../proof/recording';
import type { ProofTarget } from '../proof/useProofRun';

export const DEMO_PROGRAM = 'PAYROLL';
export const DEMO_MUTANT = 'half-up-tax';
/** Approved slow motion (requirements, "Decisions"): the two proofs at 1/40, the revive at 1/20. */
export const PROOF_RATE = 1 / 40;
export const REVIVE_RATE = 1 / 20;
/** Requirement 11.12: 130 s ± 5 s at the default settings. */
export const DEMO_TOTAL_MS = 130_000;

/** What the program view shows during a step. The view (task 19.2) acts on the current cue. */
export type DemoCue =
  | { readonly kind: 'program' }
  /** Activate the field stitch for this COBOL data name. */
  | { readonly kind: 'field'; readonly name: string }
  /** Activate the statement link at this index of `ProgramSource.links`. */
  | { readonly kind: 'statement'; readonly index: number }
  | { readonly kind: 'mutant-diff' }
  | { readonly kind: 'vitals' }
  | { readonly kind: 'shrink' }
  | { readonly kind: 'autopsy' }
  /** Open the digit inspector on this output field. */
  | { readonly kind: 'inspect'; readonly field: string };

export interface TimedCue {
  /** Display ms from the step's start (paused time does not count). */
  readonly atMs: number;
  readonly cue: DemoCue;
}

/** The outcome a replayed recording must show for the story to hold. */
export type DemoOutcome = 'alive' | 'relapsed';

export type DemoAction =
  | { readonly kind: 'hold' }
  | { readonly kind: 'select-mutant'; readonly mutant: string | null }
  | { readonly kind: 'replay'; readonly target: ProofTarget; readonly rate: number; readonly expect: DemoOutcome }
  /** `useProofRun.revive` with a clock: replays the real port's recording, never the Proof_API. */
  | { readonly kind: 'revive'; readonly program: string; readonly rate: number };

export type DemoStepId = 'program' | 'stitches' | 'prove-real' | 'sabotage' | 'prove-mutant' | 'shrink' | 'autopsy' | 'revive';

export interface DemoStep {
  /** Also `data-demo-step` for the capture script. */
  readonly id: DemoStepId;
  readonly caption: string;
  readonly durationMs: number;
  readonly action: DemoAction;
  /** In time order; the first is at 0. */
  readonly cues: readonly TimedCue[];
}

const REAL: ProofTarget = { program: DEMO_PROGRAM, mutant: null };
const MUTANT: ProofTarget = { program: DEMO_PROGRAM, mutant: DEMO_MUTANT };
/** `ProgramSource.links` index of the PAYROLL tax bands (`EVALUATE TRUE ... END-EVALUATE`). */
const TAX_BANDS_STATEMENT = 4;

export const DEMO_SCRIPT: readonly DemoStep[] = [
  {
    id: 'program',
    caption: 'PAYROLL: the original COBOL program on the left, its TypeScript port on the right.',
    durationMs: 8_000,
    action: { kind: 'hold' },
    cues: [{ atMs: 0, cue: { kind: 'program' } }],
  },
  {
    id: 'stitches',
    caption: 'Stitches link each COBOL field to the port code that holds it: hours, rate, gross pay and tax, then the tax bands.',
    durationMs: 22_000,
    action: { kind: 'hold' },
    cues: [
      { atMs: 0, cue: { kind: 'field', name: 'IN-HOURS' } },
      { atMs: 4_000, cue: { kind: 'field', name: 'IN-RATE' } },
      { atMs: 8_000, cue: { kind: 'field', name: 'WS-GROSS' } },
      { atMs: 11_000, cue: { kind: 'field', name: 'OUT-GROSS' } },
      { atMs: 14_000, cue: { kind: 'field', name: 'OUT-TAX' } },
      { atMs: 17_000, cue: { kind: 'statement', index: TAX_BANDS_STATEMENT } },
    ],
  },
  {
    id: 'prove-real',
    caption: 'Proving the real port: a recorded run feeds the same generated records to GnuCOBOL and the port. Every case matches, so the port is Alive.',
    durationMs: 40_000,
    action: { kind: 'replay', target: REAL, rate: PROOF_RATE, expect: 'alive' },
    cues: [{ atMs: 0, cue: { kind: 'vitals' } }],
  },
  {
    id: 'sabotage',
    caption: "Sabotage: the half-up-tax mutant rounds the tax half up, where COBOL rounds a half penny to the nearest even penny.",
    durationMs: 4_000,
    action: { kind: 'select-mutant', mutant: DEMO_MUTANT },
    cues: [{ atMs: 0, cue: { kind: 'mutant-diff' } }],
  },
  {
    id: 'prove-mutant',
    caption: 'Proving the sabotaged port: a generated record makes it disagree with COBOL, so the heartbeat flatlines and the port has Relapsed.',
    durationMs: 6_000,
    action: { kind: 'replay', target: MUTANT, rate: PROOF_RATE, expect: 'relapsed' },
    cues: [{ atMs: 0, cue: { kind: 'vitals' } }],
  },
  {
    id: 'shrink',
    caption: 'Shrinking: the failing input is cut down, step by step, to a small example that still fails.',
    durationMs: 10_000,
    action: { kind: 'hold' },
    cues: [{ atMs: 0, cue: { kind: 'shrink' } }],
  },
  {
    id: 'autopsy',
    caption: 'Autopsy: COBOL and the port differ by one penny in OUT-TAX and OUT-NET. The digit inspector shows the difference is in the 0.01 place: a rounding difference.',
    durationMs: 20_000,
    action: { kind: 'hold' },
    cues: [
      { atMs: 0, cue: { kind: 'autopsy' } },
      { atMs: 8_000, cue: { kind: 'inspect', field: 'OUT-TAX' } },
    ],
  },
  {
    id: 'revive',
    caption: 'Revive: back to the real port, proved again from its recording. Every case matches, and the port is Alive again.',
    durationMs: 20_000,
    action: { kind: 'revive', program: DEMO_PROGRAM, rate: REVIVE_RATE },
    cues: [{ atMs: 0, cue: { kind: 'vitals' } }],
  },
];

/** A recording the script replays, and the outcome it must show. */
export interface DemoRecording {
  readonly target: ProofTarget;
  /** Relative to `recorded/`, e.g. `PAYROLL.half-up-tax.json`. Used to name a failed recording (11.11). */
  readonly file: string;
  readonly expect: DemoOutcome;
}

/** The recording a step replays, or null for a step that replays none. */
export function stepRecording(step: DemoStep): DemoRecording | null {
  const { action } = step;
  if (action.kind === 'replay') return { target: action.target, file: recordingFileName(action.target), expect: action.expect };
  if (action.kind === 'revive') {
    const target = { program: action.program, mutant: null };
    return { target, file: recordingFileName(target), expect: 'alive' };
  }
  return null;
}

/** Every recording the script needs, once each, in first-use order (16.4). */
export function demoRecordings(script: readonly DemoStep[] = DEMO_SCRIPT): readonly DemoRecording[] {
  const byFile = new Map<string, DemoRecording>();
  for (const step of script) {
    const recording = stepRecording(step);
    if (recording && !byFile.has(recording.file)) byFile.set(recording.file, recording);
  }
  return [...byFile.values()];
}

/** The step's Playback_Rate, or null for a step that replays nothing. */
export function stepRate(step: DemoStep): number | null {
  return step.action.kind === 'replay' || step.action.kind === 'revive' ? step.action.rate : null;
}

export function scriptDurationMs(script: readonly DemoStep[] = DEMO_SCRIPT): number {
  return script.reduce((total, step) => total + step.durationMs, 0);
}
