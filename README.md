# Support Ticket AI

A local-development app with a persistent demo account: React + TypeScript + Vite, shadcn/ui-compatible components with Tailwind CSS, an Express API, and PostgreSQL. Login protects per-user ticket storage and synchronous AI analysis through the implemented ticket UI.

## Start with Docker Compose

Requires **Make**, Docker Engine, and Docker Compose v2 with `up --wait` support; no host Node installation is needed. Run from the repository root:

```sh
# Copy only if absent; never overwrite existing local credentials.
if [ ! -e .env ]; then cp config/development.example .env; fi
```

Privately edit `.env` and fill in the three required application values: `DEMO_EMAIL`, `DEMO_PASSWORD`, and `JWT_SECRET`. Use a 12–256 character demo password and a cryptographically random signing secret of at least 32 bytes from a password manager. Compose fixes the known development-only database password to `support-dev-password`; neither `.env` nor an exported `POSTGRES_PASSWORD` overrides it. This public credential is not suitable for production. The template's export instructions apply to host Node; once copied to `.env`, Docker Compose loads it automatically. Use Compose dotenv syntax, not executable shell commands; single-quote values containing literal `$` or `#` characters.

```sh
make run   # Start detached and wait for healthy services.
make logs  # Follow API, web, and database logs; Ctrl-C exits the log viewer.
make stop  # Stop without removing containers or volumes.
make help  # Also the default for plain make; needs no Docker or credentials.
```

Open **http://localhost:5173** after `make run` succeeds. Missing or blank required credentials cause Compose to reject startup. `.env` is git-ignored, not encrypted: keep it private, do not commit or share it, and never share expanded `docker compose config` output. These credentials are backend-only; never put them in `VITE_*` variables.

**Manual exported-environment alternative:** Make is optional for direct Compose usage. In **Bash**, enter your own local values at the prompts (passwords and signing secret are not echoed or written into shell history). Exported shell variables override Compose `.env` values, so avoid stale exports when using the reusable file:

```sh
read -rp 'Demo login email: ' DEMO_EMAIL
read -rsp 'Demo password (12–256 characters): ' DEMO_PASSWORD; printf '\n'
read -rsp 'JWT secret (at least 32 random bytes from a password manager): ' JWT_SECRET; printf '\n'
export DEMO_EMAIL DEMO_PASSWORD JWT_SECRET
docker compose up --wait
```

`config/development.example` is a blank credential template, not loaded under that name. Keep the same local credentials for restarts, whether using `.env` or the exported-environment alternative.

Open **http://localhost:5173** and log in with the email/password you supplied. Your email appears after the protected API confirms your identity. Compose installs the locked dependencies before starting the applications; the first startup needs internet access to pull images and npm packages.

### UI walkthrough (no paid provider call required)

1. Log in, then select **New ticket**. Enter a synthetic support request and select **Create ticket**. Creation persists the ticket and starts a synchronous analysis request; the UI waits up to a minute. **Stop waiting** only stops the browser wait, not necessarily server processing.
2. Without `OPENROUTER_API_KEY`, the attempt is persisted as **failed** with code `unconfigured` (shown as a safe failure message in the UI): this is **not** a successful model result. Select **View ticket** to inspect the original text and failed attempt. Do not select **Try analysis again** merely to simulate success.
3. On the detail page, inspect **Latest analysis**, optionally enter a refinement instruction and select **Refine analysis** (another persisted attempt, also `unconfigured` without a key). **Earlier versions** preserve prior attempts. Use **Back to tickets** or **Tickets** for the history list and its latest status; return to the detail page to inspect versions.
4. Select **Log out**; the in-memory token is cleared and protected pages require login again. A real provider success requires a privately configured key and explicit cost approval; it is not part of this no-cost walkthrough.

```sh
curl --fail http://localhost:3001/api/health
curl --fail http://localhost:5173/api/health
# Both: {"status":"ok","database":"reachable"}
docker compose logs api web db
docker compose stop
```

