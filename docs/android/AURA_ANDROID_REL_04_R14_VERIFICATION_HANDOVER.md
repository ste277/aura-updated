# AURA-ANDROID-REL-04 R14 — Independent Verification Handover (ticket 39253; verification 39252)

**PR:** #392 · **Date:** 2026-11-27 · **Ticket 39243 stays OPEN.** Not merged, not deployed, not activated; Auto-merge off; no branch synchronization; separate from REL-05.

| Item | SHA |
|---|---|
| Reviewed (39252) | handover `f6a8cbeff26ac344828201a80082cbf8bab662aa`, implementation `a8a976733d73d8acc5eb13e2af687f3648204471` |
| **R14 implementation** | `0df08780bd75e16b676efda6c99c1738bc72681b` |
| **R14 handover head** | the commit adding this file (handover, report and evidence only; no code) |
| CI on the implementation (automatic) | run 46002683525, integration `80d5864` (into `main` `38b7fa6`): **8/9** — see "CI" |
| Historical R13 CI (unchanged record) | 45985719059 (`a8a9767`) 9/9; 45989628096 (`f6a8cbe`) 8/9 on attempt 1, then 9/9 after one approved targeted rerun |

## Unified outcome contract (R14)

R14 adds no new queue format, state machine or migration. It changes three things:
- One durable-state reconciliation, **`requestState`**, replaces the two partial readings that disagreed.
- Decisions record the server's answer.
- One physical-state verification, **`remainingCopies` + `classifyPhysical`**, decides cleanup reporting.

### Submission (one logical request = account + request id + payload)

`requestState` reads, in one IndexedDB transaction and in this order of authority:
1. The durable **decision**: settled with `serverOutcome` accepted or rejected, or discarded. A payload mismatch is a conflict.
2. A blocked retired copy, which pauses the request.
3. The live IndexedDB copies.
4. Otherwise the request is **absent**.

**Removal invariant:** every removal path (claim-bound settlement, the confirmed discard, and the test-only `discardRecords`) deletes an active copy only in the same transaction that writes its durable decision. So *no copy and no decision* proves the request never committed. Active-copy absence alone never does.

| Durable evidence (exact account + request id) | Queue result | Submission outcome | Home |
|---|---|---|---|
| decision settled + **accepted** | `settled` | **`already-recorded`** (success) | success; refresh replaces the row; **no retry** |
| decision settled + rejected | `settled` | `rejected` | error ("server responded …") |
| decision settled, answer not recorded (pre-R14 dev data) | `settled` | `outcome-unknown` | kept pending under the same id |
| decision **discarded** | `settled` | `not-stored`, reason `discarded` | "This activity was discarded on this device when you signed out, so it won't be sent." |
| decision payload ≠ caller payload (contradiction) | `conflict` | `not-stored` | error; nothing sent |
| live copy (committed) | `stored` (+ claim, or none after a lost acknowledgement) | sent, or `queued` | pending under the same id |
| blocked / paused copy | `paused` | `not-stored` / `queued` (if already committed) | — |
| no copy, no decision; or the transaction never ran or aborted | `failed` / `unavailable` | `storage-unavailable` (non-commit **established**) | "wasn't saved or sent. Try again" |
| commit unconfirmed and the reconciliation read failed, or the evidence is contradictory or paused | `unknown` | **`outcome-unknown`** | kept pending under the **same** request id |

