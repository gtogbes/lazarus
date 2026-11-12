# Lab scene stills

The landing page shows a still instead of the 3D lab scene when
`prefers-reduced-motion: reduce` is set, when WebGL is unavailable, or when the
scene fails (chunk error, WebGL start-up error, lost context). Requirement 7.4.
Code: `web/src/scene/stills.ts`, `LabStill.tsx`, `LabSceneSlot.tsx`.

## Files

Served from `web/public/stills/`. Replace the files in place; no code changes.

| Still | Shown for status | Scene mood | Files |
|---|---|---|---|
| buried | Not yet proven (idle), cancelled | buried | `buried.avif`, `buried.webp` |
| reanimating | Reanimating | reanimating | `reanimating.avif`, `reanimating.webp` |
| alive | Alive | alive (the steady warm look after the burst) | `alive.avif`, `alive.webp` |
| relapsed | Relapsed | relapsed (alarm at peak) | `relapsed.avif`, `relapsed.webp` |
| (none) | Error | fault | `buried.*`, shown greyscale and dimmed by CSS (`FAULT_FILTER`) |

An error never uses the Relapsed still: a failed run is not a divergence.

Browsers that support AVIF load the `.avif`; others load the `.webp`. Both
must exist for every still.

## Format and size

- Aspect ratio 3:1. The slot is a fixed-height box (288 px, 384 px from the
  `sm` breakpoint, up to about 1120 px wide) and crops the image to cover it,
  centred. Keep the slab, lamps and beacon in the middle third so narrow
  screens still show them.
- 2400 x 800, AVIF and WebP, 150 KB or less each. The `width`/`height`
  attributes in `stills.ts` (2400 x 800) only give the aspect ratio, so a
  different resolution at 3:1 needs no code change.
- No text, logos or trademarks (Requirement 7.5).

## How they are made

Cycles renders of the Blender hero scene (task 18), from the same camera
position and field of view as the 3D scene. Lighting per mood follows
`sceneLook.ts`: Buried has the cold key and dim arcs; Reanimating has bright
cold arcs, arc discharge to the slab and motion-blurred reels; Alive is the
steady warm light after the burst, with the slab glowing; Relapsed has the red
alarm at its peak and the arcs off.

Regenerate with `npm run art:lab -- --steps stills` (about 8 s per still on
an Apple M5 Pro GPU at 128 samples with denoising). The script picks the
highest AVIF/WebP quality that fits 150 KB. See `art/lab/README.md` for
requirements and options.

| Still | AVIF | WebP |
|---|---|---|
| buried | 35 KB | 38 KB |
| reanimating | 45 KB | 51 KB |
| alive | 45 KB | 51 KB |
| relapsed | 30 KB | 33 KB |
