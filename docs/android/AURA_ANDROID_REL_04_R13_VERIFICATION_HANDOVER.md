# AURA-ANDROID-REL-04 R13 — Independent Verification Handover (ticket 39250; verification 39249)

**PR:** #392 · **Date:** 2026-11-27 · **Ticket 39243 stays OPEN.** Not merged, not deployed, not activated; Auto-merge and Auto-fix off; no branch synchronization; separate from REL-05.

| Item | SHA |
|---|---|
| Reviewed (39249) | handover `6373fd9eac74aaac2596aefaeecfd147482dfb26`, implementation `02e283e836638bd86763cd8447b370538d8050e2` |
| **R13 implementation** | `a8a976733d73d8acc5eb13e2af687f3648204471` |
| **R13 handover head** | the commit adding this file (handover, report and evidence only; no code) |
| CI on the implementation (automatic) | run 45985719059, integration `20a0712` (into `main` `5551166`): **9/9** |

## Invariants and transaction boundaries (R13)

R13 keeps the R12 concurrency model and closes its remaining gaps at the invariant level.

| # | Invariant | Enforced where (the authoritative operation) |
|---|---|---|
| I1 | **The inspected identity, persisted identity, claimed identity, authenticated account and transmitted request agree.** | `claimForDispatch(recordId, tab, {ownerUserId, clientRequestId, payload})` refuses any record whose outer account, request id or canonical payload differs from what was inspected (`changed`); the claim token records `owner`. Both senders refuse to transmit when `token.owner !== lease.account`; the body sent is `token.item`; settlement is bound to the token. |
| I2 | **A reported queue-write outcome is exactly what storage holds.** | `enqueueOwned`: a refusal decided inside the claim transaction throws, which aborts the transaction, so a newly added row never survives a refusal. An unconfirmed commit is reconciled from storage, never inferred from the error. |
| I3 | **Once a write is known to be committed, later failures cannot erase that knowledge.** | A committed enqueue whose transmission check later fails reports `queued`, never "not stored". A reconciled commit reports `stored` (no claim), never a rejection. Durable decisions are first-write-wins and keep `possiblySent`. |
| I4 | **An uncertain commit preserves the request identity and prevents duplicate submission.** | `outcome-unknown`: the page keeps the row pending under the same client request id (no re-entry invitation); the copy, if committed, replays once under that id; the server is idempotent on that id. |
| I5 | **Reported physical state is observed, known or explicitly unknown.** | `remainingCopies` reads IndexedDB first, then inspects retired storage synchronously with computing the result. Outcomes: `removed` (decision present, no copy observed at that boundary), `cleanupPending` (a copy is known to remain), `discardedUnverified` (decision present, physical state could not be read), `uncertain` (decision state unknown). |

**Queue-write outcomes (`enqueueOwned` → `submitActivityLog`).**

| Storage fact | Queue result | Submission result |
|---|---|---|
| Transaction never ran, or failed before issuing any write | `failed` | `storage-unavailable`: confirmed not queued |
| Refusal inside the transaction (e.g. a retired-storage read failing at the claim linearization point) | `unavailable` / `paused` (transaction **aborted**) | `storage-unavailable` / `not-stored`: confirmed not queued; a pre-existing copy is untouched |
| Committed | `stored` + claim | sent (or `queued` / `account-changed` if a final check stops it: kept) |
| Commit unconfirmed, reconciliation finds the copy | `stored` (no claim) | `queued`: confirmed queued; replays once after the stale claim expires |
| Commit unconfirmed, reconciliation finds no copy | `failed` | `storage-unavailable`: confirmed not queued |
| Commit unconfirmed, reconciliation unreadable | `unknown` | `outcome-unknown`: possibly queued; kept pending under the same id |
| Server answered definitively | settled (claim-bound) | `confirmed` / `rejected`, even if a later local settlement write fails (the server is idempotent on the request id) |

**Every path, one set of invariants.**

