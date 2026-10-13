# Support Ticket AI

A local-development app with a persistent demo account: React + TypeScript + Vite, shadcn/ui-compatible components with Tailwind CSS, an Express API, and PostgreSQL. Login protects a chat-first synthetic transfer-support flow and the existing ticket/analysis UI. Chat can clarify, perform customer-scoped read-only lookups, or hand off to a separate human support account.

## Start with Docker Compose

Requires **Make**, Docker Engine, and Docker Compose v2 with `up --wait` support; no host Node installation is needed. Run from the repository root:

```sh
# Copy only if absent; never overwrite existing local credentials.
if [ ! -e .env ]; then cp config/development.example .env; fi
```

Privately edit `.env` and fill in the three required application values: `DEMO_EMAIL`, `DEMO_PASSWORD`, and `JWT_SECRET`. For the optional shared human-support inbox, set BOTH `DEMO_SUPPORT_EMAIL` and `DEMO_SUPPORT_PASSWORD` to a distinct login (12–256 character password), or leave BOTH blank. Compose maps these to backend `SUPPORT_EMAIL` and `SUPPORT_PASSWORD`; a partial pair fails API startup. An absent/blank pair skips support seeding without removing an existing support account. Use a 12–256 character demo password and a cryptographically random signing secret of at least 32 bytes from a password manager. Compose fixes the known development-only database password to `support-dev-password`; neither `.env` nor an exported `POSTGRES_PASSWORD` overrides it. This public credential is not suitable for production. The template's export instructions apply to host Node; once copied to `.env`, Docker Compose loads it automatically. Use Compose dotenv syntax, not executable shell commands; single-quote values containing literal `$` or `#` characters.

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

**Quick customer path (synthetic data only):**

1. Sign in with the customer demo login and open **Demo transfers** (customer-only). Enter an amount such as `12.34` (positive, exactly two decimal places), today's **UTC date**, and **Pending**; select **Add synthetic transfer**. No bank is contacted and no money moves.
2. Find the new **DEMO** record in **Demo history** and note its generated ID, amount, date and status. Select **Ask agent about this** to open Chat with an ID-based **draft**; it is not sent automatically. Review it and send with Enter or the send button. Shift+Enter adds a newline; Enter during IME composition does not send.
3. On narrow screens use **Show history** / **Hide history** to access conversations. While waiting, the activity indicator says a response is being prepared; it does not confirm bank access or transfer status. Without a provider key, an AI response is unavailable. Do not run a paid-provider smoke without explicit cost approval.

Chat is the primary customer screen. Log in as the customer and open a conversation with a synthetic transfer question. The previously observed 201 response with a generic English fallback to a Spanish transfer question created a conversation successfully; it was an unhelpful clarification, **not an HTTP error**. Clarifications are now server-authored in Spanish or English and can include structured quick-choice buttons for owner-scoped recent synthetic transfers. Choose a matching record or provide its exact ID or amount **and** date; the agent asserts transfer status only after that identification is confirmed. If no choice matches, provide the missing details or request human help. Choices, tool activity and messages persist for reload. Without a provider key, do not claim an AI answer succeeded: the no-key path is unavailable; the deterministic tests use a fake provider. To exercise human handoff without a paid call, request support explicitly and sign in separately with the configured support login to inspect the shared escalated inbox and reply. The customer sees the same thread and can continue messaging; AI no longer replies after escalation. An unanswered persisted agent clarification escalates after four elapsed hours; customer response or resolution cancels that deadline. Do not use real bank details.

**Legacy ticket/analysis walkthrough:**

