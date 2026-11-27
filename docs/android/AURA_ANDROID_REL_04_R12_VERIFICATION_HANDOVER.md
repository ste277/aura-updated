# AURA-ANDROID-REL-04 R12 — Independent Verification Handover (ticket 39248; verification 39247)

**PR:** #392 · **Date:** 2026-11-27 · **Ticket 39243 stays open.** Not merged, not deployed, not activated; Auto-merge off; no main synchronization; separate from REL-05.

| Item | SHA |
|---|---|
| Reviewed (39247) | handover `d1503278ae43dd7c0477f809b8af4c645b1b8725`, implementation `abdd9d8192b77b9fcb844e9ad1e98cddded9b230` |
| **R12 implementation** | `02e283e836638bd86763cd8447b370538d8050e2` |
| **R12 handover head** | the commit adding this file (handover, report and evidence only; no code) |
| CI on the implementation (automatic) | run 45974613839, integration `8dd8eef` (into `main` `477723d`): **9/9** |

## Concurrency model (R12)

**Actors.** Any number of browsing contexts of this origin run the current code: tabs, the page and the replay loop. The writers of the retired localStorage formats are only unreleased pre-R8 builds of this branch; the current code never writes them and only removes them after a committed decision. IndexedDB read-write transactions are atomic and serialized origin-wide. localStorage accesses are synchronous but share **no** transaction with IndexedDB.

**Identity.** `resolveIdentity` (R11) is the only classifier. R12 widens what it sees:
- every record whose outer **or** nested account is the account, via `relevantRecords`;
- incomplete retired keys, which are never trusted.

| Step | Atomic unit | What it establishes | What changes after it cannot do |
|---|---|---|---|
| **Inspection** (replay snapshot read) | one read-only transaction | candidate requests, each bound to `(recordId, clientRequestId, canonical payload)` | nothing: the snapshot authorizes no action |
| **Claim** (`enqueueOwned` / `claimForDispatch`) | one read-write transaction | re-checks that the record still carries the inspected identity and payload (else `changed`); runs the shared eligibility gate over every relevant copy and the durable decision; **at the linearization point**, synchronously re-inspects retired localStorage immediately before the claim write is issued; writes the claim and the dispatch mark; returns an **immutable ClaimToken** (account, request id, payload, record id, item) | a change after the claim commits cannot change what is sent (the sender posts `token.item`) or what is settled (settlement is bound to the token) |
| **Transmission** | the synchronous block that runs `transmissionCheck(token)`, the lease and transition checks, then calls `fetch`, with no `await` between | the retired localStorage state visible to this context when the request is handed to the network | a later contradiction cannot stop a request already handed over; it can only affect settlement, which preserves it |
| **Response → settlement** | one read-write transaction | deletes only active copies that still resolve **valid** to the claimed account, request id and payload; writes the `settled` decision for the claimed identity; clears the claim only if still this attempt's | replaced, modified, contradictory or unrelated copies are preserved; a successful answer never deletes a different or unsent record |
| **Discard decision** (sign-out) | one read-write transaction | for each identity in the confirmed snapshot, re-resolved: deletes copies that still resolve valid or damaged to it, writes the durable decision with the prior-send fact; a fresh claim from another context keeps the whole activity | new identities and replacements are never decided or deleted |
| **Physical cleanup** | after the decision commits only; each retired entry removed only if unchanged | removal of the confirmed retired copies | a failure leaves a permanently ineligible copy (its decision exists) |
| **Outcome reporting** | a verification read of IndexedDB plus localStorage after cleanup, and after reconciling an unconfirmed commit | `removed` only if **no** copy of the request physically remains; otherwise `cleanupPending`; new unidentifiable copies are reported `unidentified`; a failed verification never reports removal; a failed reconciliation is `uncertain` | n/a |

**Invariants.**
- I1: a request is transmitted only with a claim taken by a transaction in which it was eligible, and the bytes transmitted are the claimed item.
- I2: settlement and discard delete only copies that still resolve to the identity the claim or confirmation covers.
- I3: a durable decision precedes every destructive cleanup.
- I4: every reported outcome reflects verified physical state, or says that it is uncertain.

**N2 residual (cross-storage).** IndexedDB and localStorage cannot be made atomic together. R12 makes the guarantee **linearizable at the two points that matter**: any retired-storage state visible to this context when the claim write is issued, or when transmission begins, is honoured.

What cannot be guaranteed is a write by **another** context that the browser has not yet made visible to this context at that instant. localStorage gives no cross-context ordering primitive. Re-reading does not close this window, and R12 does not claim that it does.

Only unreleased pre-R8 builds of this branch can produce such a write. Under the current architecture the residual is bounded to that population.

