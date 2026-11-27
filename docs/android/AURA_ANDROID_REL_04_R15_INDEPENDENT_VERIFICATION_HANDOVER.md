# AURA-ANDROID-REL-04 R15 — Independent Verification Handover

**Ticket:** 39257, the shared operation contract consolidation. **Architecture:** 39256 (Option B, "SHARED CONTRACT CONSOLIDATION REQUIRED"). **Prior disposition:** 39255 (NO-GO: G1–G3). **Target:** 39258.

**Status:** **ANDROID REL-04 R15 READY FOR INDEPENDENT VERIFICATION.**

**Controls:**
- PR #392 is open and not a draft.
- Not merged, not deployed, not activated.
- Auto-merge is off; Auto-fix is off.
- Ticket 39243 stays OPEN.
- Production remains on REL-05.

## 1. Revisions

| Item | Value |
|---|---|
| Reviewed head (39255/39256) | `6c69d7d9089566b44b7a24ff0725add754cb7dbd` |
| Reviewed integration | `11a2129651c2f66a835c5c41abf54742f6c6e3ab` |
| Reviewed tree | `49f635592bbf8f315f2982b839dad4156116286f` |
| Integration base (`main`, verified unchanged; CI-10 included) | `73cea7dc409e2740b4474695e248338f87c374c0` |
| **R15 implementation (branch head before this handover)** | `e6a6a6678bf6300362e15cf398343a246807a7e2`, tree `7b7bfc54b0307b6911777d0d2db2ab01cafe10d1` |
| CI integration (GitHub test merge `e6a6a66` into `73cea7d`) | `2c9f15c`; every job's checkout line verified |
| Handover commit | the commit adding this file (documentation and evidence only) |

Before R15 started, the branch head and `origin/main` were verified equal to `6c69d7d` and `73cea7d`. `main` had not advanced, so no synchronization was needed.

## 2. Source material

| Material | State |
|---|---|
| 39255 disposition | Copied to `docs/android/evidence/AURA_ANDROID_REL_04_R14_INDEPENDENT_DISPOSITION_39255.md` |
| 39255 evidence (59 manifest entries) | Preserved byte-for-byte in `docs/android/evidence/rel04-r14-independent-39255/`. **59/59 verified.** Scripts are stored as `.txt`. |
| 39256 architecture reassessment (the implementation specification) | Copied to `docs/android/evidence/AURA_ANDROID_REL_04_RECONCILIATION_ARCHITECTURE_REASSESSMENT_39256.md` |
| 71044 integration addendum | It exists only as an **uncommitted** local file in the R14 worktree, as 71044 instructed. It is not committed here. Its contents (run 46025314649: 9/9 jobs, 468/468 steps) are restated in §10. |
| CH15 per-event worker traces from 39255 | **Unavailable** (39256 also records this). R15 now captures them; see §9. |

## 3. Original failing witnesses on the unchanged R14 implementation

**G1 and G2: R14 vs R15.** These run in every CI run of `test/rel04ActivityOperationContract.test.ts` against the vendored R14 fixtures (`test/fixtures/rel04-r14-head`, checked byte-identical to `6c69d7d` when that commit is available).

| Witness | R14 `6c69d7d` (negative control) | R15 |
|---|---|---|
| **G1 direct**: non-API HTML 200 | `confirmed` with an accepted marker; copy removed; **0 rows**; resubmission gives `already-recorded` | `outcome-unknown` (unverified response); no receipt; **copy kept**; the authentic same-ID resubmission is `confirmed`, **1 row** |
| **G1 replay**: same response during replay | confirmed=1, removed=1, accepted marker, **0 rows** | unverified=1; nothing settled; copy kept; the later same-ID replay gives **1 row** |
| **G2 marker naming B under A/X** | `already-recorded`, 0 POSTs, 0 rows | `outcome-unknown`, 0 POSTs, 0 rows |
| **G2 marker with null payload** | `already-recorded`, 0 POSTs, 0 rows | `outcome-unknown`, 0 POSTs, 0 rows |
| **G2 marker naming another request** | `already-recorded`, 0 POSTs, 0 rows | `outcome-unknown`, 0 POSTs, 0 rows |

