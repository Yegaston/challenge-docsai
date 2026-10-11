# Start Task 2: demo account authentication

This is a short handoff for a new session, **not a specification or authorization to implement**. Start from the authoritative [Task 2 brief](../tasks/support-ticket-ai.md) and reconcile it with the current repository before changing code.

## Where to resume

- Branch: `feat/support-ticket-scaffold`; Task 1 is functionally complete. Scaffold commit: `dbf2033`; latest task-close commit at handoff: `eca9b64`. Confirm `git status` and HEAD in the new session rather than assuming they are unchanged.
- Scaffold: npm workspaces in `apps/api` (Express/TypeScript/PostgreSQL health) and `apps/web` (React/Vite/shadcn-compatible setup). `compose.yaml` runs database, dependency installer, API, and web; `README.md` has exact startup and checks. `config/development.example` is a credential-free variable example; `.env.example` was blocked by the tool safety policy.
- Last checks: `npm ci`, `npm test` (3 API + 6 web tests), `npm run typecheck`, `npm run build`, and isolated Compose/API/web HTTP smoke passed. Browser visual walkthrough and live reload were not checked. Rerun relevant checks after Task 2 changes.
- Untracked at handoff: `.codegraph/` and `CHALLENGE.pdf`. Preserve them; do not stage them accidentally. `CHALLENGE.md` is tracked.

## Task 2 in one paragraph

Seed one demo user with a password **hash**; add `POST /api/auth/login` and short-lived JWT bearer auth enforced by backend middleware on a protected endpoint. Add a login form, in-memory frontend token/session, logout, and clear invalid/expired-session feedback. Configure demo password and JWT signing secret locally without committing their values. No signup, refresh token, cookies, roles, password reset, persistent browser token, ticket endpoints, or AI integration. Use the brief for full acceptance and negative-path checks.

## First actions in the new session

1. Read `odd/tasks/support-ticket-ai.md` (Task 2 and delivery rules), `README.md`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/web/src/App.tsx`, and the existing tests. Reconcile the task document and its Engram mirror (`odd/support-ticket-ai/tasks`) before implementation.
2. Confirm the active branch, worktree status, and local tooling. Task 1's explicit choice to disable strict TDD applied **to Task 1 only**; resolve the effective mode and test runner for Task 2 before delegating implementation.
3. Keep Task 2 a working auth/API/UI unit with its tests. It needs a durable demo-user seed; decide the smallest user schema/migration now and leave ticket schema for Task 3. Keep credentials out of tracked files and browser storage.
4. Verify valid credentials, bad credentials, absent/invalid/expired tokens, protected-route access, frontend login/logout/expiry behavior, and relevant Compose smoke. Record skipped checks honestly.

## Review and delivery context

Task 1 was closed functionally at the user's request, **not** approved by native review. With RDD enabled globally, native inspection on the clean committed workspace returned `empty_candidate_base_ref_required`; an explicit committed-range START also stopped without creating a lineage. Do not present this as a receipt or infer that Task 2 inherits an approval. Follow the currently supplied native review contract for Task 2's own candidate; do not blindly retry Task 1's failed START or mutate review authority to work around it.

The agreed delivery is a six-PR stacked chain using `gh stack`; Task 2 targets a reviewable ≤400 changed lines, including tests/docs, unless a meaningful split or explicit exception is chosen. No push, PR, or merge is authorized by this handoff. Ask before expanding scope. The next session should implement Task 2 only when the user authorizes it.
