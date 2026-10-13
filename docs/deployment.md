# AWS-shaped deployment with Floci

The accepted target is a private S3 SPA behind CloudFront, with `/api/*` routed through an ALB to private ECS Fargate tasks and private RDS PostgreSQL. **The production API image, Terraform network/data/secret foundation, ECS/ALB/ECR API serving and frontend delivery are implemented in Terraform; only a reproducible Floci deployment/smoke workflow remains.** Development Compose remains unchanged.

## Build and inspect the API

Run from the repository root with Docker available:

```sh
docker build --platform linux/amd64 -f apps/api/Dockerfile -t challenge-api:floci .
bash scripts/test-api-image.sh
```

The script first checks Docker's ignore policy with an in-memory synthetic build context, then builds the image and checks its runtime without credentials, runtime network access, a database or AWS. Python 3 and a local Linux Docker socket at `/var/run/docker.sock` are required for the fixture generator. It streams dummy files into a disposable container's tmpfs and mounts the host Docker executable/socket to build that local context (Docker access is privileged); no repository files are created. Docker build cache/images remain as ordinary build artifacts. The fixture uses Docker's legacy builder when buildx is unavailable in the helper container; `bash scripts/test-api-image.sh --ignore-only` runs just the regression. Trailing secret exclusions override recursive source allow rules: nested `.env` variants, keys and credential files are excluded while application modules (including `secrets.ts`) remain included. These filename rules are defense in depth, not detection of secrets embedded in ordinary source files. On ARM hosts, an amd64 builder/emulation is required. Terraform must select Fargate `X86_64` / `LINUX`; publish this image to the planned ECR repository later. No registry publishing or deployment is performed by these commands.

## Target architecture (planned)

```text
Browser --HTTPS--> CloudFront
                   | default: private S3 (SPA assets)
                   | /api/*: public ALB --> private Fargate :3001
                                            |--> private RDS PostgreSQL :5432
                                            |--> Secrets Manager / logs / optional provider
```

| Component | Why this choice / boundary |
| --- | --- |
| Fargate, not EC2 | Runs containers without managing EC2 instances, AMIs or host patching. Private tasks have no public IP. Floci models this with Docker, not actual AWS Fargate hardware or isolation. No EC2 or Amplify resources are planned. |
| CloudFront | Public TLS entry point and cache for static assets, with separate origins/behaviors for SPA and API. It is not a replacement for the API load balancer. |
| Private S3 | Block public access; allow CloudFront origin access control (OAC) to read only this bucket (implemented with an ARN-scoped bucket policy). Use the S3 REST origin, not a public website endpoint. |
| Public ALB | Receives the CloudFront API behavior and balances to an IP target group for Fargate. Health checks use `/api/health`; 200 means PostgreSQL is reachable, 503 means unhealthy. ALB is public by design; restrict origin access rather than assuming CloudFront hides it. |
| Private subnets | ECS and RDS live outside public subnets. Task ingress on 3001 comes only from the ALB security group; PostgreSQL ingress on 5432 comes only from the task security group. RDS must not be publicly accessible. |
| Outbound access | Private tasks still need ECR image pulls, logs and secret retrieval; plan suitable VPC endpoints or NAT. Optional OpenRouter calls need controlled internet egress. Private does not mean disconnected. |
| IAM | Execution role: scoped ECR pull, logs and referenced secret retrieval (plus KMS decrypt only when needed). Task role: only application AWS actions actually required; current API does not call the Secrets Manager SDK. Never grant blanket administrator access. |

These are intended AWS security boundaries, **not verified emulator protections**. Floci locally models AWS APIs using Docker. A successful local resource creation does not establish real network isolation, IAM enforcement, encryption, scaling, availability or performance. Public endpoints also need abuse controls and production hardening before any real release.

## Routing and caching contract

- Preserve `/api/*` paths when forwarding to ALB; support all API methods, query strings, `Authorization`, `Content-Type`, `Origin` and refresh cookies, and return `Set-Cookie`. Disable caching for **all API responses** (zero TTL / caching-disabled policy), not just login; forwarding headers alone does not prevent caching. Account for SSE and long provider requests when choosing ALB/CloudFront timeouts.
- Default behavior serves SPA assets from S3. Plan a viewer-request rewrite attached **only to the S3 behavior**: extensionless client routes such as `/tickets/123` become `/index.html`; preserve asset paths. Exclude `/api` as well as `/api/*` from SPA handling (add an exact `/api` behavior if necessary).
- Do not install distribution-wide 403/404-to-200 fallbacks: they can mask API authorization failures, missing routes and missing assets. API 401/403/404/5xx must reach the browser unchanged. Verify deep links and missing assets separately in the later smoke workflow.
- Cache fingerprinted static assets long-term; use short/no-cache revalidation for `index.html`. Keep the browser and API same-origin behind CloudFront. Set `AUTH_EXTERNAL_ORIGIN` to the external HTTPS origin; the API does not trust forwarded protocol headers. `NODE_ENV=production` enables Secure refresh cookies, so ordinary local HTTP is not a verified authenticated deployment path.