1. Log in, then select **Tickets**, then **New ticket**. Enter a synthetic support request and select **Create ticket**. Creation persists the ticket and starts a synchronous analysis request; the UI waits up to a minute. **Stop waiting** only stops the browser wait, not necessarily server processing.
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
| `DEMO_SUPPORT_EMAIL`, `DEMO_SUPPORT_PASSWORD` | Compose interpolation | Optional pair mapped to API `SUPPORT_EMAIL`, `SUPPORT_PASSWORD`; both blank skips seed, partial pair fails startup |
| `SUPPORT_EMAIL`, `SUPPORT_PASSWORD` | Host API | Optional separate support seed pair (password 12–256 characters); no role self-assignment |
| `JWT_SECRET` | API only | Required ≥32 UTF-8 bytes; use a cryptographically random secret |
| `OPENROUTER_API_KEY` | API only | Optional at startup; required for analysis; never expose to browser |
| `OPENROUTER_MODEL` | API only | `z-ai/glm-5.3-flash`; change to another structured-output-capable OpenRouter model |
| `DB_PORT` | Compose database host port | `5432`; export before host startup; the URL command above honors it |
| `PORT` | Host API | `3001`; Compose fixes the internal port |
| `API_PROXY_TARGET` | Vite server | `http://127.0.0.1:3001`; Compose sets `http://api:3001` |
| `WATCH_POLLING` | Vite server | Off on host; `true` in Compose for bind mounts |

## Demo authentication behavior

- Before listening, the API runs ordered migrations and parameterized customer and optional support seeds, including on existing database volumes. The unique email and `ON CONFLICT DO NOTHING` preserve the original UUID and password hash on restart. Startup fails closed with a safe diagnostic if configuration, schema or seed fails.
- Passwords use asynchronous Node scrypt with a random 16-byte salt, 64-byte key and versioned `scrypt-v1` format (N=16384, r=8, p=1); comparisons are timing-safe. Unknown accounts still run password verification. Login JSON is limited to 4 KiB, email to 254 characters and password to 256 characters.
- `POST /api/auth/login` accepts JSON `{ "email": "<your email>", "password": "<your password>" }` and returns `{ token, expiresAt }` (expiry in Unix milliseconds). Incorrect credentials receive the same 401 error. `GET /api/auth/me` requires `Authorization: Bearer <token>` and returns `{ user: { id, email, role } }` from PostgreSQL, never the password hash.
- `jose` signs and verifies HS256 JWTs with fixed issuer `support-ticket-api`, audience `support-ticket-web`, persistent user ID as subject, and a 15-minute lifetime. Missing/invalid/expired tokens receive 401; database failures receive safe 503 errors. Auth responses are `no-store`.
- The browser keeps tokens only in React memory, never local/session storage or cookies. Reload, logout, expiry or a protected 401 requires login again. Requests are aborted/ignored on logout, expiry or unmount; a stale response cannot restore the session. Auth requests time out after 10 seconds; health remains public and independently retryable.

**Credential changes:** Changing the support seed password also does not rotate an existing support account; the unique-email conflict-safe seed preserves its identity and hash across restarts. Use a distinct email from the customer seed. Changing `DEMO_PASSWORD` does **not** update an existing user's hash. Keep the original local value; password reset/rotation tooling is outside this demo. Changing `DEMO_EMAIL` seeds a different account and leaves the original record intact. Changing `JWT_SECRET` invalidates all existing tokens; keep it stable for normal restarts.

**Local-only limitations:** no login rate limiting, account lockout, server-side logout/revocation or refresh tokens. A copied bearer token remains valid until expiry even after UI logout. Memory-only storage does not protect against active XSS. Before exposing this app, add HTTPS, abuse limits, secret management/rotation and deployment hardening; do not expose the development services to untrusted networks.

## Ticket persistence

All legacy ticket and analysis routes require a customer-role `Authorization: Bearer <token>` from login (authenticated support receives 403) and return `Cache-Control: no-store`.

