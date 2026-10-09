# API feature-module refactor

## Intent and authorization

Preserve accepted Task 2 authentication behavior while introducing feature modules with HTTP controllers/routes/middleware, transport-independent services, and repositories behind plain contracts. A future CLI controller must reuse services without Express or HTTP concepts. The composition root wires concrete dependencies.

User authorized implementation, a single prerequisite stack branch, local work-unit commits, and a cohesive size exception for the 350–600 additions/deletions forecast (including moved code, tests and docs). No push, PR, merge, new ticket behavior or new dependency is authorized. Keep the six ticket delivery units; this branch is an explicit prerequisite before Task 3.

## Scope and constraints

- Existing API auth, user persistence, demo seed, startup composition and architecture documentation only.
- Preserve login/me response shapes, status codes, no-store, JWT issuer/audience/lifetime/validation, database identity resolution, scrypt timing safeguards and idempotent persistent identities.
- HTTP owns input parsing and response/error mapping; services have plain inputs/results/errors and repository contracts. Repositories own parameterized SQL, without controller/HTTP dependencies.
- Migration-file I/O stays in startup/infrastructure, not transport-independent services. Preserve source/dist migration resolution and seed-before-listen behavior.
- No ticket routes, UI changes, registration, storage changes, framework/DI container or schema changes.
- Preserve unrelated `.codegraph/`, `CHALLENGE.pdf`, and `odd/handoffs/`.

## Tasks

- [x] **R1 — Isolate accepted Task 2 baseline** (complete). Verify existing implementation, commit only its intended files on `feat/demo-auth`, and add `refactor/api-modules` through `gh stack`. Route: inline Git bookkeeping; verification delegated to `gentle-ai-verify` because executing checks fires verification trigger.
- [x] **R2 — Refactor and verify feature-module boundaries** (complete). One bounded `gentle-ai-worker` performs multi-file changes, tests and README update. Route: delegated because 2+ nontrivial files and preparation mapping trigger. Parent performs native review under user-owned RDD and closes with local Conventional Commit. Outcome requires preserved regressions, plain service APIs and parameterized repository tests.

## Evidence

- Initial branch: `feat/demo-auth`; HEAD `eca9b64`; stack `main` → `feat/support-ticket-scaffold` → `feat/demo-auth`.
- Baseline verifier: `npm test` passed 63 tests (API 44, web 19); `npm run typecheck`, `npm run build`, `git diff --check` passed. No unexpected paths observed; no pre-run same-file snapshot existed.
- Earlier Task 2 native approval/acknowledgement applies only to its prior frozen candidate, not this refactor. Do not replay that transaction.
- Current user-owned RDD reads on (global).
- Refactor is behavior-preserving: existing regression tests establish baseline. New transport-neutral service contracts should use test-first RED/GREEN where meaningful; do not invent RED for mechanical moves.
- Independent verification passed: `npm test` 68 tests (API 49, web 19), `npm run typecheck`, `npm run build`, and `git diff --check`. Real PostgreSQL 17 smoke passed 125 assertions covering fresh built startup/migrations/seed/login/me/health, negative requests/tokens/no-store, two full existing-volume restart cycles, changed seed password preserving stored identity/hash, and fresh/existing source startup. API hashes and Git status unchanged by verifier. Own containers/network removed; volume `api-refactor-verify-0f24791d21_postgres-data` retained. No requested smoke checks skipped. No UI changed; prior missing visual auth verification is not resolved by this work.

## Completed outcome and next step

R1 complete: commit `077f930` (`feat(auth): add persistent demo account and memory-only login`), exactly 14 implementation/test/docs files, 673 additions + 21 deletions. No task bookkeeping, handoffs, PDF or CodeGraph files included. `gh stack add refactor/api-modules` succeeded; this branch starts at `077f930`. R2 complete, work-unit commit `26ddf5531513158b76981a804aad6cc9dd7a639c` (`refactor(api): isolate feature services from HTTP controllers`): 343 additions + 166 deletions = 509 scoped lines (including untracked code/tests), within approved exception. New service contracts observed RED (modules absent) then GREEN (3 tests); API-focused regression suite passed 49 tests after correcting two moved spy targets. Full `npm test` passed 68 tests; typecheck/build/diff checks passed. Parent spot-read confirmed transport-neutral auth errors and source/dist migration anchoring. Independent verification including real PostgreSQL/built startup passed (125 assertions); native assessment initially unassessable due intended-untracked declaration, so conservative independent verification is required. Native review unavailable (expired consent twice); no approval claimed. Work-unit commit recorded above. Refactor implementation is complete; Task 3 remains unstarted.

### Native review availability

Inspect declared all intended implementation files and excluded preserved artifacts. Two START attempts returned `consent-binding-expired`, `lineage_created: false`, and `mutation_performed: false`; no review lineage or approval exists. The provider offered fresh START, retried once, with the same stale-consent outcome. No further blind retry. ASSESS with `nativeReviewOutcome: unavailable` returned unassessable/high verification fallback: writer checks plus independent verifier, completed successfully. RDD remains on; no review authority was reset or changed. Native review is unavailable for this candidate unless a fresh consent flow succeeds later.

### Closure

All functional/structural checks passed, with no pending implementation or requested smoke checks. Scoped implementation: 509 additions/deletions; committed unit including ODD bookkeeping: 386 additions + 171 deletions = 557 lines, within approved forecast exception. User requested task closure after native consent expiry explanation. Architecture convention saved as `architecture/module-layering` for future project work. Compatibility facades remain for existing imports; services and repositories have no HTTP/controller dependencies. Next authorized feature work is Task 3, using these boundaries and treating this branch as its predecessor. No push/PR/merge performed; preserved artifacts remain untracked.