**Smallest structural alternative** (not implemented; needs owner approval): stop treating live localStorage as an input at transmission time.
1. On first inspection, record in IndexedDB a **non-destructive seal** of the account's retired storage: per-key fingerprints plus the blocked candidate ids.
2. Block every candidate atomically through IndexedDB.
3. Treat any retired key or value not covered by the seal as making the account opaque until the next confirmed discard. Under the current design an unsealed write already blocks; the seal makes that block atomic with the claim.

This still reads localStorage to detect new writes, so it narrows the window to new keys but cannot eliminate it. A complete elimination would require pre-R8 builds to be unable to run concurrently, which is a rollout control (supported-client compatibility, §R5-4) rather than a code change.

**Owner decision requested (N2 residual).** Do you accept the bounded residual (only possible from unreleased pre-R8 builds), or should the seal alternative, or a rollout control that excludes pre-R8 builds, be scheduled? Nothing beyond the linearization-point checks is implemented.

## Implementation (rationale per model step)

All changes are in `apps/web/lib/offlineHabitQueue.ts` and `apps/web/lib/activitySync.ts`, plus one message wording in `signOut.ts`.

| Finding | Root cause (R11) | R12 |
|---|---|---|
| N1 | the replay claim took whatever record sat at the record id; the sender posted its earlier snapshot | `claimForDispatch(recordId, tab, expected)` refuses a changed record; the token is immutable; the sender posts `token.item`; settlement is bound to the token |
| N2 | the claim used a localStorage view captured before its asynchronous IndexedDB work | synchronous retired-storage inspection at the claim write (`takeClaim`) and at transmission (`transmissionCheck`) |
| N3 | settlement deleted by payload shape without re-resolving identity | settlement deletes only copies still resolving **valid** to the claimed identity and payload |
| N4 | incomplete aura_q4 keys could be trusted; a record without an outer owner was invisible to owner-index scans | incomplete keys are always `incomplete` (preserved; every plausible candidate blocked); `relevantRecords` scans the store for any record naming the account |
| N5 | removal was reported from the decision set, not from physical state | `remainingCopies` verifies IndexedDB and retired storage before reporting `removed`; new unidentifiable copies are reported |
| N6 | reconciliation after an unconfirmed commit always reported cleanup pending | reconciliation also verifies physical state: `removed` if nothing remains |
| C1 note | "still being sent" was reported before the network call started | now "still being sent, or about to be sent" |

## Witnesses: R11 (unchanged) vs R12

The reviewer's probe ran unchanged on `d150327` and produced their `independent.log`, apart from server-generated ids and timestamps. `test/rel04R12QueueConcurrency.test.ts` re-runs every N-witness against the vendored R11 head (`test/fixtures/rel04-r11-head`, checked against `abdd9d8`) and against R12, injecting at the same logical boundary whichever read the implementation uses.

| ID | R11 | R12 |
|---|---|---|
| N1 same-account / cross-account replacement | claim taken for the replacement; stale original posted | `changed`: nothing posted; replacement neither claimed, settled nor deleted |
| N2 direct / replay | 1 POST, 1 row | 0 POSTs, 0 rows; retired copy preserved |
| N3 | contradictory copy deleted by settlement | preserved; 1 row (the earlier legitimate send) |
| N4 readable nested id / `X:` / no outer owner | deleted and decided / `X` posted / `X` posted | preserved, unidentified, no decision, candidate refused, 0 rows |
| N5 new key / contradiction | removed=1 with a survivor | cleanup-pending; the new contradiction is reported unidentified; one decision |
| N6 | cleanup-pending with no copy | removed; with a failed reconciliation read: uncertain |

The other witnesses stay closed. D1, D4, D5 and D6, and D2, D3, D7 and P3, all pass on R12 (`review-r10-edge.on-r12.log`, R11 suite 38/38). C1 and C2 behave as before.

## Boundary tests (B1–B7, deterministic barriers, exact payloads asserted)

| Boundary | Test |
|---|---|
| inspection → claim | B1, N1, N2: a replacement or contradiction before the claim is refused |
| claim → transmission | B2: a record modified after the claim, so the **claimed** title is the one posted (1 row); a retired contradiction after the claim is caught by `transmissionCheck` (0 POSTs, claim released) |
| transmission → response | B3: a replacement at the same record id is not deleted by the success |
| response → settlement | B4: equivalent copies removed; a different-payload copy preserved |
| decision → cleanup | B5: a copy appearing after the commit is kept and the activity reported cleanup-pending |
| cleanup → reporting | B6: a copy written after cleanup keeps it cleanup-pending |
| controls | B7: cross-account same id isolated; healthy online and offline paths |

