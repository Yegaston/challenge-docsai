# AWS-shaped deployment with Floci

The accepted target is a private S3 SPA behind CloudFront, with `/api/*` routed through an ALB to private ECS Fargate tasks and private RDS PostgreSQL. **Only the production API image is implemented here.** Terraform resources and a reproducible Floci deployment/smoke workflow are next steps, not available commands. Development Compose remains unchanged.

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
| Private S3 | Block public access; allow CloudFront origin access control (OAC) to read only this bucket. Use the S3 REST origin, not a public website endpoint. |
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

## Evidence and next steps

| Check | T1 evidence / boundary |
| --- | --- |
| Docker daemon and amd64 image | Available; production image built successfully. |
| Packaging test | Passed: non-root, correct command/platform, production imports, no tsx/TypeScript/Vitest, all 19 migrations readable with read-only filesystem and no network. This does not execute migrations or start the server. |
| Docker ignore regression | Observed RED against the original policy: nested dummy env/key/credential files were copied. Corrected policy passes the same synthetic-context assertion, retaining `auth.ts`, `secrets.ts` and `server.ts`. No real secrets or source fixtures are used. |
| Host workspace typecheck/build | Both attempted; fail because `tsc` is absent from existing host dependency setup. No host dependencies installed. |
| Isolated workspace checks | Independent verifier passed isolated Node 22 container `npm ci`, both workspaces' typecheck/build and tests (417 tests / 33 files). These are prior verification evidence, not a server/database integration run. |
| Terraform / Floci / live app | Pending. No AWS resources, emulator application run, persistence, TLS, SPA deep-link or auth smoke has been verified here. |

Next: implement the planned Terraform with explicit local emulator overrides, then a bounded Floci workflow and synthetic-data smoke. Keep AWS intent separate from observed emulator behavior and document gaps rather than treating simulation as a real AWS deployment.

Official Floci service references: [ECS](https://floci.io/docs/services/ecs/) and [CloudFront](https://floci.io/docs/services/cloudfront/). Check the selected Floci version's supported operations before implementation; these links are references, not evidence that this application has run on Floci.
