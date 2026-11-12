# Lab hero scene (Blender)

The 1970s machine-room lab, built entirely by script so it can be re-run or hand-tuned.
Task 18 of `.kiro/specs/reanimation-lab`.

| Output | Path | Committed |
|---|---|---|
| Hero GLB (Draco + WebP) | `web/public/models/lab.glb` | yes (about 0.3 MB) |
| Stills (AVIF + WebP) | `web/public/stills/*.{avif,webp}` | yes (see `docs/stills.md`) |
| Blender file | `art/lab/lab.blend` | yes (about 0.5 MB, compressed, no packed images) |
| Raw GLB, bake PNGs, full-size PNG renders, reports | `art/lab/build/` | no (gitignored, regenerated) |

## Run

```sh
npm run art:lab                                      # everything (~1.5 min on an M5 Pro)
npm run art:lab -- --steps stills --moods alive      # one still
npm run art:lab -- --steps stills --scale 33 --samples 32   # quick look-dev preview
npm run art:lab -- --steps bake,export               # GLB only
```

Steps: `blend` (save `lab.blend`), `stills`, `bake`, `export`. Other flags go to
`build_lab.py`: `--samples` (stills, default 128), `--scale` (% of 2400 x 800),
`--bake-size` (default 2048), `--bake-samples` (default 384), `--haze` (volume density,
default 0; 0.012 looks good but renders were about 100x slower).

Requirements:
- Blender 5.2 (`BLENDER` env var, else `/Applications/Blender.app/Contents/MacOS/Blender`).
  Built and tested with 5.2.3 LTS, Cycles on Metal.
- `cwebp` (GLB textures and stills) and `avifenc` (stills): `brew install webp libavif`.
- npm devDependencies pinned at the repo root: `@gltf-transform/{core,extensions,functions,cli}` 4.5.1,
  `draco3dgltf` 1.5.9. The root `overrides` entry moves the CLI's argument parser
  (`@donmccurdy/caporal` 0.0.10, which asks for the deprecated `glob` 10) to `glob` 14, same API.

`build_lab.py` writes the geometry in three.js coordinates (Y up, metres) with the same
layout as the placeholder `web/src/scene/LabScene.tsx`. Tuning constants (light watts,
emission strengths, camera aim, mood table) are at the top of the file.

## What is baked and what is not

- **Baked**: static ambient light only. A uniform white sky over the open-topped room is
  baked (Cycles diffuse: colour + direct + indirect) into the base colour of `Lab_Room`
  and `Lab_Props`. Result: albedo x ambient occlusion x bounce, with the procedural detail
  (floor tiles, grime) included. No scene light is baked.
- **Dynamic, in three.js**: key light, both arc lamps, the alarm, the slab glow and all
  emissive changes. The GLB only carries empties where those lights go.
- Baked surfaces are dielectric (metalness 0), because a diffuse bake of a metal is black.
  The reels and slab are metal (0.7). They need an environment map at runtime (the
  steering asks for an HDRI) or they will look dark.

## Node contract for task 19

Positions are in three.js world units. All nodes sit at the scene root.

| Node | Kind | Position | Use |
|---|---|---|---|
| `Lab_Room` | mesh, `Room_Baked` | origin | static floor (22 x 7.3 m) and back wall (z = -2.8) |
| `Lab_Props` | mesh, `Props_Baked` + `Props_Gloss` | origin | static machines, lamp stands, slab base, cables, beacon mount |
| `Lab_Indicators` | mesh, `Indicator_Amber`, `Indicator_Green`, `CRT_Glow` | origin | static panel lamps and a blank CRT (emissive, bloom candidates) |
| `Slab` | mesh, `Slab_Top` | [0, 0.98, 0.6] | drive `emissiveIntensity` from `slabGlow` (emissive colour 0xffd9a8 is set, starts at 0) |
| `ArcLamp_L_Bulb`, `ArcLamp_R_Bulb` | mesh, shared `ArcBulb` | [±1.9, 2.25, 0.6] | drive `emissive` / `emissiveIntensity` from `arcColor` / `arcIntensity` |
| `ArcLamp_L_Light`, `ArcLamp_R_Light` | empty | same as the bulbs | attach the arc point lights here |
| `AlarmBeacon` | mesh, `AlarmBeacon_Glass` | [0, 3.1, -2] | drive `emissiveIntensity` from `alarmIntensity` (emissive 0xff2a1a, starts at 0) |
| `AlarmBeacon_Light` | empty | [0, 3.1, -2] | attach the alarm point light |
| `Reel_0_L` ... `Reel_3_R` | mesh, `Reel_Metal` + `Reel_Tape` (one shared mesh) | [cabinet x ± 0.36, 1.85, -2.04], cabinets at x = -3, -1, 1, 3 | origin is the hub; spin with `rotation.z -= reelSpeed * dt`. Each starts at a different angle. |
| `KeyLight`, `KeyLight_Target` | empty | [2.5, 6, 3], [0, 0, 0] | key spot position and target (as in the placeholder) |
| `Camera_Hero` | camera, yfov 40° | [0, 2.4, 6.5] | the stills camera, aimed at `Camera_Target` |
| `Camera_Target` | empty | [0, 1.45, 0] | see the camera note below |

Materials shared across nodes (`ArcBulb`, `Reel_*`) change every user at once. Clone them
if the two lamps ever need to differ.

**Camera note.** The placeholder relies on R3F's default `lookAt(0, 0, 0)`. With a 40°
vertical fov from [0, 2.4, 6.5], that puts the top of the frame level at about 2.37 m, so
the alarm beacon (3.1 m) and the cabinet tops (2.6 m) are never in view. The stills aim at
`Camera_Target` [0, 1.45, 0] (pitch about 8° down) instead. Task 19 should do the same so
the live scene matches the stills.

## Budget (Requirement 9.4)

From `art/lab/build/glb-report.json` and `gltf-transform inspect`:

- 0.32 MB total (one self-contained GLB, no external files), under the 8 MB budget.
- 26,980 triangles, 26 draw calls (primitives x nodes), 11 materials.
- 2 textures, 2048 x 2048 WebP (`EXT_texture_webp`, cwebp q90), base colour (sRGB): 164 KB
  and 81 KB in the file. Decoded to RGBA8 with mipmaps that is about 22 MB each in GPU
  memory (KTX2/ETC1S was about 2.8 MB each).
- Why not KTX2: three's Basis transcoder is Emscripten embind code that calls
  `new Function`, so it needs `'unsafe-eval'` in the site CSP. The owner chose WebP to keep
  `script-src 'self' 'wasm-unsafe-eval'` (task 21, 2026-11-10). If GPU memory on phones
  becomes a problem, drop the bake to 1024 x 1024 (`--bake-size 1024`, about 5.6 MB each).

## Rules

- No text, logos or trademarks on any surface (Requirement 7.5). The reels have five
  spokes, not three: a three-spoke ring reads as a car badge.
- No source code as a texture (Requirement 2.4). The CRT screen is a blank glow.