## Reproduce

```
TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R12QueueConcurrency.test.ts   # expect 36/36
```

The reviewer's probe on R12 is in `docs/android/evidence/rel04-r12/review-r11-independent.on-r12.log`. Its N1 hook no longer fires on R12; see the note there.

## Results (local, `02e283e`)

| Run | Result |
|---|---|
| R12 suite | 36/36 |
| math-core (every CI command) | 253/253 |
| Earlier suites | R4–R11, isolation, sign-out, token replay, reload visibility, replay reconciliation: all pass |
| DB / Chromium / Next app | 76/76 / 29/29 / 14/14 |
| Typechecks | exit 0 ×3 |
| CI 45974613839 | 9/9 |

**Adjusted checks** (same assertion, the boundary or line moved):
- the R11 D2-replay barrier fires on replay's snapshot read, whichever read API it uses;
- the replay-reconciliation source check names the new claim-bound settle line.

## Separate conditions (unchanged)

- **CI-09** (ticket 71038): the Rhythm Move capacity wall-clock failure; that test is not modified here.
- **Unreadable v2:** still fails closed. Supported, account-scoped recovery is required before release to Preview, internal or sideloaded populations. No recovery UI or storage reset is included.

## Checksums (sha256)

| File | sha256 |
|---|---|
| `apps/web/lib/offlineHabitQueue.ts` | `a324c91738a00b7d3227e15059dc8a5b25645a6065b8eeb79bb4a15f9c5d94b1` |
| `apps/web/lib/activitySync.ts` | `a827609e6909800448c4f6fd9f6a98fa118f7826d1bda2cd34716fae8a3f47c1` |
| `apps/web/lib/signOut.ts` | `4334527a9ec98fd72f6a6be7ce19ddac7297252125262686fc44056cbd1f7508` |
| `test/rel04R12QueueConcurrency.test.ts` | `1d419f3c6bafa4c05f40be29bd3919d2333377afcfae7dec2fad1be2adcf2fc8` |
| `test/fixtures/rel04-r11-head/offlineHabitQueue.ts.txt` | `7cf8faf1dbfa90fc18a118f99c490b1cf06ce1994fd28240ad7da36d8d021bf3` |
| `test/fixtures/rel04-r11-head/activitySync.ts.txt` | `bcf78bfe4b668f50e4ecc9b72117104df67795a58ad2bb8633c0c0dcf22ae96a` |
| `test/fixtures/rel04-r11-head/signOut.ts.txt` | `fc75da09a3893c6e9cfa414823fa384063c97f1aa7075dbc0ddc7fd5043e512e` |
| `docs/android/evidence/rel04-r11-independent-39247/SHA256SUMS` | `3ac6edf74cb06add5b2b0701445940b8b909868d06fd62471abfe0a0571ea494` |
| `docs/android/evidence/rel04-r12/README.md` | `ad6af1c5a056a076563634566829b3b2d4ca561fdf05e6cfb535466ca265ffe7` |
| `docs/android/evidence/rel04-r12/math-core-tests/manifest.json` | `d80f0caa64d2d1036936e2b76c6a3e9d8c0d08d46eecddeb3cc5d245464fa023` |
| `docs/android/evidence/rel04-r12/db-and-browser-tests/manifest.json` | `5bdb50f18e3e68fa9f73aa8464aeda10e0122c97c945064d84cc96f7ada0c336` |
| `docs/android/evidence/rel04-r12/typecheck/typecheck.log` | `632fc201a886715673c91c20e25dac647912f95f9913f90f477aa349ddd2b0df` |
| `docs/android/evidence/rel04-r12/math-core-tests/logs/249-test_rel04R12QueueConcurrency.test.ts.log` | `38398b9df682c177ba40d05fc1ccc56c5ae584f1799ad48a45aeec75ece575f4` |
| `docs/android/evidence/rel04-r12/review-r11-independent.on-d150327.log` | `1ed6aa9dcabddccd8d6a017df21a08cf36a8418a7bb352411da673ddba40d5a5` |
| `docs/android/evidence/rel04-r12/review-r11-independent.on-r12.log` | `56edd006ab89e7d303af344d170b79d51b1db03ec5fb45a5e9c2abc66a35a3d7` |
| `docs/android/evidence/rel04-r12/review-r10-edge.on-r12.log` | `63c2ba8a4fbb9eeaf9998c8e758a1117f98cfaea5df9d5757fde9e3c3bfd6ed0` |
| `docs/android/evidence/rel04-r12/review-r10-browser.on-r12.log` | `07a726dc8ca5f5c43408a1df9c5761088722c22d0a31fb07266833093544445e` |