**Retry contract.**
- A fresh-id retry (Home's "Couldn't log. Try again.") is invited only for confirmed non-commit, refusal or rejection.
- Every uncertain or already-settled outcome keeps the original request id and invites no retry.
- The server is idempotent per (user, request id); verified by the Postgres test below.

### Cleanup (per discarded request; committed and reconciled discards alike)

| Final verification (IndexedDB read, then retired storage inspected synchronously with the result) | Outcome |
|---|---|
| a copy that names the request is observed | `cleanupPending` (a copy is known to remain) |
| storage that names **no** request id exists (an unparseable v2 array, id-less entries or records) | `discardedUnverified`: absence cannot be inferred from unreadable data |
| the verification itself fails | `discardedUnverified` |
| no copy observed and nothing unattributable | `removed`: observed absence at that boundary, not a guarantee against later writes |

Earlier cleanup errors (`cleanupErrors`) are **diagnostic only**: the final verification decides the outcome. The durable decision blocks transmission independently of the physical state. Unreadable storage is never deleted.

### Path map (every consumer, one contract)

| Path | Uses |
|---|---|
| Direct submission (`submitActivityLog` → `enqueueOwned`) | `eligibilityGate` = `requestState`; lost-acknowledgement recovery = `requestState`; `outcomeOfDecision` |
| Offline persistence (`enqueueOwned`) | `requestState` inside the claiming transaction; a refusal aborts it |
| Replay (`replayLocked` → `claimForDispatch`) | `eligibilityGate` = `requestState`; claim bound to account, request, payload and record |
| Settlement (`settleRecords`) | claim-bound; records `serverOutcome` |
| Home (`handleLogActivity` → Good Right Now / Timeline / calendar) | one mapping of `ActivityWriteResult`; uncertain outcomes keep the id |
| Sign-out (`discardOwned`) | snapshot-bound decisions; `classifyPhysical` |
| Physical cleanup / reconciliation after a lost acknowledgement | `remainingCopies` + `classifyPhysical` |
| Legacy storage | quarantine and `unattributable` tracking (no recovery, no deletion) |

### Remaining architectural limitations

- localStorage and IndexedDB are not one transaction (N2). This is contained only by the mandatory writer-free origin and rollback allowlist.
- "removed" is an observation at the reporting boundary, not a guarantee against later writes.
- Decisions written before R14 carry no server answer, so they reconcile to `outcome-unknown`. These are development data only.
- Unreadable-v2 account-scoped recovery remains a separate mandatory release requirement. While unreadable data exists, its requests' physical state is reported unverified.

## Witnesses: R13 (unchanged) vs R14

The reviewer's probe ran unchanged on `f6a8cbe` and matched `independent-r13.log` after normalization.

| ID | R13 | R14 |
|---|---|---|
| F1: commit, lost acknowledgement, another tab settles | `storage-unavailable`; Home says "not saved or sent" and invites a retry; the fresh-id retry creates a **duplicate** (2 rows) | `already-recorded`; no retry invited; the same-id retry is idempotent; **1 row** |
| F2: opaque v2 array holds the same activity | removed=1 | `discardedUnverified` (+ unidentified 1); bytes preserved; resubmission refused |
| F3: deletion succeeds, read-back throws, final scan is clean | cleanupPending=1 | removed=1; `cleanupErrors`=1 (diagnostic) |

`test/rel04R14OutcomeReconciliation.test.ts` (28/28) runs F1–F3 on the vendored R13 head (`test/fixtures/rel04-r13-head`, checked against `a8a9767`) and on R14. Its **negative controls**:
- ignoring the durable settlement (R13 F1);
- a fresh request id after an uncertain outcome: the **real Home "Start now"** interaction routed through R13's submission shows "Couldn't log. Try again.", and the retry click creates 2 rows under 2 ids, while R14 shows no error, no retry and 1 row;
- opaque storage treated as absent (R13 F2);
- a stale cleanup error overriding the final verification (R13 F3).

It also covers outcome matrix M1–M9 and cleanup matrix C1–C6.

**Real browser.** Chromium CH16 (in `test/rel04Chromium.test.ts`, 30/30): two real tabs on one profile. Tab 1's IndexedDB commit acknowledgement is withheld; tab 2 replays and settles the request. Tab 1 then gets `already-recorded`, with 1 POST and 1 server row.

**Real PostgreSQL.** `habitLogIdempotencyDb` passed on a disposable PG16 with 54 migrations: same-id sequential and racing writes produce one row, distinct ids produce two, and accounts are isolated (`docs/android/evidence/rel04-r14/habitLogIdempotencyDb.local.log`).

**Adjusted checks.** No other assertion changed.
- R11 X1: an id-less v2 entry makes removal unverifiable, so X1 now requires that nothing is reported removed (F2 rule).
- Replay-reconciliation source check: names the settle line, which now records the server's answer.

## Reproduce

```
TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R14OutcomeReconciliation.test.ts
npx ts-node test/rel04Chromium.test.ts
```

Expected: 28/28 and 30/30.

## Results (local, `0df0878`)

| Run | Result |
|---|---|
| R14 suite | 28/28 |
| math-core (every CI command) | 255/255 |
| Earlier suites, assertions unchanged (except the two above) | R4–R13, isolation, sign-out, token replay, reload visibility, replay reconciliation: all pass |
| Chromium / Next app | 30/30 / 14/14 |
| DB | **75/76**: `weeklyPlanReviewClientDb` wall-clock check (below) |
| Reviewer probes 39244 / 39247 / 39249 / 39252 on R14 | all exit 0; earlier closures held |
| Typechecks | exit 0 ×3 |

## CI (reported accurately; not rerun)

- **Run 46002683525** on `0df0878`, integration `80d5864` into `main` `38b7fa6`: **8/9, not green**.
  - The failing job is "Day Constructor acceptance DB tests", on one setup check in `weeklyPlanReviewClientDb`: "8. setup: the constructed second instant genuinely falls on the SAME local date as the first". It failed at 12:57Z (18:27 IST).
  - The test builds the second instant as the first proposed slot plus 4 hours and requires the same Asia/Kolkata date, so in the IST evening it crosses midnight.
  - It imports nothing R14 changed. `main` `38b7fa6` passed that job at 11:45Z (17:15 IST).
- The same check failed in the local sweep (~13:06Z).
- This is recorded as a **separate CI stability finding**: wall-clock fixture, `weeklyPlanReviewClientDb` 8. The test is not modified here.
- The job log and metadata are preserved with checksums in `~/Desktop/Claude/AuraEvidence/REL-04-R14-CI-46002683525/`.
- **Green naturally triggered CI is therefore not yet established for R14.**

## Release conditions (unchanged, mandatory)

- **N2 writer-free origin and rollback allowlist** (from R13): exclude the R1–R3 writers and R4–R7 migrators; use a clean origin for exposed populations; run the acceptance test with retained tabs, worker caches and restored profiles.
- **Unreadable-v2 account-scoped recovery.**
- **CI-DEBT-10** (`rel04R4SsrAgreementJsdom` S3) remains separate and unmodified.

## Checksums (sha256)

| File | sha256 |
|---|---|
| `apps/web/lib/offlineHabitQueue.ts` | `10622d8a7e76c2fce30b4bd6d3ea8bf5d55b5b485b19ba2667e2b7cb526ca611` |
| `apps/web/lib/activitySync.ts` | `2e1facc54b86f2ebf6f9ece4c1961d4cd1c1f2bcc2daae27217b8db69afdd250` |
| `apps/web/app/page.tsx` | `7bc11e3c9548962b51abbd4379222157f34824fcf3dbfe7fe8c48e119800e719` |
| `test/rel04R14OutcomeReconciliation.test.ts` | `7fd1b9a80f1ee4e8a5f86534d4ed8ed2ff83adbf54cf207e7ac3103d1d6421c7` |
| `test/rel04Chromium.test.ts` | `dfd67546c8e658327a75f4d915c088c0350ba294a610bf616c4afa3cb96f18cb` |
| `test/fixtures/rel04-r13-head/offlineHabitQueue.ts.txt` | `071761878a63c423d09ae47389eb4cf6016e7ef9b602e41040ede8f994bfe197` |
| `test/fixtures/rel04-r13-head/activitySync.ts.txt` | `31238bfff6ff58378ffd9ea502a9695902b5a25f866fd425473d1138315ca0fc` |
| `test/fixtures/rel04-r13-head/signOut.ts.txt` | `8d312ef423a806623221ecf3f4ec78413df2ad9ddad84a25f3dadfe876dfd98c` |
| `docs/android/evidence/rel04-r13-independent-39252/SHA256SUMS` | `58414687e5b96cf4e1f79883c2461b192e0f6b3d401b08ba83e1f7979d33831a` |
| `docs/android/evidence/rel04-r14/README.md` | `8b3d7add4ff81baf89890e7133783770d8cd48067df2a6cbee5700a01b670ed7` |
| `docs/android/evidence/rel04-r14/math-core-tests/manifest.json` | `02caa7713efdbea6871e380555644f96c90d898919f7399fe82c2e8ef714785a` |
| `docs/android/evidence/rel04-r14/db-and-browser-tests/manifest.json` | `c568f41cc6457242470bdd75dd48abb4855a94d824ad3e42aead966e30ea1aa8` |
| `docs/android/evidence/rel04-r14/typecheck/typecheck.log` | `60295dc915112068a8cc8cf5d70724efd51f2e50ee61baa67921e82b50c33b5a` |
| `docs/android/evidence/rel04-r14/habitLogIdempotencyDb.local.log` | `e583897e397b0f8dabac8a1a3a1f9a08bf6884e7425a167a1150c15a7997494c` |
| `docs/android/evidence/rel04-r14/review-r13-independent.on-f6a8cbe.log` | `9dd84699886a4253d6a66fb4e6f9e52cc1bd28ef27c770c784e764ca0627ca28` |
| `docs/android/evidence/rel04-r14/review-r13-independent.on-r14.log` | `04fdc64cf4b9c52b0519d7c8342826451f45b55413b28c62d63985b82be65708` |
