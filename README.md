# Support Ticket AI

A local-development scaffold: React + TypeScript + Vite, shadcn/ui-compatible components with Tailwind CSS, an Express API, and PostgreSQL. Authentication, ticket storage, and AI analysis are intentionally not implemented yet.

## Start with Docker Compose

Requires Docker Engine and Docker Compose v2+; no host Node installation is needed. Run from the repository root:

```sh
# Choose a local-only URL-safe password (letters, numbers, hyphens).
export POSTGRES_PASSWORD='replace-with-your-local-development-password'
docker compose up --wait
```

`config/development.example` lists the local Compose environment variables without shipping a password. Set your own value in the shell as above; the example is not loaded automatically.

Open **http://localhost:5173**. The page should show **API online · PostgreSQL reachable**. Compose installs the locked dependencies before starting the applications; the first startup needs internet access to pull images and npm packages.

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
export POSTGRES_PASSWORD='replace-with-your-local-development-password'
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
| `DB_PORT` | Compose database host port | `5432`; update host `DATABASE_URL` if changed |
| `PORT` | Host API | `3001`; Compose fixes the internal port |
| `API_PROXY_TARGET` | Vite server | `http://127.0.0.1:3001`; Compose sets `http://api:3001` |
| `WATCH_POLLING` | Vite server | Off on host; `true` in Compose for bind mounts |

## Checks

```sh
npm ci
npm test
npm run typecheck
npm run build
docker compose config --quiet
docker compose up --wait
```

Tests cover API health success, safe database failure and recovery, plus UI pending, healthy, retry, network failure and invalid-response states. Database checks in unit tests are injected; they do not prove a real PostgreSQL connection. The two `curl` commands above verify the live database and Vite proxy. Open the page in a browser to check rendering and the **Check again** button.

To check live reload, edit text in `apps/web/src/App.tsx` and confirm the browser updates; edit `apps/api/src/app.ts` and confirm the API restarts. Source is bind-mounted in Compose, Vite uses polling, and the API uses `tsx watch`. On platforms where native API filesystem events do not propagate, run the host Node development path.

## Layout and development behavior

```text
Browser → Vite :5173 → /api proxy → Express :3001 → PostgreSQL :5432
apps/web/  React UI, Tailwind theme, shadcn/ui configuration and Button
apps/api/  Express app factory, PostgreSQL pool and health tests
```

- `GET /api/health` executes `SELECT 1`. It returns HTTP 200 with `database: "reachable"`, or HTTP 503 with `database: "unreachable"`. Connection/query timeouts bound failures; responses never expose driver errors or connection strings.
- `apps/web/components.json`, the `@/` alias, theme tokens, `cn`, and the local Radix/CVA Button provide the shadcn/ui setup. The Button is a small source-owned adaptation, not a claim that a generator was run.
- Root scripts fan out to npm workspaces. The root Vitest override keeps optional tooling peers on the same patched 4.1 release; npm 10 otherwise encounters a peer-resolution error. API build output is `apps/api/dist`; Vite output is `apps/web/dist`. `npm run start -w @support/api` runs the built API with `DATABASE_URL` exported. Frontend static hosting and production routing are out of scope.
- Compose uses a single dependency-install service and shared container-only root and workspace `node_modules` volumes, separate from host dependencies and Vite caches. After changing dependencies, stop the app services, rerun `docker compose run --no-deps dependencies`, then run `docker compose up --wait`.
- Published Docker ports bind to localhost. The Node/Vite dev servers listen on all interfaces for container access; run host development only on a trusted machine/network.
- This is development infrastructure, not a hardened production deployment. There are no migrations, accounts, ticket endpoints, provider keys, AI calls, or cloud infrastructure in this task.

Review the health contract and failure tests first, then Compose startup/reload wiring and the UI health states. The lockfile and workspace configuration are scaffold churn.
