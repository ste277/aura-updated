# AURA-ANDROID-REL-04 R18 — Online-First Focused Verification Handover (39266)

**Ticket:** 39265 (approves Option B of 39264). **Responds to:** 39262 (R17 NO-GO: G7/G9 closed, G8 partial, new G10/G11).
**Scope:** online-first initial Android release on one authoritative recovery decision. Full offline recording and automatic replay are deferred.

## 1. Revisions

| | Commit | Tree |
|---|---|---|
| Reviewed R17 head (39262) | `ab3c15b3abc988d2d50b2b4d804e954abcc988a5` | `1b6d2a8` |
| **R18 implementation** | `11dad48927e29f9d18217b592357afa515885071` | `1b01c33` |
| Main | `5119d02695d54589fc2960aded0309d1251ebd56` (unchanged since R17; no merge needed) | |

**No server, API, PostgreSQL schema, IndexedDB schema (`QUEUE_DB_VERSION` 2), service-worker or middleware change** (`git diff ab3c15b 11dad48 -- apps/web/app/api apps/web/prisma apps/web/public/sw.js apps/web/middleware.ts` is empty). Runtime delta (client only): `lib/offlineHabitQueue.ts`, `lib/activitySync.ts`, `lib/pendingReplayReconciliation.ts`, `lib/signOut.ts` (copy), `app/page.tsx`, `components/PastActivityModal.tsx`, and the "Not confirmed" label in `HomeDashboard`, `Timeline`, `HomeTimeline`, `CalendarViewSection`, `InsightsView`.

**Disk (step 0):** 15 GiB free on the data volume throughout. No deletion was needed or performed. Other sessions' `/tmp/claude-501` data and the disposable PostgreSQL directory were left untouched.

## 2. Decision core (G10, G11) — no new layer

- **One discovery.** `decideOperations` runs over the whole account. Each request id gets one `RecoveryOperation`: `status` (pending / unresolved / conflict / confirmed / failed / discarded), `dispatchPayload` (the only payload that may be sent, or `null`), display `body` and `intents`.
  - A copy whose request identity is **contradictory or unattributable** is never dropped. It becomes **unattributed evidence** (`unattributed:record:<id>` / `unattributed:retired:<key>`, `attributable: false`, with `candidates`). It carries its activity intent, so a matching new submission is refused in the claiming transaction. It never authorizes a send or a cleanup, and every candidate id resolves to it (paused). (G10)
  - A **terminal decision never conceals** a damaged, contradictory or retired copy: such a copy surfaces as open unattributed evidence.
- **Payload fact vs operation status.** A validated receipt, refusal or discard is a `fact` about its own payload. The overall `status` is `conflict` whenever a surviving copy names another body. (G11)
- **`requestState` is no longer an authority.** It is `stateForPayload(decision, payload)`: the account-wide decision's view of one proposed payload, and every exact-id lookup uses it. One mapping feeds the transmission gate, explicit Retry, enqueue recovery after an unconfirmed commit, Check again, and settlement (`RemovalResult.decision`). An accepted POST is reported as `confirmed` only if the decision is. The UI projection (`readActivityOperations` → `page.tsx`) reads the same decision.

## 3. Online-first behaviour

| Requirement | Implementation |
|---|---|
| No automatic dispatch | `replayOfflineQueue` is the single enforceable boundary: it returns `disabled` (reads nothing, sends nothing) unless a test sets `__AURA_TEST_ENABLE_DORMANT_REPLAY__`. No app module sets it. `page.tsx` has no startup, `online`, post-submit or Check-again replay trigger. The library code is retained (dormant) for a later offline release, and its suites opt in explicitly. |
| Confirmed pre-dispatch offline failure | `navigator.onLine === false` → `not-stored` / `offline` before anything is stored. A new activity is not recorded. An explicit Retry leaves its operation exactly as it was. The page shows "You're offline, so this activity wasn't saved. Try again when you're back online." |
| Durable identity before ambiguous dispatch | Unchanged: the copy (id + canonical payload) and its claim are committed in one transaction before the POST. |
| Unconfirmed → unresolved | `queued`, `upgrade-required` and kept `account-changed` map to **unresolved**. A stored copy is unresolved in the projection, except this page's own in-flight submission. |
| Explicit Retry | Original id and canonical payload, claimed only if it is the decision's `dispatchPayload`. Multi-tab claims are unchanged. |
| Check again | **Read-only.** It returns the decision's state plus a bound GET: `server-has-it` (Retry finishes it under the same id, with no new row), `not-found` or `evidence-unavailable`. It never sends, persists a receipt or removes a copy. |
| No Retry without an authoritative payload | `retryable: false` → no Retry in the notice, the Home card or Past Activity. |
| Messaging | "Pending sync" → "Not confirmed". Home "Saved offline · will sync" → "Not confirmed yet". The upgrade, sign-out and unreadable-storage copy no longer promises syncing. Past Activity now shows save errors (previously silent). |
| Existing data | The legacy REL-05 `offline_habit_queue` and retired R1–R3 formats stay quarantined: never sent, never deleted, with the existing notices. Retired intents now also withhold a matching new submission. |

## 4. Witnesses (reviewer probes, unmodified)

| Probe | R17 `ab3c15b` | R18 `11dad48` |
|---|---|---|
| review-39262-contradictory (G10) | **FAIL** — new id sent, 2 rows | No new id, 1 row, copy kept. The probe's `retryVisible > 0` condition fails by design: 39265 forbids Retry without an authoritative payload, and a contradictory identity has none. A separate entry is offered. |
| review-39262-check-again (G11) | **FAIL** — Check again confirmed the conflict away | **3/3 pass** |

