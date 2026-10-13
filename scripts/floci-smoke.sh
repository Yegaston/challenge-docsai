#!/usr/bin/env bash
# Local-only smoke checks for the Floci deployment. Every request stays on the
# loopback emulator; no external network is contacted and no secret value is
# printed. Floci-only gaps (CloudFront functions, HTTPS) are asserted or
# reported explicitly instead of being hidden. No destroy/rm/prune commands.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/floci-deploy.sh
source scripts/floci-deploy.sh
guard_local_environment || exit 2

readonly PG_IMAGE=postgres:16-alpine
pass=0; fail=0
ok()  { pass=$((pass + 1)); echo "PASS: $1"; }
bad() { fail=$((fail + 1)); echo "FAIL: $1"; }

prepare_work_copy
name=$(tf_var name)
alb_dns=$(tf output -json api | python3 -c 'import sys,json;print(json.load(sys.stdin)["alb_dns_name"])')
cf_domain=$(tf output -json frontend | python3 -c 'import sys,json;print(json.load(sys.stdin)["distribution_domain"])')
bucket="$(tf_var name)-frontend"

# Asset keys are listed on the host (with dummy credentials); all HTTP checks
# run inside one container on the emulator network; curl sends the origin Host
# headers that the emulated ALB/CloudFront filters route on.
assets=$(aws s3api list-objects-v2 --bucket "$bucket" \
  --query "Contents[?starts_with(Key, \`assets/\`)].Key" --output text)