| Path | Code | I1 | I2/I3 | I5 |
|---|---|---|---|---|
| create + claim (direct) | `enqueueOwned` | lease account = item owner; gate over every relevant copy | abort on refusal; reconcile | — |
| read / present | `readOwnedQueue`, `readOfflineQueueView` | `resolveIdentity` over every record naming the account | — | — |
| claim (replay) | `claimForDispatch` | account + request + payload binding | — | — |
| transmit | `submitActivityLog`, `replayLocked` | `token.owner === lease.account`; `transmissionCheck`; `token.item` | committed refusal reported `queued` | — |
| settle / release | `settleRecords`, `releaseClaim` | bound to the token (re-resolved identity + payload) | first-write-wins decision | — |
| discard | `discardOwned`, `discardQuarantined` | snapshot identities only, re-resolved | decision before cleanup; reconciliation read | — |
| report | `remainingCopies`, `discardOutcomeMessage` | — | — | IndexedDB, then retired storage, synchronous with the result |

`discardRecords` is a test-only export that no application path calls.

## N2 release safeguard (mandatory release acceptance conditions; not implemented here)

The writer-free release origin and rollback allowlist below are **mandatory release acceptance conditions** for REL-04 activation, in addition to unreadable-v2 recovery. This ticket changes no origin, performs no cleanup and activates nothing.

1. **Writer-free origin and rollback allowlist.** Keep an allowlist of the release origin, the served commit and every rollback candidate. It excludes every build that writes or migrates the retired formats:
   - R1 `d09449b` (v2);
   - R2 `db8607e` (q3, v2→q3);
   - R3 `b323d2a` (q4, migration);
   - every R4–R7 build (`fc6536e`…`7cae58a`), which migrates or removes retired entries.

   Upgrade and every rollback must be approved against the same allowlist.
2. **The existing Production origin stays** the public release origin only if two things are verified:
   - its writer-free lineage: the current alias at `a39f398` and the rollback candidates `ac46fc3`, `7a9af83` and later contain none of the affected keys;
   - the configured native origin matches.
3. **Exposed populations need a clean origin.** This covers Preview, internal and sideloaded populations that may have loaded an affected build: the READY R1–R3 Preview deployments, the branch alias, and native shells pointed at them.
   - Serve the R12-or-later program from a clean, dedicated origin that has never served an affected build, including during rollback.
   - Keep the old origin isolated for account-scoped recovery only, with no automatic raw-state transfer.
   - Account for retained tabs, restored worker caches and restored WebView profiles: an alias change, logout or closing tabs does not exclude a writer on a reused origin.
4. **Acceptance test** (from 39249), per supported browser or WebView class:
   - **Setup:** in a disposable profile, run the latest legacy writer for each format on the historic endpoint. Keep a tab or WebView open, preserve an offline worker-controlled document, then restart or restore the profile.
   - **Pass criteria:**
     - the release candidate and the actual approved rollback at the release origin show zero legacy mutations during upgrade and rollback;
     - zero retired entries cross origins;
     - one healthy online write and one replay are attributed correctly;
     - a visible contradictory entry on a synthetic affected origin blocks the matching send.
   - **Record:** the served SHA, the native origin and the rollback SHA.
   - **Fail:** if the rollback exposes a legacy writer or the origin's history cannot be established.
5. If same-origin coexistence with unmodified legacy writers is mandatory, **N2 stays OPEN**: no in-app seal can close it.

## CI and separate conditions

- CI-09 is closed on `main` (`5551166`); the branch is not synchronized.
- Unreadable-v2 account-scoped recovery remains a separate mandatory release requirement.
- Ticket 39243 stays OPEN.

## Witnesses: R12 (unchanged) vs R13

The reviewer's probe ran unchanged on `6373fd9` and matched `independent-r12.log` after normalizing ids and timestamps. On R13 (`docs/android/evidence/rel04-r13/review-r12-independent.on-r13.log`):

| ID | R12 | R13 |
|---|---|---|
| E1 account-only replacement (B/X/P at K) | claim for B; P posted with A's lease; 1 A row | refused; 0 POSTs; B's record preserved; no claim, no decision. The healthy equivalent control still sends once |
| E2 storage read failure at the claim | `storage-unavailable`, but a hidden row committed and later replayed (1 row) | the transaction aborts; 0 records, 0 claims; replay 0; 0 rows |
| E3 retired copy written during the final scan | removed=1 with the copy present | cleanup-pending |
| E4 decision known, physical read failed | "cleanup pending" (a copy implied) | `discardedUnverified`: "couldn't check whether a copy of it remains" |

