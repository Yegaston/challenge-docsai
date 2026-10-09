# Support Ticket AI

A local-development app with a persistent demo account: React + TypeScript + Vite, shadcn/ui-compatible components with Tailwind CSS, an Express API, and PostgreSQL. Login proves protected API access; ticket storage and AI analysis are not implemented yet.

## Start with Docker Compose

Requires Docker Engine and Docker Compose v2+; no host Node installation is needed. Run from the repository root in **Bash**. Enter your own local values at the prompts (passwords and signing secret are not echoed or written into shell history):

```sh
read -rsp 'Local database password (URL-safe letters/numbers/hyphens): ' POSTGRES_PASSWORD; printf '\n'
read -rp 'Demo login email: ' DEMO_EMAIL
read -rsp 'Demo password (12–256 characters): ' DEMO_PASSWORD; printf '\n'
read -rsp 'JWT secret (at least 32 random bytes from a password manager): ' JWT_SECRET; printf '\n'
export POSTGRES_PASSWORD DEMO_EMAIL DEMO_PASSWORD JWT_SECRET
docker compose up --wait
```

`config/development.example` lists credential-free variable names; it is not loaded automatically. Keep values in a local password manager for restarts. Do not commit secrets or share expanded `docker compose config` output.

Open **http://localhost:5173**. The page should show **API online · PostgreSQL reachable**. Log in with the email/password you supplied; your email appears only after the protected API confirms your identity. **Verify session** repeats that request; **Log out** clears the in-memory session. Compose installs the locked dependencies before starting the applications; the first startup needs internet access to pull images and npm packages.

```sh
curl --fail http://localhost:3001/api/health
curl --fail http://localhost:5173/api/health
# Both: {"status":"ok","database":"reachable"}
docker compose logs api web db
docker compose stop
```

The database persists in a named volume. Stopping services does not delete it. Changing `POSTGRES_PASSWORD` does not change the password of an already-initialized database; keep the existing local value when restarting.

## Develop with host Node

Requires **Node 22.12+**, **npm 10+**, and the same Docker prerequisites for PostgreSQL. Run from the root, using one terminal for development:

```sh
# First run the four prompts and export command above in this shell.
docker compose up -d --wait db
export DATABASE_URL="postgresql://support:${POSTGRES_PASSWORD}@127.0.0.1:5432/support"
npm ci
npm run dev
```

`npm run dev` starts both workspaces. Vite proxies `/api` to Express, so the browser uses the same origin and does not receive database credentials. Stop any Compose `api`/`web` services before running their host equivalents to avoid port conflicts.

Environment values must be exported into the process shell (or supplied by Compose). The Node scripts do not automatically load environment files. Never put credentials in `VITE_*` variables; these are public browser values.

| Variable | Used by | Default / requirement |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | Compose database and API | Required; use a local URL-safe password |
| `DATABASE_URL` | Host API | Required PostgreSQL connection URL |
| `DEMO_EMAIL` | API only | Required seed email; trimmed and lowercased |
| `DEMO_PASSWORD` | API only | Required 12–256 characters; initial seed only |
| `JWT_SECRET` | API only | Required ≥32 UTF-8 bytes; use a cryptographically random secret |
| `DB_PORT` | Compose database host port | `5432`; update host `DATABASE_URL` if changed |
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

## Checks

```sh
npm ci
npm test
npm run typecheck
npm run build
docker compose config --quiet
docker compose up --wait
```

Tests cover password hashing, conflict-safe seeding, login validation, JWT negative cases, safe database errors, and UI login/logout/expiry/401/network/stale-response behavior, alongside the public health tests. Database access is mocked in unit tests; these do **not** prove real PostgreSQL persistence. The two `curl` commands above verify live database health and the Vite proxy.

For a live auth/persistence check: log in in the browser, use **Verify session**, then log out and confirm the login form returns. `curl -i http://localhost:5173/api/auth/me` without a token must return 401. Restart the API with `docker compose restart api`, then log in again with the original credentials. Using a temporary different `DEMO_PASSWORD` with the same email and recreating the API must leave only the original password valid; restore your original local environment value afterward. Do not print or share bearer tokens, hashes, or secrets when inspecting requests. Check rendering and **Check again** in a real browser as well.

To check live reload, edit text in `apps/web/src/App.tsx` and confirm the browser updates; edit `apps/api/src/app.ts` and confirm the API restarts. Source is bind-mounted in Compose, Vite uses polling, and the API uses `tsx watch`. On platforms where native API filesystem events do not propagate, run the host Node development path.

## Layout and development behavior

```text
Browser → Vite :5173 → /api proxy → Express :3001 → PostgreSQL :5432
apps/web/  React UI, Tailwind theme, shadcn/ui configuration and Button
apps/api/  Composition root, auth/users/health feature modules, migrations and tests
```

- API features live in `apps/api/src/modules/{auth,users,health}`. Each HTTP feature has an `http/` controller; services use plain inputs/results and repository contracts without Express or HTTP status codes. Auth's reusable `login` and `identity` services own JWT verification and database-resolved identity, and depend only on the users lookup contract. Users has no HTTP routes yet; its seed service accepts injected hashing/ID dependencies. There is no empty auth repository because only users persist.
- `server.ts` composes concrete repositories and auth HTTP handling before listening. `infrastructure/initialize-users.ts` validates seed configuration, loads the unchanged migration relative to the original source/build root, then calls the users seed service. SQL lives in repositories; password hashing lives in auth infrastructure. Root `auth.ts` and `demo-user.ts` retain compatibility exports for existing callers/tests, not duplicate implementations.
- `GET /api/health` executes `SELECT 1`. It returns HTTP 200 with `database: "reachable"`, or HTTP 503 with `database: "unreachable"`. Connection/query timeouts bound failures; responses never expose driver errors or connection strings.
- `apps/web/components.json`, the `@/` alias, theme tokens, `cn`, and the local Radix/CVA Button provide the shadcn/ui setup. The Button is a small source-owned adaptation, not a claim that a generator was run.
- Root scripts fan out to npm workspaces. The root Vitest override keeps optional tooling peers on the same patched 4.1 release; npm 10 otherwise encounters a peer-resolution error. API build output is `apps/api/dist`; Vite output is `apps/web/dist`. `npm run start -w @support/api` runs the built API with `DATABASE_URL`, `DEMO_EMAIL`, `DEMO_PASSWORD`, and `JWT_SECRET` exported; keep `apps/api/migrations/` alongside `dist/`. Frontend static hosting and production routing are out of scope.
- Compose uses a single dependency-install service and shared container-only root and workspace `node_modules` volumes, separate from host dependencies and Vite caches. After changing dependencies, stop the app services, rerun `docker compose run --no-deps dependencies`, then run `docker compose up --wait`.
- Published Docker ports bind to localhost. The Node/Vite dev servers listen on all interfaces for container access; run host development only on a trusted machine/network.
- This is development infrastructure, not a hardened production deployment. There are no ticket endpoints, signup/reset/refresh/roles, provider keys, AI calls, or cloud infrastructure in this task.

Review the auth negative tests and migration/seed first, then the browser expiry/stale-response guards and backend-only Compose variables. This is Task 2 of the six-part chain, built on the health scaffold; ticket persistence is the next unit.
