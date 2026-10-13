// CloudFront viewer-request rewrite for the SPA default (S3) behavior ONLY.
// It is never associated with the /api or /api/* ALB behaviors; the guard
// below is defense in depth.
// - Root and trailing-slash URIs resolve to <uri>index.html.
// - Extensionless client routes resolve to /index.html.
// - Assets (any final segment with an extension) keep their original path.
// Floci note: CloudFront functions are stored but not executed locally, so
// deep-link behavior is not tested in emulation (see docs/deployment.md).
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var isApi = uri === '/api' || uri.indexOf('/api/') === 0;
  if (!isApi && (uri === '/' || uri.charAt(uri.length - 1) === '/')) {
    request.uri = uri + 'index.html';
    return request;
  }
  if (!isApi && uri.split('/').pop().indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
