# Part 2 — P2-6 evidence checkpoint

**Status:** Documentation checkpoint only; P2-6 remains in progress in the parent-owned [task document](../tasks/part-2-data-architecture.md). This does not claim integrated browser verification passed or production compliance.

| Unit | Committed work-unit evidence |
| --- | --- |
| P2-0 | `9c2cd257d8289a625c841c39c3425b2bf3606cf0` — proposal and lifecycle contract |
| P2-1 | `7024995e55ee5ef142dd102496483b1c7d3cb2b1` — owner deletion |
| P2-2a | `c6a66e515748815bcffb2837832dbebb5e1d9d98` — 90-day access cutoff |
| P2-2b | `c3d77e566bf9eab0c735c4cafc716ebcc7a6de07` — bounded physical purge |
| P2-3a | `2cb476ac073d00c6fa6b76b2ff306bc267ebb422` — ticket audit |
| P2-3b | `b64c6eeb27ad62968a40a08468658d754a29b7fc` — analysis audit and retention |
| P2-4 | `58ac755435d51527b436b7419845647ae7c03312` — offline synthetic evaluation |
| P2-5a | `dec829a438ae2a803ba3f551ae30541a15f8cc5f` — report API |
| P2-5b | `887a5f1e075ec6d7563df3adb228d0e6a5d917db` — correction API |
| P2-5c | `90c0ccfa57eb80cec3d7e160c9a997ef6e7c4169` — same-user UI |

## P2-6 observed checks (prior independent evidence; not rerun here)

- `npm test`: 217 API + 71 web = 288 passing; typecheck, build and diff check passed.
- Isolated Compose **database only**, with host API/Vite because of `npm ci` dependency and loopback override. Real authenticated API against seeded synthetic data and two succeeded analyses: report POST 201/list 200; correction POST 201 twice/list 200; duplicate report 409; missing 404; foreign owner 404 in four checks. Reviewed status appeared while the original analysis remained unchanged.
- P2-5c mocked Chromium walkthrough passed independently. The P2-6 live Chromium run observed login, list navigation, older-version selection, same-user label, literal rendering of markup-like text and zero analysis POSTs. Its harness expected two report statuses but recorded only one report 201 and failed its assertion after the correction appeared. **Full live browser E2E did not pass.** Screenshot (private, do not commit): `/private/tmp/p26-last-browser-evidence/p26-last-failure-0922d19b-1584-4022-95b9-41ed615fa620.png`.
- P2-6 deletion cascade check was skipped because the harness precondition failed; P2-5b independently verified cascades earlier. Owned services were stopped; isolated database volumes remain for deliberate later handling.

## Open boundaries

No real provider, production data, Safari, legal/provider-terms validation or external log-retention enforcement was checked. Raw PII can reach OpenRouter without redaction or a notice/acknowledgement gate. Backups and provider copies are not erased by local deletion. Audit is content-free and best effort, not a complete compliance record. P2-4 release evaluation requires a named human decision and remains undecided. Do not convert this checkpoint into a completion or native-review claim.
