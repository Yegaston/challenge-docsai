# Support ticket AI — Part 1 implementation briefs

**Status:** Task 1 in progress; Tasks 2–6 not started.\
**Source:** [`CHALLENGE.md`](../../CHALLENGE.md), Part 1 and Deliverables.\
**Objective:** A locally runnable, authenticated full-stack app that summarizes and classifies pasted support tickets, saves results, and lets the user refine an analysis.

## Agreed scope

- React frontend with shadcn/ui; Node.js/Express REST backend; PostgreSQL persistence; Vercel AI SDK with OpenRouter; Docker Compose for local development.
- Input is pasted **text**, not document upload. Categories: `billing`, `account_access`, `technical_issue`, `other`. One ticket may receive one primary category; the summary includes an uncertainty note when the input does not support a clear conclusion.
- Seeded demo account, login screen, short-lived JWT bearer token, protected per-user records. No registration, refresh token, roles, or password reset. Frontend token stays in memory; reload/expiry requires login again.
- Default model: `z-ai/glm-5.3-flash`. `OPENROUTER_MODEL` selects another OpenRouter model ID (for example `deepseek/deepseek-chat`) without changing source. `OPENROUTER_API_KEY` is backend-only. Mock model is for deterministic tests/local verification, not a substitute for demonstrating a real call.
- Prompt construction, model invocation, and output validation/post-processing are separate modules. Version the prompt in source and record the model ID and prompt version with each analysis. Reject malformed output rather than presenting guessed fields.
- Three routes/views: Login, New ticket, Ticket results/history. Show pending, empty, failure, and completed states. Refinement sends an instruction for the original ticket and creates a new analysis version. No streaming or token-by-token partial output; show processing status and make uncertainty visible.
- Docker is a **development convenience**, not the cloud deployment requested in Part 3. No infrastructure-as-code or production deployment in this iteration.

## Delivery and review rules

- Sequence: PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6, managed as a stacked PR chain with `gh stack` (GitHub CLI stack support). Each PR builds on its immediate predecessor; PR 1 targets `main` and each later PR targets the previous stack branch until its parent merges. Use `gh stack` to create/update/restack the chain instead of manually managing stacked branches. Verify each PR's diff contains only its review unit after stack updates or parent merges. No PR, push, or merge is authorized by these briefs.
- Target **≤400 additions + deletions per non-scaffold PR**, including relevant tests and docs. PR 1 may exceed this for generated scaffolding; separate generated/config churn from substantive design in its review notes. Check actual diff before opening a PR. Never omit tests or compress code to meet the target; if a coherent unit cannot fit, report the overage and seek a size exception or a meaningful split.
- Every PR should state its stack position, base/parent PR, dependency, scope, exclusions, how to run its checks, and what the reviewer should inspect first. Keep each branch usable with its own relevant checks. Conventional work-unit commits belong with their tests and documentation when implementation is authorized.
- Implementation is authorized for Task 1 only. Tasks 2–6 remain out of scope for this iteration. These are review boundaries, not a commitment to exact line counts.

## Progress

- **TDD mode:** off by explicit user choice for Task 1; functional checks still required. Test runner: `npm test` (workspace root, to be implemented).
- **Delivery strategy:** stacked PR chain per agreed scope; no push/PR authorized.
- [ ] **T1:** Scaffold a locally runnable workspace. Acceptance: frontend loads, backend health reports database reachability, and fresh-checkout instructions work. Checks: dependency installation, build/typecheck, Compose config/start, HTTP/UI smoke test. **Evidence:** `npm ci` (314 packages, zero reported vulnerabilities), `npm test` (API 3/3, web 6/6), `npm run typecheck`, `npm run build`, isolated `docker compose -p support-ticket-verify config --quiet` and `up --wait` (healthy API/web/db), direct and proxied `/api/health` both 200 with database reachable, web HTML served; isolated services stopped, volumes retained. Browser visual walkthrough and live reload skipped; jsdom interaction states and HTTP were checked. Initial generated Vite cache ownership blocked a first host recheck; targeted ownership repair and successful clean recheck followed. `.env.example` was blocked by tool safety policy; `config/development.example` supplies the credential-free template instead. **Commit:** pending explicit authorization; do not mark complete until work-unit commit and any review obligations close.
- [ ] **T2:** Protect the demo account flow (deferred).
- [ ] **T3:** Save and retrieve each user's tickets (deferred).
- [ ] **T4:** Analyze a ticket with OpenRouter (deferred).
- [ ] **T5:** Complete the two-page ticket experience (deferred).
- [ ] **T6:** Verify and hand off the assessment (deferred).