- `POST /api/tickets` accepts JSON `{ "text": "support request" }`, trims its edges, and requires 1–20,000 JavaScript characters after trimming. Embedded NUL characters receive 400 because PostgreSQL text cannot represent them. The JSON body limit is 128 KiB (including escaping); malformed input receives 400 and oversized bodies receive 413.
- Creation returns 201 `{ ticket: { id, text, createdAt } }`. UUID and UTC ISO timestamp are server-generated; supplied owner/ID/time fields are ignored. Tickets exist without an analysis.
- `GET /api/tickets` returns `{ tickets: [...] }` for the authenticated owner, newest first with descending UUID as the stable tie-break. An empty history returns `[]`.
- `GET /api/tickets/:id` returns `{ ticket: { id, text, createdAt, analyses: [...] } }`, with oldest-first analysis history (UUID tie-break), including running and failed attempts. Malformed UUIDs receive 400; unknown and other-owner records receive the identical 404. Owner IDs never appear in responses.
- Missing/invalid/expired auth receives 401. Database failures receive safe 503 errors without driver details.

On every startup, including existing volumes and built `dist` execution, the API applies ordered migrations `001` through `018` (including conversations, transfer-agent, idempotency, handoff integrity, clarification options and synthetic transfer fixtures) before seeding/listening. These migrations are idempotent; existing demo UUIDs and password hashes remain unchanged. Keep `apps/api/migrations/` beside `dist/`; no manual migration command is needed.

**Demo limitations:** history has no pagination, and ticket access ends at 90 days after each ticket's creation (strict database-clock cutoff), and owners may still delete expired rows; a bounded physical purge runs on startup and every 15 minutes. Busy owners are retried on subsequent passes; outages can cause unbounded removal lag and content-free backlog warnings surface remaining rows. Backups and provider copies are not erased by this sweep. For live persistence verification, create a ticket using a locally held bearer token, restart the API and database, then list/read it again. Use a second seeded account to confirm its list excludes the first account's tickets and detail returns 404. Never share tokens or ticket content in logs.

## Chat-first synthetic transfer support

**Demo fixture API:** Authenticated customers can `GET /api/synthetic-transfers` for their own recent history and `POST /api/synthetic-transfers` with JSON `{ "amount": "12.34", "date": "YYYY-MM-DD", "status": "pending", "idempotencyKey": "<UUID>" }`. The date must be a valid UTC calendar day from today back through 90 days; amount is a positive decimal string with exactly two fractional digits. Status may also be `completed` or `failed`. The server derives the owner from authentication and generates the record ID; supplied owner/ID fields are rejected. Other customers cannot list these records, and support receives 403 for both routes. Creation returns 201; an identical same-owner, same-key, same-payload retry returns the existing record with 200, while changing the payload for that key returns 409. At most 100 records per owner are active (429 at the limit); reads and admission use a 90-day creation-time window, and expired rows are physically purged in bounded sweeps, so physical removal may lag. After a network/503 uncertainty, refresh history first or retry the **same UUID and payload**; do not assume the original POST failed or create a new record without acknowledging uncertainty.

Server-assigned `customer` and `support` roles share the login endpoint; users cannot select their role. Customers create and read their own conversations, request human handoff, and resolve their own threads. Support can see only escalated conversations in the shared inbox and send human replies; support cannot impersonate customers, start customer conversations, run synthetic transfer tools or access customer-only ticket/analysis routes. Other customers cannot read a thread. The linked handoff ticket contains a generic pointer, not a transcript; both roles view the same persisted messages in the conversation.

The transfer tool reads synthetic customer-scoped records only; it does not move money or access bank systems. The recent-transfer fixture uses a rolling UTC day, so examples stay relative to the current day rather than proving any real bank activity. The bounded agent asks for missing evidence rather than inventing status; Spanish and English safe clarifications and structured choices do not turn an unidentified transfer into a verified status. An explicit support request or “I don't know” can hand off immediately. A persisted unanswered clarification starts a four-elapsed-hour deadline; the escalation worker uses database time and creates at most one linked ticket despite retries. Customer replies and resolution clear pending deadlines. After handoff, humans can continue messaging while the AI stays inactive.

Authenticated `POST /api/conversations/stream` and `POST /api/conversations/:id/messages/stream` return SSE for creation and agent replies. A `checking` frame precedes service work; after the final answer is server-validated and durably persisted, the stream reveals that approved text incrementally, character by character (grapheme by grapheme). This is **not raw LLM token streaming**: tool work and validation finish before answer deltas begin. The existing JSON create/reply routes remain compatible; human-mode messages use JSON rather than triggering AI streaming. A disconnected stream or uncertain acknowledgement does not justify automatically starting another provider call.