**G3 in the real production build.** The reviewer's unchanged `review-r14-home.ts` was run against a local `next build` of `6c69d7d` (a detached temporary worktree, since removed). Only its three local-connection assertions were adapted; see `review-r14-home.local.diff`.

- Output: `docs/android/evidence/rel04-r15/witnesses/r14-6c69d7d-home-g3.production-build.log`.
- The two control orderings each retain one row.
- The G3 ordering reproduces: `retryVisible: true` and **2 PostgreSQL rows for one account**, under request IDs `1549ba93-…` and `fc2287b1-…` (the fresh-ID duplicate).
- The same ordering on R15: see §7, case A.

## 4. Shared operation and receipt contract

### 4.1 One response decoder

`apps/web/lib/habitLogSyncPolicy.ts` provides `decodeHabitLogResponse`, which both direct submission and replay call through `__decoder`. Its decisions, checked in order:

1. **Upgrade**: a JSON 503 carrying `client_upgrade_required`.
2. **Hold** (kept): 401, 403, 409 or 428.
3. **Retry** (kept, same ID): 5xx, status 0, or no response.
4. **Unverified** (kept): any of the following:
   - a redirected response (`redirect: 'error'` is set, and `res.redirected` / opaque types are also checked);
   - a response URL that is not the same-origin `/api/habit-logs`;
   - a 2xx other than 200;
   - a non-JSON media type;
   - malformed or empty JSON;
   - a row that fails binding;
   - a lease that is no longer current.
5. **Rejected** (definitive): a 4xx with a JSON `{ error: string }` from the route.
6. **Accepted**: anything else, only if `bindServerRow` succeeds and the lease is current.

`bindServerRow` is the one row-binding rule, shared by POST answers and GET evidence (`decodeHabitLogList`). It requires:
- a non-empty `id`;
- `userId` equal to the account;
- `clientRequestId` equal to the exact request ID;
- equal **normalized persisted intent**, using the route's own normalization:

| Intent field | Normalization |
|---|---|
| Title | Trimmed |
| Activity ID | Trimmed, or null |
| `logTimestamp` | Compared as an instant |
| Notes | `notes ? trim : null` |
| Duration | `min(180, max(0, Number(d ?? 30)))`, integer, 0 allowed |
| Source / significance | Default `MANUAL` / `MEDIUM` |

Server-derived `activeWindow` and `logMinuteOfDay` are excluded. A row lacking comparable intent fails binding as `intent-unavailable`, so the operation stays unresolved.

The full canonical dispatch payload is kept separately in the claim and the decision, for retry and claim equality.

**PostgreSQL shows why the intent comparison is required:** a reused request ID with a different payload gets the **existing** row back, so only the client's comparison can refuse it (§7, PG).

### 4.2 Versioned settlement receipt

The receipt lives in `apps/web/lib/offlineHabitQueue.ts` as an additive field on the existing decision. There is no IndexedDB schema change.

- **Accepted:** `{ v: 1, kind: 'accepted', owner, crid, payload, serverRecordId, row, at }`
- **Rejected:** `{ v: 1, kind: 'rejected', owner, crid, payload, status, afterPossibleSend, at }`

`settleRecords(…, { receipt })` validates the receipt for the exact claimed identity, deletes **only** copies carrying that account, request ID and payload, and writes the decision with the receipt, all **in one transaction**.

`decisionAuthority(value, owner, crid, payload)` validates the marker key, marker value, operation and receipt together:

| Marker | Authority |
|---|---|
| Key, owner, crid and format bound; settled; payload equals the operation's; valid accepted receipt (owner, crid, payload, server id = `row.id`, `row.userId` = owner, `row.clientRequestId` = crid) | **success** |
| As above, with a valid rejected receipt and `afterPossibleSend = false` | **failed** (definitive) |
| A bound discard (a null payload fences every payload, i.e. a damaged discarded copy) | **discarded** (fence preserved) |
| A bound marker for a **different** payload | **conflict** |
| Anything else: contradictory key or value, missing payload, bare pre-R15 "accepted" or "rejected" marker, refusal after a possible send | **unverified**: no success authority and no cleanup authority. It still fences **automatic** sends. |

**Upgrade rules (`writeDecision`):**
- An unverified marker is replaced only by positive authoritative evidence: a validated accepted receipt from a send or from `recordVerifiedReceipt` (GET evidence).
- The user's own durable discard also replaces it.
- Every valid decision remains first-write-wins, and the `possiblySent` fact is never lost.

## 5. Changed files

**Runtime: exactly the 39257 scope.**
- `apps/web/lib/activitySync.ts`
- `apps/web/lib/habitLogSyncPolicy.ts`
- `apps/web/lib/offlineHabitQueue.ts`
- `apps/web/lib/pendingReplayReconciliation.ts` (the shared ID-keyed operation types and helpers)
- `apps/web/app/page.tsx`
- `apps/web/components/HomeDashboard.tsx`
- `apps/web/components/Timeline.tsx`
- `apps/web/components/CalendarViewSection.tsx`
- `apps/web/components/PastActivityModal.tsx`

None of these changed: the authenticated route, the database, the migrations, the IndexedDB schema (still v2, same stores), the service worker, or sign-out's report boundary (`signOut.ts` is untouched).

**Tests and CI:**

| File | Change |
|---|---|
| `test/rel04ActivityOperationContract.test.ts` | New |
| `test/rel04ActivityOperationHomeChromiumDb.test.ts` | New |
| `test/fixtures/rel04-r14-head/*.ts.txt` | New: R14 negative-control fixtures |
| `test/habitLogIdempotencyDb.test.ts` | Targeted R15 binding assertions; now also run in CI |
| `test/rel04Chromium.test.ts` | CH15 diagnostics only |
| `test/rel04AccountIsolationHarness.ts` | Fidelity fix: the fake `createHabitLog` returns the full `RETURNING *` row |
| `.github/workflows/ci.yml` | 3 steps added |
| Adjusted assertions | Listed in §8 |

## 6. Outcome transitions and identity recovery

### 6.1 Ownership

- `activitySync` owns network proof (the decoder) and same-operation retry: `submitActivityLog(…, { explicitRetry })` and `checkActivityOperation`.
- `offlineHabitQueue` owns:
  - identity binding, claims and atomic settlement;
  - durable discard and physical verification (F2/F3 unchanged);
  - the operation reads `readOperationState` and `readActivityOperations`.
- `page.tsx` keeps the **ID-keyed projection** (request ID → outcome) from those two sources only.
- Home, Timeline, Calendar and Past Activity consume it. None of them settles, discards or forgets an operation.

### 6.2 Outcomes

| Outcome | Evidence | Leaves it only by |
|---|---|---|
| **pending** | A durable matching outbox record and no terminal evidence | Validated receipt, definitive failure, discard, or "unresolved" if a later answer proves nothing |
| **unresolved** | A commit or send may have happened and the evidence is missing, contradictory or unreadable: lost acknowledgement with a failed read, an unverified answer, an unverified marker, a refusal after a possible send | Positive evidence (receipt, or a matching GET row bound by the same rules), a definitive failure, a durable discard, or a live copy (becomes pending). **Never** by a stale GET, an empty queue view, list absence, a same-title row, an expired claim or an abort. |
| **confirmed** | Validated accepted receipt (from a send, or a GET row persisted via `recordVerifiedReceipt`) | Terminal. Later stale answers or read errors cannot overturn it. |
| **failed** | One of three: proven pre-dispatch non-commit (a store write that never ran, or no copy and no decision); the route's own JSON refusal with **no possible earlier send** (`priorAttempts == 0`); or no copy and no decision after Check again when this tab never dispatched (`not-committed`) | Terminal. A separate operation may start. |
| **discarded** | A bound durable discard | Terminal; it fences sends across formats. Prior-send facts stay separate. |
| Physical state after a discard (sign-out) | Unchanged R14 rules: removed / known remaining / unverified (F2/F3) | n/a |