The database persists in a named volume. Stopping services does not delete it. The fixed Compose password does not update an already-initialized database. For an existing volume with a different password, explicitly rotate the stored role through local container access (preserving data); do not reset or remove the volume:

```sh
docker compose up -d --wait db
docker compose exec -T db psql -U support -d support -v ON_ERROR_STOP=1 -c "ALTER ROLE support WITH PASSWORD 'support-dev-password';"
make run
```

If local `psql` access is denied, stop rather than bypass authentication.

## Develop with host Node

Requires **Node 22.12+**, **npm 10+**, and the same Docker prerequisites for PostgreSQL. Run from the root, using one terminal for development:

```sh
# First run the manual alternative's three prompts and export command above
# in this shell, even if you already filled in a Compose .env file.
docker compose up -d --wait db
export DATABASE_URL="postgresql://support:support-dev-password@127.0.0.1:${DB_PORT:-5432}/support"
npm ci
npm run dev
```

`npm run dev` starts both workspaces. Vite proxies `/api` to Express, so the browser uses the same origin and does not receive database credentials. Stop any Compose `api`/`web` services before running their host equivalents to avoid port conflicts.

For host Node, environment values must be exported into the process shell; the Node scripts do not automatically load `.env` or other environment files. Compose automatically reads the root `.env` for interpolation and supplies the configured container environment; Make neither includes nor shell-sources it. Never put credentials in `VITE_*` variables; these are public browser values.

| Variable | Used by | Default / requirement |
| --- | --- | --- |
| Database password | Compose database and API | Fixed development-only `support-dev-password`; `POSTGRES_PASSWORD` overrides are ignored |
| `DATABASE_URL` | Host API | Required PostgreSQL connection URL |
| `DEMO_EMAIL` | API only | Required seed email; trimmed and lowercased |
| `DEMO_PASSWORD` | API only | Required 12–256 characters; initial seed only |
| `JWT_SECRET` | API only | Required ≥32 UTF-8 bytes; use a cryptographically random secret |
| `OPENROUTER_API_KEY` | API only | Optional at startup; required for analysis; never expose to browser |
| `OPENROUTER_MODEL` | API only | `z-ai/glm-5.3-flash`; change to another structured-output-capable OpenRouter model |
| `DB_PORT` | Compose database host port | `5432`; export before host startup; the URL command above honors it |
| `PORT` | Host API | `3001`; Compose fixes the internal port |
| `API_PROXY_TARGET` | Vite server | `http://127.0.0.1:3001`; Compose sets `http://api:3001` |
| `WATCH_POLLING` | Vite server | Off on host; `true` in Compose for bind mounts |

## Demo authentication behavior

- Before listening, the API runs `apps/api/migrations/001-users.sql` and a parameterized seed, including on existing database volumes. The unique email and `ON CONFLICT DO NOTHING` preserve the original UUID and password hash on restart. Startup fails closed with a safe diagnostic if configuration, schema or seed fails.
- Passwords use asynchronous Node scrypt with a random 16-byte salt, 64-byte key and versioned `scrypt-v1` format (N=16384, r=8, p=1); comparisons are timing-safe. Unknown accounts still run password verification. Login JSON is limited to 4 KiB, email to 254 characters and password to 256 characters.
- `POST /api/auth/login` accepts JSON `{ "email": "<your email>", "password": "<your password>" }` and returns `{ token, expiresAt }` (expiry in Unix milliseconds). Incorrect credentials receive the same 401 error. `GET /api/auth/me` requires `Authorization: Bearer <token>` and returns `{ user: { id, email } }` from PostgreSQL, never the password hash.
- `jose` signs and verifies HS256 JWTs with fixed issuer `support-ticket-api`, audience `support-ticket-web`, persistent user ID as subject, and a 15-minute lifetime. Missing/invalid/expired tokens receive 401; database failures receive safe 503 errors. Auth responses are `no-store`.
- The browser keeps tokens only in React memory, never local/session storage or cookies. Reload, logout, expiry or a protected 401 requires login again. Requests are aborted/ignored on logout, expiry or unmount; a stale response cannot restore the session. Auth requests time out after 10 seconds; health remains public and independently retryable.

