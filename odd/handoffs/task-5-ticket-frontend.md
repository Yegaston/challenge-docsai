# Task 5: two-page ticket experience (frontend)

**Reviewed; commit pending:** Frontend implementation and correction are complete. Native review `review-391789596729bafc` approved/acknowledged the corrected target `sha256:663af18fd62b594c797013b6356be5da69ebcc8518e1d3596bc97436e2dc8072` once; its authority is burned. Parent owns the work-unit commit (hash pending). Real-browser verification, including Task 2's visual login/logout check, is explicitly deferred to Task 6; do not claim a visual pass. See [Task 5 in the feature brief](../tasks/support-ticket-ai.md).

## Where to resume

- Parent: make the pending Task 5 work-unit commit and record its hash in a subsequent small doc-only commit. Do not reopen the acknowledged review or claim a push/PR.
- Task 6 owns the deferred real-browser walkthrough and Task 2 visual login/logout check. Safari WebDriver needs Safari Settings → Developer → Allow remote automation enabled by the user.

## Original implementation context (historical; not current instructions)

- API (all bearer-token protected, owner-scoped): `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/tickets` (`{ text }` → 201 `{ ticket: { id, text, createdAt } }`), `GET /api/tickets` (newest first, unpaginated), `GET /api/tickets/:id` (`{ ticket: { ..., analyses: [...] } }`), `POST /api/tickets/:id/analyses` (optional `{ instruction }`, 2,000-char limit; 16 KB body cap; unknown/other-owner ticket is indistinguishable 404).
- Analysis record shape: `status` (`running`/`succeeded`/`failed`), `model`, `prompt_version`, `instruction`, `created_at`, `completed_at`, and for succeeded attempts `summary` (≤2,000), `category` (`billing` | `account_access` | `technical_issue` | `other`), `uncertainty_note` (≤1,000); failed attempts carry `failure_code` (`timeout` | `provider` | `invalid_output` | `unconfigured`) and no fabricated fields. Confirm the exact serialized field names from the API layer before writing tests.
- Synchronous request: an analysis start can take up to ~60 s (provider timeout). The UI must show a visible processing state and must not block navigation away from it; history refresh shows the completed version.
- Before Task 5, the frontend was React/Vite + shadcn/ui with memory-only login/session/logout/expiry handling in `apps/web/src/App.tsx` and jsdom tests in `App.test.tsx`. Task 5 added the ticket UI; token persistence remains prohibited.
- Mock model adapter exists for deterministic backend tests; the frontend needs no model knowledge.
- Local stack: `make run` (Docker Compose, API :3001, web :5173, proxied `/api/health`). Credentials via local `.env`; never print or commit them.

## Task 5 scope delivered

The task added the ticket pages with shadcn/ui on `react-router-dom` routes `/login`, `/tickets/new`, and `/tickets/:id`: a new-ticket page (paste text, submit, run analysis, navigate to results) and a ticket detail page (structured summary, category, uncertainty, and prior versions; re-ask with a refinement instruction), reached from a compact history list (truncated text, latest analysis status). Login remains its own route. Show empty, submitting/processing, error, and completed states with an actionable retry path; render failure codes understandably; never render model output as trusted HTML. Logout returns to login.

## Agreed decisions (user, this session)

1. **Routing:** add `react-router-dom` with `/login`, `/tickets/new`, and `/tickets/:id` routes. Shareable URLs and real navigation; this adds one dependency and some size.
2. **Structure:** one coherent Task 5 unit containing both pages. After the writer's first checkpoint forecast ~900 source + ~700 test lines, the user explicitly accepted the ~1,600-line size exception rather than splitting 5a/5b. Report actual changed lines and review workload; do not omit tests or compress code.
3. **History UX:** compact list (truncated text, latest analysis status) with full detail and analysis versions on the ticket detail route. Not inline-expanded rows.
4. **Authorization:** implementation and corrected native review are complete; commit remains pending. Real-browser walkthrough is deferred to Task 6 by explicit user decision. History's unbounded N+1 detail fetches are an accepted small-data demo limitation.

## Closure evidence and remaining obligation

- R3-001 (CRITICAL indefinite uncertain-POST guard) was corrected with warned manual recovery: a successful GET must start at least 75 seconds after the same guard started, match the prior terminal/empty baseline, and find the guard unchanged at response. An explicit checkbox and discard then clear the local guard without POST; a separate submission can start the next paid attempt. Delayed-GET regression observed RED → GREEN.
- Corrected diff against frozen pre-correction tree `17c1ab22`: 107 lines, within the accepted 180-diff-line correction plan. Writer and independent verifier each passed 61 web tests, 164 API tests, typecheck, build, and diff check. Native validator approved. R3-002 reliability WARNING (`apps/web/src/pages/NewTicketPage.tsx:49-55`) is informational follow-up only; no correction requested.
- Task 6, **not Task 5 closure**, must perform the real-browser flow and outstanding Task 2 visual login/logout check or honestly record the blocker/skip. Safari requires user-enabled remote automation. Real OpenRouter smoke was skipped; no live quality claim. Parent will record the work-unit commit hash later.

## Boundaries

- No streaming, file upload, model picker, elaborate dashboard, or visual polish beyond accessible usable controls. No signup, no persistent token storage.
- API errors, missing data, expired session, and uncertain outputs must be understandable; unknown failure codes fall back to a generic safe message.
- No push or PR authorized; stacked-PR chain rules stay as agreed in the feature brief.
- If this environment migrates to a new VPS before Task 6, reconcile checkout (with `.git` and uncommitted changes), secrets via secure channel, PostgreSQL data (repo copy does not copy the database), Node ≥22.12/npm ≥10/Docker, `npm ci`, and repeated checks. Do not assume Engram transferred.
