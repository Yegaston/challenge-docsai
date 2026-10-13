// Deterministic Node test for the CloudFront viewer-request SPA rewrite.
// Reproducible command is documented in docs/deployment.md; this evaluates
// the exact production source. It must only touch request.uri and never
// manufacture a response/status, so status passthrough is preserved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../spa-rewrite.js', import.meta.url), 'utf8');
const { handler } = new Function(`${source}; return { handler };`)();

function run(uri) {
  const event = { request: { method: 'GET', uri, headers: {}, querystring: '' } };
  return { event, result: handler(event) };
}
// Rewritten: root, extensionless deep links and trailing slashes. Passthrough:
// index/favicon/assets keep their path; /api* never rewritten.
const rewritten = [
  ['/', '/index.html'],
  ['/login', '/index.html'],
  ['/about/team', '/index.html'],
  ['/docs/', '/docs/index.html'],
];
const passthrough = [
  '/index.html',
  '/favicon.ico',
  '/assets/app.css',
  '/assets/main.9f3c.js',
  '/api',
  '/api/health',
  '/api/',
  '/api/v1/items',
];

for (const [given, expected] of rewritten) {
  test(`rewrite ${given} -> ${expected}`, () => {
    const { event, result } = run(given);
    assert.equal(result.uri, expected);
    assert.equal(event.response, undefined);
  });
}
for (const uri of passthrough) {
  test(`passthrough ${uri} unchanged with status behavior preserved`, () => {
    const { event, result } = run(uri);
    assert.equal(result.uri, uri);
    assert.ok(Object.is(result, event.request));
    assert.equal(event.response, undefined);
  });
}