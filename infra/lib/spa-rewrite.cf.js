// CloudFront Function (cloudfront-js-2.0), viewer request, default behaviour only.
// SPA fallback: a path whose last segment has no dot is an app route
// (/, /morgue, /program/PAYROLL) and is served /index.html. Anything with an
// extension (/assets/x.js, /recorded/X.json) goes to S3 unchanged, so a missing
// file stays a real 404. /api/* has its own behaviour and never reaches this.
// Also loaded by infra tests and web/e2e-csp/serve-dist.ts, so keep it plain
// ES5-style JavaScript with a single `handler` function.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
