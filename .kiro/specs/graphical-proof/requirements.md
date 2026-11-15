# Requirements Document

Graphical proof and demo mode (`graphical-proof`).

## Introduction
The reanimation lab already proves a port against GnuCOBOL 3.1.2 and reports
the result as counters, a status and a counterexample table
(`.kiro/specs/reanimation-lab/`). A judge watching the video with the sound off
cannot easily follow that. This spec makes the proof graphical, with three
hero visuals (an ECG heartbeat strip, a shrinking animation, and stitch lines
between the code panes) and four simpler ones (a case grid, a resurrection
fill, an autopsy diff with a digit inspector, and a revive action). It adds a
scripted demo mode that replays recorded proofs, and a capture script that
records the demo for the 3-minute video.

The reanimation-lab requirements still hold. Where this spec changes one of
them, it says so. The live proof API is unchanged in what it runs: 2,000 cases
chosen by the server, a 25 s cap, NDJSON at 4 Hz.

Measured facts that shape these requirements (from `web/public/recorded/`,
recorded 9 Nov 2026 with the docker runner):
- A full 2,000-case proof of a real port takes 0.54 to 0.68 s and yields 3
  progress snapshots at 4 Hz.
- The mutants diverge at case 1 to 86 and then shrink in 16 to 244 steps.
- Progress `executions` counts shrink attempts too (PAYROLL half-up-tax: 1 case,
  139 executions).

## Glossary
- **Case**: one generated input (1 to 10 records) run through COBOL and the port before any divergence. The first failing input is the last case.
- **Shrink attempt**: an execution fast-check makes after the first divergence to find a smaller failing input. Not a case.
- **Phase**: `generating` (running cases) or `shrinking` (running shrink attempts).
- **Shrink_Path**: the ordered failing inputs fast-check reaches while shrinking, from the first failure (step 0) to the final counterexample, stored with caps.
- **Harness**: `checkEquivalence` in `src/harness/equivalence.ts`.
- **Proof_API**: `prove` in `src/api/prove.ts` and its transports (`lambda.ts`, `dev-server.ts`).
- **Web_Client**: the event and recording validation and the `useProofRun` store in `web/src/features/proof/`.
- **Recording**: a file in `web/public/recorded/`. Version 1 is the current format; version 2 adds phase, case counts and the Shrink_Path.
- **Record_Script**: `scripts/record-proofs.ts`.
- **Visuals**: the Heartbeat, Case_Grid, Resurrection_Fill, Shrink_Viewer, Stitch_Overlay, Autopsy and Digit_Inspector together.
- **Heartbeat**: the ECG strip that beats while cases match and flatlines at a divergence.
- **Shrink_Viewer**: the view that shows the first failing input collapsing to the minimal reproducer.
- **Field_Map**: build-time links between COBOL data items and the port code that represents them.
- **Stitch_Overlay**: SVG lines drawn over the existing Shiki code panes, joining COBOL fields and statements to the port.
- **Case_Grid**: one cell per case the server runs.
- **Resurrection_Fill**: a slab silhouette that fills from grey to lit with cases passed.
- **Autopsy**: the character-level diff of the COBOL and port output records, with a plain-English cause.
- **Digit_Inspector**: one output field drawn as digit boxes from its PIC.
- **Program_View**: `/program/:id` (reanimation-lab Requirement 2).
- **Demo_Mode**: the scripted replay of a fixed story from recorded proofs.
- **Playback_Rate**: how fast Demo_Mode replays a recording's progress, relative to the recorded pace. 1 is real time.
- **Capture_Script**: the Playwright script that drives Demo_Mode and records the video footage and screenshots.
- **Shot_List**: the Capture_Script's output listing each beat with its timestamp.
- **Reduced_Motion**: `prefers-reduced-motion: reduce`.

## Requirements

### Requirement 1: Proof phases and case counts

**User Story:** As a visitor, I want the proof to count cases separately from shrink attempts, so that every count I see is the number of inputs actually proved.

