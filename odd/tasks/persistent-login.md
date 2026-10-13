# Persistent Demo Login

## Objective
Keep authenticated customers and support agents signed in across reloads and browser restarts for up to seven days, while retaining 15-minute, memory-only access tokens. This is a local synthetic-support demo, not a production finance identity system.

## Constraints
- Do not put access or refresh bearer tokens in localStorage/sessionStorage or accessible cookies. Refresh token is a random opaque secret in a host-only HttpOnly SameSite=Lax cookie limited to `/api/auth`, stored as a hash in PostgreSQL; no password storage in the browser.
- Refresh session is absolute seven days, not indefinitely extended; login creates a new session. Logout revokes it server-side and clears cookie. Existing bearer-protected application routes and role checks remain unchanged.
- Login/refresh/logout use POST with same-origin request semantics and Origin checks where applicable; no cross-origin cookie authentication for app APIs. Cookie Secure under HTTPS/production; local Compose remains HTTP and production must use TLS.
- Restore only after a successful `/api/auth/refresh` and `/api/auth/me` identity check; invalid/expired/revoked sessions return to login, temporary network/DB failures do not erase a valid in-memory session. Refresh before access expiry and on foreground resume. Avoid cross-tab or async races silently reviving a logged-out session.
- Preserve active owner-only synthetic transfers, human support and all existing routes; no paid provider calls, push, PR or merge. Keep user-owned `.agents/` and `skills-lock.json` untouched, and do not stage existing uncommitted chat/transfer files.

## Tasks
- [x] S1 — Add server-backed refresh sessions, migration, strict cookie routes, expiry/revocation, and deterministic service/HTTP tests. Route: delegated backend writer, RED/GREEN, independent audit and durability correction. Checks: 301 API tests, typecheck/build and diff check passed; live PostgreSQL pending S3. Commit `3c23358` (`feat(auth): persist bounded refresh sessions`).
- [x] S2 — Restore/refresh/logout from the web SessionProvider without browser token storage or flashing protected pages; test reload, expiry, role, races and failure states. Route: delegated web writer, RED/GREEN and independent verification with bootstrap/timer corrections. Checks: 116 web tests, typecheck/build and diff check passed; browser/live-cookie checks pending S3. Commit `29d20da` (`feat(web): restore and renew browser sessions`). Only the S2 async-login hunk was staged from the pre-existing uncommitted chat test.
- [x] S3 — Document seven-day behavior and run whole-workspace plus isolated PostgreSQL login/reload/logout checks. Route: delegated docs writer and independent verifier. Checks: 301 API and 116 web tests, both typechecks/builds, diff check passed; isolated PostgreSQL migrations 001–019 and actual Express HTTP login/cookie/refresh/new pool/support role/logout/401/origin rejection; 12 concurrent logins retained 10 sessions, hash-only storage and 100-row bounded purge. Browser tab-restart, sleep and cookie UI not verified; no paid provider used. Docs commit `129b832` (`docs(auth): explain seven-day login restoration`); task record commit follows.

## Acceptance
After login, a fresh page load or browser restart within seven days restores the same authenticated role without entering credentials. After logout, the old cookie cannot restore the session. An expired/revoked cookie never grants access; JWTs remain short-lived and in memory. No session token appears in browser storage. Normal app API calls still require Bearer tokens and owner/role checks.

## Progress
- 2026-10-12: Scoped existing auth: JWT expires after 900 seconds and SessionProvider stores it only in memory; no refresh sessions or cookie parser. Chose bounded server-backed seven-day opaque cookie over long-lived browser-accessible JWT. S1 `3c23358` (301 API tests), S2 `29d20da` (116 web tests), S3 docs `129b832` committed. Isolated PostgreSQL/HTTP refreshed across service restart and revoked on logout; only real-browser behavior remains unverified. Existing uncommitted transfer/chat/README changes remain separate.

## Next step
Follow up with a real browser reload/restart and background-sleep test when a runner is available. Restart the running API/web to load migrations and code before testing manually; cookie creation requires a fresh login after deployment. No push/PR/merge; unrelated uncommitted transfer/chat/README changes remain untouched.