**Credential changes:** changing `DEMO_PASSWORD` does **not** update an existing user's hash. Keep the original local value; password reset/rotation tooling is outside this demo. Changing `DEMO_EMAIL` seeds a different account and leaves the original record intact. Changing `JWT_SECRET` invalidates all existing tokens; keep it stable for normal restarts.

**Local-only limitations:** no login rate limiting, account lockout, server-side logout/revocation or refresh tokens. A copied bearer token remains valid until expiry even after UI logout. Memory-only storage does not protect against active XSS. Before exposing this app, add HTTPS, abuse limits, secret management/rotation and deployment hardening; do not expose the development services to untrusted networks.

## Ticket persistence

All ticket routes require `Authorization: Bearer <token>` from login and return `Cache-Control: no-store`.

- `POST /api/tickets` accepts JSON `{ "text": "support request" }`, trims its edges, and requires 1–20,000 JavaScript characters after trimming. Embedded NUL characters receive 400 because PostgreSQL text cannot represent them. The JSON body limit is 128 KiB (including escaping); malformed input receives 400 and oversized bodies receive 413.
- Creation returns 201 `{ ticket: { id, text, createdAt } }`. UUID and UTC ISO timestamp are server-generated; supplied owner/ID/time fields are ignored. Tickets exist without an analysis.
- `GET /api/tickets` returns `{ tickets: [...] }` for the authenticated owner, newest first with descending UUID as the stable tie-break. An empty history returns `[]`.
- `GET /api/tickets/:id` returns `{ ticket: { id, text, createdAt, analyses: [...] } }`, with oldest-first analysis history (UUID tie-break), including running and failed attempts. Malformed UUIDs receive 400; unknown and other-owner records receive the identical 404. Owner IDs never appear in responses.
- Missing/invalid/expired auth receives 401. Database failures receive safe 503 errors without driver details.

On every startup, including existing volumes and built `dist` execution, the API applies `001-users.sql`, `002-tickets.sql`, then `003-analyses.sql` before seeding/listening. These migrations are idempotent; existing demo UUIDs and password hashes remain unchanged. Keep `apps/api/migrations/` beside `dist/`; no manual migration command is needed.

**Demo limitations:** history has no pagination, and ticket text is retained without a deletion/retention policy. For live persistence verification, create a ticket using a locally held bearer token, restart the API and database, then list/read it again. Use a second seeded account to confirm its list excludes the first account's tickets and detail returns 404. Never share tokens or ticket content in logs.

## Ticket analysis (API and UI)

Privately configure `OPENROUTER_API_KEY` in the Compose `.env`, or export it for host Node. Missing keys do not prevent auth/ticket startup; an analysis records `unconfigured` failure instead. Configure `OPENROUTER_MODEL` and restart the API to change models. No production fake adapter is used.

