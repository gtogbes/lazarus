# Requirements: Equivalence harness

## Introduction
The harness proves that a TypeScript port behaves the same as the original COBOL
program. It runs both on the same input and compares the outputs. Property-based
tests generate the inputs.

This is a starting draft. Refine it in a Kiro Spec session, then generate
`design.md` and `tasks.md` from it.

## Requirement 1: Run the original COBOL

**User story:** As a modernisation engineer, I want to run the original COBOL
program without installing a compiler, so that I can use it as the reference.

### Acceptance criteria
1. WHEN a COBOL program in `cobol/programs/` is requested THEN the harness SHALL compile it with GnuCOBOL in a pinned Docker image.
2. WHEN the program has already been compiled and its source is unchanged THEN the harness SHALL reuse the compiled binary.
3. WHEN compilation fails THEN the harness SHALL report the compiler output and SHALL NOT run any comparison.
4. WHEN the harness runs a program THEN it SHALL pass input on stdin and capture stdout, stderr and the exit code.

## Requirement 2: Run the TypeScript port

**User story:** As a modernisation engineer, I want to run the port with the same interface as the original, so that the outputs can be compared directly.

### Acceptance criteria
1. WHEN a port exists at `src/ports/<program>.ts` THEN the harness SHALL run it with the same input bytes given to the COBOL program.
2. WHEN no port exists for a program THEN the harness SHALL report that the port is missing.

## Requirement 3: Compare outputs

**User story:** As a modernisation engineer, I want any behavioural difference reported precisely, so that I can fix the port.

### Acceptance criteria
1. WHEN both programs finish THEN the harness SHALL compare stdout byte for byte and compare exit codes.
2. WHEN outputs differ THEN the harness SHALL report the input, both outputs and the first differing line and column.
3. WHEN outputs match THEN the harness SHALL record the run as equivalent.

## Requirement 4: Property-based equivalence

**User story:** As a modernisation engineer, I want generated inputs to explore edge cases I would not think of, so that I find divergences before production does.

### Acceptance criteria
1. WHEN a property test runs THEN it SHALL generate inputs that are valid for the program's record layout.
2. WHEN generating numeric fields THEN generators SHALL include boundary values (zero, maximum for the PIC size, negative where signed, values that need rounding).
3. WHEN a divergence is found THEN the test SHALL report the shrunk counterexample and the seed needed to replay it.
4. WHEN a seed is supplied THEN the test SHALL replay the same inputs.

## Requirement 5: Results for the UI

**User story:** As a demo viewer, I want to see runs and divergences live, so that I can see the proof happening.

### Acceptance criteria
1. WHEN a property test is running THEN the harness SHALL emit progress events with run count and divergence count.
2. WHEN a run finishes THEN the harness SHALL write a JSON results file the UI can load.

## Open decisions
- Hosted demo: run COBOL live on AWS (Fargate or a Lambda container image) or replay recorded results in a static site.
- Whether ports run in-process or as a child process (in-process is faster; child process matches the COBOL interface more closely).
