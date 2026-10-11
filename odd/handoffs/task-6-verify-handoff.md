# Start Task 6: integral verification and delivery handoff

Preparation handoff, **not yet authorization to implement**. Wait for the user's explicit go before starting Task 6. The authoritative scope is [Task 6 in the feature brief](../tasks/support-ticket-ai.md); reconcile it, the Engram mirror, and the repository before edits.

## Where to resume

- Branch at start: the Task 5 stack layer after its closure commit. Task 6 is the last PR in the agreed six-part stacked chain (`main → scaffold → demo-auth → ticket-persistence → ticket-analysis → ticket-frontend → <verify>`). Create its layer with `gh stack add` only after Task 5 closes; confirm the chain at that moment.
- If the Task 4 OpenRouter smoke remains skipped when Task 6 starts, this task is its natural slot: the brief's optional live-model smoke run belongs here, and the user may opt in at that point (it needs a local key; results go to evidence, never to logs or docs).
- Engram project `challenge-docsai`, topic `odd/support-ticket-ai/tasks`. Reconcile before acting.

## Task 6 in one paragraph

Prove the whole Part 1 flow from a clean checkout and present it: complete the README (architecture/flow, exact local startup and demo login setup, model switching via `OPENROUTER_MODEL`, AI prompt/version and provider boundaries, injection threat model and limitations, production cost/rate-limit strategy, trade-offs, known limitations, explicit Part 2/3 exclusions), then run the end-to-end verification: login → ticket → analysis → refinement → history on the real stack, started from a clean checkout via Docker Compose. Add only missing cross-layer checks, never a second implementation of earlier tests.

## Outstanding items this task must account for (not necessarily fix)

- **Skipped live-model smoke from Task 4**: run it here if the user opts in, otherwise record it as skipped with the concrete reason (no key authorized this iteration).
- **Task 2 advisory follow-ups** (`apps/web/src/App.tsx:63–64` readability/client-clock-skew): resolve or record explicitly as accepted limitations.
- **Skipped/limited checks accumulated across tasks** (full pre-fix 313-check PostgreSQL suite not repeated after the crash fix; live uncertain-ACK scenario mock-only): listed plainly as skipped, not passed.
- Known production limitations already documented (no pagination, no login rate limiting, no server-side token revocation, MVP retention of ticket text/analyses): keep them stated, not hidden.

## First actions in the new session (after user go)

1. Read the current README (20 KB, already partially updated by Makefile/dev-password work — reconcile rather than overwrite), `compose.yaml`, `config/development.example`, and the feature brief's Task 6 section.
2. Plan the README completion as its own work unit; if README plus missing cross-layer checks exceeds the ≤400-line target, split into independently reviewable units and report the split before implementing.
3. Run the clean-checkout walkthrough: fresh clone/copy → `npm ci` → Compose up → seeded demo login → full ticket flow → results/refine/history → logout. Use the available browser tooling for the visual pass; record every failed, skipped, or unavailable check plainly.
4. Negative paths at the integration level: expired/invalid token mid-flow, invalid ticket text, provider failure state surfaced in UI, non-owner isolation spot-check.
5. Close the feature brief: final Task 4–6 evidence, honest skipped-check register, and the Part 2/3 deferred checklist left intact. Work-unit commit(s) as authorized.

## Delivery and environment caveats

- No push, PR, or merge authorized by this handoff; stacked-chain rules and per-PR review notes stay as agreed in the feature brief.
- **VPS migration is expected before or during this phase.** Before releasing the current environment: copy the full checkout including `.git`, uncommitted changes, and new files; preserve the parallel Makefile/`scripts/`/`odd/tasks/` work; transfer secrets/config by a secure channel, never in commits; back up PostgreSQL separately (a repo copy does not copy the database); do not assume Engram transfers (rebuild mirrors from `odd/tasks/` if missing). On the new VPS: Node ≥22.12, npm ≥10, Docker/Compose, `npm ci`, repeat all checks. Task 6's clean-checkout walkthrough doubles as the post-migration verification if it happens there.
- Part 2 (privacy/evaluations) and Part 3 (cloud infrastructure) remain out of this iteration; the README must separate implemented safeguards from production recommendations and record the exclusions explicitly.