## Task 1 — Scaffold a locally runnable workspace (PR 1; scaffold exception)

**Start:** Repository has challenge files and a minimal README, but no application.\
**Deliver:** TypeScript frontend (React, e.g. Vite) and Express backend in a monorepo, shadcn/ui setup, PostgreSQL, Docker Compose for local app/database, example environment files, a health endpoint, and initial run instructions. No credentials committed. Container mounts/reload behavior should be usable for development, not pitched as production deployment.\
**Boundary:** No login, ticket domain, or AI call. Keep generated assets identifiable for reviewers.\
**Acceptance:** A fresh checkout can follow README commands to start the stack; frontend loads; backend health check succeeds; database is reachable.\
**Checks:** Dependency/install and build/typecheck commands; Compose config/start and manual health/UI smoke check; document any check requiring unavailable Docker.

## Task 2 — Protect the demo account flow (PR 2; target ≤400 lines)

**Start:** Running scaffold and database.\
**Deliver:** Seed one demo user with a password hash; backend `POST /api/auth/login` validates credentials and signs a short-lived JWT; auth middleware rejects missing, invalid, and expired tokens on protected routes. Frontend login form, session-in-memory handling, logout, and clear expiry/error feedback. Configure demo password and JWT secret locally through non-committed environment values; publish variable names and safe setup instructions, never actual keys.\
**Boundary:** No signup, refresh token, cookies, roles, or persistent browser token. Do not use a client-side-only guard as authentication.\
**Acceptance:** Valid credentials reach a protected endpoint; invalid credentials and absent/expired tokens do not; login/logout UI reflects access.\
**Checks:** Auth endpoint/middleware tests (including expiry and negative paths), frontend login-state check, manual protected-route smoke test. If a cohesive UI+API unit exceeds budget, split at a working API/UI boundary rather than omitting tests.

## Task 3 — Save and retrieve each user's tickets (PR 3; target ≤400 lines)

**Start:** Protected backend and login.\
**Deliver:** PostgreSQL migration/schema for users and tickets; protected `POST /api/tickets` for bounded nonempty text and `GET /api/tickets` plus `GET /api/tickets/:id` for the owner's records. Use parameterized access, input length limits, and an explicit response shape. Document migration/seed steps in local run instructions. A ticket can exist before it has an analysis.\
**Boundary:** No AI call and no document upload. Backend persistence first; the full ticket UI belongs to PR 5.\
**Acceptance:** Tickets survive API/server restart; user A cannot read user B's ticket; invalid text and unknown IDs receive appropriate errors.\
**Checks:** API/database integration tests for create/list/detail, validation and cross-user isolation; migration and Compose smoke check.

## Task 4 — Analyze a ticket with OpenRouter (PR 4; target ≤400 lines)

