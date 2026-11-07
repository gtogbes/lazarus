# Tech stack and conventions

## Stack
- TypeScript, strict mode, no `any`. Node.js 22+.
- npm for packages (`npm ci` in CI). Chosen over pnpm so judges need nothing beyond Node.
- Vitest for tests, fast-check for property-based tests.
- GnuCOBOL runs in Docker using a pinned image tag. Never require a local `cobc` install.
- Web UI: Vite + React + Tailwind CSS.
- 3D: three.js via React Three Fiber + drei, assets authored in Blender (see design.md).

## COBOL numeric semantics (critical)
Ports must reproduce COBOL behaviour exactly:
- Never use JavaScript `number` for money or PIC 9 fields. Use `bigint` scaled integers
  or a decimal library.
- PIC clauses define truncation. Moving a value into a smaller field drops high-order
  digits silently unless ON SIZE ERROR is coded.
- COMPUTE truncates by default. ROUNDED is round-half-away-from-zero.
- COMP-3 (packed decimal) and DISPLAY fields have the same arithmetic semantics in ports.

## Equivalence harness
- Both sides receive byte-identical input and are compared on byte-identical output.
- Property tests report the shrunk counterexample and the seed.
- Default run count is 1,000 per property; CI may use fewer.

## Code style
- Named exports. Small modules. Conventional commits.
- No secrets or real financial data in the repo, fixtures or logs. Sample data is synthetic.