### 6.3 Identity

- A request ID is minted only in `handleLogActivity`, for an explicit new operation.
- The operation (account, request ID, canonical body including the original timestamp) is put in the projection before dispatch.
- Its durable anchor is the outbox record that `enqueueOwned` writes in the same transaction as the claim, before the first `fetch`.
- `onOperation(id)` hands the request ID to the initiating card or modal immediately.

### 6.4 Retry and Check again

- **Retry** passes `retryOf: id` and resubmits the stored body verbatim with `explicitRetry: true`. That flag may pass an unverified marker, never a valid decision.
- If the original identity or body is not recoverable, Retry throws "Couldn't verify whether this activity was saved." **No replacement ID is generated.**
- **Check again** (`checkActivityOperation`) reads durable state first (the same `requestState` as the gate), then authenticated GET evidence.

### 6.5 Reattachment

- **Remount, refresh and restart:** the projection is re-read from `readActivityOperations` with every queue read and at load.
- The Good Right Now card reattaches to its still-open operation by activity ID (or title) since the start of the day. This is display only; resolution is always by request ID.
- **Cross-tab:** a settlement or receipt posts on a BroadcastChannel, and other tabs re-read. This is best-effort; every read path is authoritative without it.
- **Offline:** pending records replay under their own ID; the `online` event triggers replay.
- **Unreadable operations store:** `readActivityOperations` returns null. The projection keeps its in-memory operations, Home shows a banner ("New activity logging is paused…" with Check again), and `handleLogActivity` refuses new operations. Total loss of origin storage needs recovery outside the normal Retry path (39256).

### 6.6 What each surface shows

- **Home:** the Good Right Now card shows Logged / "Saved offline · will sync" / "Couldn't verify whether this activity was saved." with **Check again** and **Retry**. "Start now" is never shown for an open operation.
- **Timeline:** quick logs are tracked title → request ID and released only by that operation's evidence. An unresolved notice offers Check again.
- **Calendar / Past Activity:** the modal stays open on an unresolved result, with Check again, and blocks a second submission.

## 7. Acceptance results

| Suite | Local (`e6a6a66`) | CI run 46036623125 |
|---|---|---|
| `rel04ActivityOperationContract` (jsdom; real client modules, real route) | **63/63** | **58/58**: the 5 R14-fixture provenance checks print SKIP in the shallow clone, as every earlier round's fixture re-checks do |
| `rel04ActivityOperationHomeChromiumDb` (**production build, two real Chromium tabs, disposable migrated PostgreSQL 16**) | **15/15** | **15/15** |
| `habitLogIdempotencyDb` (real PostgreSQL), incl. 4 R15 binding checks | All pass | All pass (new CI step) |
| `rel04Chromium` (incl. CH16 and CH15) | **30/30** | **30/30** |
| Every CI command, swept locally on `e6a6a66` (clean tree) | math-core **262/262**; Chromium **1/1**; app rendering **3/3** (fresh PostgreSQL 16, 54 migrations); Day Constructor DB incl. Weekly Plan Review **77/77** | 9/9 jobs |

Local typechecks pass for `apps/web/tsconfig.json` and `tsconfig.web.json`, and the production build succeeds.

### 7.1 Contract suite coverage

