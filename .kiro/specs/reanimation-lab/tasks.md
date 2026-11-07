# Tasks: Reanimation lab

Target dates are working targets for a solo build (deadline 4 Dec 2026, 14:00 PT).

## Phase 1: Harness support for the UI (by 9 Nov)
- [ ] 1. Spike: Lambda response streaming from a Debian bookworm image with the Node runtime interface client, running one INTCALC proof
  - Decides streaming vs buffered fallback before any UI depends on it
  - _Requirements: 3.1, 3.2_
- [ ] 2. Record layouts `src/ports/<prog>.layout.ts` for all three programs, with a decode function and unit tests
  - _Requirements: 5.1, 5.2_
- [ ] 3. Mutants `src/ports/<prog>.mutants.ts` (at least 2 per program, including the equivalent `<=` band-edge mutant) and `mutants.test.ts`
  - _Requirements: 4.1, 4.4, 4.5_
- [ ] 4. `src/ports/registry.ts` allowlist of programs, ports, layouts and mutants
  - _Requirements: 8.2_
- [ ] 5. Native runner option in `CobolSession`
  - _Requirements: 3.1_
- [ ] 6. `src/api/prove.ts` with validation, 4 Hz progress, 25 s cap, cancellation; unit tests
  - _Requirements: 3.1, 3.2, 3.5, 3.6, 8.2, 8.3_
- [ ] 7. `src/api/dev-server.ts` for local development
  - _Requirements: 3.1_

## Phase 2: 2D lab (by 18 Nov)
- [ ] 8. Scaffold `web/` (Vite, React 19, TypeScript strict, Tailwind 4, React Router, Zustand, Vitest + RTL), npm workspace, dev proxy to the dev server
- [ ] 9. Morgue view
  - _Requirements: 1.1-1.4_
- [ ] 10. Program view: Shiki-highlighted panes, responsive stacking, statement linking build step
  - _Requirements: 2.1-2.4_
- [ ] 11. `useProofRun` store, NDJSON client with SHA-256 header, Prove flow with live counters and cancel
  - _Requirements: 3.2-3.5, 9.2_
- [ ] 12. Sabotage panel with mutant diff
  - _Requirements: 4.1-4.4_
- [ ] 13. Counterexample card
  - _Requirements: 5.1-5.4_
- [ ] 14. `scripts/record-proofs.ts` and recorded fallback in the UI
  - _Requirements: 6.1-6.3_
- [ ] 15. Playwright happy path: PAYROLL prove, sabotage, counterexample
  - _Requirements: 3, 4, 5_

## Phase 3: Lab scene (by 25 Nov, 5-day budget)
- [ ] 16. Placeholder R3F scene, lazy-loaded, driven by `useProofRun` status
  - _Requirements: 7.1-7.3_
- [ ] 17. Reduced-motion and no-WebGL stills
  - _Requirements: 7.4_
- [ ] 18. Blender hero scene (owner): model, bake lighting, export Draco/KTX2 GLB under 8 MB, render four Cycles stills
  - _Requirements: 7.3-7.5, 9.4_
- [ ] 19. Swap placeholder for GLB, add bloom and grain, check 60 fps
  - _Requirements: 7.1-7.3, 9.4_

## Phase 4: Ship (by 30 Nov)
- [ ] 20. `docker/lambda/Dockerfile` using the same pinned GnuCOBOL as the reference, with the COBOL binaries baked in
  - _Requirements: 3.1_
- [ ] 21. CDK `SiteStack` and `ProofApiStack`, budget alert, tags; `cdk diff` reviewed with the owner
  - _Requirements: 8.1, 8.4, 8.5_
- [ ] 22. Deploy after owner approval; smoke test live prove, sabotage and recorded fallback
  - _Requirements: 8.1_
- [ ] 23. Accessibility and performance pass: axe, keyboard, VoiceOver, Lighthouse budget
  - _Requirements: 9.1-9.4_