- Owner-protected `POST /api/tickets/:id/analyses` accepts an empty body or JSON `{ "instruction": "optional refinement" }`. A supplied instruction must be a string, trimmed, nonempty, ≤2,000 UTF-16 code units and NUL-free. JSON limit: 16 KiB; malformed/oversized analysis requests receive 400. Supplied owner fields are ignored.
- Success: 201 `{ analysis: { id, status, model, promptVersion, instruction, createdAt, completedAt, summary, category, uncertaintyNote, failureCode } }`. Dates are UTC ISO strings; `completedAt` is null while running. No owner IDs or raw errors are returned. Outputs are strict: summary 1–2,000 UTF-16 units, category `billing|account_access|technical_issue|other`, uncertaintyNote null or 1–1,000 units; narratives reject blank text and NUL. Failed/running output fields are null.
- Analysis errors use `{ error: "safe human-readable reason", code: "safe_code", analysis?: <saved failed attempt> }`: 400 `invalid`, 404 `missing` (unknown and non-owner indistinguishable), 429 `limit`, 504 `timeout`, 502 `provider|invalid_output|unconfigured`, 503 `database`. Failure analysis is included only after confirmed persistence. Shared auth keeps its existing `{ error }` envelope: 401 for absent/invalid/expired tokens, 503 for unavailable identity storage. Every protected response is `no-store`.
- Each attempt is durably inserted before any provider call. PostgreSQL nonblocking per-user advisory locking serializes count/insert and stays held on its acquired client through generation/final save. At most one active call per user and five durable starts in the rolling minute (failed attempts count). Other users are independent; hash collisions can conservatively block unrelated users. Existing bounded pool acquisition/query waits return safe database failures.
- Generation uses Vercel AI SDK and OpenRouter, a 60-second abort signal, 1,800 output-token cap, zero automatic retries and disabled provider fallbacks. Cancellation aborts fetch and always releases/destroys the held database client, including error paths. No background jobs, polling, streaming, tools, RAG, model picker or fallbacks.
- `ticket-analysis-v1` lives in `modules/analyses/utils/prompt.ts`. Only original ticket text and the current instruction enter the prompt, never previous AI results. The system requests grounded conclusions and narratives in the ticket's language; summary/category/uncertainty may all change on refinement. Strict SDK output parsing plus independent validation reject malformed output without guessing fields. Prompt injection is mitigated by separating untrusted JSON data from system instructions, not guaranteed prevented; semantic accuracy/language adherence still require evaluation. No secrets or tools enter the prompt.
- Every retry is a new version; previous successes/failures remain. A process crash can leave a durable `running` attempt even though the connection lock is released. Final-save/connection failure returns 503 without claiming completion; the database may contain a running attempt or a completed write whose acknowledgement was lost. Reload history before deciding to retry: another paid call can incur another charge. There is no interrupted-attempt recovery worker or exactly-once billing guarantee.

**Live opt-in smoke:** no paid calls are part of deterministic checks. With explicit cost approval and a privately configured key, create a small synthetic ticket and POST to its analyses route with a locally held bearer token; check persisted success, language, grounding, category and a refinement after reload. Never print headers/secrets or use customer data. The real-provider smoke was declined; catalog capability metadata is not evidence of model quality. Isolated PostgreSQL persistence and API/browser no-key paths passed Task 6 verification; live uncertain-ACK remains mock-only (see the [handoff](odd/handoffs/task-6-verify-handoff.md)).

**Data and trust flow:** The browser holds the bearer token in React memory only and sends it to owner-protected API routes; Express persists tickets and analysis attempts in PostgreSQL. When configured, the server sends the original ticket text and only the current refinement instruction to OpenRouter; each attempt persists its result or failure for detail/history display. The optional provider key stays server-side; never expose it via `VITE_*`. The selected model and `ticket-analysis-v1` prompt version are recorded per attempt. Ticket text and instructions are untrusted data separated from system instructions, not a guarantee against prompt injection; model quality, grounding and language adherence need evaluation.

**Production boundary:** The implemented limit is five durable analysis starts per user in a rolling minute, with at most one active call per user; failed starts count. This is not a spending cap. Production needs per-account and global budgets, provider quotas, backpressure, cost/error/latency monitoring, and crash reconciliation. **Part 2 is deferred:** privacy/PII handling, deletion and retention policy, and systematic evaluation. **Part 3 is deferred:** cloud infrastructure as code and deployment. This local demo is not production hardened.

## Checks

```sh
sh -n scripts/test-compose-dev-password.sh
sh scripts/test-compose-dev-password.sh  # Dummy app values; no .env reads.
sh -n scripts/test-make.sh
sh scripts/test-make.sh  # Isolated Docker stub; no live services or credentials.
npm ci
npm test
npm run typecheck
npm run build
docker compose config --quiet  # Requires local credentials; no expanded output.
make run                      # Live check; requires Docker and local credentials.
```

Tests cover ticket create/list/detail, validation boundaries, owner isolation, SQL parameters/order, startup migrations and safe failures, as well as password hashing, conflict-safe seeding, JWT negative cases, auth/UI regressions and public health. Database access is mocked in unit tests; these do **not** prove real PostgreSQL persistence. The two `curl` commands above verify live database health and the Vite proxy.