| Case | Covers |
|---|---|
| **W** | G1 direct and replay; G2 ×3 (R14 vs R15) |
| **B** | Direct **and** replay × {HTML 200, malformed JSON, empty JSON, wrong account, wrong request, wrong intent, missing record ID, redirect}: no receipt, no settlement, no false success, copy kept, then 1 row after the authentic same-ID replay. Also: a non-route HTML 404 stays unresolved, while the route's JSON 400 is the definitive `rejected 400` with a rejected receipt. |
| **C** | Proofless legacy marker; receipt naming another account; receipt bound to another payload; refusal after a possible send. Each gives `outcome-unknown`, 0 POSTs, the adjacent copy preserved, and the operation unresolved. Check again on a proofless marker with no row stays unresolved. Same-operation Retry gives 1 row, and the marker is upgraded to a receipt. An unverified marker is never sent automatically. |
| **D** | A valid matching receipt gives `already-recorded` with its server row and 0 POSTs. A damaged-payload discard fence still fences. |
| **E** | `network-after` and `process-then-500`: the route commits and the answer is lost, giving queued under the same ID. Check again reports pending. Retry and replay converge on **1 row**, followed by `already-recorded`. |
| **F** | Two explicit operations with identical payloads give 2 IDs and 2 rows. |
| **G** | Check again with only a same-title row of another operation stays unresolved. The merge keeps the unresolved row; the R14 merge drops it. R14's title inference reports "confirmed". |
| **H** | An unreadable store sends nothing, and the operations read returns null (unknown). |
| **I** | Replacement during dispatch is preserved. An account switch before the answer leaves no stale settlement, keeps the copy bound to A, and attributes nothing to B. A discard during an outstanding send is reported as possibly sent; the late answer never overrides the discard. |
| **J** | F2 (opaque v2, discardedUnverified=1, bytes kept) and F3 (removed=1, cleanupErrors=1) are unchanged. |
| **HR** (real Home, jsdom) | Unverified answer, then the unresolved UI with Retry; Retry reuses the original ID: Logged, 1 row, 1 ID. |
| **HB** (real Home, jsdom) | An unreadable operations store blocks new logging (banner, no ID, no record, no POST); Check again lifts the block. |

### 7.2 Production build with real Chromium and PostgreSQL

**A — the original G3 ordering, plus a same-title unrelated row from the previous day.** Steps:
1. The genuine pre-save empty GET is held.
2. The enqueue acknowledgement is withheld after the commit.
3. Tab B, past the claim lifetime, replays, commits and settles with a **validated receipt**.
4. Tab A's first decision read fails.
5. The stale GET is released.
6. Refresh (`online`), remount (tab switch) and restart (reload).

Results:
- No "Start now" is ever offered on that card.
- **1 row for the operation under the original ID**, plus the untouched unrelated row.
- 0 POSTs from tab A; one bound POST from tab B carrying the original ID, the account header and the canonical body.
- After the restart, the receipt's server record ID equals the PostgreSQL row; no copy or claim remains.

**A' — the two original controls (settled before / settled during):** 1 row, no error.

**B — an HTML 200 that never reached the writer:**
- The UI shows "Couldn't verify…", the copy is kept, and there is no accepted receipt.
- A Retry answered by another HTML 200 stays unresolved.
- After the route is restored, Retry gives Logged.
- 3 POSTs, all with **one identical body and ID**; 1 row; receipt equals the row.

**E — the route commits but the response is cut:** "Saved offline" under the same ID; the replay converges on the **same row** (2 POSTs, one ID).

**H — an unreadable operations store at load:** new logging is blocked (0 POSTs, 0 records, 0 rows).

### 7.3 PostgreSQL row-binding checks

- The real `RETURNING *` row, round-tripped through JSON, binds to its operation.
- A reused ID with a different payload gets the **existing** row back (still 1 row), and binding refuses it with reason `intent`.
- Identical payloads under separate IDs give 2 rows.
- A GET collection row binds; another account's row with the same ID never does (reason `account`).

## 8. Negative controls and adjusted earlier assertions

### 8.1 Negative controls

Each control removes one protection from a compiled copy of the **current** sources (an exact source patch; a patch that no longer applies fails the suite). The matching acceptance check must then fail, and it does.