## Image and Terraform runtime contract

| Setting | Contract |
| --- | --- |
| Entrypoint | Exec-form `node dist/server.js`, working directory `/app/apps/api`, non-root `node` user; no watcher or source bind mount. |
| Platform / port | Linux amd64; listens on `0.0.0.0:3001`; `PORT` may override. Image sets `NODE_ENV=production`. `EXPOSE` does not publish a host port. |
| Assets | `/app/apps/api/dist` and adjacent `/app/apps/api/migrations`; all 19 ordered SQL files are read relative to the compiled initialization module, not the shell directory. Production dependencies live in `/app/node_modules`. Offline evaluation fixtures are not server runtime inputs and are not packaged. |
| Startup | Requires database connectivity and valid seed/signing configuration; applies idempotent migrations and seeds before listening. No separate migration command exists. Validate migration concurrency before scaling multiple tasks; migration SQL is not a verified distributed migration coordinator. |
| Required secrets | Inject `DATABASE_URL`, `DEMO_EMAIL`, `DEMO_PASSWORD`, `JWT_SECRET` through ECS secret references. Optional paired `SUPPORT_EMAIL` / `SUPPORT_PASSWORD`, and optional `OPENROUTER_API_KEY`, also stay backend-only. Seed passwords do not rotate existing accounts. |
| Ordinary environment | `PORT`, `NODE_ENV`, `AUTH_EXTERNAL_ORIGIN`, optional `OPENROUTER_MODEL`. Never place secrets in Docker ARG/ENV layers, task-definition plaintext, frontend `VITE_*` variables or committed examples. |
| Shutdown | Node receives SIGTERM directly and has a five-second application shutdown deadline. Plan task stop timeout and target deregistration consistently; graceful draining under load is unverified. |

Secrets Manager references keep values out of image layers and plaintext task definitions, but ECS injects values into the process environment; access to processes/task execution is sensitive. Secret rotation requires task replacement and application-specific handling. Terraform `sensitive` suppresses display, **not storage in state or plans**: avoid managing secret values in Terraform where possible, never commit state/plan files, and restrict/encrypt the eventual backend. Use clearly labeled dummy values only for local simulation; never publish expanded configuration, tokens or secret-bearing logs.

## Terraform foundation (T2a)

`infra/terraform` pins Terraform 1.9.8 and AWS provider 5.82.2; commit its generated lockfile. Run from the repository root; Docker downloads tooling without host installation:

```sh
docker run --rm -v "$PWD/infra/terraform:/work" -w /work hashicorp/terraform:1.9.8 init -backend=false
docker run --rm -v "$PWD/infra/terraform:/work" -w /work hashicorp/terraform:1.9.8 fmt -check -recursive
docker run --rm -v "$PWD/infra/terraform:/work" -w /work hashicorp/terraform:1.9.8 validate
docker run --rm -v "$PWD/infra/terraform:/work" -w /work hashicorp/terraform:1.9.8 test
```

Tests use a mocked AWS provider (including mock-only apply), not Floci or AWS provisioning. Do not run ordinary plan/apply against AWS. No backend is configured: state would be local, sensitive and ignored. Docker creates provider cache under the ignored `.terraform` directory.

### API serving state (T2b)

`infra/terraform/api.tf` adds the ECR repository (immutable tags, scan-on-push, KMS), an ECS Fargate cluster/task/service (x86_64 Linux, 256/512, awsvpc in the private application subnets, public IP disabled) and a public ALB forwarding IP targets to API port 3001 with the real `/api/health` route as the target health check. Execution and task roles are separate: the execution role carries the managed ECR/log policy plus `GetSecretValue` scoped to the seven application secret ARNs; the task role starts with no permissions and is the future grant point.

Bootstrap contract: `api_desired_count` defaults to 0 until the image is pushed and all seven Secrets Manager values exist. `DATABASE_URL` is populated out of band and is never the RDS-managed master secret JSON; Terraform never writes or prints secret values.

