# Start Task 3: owner-scoped ticket persistence

This is a short context handoff for a fresh session, **not a specification or authorization to implement**. The authoritative scope is [Task 3 in the feature brief](../tasks/support-ticket-ai.md). Reconcile that document, its Engram mirror, and the current repository before edits.

## Where to resume

- Branch at handoff: `feat/demo-auth`; HEAD: `eca9b64`. Local `gh stack` chain: `main` → `feat/support-ticket-scaffold` → `feat/demo-auth`. Recheck status and stack rather than assuming they are unchanged.
- **Task 2 is implemented but uncommitted.** Its tracked changes and new API files are the working baseline, not unrelated dirt to discard. Do not mix them into Task 3 or assume a new branch separates uncommitted changes. Resolve the Task 2 commit boundary with the user before starting Task 3's stack layer; no commit, push, PR, or merge is authorized by this handoff.
- Preserve `.codegraph/`, `CHALLENGE.pdf`, and `odd/handoffs/`. Task 2's new `apps/api/src/auth.ts`, `demo-user.ts`, migration, and auth/seed tests are also currently untracked but are intended implementation files.
- Feature continuity: `odd/tasks/support-ticket-ai.md`; Engram project `challenge-docsai`, topic `odd/support-ticket-ai/tasks`. Tasks 1–2 are functionally complete; Tasks 3–6 have not started.

## Existing behavior to build on

- API: Express/TypeScript and PostgreSQL; public `/api/health`, `POST /api/auth/login`, protected `GET /api/auth/me`.
- `apps/api/src/auth.ts`: `jose` HS256 JWTs, 15-minute lifetime, fixed issuer/audience, verified bearer token and database-resolved user. The `requireUser` middleware currently lives inside `createAuth`; inspect how to reuse it safely for ticket routes rather than duplicate token validation or place tickets inside the auth URL namespace.
- `apps/api/src/demo-user.ts` and `apps/api/migrations/001-users.sql`: UUID users, normalized unique email, salted async scrypt hashes, parameterized persistence, idempotent demo seed. Users already exist: extend this schema, do not replace or reseed identities.
- `apps/api/src/server.ts`: initializes schema and seed before listening, including on existing database volumes. Built startup needs migrations alongside `dist`. Existing account ID/hash/password survive restarts; changing `DEMO_PASSWORD` does not reset an existing password.
- Frontend: React/Vite, memory-only login/session/logout/expiry handling and public health display. No tickets UI yet. Preserve abort/stale-response safeguards and do not introduce browser token storage.
- Setup: `README.md`, `compose.yaml`, and credential-free `config/development.example`. Required local variables include `POSTGRES_PASSWORD`, `DEMO_EMAIL`, `DEMO_PASSWORD`, and `JWT_SECRET`; never print or commit their values.

## Task 3 in one paragraph

Add PostgreSQL ticket persistence and protected `POST /api/tickets`, `GET /api/tickets`, and `GET /api/tickets/:id` for the authenticated owner's records. Accept bounded nonempty pasted text, use parameterized queries and explicit response shapes, and document migration/startup steps. Ownership must come from verified backend identity, never a client-supplied owner field. A ticket exists independently of any analysis. No AI, upload, signup, or full ticket UI; those are outside this task.

## First actions in the new session

1. Read the feature brief and full Engram task mirror, then reconcile current Git status/HEAD/stack. Read `README.md`, API `app.ts`, `server.ts`, `auth.ts`, `demo-user.ts`, `migrations/001-users.sql`, and API tests before deciding edit surfaces.
2. Resolve the uncommitted Task 2 boundary before making a Task 3 branch through `gh stack`. Preserve all existing changes. Start implementation only after a new explicit user request.
3. Plan the smallest ticket migration/repository/router unit with tests and docs. Clarify any meaningful unresolved API contract; the exact text bound and response shape are not fixed by this handoff.
4. Use test-first RED/GREEN with Vitest. Task 1's TDD waiver was Task 1 only; Task 2 used test-first. Run relevant auth regressions after middleware changes.
5. Verify create/list/detail, empty/whitespace/oversized/invalid text, malformed/unknown IDs, missing/invalid/expired tokens, and two-user isolation for both list and detail. Use test fixtures for the second user, not a signup feature. Verify real PostgreSQL persistence after restart and migrations against an existing users volume; mocks alone do not establish persistence.

## Last observed verification and caveats

- `npm test`: **63 passed** (44 API, 19 web). `npm run typecheck`, `npm run build`, and `git diff --check` passed independently.
- Real PostgreSQL/Compose smoke passed **50 assertions**: direct/proxied login and protected identity; negative credentials/tokens; no-store; one hashed user; unchanged ID/hash after API restart and full existing-volume restart with built API and a changed seed password.
- Isolated project `auth-verify-mv026fbi` services are stopped. Its four named PostgreSQL/dependency volumes remain. Temporary Compose override was removed. Do not reuse unknown test credentials or delete volumes without authorization; use fresh synthetic credentials and isolated resources.
- **Visual browser verification is still missing.** The verifier lacked exposed browser tools, and the parent did not investigate desktop/browser alternatives before closing. The user challenged this omission. Do not treat jsdom or HTTP smoke as visual evidence: investigate available browser tooling before declaring that check unavailable, or explain the concrete blocker. No visual pass has occurred.
- Nonblocking Task 2 advisories concern readability/client-clock skew around `apps/web/src/App.tsx:63–64`; leave them as separate follow-up work unless authorized. Local-only limitations include no login rate limiting or server-side token revocation.

## Review and delivery boundaries

Task 2 native review `review-0087a7d5e74f7467` approved four lenses, and its exact acknowledgement succeeded. That lifecycle is closed: do not query it again, replay acknowledgement, or claim its approval covers Task 3. The later progress-only task-document update was outside its frozen candidate. Task 1 was functionally closed without native approval.

The user approved a **Task 2-only size exception**: 694 implementation changed lines, excluding bookkeeping. Task 3 retains the **≤400 additions plus deletions** target including tests/docs. Forecast honestly, do not omit tests or compress code, and ask for a meaningful split or exception if needed. Keep the agreed six-part stacked delivery plan unless the user changes it. Check the current user-owned RDD switch and follow the current native review contract for Task 3's own candidate. No delivery action is authorized here.
