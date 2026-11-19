# Kiro journal

Notes on where Kiro features (specs, steering, hooks, property tests) changed the
outcome. Add an entry when one does. Dates are UK time.

## 2026-11-02: equivalence harness, first slice

**Spec-driven.** Requirements drafted first (`.kiro/specs/equivalence-harness/`).
A short spike before the design changed it: GnuCOBOL output is block-buffered when
piped, and `stdbuf -oL` makes it flush per record. That turned the design from
"one container per test case" (~0.5 s each) into one long-lived container
answering record by record (~1 ms each).

**Steering.** `tech.md` says never use JS `number` for money and lists COBOL
truncation and ROUNDED rules. The first port used bigint rationals from the start
because of it.

**PBT catches 1: a bug in my own arithmetic.** On the very first run, fast-check
shrank a failure to a balance of -0.01. `div()` dropped the dividend's
denominator. The unit test for division used whole numbers, so it passed.

**PBT catches 2: COBOL negative zero.** After 3,974 cases, fast-check found an
overdrawn balance of -999,999,999.98 where the interest overflows its PIC
S9(7)V99 field and is truncated to zero. GnuCOBOL wrote `-000000000`; the port
wrote `+000000000`. A rounding result of -0.0025 still gives `+000000000`, so
the sign is decided before high-order truncation. Unit tests would not have
found this: nobody writes a test for "negative zero after overflow".

**Mutation check.** Removing ROUNDED from the port fails within 2 generated cases,
so the property is actually sensitive to the rule it is meant to protect.

## 2026-11-02: PAYROLL and INVOICE, results file

**Each sample program targets different COBOL traps.** PAYROLL: packed decimal
(COMP-3), `ON SIZE ERROR` (the field is left unchanged, not truncated), and
`ROUNDED MODE NEAREST-EVEN`. INVOICE: silent loss of high-order digits on an
overflowing line amount, a truncated (not rounded) discount, banker's-rounded
VAT, and bad VAT codes (`s`, `X`, blank) as real data would contain.

**Probing before porting.** My first hand-typed probe records were the wrong
width and produced garbage that looked plausible. Rebuilding them field by field
with `printf '%s%s%s'` fixed it. This is the kind of mistake generated inputs
avoid: the generators build records from the PIC layout, so they're always
the right width.

**Passing first time made me suspicious, so I checked the tests:**
- Branch coverage of the generators over 10,000 samples: PAYROLL size errors 6%,
  all three tax bands hit (50% / 5% / 45%); INVOICE overflowing line amounts
  55%, unknown VAT codes 50%.
- Mutation checks (one rule broken at a time):
  | Mutation | Caught after |
  |---|---|
  | PAYROLL banker's rounding → half up | 14 cases |
  | PAYROLL ignores ON SIZE ERROR | 2 cases |
  | INVOICE banker's rounding → half up | 26 cases |
  | INVOICE rounds the discount instead of truncating | 1 case |
  | INVOICE accepts lower-case VAT code | 2 cases |
  | PAYROLL `<=` → `<` on the 1,000.00 band edge | never (equivalent mutant: both branches give 0 tax there) |

**Results file.** Switched the harness from `fc.assert` to `fc.check` so it can
write `results/<PROGRAM>.json` (status, seed, case count, shrinks,
counterexample) before failing. This is what the UI will read.

## 2026-11-02: hooks

Three hooks in `.kiro/hooks/`:
- **Re-prove ports on save** (command, PostFileSave on `src/ports|semantics|harness`):
  runs unit and equivalence tests and shows each program's verdict and any
  counterexample.
- **COBOL changed: re-verify the port** (agent, PostFileSave on `cobol/programs/*.cbl`):
  tells Kiro the COBOL is the source of truth and to fix the port until it
  matches, then log the change here.
- **Keep .kiro/ in the repo** (command, PreToolUse on shell tools): blocks
  `git add`/`git commit` while `.kiro/` is gitignored, so the specs, steering
  and hooks always ship with the code.

Testing the guard hook caught a bug in it: `git check-ignore` skips files that
are already tracked, so it never blocked. `--no-index` fixed it. I only found
this because I tested the block case on purpose rather than just the pass case.

Also: Kiro's `createHook` writes to the open workspace root. With `Hackathons/`
open, the hooks landed outside the project and had to be moved into
`lazarus/.kiro/hooks/`. Open the project folder itself as the workspace.

## 2026-11-02: reanimation lab spec

Wrote `.kiro/specs/reanimation-lab/` before any UI code. The spec changed the
plan in two ways:
- **Sabotage mode.** Writing Requirement 4 ("prove the tests are not passing by
  default") turned the manual mutation script into a product feature: visitors
  pick a realistic migration mistake and watch the proof catch it. The same
  mutants become a permanent mutation test.
- **No visitor-edited code.** Letting visitors edit the port would mean running
  arbitrary code on the Lambda. Predefined mutants give the same "break it
  yourself" moment with no code execution risk.
