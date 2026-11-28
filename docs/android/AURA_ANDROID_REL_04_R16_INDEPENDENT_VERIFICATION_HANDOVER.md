# AURA-ANDROID-REL-04 R16 — Independent Verification Handover

**Ticket:** 39259. **Responds to:** independent verification 39258 (NO-GO: G4–G6). **Target:** 39260.

**Status:** **ANDROID REL-04 R16 READY FOR INDEPENDENT VERIFICATION (39260).** The integration conflict with main is resolved, and all nine hosted jobs and every PR check pass (§6.3).

**Controls:**
- PR #392 is open; nothing is merged, deployed or activated.
- Auto-merge and Auto-fix are off.
- Production remains on REL-05.
- Ticket 39243 stays OPEN.

R16 keeps the R15 shared client architecture (39256 Option B). It corrects three boundaries inside it. There are **no server, API, database-schema, IndexedDB-schema or service-worker changes**.

## 1. Revisions

| Item | Value |
|---|---|
| Reviewed R15 | Implementation `e6a6a6678bf6300362e15cf398343a246807a7e2`; handover `08a13fee8d01f8991bb0ac24ecffd3f0c4f5c976` |
| **R16 implementation** | `3c906f9c8485f51e0713c31d8a8517050a98d6c5` (tree `10d03e64340ed706561b5d8e625ed031afc85e0e`). Its runtime files are byte-identical at the final head. |
| **Final branch head (code)** | `4dce038688f2dab71c1541b66f6bb21978b18808` (tree `a688eed0691a54d751c188533c1df83be9919b75`) |
| **Final integration (hosted)** | `fbb8d34`: `4dce038` merged into main `fd8b8f5b0596cba460f50926f7cc766570a40ad8` |
| Handover commit | The commit that adds this file (documentation and evidence only) |
| `main` at R16 | `aab56029bb6804ff36c837f3b06ce076dc4d9bbf` (#400 My People; advanced from `73cea7d`). The branch was not synchronized; hosted CI tests the automatic merge with this base. |

**Evidence recovered:**
- 39258 disposition: `docs/android/evidence/AURA_ANDROID_REL_04_R15_INDEPENDENT_DISPOSITION_39258.md`.
- 39258 evidence: `docs/android/evidence/rel04-r15-independent-39258/`, preserved byte-for-byte. **32/32 manifest entries verified.**

## 2. Root causes and shared corrections

| Blocker | Root cause (R15) | Shared correction (R16) |
|---|---|---|
| **G4**: a contradictory receipt was read as success | `validReceipt` checked only the row's three IDs. Every consumer (gate, operations read, recovery upgrade) trusted that check. | **Receipt v2** carries the complete validated server row: identity plus every persisted-intent field. On **every** read, recovery, upgrade and settlement it is re-validated with **the same row binder** as POST answers and GET evidence (`bindServerRow`), against the operation's own canonical payload. v1 receipts (no complete intent) and any contradictory, incomplete or malformed row are **unverified**: no success, no cleanup, and the copy and identity are kept. **Bypass review closed two more paths:** `settleRecords` with an invalid receipt now removes nothing and writes nothing, and `recordVerifiedReceipt` validates before deleting. |
| **G5**: a temporary refusal settled permanently and deleted the copy | The decoder treated any JSON 4xx with an `error` string as definitive. | **Definitive** = the route's deterministic validation failure, checked three ways: exact status, exact message, **and** the client re-deriving the same failure from its own dispatch body (`definitiveRefusal`). This applies only under the current lease and with **no possible earlier send**. Everything else (429, 404, "Unknown activity.", messages that cannot be re-derived, unsupported bodies) stays **unresolved**: copy and ID kept, no rejection recorded. One shared `settlementReceipt` rule serves direct submission and replay. A rejected receipt is v2 with its `reason`, re-derived when read. |
| **G6**: a Calendar remount lost the unresolved handle | Recovery depended on component state (the modal), and `handleLogActivity` minted a new ID for every call. | **One shared recovery contract** in `page.tsx` `handleLogActivity` (the single entry point), over the durable ID-keyed projection, which survives remount, navigation and restart. A fresh submission for an activity with an **open** operation (pending or unresolved) throws `ActivityRecoveryRequiredError(originalId)`, and nothing is sent. Every surface (Home, Timeline, Past Activity / Calendar) renders that operation's recovery: Check again and Retry under the original ID. A page-level list shows unresolved operations on every tab. **A separate identical activity** is still possible through an explicit choice (`separate: true`, "Save as a separate activity" / "Log as a separate activity"). The activity match only decides when to *ask*; it never resolves, releases or deduplicates anything. Store "pending" never downgrades an in-memory "unresolved". |

**Runtime files changed (all within the R15 scope):**
- `apps/web/lib/habitLogSyncPolicy.ts`
- `apps/web/lib/offlineHabitQueue.ts`
- `apps/web/lib/activitySync.ts`
- `apps/web/lib/pendingReplayReconciliation.ts`
- `apps/web/app/page.tsx`
- `apps/web/components/HomeDashboard.tsx`
- `apps/web/components/Timeline.tsx`
- `apps/web/components/PastActivityModal.tsx`

`CalendarViewSection.tsx` is unchanged in R16.

## 3. Witnesses: 39258 probes, unmodified

| Probe | R15 `e6a6a66` (production build / jsdom) | R16 |
|---|---|---|
| G4 receipt (jsdom) | exit 1 (fault observed: `already-recorded`, 0 POSTs, 0 rows, operation confirmed) | exit 0 |
| G5 refusal, direct + replay (jsdom) | exit 1 (rejection settled, copy deleted, same-ID retry 429) | exit 0 |
| G5 JSON 429, real Home (production build, Chromium, PostgreSQL) | FAIL "must keep the exact retryable copy" | OK |
| G6 Calendar remount (production build, Chromium, PostgreSQL) | FAIL (2 rows, 2 IDs) | OK |

Logs: `docs/android/evidence/rel04-r16/witnesses/{r15-e6a6a66,r16-3c906f9}/`.

- R15 was built in a detached temporary worktree, since removed.
- The R16 runs used the final working tree before an import-order-only change.
- Both R16 suites below run again on `3c906f9` in the sweep and in CI.

## 4. Acceptance and negative controls

**`test/rel04R16OperationCorrection.test.ts`** (jsdom; real client modules, real route, real page): **56/56** locally. In CI, the 5 R15-fixture provenance checks print SKIP on the shallow clone.

| Case | Covers |
|---|---|
| W G4, G5 direct and replay | R15 reproduces; R16 closes |
| G4 matrix (16) | Matching IDs with contradictory title, timestamp, duration, source, significance, notes and activity ID; incomplete (no notes / activityId / logSource / durationMinutes); malformed (string duration, unparseable time, array, missing row); record-ID mismatch. On every consumer: authority unverified, operation unresolved, submit `outcome-unknown`, recovery upgrade refused, settlement removes nothing, 0 POSTs, copy kept. Control: a complete v2 receipt is success; the same receipt as v1 is not. |
| G5 matrix (8 refusals × direct and replay) | 429 ×2; 404 "User not found."; 400 "Unknown activity."; 400 "Missing required fields." or invalid timestamp for a valid body; 422; 400 without an error. Each is unresolved, copy and ID kept, nothing recorded, and the later same-ID replay reaches the writer: 1 row. A body the route would refuse is never re-dispatched after a possible send (paused). |
| G6, real page (Calendar / Past Activity) | **Remount** (Cancel, back to You, reopen Activity Log): the notice is shown; the identical re-entry is withheld (no POST, 1 row); "Retry that entry" keeps the original ID (1 row). **Separate:** "Save as a separate activity" gives 2 rows and 2 IDs. **Restart** (page remounted, memory gone, store kept, answers still unverifiable): withheld, then Retry gives 1 row and 1 ID. |
| Single shared gate | `handleLogActivity` is the only `findRecoverableOperation` caller. Home, Timeline and Past Activity consume its error; no view-specific reconciliation exists. |
| **N9** (receipt without the row binder) | Detected (G4: `already-recorded`, 0 rows) |
| **N10a** (R15 refusal rule in the decoder) | Detected (`rejected` vs `unverified`) |
| **N10b** (full R15 refusal path) | Detected (copy deleted, rejection recorded) |
| **N11** (shared recovery contract disabled) | Detected (Calendar re-entry: 2 rows, 2 IDs) |
| **N12** (settle with an invalid receipt) | Detected (copy deleted); R16 removes nothing |

**`test/rel04R16HomeChromiumDb.test.ts`** (**production build, real Chromium, disposable migrated PostgreSQL 16**): **15/15** locally.

| Case | Result |
|---|---|
| G5, real Home JSON 429 | Unresolved; copy kept; no rejection. The replay path gets the same 429 and keeps the copy. Explicit Retry: 3 POSTs with one ID and one body, then 1 row and a v2 receipt equal to the row. |
| G6 remount / separate / restart, real Calendar | Remount and restart: the identical re-entry is withheld (no POST), and Retry keeps the original ID (1 row; every POST carries that ID). Separate: 2 rows, 2 IDs. |
| G4, real app | A seeded contradictory v2 receipt beside the live copy: never "Logged", nothing sent automatically, copy kept, recovery offered. Retry: 1 row, and the receipt is replaced by a valid v2 receipt. |

**Preserved:**
- G1–G3, F2, F3 and legitimate independent operations: the R15 contract suite passes **64/64**, the R15 production Home suite (A/A'/B/E/H) passes, R14 F1–F3 passes **28/28**, and R4–R13 are all in the sweep.
- **Adjusted R15-era assertions** (R16 tightens exactly what they pinned):
  - Contract B: "Unknown activity" is now unresolved; a definitive case is added (invalid timestamp, giving a v2 rejected receipt).
  - Contract C and D: receipts are v2 with complete rows.
  - R14 M4: a v2 rejected receipt whose reason the payload re-derives.

## 5. CH15

Unchanged: the historical fixture, the assertions and the diagnostics from R15. The 39255 local 29/30 discrepancy remains **open and unclassified** (no reproduction of the miss). CI-DEBT-10 is unchanged.

## 6. CI and local results

### 6.1 Hosted run 46048936628

The run was naturally triggered on `3c906f9`. Its integration is `ffc8c5c`: the merge of `3c906f9` into the **new** main `aab5602`. Result: **8/9 jobs, 483/484 steps, attempt 1. Not rerun.**

Every R16 and REL-04 step passed in that run:
- R16 correction suite: 51/51; the 5 provenance checks are skipped on the shallow clone.
- R16 production Chromium suite: 15/15.
- R15 contract and production suites.
- R4–R14 suites.
- Chromium 30/30.
- PostgreSQL idempotency.
- Weekly Plan Review.

**The one failing step is "Run AURA-MP-1 My People DB test"** (`test/myPeopleDb.test.ts`, new on main via #400). Checks D6, D7 and E5 fail: `POST /api/plans` returns 503 `client_upgrade_required`.

**Cause: a cross-PR interaction, not an R16 defect.**
- REL-04 (since R2) makes `/api/plans` refuse writes that lack the `X-Aura-Expected-Account` binding. On main, `/api/plans` has no such refusal: `refuseUnboundWrite` appears 0 times there and 2 times on this branch.
- The new MP-1 DB test calls the plans route directly without the binding.
- This is the same adaptation REL-04 R3 made for five existing DB suites (`test/rel04BoundTestHeaders.ts`).

Evidence: `~/Desktop/Claude/AuraEvidence/REL-04-R16-CI-46048936628/`, with checksums.

**Owner decision required.** Fixing this needs two things, and neither is authorized under 39259:
1. A branch synchronization with `aab5602`.
2. A test-only change binding the MP-1 DB test's plan requests.

### 6.2 Local sweep on `3c906f9` (clean tree)

| Job | Result |
|---|---|
| math-core | 262/263 |
| Chromium | 1/1 |
| App rendering (fresh PostgreSQL 16) | 4/4, incl. R16 Chromium 15/15 |
| Day Constructor DB | 77/77 |

The one local failure was the R16 jsdom suite's Calendar cases (51/56). The sweep ran after midnight IST, and the entries are "10:00 today", which the modal refuses as a future time. That is a wall-clock dependency in the new test, not in the runtime.

It is **fixed in the handover commit**: the jsdom Calendar section now runs on a fixed afternoon with time still advancing, and it passes 56/56 at 00:19 IST. The production Chromium suites already fix the page clock.

## 7. Limitations and release conditions

**Limitations:**
- A refusal the client cannot re-derive (for example "Unknown activity." after a catalog change, or 404 "User not found.") stays pending and replays on each `online` event or load. That is the intended conservative behaviour: never deleted, always recoverable. Repeated replay is bounded by those triggers.
- The recovery gate matches by activity (activity ID, else title) to decide when to **ask**. A legitimately separate second log of an activity whose first operation is still open needs one explicit choice.
- Version-1 (R15 development) receipts read as unverified. Check again (GET) or Retry recovers them.
- The R15 limitations still apply: N2 (localStorage and IndexedDB are not one transaction), "removed" is an observation at one point in time, there is no exact-ID server lookup, and there is no WebView, WKWebView or device acceptance.

**Mandatory release conditions (unchanged; 39243 OPEN):**
- a writer-free release origin;
- a rollback allowlist verified with the actual artifacts, retained legacy tabs and workers, and offline-restored profiles;
- account-scoped recovery of unreadable v2 storage for exposed populations;
- Android compatibility, session-boundary and device acceptance;
- Production isolation.

## 8. Reproduce

```
export TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}'
npx ts-node --project tsconfig.jsdom-tests.json test/rel04R16OperationCorrection.test.ts
DATABASE_URL=postgresql://… npx ts-node test/rel04R16HomeChromiumDb.test.ts   # builds apps/web unless REL04_SKIP_BUILD=1
```

To reproduce the witnesses, copy the four 39258 `review-39258-r15-*.local.ts.txt` probes into `test/` and drop the `.txt` suffix, as the 39258 README describes.

Checksums are in `docs/android/evidence/rel04-r16/SHA256SUMS`.


### 6.3 Integration correction and final hosted CI (owner-authorised under 39259)

**Commits on top of the R16 implementation:**

| Commit | Content |
|---|---|
| `a653391` | Merge of main `e6c27cc` (#400 My People, #403 Palmistry) |
| `225b65b` | `test/myPeopleDb.test.ts`: its two `/api/plans` requests state the session's own account via `rel04BoundTestHeaders` (REL-04 R3 pattern). D6 is still refused for B, D7 is still created for A. |
| `d242f87` | The same fix for `test/myPeopleSwitchRollbackDb.test.ts` 2.18 |
| `84cc375` | `test/rel04PinnedClock.ts` pins the R14 H1 and R15 HR real-Home jsdom sections to 12:05 IST, with time still advancing and the clock restored afterwards. Verified at 04:51Z, 10:00Z, 18:30Z, 23:30Z and 00:30Z: R14 28/28 and contract 64/64 at every time. The R13 negative control now fails only for the intended defect (Start now found, then 2 rows and 2 IDs). |
| `4dce038` | Merge of main `fd8b8f5` (#401 AUTH-SESSION I1: dormant modules plus migration 0055; #405 Palmistry). One additive `ci.yml` conflict: both sides appended math-core steps, and both sets are kept (0 steps lost from either parent). |

**What none of these touch:**
- The R16 runtime files.
- `api/plans` (`refuseUnboundWrite` is retained), `api/habit-logs`, `session.ts`, `expectedAccount.ts` and `middleware.ts`.
- The production account-header requirement.

**Audit:** only the two My People suites from main called a bound write route without the header. No other suite introduced by main does.

**Local checks on `4dce038` (clean tree, fresh PostgreSQL 16, 56 migrations):**
- Day Constructor DB: **85/85**, every My People suite passing.
- math-core: **270/270**.
- Typechecks are clean.

**Hosted run 46112586858** on `4dce038`, integration `fbb8d34` (all 9 checkouts verified): **9/9 jobs, 497/497 steps, attempt 1.**
- Every My People suite, Weekly Plan Review and HabitLog idempotency pass.
- R16 correction 51/51 (5 provenance skips on the shallow clone).
- R15 contract 59/59, including HR.
- R14 25/25, including H1 with its negative control.
- Both production Chromium suites 15/15; Chromium 30/30.
- **PR checks: 11/11**; merge state CLEAN.
- Vercel: a Preview deployment only (`dpl_kMyqh…`, target null). Production is still REL-05 `dpl_x9NB8` (`a39f398`).

**Earlier failed runs, all preserved with checksums in `~/Desktop/Claude/AuraEvidence/REL-04-R16-CI-*` and none rerun:**

| Run | Result | Cause |
|---|---|---|
| 46048936628 | 8/9 | MP-1 D6, D7, E5 |
| 46052425786 | 8/9 | MP-1 D6, D7, E5 |
| 46054358960 | 8/9 | MP-1 switch rollback 2.18 |
| 46108171358 | 8/9 | R14 H1 wall clock |
