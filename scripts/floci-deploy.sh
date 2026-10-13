#!/usr/bin/env bash
# Floci local-only deployment workflow. This is a simulation: it never targets
# real AWS, never inherits host AWS credentials, and only writes generated
# dummy secret values. See docs/deployment.md (T3 section) for the full
# contract, evidence and emulator gaps. Safe by construction: no destroy,
# prune, remove or kill commands; existing caches, images and containers that
# this workflow did not create are left untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"

readonly COMPOSE_FILE=compose.floci.yaml
readonly FLOCI_NETWORK=floci-challenge-net
readonly TF_IMAGE=hashicorp/terraform:1.9.8
readonly AWS_IMAGE=amazon/aws-cli@sha256:d32864c20087d486f5988c3e70817d67a73f584a47535cada9ad97e0ea1e5196
readonly NODE_IMAGE=node:22-bookworm-slim
readonly BUILD_VOLUME=floci-challenge-build
readonly LOCAL_API_IMAGE=challenge-api:floci
readonly TF_DIR=infra/terraform
# Isolated local working copy: the guarded wrapper runs every Terraform command
# only here, against the checked-in infra/floci/local_override.tf merged on top
# of a copy of the AWS root configuration. The shared AWS root (infra/terraform)
# is never written by this workflow and keeps no *_override.tf, so AWS stays
# drift-aware. All state lives in the ignored work copy.
# FLOCI_TF_WORK overrides the working-copy path only in deterministic tests;
# the guarded workflow always uses the default ignored location.
readonly TF_WORK="${FLOCI_TF_WORK:-infra/floci/work}"
readonly TFVARS_FILE=local.tfvars
readonly IMAGE_TAG_FILE=$TF_WORK/floci-image.txt
# T2a commits this clearly labeled local-only dummy as the emulated RDS master
# password (data.tf, local mode); the DATABASE_URL is derived from it.
readonly LOCAL_DB_DUMMY_PASSWORD=LOCAL-DUMMY-not-for-AWS-42

# Never inherit real AWS credentials or remote endpoints; every AWS call below
# uses explicit dummy credentials against the allowlisted emulator endpoint.
guard_local_environment() {
  local v bad=""
  for v in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN \
           AWS_PROFILE AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE; do
    [ -n "${!v:-}" ] && bad="$bad $v"
  done
  if [ -n "$bad" ]; then
    echo "ERROR: refusing to run with inherited AWS variables:$bad" >&2
    echo "Unset them; this workflow uses only local-dummy credentials." >&2
    return 1
  fi
  local ep="${AWS_ENDPOINT_URL:-}"
  if [ -n "$ep" ] && ! [[ "$ep" =~ ^http://(floci|localhost|127\.0\.0\.1|host\.docker\.internal):[0-9]+$ ]]; then
    echo "ERROR: AWS_ENDPOINT_URL must be an explicit local emulator endpoint, got: $ep" >&2
    return 1
  fi
  command -v docker >/dev/null || { echo "ERROR: docker CLI not found" >&2; return 1; }
  docker info >/dev/null 2>&1 || { echo "ERROR: docker daemon unreachable" >&2; return 1; }
}

tf_var() { # name -> value from the ignored work-copy local.tfvars
  sed -nE "s/^$1[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?.*/\1/p" "$TF_WORK/$TFVARS_FILE" | head -1
}

tf_var_set() { # name value -> persist nonsecret effective config in the ignored work tfvars
  local k=$1 v=$2 out="$2" f="$TF_WORK/$TFVARS_FILE"
  [[ "$v" =~ ^-?[0-9]+$ ]] || out="\"$v\""
  if grep -qE "^${k}[[:space:]]*=" "$f" 2>/dev/null; then
    sed -i -E "s|^(${k}[[:space:]]*=).*$|\1 $out|" "$f"
  else
    printf '%s = %s\n' "$k" "$out" >> "$f"
  fi
}

tf() {
  local -a args=(--rm --network "$FLOCI_NETWORK" -v "$ROOT/$TF_WORK:/work" -w /work "$TF_IMAGE")
  local sub=$1; shift
  local -a tfargs=()
  local a
  for a in "$@"; do tfargs+=("$a"); done
  case "$sub" in
    plan|apply)
      docker run "${args[@]}" "$sub" -input=false -var-file="$TFVARS_FILE" "${tfargs[@]}" ;;
    *) docker run "${args[@]}" "$sub" "${tfargs[@]}" ;;
  esac
}