| # | Protection removed | Detected by |
|---|---|---|
| N1 | Direct response validation | B / G1-direct (accepted marker, 0 rows) |
| N2 | Replay response validation | B / G1-replay (confirmed=1, removed=1, 0 rows) |
| N3 | Marker authority (trusts the key only) | C / G2 (`already-recorded`, 0 rows) |
| N4 | Exact-identity removal (removes by request ID alone) | I1 (the replacement is deleted) |
| N5 | Same-ID recovery (a fresh ID for an unresolved operation) | One-row assertion (2 rows) |
| N6 | The operation projection in the merge (releases by list absence) | G (the unresolved row is dropped) |
| N7 | Opacity handling (treats opaque storage as verified absence) | J F2 (removed=1) |
| N8 | The authoritative final cleanup verification | J F2 (removed=1) |

These are in addition to the R14 witnesses in §3. In the real-browser path, R14's production build is the negative control.

### 8.2 Earlier assertions adjusted

R15 replaces the contract each of these pinned. All other R4–R14 assertions are unchanged.

| Assertion | Change |
|---|---|
| R14 `M4` | The recorded rejection now carries its versioned receipt. A bare marker is covered as unverified in contract C. |
| R5 `T1` | A direct `settleRecords` call without a receipt leaves an **unverified** decision. It is still refused and nothing is stored. |
| `pendingReplayReconciliation` (10 pins) | Home and Timeline follow operations by request ID instead of `resolvePendingActivityStatus`; the result type is `ActivityLogResult` (adds `'unresolved'`); replay uses the shared decoder with a receipt. |
| `pendingActivityVisualConsistency` (2) | Same changes. |
| `pendingActivityReloadVisibility` (6) | Same changes, plus: the merge takes the operation projection; the optimistic entry is projected from the immutable body; `isMine` covers a Retry reusing its row. |
| `habitLogActivityIdentity` (3 regexes) | Same type and signature change. This suite is not part of CI. |
| Harness fake `createHabitLog` | Now returns every persisted column, as PostgreSQL's `RETURNING *` does. |

## 9. CH15 historical discrepancy (diagnostics only)

The historical R5-worker fixture, the probe and both CH15 assertions are **unchanged**. CI-DEBT-10 is untouched.

R15 adds observation only:
- CDP `ServiceWorker` lifecycle (`runningStatus`);
- `Network` timing, including `fromServiceWorker`;
- main-frame navigations with timestamps;
- in-page acknowledgement delivery, `controllerchange` and worker messages;
- controller state before and after;
- Chromium, Node and Playwright versions, and the platform.

**Results, CI (linux-x64, Chromium 151.0.7922.34, Node v24.22.3, Playwright 1.62.1):**
- **R5 worker:** stop, then starting at about 2–5 ms, then running at about 5 ms. All 8 probes went out at about 3 ms and all 8 were answered by the worker. Then a running update at about 616 ms, and the **main-frame navigation at about 623 ms** (`…?reloaded=upgrade`), just after the worker's 600 ms deadline.
  - The navigation replaced the page, so the page-side trace recovered is the reloaded page's (1 acknowledgement). The pre-navigation acknowledgement timing is not observable from the page.
- **Current worker:** the same restart and probe timing; **0 navigations**; 4 acknowledgements delivered and correlated; controller `activated` before and after.

**Local (macOS arm64, Chromium 151.0.7922.34):** 30/30, with the R5 reload reproduced. The 39255 local 29/30 miss was **not** reproduced in this environment.

**Classification:**
- The data is consistent with 39256's analysis: the R5 worker's single waiter racing the 600 ms deadline against 150 ms-delayed acknowledgements.
- It shows no current-worker regression.
- The discrepancy is **not classified as resolved**. A run that reproduces the miss, with these diagnostics in the failing environment, is still needed.

## 10. CI (naturally triggered; nothing rerun)

