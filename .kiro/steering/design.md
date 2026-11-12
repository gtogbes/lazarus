# Design direction

## Look
Photoreal, not cartoon. The setting is a 1970s mainframe machine room turned
into a reanimation lab: tape drives, a punch-card reader, cable trunks, an
operating slab, arc lighting. Think film set, not Halloween clip art.

## 3D pipeline
- Model and texture in Blender. Bake lighting and ambient occlusion into textures
  so the browser scene looks realistic without heavy real-time lighting.
- Export GLB. Compress geometry with Draco or Meshopt and textures with WebP
  (`gltf-transform`). Budget: hero scene under 8 MB total.
- Render in the browser with plain three.js (no React renderer; see LabScene.tsx). Use an HDRI environment,
  ACES Filmic tone mapping and light post-processing (bloom on arcs and CRT glow,
  subtle film grain). No heavy SSAO at runtime; it is baked.
- Use Blender Cycles for pre-rendered shots in the demo video and README.
- Assets: own models, or CC0 sources such as Poly Haven. No vendor logos or
  trademarks (for example no IBM branding) on any asset.

## Where 3D goes
- 3D: the landing scene and the "reanimation" moment when a port passes.
- 2D: the working views (COBOL vs TypeScript side by side, diff, run counters).
  These must stay crisp, readable and fast. Code is never rendered as a 3D texture.

## Performance and accessibility
- Cap pixel ratio at 2. Hold 60 fps on a mid-range laptop.
- Lazy-load the 3D scene; the 2D app must be usable before it finishes loading.
- Respect `prefers-reduced-motion`: replace the 3D scene with a still Cycles render.
- WCAG 2.2 AA for all 2D UI: 4.5:1 text contrast, keyboard navigable, visible focus.
