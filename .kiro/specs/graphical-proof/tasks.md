# Implementation Plan: Graphical proof and demo mode

## Overview
Target dates are working targets for a solo build, 7 days a week, from
Thursday 12 Nov 2026 (date of the last commit, `efe3a1e`). The deadline is
4 Dec 2026, 14:00 PT (22:00 GMT). Order: data changes first, then the three
hero visuals, then the simpler visuals, demo mode, video capture, and an
accessibility and performance pass. The AWS deploy (reanimation-lab task 22)
follows once this is built.

Tests are normal sub-tasks, not optional: the requirements make them part of
the scope (Requirements 14 to 16 and the owner's testing constraints). Each
property test runs at least 100 iterations and carries the tag
`// Feature: graphical-proof, Property N: <title>`.

**Schedule risk.** The build tasks fill 12 Nov to 1 Dec with no slack. The
deploy, the owner's video edit and the submission then take 2 to 4 Dec. One
lost day pushes the video edit onto the deadline. If Phase 2 is not done by
22 Nov, cut in this order:
1. Output and working-storage field stitches. Keep input-field stitches and
   statement stitches (task 9.2 rules 4 and 5, about 1 day).
2. The Resurrection fill (task 13, about half a day). The shock pulse moves to
   the case grid's border.
3. The animated shrink. Ship the stepwise list for everyone (task 8.3
   animation, about 1 day).
4. Automated shot-list window checks (task 21.2, about half a day). Check
   the windows by eye instead.
5. The Digit inspector (task 15, about 1 day). Keep the Autopsy diff.

Do not cut Phase 1, demo mode, the Recorded and slow-motion labels, or the
accessibility work.

## Tasks

### Phase 1: Data for the visuals (by 15 Nov)

- [x] 1. Harness phases and shrink path (by 13 Nov)
  - [x] 1.1 Add `cases` and `phase` to `Progress`, add `ShrinkStep` and `ShrinkPath` and `EquivalenceResult.shrinkPath?` in `src/harness/equivalence.types.ts`; add pure `nextProgress` in `src/harness/progress.ts` and use it in `checkEquivalence`
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 1.2 Property test for progress accounting in `src/harness/progress.test.ts`
    - **Property 1: Progress accounting**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
  - [x] 1.3 Add import-free `src/harness/shrinkPath.ts` (`ShrinkRecorder` bounded at 2,048, `sampleShrinkPath` with 24 steps and 16 KiB, `validateShrinkPath`); record `{ records, line }` on each divergence in `checkEquivalence` and attach `shrinkPath` to diverged results, truncated ones included
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [x] 1.4 Property test for sampling and the recorder bound in `src/harness/shrinkPath.test.ts`
    - **Property 5: Shrink path sampling keeps the story within caps**
    - **Validates: Requirements 2.2, 2.3, 2.5, 13.4**
  - [x] 1.5 Property test comparing the recorded path with `details.failures`, using a fake COBOL session, in `src/harness/equivalence.shrinkPath.test.ts`
    - **Property 4: The recorded shrink path is fast-check's failure list**
    - **Validates: Requirements 2.1, 2.4**

- [x] 2. Proof API events (by 14 Nov)
  - [x] 2.1 Add `cases` and `phase` to the `progress` event in `src/api/events.ts`; emit them from `prove` and add `ProveOptions.progressIntervalMs` (default 250, not reachable from HTTP) in `src/api/prove.ts`
    - _Requirements: 1.4, 1.5, 1.6, 2.7_
  - [x] 2.2 Extend `prove.test.ts`, `lambda.test.ts` and `dev-server.test.ts`: new fields on every progress event, final progress equals result cases, 4 Hz default unchanged, partial Shrink_Path when aborted mid-shrink
    - _Requirements: 1.4, 1.5, 1.9, 2.6, 2.7_

- [x] 3. Web client validation and store (by 14 Nov)
  - [x] 3.1 Parse `cases`, `phase` and `shrinkPath` in `web/src/features/proof/proveEvent.ts`; reject invalid progress fields; drop an invalid Shrink_Path through `validateShrinkPath` and keep the result
    - _Requirements: 1.7, 2.8, 16.3_
  - [x] 3.2 Add pure `web/src/features/proof/progressModel.ts` (cross-event checks, legacy derivation, `finalizeProgress`) and the `cases` and `phase` fields in `useProofRun.ts`
    - _Requirements: 1.7, 1.8_
  - [x] 3.3 Property test for rejecting invalid progress fields in `progressModel.test.ts`
    - **Property 3: Invalid progress fields are rejected**
    - **Validates: Requirements 1.7, 16.3**
  - [x] 3.4 Property test for legacy derivation in `progressModel.test.ts`
    - **Property 2: Legacy progress derivation**
    - **Validates: Requirements 1.8, 3.5**
  - [x] 3.5 Property test for the result round trip and dropping a corrupt path in `proveEvent.test.ts`
    - **Property 6: Result round trip, and a corrupt path is dropped**
    - **Validates: Requirements 2.8, 16.3**

- [x] 4. Recording version 2 (by 15 Nov)
  - [x] 4.1 Accept versions 1 and 2 in `web/src/features/proof/recording.ts` (version 2 requires the new fields); copy today's `PAYROLL.half-up-tax.json` into the tests as the version 1 fixture
    - _Requirements: 3.4, 3.5, 3.6, 3.7_
  - [x] 4.2 Switch `scripts/record-proofs.ts` to version 2 with `progressIntervalMs: 20`, the client checks and the 500-event limit; re-record all 10 files in `web/public/recorded/` with the docker runner
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 4.3 Property test for the recording round trip in `recording.test.ts`
    - **Property 7: Recording round trip for both versions**
    - **Validates: Requirements 3.4, 3.6**
  - [x] 4.4 Extend `scripts/record-proofs.test.ts`: version 2 output, the 20 ms interval, rejection over 500 events and of bad phase or path data
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Checkpoint: ensure all tests pass, ask the user if questions arise

### Phase 2: Hero visuals (by 22 Nov)

- [x] 6. Visual foundations (by 16 Nov)
  - [x] 6.1 Add `web/src/features/vitals/palette.ts` with a contrast test (4.5:1 text, 3:1 graphics), `frameLoop.ts` (one rAF loop reading `useProofRun.getState()`, stops when idle or off-screen) and `pulseGate.ts`
    - _Requirements: 14.1, 14.2, 15.3, 15.4_
  - [x] 6.2 Property test for the flash gate in `pulseGate.test.ts`
    - **Property 18: Pulses stay under the flash limit**
    - **Validates: Requirements 14.5, 10.3**
  - [x] 6.3 Add `VitalsPanel.tsx` under the Prove panel in `ProgramPage.tsx` (lazy program chunk), subscribing only to `status`, `program` and `run`
    - _Requirements: 15.1, 15.3_

- [x] 7. ECG heartbeat strip (by 17 Nov)
  - [x] 7.1 Add pure `scheduleBeats` in `web/src/features/vitals/beats.ts` (one tick per 500 ms of display time, batch = cases since the last tick)
    - _Requirements: 4.1, 4.2, 4.6_
  - [x] 7.2 Property test for beats in `beats.test.ts`
    - **Property 8: Beats conserve cases and respect the rate limit**
    - **Validates: Requirements 4.1, 4.2, 4.6**
  - [x] 7.3 Build `Heartbeat.tsx`: canvas trace, ref-updated ✓/✗/neutral label, 1 Hz alarm, flatline on `shrinking` or Relapsed, steady trace on Alive, static strip under Reduced_Motion, `aria-hidden`
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 14.3, 14.4, 14.5_
  - [x] 7.4 RTL tests for `Heartbeat`: label per status, reduced-motion form, `aria-hidden`, and a `Profiler` render count unchanged across 20 progress updates
    - _Requirements: 4.3, 4.4, 4.5, 4.7, 15.3_

- [x] 8. Shrinking animation (by 19 Nov)
  - [x] 8.1 Add pure `shrinkSteps` and `stepTimings` in `web/src/features/counterexample/shrinkSteps.ts`
    - _Requirements: 5.1, 5.2, 5.5_
  - [x] 8.2 Property test for shrink steps in `shrinkSteps.test.ts`
    - **Property 9: Shrink steps show real changes within 10 s**
    - **Validates: Requirements 5.1, 5.2, 5.5**
  - [x] 8.3 Build `ShrinkViewer.tsx` in the counterexample card: animated record row, "step k of N", dropped-steps text, play/pause/previous/next/replay controls, the ordered step list (Reduced_Motion and assistive technology), the no-path message
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 13.4, 14.3, 14.4_
  - [x] 8.4 RTL tests for `ShrinkViewer`: labels, keyboard controls, reduced-motion list, the version 1 (no path) case
    - _Requirements: 5.3, 5.4, 5.6, 5.7_

- [x] 9. Field map build step (by 20 Nov)
  - [x] 9.1 Add `parseNumericPicture` to `src/semantics/layout.ts` (embedded sign and COMP-3 working-storage PICs) with unit tests
    - _Requirements: 6.1, 6.2_
  - [x] 9.2 Add `web/build/fieldLinks.ts` (DATA DIVISION parse, layout check, input slices, output array elements, `PICS` entries by name or comment), list COBOL names in the `PICS` comments of `intcalc.ts` (`newBalance`) and `invoice.ts` (`amount`), call it from `programSources.ts` and add `fields` to `ProgramSource`
    - _Requirements: 6.1, 6.2, 6.8_
  - [x] 9.3 Property test for completeness on generated consistent sources in `fieldLinks.test.ts`
    - **Property 10: Field map is complete for consistent sources**
    - **Validates: Requirements 6.1**
  - [x] 9.4 Property test for detecting perturbations in `fieldLinks.test.ts`
    - **Property 11: Field map catches every broken mapping**
    - **Validates: Requirements 6.2**
  - [x] 9.5 Example tests in `programSources.test.ts`: INTCALC, PAYROLL and INVOICE link with the expected field counts; a broken mapping fails `buildStart`
    - _Requirements: 6.1, 6.2_

- [x] 10. Stitch lines (by 22 Nov)
  - [x] 10.1 Add pure `stitchPath` and visibility clipping in `web/src/features/stitches/geometry.ts` with unit tests
    - _Requirements: 6.3_
  - [x] 10.2 Add `data-line` and hover handlers in `CodePane.tsx`; build `FieldStitches.tsx` (listbox with roving tabindex, Enter, Escape, details text, stacked-pane buttons that switch tab and focus the line) and host it in `SourcePanes.tsx`
    - _Requirements: 6.4, 6.6, 6.7, 14.7_
  - [x] 10.3 Build `StitchOverlay.tsx`: `aria-hidden` SVG over the side-by-side panes, paths set through refs in the frame loop on scroll and resize, active stitch at 3:1 or more, a stitch for the active statement link
    - _Requirements: 6.3, 6.5, 14.2, 14.4, 15.3_
  - [x] 10.4 RTL tests for `FieldStitches` and `StitchOverlay`: keyboard model, details text, stacked behaviour, statement-link stitch
    - _Requirements: 6.4, 6.5, 6.6, 6.7_

- [x] 11. Checkpoint: ensure all tests pass, ask the user if questions arise

### Phase 3: Simpler visuals (by 26 Nov)

- [x] 12. Case grid (by 23 Nov)
  - [x] 12.1 Add pure `cellStates` in `web/src/features/vitals/cells.ts`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 12.2 Property test for cell states in `cells.test.ts`
    - **Property 12: Case grid cells match the counts**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 13.2**
  - [x] 12.3 Build `CaseGrid.tsx`: canvas of numRuns cells with incremental fill, outlined failing cell, text legend and caption with counts and the "every earlier case passed" note, truncation text, redraw on status only under Reduced_Motion
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 13.1, 14.1_
  - [x] 12.4 RTL tests for `CaseGrid`: caption per status, truncated run, reduced-motion redraws
    - _Requirements: 7.4, 7.5, 7.6_

- [x] 13. Resurrection fill (by 23 Nov)
  - [x] 13.1 Add pure `fillFraction` and `fillText` in `web/src/features/vitals/fill.ts`
    - _Requirements: 8.1, 8.2_
  - [x] 13.2 Property test for the fill in `fill.test.ts`
    - **Property 13: Fill shows 100% only when all passed**
    - **Validates: Requirements 8.1, 8.2**
  - [x] 13.3 Build `ResurrectionFill.tsx` (own SVG slab silhouette, `clipPath` set through a ref, text label, Relapsed ✗ state) and the `shock` keyframes in `index.css`
    - _Requirements: 8.1, 8.3, 14.1_
  - [x] 13.4 RTL tests for `ResurrectionFill`: text per status, Relapsed label
    - _Requirements: 8.1, 8.3_

- [x] 14. Autopsy diff (by 24 Nov)
  - [x] 14.1 Add pure positional `charDiff` in `web/src/features/counterexample/charDiff.ts`
    - _Requirements: 9.1_
  - [x] 14.2 Property test for the character diff in `charDiff.test.ts`
    - **Property 14: Character diff round trip**
    - **Validates: Requirements 9.1**
  - [x] 14.3 Add pure `digitBoxes` (`digitBoxes.ts`) and `firstDifference` (`fieldDifference.ts`)
    - _Requirements: 9.5, 9.6, 9.7, 9.8_
  - [x] 14.4 Property test for digit boxes in `digitBoxes.test.ts`
    - **Property 15: Digit boxes follow the PIC**
    - **Validates: Requirements 9.6, 9.8**
  - [x] 14.5 Property test for difference classes in `fieldDifference.test.ts`
    - **Property 16: The first difference is classified by its position**
    - **Validates: Requirements 9.5, 9.7**
  - [x] 14.6 Build `AutopsyDiff.tsx` in `CounterexampleCard.tsx`: aligned character rows with column ruler, outline and `^` markers, the mutant explanation or the real-port cause, a first-difference line per field; move the record tables into a `details`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.9, 14.1_

- [x] 15. Digit inspector (by 25 Nov)
  - [x] 15.1 Build `DigitInspector.tsx` in the counterexample card: field picker (first differing numeric field by default), COBOL and port boxes as a captioned table, ✗ on differing boxes, high-order note, invalid-field form
    - _Requirements: 9.6, 9.7, 9.8, 9.9, 14.4_
  - [x] 15.2 RTL tests for `AutopsyDiff` and `DigitInspector`: markers in text, both causes, high-order note, invalid field
    - _Requirements: 9.2, 9.3, 9.4, 9.7, 9.8_

- [x] 16. Revival (by 26 Nov)
  - [x] 16.1 Add `revive()` and the `revive` state to `useProofRun.ts` (live first, recorded only if the live run fails; recorded in Demo_Mode) and a "Revive" button in `ProvePanel.tsx` after a relapsed mutant run
    - _Requirements: 10.1, 10.2, 10.4_
  - [x] 16.2 Play the shock pulse on `ResurrectionFill` through `pulseGate`; add `revive()` to `sceneNudge.ts` and `withRevive` to `sceneLook.ts`, read in `LabScene.tsx`; static "Revived ✓" under Reduced_Motion
    - _Requirements: 10.3, 10.5, 14.3, 14.5_
  - [x] 16.3 Tests: store `revive` (live and recorded), RTL for the button and pulse, `sceneLook.test.ts` for `withRevive` (under 3 s, one rise and fall)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 17. Checkpoint: ensure all tests pass, ask the user if questions arise

### Phase 4: Demo mode (by 28 Nov)

- [x] 18. Playback clock (by 27 Nov)
  - [x] 18.1 Add `web/src/features/proof/playbackClock.ts`; let `replayRecorded(target?, { rate, clock })` replay an explicit target at a rate (defaults keep reanimation-lab Requirement 6 unchanged); make `frameLoop.ts` read display time from the active clock
    - _Requirements: 11.7, 13.5_
  - [x] 18.2 Property test for the playback clock in `playbackClock.test.ts`
    - **Property 17: Playback clock keeps recorded times and pauses exactly**
    - **Validates: Requirements 11.7, 13.5**

- [x] 19. Demo mode (by 28 Nov)
  - [x] 19.1 Add `web/src/features/demo/demoScript.ts` (fixed steps, per-step rate, 130 s total) and `useDemo.ts` (run, pause, resume, skip, exit, stop on a bad recording)
    - _Requirements: 11.2, 11.3, 11.7, 11.8, 11.11, 11.12, 16.4_
  - [x] 19.2 Build `DemoBar.tsx` (labels, rate text, caption, controls, `data-demo-step`), `DemoButton.tsx` on the landing page and the morgue, `?demo=1` handling in `ProgramPage.tsx`, and step captions through the existing `ProofAnnouncer`
    - _Requirements: 11.1, 11.4, 11.5, 11.6, 11.8, 11.9, 11.10, 13.3, 14.6_
  - [x] 19.3 Tests: `demoScript.test.ts` (known recordings only, each replay fits its step, total 130 s ± 5 s) and RTL for `DemoBar` (labels, pause with fake timers, skip, exit focus, captions)
    - _Requirements: 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.12_
  - [x] 19.4 Playwright `web/e2e/demo.spec.ts`: the full story with `/api/prove` set to fail the test if called, at 1920×1080 and 390×844, with Reduced_Motion on and off
    - _Requirements: 11.2, 11.3, 11.4, 11.6, 11.10, 13.3_

- [x] 20. Checkpoint: ensure all tests pass, ask the user if questions arise

### Phase 5: Video capture (by 30 Nov)

- [x] 21. Capture script (by 29 Nov)
  - [x] 21.1 Add `web/video/playwright.config.ts` and `capture.spec.ts` (production build through `e2e-csp/serve-dist.ts`, 1920×1080, scale 1, video, PNG per beat), `data-demo-beat` markers in the demo and visuals, and `npm run video:capture -w web`; check Playwright video quality first and note the headed screen-recording fallback in the script header
    - _Requirements: 12.1, 12.2, 12.8_
  - [x] 21.2 Add pure `web/video/shotList.ts` (`checkBeats`, target windows, placeholder segments, JSON and Markdown writers) with unit tests; the capture exits non-zero naming any out-of-window beat
    - _Requirements: 12.3, 12.4, 12.5, 12.6_

- [x] 22. Demo documents (by 30 Nov)
  - [x] 22.1 Write `docs/demo/narration.md` (narration draft timed to the shot list beats, numbers matching the recordings) and `docs/demo/licenses.md` (template table for music, voice and art)
    - _Requirements: 12.7_

### Phase 6: Accessibility and performance pass (by 1 Dec)

- [x] 23. Accessibility, security and performance checks (by 1 Dec)
  - [x] 23.1 Extend `axe.spec.ts`, `keyboard.spec.ts`, `live-region.spec.ts`, `full-ui.spec.ts` and `stills.spec.ts` to the new states; keep the deprecation-warning fixture; run the e2e-csp suite
    - _Requirements: 14.1, 14.3, 14.4, 14.6, 14.7, 16.2_
  - [x] 23.2 Add a guard test that fails on `dangerouslySetInnerHTML` or `innerHTML` in `web/src`
    - _Requirements: 16.1_
  - [x] 23.3 Assert the initial JS and entry budgets in `perf/lighthouse.ts`; add `perf/vitals.perf.ts` (average 55 fps or more, no long task over 50 ms during the demo's `prove-real` step with the scene); confirm no new runtime dependency in `web/package.json`
    - _Requirements: 15.1, 15.2, 15.5_

- [x] 24. Final checkpoint: ensure all tests pass, ask the user if questions arise

## Notes
- After task 24 (not coding tasks, so not listed above):
  - 2 Dec: reanimation-lab task 22. `cdk diff`, owner approval, deploy, and a
    smoke test that also runs the demo on the hosted URL.
  - 2 to 3 Dec: the owner records the voiceover, adds music, edits the video
    and makes the cover art.
  - 4 Dec, before 14:00 PT: submit.
- Task 4.2 needs Docker and the `lazarus-gnucobol:3.1.2` image. It rewrites the
  10 files in `web/public/recorded/`. The demo durations in task 19.1 depend on
  those files.
- Task 9.2 edits comments in two ports. The equivalence-on-save hook re-proves
  them.
- Task 23.3's frame-rate check runs on the owner's laptop, the reference
  mid-range machine.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "6.1", "9.1", "10.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "6.2", "7.1", "8.1", "12.1", "13.1", "14.1"] },
    { "id": 2, "tasks": ["1.4", "1.5", "2.1", "7.2", "8.2", "12.2", "13.2", "14.2", "14.3"] },
    { "id": 3, "tasks": ["2.2", "3.1", "9.2", "14.4"] },
    { "id": 4, "tasks": ["3.2", "3.5", "9.3", "9.5", "14.5"] },
    { "id": 5, "tasks": ["3.3", "4.1", "6.3", "9.4"] },
    { "id": 6, "tasks": ["3.4", "4.2", "7.3"] },
    { "id": 7, "tasks": ["4.3", "4.4", "7.4", "8.3", "10.2"] },
    { "id": 8, "tasks": ["8.4", "10.3", "12.3", "14.6"] },
    { "id": 9, "tasks": ["10.4", "12.4", "13.3", "15.1"] },
    { "id": 10, "tasks": ["13.4", "15.2", "16.1"] },
    { "id": 11, "tasks": ["16.2", "18.1"] },
    { "id": 12, "tasks": ["16.3", "18.2", "19.1"] },
    { "id": 13, "tasks": ["19.2"] },
    { "id": 14, "tasks": ["19.3", "21.1", "22.1"] },
    { "id": 15, "tasks": ["19.4", "21.2"] },
    { "id": 16, "tasks": ["23.1", "23.2", "23.3"] }
  ]
}
```