For a live auth/persistence check: log in in the browser, open **Tickets**, then log out and confirm the login form returns. `curl -i http://localhost:5173/api/auth/me` without a token must return 401. Restart the API with `docker compose restart api`, then log in again with the original credentials. Using a temporary different `DEMO_PASSWORD` with the same email and recreating the API must leave only the original password valid; restore your original local environment value afterward. Do not print or share bearer tokens, hashes, or secrets when inspecting requests. Check rendering in a real browser as well.

To check live reload, edit text in `apps/web/src/App.tsx` and confirm the browser updates; edit `apps/api/src/app.ts` and confirm the API restarts. Source is bind-mounted in Compose, Vite uses polling, and the API uses `tsx watch`. On platforms where native API filesystem events do not propagate, run the host Node development path.

## Layout and development behavior

```text
Browser → Vite :5173 → /api proxy → Express :3001 → PostgreSQL :5432
apps/web/  React UI, Tailwind theme, shadcn/ui configuration and Button
apps/api/  Composition root, auth/users/health/tickets/analyses feature modules, migrations and tests
```

- API features live in `apps/api/src/modules/{auth,users,health,tickets,analyses}`. Each HTTP feature has an `http/` controller; module-local `services/`, `repositories/`, and `utils/` folders hold the applicable implementations. Services use plain inputs/results and repository contracts without Express or HTTP status codes. Auth's reusable `login` and `identity` services own JWT verification and database-resolved identity, and depend only on the users lookup contract. Users has no HTTP routes yet; its seed service accepts injected hashing/ID dependencies. There is no empty auth repository because only users persist.
- `server.ts` composes concrete repositories and auth HTTP handling before listening. `infrastructure/initialize-users.ts` validates seed configuration, loads ordered users/tickets/analyses migrations relative to the original source/build root, then calls the users seed service. SQL lives in repositories; password hashing lives in auth's `utils/password.ts`. Root `auth.ts` and `demo-user.ts` retain compatibility exports for existing callers/tests, not duplicate implementations.
- `GET /api/health` executes `SELECT 1`. It returns HTTP 200 with `database: "reachable"`, or HTTP 503 with `database: "unreachable"`. Connection/query timeouts bound failures; responses never expose driver errors or connection strings.
- `apps/web/components.json`, the `@/` alias, theme tokens, `cn`, and the local Radix/CVA Button provide the shadcn/ui setup. The Button is a small source-owned adaptation, not a claim that a generator was run.
- Root scripts fan out to npm workspaces. The root Vitest override keeps optional tooling peers on the same patched 4.1 release; npm 10 otherwise encounters a peer-resolution error. API build output is `apps/api/dist`; Vite output is `apps/web/dist`. `npm run start -w @support/api` runs the built API with `DATABASE_URL`, `DEMO_EMAIL`, `DEMO_PASSWORD`, and `JWT_SECRET` exported; keep `apps/api/migrations/` alongside `dist/`. Frontend static hosting and production routing are out of scope.
- Compose uses a single dependency-install service and shared container-only root and workspace `node_modules` volumes, separate from host dependencies and Vite caches. After changing dependencies, stop the app services, rerun `docker compose run --no-deps dependencies`, then run `docker compose up --wait`.
- Published Docker ports bind to localhost. The Node/Vite dev servers listen on all interfaces for container access; run host development only on a trusted machine/network.
- This is development infrastructure, not a hardened production deployment. There are no signup/reset/refresh/roles or cloud infrastructure in this task.

Review UI create → analysis → detail/refinement/history and uncertain-wait handling alongside analysis owner scoping, durable attempt start, lock lifecycle, SDK timeout/validation, migrations, and auth/ticket regressions. Independent Task 6 checks covered Chromium, PostgreSQL and Compose without a provider key; the paid-provider success and model quality remain unverified (see the [handoff](odd/handoffs/task-6-verify-handoff.md)).