aws() { # AWS CLI inside the emulator network; dummy credentials only
  docker run --rm --network "$FLOCI_NETWORK" \
    -e AWS_ACCESS_KEY_ID=local-dummy -e AWS_SECRET_ACCESS_KEY=local-dummy \
    -e AWS_DEFAULT_REGION="$(tf_var region)" \
    -e AWS_ENDPOINT_URL="http://floci:4566" \
    ${SEC_TMP:+-v "$SEC_TMP:/sec"} \
    "$AWS_IMAGE" "$@"
}

prepare_work_copy() { # build/sync the isolated local working copy; never touches the AWS root
  mkdir -p "$TF_WORK"
  local f
  for f in "$TF_DIR"/*_override.tf; do
    [ -e "$f" ] && { echo "ERROR: $f exists in the shared AWS root; overrides live only in infra/floci/local_override.tf" >&2; return 1; }
  done
  for f in "$TF_DIR"/*.tf "$TF_DIR"/.terraform.lock.hcl "$TF_DIR"/spa-rewrite.js; do
    [ -f "$f" ] && cp -p "$f" "$TF_WORK/"
  done
  cp -p infra/floci/local_override.tf "$TF_WORK/local_override.tf"
  if [ ! -d "$TF_WORK/.terraform" ] && [ -d "$TF_DIR/.terraform" ]; then
    cp -a "$TF_DIR/.terraform" "$TF_WORK/.terraform" # reuse the provider cache; no re-download
  fi
  # One-time state migration: copy (never overwrite) so live resource
  # addresses and the running stack are preserved.
  if [ ! -f "$TF_WORK/terraform.tfstate" ] && [ -f "$TF_DIR/terraform.tfstate" ]; then
    cp -p "$TF_DIR/terraform.tfstate" "$TF_WORK/terraform.tfstate"
    echo "Migrated local state into $TF_WORK (resource addresses preserved; AWS root untouched)."
  fi
  if [ -f "$TF_DIR/floci-image.txt" ] && [ ! -f "$IMAGE_TAG_FILE" ]; then
    cp -p "$TF_DIR/floci-image.txt" "$IMAGE_TAG_FILE"
  fi
  if [ ! -f "$TF_WORK/$TFVARS_FILE" ]; then
    if [ -f "$TF_DIR/$TFVARS_FILE" ]; then
      cp -p "$TF_DIR/$TFVARS_FILE" "$TF_WORK/$TFVARS_FILE"
    else
      cp "$TF_DIR/$TFVARS_FILE.example" "$TF_WORK/$TFVARS_FILE"
    fi
  fi
}

sync_effective_vars() { # persist the live running config so later plans don't scale to zero
  local d td img
  d=$(aws ecs describe-services --cluster "$(tf_var name)-api" --services "$(tf_var name)-api" \
        --query 'services[0].desiredCount' --output text 2>/dev/null) || return 0
  { [ -n "$d" ] && [ "$d" != "None" ]; } || return 0
  td=$(aws ecs describe-services --cluster "$(tf_var name)-api" --services "$(tf_var name)-api" \
        --query 'services[0].taskDefinition' --output text 2>/dev/null) || return 0
  img=$(aws ecs describe-task-definition --task-definition "$td" \
        --query 'taskDefinition.containerDefinitions[0].image' --output text 2>/dev/null) || return 0
  tf_var_set api_desired_count "$d"
  tf_var_set api_image "$img"
  echo "Persisted effective running config in ignored $TF_WORK/$TFVARS_FILE: desired_count=$d image=$img"
}

cmd_up() {
  guard_local_environment
  docker compose -f "$COMPOSE_FILE" up -d
  local i=0
  while [ $i -lt 60 ]; do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose -f "$COMPOSE_FILE" ps -q floci)")" = healthy ] \
      && { echo "Floci healthy on 127.0.0.1:4566"; return 0; }
    sleep 2; i=$((i + 2))
  done
  echo "ERROR: Floci did not become healthy" >&2; return 1
}

cmd_init() {
  guard_local_environment
  prepare_work_copy
  tf init -backend=false -input=false
  # The ECR registry container survives a Floci restart while every other
  # emulated service is wiped, so a fresh state re-imports the live repository.
  if ! tf state list | grep -q 'aws_ecr_repository.api'; then
    if aws ecr describe-repositories --repository-names "$(tf_var name)-api" >/dev/null 2>&1; then
      echo "Importing existing emulated ECR repository into fresh state"
      tf import "aws_ecr_repository.api" "$(tf_var name)-api"
    fi
  fi
  # Persist the live running config before any later plan: otherwise the
  # bootstrap default (desired_count 0, placeholder image) would look like a
  # scale-down of the running service.
  sync_effective_vars
}

cmd_plan() { guard_local_environment; prepare_work_copy; tf plan; }

cmd_image() { # build amd64 production image and push it to the emulated ECR
  guard_local_environment
  prepare_work_copy
  local stamp tag
  stamp=$(date -u +%Y%m%d%H%M%S)
  docker build --platform linux/amd64 -f apps/api/Dockerfile -t "$LOCAL_API_IMAGE" .
  aws ecr get-authorization-token --registry-ids 000000000000 >/dev/null
  local password
  password=$(aws ecr get-authorization-token --registry-ids 000000000000 \
    --query 'authorizationData[0].authorizationToken' --output text | base64 -d | sed 's/^AWS://')
  printf '%s' "$password" | docker login 127.0.0.1:5100 --username AWS --password-stdin >/dev/null
  tag="127.0.0.1:5100/$(tf_var name)-api:floci-$stamp"
  docker tag "$LOCAL_API_IMAGE" "$tag"
  docker push "$tag" >/dev/null
  local digest
  digest=$(docker inspect --format '{{index .RepoDigests 0}}' "$tag")
  printf '%s\n' "$tag" > "$IMAGE_TAG_FILE"
  echo "Pushed $tag ($digest); the ECR repository now holds the actual image."
}

cmd_secrets() { # populate the seven application secrets out of band
  guard_local_environment
  prepare_work_copy
  SEC_TMP=$(mktemp -d) || return 1
  chmod 700 "$SEC_TMP"
  trap 'shred -u "$SEC_TMP"/* 2>/dev/null; rmdir "$SEC_TMP" 2>/dev/null; SEC_TMP=' RETURN
  local db url user port dbname
  # RDS endpoint from Terraform output; the host is rewritten to the compose
  # service name, which the ECS task container resolves on the shared network.
  db=$(tf output -json database)
  user=$(python3 -c 'import sys,json;print(json.load(sys.stdin)["username"])' <<<"$db")
  port=$(python3 -c 'import sys,json;print(json.load(sys.stdin)["port"])' <<<"$db")
  dbname=$(python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])' <<<"$db")
  url="postgresql://$user:$LOCAL_DB_DUMMY_PASSWORD@floci:$port/$dbname"
  printf '%s' "$url" > "$SEC_TMP/DATABASE_URL"
  printf 'demo@example.invalid' > "$SEC_TMP/DEMO_EMAIL"
  printf '%s' "$(openssl rand -hex 16)" > "$SEC_TMP/DEMO_PASSWORD"
  printf '%s' "$(openssl rand -hex 32)" > "$SEC_TMP/JWT_SECRET"
  printf 'support@example.invalid' > "$SEC_TMP/SUPPORT_EMAIL"
  printf '%s' "$(openssl rand -hex 16)" > "$SEC_TMP/SUPPORT_PASSWORD"
  if [ -n "${FLOCI_OPENROUTER_KEY_FILE:-}" ]; then
    # Optional user-provided local key; read from a protected file, never echoed.
    install -m 600 "$FLOCI_OPENROUTER_KEY_FILE" "$SEC_TMP/OPENROUTER_API_KEY"
  else
    printf 'LOCAL-DUMMY-not-a-real-key' > "$SEC_TMP/OPENROUTER_API_KEY"
  fi
  # DATABASE_URL is always re-derived. Seed credentials are kept stable once
  # set: the API seeds accounts only when absent and never rotates existing
  # passwords, and the emulated database outlives task replacements.
  local k n=0 skip=""
  for k in DATABASE_URL DEMO_EMAIL DEMO_PASSWORD JWT_SECRET SUPPORT_EMAIL SUPPORT_PASSWORD OPENROUTER_API_KEY; do
    if [ "$k" != DATABASE_URL ] && aws secretsmanager get-secret-value \
        --secret-id "$(tf_var name)/$k" --query SecretString --output text >/dev/null 2>&1; then
      skip="$skip $k"; continue
    fi
    aws secretsmanager put-secret-value \
      --secret-id "$(tf_var name)/$k" --secret-string "file:///sec/$k" >/dev/null && n=$((n + 1))
  done
  echo "Populated $n/7 secret values out of band (values never printed).${skip:+ Kept existing:$skip}"
}

cmd_frontend() { # build the SPA in an isolated container and upload with cache headers
  guard_local_environment
  local tarball; tarball=$(mktemp /tmp/floci-src.XXXXXX.tar)
  trap 'rm -f "$tarball"' RETURN
  tar -cf "$tarball" --exclude=.git --exclude=node_modules --exclude=.codegraph \
    --exclude=.terraform --exclude='*.tfstate*' --exclude=dist --exclude=coverage .
  docker volume create "$BUILD_VOLUME" >/dev/null
  docker run --rm --network none -v "$BUILD_VOLUME:/b" -v "$tarball:/src.tar:ro" \
    "$NODE_IMAGE" sh -c 'rm -rf /b/repo && mkdir -p /b/repo && tar -xf /src.tar -C /b/repo'
  docker run --rm -v "$BUILD_VOLUME:/b" -w /b/repo \
    -e npm_config_update_notifier=false "$NODE_IMAGE" \
    sh -c 'npm ci --no-audit --no-fund >/dev/null 2>&1 && npm run build -w @support/web >/dev/null'
  local bucket; bucket="$(tf_var name)-frontend"
  docker run --rm --network "$FLOCI_NETWORK" -v "$BUILD_VOLUME:/b:ro" \
    -e AWS_ACCESS_KEY_ID=local-dummy -e AWS_SECRET_ACCESS_KEY=local-dummy \
    -e AWS_DEFAULT_REGION="$(tf_var region)" -e AWS_ENDPOINT_URL="http://floci:4566" \
    -e BUCKET="$bucket" --entrypoint sh \
    "$AWS_IMAGE" -c '
      cd /b/repo/apps/web/dist || exit 1
      find . -type f | sed "s|^\./||" | while IFS= read -r key; do
        case "$key" in
          assets/*) cc="public, max-age=31536000, immutable" ;;
          *)        cc="no-cache" ;;
        esac
        case "$key" in
          *.html) ct=text/html ;;
          *.css)  ct=text/css ;;
          *.js)   ct=application/javascript ;;
          *.json) ct=application/json ;;
          *.svg)  ct=image/svg+xml ;;
          *.png)  ct=image/png ;;
          *.ico)  ct=image/x-icon ;;
          *)      ct=application/octet-stream ;;
        esac
        aws s3api put-object --bucket "$BUCKET" \
          --key "$key" --body "$key" --cache-control "$cc" --content-type "$ct" >/dev/null || exit 1
      done
      echo "Uploaded SPA objects with per-path cache headers."
    '
}

cmd_start() { # raise the service to one task using the pushed ECR image
  guard_local_environment
  prepare_work_copy
  [ -f "$IMAGE_TAG_FILE" ] || { echo "ERROR: run the image step first" >&2; return 1; }
  tf apply -auto-approve \
    -var "api_image=$(cat "$IMAGE_TAG_FILE")" \
    -var "api_desired_count=1"
  # Persist the effective running config so a later plain plan does not
  # propose scaling to zero or falling back to the placeholder image.
  tf_var_set api_desired_count 1
  tf_var_set api_image "$(cat "$IMAGE_TAG_FILE")"
}

cmd_all() {
  cmd_up && cmd_init && tf apply -auto-approve && cmd_image && cmd_secrets \
    && cmd_frontend && cmd_start
}

SEC_TMP=
# Only act when executed directly so guard tests can source this file.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-all}" in
    up|init|plan|image|secrets|frontend|start|all) "cmd_$1" "${2:-}" ;;
    *) echo "usage: $0 {up|init|plan|image|secrets|frontend|start|all}" >&2; exit 2 ;;
  esac
fi