`test/rel04R13QueueIntegrity.test.ts` runs each E-witness on the vendored R12 head (`test/fixtures/rel04-r12-head`, checked against `02e283e`). That run is the **negative control**: each test detects the broken invariant there. It then covers, on R13:
- the replacement matrix for account-only, payload-only, request-id, cross-account and equivalent-copy replacements, with a healthy **positive control**;
- direct-submission claim/lease agreement, with a **mutation negative control** (a queue that returns a B claim leads to 0 POSTs) and a positive control;
- the transaction outcomes in M2a–e, including retry and replay after each, asserting exact POSTs, rows, claims and decisions;
- cleanup verification (M3).

Expected **28/28**. The earlier probes on R13 hold every R4–R12 closure.

## Reproduce

```
TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R13QueueIntegrity.test.ts
```

## Results (local, `a8a9767`)

| Run | Result |
|---|---|
| R13 suite | 28/28 |
| math-core (every CI command) | 254/254 |
| Earlier suites, assertions unchanged | R4–R12, isolation, sign-out, token replay, reload visibility, replay reconciliation: all pass |
| DB / Chromium / Next app | 76/76 / 29/29 / 14/14 |
| Typechecks | exit 0 ×3 |
| CI 45985719059 | 9/9 |

## Checksums (sha256)

| File | sha256 |
|---|---|
| `apps/web/lib/offlineHabitQueue.ts` | `071761878a63c423d09ae47389eb4cf6016e7ef9b602e41040ede8f994bfe197` |
| `apps/web/lib/activitySync.ts` | `31238bfff6ff58378ffd9ea502a9695902b5a25f866fd425473d1138315ca0fc` |
| `apps/web/lib/signOut.ts` | `8d312ef423a806623221ecf3f4ec78413df2ad9ddad84a25f3dadfe876dfd98c` |
| `apps/web/app/page.tsx` | `8ccffcc45b829675af1577b128e56316e678d1e5e8f35efac687e5ecbe5b2177` |
| `test/rel04R13QueueIntegrity.test.ts` | `15d67a4f30d660fb713254595427db24ddca97c9268009765c1337011e6ecbee` |
| `test/fixtures/rel04-r12-head/offlineHabitQueue.ts.txt` | `a324c91738a00b7d3227e15059dc8a5b25645a6065b8eeb79bb4a15f9c5d94b1` |
| `test/fixtures/rel04-r12-head/activitySync.ts.txt` | `a827609e6909800448c4f6fd9f6a98fa118f7826d1bda2cd34716fae8a3f47c1` |
| `test/fixtures/rel04-r12-head/signOut.ts.txt` | `4334527a9ec98fd72f6a6be7ce19ddac7297252125262686fc44056cbd1f7508` |
| `docs/android/evidence/rel04-r12-independent-39249/SHA256SUMS` | `2355dd2ea1915ed65e972076774eefe2dbf6cca7b1118aa77005a5222b5ed15b` |
| `docs/android/evidence/rel04-r13/README.md` | `64466004fe48db8dd8fc3f226bf60abc9ce97007d6b4ae7e2b8cf2e6d3f08841` |
| `docs/android/evidence/rel04-r13/math-core-tests/manifest.json` | `966ad6f025368ee3583ae2465052da0173eb57ce2cf28799b311b71a10f53493` |
| `docs/android/evidence/rel04-r13/db-and-browser-tests/manifest.json` | `bce774621d2631bbd0695c4a3881081f8965eb5a4788b22370c5a83f8ec881e1` |
| `docs/android/evidence/rel04-r13/typecheck/typecheck.log` | `d99771a493f4efca1ce59507d115f5b1f0efb4b8e89379fe1816edcd1badc959` |
| `docs/android/evidence/rel04-r13/math-core-tests/logs/250-test_rel04R13QueueIntegrity.test.ts.log` | `662948fe4236568dfba993cf92a4b9bb5acd7c53e347c8ef8582e46db4acdc37` |
| `docs/android/evidence/rel04-r13/review-r12-independent.on-6373fd9.log` | `3c6759ffe1a1e1198240542bc4727da4841143c226159eeccec1d0ad151e0563` |
| `docs/android/evidence/rel04-r13/review-r12-independent.on-r13.log` | `d7a6c0766ddddf376adc2aa169480dc333132680cb014983b81de7e9560a550c` |