**Start:** Persisted, owner-protected tickets.\
**Deliver:** Protected `POST /api/tickets/:id/analyses` accepts an optional bounded refinement instruction. Separate versioned prompt builder, OpenRouter-backed Vercel AI SDK invocation, and validated post-processing. Persist each analysis version with summary, category, uncertainty note, model ID, prompt version, and status; expose analyses in the ticket detail response. Select a model with `OPENROUTER_MODEL`, defaulting to `z-ai/glm-5.3-flash`; a deterministic mock adapter supports tests. Original ticket text is treated as untrusted data and must not be able to override system instructions or exfiltrate secrets.\
**Boundary:** No retrieval/RAG, tool calling, automatic model fallback, dynamic model catalog, or UI model picker. Do not claim that any arbitrary OpenRouter model guarantees structured output: validate the actual response, reject failures, and test the default model's behavior with a live opt-in smoke run.\
**Acceptance:** An authenticated owner can generate and then refine an analysis; a non-owner cannot; invalid model output and provider errors produce a safe error state rather than invented fields. Switching to another supported model needs only an environment change.\
**Checks:** Unit tests for prompt/version, parsing/schema and mock adapter; API tests for authorization, refinement and failure cases; opt-in real OpenRouter smoke check using a local secret, with skipped status recorded if no key is available. Record a reasonable timeout, input/output bound and basic per-user request limit or explicitly mark each as a production limitation in README.

## Task 5 — Complete the two-page ticket experience (PR 5; target ≤400 lines)

**Start:** Protected ticket and analysis APIs.\
**Deliver:** New-ticket page/form and ticket results/history page using shadcn/ui. Submit ticket text, run analysis, navigate to results, display structured summary/category/uncertainty and prior versions, and re-ask with a refinement instruction. Show empty, submitting/processing, error, and completed states, including an actionable retry path. Login remains the third view. Do not render model output as trusted HTML.\
**Boundary:** No streaming, file upload, model picker, elaborate dashboard, or visual polish beyond accessible, usable controls.\
**Acceptance:** A logged-in user can complete the full flow and inspect past analyses; API errors, missing data and uncertain outputs are understandable; logout returns to login.\
**Checks:** Focused frontend interaction tests with mocked API for success, loading, errors, empty state and refinement; manual browser walkthrough against the local stack.

## Task 6 — Verify and hand off the assessment (PR 6; target ≤400 lines)

**Start:** Complete Part 1 flow.\
**Deliver:** README with architecture diagram/flow, exact local startup and demo login setup, model-switching instructions, AI prompt/version and provider boundaries, injection threat/limitations, cost and rate-limit strategy for production, trade-offs, known limitations, and explicit Part 2/3 exclusions. Add only missing cross-layer checks, not a second implementation of earlier tests.\
**Boundary:** No production infrastructure, privacy program, evaluation platform, or bonus features. Update earlier PR docs alongside their behavior; this PR closes gaps and presents the final run path.\
**Acceptance:** A reviewer with a fresh checkout can run the app, log in, submit text, view/refine a structured result, and understand where data and secrets flow. The README clearly separates implemented safeguards from production recommendations.\
**Checks:** Clean-checkout local walkthrough, builds/tests, Compose startup, negative auth/error path, and optional live-model smoke run. Record failed, skipped, and unavailable checks plainly. If README plus missing tests exceeds budget, split into meaningful independently reviewable units.

## Deferred checklist — not implementation tasks for this iteration

### Part 2: AI data and architecture

- [ ] Define stored versus ephemeral inputs/outputs, retention/deletion policy, PII handling, log redaction, and audit trail. The MVP stores ticket text and analysis versions; that is a known privacy limitation pending a policy.
- [ ] Describe quality metrics, a small labeled evaluation set, prompt/model regression checks, and a process for incorrect AI answers.
- [ ] Optional: vector store and embeddings/RAG only if document-based retrieval later becomes a product goal.

### Part 3: infrastructure and deployment

- [ ] Define AWS runtime and Terraform/CloudFormation, secrets storage/rotation, environment separation, and a real deployment path.
- [ ] Address burst scaling, provider quotas, backpressure/queues and AI-specific cost/latency constraints.
- [ ] Revisit container image/deployment hardening; local Docker Compose alone does not meet Part 3.

### Optional bonuses

- [ ] Consider streaming UX, tools, async workers, volume-based cost estimates and multi-tenant isolation only after core assessment is verified.

## Next step

Task 1 implementation and functional verification are in place. Await explicit commit authorization for its work unit; then record commit identity and review outcome as applicable. Do not start later tasks or create PRs merely because they are listed here.
