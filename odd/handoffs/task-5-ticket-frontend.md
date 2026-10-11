# Start Task 5: two-page ticket experience (frontend)

Preparation handoff, **not yet authorization to implement**. Wait for the user's explicit go before starting Task 5 implementation. The authoritative scope is [Task 5 in the feature brief](../tasks/support-ticket-ai.md); reconcile it, the Engram mirror, and the repository before edits.

## Where to resume

- Branch at start: `feat/ticket-analysis` (Task 4 closure must be committed first). Create the Task 5 stack layer with `gh stack add` (e.g. `feat/ticket-frontend`) only after Task 4's closure commit lands; confirm the chain `main → feat/support-ticket-scaffold → feat/demo-auth → feat/ticket-persistence → feat/ticket-analysis → <new>` at that moment.
- If Task 4's native review is not yet closed, that closure precedes Task 5. Do not build Task 5 on unreviewed, uncommitted Task 4 code without the user's explicit go.
- Engram project `challenge-docsai`, topic `odd/support-ticket-ai/tasks`. Reconcile before acting.

## Existing behavior to build on

- API (all bearer-token protected, owner-scoped): `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/tickets` (`{ text }` → 201 `{ ticket: { id, text, createdAt } }`), `GET /api/tickets` (newest first, unpaginated), `GET /api/tickets/:id` (`{ ticket: { ..., analyses: [...] } }`), `POST /api/tickets/:id/analyses` (optional `{ instruction }`, 2,000-char limit; 16 KB body cap; unknown/other-owner ticket is indistinguishable 404).
- Analysis record shape: `status` (`running`/`succeeded`/`failed`), `model`, `prompt_version`, `instruction`, `created_at`, `completed_at`, and for succeeded attempts `summary` (≤2,000), `category` (`billing` | `account_access` | `technical_issue` | `other`), `uncertainty_note` (≤1,000); failed attempts carry `failure_code` (`timeout` | `provider` | `invalid_output` | `unconfigured`) and no fabricated fields. Confirm the exact serialized field names from the API layer before writing tests.
- Synchronous request: an analysis start can take up to ~60 s (provider timeout). The UI must show a visible processing state and must not block navigation away from it; history refresh shows the completed version.
- Frontend today: React/Vite + shadcn/ui, memory-only login/session/logout/expiry handling in `apps/web/src/App.tsx` (181 lines) with jsdom tests in `App.test.tsx`. No tickets UI yet. Preserve abort/stale-response safeguards; never persist the token to storage.
- Mock model adapter exists for deterministic backend tests; the frontend needs no model knowledge.
- Local stack: `make run` (Docker Compose, API :3001, web :5173, proxied `/api/health`). Credentials via local `.env`; never print or commit them.

## Task 5 in one paragraph

Add the two ticket pages with shadcn/ui: a new-ticket page (paste text, submit, run analysis, navigate to results) and a ticket results/history page (structured summary, category, uncertainty, and prior versions; re-ask with a refinement instruction). Login remains the third view. Show empty, submitting/processing, error, and completed states with an actionable retry path; render failure codes understandably; never render model output as trusted HTML. Logout returns to login.

## First actions in the new session (after user go)

1. Read the feature brief (Task 5 section), `App.tsx`, `App.test.tsx`, the API controllers/services for exact response shapes, and the web workspace test setup before deciding edit surfaces.
2. Plan the smallest coherent UI unit: it may exceed the ≤400-line target given shadcn components and state coverage; forecast honestly and seek a size exception or split at a working page boundary (e.g. new-ticket page / results page) rather than omitting tests. Report the size decision to the user before implementing.
3. Implement test-first with Vitest/jsdom: focused interaction tests with mocked API for success, processing, each failure state, empty history, expiry mid-flow, and refinement. Observe RED, then GREEN, then full API/web regression, typecheck, build.
4. **Real browser walkthrough with the browser tooling now available.** The user confirmed browser tooling exists this iteration. Script the full local-stack walkthrough: login → create ticket → analysis → refine → history → logout, including a failure/retry path. This walkthrough must also close the **still-pending Task 2 visual login/logout check** that no earlier iteration performed. Do not treat jsdom as visual evidence; if tooling fails, report the concrete blocker.
5. Update the feature brief and Engram mirror with observed evidence and the work-unit commit (Conventional Commit, tests and docs with behavior) once checks pass and the user-authorized commit step arrives.

## Boundaries

- No streaming, file upload, model picker, elaborate dashboard, or visual polish beyond accessible usable controls. No signup, no persistent token storage.
- API errors, missing data, expired session, and uncertain outputs must be understandable; unknown failure codes fall back to a generic safe message.
- No push or PR authorized; stacked-PR chain rules stay as agreed in the feature brief.
- This environment may migrate to a new VPS before this task runs; after migration reconcile checkout (with `.git` and uncommitted changes), secrets via secure channel, PostgreSQL data (repo copy does not copy the database), Node ≥22.12/npm ≥10/Docker, `npm ci`, and repeated checks. Do not assume Engram transferred.