Chat send requests use UUID idempotency keys: retry the *same* key and payload after a transport failure, inspect the refreshed thread before choosing a new key, and do not assume an uncertain provider outcome was free. Reusing a key with different content is rejected; concurrent requests can return busy and uncertain acknowledgement can require refresh. This is not exactly-once provider billing. Conversation content has a strict 90-day access window and bounded physical purge; downtime can delay deletion. Existing ticket, analysis, and report audit events carry safe identifiers/metadata without ticket content and are best effort, not a complete compliance trail. Chat messages, handoffs, and tool events are persisted but do not currently emit audit events. Database audit cleanup is bounded at 180 days; external logs, backups and provider retention remain unverified. Live chat AI needs a privately configured `OPENROUTER_API_KEY`; no paid provider call is authorized for this documentation/check slice. Provider accuracy and language adherence remain unverified. An isolated PostgreSQL and HTTP SSE check exercised migrations, synthetic fixtures, persisted options and same-key replay with a fake agent; it does not prove live-provider behavior, socket disconnect/backpressure under load, or browser and screen-reader accessibility. Use synthetic data only: privacy, provider retention and handling of real financial details require separate review. Existing ticket and analysis routes remain available under **Tickets**.

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

**Production boundary:** The implemented limit is five durable analysis starts per user in a rolling minute, with at most one active call per user; failed starts count. This is not a spending cap. Production needs per-account and global budgets, provider quotas, backpressure, cost/error/latency monitoring, and crash reconciliation. Part 2 adds local data-governance and reporting controls described below, but external retention, provider/privacy review and a human release decision remain open. **Part 3 is deferred:** cloud infrastructure as code and deployment. This local demo is not production hardened.

## Part 2 — implemented controls and open production decisions

The local demo implements the access, deletion, audit, offline evaluation and same-user reporting controls described below; proposed operational and legal controls are not implemented production protections. Physical removal can lag indefinitely during downtime; backup and provider erasure are not guaranteed. Until its privacy and operational controls exist, use synthetic tickets for assessment runs. A production deployment could accept real tickets, but would send the original ticket text and current instruction **including any PII, without redaction**, to OpenRouter. Minimize collection to what support needs; before sending real data, establish a valid legal basis and clear notice to users, review the provider's data-processing terms, retention and transfer conditions, and restrict access to the stored originals. Neither the current UI nor API obtains consent, removes PII or enforces this policy.

| Data | Current demo | Proposed production handling |
| --- | --- | --- |
| Ticket text, refinement instructions, analysis versions | Stored in PostgreSQL with a bounded automatic purge on startup and at 15-minute intervals. Authenticated owners can delete a ticket and its analysis history (including orphan running attempts) when no analysis holds that owner's lock; absent/foreign tickets return 404. Application list/detail reads and new analysis starts enforce a strict 90-day database-clock cutoff per ticket; physical purge retries busy owners but can lag; backup expiry and provider erasure remain pending. Each version records status, model and prompt version until deletion. | Expire all application reads and new analysis starts at 90 days after ticket creation; offer owner-requested deletion. Purge the ticket and associated inputs/outputs in bounded, retried sweeps after any in-flight analysis releases its lock. Physical removal may lag the access deadline, especially while the service is down; define an operational alert for backlog and a separate backup expiry/deletion schedule. Do not claim immediate removal from provider storage or immutable backups. |
| Provider request/response | The original ticket and current instruction are sent to OpenRouter when configured. Raw provider payloads and SDK errors are not intentionally persisted by this app; provider-side retention has not been verified. | Contractually review provider retention, training use and deletion before real-PII processing. Do not store raw provider payloads beyond the validated analysis fields. |
| Logs and audit events | Successful ticket list/detail, owner deletion, durable analysis start and durable analysis outcomes write fixed-vocabulary, content-free metadata (owner/ticket/attempt IDs, safe failure code, timestamp) to `audit_events`; a start event does not prove the provider received a request. Deletion does not cascade to audit rows. Audit writes are best effort and cannot block reads, deletion or analysis; failures emit only generic diagnostics, so completeness is not promised. An indexed, bounded batch of up to 100 rows strictly older than 180 days is deleted at startup and every 15 minutes with retry and count-only backlog diagnostics; outage or contention may delay removal indefinitely. Wrong-answer report and correction metadata events are also attempted without explanation or correction content; these writes are best effort, not a complete compliance trail. External log-retention enforcement does not exist. | Log actor, ticket/attempt IDs, event/time, model/prompt version, outcome and latency—not ticket text, outputs, bearer tokens or secrets. Validate restricted access and any required completeness for access, provider submission, review and deletion events; the current start event is not proof of provider submission. The 180-day database-audit batch cleanup is implemented; 30-day external diagnostic-log retention remains an unimplemented operational policy to validate against applicable obligations. |
| Quality samples | No production sampling or evaluation dataset exists. | No customer sampling is implemented. Any future anonymized sampling requires separate validation and access/retention policy; do not sample raw customer text by default. |

