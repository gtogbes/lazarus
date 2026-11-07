# Tasks: Equivalence harness

- [x] 1. Pinned GnuCOBOL image
  - `docker/gnucobol/Dockerfile`, Debian bookworm by digest, gnucobol3 3.1.2, non-root user
  - _Requirements: 1.1_
- [x] 2. First sample program `cobol/programs/INTCALC.cbl` (interest accrual with penalty rate)
  - _Requirements: 1.1, 1.4_
- [x] 3. COBOL numeric semantics in `src/semantics/decimal.ts` with unit tests
  - Rationals, ROUNDED half away from zero, high-order truncation, negative zero, DISPLAY formatting
  - _Requirements: 4.2_
- [x] 4. `compileCobol` with source-hash cache and `CompileError`
  - _Requirements: 1.1, 1.2, 1.3_
- [x] 5. `CobolSession` streaming records through a long-lived container
  - _Requirements: 1.4_
- [x] 6. `compareOutputs` with first differing line and column, with unit tests
  - _Requirements: 3.1, 3.2, 3.3_
- [x] 7. `assertEquivalent` with seed replay and counterexample reporting
  - _Requirements: 4.1, 4.3, 4.4, 5.1_
- [x] 8. Boundary-biased PIC generators in `src/semantics/arbitraries.ts`
  - _Requirements: 4.1, 4.2_
- [x] 9. Port `src/ports/intcalc.ts` and `intcalc.equivalence.test.ts` passing 1,000 runs
  - Verified at 50,000 runs. Mutation check: removing ROUNDED fails within 2 cases.
  - _Requirements: 2.1, 3, 4_
- [x] 10. JSON results file for the UI
  - `checkEquivalence` uses `fc.check` and returns status, seed, cases, shrinks and the
    counterexample; `equivalenceSuite` writes `results/<PROGRAM>.json`
  - _Requirements: 5.2_
- [x] 12. Second and third sample programs
  - `PAYROLL.cbl`: COMP-3 working storage, ON SIZE ERROR, banker's rounding, tax bands
  - `INVOICE.cbl`: silent high-order truncation, truncated discount, banker's VAT, bad VAT codes
  - Both ports pass 50,000 cases. Mutation checks: 5 of 6 rule-breaking edits caught
    within 26 cases; the 6th (`<=` vs `<` on a tax band edge) is an equivalent mutant
  - _Requirements: 2.1, 3, 4_
- [x] 11. Unit tests for `compileCobol` cache and `CompileError` path
  - `src/harness/cobol.test.ts`, compiles into a temp folder (needs Docker)
  - _Requirements: 1.2, 1.3_