Image contract: `api_image` must be a locally pulled registry URI during emulation (for example `floci-challenge-api:latest`) or a normal AWS ECR URI on AWS. `api_certificate_arn` is empty only for local HTTP emulation; AWS mode rejects plain HTTP as non-production-ready and requires TLS termination on the ALB.

CloudFront note: implemented in T2c (below). In AWS mode the ALB ingress is now the CloudFront origin-facing managed prefix list; in local emulation the ALB stays plain HTTP on `0.0.0.0/0`, explicitly isolated.

| Contract | Foundation decision |
| --- | --- |
| Inputs | `local_emulation=true`, `local_endpoint=http://floci:4566`, `region=us-east-1`, `name=challenge`, `protect_database=false`. Region is a builder choice, with a/b AZ suffixes; verify AZ availability before any future AWS use. `local.tfvars.example` is safe to copy to an ignored `.tfvars`. |
| Isolation | Local mode forces dummy provider credentials, disables credential/metadata/account discovery, forces S3 path-style addressing and overrides EC2/ECR/ELBv2/IAM/Logs/RDS/Secrets Manager/STS/S3/CloudFront endpoints. Only Floci, loopback or Docker-host HTTP endpoints are accepted; no host credentials are mounted by these commands. Endpoint host resolution must remain trusted. T3 must extend the T2b/T2c endpoint allowlist for any further emulator service before use. |
| AWS mode | Separate `local_emulation=false` requires `allow_aws=true` and a 12-digit `aws_account_id`; provider enforces that account. Credentials come from the ordinary AWS chain, never examples. This opt-in is a safety guard, not authorization to deploy. |
| Network | Two AZs, separate public/application/database subnets. Public route to IGW; application route to one NAT in AZ a; database route is VPC-local only. NAT permits HTTPS ECR (including S3 layers), Secrets Manager, logs and optional provider calls. Single NAT is cheaper than per-AZ NAT but has an AZ dependency, cross-AZ costs and real AWS hourly charges; not production HA. |
| Boundaries | Empty ALB ingress awaits T2b's origin restriction. ALB egress/API ingress only 3001; API egress/DB ingress only 5432; API also permits internet HTTPS through NAT. No DB egress rule. VPC resolver DNS uses AWS's implicit resolver behavior. |
| Database | Encrypted gp3 PostgreSQL 16, 20 GiB, db.t3.micro, private, single-AZ with two-AZ subnet group and one-day backups. Demo allows deletion without final snapshot. `protect_database=true` enables deletion protection/final snapshot; repeated snapshot names need lifecycle planning. Not production HA or a restore-tested backup policy. |
| Secrets | AWS uses RDS-managed master credentials; local DB alone uses an explicitly dummy bootstrap password in state. Seven application secret containers have seven-day recovery and no versions. Populate required values separately in T3; optional containers may stay empty and must not be injected until populated. `DATABASE_URL` needs separate construction/population; the RDS master secret JSON is not a URL or an application least-privilege DB user. |
| Outputs | `network`: VPC, public/application subnet IDs and ALB/API/DB SG IDs; `database`: address, port, DB/user names and AWS master secret ARN (local null); `application_secret_arns`: environment-name -> whole-value ECS reference. No secret-content data sources or password outputs. |

Terraform sensitivity does not encrypt state: even the local dummy bootstrap is stored there. Manage application values outside Terraform, secure eventual remote state, and never publish expanded plans/logs. Managed credential and network behavior in Floci are **untested**; T3 must record unsupported operations rather than silently weakening AWS configuration.

## Frontend serving state (T2c)

`infra/terraform/frontend.tf` adds a private, SSE-S3-encrypted `${name}-frontend` bucket (all four public-access blocks enabled) reachable only through CloudFront origin access control: the bucket policy grants `s3:GetObject` to `cloudfront.amazonaws.com` conditioned on this distribution's ARN. Terraform manages no bucket objects; the T3 workflow uploads the built SPA.

