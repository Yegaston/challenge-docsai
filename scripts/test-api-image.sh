#!/usr/bin/env bash
# Packaging only: no credentials, published ports, database or AWS calls.
set -euo pipefail
cd "$(dirname "$0")/.."
# Generate a synthetic context in memory: never create secret fixtures in source.
check_ignore_policy() {
  # Docker does not filter remote tar contexts; use a disposable container's
  # local tmpfs context so Docker itself applies .dockerignore.
  python3 - "${1:-}" <<'PY' | docker run --rm -i --network none --user 0 \
    --mount type=bind,src="$(command -v docker)",dst=/usr/local/bin/docker,readonly \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --tmpfs /fixture --entrypoint sh node:22-bookworm-slim -c \
    'tar -xf - -C /fixture && docker build --no-cache --network none --platform linux/amd64 -f /fixture/Dockerfile /fixture'
import io
import tarfile
from pathlib import Path
import sys

policy = Path('.dockerignore').read_bytes()
if sys.argv[1] == '--ignore-original':
    policy = policy.split(b'\n# Keep these last:')[0]
files = {
    '.dockerignore': policy,
    'Dockerfile': b'''FROM node:22-bookworm-slim
WORKDIR /fixture
COPY . .
RUN node --input-type=module -e "import assert from 'node:assert/strict'; import {readdirSync} from 'node:fs'; const files = readdirSync('apps/api/src/nested', {recursive:true}).sort(); assert.deepEqual(files, ['auth.ts', 'secrets.ts', 'server.ts']); console.log('Docker ignore regression: nested secrets excluded; application modules retained');"
''',
}
for name in ['auth.ts', 'secrets.ts', 'server.ts', '.env', '.env.local',
             '.env.production', 'dummy.pem', 'dummy.key', 'dummy.p12',
             'dummy.pfx', 'id_rsa', 'id_ed25519', 'credentials.json']:
    files['apps/api/src/nested/' + name] = b'synthetic fixture only\n'
with tarfile.open(fileobj=__import__('sys').stdout.buffer, mode='w|') as archive:
    for name, content in files.items():
        entry = tarfile.TarInfo(name)
        entry.size = len(content)
        archive.addfile(entry, io.BytesIO(content))
PY
}
check_ignore_policy "${1:-}"
if [[ "${1:-}" == --ignore-only || "${1:-}" == --ignore-original ]]; then exit 0; fi
test -f apps/api/Dockerfile || { echo 'Missing production API Dockerfile' >&2; exit 1; }
docker build --platform linux/amd64 -f apps/api/Dockerfile -t challenge-api:floci .
test "$(docker image inspect challenge-api:floci --format '{{.Architecture}}')" = amd64
test "$(docker image inspect challenge-api:floci --format '{{json .Config.Cmd}}')" = '["node","dist/server.js"]'
docker run --rm -i --network none --read-only --entrypoint node challenge-api:floci --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
assert.notEqual(process.getuid(), 0);
assert.equal(process.arch, 'x64');
assert.equal(process.env.NODE_ENV, 'production');
await access('dist/server.js');
for (const dependency of ['express', 'pg', 'jose', 'ai', '@openrouter/ai-sdk-provider', 'zod']) await import(dependency);
for (const absent of ['tsx', 'typescript', 'vitest']) {
  assert.throws(() => import.meta.resolve(absent));
}
const source = await readFile('dist/infrastructure/initialize-users.js', 'utf8');
const migrations = [...source.matchAll(/"(\d{3}-[^"\n]+\.sql)"/g)].map(match => match[1]);
assert.equal(migrations.length, 19);
const moduleRoot = new URL('../', new URL('dist/infrastructure/initialize-users.js', `file://${process.cwd()}/`));
for (const name of migrations) assert.ok((await readFile(new URL(`../migrations/${name}`, moduleRoot), 'utf8')).trim());
const files = await readdir('.');
assert.ok(!files.includes('src') && !files.some(name => name.startsWith('.env')));
console.log('API image: non-root x86_64, production dependencies and all 19 runtime migrations verified');
JS
