# Fixed local development database password

## Objective and authorization
User explicitly requested hardcoding the development PostgreSQL password in Docker Compose for challenge QA, then authorized rotating the existing database password while preserving data. Use the agreed public development-only value `support-dev-password`.

## Scope and constraints
- Set matching literal database and API connection credentials in compose.yaml; do not weaken localhost port binding.
- Preserve DEMO_EMAIL, DEMO_PASSWORD, JWT_SECRET configuration; remove obsolete database-password setup requirements from documentation/template and correct host Node DATABASE_URL guidance.
- Preserve existing Make startup and all unrelated work, including current README edits. Current branch is feat/ticket-analysis. No staging or commits without explicit request.
- Rotate existing support PostgreSQL role via local container psql. No volume deletion, SQL data mutations, schema changes, or resets.
- Do not read/print actual .env secrets or expanded Compose configuration.

## Tasks
- [x] T1: Implement and test fixed Compose database credentials; update relevant docs/template; rotate existing role and recreate API using new configuration. Runtime succeeded with user-approved unavailable baseline counts; no commit authorized.
- [ ] T2 (in progress): Independently check configuration, healthy startup, public API/proxy health and preservation evidence; complete native review where enabled.

## Acceptance and checks
- Deterministic configuration test observes RED before change and GREEN after: database and API use agreed matching fixed value even if POSTGRES_PASSWORD is unset or differs.
- Other three required application credential variables remain required.
- Quiet Compose configuration check uses dummy application credentials, never expanded real configuration.
- Attempt before/after rotation users/tickets counts when relations exist; no row contents are printed. User explicitly accepted unavailable baseline counts because users relation is absent, and authorized rotation followed by normal make run migrations/seed.
- `make run` succeeds and public /api/health endpoints on ports 3001 and 5173 report reachable PostgreSQL.
- Rotate role through `docker compose exec -T db psql -U support -d support -v ON_ERROR_STOP=1 -c "ALTER ROLE support WITH PASSWORD 'support-dev-password';"`, only after confirming db running. Existing local superuser access may be unavailable; stop rather than bypass authentication.
- Applicable tests, errors and unavailable checks recorded honestly; no commits authorized.

## Progress
Read-only logs previously confirmed existing PostgreSQL volume skipped initialization and API authentication failed for support. Hardcoding configuration alone cannot rotate stored credentials. User authorized the preserving-data rotation explicitly.
T1 partial: Compose now uses matching fixed development database/API credentials; README and template updated. Focused Compose regression tests observed RED then GREEN, including unset/different database environment passwords and required app variables. Shell syntax, both focused scripts and git diff --check passed.
Runtime blocker: required pre-rotation count query failed because relation users does not exist; worker confirmed expected migration table name. No password rotation or runtime mutation occurred. Repeated counts, make run, and live health checks not run. User explicitly approved proceeding with role rotation followed by authorized make run migrations/seed, accepting unavailable baseline counts. Initial isolated test attempt hid Compose by clearing HOME; corrected before RED evidence.

Runtime continuation succeeded: ALTER ROLE returned success; make run recreated database/API containers and all three services became healthy. Direct and Vite-proxied public API health both reported database reachable. Post-startup counts: users=1, tickets=0, consistent with normal migrations/seed. No reset/deletion or further source edits. Baseline counts remain unavailable; unchanged-data proof is not claimed.

Native review preflight found unrelated in-progress analysis feature changes (including apps/api/package.json and package-lock.json). User explicitly chose to defer native review for this candidate rather than review the mixed workspace. No review START issued; no native approval claimed.

## Next step
Await independent configuration/runtime verification. Keep changes uncommitted. Native review deferred by user for this candidate.
