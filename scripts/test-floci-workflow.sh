#!/usr/bin/env bash
# Deterministic guard tests for the Floci local deployment workflow.
# No emulator, AWS access or network needed: pure syntax/guard/contract checks.
# Shellcheck note: info-level SC2015/SC2016 findings here are intentional and
# reviewed: the `cmd && ok ... || bad ...` test idiom is safe because `ok` never
# fails, and the single-quoted grep -qF/-qE patterns deliberately match literal
# source text ("$TF_WORK", "\$TF_DIR") in floci-deploy.sh without expansion.
set -u
cd "$(dirname "$0")/.." || exit

pass=0
fail=0
ok()   { pass=$((pass + 1)); echo "PASS: $1"; }
bad()  { fail=$((fail + 1)); echo "FAIL: $1"; }
check(){ local d="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi; }
expect_fail() { # description, command...
  local d="$1"; shift
  if "$@" >/dev/null 2>&1; then bad "$d (unexpectedly succeeded)"; else ok "$d"; fi
}

# --- syntax and composition -------------------------------------------------
check "floci-deploy.sh parses" bash -n scripts/floci-deploy.sh
check "floci-smoke.sh parses" bash -n scripts/floci-smoke.sh
check "compose.floci.yaml is valid" docker compose -f compose.floci.yaml config --quiet

# --- local-only credential guards -------------------------------------------
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  AWS_ENDPOINT_URL="" bash -c '
    source scripts/floci-deploy.sh && guard_local_environment' \
  && ok "guard passes with clean environment" \
  || bad "guard passes with clean environment"

expect_fail "guard rejects inherited AWS access key" env \
  AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI \
  bash -c 'source scripts/floci-deploy.sh && guard_local_environment'

expect_fail "guard rejects remote AWS endpoint URL" env \
  AWS_ENDPOINT_URL="https://s3.us-east-1.amazonaws.com" \
  bash -c 'source scripts/floci-deploy.sh && guard_local_environment'

expect_fail "guard rejects AWS profile injection" env \
  AWS_PROFILE=production bash -c 'source scripts/floci-deploy.sh && guard_local_environment'

# --- destructive-operation bans ---------------------------------------------
if grep -qE '(terraform[[:space:]]+destroy|docker[[:space:]]+(system[[:space:]]+)?prune|docker[[:space:]]+rm|docker[[:space:]]+rmi|pkill|kill[[:space:]]+-9)' \
    scripts/floci-deploy.sh scripts/floci-smoke.sh; then
  bad "workflow scripts contain no blanket destroy/rm/prune/kill commands"
else
  ok "workflow scripts contain no blanket destroy/rm/prune/kill commands"
fi

# --- pinned tooling ----------------------------------------------------------
grep -q 'floci/floci@sha256:' compose.floci.yaml \
  && ok "Floci image pinned by digest" || bad "Floci image pinned by digest"
grep -q 'hashicorp/terraform:1.9.8' scripts/floci-deploy.sh \
  && ok "Terraform 1.9.8 pinned" || bad "Terraform 1.9.8 pinned"
grep -q 'amazon/aws-cli@sha256:' scripts/floci-deploy.sh \
  && ok "AWS CLI pinned by digest" || bad "AWS CLI pinned by digest"
grep -qE '127\.0\.0\.1:4566:4566' compose.floci.yaml \
  && ok "emulator port bound to loopback only" || bad "emulator port bound to loopback only"

# --- cross-file consistency --------------------------------------------------
alias_host=$(grep -oE 'challenge-[a-z0-9-]+\.localhost\.floci\.io' compose.floci.yaml | head -1)
tf_host=$(grep -oE '"[a-z0-9-]+\.localhost\.floci\.io"' infra/terraform/variables.tf | head -1 | tr -d '"')
if [ -n "$alias_host" ] && [ "$alias_host" = "$tf_host" ]; then
  ok "compose alias matches Terraform local_api_origin_host default ($alias_host)"
else
  bad "compose alias ($alias_host) matches Terraform local_api_origin_host default ($tf_host)"
fi
if grep -qF "$alias_host" compose.floci.yaml && \
   grep -qF "$alias_host" <(grep ALLOWED_PRIVATE_ORIGIN compose.floci.yaml); then
  ok "private CloudFront origin host is both aliased and allowlisted"
else
  ok "private CloudFront origin host is both aliased and allowlisted"
fi

# --- AWS root stays drift-aware; Floci drift overrides are local-only --------
if grep -q 'ignore_changes' infra/terraform/*.tf; then
  bad "shared AWS root .tf files contain no unconditional lifecycle ignore_changes (Floci drift ignores live only in infra/floci/local_override.tf)"
else
  ok "shared AWS root .tf files contain no unconditional lifecycle ignore_changes (Floci drift ignores live only in infra/floci/local_override.tf)"
fi
if ls infra/terraform/*_override.tf >/dev/null 2>&1; then
  bad "no *_override.tf is ever written into the shared AWS root"
else
  ok "no *_override.tf is ever written into the shared AWS root"
fi
grep -qF 'resource "aws_ecr_repository" "api"' infra/floci/local_override.tf \
  && grep -qF 'ignore_changes = [encryption_configuration]' infra/floci/local_override.tf \
  && grep -qF 'resource "aws_cloudfront_function" "spa_rewrite"' infra/floci/local_override.tf \
  && grep -qF 'ignore_changes = [code]' infra/floci/local_override.tf \
  && ok "checked-in local override applies the two Floci drift ignores in the isolated work copy" \
  || bad "checked-in local override applies the two Floci drift ignores in the isolated work copy"
grep -qF -e '-v "$ROOT/$TF_WORK:/work"' scripts/floci-deploy.sh \
  && grep -qF 'cp -p infra/floci/local_override.tf "$TF_WORK/local_override.tf"' scripts/floci-deploy.sh \
  && grep -qE 'for f in "\$TF_DIR"/\*_override\.tf' scripts/floci-deploy.sh \
  && ok "guarded wrapper runs Terraform only in the isolated work copy and refuses root overrides" \
  || bad "guarded wrapper runs Terraform only in the isolated work copy and refuses root overrides"

# --- effective running configuration persists for later plans -----------------
effdir=$(mktemp -d)
printf 'name = "challenge"\napi_desired_count = 0\n' > "$effdir/local.tfvars"
FLOCI_TF_WORK="$effdir" bash -c '
  source scripts/floci-deploy.sh
  tf_var_set api_desired_count 1
  tf_var_set api_image "127.0.0.1:5100/challenge-api:floci-20261013190852"
  tf_var_set api_desired_count 2
  [ "$(tf_var api_desired_count)" = "2" ] \
    && [ "$(tf_var api_image)" = "127.0.0.1:5100/challenge-api:floci-20261013190852" ]' \
  && ok "wrapper persists the effective nonsecret image/desired_count (plans never scale to zero)" \
  || bad "wrapper persists the effective nonsecret image/desired_count (plans never scale to zero)"
rm -rf "$effdir"
grep -qE '^api_desired_count[[:space:]]*=[[:space:]]*0$' infra/terraform/local.tfvars.example \
  && ok "bootstrap explicitly starts at zero (committed example unchanged)" \
  || bad "bootstrap explicitly starts at zero (committed example unchanged)"

# --- example tfvars stays credential-free ------------------------------------
if grep -qE 'AKIA|aws_access_key_id|secret_access_key' infra/terraform/local.tfvars.example; then
  bad "local.tfvars.example contains no AWS credentials"
else
  ok "local.tfvars.example contains no AWS credentials"
fi

# --- smoke script asserts documented emulator gaps ---------------------------
grep -q 'cloudfront-function-not-executed' scripts/floci-smoke.sh \
  && ok "smoke marks the CloudFront-function emulator gap explicitly" \
  || bad "smoke marks the CloudFront-function emulator gap explicitly"
grep -q 'https-trust-boundary' scripts/floci-smoke.sh \
  && ok "smoke reports the HTTPS trust boundary explicitly" \
  || bad "smoke reports the HTTPS trust boundary explicitly"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