#### Acceptance Criteria
1. WHILE no divergence has been found, THE Harness SHALL report the phase `generating` and count every execution as a case.
2. WHEN the first divergence is found, THE Harness SHALL count that execution as the last case and switch the phase to `shrinking`.
3. WHILE the phase is `shrinking`, THE Harness SHALL count each execution as a shrink attempt and keep the case count unchanged.
4. THE Proof_API SHALL include `cases` and `phase` in every `progress` event, beside the existing `executions`, `divergences` and `elapsedMs`.
5. WHEN a proof finishes, THE Proof_API SHALL send a final `progress` event whose `cases` equals the result's `cases`.
6. THE Proof_API SHALL keep every existing event field with its current type and meaning, so that a client that ignores the new fields keeps working.
7. IF a `progress` event carries `cases` or `phase` and either is invalid (cases above executions or numRuns, cases decreasing, an unknown phase, or the phase returning to `generating`), THEN THE Web_Client SHALL reject the event as it rejects other invalid events.
8. IF a `progress` event carries neither `cases` nor `phase`, THEN THE Web_Client SHALL derive the phase as `shrinking` once divergences exceed 0, derive cases from executions while generating, and take the final case count from the result.
9. THE Lambda handler and the dev server SHALL emit the new fields.

### Requirement 2: Shrink path

**User Story:** As a modernisation engineer, I want to see the inputs the proof went through while shrinking, so that I trust the minimal reproducer was found and not invented.

