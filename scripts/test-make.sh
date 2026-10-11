#!/bin/sh
# Isolated dispatch checks: no Docker daemon or real credentials are used.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fixture=$(mktemp -d)
# Retain the small fixture for inspection; this script performs no deletion.
printf 'Fixture: %s\n' "$fixture"
if [ -f "$root/Makefile" ]; then cp "$root/Makefile" "$fixture/Makefile"; fi
mkdir "$fixture/bin"
cat > "$fixture/bin/docker" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$DISPATCH_LOG"
exit "${COMPOSE_EXIT:-0}"
STUB
chmod +x "$fixture/bin/docker"
export DISPATCH_LOG="$fixture/dispatch.log"
export PATH="$fixture/bin:$PATH"
cd "$fixture"
# If Make includes or a shell sources this file, it fails or creates a marker.
cat > .env <<'ENV'
POSTGRES_PASSWORD=TEST_SECRET_NOT_FOR_OUTPUT
DEMO_EMAIL=local@example.invalid
DEMO_PASSWORD=TEST_SECRET_NOT_FOR_OUTPUT
JWT_SECRET=TEST_SECRET_NOT_FOR_OUTPUT
$(touch secret-was-executed)
ENV
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
check_dispatch() {
    target=$1
    expected=$2
    : > "$DISPATCH_LOG"
    make "$target" > output 2>&1 || fail "$target must succeed"
    [ "$(head -n 1 "$DISPATCH_LOG")" = "$expected" ] || fail "$target dispatch"
    [ "$(wc -l < "$DISPATCH_LOG")" -eq 1 ] || fail "$target dispatch count"
    ! grep -q TEST_SECRET_NOT_FOR_OUTPUT output || fail 'secret appeared in output'
    [ ! -e secret-was-executed ] || fail 'secret file executed'
}
check_dispatch run 'compose up -d --wait'
check_dispatch stop 'compose stop'
check_dispatch logs 'compose logs --follow api web db'
# Files named like targets must not disable dispatch.
touch run stop logs help
check_dispatch run 'compose up -d --wait'
check_dispatch stop 'compose stop'
check_dispatch logs 'compose logs --follow api web db'
# Help is usable without a Docker executable or any credential file.
mkdir no-env
cp Makefile no-env/Makefile
cd no-env
for target in default help; do
    : > "$DISPATCH_LOG"
    if [ "$target" = default ]; then make > output 2>&1; else make help > output 2>&1; fi
    [ ! -s "$DISPATCH_LOG" ] || fail 'help invoked Docker'
    grep -q 'config/development.example' output || fail 'help missing approved template'
    for command in run stop logs help; do
        grep -q "$command" output || fail "help missing $command"
    done
done
cd ..
for target in run stop logs; do
    if COMPOSE_EXIT=37 make "$target" > output 2>&1; then fail "$target swallowed Compose failure"; fi
done
printf 'PASS: dispatch, phony targets, dependency-free help, failure propagation, secret-file isolation\n'
