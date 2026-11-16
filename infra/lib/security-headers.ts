/**
 * Response security headers for the hosted lab: the single source for the
 * CloudFront response headers policy (site-stack.ts) and for the local server
 * that runs the e2e tests against the production build under the same headers
 * (web/e2e-csp/serve-dist.ts). No CDK imports, so the web tooling can load it.
 *
 * What the app needs (checked against the task 19 build, see web/e2e-csp):
 * - Scripts and styles: hashed files from /assets only. React `style` props
 *   (Shiki token colours, scene canvas) are set through the CSSOM, which
 *   style-src does not restrict, so no 'unsafe-inline'.
 * - 'wasm-unsafe-eval': the Draco decoder compiles WebAssembly. It allows
 *   WebAssembly compilation only, not eval(). No 'unsafe-eval': three's KTX2
 *   (Basis) transcoder needed it (embind `new Function`), so the lab GLB uses
 *   WebP textures instead (owner decision, task 21; art/lab/build.ts).
 * - worker-src blob: three's DRACOLoader starts its workers from blob: URLs
 *   built from the same-origin decoder script.
 * - connect-src 'self': /api/prove, /recorded/*.json, the GLB and the decoder.
 * - connect-src blob: and img-src blob: GLTFLoader turns the textures embedded
 *   in the GLB into blob: URLs, then fetch()es them (ImageBitmapLoader: Chrome,
 *   Firefox 98+, Safari 17+) or loads them in an <img> (older Safari). blob:
 *   URLs can only be minted by scripts already running on this origin.
 */

/** CSP directives, in the order they are serialised. */
export const CSP_DIRECTIVES: ReadonlyArray<readonly [directive: string, sources: readonly string[]]> = [
  ['default-src', ["'self'"]],
  ['script-src', ["'self'", "'wasm-unsafe-eval'"]],
  ['worker-src', ["'self'", 'blob:']],
  ['connect-src', ["'self'", 'blob:']],
  ['img-src', ["'self'", 'blob:']],
  ['style-src', ["'self'"]],
  ['font-src', ["'self'"]],
  ['manifest-src', ["'self'"]],
  ['object-src', ["'none'"]],
  ['base-uri', ["'none'"]],
  ['form-action', ["'none'"]],
  ['frame-ancestors', ["'none'"]],
];

export const CONTENT_SECURITY_POLICY = CSP_DIRECTIVES.map(([d, s]) => `${d} ${s.join(' ')}`).join('; ');

/** Two years; no `preload` (preload lists take the registrable domain, example.com, not this subdomain). */
export const HSTS_MAX_AGE_SEC = 63_072_000;

export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'camera=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'payment=()',
  'usb=()',
].join(', ');

/**
 * Every header the response headers policy sets, lowercase name to value,
 * exactly as a browser receives it from CloudFront.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'strict-transport-security': `max-age=${HSTS_MAX_AGE_SEC}; includeSubDomains`,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  // Disables the legacy XSS auditor, which modern guidance recommends; the CSP does the job.
  'x-xss-protection': '0',
  'permissions-policy': PERMISSIONS_POLICY,
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};