| Contract | Frontend decision |
| --- | --- |
| Behaviors | Default behavior serves the S3 SPA (`redirect-to-https`); exact `/api` and `/api/*` ordered behaviors serve the ALB origin with all seven HTTP methods (`https-only`). |
| Caching | Two explicit custom cache policies (no reliance on managed policies, which are poorly modeled locally): `spa-cache` respects origin `Cache-Control` up to one year with an empty default TTL, `api-no-cache` has zero TTL on every axis and forwards all cookies, all query strings and `Authorization`/`Content-Type`/`Origin` headers. No authenticated API response is cached. |
| SPA rewrite | `spa-rewrite.js` is a CloudFront viewer-request function attached **only** to the S3 default behavior: root and trailing-slash URIs resolve to `<uri>index.html`, extensionless client routes to `/index.html`, assets keep their path, and `/api`/`/api/*` are guarded and never rewritten. Route cases pass a reproducible, dependency-free Node test (`infra/terraform/tests/spa-rewrite.test.mjs`; exact command below). |
| Error masking | No `custom_error_response` blocks exist; API 401/403/404/5xx and missing assets reach the browser unchanged. Deep links and missing assets are still to be verified in the T3 smoke workflow. |
| API origin | Local emulation uses the autogenerated ALB DNS over plain HTTP. AWS mode requires `api_hostname` (new variable) as an HTTPS origin: the hostname must resolve to the ALB via DNS **before** deployment and must match `api_certificate_arn`; CloudFront never presents TLS to the autogenerated ALB DNS as if the certificate matched. |
| Origin restriction | AWS ALB ingress uses the `com.amazonaws.global.cloudfront.origin-facing` managed prefix list (never `0.0.0.0/0`). **Shared CDN tenant limitation:** that prefix list is shared by all CloudFront customers, so other tenants' distributions can reach the ALB; a shared secret header via CloudFront origin custom headers would close this but adds a sensitive, state-stored value and is intentionally not implemented here. Local Floci restriction semantics differ and are unverified. |
| AUTH_EXTERNAL_ORIGIN | Nonsecret container environment derived from the distribution domain (`https://<distribution>.cloudfront.net`) without a Terraform cycle; never a secret value, never in the SPA bundle. Existing secret-map names are unchanged and no secret data source was needed. |
| Bootstrap | `api_desired_count` remains 0; nothing else in the T2b service contract changed. |
| Floci gaps | Floci docs state CloudFront functions are **stored but not executed** locally, so SPA deep links are **not tested in Floci**; the viewer rewrite is verified only by the Node route test. OAC signing, prefix-list enforcement and TLS behavior are likewise untested locally. T3 must allowlist the exact custom private origin hostnames before emulator use. |
| Outputs | New `frontend` output for the workflow: bucket name, distribution id/domain, external origin and API behavior patterns. `api` output drops `cloudfront_restriction_pending` (now `alb_ingress_restricted_to_cloudfront`). |

Reproducible SPA-rewrite test (Node 22 disposable container, no network, both source files mounted read-only):

```sh
docker run --rm --network none \
  -v "$PWD/infra/terraform/spa-rewrite.js:/spa-rewrite.js:ro" \
  -v "$PWD/infra/terraform/tests:/t:ro" \
  -w /t node:22-alpine node --test /t/spa-rewrite.test.mjs
```

## Evidence and next steps

| Check | T1 evidence / boundary |
| --- | --- |
| Docker daemon and amd64 image | Available; production image built successfully. |
| Packaging test | Passed: non-root, correct command/platform, production imports, no tsx/TypeScript/Vitest, all 19 migrations readable with read-only filesystem and no network. This does not execute migrations or start the server. |
| Docker ignore regression | Observed RED against the original policy: nested dummy env/key/credential files were copied. Corrected policy passes the same synthetic-context assertion, retaining `auth.ts`, `secrets.ts` and `server.ts`. No real secrets or source fixtures are used. |
| Host workspace typecheck/build | Both attempted; fail because `tsc` is absent from existing host dependency setup. No host dependencies installed. |
| Isolated workspace checks | Independent verifier passed isolated Node 22 container `npm ci`, both workspaces' typecheck/build and tests (417 tests / 33 files). These are prior verification evidence, not a server/database integration run. |
| Terraform / Floci / live app | T2a fmt/init/validate and mocked configuration assertions passed; emulator plan/apply remains pending. No AWS resources, emulator application run, persistence, TLS, SPA deep-link or auth smoke has been verified here. |

Next: T2b extends the foundation with application serving resources and scoped IAM; T3 adds a bounded Floci workflow and synthetic-data smoke. Keep AWS intent separate from observed emulator behavior and document gaps rather than treating simulation as a real AWS deployment.

Official Floci service references: [ECS](https://floci.io/docs/services/ecs/) and [CloudFront](https://floci.io/docs/services/cloudfront/). Check the selected Floci version's supported operations before implementation; these links are references, not evidence that this application has run on Floci.
