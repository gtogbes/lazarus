/**
 * Cheap WebGL check that does not import three.js, so the lab scene chunk is
 * only fetched when it can run (Requirement 7.4).
 */

/** Whether `doc` can create a WebGL 2 or WebGL 1 context. Frees the probe context straight away. */
export function detectWebGL(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
    // Browsers cap live contexts; do not hold one for the probe.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    // Some browsers throw instead of returning null when WebGL is blocked.
    return false;
  }
}

let cached: boolean | undefined;

/** `detectWebGL`, run at most once per page load. */
export function hasWebGL(): boolean {
  cached ??= detectWebGL();
  return cached;
}
