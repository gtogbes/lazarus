# Product: Lazarus

## Problem
Banks, insurers and governments still run COBOL batch programs that few people
can maintain. Rewrites fail because the new system behaves slightly differently
from the old one in ways nobody wrote down (rounding, truncation, field overflow).

## What Lazarus does
Ports a COBOL batch program to TypeScript and proves behavioural equivalence by
running both on generated inputs and diffing outputs.

## Audience
Engineers and modernisation teams who must replace legacy code without changing
its behaviour. Secondary: hackathon judges, who need to see it work in under 3 minutes.

## Scope (hackathon)
- In: COBOL batch programs only (file or stdin in, file or stdout out), via GnuCOBOL.
- In: a fixed set of 4-5 sample programs (interest, payroll, invoice totals).
- Out: CICS/screen programs, embedded SQL, JCL, other legacy languages.

## Differentiation
Kiroween 2025 already had several COBOL-to-modern translators (for example
PunchRevive, COBRA, CodePhoenix). Translation alone is not novel. Lazarus's
claim is proof: it executes the original binary and shows, with generated
inputs, that the port behaves identically. Every feature should strengthen
that claim; cut anything that is "just another translator".

## Constraints from the official rules
- The hosted demo must stay up, free and unrestricted until the end of judging
  (29 January 2027). No live LLM calls that judges can trigger at our cost;
  the hosted app replays pre-generated ports and runs the harness live.
- All sample COBOL programs, assets and audio are our own work or CC0, with no
  third-party trademarks. Pre-existing code beyond libraries must be disclosed.
- Judges may rely only on the video, description and images, so pre-rendered
  stills and the README must tell the full story without running anything.

## Principles
- The original COBOL output is the source of truth. If the port differs, the port is wrong,
  even when the COBOL behaviour looks like a bug.
- Every divergence is shown with a minimal reproducing input.
- Theme is a "reanimation lab", but the UI must stay readable and accessible (WCAG 2.2 AA).
