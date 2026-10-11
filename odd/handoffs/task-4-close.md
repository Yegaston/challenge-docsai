# Close Task 4: native review and closure commit for ticket analysis

Short context handoff for a fresh session, **not a specification or authorization to implement**. Task 4 implementation is already done and functionally verified; this handoff covers only its closure path. The authoritative scope is [Task 4 in the feature brief](../tasks/support-ticket-ai.md). Reconcile that document, its Engram mirror, and the repository before any action.

## Where to resume

- Branch at handoff: `feat/ticket-analysis`; HEAD: `974c490`. The full Task 4 implementation is **uncommitted**: new `apps/api/src/modules/analyses/`, `apps/api/migrations/003-analyses.sql`, five `apps/api/test/analyses*.test.ts` files, plus tracked edits (`controller.ts`, `server.ts`, `initialize-users.ts`, `package.json`, lockfile). These are the review candidate, not dirt to discard.
- **The working tree mixes three uncommitted workstreams.** Task 4 (analyses), the dev-database-password work (`compose.yaml`, `config/development.example`, README edits), and Makefile/`scripts/`/`odd/tasks/make-run.md` work. Commit boundaries must separate them: the Task 4 closure commit contains only Task 4 paths. Never discard or bundle the others; their commits are separately authorized (see `odd/tasks/dev-database-password.md` and `odd/tasks/make-run.md`).
- Preserve untracked `.codegraph/`, `CHALLENGE.pdf`, `odd/handoffs/`, `Makefile`, `scripts/`.
- Engram project `challenge-docsai`, topic `odd/support-ticket-ai/tasks`. Reconcile before acting.

## Agreed closure decisions (user, this session)

1. **Order: smoke → review → commit.** However, the user decided to **skip the real OpenRouter smoke in this iteration**. With the smoke skipped, the order collapses to: native review → closure commit. If the user later opts in to the smoke *before* review starts, the smoke runs first (a live-model quality finding could change prompt code and invalidate an existing review).
2. **Native review starts from a fresh inspect.** Two earlier START attempts failed with `consent-binding-expired` and created no lineage (`lineage_created:false`). No lineage, approval, or consent from those attempts exists. Do not retry the old bindings; run a new inspect and follow its offered START route.
3. **Closure commit happens only after review approval and acknowledgement**, and only when the user authorizes the commit step. Review outcomes never authorize delivery.

## Task 4 state in one paragraph

Protected `POST /api/tickets/:id/analyses` with optional bounded refinement instruction (2,000 chars), versioned prompt builder, OpenRouter-backed Vercel AI SDK invocation (`ai@7.0.137`, `@openrouter/ai-sdk-provider@3.1.0`, `zod@4.1.8`), validated post-processing, and a deterministic mock adapter for tests. Each analysis version persists summary, category, uncertainty note, model ID, prompt version, and status (`running`/`succeeded`/`failed`) with SQL CHECK-enforced shape; failures retain safe failure codes (`timeout`, `provider`, `invalid_output`, `unconfigured`). Original ticket text is treated as untrusted data. One active analysis per user (advisory lock), max five starts per minute including failures, 60-second provider timeout, no automatic retries. Connection-loss crash fixed test-first: backend termination during provider wait yields safe 503, honest running attempt, and a healthy process.

## Verification already established (do not repeat blindly)

- API 164 + web 19 tests, typecheck, build, `git diff --check` all pass. Five focused analysis suites (69) and the 40-test correction suite pass.
- 313 clean PostgreSQL 17 checks (fresh/pre-003 volumes, owner history, failures/retry, advisory locks/rate bounds, restart retention) passed before the crash fix; after the fix, 96 live termination/timeout/persistence assertions passed and the targeted boundaries were rechecked, but the full pre-fix 313 suite was not repeated.
- Measured size: ~942 changed lines (~91 lines over the 600–900 forecast), required crash-safety coverage, approved as a reportable overage. Report the exact final review load to the reviewer.

## First actions in the new session

1. Reconcile feature brief, Engram mirror, `git status`, HEAD, and the `gh stack` chain. Confirm the uncommitted Task 4 paths are intact and unchanged (input hashes were stable at HEAD `974c490`; re-verify nothing drifted).
2. Call `gentle_review` with `{"operation":"inspect"}`. Resolve the intended-untracked selection the inspect offers (Task 4's source/test/migration paths; unrelated untracked work is preserved/excluded as inspect directs). The prior ready inspect target was `sha256:b78cbc71...`; a fresh inspect supersedes it if the tree changed.
3. If START returns a consent envelope, relay it losslessly and let the human decide; submit the answer exactly once via `answer-consent`. If review consent is declined, report and stop; the closure commit remains a separate user decision.
4. Drive capture exactly: one current collectBinding per `gentle_review_capture` (or the complete group via `gentle_review_capture_group`), forecast relayed and acknowledged before any reviewer run. A materialize review is long work; relay forecasts before resubmitting with `reviewerRunAcknowledged: true`.
5. On `approved`: obtain the provider-issued `acknowledge-approved` continuation via bound STATUS and execute it unchanged; report the burn. Then propose the closure commit to the user: a single Conventional Commit (`feat(tickets): ...` or `feat(analyses): ...`) containing only Task 4 paths, with the feature-brief progress update either in the same unit or as the follow-up `docs(odd)` commit, matching the established pattern.

## Boundaries and caveats

- No push, PR, merge, reset, recover, or acknowledgement replay is authorized by this handoff. Delivery follows ordinary repository policy after acknowledgement burns review authority.
- **Skipped checks to record honestly:** paid OpenRouter smoke (no key used this iteration); live uncertain-ACK scenario (unit/mock evidence only); full pre-fix 313-check suite not repeated after the crash fix. Any closure report must state these as skipped, not passed.
- Real-model semantic quality (summary language match, factual grounding) remains unverified; it is not a review blocker but must not be claimed as verified anywhere.
- This environment may migrate to a new VPS before this task runs. After any migration, reconcile: full checkout including `.git` and uncommitted changes, secrets transferred by a secure channel (never in commits), PostgreSQL data backed up separately (copying the repo does not copy the database), and do not assume the Engram mirror transferred (rebuild from `odd/tasks/` if missing). Node ≥22.12, npm ≥10, Docker/Compose; run `npm ci` and repeat checks before resuming.