| Run | Head / integration | Result |
|---|---|---|
| **46036623125** (R15) | `e6a6a66` merged into `73cea7d` as `2c9f15c` (all 9 job checkouts verified) | **9/9 jobs, 471/471 steps, attempt 1** |

Every required area passed in run 46036623125:
- the new contract suites;
- the Android regression suites (R4–R14, isolation, sign-out, token replay, reconciliation, reload visibility, SSR agreement);
- PostgreSQL idempotency;
- Day Constructor and Weekly Plan Review ("ALL WEEKLY PLAN REVIEW CLIENT DB CHECKS PASSED");
- the production build and the release guards (Palmistry, palm-engine, E1 bundle, artifact startup, standalone OAuth).

The handover commit triggers its own run; it is recorded in the PR body.

**Historical runs (preserved, not rerun):**

| Run | Result |
|---|---|
| 46025314649 (71044 integration, `6c69d7d`) | 9/9 jobs, 468/468 steps |
| 46002683525, 46007450992 | 8/9 each (CI-10) |
| 45989628096 | 8/9, then 9/9 after one approved rerun (CI-DEBT-10) |
| 45985719059 | 9/9 |

**Evidence locations:**
- The full CI job logs and checksums are in `~/Desktop/Claude/AuraEvidence/REL-04-R15-CI-46036623125/`.
- The extracted R15 results are in `docs/android/evidence/rel04-r15/ci-46036623125/`.

## 11. Remaining limitations

1. **Refusal after a possible send.** A route refusal after a possible earlier send settles its copy, with a rejected receipt marked `afterPossibleSend`, and reports **unresolved**, never a definitive failure. Check again can still find the row by GET. The copy is not kept, because replaying the same body could only repeat the refusal.
2. **GET evidence window.** GET evidence covers the route's 400-day window. Absence is never evidence. An exact-ID read-only lookup would be the optional server addition that 39256 describes; it is not added (no server change was authorized).
3. **Check again on an unverified answer.** When the copy is kept, Check again reports **pending** (it will sync under the same ID). Retry is offered only while the outcome is unresolved.
4. **Reattachment scope.** Reattachment after restart is by activity for Good Right Now, from the start of the day. Timeline shows open operations as "Pending" after a remount. The Calendar modal holds its operation only while it is open.
5. **Cross-tab notice.** The cross-tab notification uses BroadcastChannel and is best-effort. Every read path is authoritative without it.
6. **Unchanged R14 limitations.**
   - localStorage and IndexedDB are not one transaction (N2), which is contained only by the origin and rollback release conditions.
   - "Removed" is an observation at one point in time.
   - Pre-R15 decisions carry no receipt, so they reconcile as **unresolved**. These are development data only.
7. **Device coverage.** There is still no WebView, WKWebView or device acceptance. The browser evidence is Chromium only.

## 12. Release conditions (unchanged, mandatory; not waived by R15)

- A writer-free release origin, and a verified rollback allowlist excluding the R1–R7 writers and migrators. This must be accepted with the actual artifacts, retained legacy tabs and workers, and offline-restored profiles.
- Account-scoped recovery of unreadable v2 storage for exposed Preview, internal and sideloaded populations.
- Android compatibility and session boundaries.
- Production isolation. Production remains REL-05 `dpl_x9NB8` (`a39f398`); R15 has only Preview deployments.
- Ticket 39243 stays OPEN.

## 13. Reproduce

```
export TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}'
npx ts-node --project tsconfig.jsdom-tests.json test/rel04ActivityOperationContract.test.ts
DATABASE_URL=postgresql://… npx ts-node test/habitLogIdempotencyDb.test.ts
DATABASE_URL=postgresql://… npx ts-node test/rel04ActivityOperationHomeChromiumDb.test.ts   # builds apps/web unless REL04_SKIP_BUILD=1
npx ts-node test/rel04Chromium.test.ts
```

Expected results: 63/63 (on a full clone), all pass, 15/15, and 30/30.

Checksums are in `docs/android/evidence/rel04-r15/SHA256SUMS`.