**Offline evaluation before a prompt or model change:** A versioned synthetic dataset and illustrative baseline/candidate outputs live in `apps/api/evaluation/`. Run `npm run evaluate -w @support/api -- evaluation/fixtures/v1.json evaluation/examples/baseline.json evaluation/examples/candidate.json` from the repository root. The CLI reads three local artifacts, writes JSON only to stdout, and never invokes a model or writes files. It rejects missing, unknown or duplicate IDs and dataset-version mismatches; malformed strict-schema outputs appear as fixture-level failures. Category accuracy, per-category failures, uncertainty presence and the category delta are deterministic checks, not quality scores for grounding or language. The included candidate intentionally regresses; the examples are not model-generated evidence. Have a human review grounding, warranted uncertainty and language for every fixture, including injection, then record the named reviewer, date, accept/reject/hold and notes using `apps/api/evaluation/REVIEW_TEMPLATE.md` in a separate controlled artifact. The report always leaves release undecided; there is no automatic acceptance threshold or enforced release gate. No customer samples, paid calls, latency or cost measurements are included.

**When an answer is wrong:** The API and same-user UI let an authenticated owner select a succeeded analysis version, report it, and append corrections without overwriting the original or earlier corrections. This demonstration is not independent QA or human release approval. Operational triage of repeated or high-impact errors, prompt/model rollback and notification when appropriate remain decisions for a human. Authenticated owners can POST `/api/tickets/:id/analyses/:analysisId/reports` with `{ "explanation": "..." }` (nonblank, at most 2000 characters) and GET `/api/tickets/:id/reports` while the ticket is live. One open report per succeeded analysis version is allowed; duplicate requests return 409. Responses label `reviewMode: "same_user_demo"`: this is not independent review. Reports cascade with analysis deletion; audit records identifiers only, not explanations. Implemented: POST `/api/tickets/:id/reports/:reportId/corrections` with `{ "correction": "..." }` and GET of the same path append and list chronological same-owner corrections on live tickets. POST marks the report `reviewed` without changing its explanation or original analysis; repeated POST appends. Corrections cascade on report deletion. `reviewMode: "same_user_demo"` remains non-independent; audit records only identifiers. The ticket detail UI displays report status and same-user correction history, including earlier analysis versions. Human release evaluation remains offline and undecided; no separate reviewer role or enforced gate exists.

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
- This is development infrastructure, not a hardened production deployment. There is no signup/reset/refresh or cloud infrastructure; customer/support roles are server-assigned.

Review UI create → analysis → detail/refinement/history and uncertain-wait handling alongside analysis owner scoping, durable attempt start, lock lifecycle, SDK timeout/validation, migrations, and auth/ticket regressions. Independent Task 6 checks covered Chromium, PostgreSQL and Compose without a provider key; the paid-provider success and model quality remain unverified (see the [handoff](odd/handoffs/task-6-verify-handoff.md)).
