# Requirements: Reanimation lab (web UI and proof API)

## Introduction
The reanimation lab is the public face of Lazarus. A visitor (usually a judge
with a few minutes) picks a legacy COBOL program, sees it beside its TypeScript
port, and watches Lazarus prove them equivalent by running real GnuCOBOL against
the port on generated inputs. They can then sabotage the port with a realistic
migration mistake and watch the proof catch it, shrink it, and explain it.

The theme is a photoreal 1970s machine room turned into a reanimation lab
(see `.kiro/steering/design.md`). The theme carries meaning: lighting and
status reflect the real state of the proof.

### Glossary
- **Program**: one sample COBOL batch program (INTCALC, PAYROLL, INVOICE).
- **Port**: its TypeScript translation in `src/ports/`.
- **Proof run**: one call to the harness for a program (and optional mutant).
- **Mutant**: a predefined copy of a port with one realistic migration mistake.
- **Counterexample**: the shrunk input on which COBOL and the port differ.
- **Status**: Buried (no port), Reanimating (proof running), Alive (equivalent),
  Relapsed (diverged).

## Requirement 1: The morgue (program list)

**User story:** As a visitor, I want to see every program and whether its port
is proven, so that I can pick one to inspect.

### Acceptance criteria
1. WHEN the lab loads THEN the UI SHALL list every program with its name, a one-line description, the COBOL behaviours it exercises and its status.
2. WHEN a recorded proof exists for a program THEN the list SHALL show its case count, duration and date.
3. WHEN a program is selected THEN the UI SHALL open its program view.
4. The list SHALL be usable before any 3D content has loaded.

## Requirement 2: Program view

**User story:** As a modernisation engineer, I want the COBOL and the port side by side, so that I can judge the translation myself.

### Acceptance criteria
1. WHEN a program view opens THEN the UI SHALL show the COBOL source and the port source in two readable, syntax-highlighted panes.
2. WHEN the user focuses a port statement that quotes a COBOL statement in a comment THEN the UI SHALL highlight the matching COBOL statement.
3. WHEN the viewport is narrower than 900 px THEN the panes SHALL stack, with a control to switch between them.
4. The UI SHALL NOT render source code as a 3D texture.

## Requirement 3: Prove it (live proof run)

**User story:** As a visitor, I want to start a proof and watch it run against the real COBOL, so that I believe the result.

### Acceptance criteria
1. WHEN the user starts a proof THEN the system SHALL run the harness against the GnuCOBOL binary for that program and stream progress to the UI.
2. WHILE a proof is running THEN the UI SHALL show cases run, divergences found and elapsed time, updating at least 4 times per second.
3. WHEN a proof finishes with no divergence THEN the UI SHALL set the status to Alive and show cases run, duration, seed and the GnuCOBOL version used as reference.
4. WHEN a proof finishes with a divergence THEN the UI SHALL set the status to Relapsed and show the counterexample (Requirement 5).
5. WHEN a proof is running THEN the user SHALL be able to cancel it.
6. The server SHALL decide the number of cases (default 2,000) and SHALL stop a run after 25 seconds.

## Requirement 4: Sabotage (mutants)

**User story:** As a sceptical visitor, I want to break the port in a realistic way and see the proof catch it, so that I know the tests are not just passing by default.

### Acceptance criteria
1. WHEN a program view opens THEN the UI SHALL list that program's mutants, each with a plain-English title (for example "Use normal rounding instead of banker's rounding").
2. WHEN the user runs a proof with a mutant selected THEN the system SHALL prove the mutant port instead of the real port.
3. WHEN the user selects a mutant THEN the UI SHALL show the changed lines as a diff against the real port.
4. WHEN a mutant is known to be equivalent THEN the UI SHALL label it as such and explain why no input can expose it.
5. WHEN the test suite runs THEN every mutant not marked equivalent SHALL be caught within 2,000 cases.

## Requirement 5: Counterexample explanation

**User story:** As a modernisation engineer, I want a divergence explained field by field, so that I can see which business value is wrong and why.

### Acceptance criteria
1. WHEN a divergence is shown THEN the UI SHALL show the input record and both output records decoded into named fields using the program's record layout.
2. WHEN fields differ THEN the UI SHALL highlight each differing field and show the COBOL value and the port value as decimals (for example `-0.00` vs `+0.00`).
3. WHEN the divergence came from a mutant THEN the UI SHALL show that mutant's explanation of the COBOL rule it breaks.
4. WHEN a divergence is shown THEN the UI SHALL show the number of shrink steps and a copyable command that replays it locally with the seed.

## Requirement 6: Recorded fallback

**User story:** As a judge, I want the lab to work even if the live service is unavailable, so that I can still evaluate it.

### Acceptance criteria
1. WHEN the proof API cannot be reached or returns an error THEN the UI SHALL offer to replay a recorded proof for the same program and mutant.
2. WHEN a recorded proof is replayed THEN the UI SHALL label it "Recorded" with the date it was recorded.
3. The site SHALL include recorded proofs for every program and every mutant.

## Requirement 7: The lab scene (3D)

**User story:** As a visitor, I want a memorable, realistic scene whose state reflects the proof, so that the result is obvious at a glance.

### Acceptance criteria
1. WHEN the landing page loads THEN the UI SHALL show the 3D lab scene, loaded lazily after the 2D interface is interactive.
2. WHILE a proof is running THEN the scene's arc lights SHALL flicker at a rate tied to cases per second.
3. WHEN the status becomes Alive THEN the scene SHALL play a short reanimation moment (under 3 seconds); WHEN it becomes Relapsed THEN it SHALL switch to alarm lighting.
4. WHEN `prefers-reduced-motion: reduce` is set, or WebGL is unavailable THEN the UI SHALL show a pre-rendered still for the current status instead of the 3D scene.
5. The scene SHALL use no third-party trademarks or logos.

## Requirement 8: Access, cost and availability

**User story:** As the entrant, I want the hosted lab free, safe and online until judging ends, so that I meet the rules without surprise bills.

### Acceptance criteria
1. The hosted lab SHALL be reachable without login until at least 29 January 2027 13:00 PT.
2. The proof API SHALL accept only known program and mutant identifiers and an optional integer seed, and SHALL reject anything else with HTTP 400.
3. The proof API SHALL NOT call any LLM or other paid third-party API.
4. The proof API SHALL limit concurrent runs so that worst-case monthly cost stays under USD 20, and an AWS budget alert SHALL fire at USD 10.
5. All infrastructure SHALL be defined in code.

## Requirement 9: Accessibility and performance

### Acceptance criteria
1. All 2D UI SHALL meet WCAG 2.2 AA: 4.5:1 text contrast, full keyboard operation, visible focus.
2. WHEN status changes THEN the UI SHALL announce it through a polite live region; progress counters SHALL be announced no more than once every 5 seconds.
3. Largest Contentful Paint SHALL be under 2.5 s on a mid-range laptop over a fast 4G profile, with initial JavaScript under 200 KB gzipped (3D excluded, it loads later).
4. The 3D scene SHALL hold 60 fps on a mid-range laptop and its assets SHALL total under 8 MB.

## Open decisions
- AWS region for the proof API (default proposal: eu-west-2, London).
- Custom domain, or the CloudFront default domain.
