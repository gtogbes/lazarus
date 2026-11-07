# Repository structure

```
cobol/programs/   Original COBOL source (.cbl), one program per file
cobol/samples/    Synthetic sample inputs
src/harness/      Runs COBOL (Docker) and TypeScript ports, diffs outputs
src/ports/        One TypeScript module per COBOL program, same base name
src/semantics/    Shared COBOL numeric helpers (PIC parsing, truncation, rounding)
web/              Reanimation lab UI
.kiro/            Steering, specs and hooks. Must stay committed.
```

- A port lives at `src/ports/<program>.ts` with its property test at
  `src/ports/<program>.equivalence.test.ts`.
- Shared numeric logic goes in `src/semantics/`, never duplicated in ports.