#### Acceptance Criteria
1. WHEN a divergence is found, THE Harness SHALL record, in order, each failing input fast-check reaches, from the first failure to the final counterexample.
2. WHEN a result is diverged, THE Harness SHALL attach a Shrink_Path with the total step count (shrinks + 1) and at most 24 stored steps, each holding its step index, its input records and the index of its first differing record.
3. WHEN the recorded steps exceed 24, or their records exceed 16 KiB in UTF-8, THE Harness SHALL keep the final step, keep the first step, and drop evenly spaced intermediate steps until both caps hold; IF the final step alone exceeds 16 KiB, THEN THE Harness SHALL attach no Shrink_Path.
4. THE Harness SHALL store the final step with records equal to the counterexample's records.
5. WHILE recording a Shrink_Path, THE Harness SHALL hold at most 2,048 failing inputs in memory.
6. WHEN the 25 s cap stops shrinking, THE Harness SHALL attach the Shrink_Path reached so far to the truncated result.
7. THE Proof_API SHALL carry the Shrink_Path inside the existing `result` event.
8. IF a received Shrink_Path is invalid (over 24 steps or 16 KiB, step indices not strictly increasing from 0, last index not total minus 1, total not shrinks + 1, or last records not equal to the counterexample's), THEN THE Web_Client SHALL drop the Shrink_Path and keep the rest of the result.

### Requirement 3: Recording version 2 and compatibility

**User Story:** As a judge, I want recorded proofs to carry the same detail as live ones, so that the visuals and the demo work without the live service.

#### Acceptance Criteria
1. THE Record_Script SHALL write version 2 recordings, with `cases` and `phase` on every `progress` event and a Shrink_Path on every diverged result.
2. THE Record_Script SHALL capture progress every 20 ms, while the live Proof_API stays at 4 Hz.
3. IF a recording has more than 500 events, or its phase, case or Shrink_Path data fails the Web_Client checks, THEN THE Record_Script SHALL not write the recording and SHALL exit non-zero.
4. THE Web_Client SHALL replay version 1 and version 2 recordings.
5. WHEN a version 1 recording is replayed, THE Visuals SHALL use the derived phase and case counts from Requirement 1.8.
6. IF a recording has a version other than 1 or 2, THEN THE Web_Client SHALL treat the recording as missing (reanimation-lab Requirement 6.1).
7. THE test suite SHALL keep a version 1 recording fixture and replay it through the Web_Client.

### Requirement 4: ECG heartbeat strip

**User Story:** As a judge watching without sound, I want a heartbeat that beats while cases match and flatlines at a divergence, so that I can tell at a glance whether the port is alive.

#### Acceptance Criteria
1. WHILE a proof is in the `generating` phase, THE Heartbeat SHALL draw one beat every 500 ms for the cases completed since the previous beat, with a ✓ label giving the cases matched so far.
2. WHEN no case completes during a 500 ms interval in the `generating` phase, THE Heartbeat SHALL draw that interval without a beat.
3. WHEN the phase becomes `shrinking` or the status becomes Relapsed, THE Heartbeat SHALL flatline, show an alarm, and show a ✗ label with the number of the case that diverged.
4. WHEN the status becomes Alive, THE Heartbeat SHALL show a steady trace and a ✓ label with the result's cases and numRuns (for example "✓ 2,000 / 2,000 matched").
5. WHEN the status becomes error or cancelled, THE Heartbeat SHALL stop on a neutral trace with a text label and no alarm.
6. THE Heartbeat SHALL draw at most 2 beats per second and pulse the alarm at 1 Hz.
7. WHERE Reduced_Motion is set, THE Heartbeat SHALL show a static strip for the current state with its label.

### Requirement 5: Shrinking animation

**User Story:** As a judge, I want to watch the failing input collapse to the smallest one that still fails, so that I understand what shrinking means without being told.

#### Acceptance Criteria
1. WHEN a diverged result has a Shrink_Path, THE Shrink_Viewer SHALL show the stored steps in order, each as its first differing record decoded into named fields with the program's input layout.
2. WHEN the Shrink_Viewer moves to the next step, THE Shrink_Viewer SHALL animate each changed field from its old value to its new value, one field at a time, and show the step's record count.
3. THE Shrink_Viewer SHALL label each step "step k of N" with the real step index and total, and SHALL say how many steps are shown when steps were dropped.
4. THE Shrink_Viewer SHALL provide play, pause, previous step, next step and replay controls, operable by keyboard.
5. THE Shrink_Viewer SHALL finish playing all stored steps within 10 s.
6. WHERE Reduced_Motion is set, THE Shrink_Viewer SHALL show all stored steps as an ordered list, with changed fields marked in text.
7. IF a diverged result has no Shrink_Path, THEN THE Shrink_Viewer SHALL show the final counterexample and say that no shrink path was recorded.

### Requirement 6: Stitch lines between the code panes

**User Story:** As a modernisation engineer, I want lines joining each COBOL field and statement to the port code that represents it, with the PIC and the TypeScript type, so that I can check the translation field by field.

#### Acceptance Criteria
1. THE build SHALL derive a Field_Map for each program: input layout fields to the port's `record.slice(offset, offset + length)` reads, output layout fields to the elements of the port's returned array in order, and numeric WORKING-STORAGE items to `PICS` entries by name or by the COBOL names listed in the entry's comment.
2. IF a layout field differs from the COBOL FD item at the same position, a non-FILLER input or output field has no matching port code, a `PICS` entry maps to no COBOL item, or a `PICS` entry's `pic(...)` differs from a mapped item's PIC, THEN THE build SHALL fail and list every broken mapping.
3. WHILE the panes are side by side, THE Stitch_Overlay SHALL draw an SVG line between each mapped COBOL line and its port line when both are in view, and keep the lines aligned while either pane scrolls or resizes.
4. WHEN the user hovers or focuses a field stitch, THE Stitch_Overlay SHALL emphasise that stitch and show, as text, the PIC clause and the TypeScript representation (type, scale, range and the port code that reads or writes the field).
5. WHEN the user focuses a port statement with a statement link (reanimation-lab Requirement 2.2), THE Stitch_Overlay SHALL draw a line between the port statement and the COBOL statement.
6. THE Stitch_Overlay SHALL present the fields as one keyboard widget: one Tab stop, arrow keys to move between fields, Enter to reveal both lines, Escape to clear.
7. WHILE the panes are stacked, THE Stitch_Overlay SHALL show the field list and the selected field's COBOL line, port line and details as text, with controls that switch to either pane and focus the line.
8. THE Stitch_Overlay SHALL use the build-time Shiki tokens already shipped with each program.

### Requirement 7: Case grid

**User Story:** As a judge, I want to see 2,000 cells fill as cases pass, so that the size of the proof is visible.

#### Acceptance Criteria
1. THE Case_Grid SHALL draw one cell per case the server runs (numRuns from the `started` event).
2. WHILE a proof runs, THE Case_Grid SHALL mark cells green in order up to the cases passed, using the case count and not the executions.
3. WHEN a divergence is found, THE Case_Grid SHALL mark the cell of the failing case red with an ✗ and leave the later cells as not run.
4. WHEN a run is truncated, THE Case_Grid SHALL show the remaining cells as not run and state that the run stopped at the 25 s limit.
5. THE Case_Grid SHALL show a text legend and caption with the passed (✓), diverged (✗) and not run counts, and a note that fast-check stops at the first failing case, so every earlier case passed.
6. WHERE Reduced_Motion is set, THE Case_Grid SHALL redraw only on status changes, ending on the final state.

### Requirement 8: Resurrection fill

**User Story:** As a judge, I want a body on the slab that comes to life as cases pass, so that the theme shows the result.

#### Acceptance Criteria
1. THE Resurrection_Fill SHALL fill a slab silhouette from grey to lit in proportion to cases passed out of numRuns, and show "passed / numRuns cases passed (percent)" as text.
2. THE Resurrection_Fill SHALL round the percentage down to one decimal place, so that it shows 100% only when every case passed.
3. WHEN the status becomes Relapsed, THE Resurrection_Fill SHALL stop at the cases passed before the divergence and show a ✗ with the label "Relapsed".

### Requirement 9: Autopsy diff and digit inspector

**User Story:** As a modernisation engineer, I want to see exactly which characters and digits differ and why, so that I can fix the port.

#### Acceptance Criteria
1. WHEN a divergence is shown, THE Autopsy SHALL show the COBOL and port output records character by character, aligned by column, with column numbers and each differing character marked.
2. THE Autopsy SHALL mark each difference with an outline and a text marker in addition to colour.
3. WHEN the divergence came from a mutant, THE Autopsy SHALL show the mutant's explanation as the cause.
4. WHEN the divergence came from the real port, THE Autopsy SHALL state that the port's output differs from COBOL and that the COBOL output is the source of truth.
5. THE Autopsy SHALL name, for each differing field, the first place it differs: sign, high-order digits, low-order digits, decimal places, or text.
6. WHEN the user selects a differing numeric field, THE Digit_Inspector SHALL draw the field as boxes from its PIC (a sign box for a separate sign, one box per integer digit, a decimal point mark, one box per decimal digit), with the COBOL digits above the port digits and the differing boxes marked.
7. WHEN the differing digits include the leftmost integer digit, THE Digit_Inspector SHALL label the field as differing at its high-order limit and explain that COBOL drops digits on the left of a value too large for the PIC unless ON SIZE ERROR is coded.
8. IF a field's raw text does not fit its PIC, THEN THE Digit_Inspector SHALL show the raw characters in boxes and state that the field is not valid for its PIC.
9. THE Autopsy and the Digit_Inspector SHALL extend the existing counterexample card and use the layouts in `src/ports/*.layout.ts`.

### Requirement 10: Revival

**User Story:** As a visitor who sabotaged the port, I want one action that restores the real port and proves it, so that I see the patient come back.

#### Acceptance Criteria
1. WHEN a mutant run ends Relapsed, THE Program_View SHALL offer a "Revive" action.
2. WHEN the user chooses Revive, THE Program_View SHALL select "No sabotage" and prove the real port through the live Proof_API, also when the relapsed run was a recorded replay, and SHALL replay the recorded proof of the real port only if that live run fails (reanimation-lab Requirement 6.1). WHILE Demo_Mode runs, Revive SHALL replay the recording without calling the Proof_API (Requirement 11.3).
3. WHEN the run started by Revive ends Alive, THE Program_View SHALL play one green shock pulse on the Resurrection_Fill lasting under 1 s and send a revive event to the lab scene, which plays a revive mood lasting under 3 s.
4. IF the run started by Revive ends in any status other than Alive, THEN THE Program_View SHALL show that status as for any other run, with no shock pulse.
5. WHERE Reduced_Motion is set, THE Program_View SHALL show a static "Revived ✓" state in place of the pulse, and the scene SHALL show the Alive still.

### Requirement 11: Demo mode

**User Story:** As a judge, I want a "Run the demo" button that tells the whole story by itself, so that I can see Lazarus work even when the live service is busy.

#### Acceptance Criteria
1. THE hosted app SHALL offer a "Run the demo" button on the landing page and the morgue.
2. WHEN the demo runs, THE Demo_Mode SHALL play this story from recordings: open PAYROLL and show the stitches; prove the real port to Alive; select the half-up-tax mutant and prove it to Relapsed, with the flatline, shrinking, autopsy and digit inspector; revive to Alive.
3. THE Demo_Mode SHALL make no request to the Proof_API.
4. WHILE the demo runs, THE Demo_Mode SHALL show the "Recorded" label with each recording's date (reanimation-lab Requirement 6.2) and the label "Demo: recorded replay".
5. WHERE a Playback_Rate other than 1 is used, THE Demo_Mode SHALL show the rate and the recorded duration (for example "Slow motion, 1/20 speed. The real run took 0.55 s.").
6. THE Demo_Mode SHALL provide pause, resume, skip to the next step and exit controls, operable by keyboard with visible focus, and a visible caption for the current step.
7. WHILE the demo is paused, THE Demo_Mode SHALL hold the replay timers and the Visuals' animations, and resume from the same point.
8. WHEN the user exits the demo or leaves the page, THE Demo_Mode SHALL stop the replay, reset the proof state and move focus to the "Run the demo" button or the page heading.
9. WHEN the demo moves to a new step, THE Demo_Mode SHALL announce the step caption through the existing polite live region.
10. WHERE Reduced_Motion is set, THE Demo_Mode SHALL run the same steps with the static forms of the Visuals.
11. IF a recording the demo needs is missing or invalid, THEN THE Demo_Mode SHALL stop and name the recording that failed.
12. THE Demo_Mode SHALL run for 130 s ± 5 s at its default settings.

### Requirement 12: Scripted video capture

**User Story:** As the entrant, I want the demo footage captured by a script, so that I can re-shoot it after any fix and the footage always shows the real app.

#### Acceptance Criteria
1. THE Capture_Script SHALL run separately from the e2e suite, with its own config and npm script, and drive Demo_Mode against the production build at a 1920×1080 viewport with a device scale factor of 1.
2. THE Capture_Script SHALL record video of the run and save 1920×1080 screenshots at these beats: program and stitches, heartbeat mid-run, grid at Alive, flatline, shrinking mid-way, autopsy with digit inspector, revive pulse, and "2,000 / 2,000".
3. THE Capture_Script SHALL write a Shot_List in JSON and Markdown with each beat's timestamp in the footage, its time in the final cut (footage plus 20 s), and its target window: 0:20–0:50 program and stitches; 0:50–1:30 harness run with heartbeat and grid; 1:30–2:10 flatline, shrinking, autopsy and digit inspector; 2:10–2:30 revive and "2,000 / 2,000".
4. THE Shot_List SHALL list the segments made outside the app as placeholders: 0:00–0:20 title card, 2:30–2:50 Kiro files, 2:50–3:00 close.
5. IF a beat lands outside its target window, THEN THE Capture_Script SHALL exit non-zero and name the beat.
6. WHEN the Capture_Script runs twice against the same build, THE Capture_Script SHALL place every beat within 0.5 s of its time in the other run.
7. THE repository SHALL include `docs/demo/narration.md`, a narration draft timed to the Shot_List beats, and `docs/demo/licenses.md`, a template for music, voice and art licences.
8. THE Capture_Script SHALL capture only the running app, so that every frame of UI footage is the real app.

### Requirement 13: Honesty

**User Story:** As a judge, I want every number and replay to be truthful, so that I can trust the claim of proof.

#### Acceptance Criteria
1. THE Visuals SHALL show only numbers taken from the run's events or result (numRuns, cases, shrinks, executions, durationMs, seed).
2. THE Visuals SHALL show the case total the run used (2,000, or the cases reached when truncated).
3. WHILE a recorded proof is shown, in Demo_Mode or as the fallback, THE Program_View SHALL show the "Recorded" label with the recording date.
4. THE Shrink_Viewer SHALL show real step indices, including when steps were dropped.
5. THE Demo_Mode SHALL show elapsed times as recorded, independent of the Playback_Rate.

### Requirement 14: Accessibility

**User Story:** As a visitor using a screen reader, a keyboard or reduced motion, I want the same information as everyone else, so that the graphical proof excludes no one.

#### Acceptance Criteria
1. THE Visuals SHALL pair every colour state with an icon or text (✓, ✗, "not run", labels).
2. THE Visuals SHALL keep text contrast at 4.5:1 or more and graphical object contrast at 3:1 or more against adjacent colours.
3. WHERE Reduced_Motion is set, THE Visuals SHALL show static equivalents: no moving heartbeat, a grid drawn at status changes, a stepwise shrink list, and no shock pulse.
4. WHERE a visual repeats information already in text on the page, THE Visuals SHALL hide that visual from assistive technology; otherwise THE Visuals SHALL provide a text alternative.
5. THE Visuals and the lab scene SHALL produce no more than 3 flashes in any 1 s period, including the alarm, the heartbeat and the shock pulse.
6. THE Visuals SHALL add no live regions, so that the reanimation-lab Requirement 9.2 announcement rules hold, and Demo_Mode SHALL use only the existing polite live region.
7. THE new controls SHALL be operable by keyboard with visible focus, and axe SHALL report no violations for the new states.

### Requirement 15: Performance

**User Story:** As a visitor on a mid-range laptop, I want the visuals smooth and the first load fast, so that the lab feels solid.

#### Acceptance Criteria
1. THE web build SHALL keep initial JavaScript under 200 KB gzipped, with the entry growing by at most 5 KB gzipped and the Visuals and Demo_Mode controller in the lazy Program_View chunk.
2. WHILE a proof or replay runs with the Visuals and the lab scene shown, THE Program_View SHALL hold an average of at least 55 fps with no long task over 50 ms on a mid-range laptop.
3. WHILE progress events arrive, THE Heartbeat, Case_Grid and Resurrection_Fill SHALL draw from the store through refs in an animation frame loop, with no React re-render per progress event.
4. WHILE no visual is animating or the Visuals are out of view, THE Visuals SHALL stop their animation frame loop.
5. THE web app SHALL add no new runtime dependency unless the design records why it is needed.

### Requirement 16: Security

**User Story:** As the entrant, I want the new features to keep the current security posture, so that untrusted data cannot run code in a judge's browser.

#### Acceptance Criteria
1. THE Visuals SHALL render text through React or `textContent`, without `dangerouslySetInnerHTML` or `innerHTML`.
2. THE web app SHALL work under the current Content Security Policy, with no inline scripts and no `<style>` elements, and the e2e-csp suite SHALL pass with the new features.
3. THE Web_Client SHALL validate every new field from NDJSON and recordings and cap their sizes (Requirements 1.7 and 2.8).
4. THE Demo_Mode SHALL load only the same-origin recordings named in its script.

## Out of scope
- The coverage "organ map" (which COBOL paragraphs a proof exercised). It needs GnuCOBOL paragraph tracing (`cobc -ftrace`), which slows every run and adds trace parsing on Lambda. Future work.
- Monaco or any runtime code editor or highlighter.
- The title card, voiceover, music, editing and cover art. The owner makes these with external tools.
- Showing the exact value before truncation in the Digit_Inspector. It would need the harness to capture intermediate values.

## Decisions (resolved by the owner)
The owner approved this spec. The former open questions are resolved:
- Demo Playback_Rate: approved. 1/40 for the real-port and mutant proofs and 1/20 for the revive, always labelled (Requirement 11.5). At 1×, a 2,000-case proof is over in about 0.55 s.
- Revive: tries the live Proof_API first, and falls back to the recorded proof only if the live run fails, including after a recorded fallback (Requirement 10.2).
- Deploy: a dry-run deploy is approved. It happens outside this spec, once the owner's Lambda quota increase is approved.