Logs: `docs/android/evidence/rel04-r18/baseline-r17-ab3c15b/`, `…/reviewer-probes-on-r18/`.

## 5. Verification

**`test/rel04R18OnlineFirst.test.ts`** (jsdom; CI math-core): 27/27.
- W G10 / W G11 on vendored R17 (`test/fixtures/rel04-r17-head`, provenance-checked): each reproduces on R17 and is closed on R18 with exact POSTs, rows, copies, projection and storage-unchanged checks. A Check-again read-only control: R17 writes on a GET match; R18 writes nothing, and the user's Retry then converges.
- Negative controls: **N10** unattributed evidence removed → duplicate; **N11** receipt-first → Check again "already recorded" with a conflicting copy; **N12** dispatch boundary removed → automatic POST; **N13** offline refusal removed → an offline record is stored.
- **Generative consumer agreement: 135/135** combinations of live copies × blocked copies × markers × server state. In each, the projection, read-only Check again, explicit Retry with each body, a new submission and automatic dispatch all agree with the decision on returned outcome, dispatch, retained copies and UI fields. Independent oracles cover conflicts (never dispatchable) and withheld entries.
- Library: the boundary (0 POSTs), offline refusal (new and Retry), an ambiguous send across restart with Retry converging to 1 row, multi-tab Retry (1 POST, 1 row), and a sign-out discard fencing a later Retry.
- Real page: **zero automatic POSTs** (restart + `online` + `visibilitychange` + an unrelated user submission, alongside an REL-05 legacy queue); the legacy queue byte-identical; offline Calendar refusal; G10 and G11 on the page; an ambiguous Calendar submission across restart → notice Retry → 1 row.
- Source: `requestState` is a view of `decideOperations`; one replay boundary with no app caller; Check again writes nothing; no surface interprets markers; no automatic-sync promise in the UI.

**`test/rel04R18OnlineFirstChromiumDb.test.ts`** (production build, Chromium, PostgreSQL; CI `rel04-next-app-rendering`): G10, G11, a real offline context, zero automatic POSTs with an REL-05 legacy queue (byte-identical), restart Retry → 1 row + v2 receipt, two tabs pressing Retry together → 1 row. Results: §6.

**Reviewed and adjusted existing tests** (the approved scope change only; integrity predicates kept):
1. `pendingActivityVisualConsistency`, `pendingActivityReloadVisibility`: "Pending sync" → "Not confirmed"; the replay pin now asserts the page never triggers replay.
2. `pendingReplayReconciliation`: the `syncOfflineLogs` pin is replaced by "no automatic replay; another tab's settlement still re-reads".
3. `rel04ActivityOperationContract` E: Check again is read-only (`server-has-it`, unresolved). N1 also removes the new settlement-decision protection so the bypass remains detectable.
4. `rel04ActivityOperationHomeChromiumDb`: in A/G3 the companion tab's automatic replay becomes that tab's explicit Retry, and its decision-read fault injection now covers `get()` and `getAll()`. In E (cut acknowledgement) the replay after `online` becomes the user's Retry on the shared notice. Assertions unchanged: 2 POSTs with one id, 1 row, receipt.
5. `rel04R12QueueConcurrency`, `rel04R13QueueIntegrity`: the claim-boundary injectors trigger on the first marker read via `get()` or `getAll()` (R18's discovery uses `getAll()`).
6. `rel04R16HomeChromiumDb` G4: waits for the unresolved notice instead of "Saved offline".
7. `rel04R17RecoveryDecision`: N7 patches the R18 binding (`stateForPayload`); the source pin accepts the decision view.
8. The dormant-library suites (account-isolation harness, `rel04Chromium` bundle) opt in to replay explicitly.

## 6. CI and local results

Local on `11dad48` (clean tree; PostgreSQL 16, Chromium 151.0.7922.34, Node v26.5.0):

| Suite | Result |
|---|---|
| math-core job sweep | **276/276** |
| DB job sweep | **89/89** |
| Chromium multi-tab job | 30/30 (CH15 historical reproduction included) |
| R18 jsdom | 27/27 |
| R18 Chromium + PostgreSQL | **7/7** |
| R17 / R16 browser regressions on R18 | 11/11, 15/15 |
| R15 browser regression | 15/15 after the test-only cut-acknowledgement adaptation (§5 item 4) in `82d5f51` |

Logs: `docs/android/evidence/rel04-r18/local-*-11dad48/`, `local-r18/`. The follow-up commit changes only `test/rel04ActivityOperationHomeChromiumDb.test.ts` and docs. Hosted CI: §6.1, added after the run.

## 7. Remaining limitations and release conditions

- Unattributed evidence (a contradictory or unidentifiable copy) withholds a new entry of the same activity and offers no Retry. The user may log a separate activity or discard at sign-out. A conflicting operation is never sent and is not resolved by Check again (read-only).
- The legacy REL-05 `offline_habit_queue` remains quarantined and discard-only. Its entries are unscoped (not attributable to an account), so they do not withhold new submissions.
- **Rollback:** REL-05 cannot see IndexedDB operations, so a re-entry after rollback could duplicate. This remains a 39243 condition (rollback allowlist). Online-first leaves fewer stored records exposed.
- **39243 stays OPEN:** writer-free origin, rollback allowlist with retained legacy tabs/workers and offline-restored profiles, account-scoped unreadable-v2 recovery, Android device and session acceptance.
- No merge, deployment, Production activation or release-configuration change. Auto-merge and Auto-fix are off. Production remains REL-05 `dpl_x9NB8` (`a39f398`).