http_checks=$(docker run --rm --network "$FLOCI_NETWORK" \
  -e ALB="$alb_dns" -e CF="$cf_domain" -e ASSETS="$assets" --entrypoint bash "$AWS_IMAGE" -c '
  get() { curl -s --max-time 10 -o /tmp/body -w "%{http_code}" "$@"; }
  code=$(get -H "Host: $ALB" http://floci:80/api/health)
  grep -q "\"database\":\"reachable\"" /tmp/body && [ "$code" = 200 ] && echo "PASS ALB /api/health reaches ECS and PostgreSQL ($code)" || echo "FAIL ALB /api/health ($code) $(head -c 80 /tmp/body)"
  code=$(get -H "Host: $CF" http://floci:4566/api/health)
  [ "$code" = 200 ] && echo "PASS CloudFront /api/health forwards to the ALB origin ($code)" || echo "FAIL CloudFront /api/health ($code)"
  code=$(get -H "Host: $CF" http://floci:4566/index.html)
  [ "$code" = 200 ] && echo "PASS CloudFront serves index.html from the private S3 origin ($code)" || echo "FAIL CloudFront index.html ($code)"
  for key in $ASSETS; do
    code=$(get -H "Host: $CF" "http://floci:4566/$key")
    cc=$(curl -sI --max-time 10 -H "Host: $CF" "http://floci:4566/$key" | tr -d "\r" | grep -i "^cache-control" | cut -d" " -f2-)
    [ "$code" = 200 ] && echo "$cc" | grep -q immutable \
      && echo "PASS asset $key served with immutable cache headers ($code)" \
      || echo "FAIL asset $key ($code, cache-control: ${cc:-none})"
  done
  code=$(get -H "Host: $CF" http://floci:4566/)
  [ "$code" = 404 ] && echo "PASS root path stays 404: cloudfront-function-not-executed (documented Floci gap)" || echo "FAIL root-path expectation ($code)"
  code=$(get -H "Host: $CF" http://floci:4566/tickets/123)
  [ "$code" = 404 ] && echo "PASS deep link stays 404: cloudfront-function-not-executed (documented Floci gap)" || echo "FAIL deep-link expectation ($code)"
')
while IFS= read -r line; do
  case "$line" in
    PASS*) pass=$((pass + 1)); echo "$line" ;;
    FAIL*) fail=$((fail + 1)); echo "$line" ;;
    "") ;;
    *) echo "$line" ;;
  esac
done <<< "$http_checks"

# Database migrations: the API applies all ordered SQL files on startup.
tables=$(docker run --rm --network "$FLOCI_NETWORK" -e PGPASSWORD="$LOCAL_DB_DUMMY_PASSWORD" \
  "$PG_IMAGE" psql -h floci -p 7001 -U "$(tf output -json database | python3 -c 'import sys,json;print(json.load(sys.stdin)["username"])')" \
  -d "$(tf output -json database | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])')" \
  -t -A -c "select count(*) from information_schema.tables where table_schema='public'")
if [ "${tables:-0}" -ge 12 ]; then
  ok "PostgreSQL reachable through the emulator DB proxy with $tables migrated tables"
else
  bad "PostgreSQL reachable through the emulator DB proxy (found ${tables:-0} tables)"
fi

# ECS runs one task from the image that was actually pushed to the ECR.
running=$(aws ecs describe-services --cluster "$name-api" --services "$name-api" \
  --query 'services[0].runningCount' --output text 2>/dev/null || echo 0)
if [ "$running" = "1" ]; then
  ok "ECS service $name-api reports 1 running task"
else
  bad "ECS service $name-api running tasks (got $running)"
fi
if [ -f "$IMAGE_TAG_FILE" ]; then
  pushed_tag=$(cat "$IMAGE_TAG_FILE")
  taskdef_image=$(aws ecs describe-task-definition --task-definition "$name-api" \
    --query 'taskDefinition.containerDefinitions[0].image' --output text)
  if [ "$taskdef_image" = "$pushed_tag" ]; then
    ok "task definition references the pushed ECR image (actual image, not an empty repository)"
  else
    bad "task definition image matches the pushed tag ($taskdef_image vs $pushed_tag)"
  fi
  task_container=$(docker ps --format '{{.Names}}' | grep '^floci-aws-ecs-.*-api$' | head -1)
  if [ -n "$task_container" ] && \
     [ "$(docker inspect -f '{{.Image}}' "$task_container")" = "$(docker image inspect --format '{{.Id}}' "$LOCAL_API_IMAGE")" ]; then
    ok "the running ECS container uses the local amd64 production image digest"
  else
    bad "the running ECS container uses the pushed image digest"
  fi
else
  bad "pushed image tag file $IMAGE_TAG_FILE exists (run floci-deploy.sh image first)"
fi

refs=$(aws ecs describe-task-definition --task-definition "$name-api" \
  --query 'taskDefinition.containerDefinitions[0].secrets[].name' --output text 2>/dev/null | wc -w)
if [ "$refs" = "7" ]; then
  ok "task definition references all 7 Secrets Manager values by ARN (values never printed)"
else
  bad "task definition secret references (found $refs)"
fi

# Auth flow through the real entrypoint chain. Dummy credentials come from the
# emulator's Secrets Manager and are never printed. NODE_ENV=production makes
# the refresh cookie Secure, so this only verifies the API contract over the
# emulated HTTP path; the https-trust-boundary note below reports the limit.
auth_checks=$(DE=$(aws secretsmanager get-secret-value --secret-id "$name/DEMO_EMAIL" \
    --query SecretString --output text) ; DP=$(aws secretsmanager get-secret-value \
    --secret-id "$name/DEMO_PASSWORD" --query SecretString --output text) ; \
  docker run --rm --network "$FLOCI_NETWORK" -e ALB="$alb_dns" -e E="$DE" -e P="$DP" \
    --entrypoint bash "$AWS_IMAGE" -c '
  B=http://floci:80
  code=$(curl -s --max-time 10 -o /tmp/login -w "%{http_code}" -H "Host: $ALB" \
    -H "Content-Type: application/json" -d "{\"email\":\"$E\",\"password\":\"$P\"}" $B/api/auth/login)
  token=$(python3 -c "import json;print(json.load(open(\"/tmp/login\")).get(\"token\",\"\"))" 2>/dev/null)
  if [ "$code" = 200 ] && [ -n "$token" ]; then echo "PASS login through the emulated ALB returns an access token ($code)"
  else echo "FAIL login ($code)"; fi
  code=$(curl -s --max-time 10 -o /tmp/me -w "%{http_code}" -H "Host: $ALB" -H "Authorization: Bearer $token" $B/api/auth/me)
  [ "$code" = 200 ] && echo "PASS authenticated /api/auth/me with the bearer token ($code)" || echo "FAIL /api/auth/me ($code)"
  code=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" -H "Host: $ALB" -H "Authorization: Bearer $token" -X POST $B/api/auth/logout)
  [ "$code" = 204 ] && echo "PASS logout clears the session server-side ($code)" || echo "FAIL logout ($code)"
')
while IFS= read -r line; do
  case "$line" in
    PASS*) pass=$((pass + 1)); echo "$line" ;;
    FAIL*) fail=$((fail + 1)); echo "$line" ;;
    "") ;;
    *) echo "$line" ;;
  esac
done <<< "$auth_checks"

cat <<'EOF'
NOTE: https-trust-boundary — this emulation serves plain HTTP only. The API
sets NODE_ENV=production, so refresh cookies are Secure: a real browser over
HTTP would not store or resend them, so browser-level session persistence and
CloudFront HTTPS behavior are NOT verified here. Enable Floci TLS (see its
"Downloading over HTTPS" docs) and a trusted CA for a browser-faithful check.
EOF

echo
echo "smoke passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
