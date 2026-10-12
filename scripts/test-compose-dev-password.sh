#!/bin/sh
# Isolated interpolation checks: never load local credentials or print config.
set -eu
cd "$(dirname "$0")/.."

config() {
  env -u DEMO_EMAIL -u DEMO_PASSWORD -u DEMO_SUPPORT_EMAIL -u DEMO_SUPPORT_PASSWORD -u JWT_SECRET -u POSTGRES_PASSWORD "$@" docker compose \
    --env-file /dev/null -f compose.yaml config --format json
}

for password in unset different; do
  if [ "$password" = unset ]; then
    output=$(config DEMO_EMAIL=test@example.invalid DEMO_PASSWORD=dummy-test-password JWT_SECRET=dummy-signing-secret-at-least-32-bytes)
  else
    output=$(config DEMO_EMAIL=test@example.invalid DEMO_PASSWORD=dummy-test-password JWT_SECRET=dummy-signing-secret-at-least-32-bytes POSTGRES_PASSWORD=different)
  fi
  printf '%s' "$output" | python3 -c '
import json, sys
services = json.load(sys.stdin)["services"]
assert services["db"]["environment"]["POSTGRES_PASSWORD"] == "support-dev-password", "database password must be fixed"
assert services["api"]["environment"]["DATABASE_URL"] == "postgresql://support:support-dev-password@db:5432/support", "API password must match"
for name, port in [("db", 5432), ("api", 3001), ("web", 5173)]:
    binding = services[name]["ports"][0]
    assert binding["host_ip"] == "127.0.0.1", "ports must remain local"
    assert int(binding["published"]) == port, "default ports must remain unchanged"
'
done

for missing in DEMO_EMAIL DEMO_PASSWORD JWT_SECRET; do
  set --
  for variable in DEMO_EMAIL DEMO_PASSWORD JWT_SECRET; do
    if [ "$variable" != "$missing" ]; then
      set -- "$@" "$variable=dummy-test-value-at-least-32-bytes"
    fi
  done
  if config "$@" >/dev/null 2>&1; then
    printf 'FAIL: %s must remain required\n' "$missing" >&2
    exit 1
  fi
  if config "$@" "$missing=" >/dev/null 2>&1; then
    printf 'FAIL: blank %s must be rejected\n' "$missing" >&2
    exit 1
  fi
done

for pair in absent blank configured; do
  set --
  if [ "$pair" = blank ]; then
    set -- DEMO_SUPPORT_EMAIL= DEMO_SUPPORT_PASSWORD=
  elif [ "$pair" = configured ]; then
    set -- DEMO_SUPPORT_EMAIL=support@example.invalid DEMO_SUPPORT_PASSWORD=dummy-support-password
  fi
  output=$(config DEMO_EMAIL=test@example.invalid DEMO_PASSWORD=dummy-test-password JWT_SECRET=dummy-signing-secret-at-least-32-bytes "$@")
  printf '%s' "$output" | python3 -c '
import json, sys
api = json.load(sys.stdin)["services"]["api"]["environment"]
assert api["SUPPORT_EMAIL"] == ("support@example.invalid" if sys.argv[1] == "configured" else "")
assert api["SUPPORT_PASSWORD"] == ("dummy-support-password" if sys.argv[1] == "configured" else "")
' "$([ "$pair" = configured ] && printf configured || true)"
done
printf 'PASS: fixed database credentials, required app values, optional support mapping, localhost ports\n'
