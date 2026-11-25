# AURA-ANDROID-REL-04 — Application Release Readiness

**Date:** 2026-11-25 · **PR:** #392 · **Branch:** `aura-android-rel04-app-readiness`, cut from `main` `ad49e6a`

**Revision:** **R6** (ticket 39219). R6 is a targeted correction of the four application findings that the R5 independent assessment reproduced against `0c97d3a406bce24b5ea2490aebb7d1cd2ad66bdc` (code `a3a02b8`). The assessment is at `~/Documents/ChatGPT/Product Onboarding/AURA_ANDROID_REL_04_R5_INDEPENDENT_DISPOSITION_0c97d3a.md`.

- **R6 code commit:** `13d773eef0717952e8fcb940b83498c0d09e67fa`.
- **Evidence:** `docs/android/evidence/rel04-r6-13d773e/`.
- **Closures kept:** all independently closed findings are preserved, none is reopened, and the IndexedDB architecture and attempt-token fencing are unchanged.

**§R6 supersedes R5 where they differ.** R5, R4 and R3 sections are kept as history.

**Independent reviews (kept unchanged):**
- `…_INDEPENDENT_REVIEW_REPORT.md` (`a54daf6`);
- `…_DELTA_INDEPENDENT_REVIEW_REPORT.md` (`d09449b`);
- `…_FINAL_INDEPENDENT_DISPOSITION_091e3ce.md`;
- `…_INDEPENDENT_EVIDENCE_ASSESSMENT_b323d2a.md`;
- `…_R4_INDEPENDENT_DISPOSITION_a59a934.md`;
- `…_R5_INDEPENDENT_DISPOSITION_0c97d3a.md`.

**Not done:** no merge, deployment, hosting-setting change, Production access, credential, infrastructure, emulator, physical device, signing or Play Store activity.

## 1. Verdict

**ALL REMAINING R5 APPLICATION FINDINGS CORRECTED — FOCUSED REGRESSIONS PASS — READY FOR INDEPENDENT VERIFICATION.**

| Disposition | State |
|---|---|
| **1. Application implementation** | **Corrected (R6)** for the four reproduced R5 findings (§R6-1). The findings stay OPEN until independent verification. |
| **2. Controlled merge readiness** | **NO-GO**. Still needed: independent verification, owner approval, and deployment-boundary reconfirmation at merge time. PR #392 stays **separate from REL-05**. |
| **3. Production activation and native acceptance** | **NO-GO / HOLD**, unchanged. The separately gated items are listed in §R5-4: A-1 to A-3, AUTH-01 dependencies, rollout criteria and telemetry, supported-client compatibility, worker rollback, and native plus REL-03 supervised acceptance. |

---

## R6-1. Findings, root causes, corrections, before/after evidence

Each finding has a permanent reproduction. `test/rel04R6Findings.test.ts` runs the assessment's own probes against the **R5 code** (vendored byte-for-byte in `test/fixtures/rel04-r5-head`, checked against git) and against the current code. Chromium CH15 does the same in a real browser.

| # | Finding (R5 assessment) | Root cause | Correction | Before (R5 code) → After (R6) |
|---|---|---|---|---|
| 1 | Two owned interim entries with the same request id and payload under **different accounts**: one migrated entry, B's source deleted | `migratedRecordId` hashed `clientRequestId + payload` without the owner, so B's candidate matched A's record and migration treated B's entry as already copied | The owner is part of the migrated identity. The R4/R5 owner-less id is honoured only for a record or marker **owned by the same account**. A source is deleted only after every entry is confirmed in its own account's store (record or marker) and the source is unchanged. | **Before:** `{a:1, b:0, bSourceStillPresent:false}`. **After:** `{a:1, b:1}`, two distinct owned records, and both sources retired after confirmation. The two accounts' lifecycles are independent: A's replay settles only A; B's entry survives, then B's discard removes exactly it; markers are per account; re-appearing sources are not recreated. (`rel04R6Findings` Q1) |
| 2 | Temporary `localStorage` denial over 45 days was treated as retirement: marker pruned, settled entry recreated | `storageOrNull()` turned an access error into "no storage", and `sourcesRetired()` returned true for no storage, so the code read it as retirement | Source inspection now has three states: **retired**, **pending** or **unavailable**. Any access or read failure is *unavailable*: nothing is concluded, no marker is pruned, and `readOwnedQueue` reports **unreadable**. Markers expire only after a positive inspection finds no interim key. | **Before:** `{reportedUnreadable:false, markerKept:false, restoredAlreadySettled:true}`. **After:** `{true, true, false}`. Once access is restored, the source is retired against its marker and nothing is replayed. While storage is denied, Home's read is `null` (shown as unavailable) and sign-out reports "couldn't read; kept". (Q2) |
| 3a | Concurrent refusals plus a **150 ms** acknowledgement: real Chromium **reloaded an acknowledged current page** | One acknowledgement callback per page, so each new check overwrote the previous callback and the earlier check timed out | Recovery is **coalesced** per page (one check in flight). An acknowledgement from the page resolves **every** pending check for it; a nonce is echoed for correlation. Eligibility is **re-checked** before a slot is reserved. | Real Chromium, worker restarted with state wiped, 8 concurrent refusals. **Before:** the R5 worker reloaded the page. **After:** not reloaded, 0 navigations. (CH15, both workers in one run) |
| 3b | Three overlapping checks for one old page used **all three** reload slots | Each check read the guard before any check reserved, then each reserved independently | Coalescing, plus a **serialized** read-check-reserve step over the persisted state (atomic within the worker). The limit stays persisted across restarts. | Worker harness. **Before:** `{queries:3, navigations:3, budgetUsed:3}`. **After:** `{queries:1, navigations:1, budgetUsed:1}`. The limit across restarts is still `1,1,1,0,0`. (W1–W3) |
| 4 | `GET /api/plan-day/bootstrap` returned an **empty 200** for a missing or invalid session | The route resolved props with a null session instead of enforcing authentication | **401 `{"error":"Not authenticated."}`** (no-store) for a missing or invalid session, or a session whose user no longer exists. The route now reads its own request cookies. Middleware 503 (account not stated, session present) and 409 (account disagreement) are unchanged, and data still goes only to the matching account. | **Before (R5 route):** 200 with null props. **After (real handler):** 401 / 401 / 401, with no data loader reached. **Real production build (N2):** no cookie gives 401; invalid cookie stating an account gives 401; headerless with any cookie gives the existing 503; other account 409; own account 200. |

## R6-2. Evidence (commit `13d773e`)

| Run | Result |
|---|---|
| `rel04R6Findings` (R5 reproductions + corrections) | **22/22**: 3 fixture-provenance checks, 9 R5 reproductions (all fail on R5 as the assessment reported), and the corrections |
| `math-core-tests`, every `npx ts-node` command | **247/247** |
| Day Constructor DB suites (fresh isolated Postgres 16, 54 migrations) | **76/76** |
| Chromium (CH15 new) | **29/29**: the R5 worker reloads the current page and the R6 worker does not |
| Real Next.js app rendering (N2 401 checks new) | **12/12** |
| Generated-Prisma type check, root `tsc` | exit 0, exit 0, exit 0 |
| Exact-head CI | **Run 45647285770 on `13d773e`: success, 9/9 jobs.** No AURA-CI-07 or MCP I2b-S2 recurrence. |

**Focused suites run locally at `13d773e`.** All of these pass:

| Suite | Result |
|---|---|
| Queue lifecycle | 16/16 |
| Queue integrity | 27/27 |
| R3 queue/auth | 26/26 |
| Sign-out | 19/19 |
| Account isolation | 50/50 |
| Boundary | 29/29 |
| SSR agreement | 21/21 |
| R1–R3 and reviewed-head reproductions | pass |
| Home/find | 15/15 |
| Bound writes | 22/22 |
| IR-06 location | 22/22 |
| Token replay | 8/8 |

`planDayWiring` 87c and the DR3 migration count also fail on `main` and are not in CI; they are unchanged.

## R6-3. Remaining limitations

- **Within the worker instance:** reservation is serialized there. Correctness across two worker instances relies on the browser running only one active worker per registration. Pages the updated worker does not control are outside this mechanism (A-1 to A-3, §R5-4).
- **Unavailable interim storage:** while legacy storage cannot be inspected, the owned queue is reported unreadable even when IndexedDB is readable. This is deliberately conservative. Replay of that account's queue pauses until storage is readable again; direct writes still store and send.
- **Headerless requests with any cookie:** these still receive the boundary's 503 before authentication. That is the existing, independently closed middleware rule, and it is unchanged.
- **Device and native behaviour:** nothing here is device or native evidence. Chromium and the loopback harness are not WebView or WKWebView acceptance.

---

## R5-1. R4 disposition findings and R5 corrections — R5 round, historical

| Area (R4 disposition) | R5 correction | Implementation | Regression evidence |
|---|---|---|---|
| **Reload fallback when `sessionStorage` is unavailable** (could loop) | The automatic page reload is **removed entirely**. Account-specific pages no longer contain server-rendered account state, so there is nothing to reload for. An account change unmounts the page, re-verifies, and mounts a fresh tree for the account now verified. | `components/AccountScoped.tsx` | `rel04R4SsrAgreementJsdom` S5: `sessionStorage` throwing; no reload path exists in the component |
| **Account data in the initial response** (RSC payload) | Plan Day, Goals, Goal detail and Captures read **no session, cookie or database** on the server; their responses carry no account data. Pages mount, and therefore fetch, only **after** the client's verification (`AccountScoped verified`). Plan Day's bootstrap moved unchanged into `GET /api/plan-day/bootstrap`, which the shared middleware treats as account-scoped. | `app/api/plan-day/bootstrap/route.ts`, `app/plan-day/PlanDayLoader.tsx`, `app/plan-day/page.tsx`, the `*Scoped` client entries for Goals, Goal detail and Captures | **Real app:** `rel04R5NextAppRendering`. It runs `next build` and `next start` against Postgres. N1: real responses with the session cookie contain no id, email, city or goal title. N2: bootstrap returns 503 headerless, 409 for another account, 200 for the own account. N3: real Chromium, data appears only after the session answer, from requests stating the verified account (Plan Day, **Goal detail**, Goals, Captures). Also `rel04R4SsrAgreementJsdom` S1–S6 and `rel04R3BoundaryJsdom` B5 (mounted Goal detail included). |
| **Migration tombstones pruned at 30 days** while a source may survive | Tombstones expire **only once source retirement is established**, meaning no interim source of that account remains, parseable or not. | `migrateOwnedSources`, `sourcesRetired` | `rel04R5QueueLifecycle` T1: cleanup failing for 45 days, tombstone kept, no resurrection; pruned after retirement |
| **Uncertain migration sources** | A source is removed after commit **only if it is still exactly what was copied**. A changed source is preserved and its new content migrates next time. | `migrateOwnedSources` (raw comparison) | T2 |
| **Claims per record** | **One claim per account + `clientRequestId`**. Database version 2 re-keys claims and dispatch marks; the upgrade carries v1 dispatch marks over. | `requestKey`, `takeClaim`, `upgradeToV2` | T3 (two records of one request); T7 (v1 → v2 upgrade) |
| **Release and settlement by the wrong attempt** | Every claim carries an **attempt token**. `releaseClaim(token)` releases only its own claim. `settleRecords(ids, token)` removes the records, since the answer is definitive for the payload, but clears the claim only if it is still that attempt's; otherwise it reports `superseded`. | `activitySync.ts`, `offlineHabitQueue.ts` | T4 (late release and settle after a reclaim); T5 (integration: a delayed send completing after another attempt reclaimed and settled leaves no record, claim or dispatch mark) |
| **Home converts an unreadable queue to empty** | `readOfflineHabitQueue` returns `null` when unreadable. Home shows an **unavailable** notice ("may not be shown; nothing was removed") and keeps pending rows. | `app/page.tsx` | T6; `rel04HomeFindTransitionJsdom` Q-R5 (mounted Home) |
| **Cleanup confirmation promises removal** (unreadable or concurrent) | The confirmation says unreadable entries **will be kept**. For readable entries it says Aura will remove them "where it can and tell you the result". The outcome reports separately: **removed** (count); **possibly sent** ("may already have been sent"); **retained** (being sent elsewhere, or a storage error); **unreadable**; and **observed legacy** entries. | `lib/signOut.ts` | `signOutRel04`; `rel04R4QueueIntegrity` D1/S1/S2; `rel04AccountIsolation` C3/C7 |
| **Worker state lost on restart** (announcements, reload guards) | Known current pages and reload guards are persisted in Cache Storage. Before reloading, the worker **asks** the page (current pages answer), and it re-queries all pages after activation and after a restart. The marker blocks a second reload of the same page, and an origin-wide limit allows 3 reloads per 10 minutes. | `public/sw.js`, `lib/serviceWorkerBridge.ts` | Chromium CH12: forced worker stop **and** persisted state wiped; current page not reloaded, old page still recovered. CH13: stale old HTML; reloaded once, never again, including after a restart. |
| **Auth timeout released later requests without settlement** | The timer starts when the previous request is actually **sent**. A request waiting behind one that is still unsettled is **not sent**; it gets 503 `auth_transition_unsettled`. The bound is 8 s, below the client's own sign-out (10 s) and sign-in (15 s) timeouts, so the page receives the answer before giving up. The page reconciles with a session read: sign-in reports "still in progress, nothing was changed" and sign-out ends `busy`. Nothing is presented as completed. | `public/sw.js` (`settleAuthSerially`), `lib/signInCode.ts`, `lib/signOut.ts` | Chromium CH14 (queued sign-in answered at about 8 s, never sent, message shown); `rel04R5QueueLifecycle` T8 (sign-out → busy; sign-in → "still in progress") |
| Reminder notification compatibility | The push and notification-click handlers are unchanged. `/api/reminders/seen` stays `optional`, with ownership checked in the route. | — | `rel04R3BoundaryJsdom` inventory |

**Not addressed in R5:**
- **A-2 / A-3 for clients the updated worker does not control.** This covers worker unavailable, a hard reload, no navigation since the update, and a request in flight inside a worker being replaced.
- The auth design that would prevent a stale logout from clearing a replacement session for *any* client. This is coordinated with AUTH-01 and **not** claimed. Neither the worker nor revocation alone establishes complete mixed-version authentication safety.

## R5-2. Evidence (commit `a3a02b8`)

Evidence is in `docs/android/evidence/rel04-r5-a3a02b8/`. It has manifests (head SHA, clean-tree flag, Node version, step env, exit code, duration and log sha256) and per-command logs, produced by `test/evidence-tools/`.

| Run | Result | Kind |
|---|---|---|
| `math-core-tests`, every `npx ts-node` command | **246/246** (10 non-`ts-node` steps listed as skipped) | real application code (jsdom-mounted components, real routes and middleware); harness simulations labelled |
| Day Constructor DB suites, fresh isolated Postgres 16 (54 migrations) | **76/76** | real routes + real database |
| Chromium multi-page | **27/27** (Chromium 151.0.7922.34; CH12–CH14 new) | real browser; loopback harness with synthetic accounts |
| `rel04R5NextAppRendering` | **11/11** | **real production Next.js build and server**, real Postgres, real Chromium |
| Generated-Prisma type check, root `tsc` | exit 0, exit 0, exit 0 | — |
| Exact-head CI | **Run 45637045491 on `a3a02b8`: success, 9/9 jobs.** The jobs include the new `REL-04 Next.js app rendering tests`, Chromium, the DB suites, the math-core job, migration validation, the Next.js build, Palmistry G5 and both MCP jobs. | — |

**Superseded intermediate commit.** On `0f260d7` (R5 first commit), run 45634108973 failed two jobs:

- **Chromium CH14.** This was a real timing issue. The worker's 15 s bound equalled the client's 15 s sign-in timeout, so the client could give up first. Its 503 was also shown as "couldn't reach the server". Both are fixed in `a3a02b8`: the bound is now 8 s, and the explicit message is shown.
- **Ephemeris / panchang.** This is the known MCP S10 "0 refused in 20 000 hex samples" statistical flake (about 0.6% per run, a test-only issue tracked in PR #394). It is unrelated to #392. It was not rerun.

No AURA-CI-07 recurrence was observed in R5.

The CI-07 occurrence-5 archive (run 45625122499, job 139243144597) is now also committed under `docs/android/evidence/ci07-occurrence5-a59a934/`, with SHA256SUMS. The original is at the repository root. The R4 assessor could not locate it there.

## R5-3. Deployment and REL-05 separation

- Unchanged from §R4-6, and still point-in-time evidence. Re-read the Ignored Build Step immediately before any merge, and confirm the merge's deployment is cancelled.
- PR #392 adds no migration.
- **PR #392 is kept out of REL-05's release commit.** Its activation is a separate decision under §R5-4.

## R5-4. Activation and native acceptance requirements (carried forward; mandatory before activation; NOT executed here)

**Open activation blockers:**
- **A-1:** older-client recovery outside an updated-worker-controlled page.
- **A-2:** a supported path that verifies session state before an affected client can claim sign-out succeeded.
- **A-3:** an auth design that prevents a stale logout response from clearing a replacement session, plus evidence for slow, interrupted and worker-replacement cases beyond CH11/CH14. AUTH-01 is coordinated.
- **A-4:** point-in-time; must be re-confirmed.

**Rollout gate.** These complete §R4-8 as the R4 disposition requires.
1. Record the exact release commit, the Preview smoke results, and D-S8, D-S9, D-Q1, D-X1, D-W1 and D-W2 on the release build.
2. Record the owner-approved treatment of uncontrolled clients.
3. Define, per metric:
   - a **baseline** (7 days before promotion);
   - a **denominator** (requests or sessions);
   - an **observation window**;
   - a **numeric stop threshold**;
   - a named **decision owner**.

   The metrics are:
   - `client_upgrade_required` 503s per active session;
   - unbound-logout 503s without a following reload;
   - 409 `account_mismatch` rate;
   - 5xx rate;
   - habit-log duplicate `clientRequestId` conflicts.
4. Demonstrate privacy-preserving telemetry that can correlate four things: the refusal, the navigation, receipt of the new bundle (the page's boundary announcement), and verified session state. A reload marker alone establishes only navigation.
5. Pair server metrics with **queue-retention checks on devices**, because lost local work may never reach server logs. Use D-Q1 plus the in-app unavailable-queue notice rate, if instrumented.

**Supported-client compatibility.**
- Record the supported browsers and WebViews, and which of them run the worker.
- For each one without a worker: record the A-1 to A-3 exposure, and whether it is accepted or blocked.

**Device acceptance (§11).** Required on the release build, with the REL-03 supervised acceptance (deferred, not waived):
- D-S1 to D-S9;
- D-Q1;
- D-X1;
- D-W1;
- D-W2.

**Worker rollback.**
- **Rollback candidate:** reconcile to **one** approved rollback deployment for this activation, chosen from the current live `dpl_3Sst…` and the REL-04 record's `dpl_EhhkW…`. Record the choice.
- **Restore lag:** restoring the alias leaves already-active workers subject to their update lifecycle. They switch on the next navigation, which fetches the restored `sw.js`.
- **Rollback acceptance must verify:**
  - (a) the restored worker takes control;
  - (b) the reload loop protection and the recovery notice behave;
  - (c) reminder notification clicks still focus or open the app.


---

## R4-1. Findings and dispositions (assessment of `b323d2a`) — R4 round, historical

| # | Finding (assessment) | R4 disposition | Implementation | Regression evidence |
|---|---|---|---|---|
| 1 | IR-01: Plan Day (and other server-rendered pages) show account-derived props without the first verification agreeing. The first verification does not change the epoch. | **Corrected.** The page passes the account it was rendered for. Content and actions appear only once the client's verified account agrees, including on the first verification. Disagreement reloads the page without showing the old props; reloading is bounded, with a Reload button after that. Failure shows Retry. Agreement is re-required after every change. | `lib/serverAccount.ts`; `components/AccountScoped.tsx`; `app/plan-day/page.tsx`, `app/goals/page.tsx`, `app/goals/[goalId]/page.tsx`, `app/captures/page.tsx` | `rel04R4SsrAgreementJsdom` S1–S6 (real `PlanDayClient` and `GoalsListClient`); `rel04R3HeadReproduction` X1 (fails on `b323d2a`); `rel04R3BoundaryJsdom` B5 |
| 2 | IR-01: exports and downloads use the ambient cookie. | **Corrected.** Export Data and the calendar download are bound to the account the user tapped under: the binding is captured at the tap, the request states the account, the body is read inside the lease, and the file is handed over only if the binding is still current. `/api/users/export` is account-scoped. The calendar **feed** keeps its subscription contract (`optional`: headerless allowed, a stated mismatch refused). | `lib/boundDownload.ts`; `components/YouView.tsx`, `components/BirthChartSection.tsx`; `lib/accountRoutePolicy.ts` | `rel04R4SsrAgreementJsdom` D1–D6; `rel04R3BoundaryJsdom` B1/B2; `rel04R3HeadReproduction` X6 |
| 3 | Queue: the migration's tombstone check and its write are separate operations. | **Corrected.** Each source entry is checked against the record and its tombstone, then written, in **one** IndexedDB transaction. The source is removed only after commit. | `lib/offlineHabitQueue.ts` (`migrateOwnedSources`) | `rel04R4QueueIntegrity` M1/M2 (25 interleavings); `rel04R3QueueAuth` Q6/Q7; Chromium CH8; `rel04R3HeadReproduction` X2 |
| 4 | Queue: replay checks "still queued" before an awaited check, so a discard can slip in before dispatch. | **Corrected.** A record is sent only after an atomic **claim** (it exists, and no context holds a fresh claim). No await separates the final account check from the send. | `claimForDispatch`, `releaseClaim`, `settleRecords`; `lib/activitySync.ts` | `rel04R4QueueIntegrity` H1/H2; Chromium CH2/CH6; `rel04R3HeadReproduction` X3 |
| 5 | Queue: serialize migration and settlement; a replay/discard handoff that accounts for dispatched work; evidence for overlapping operations and for the path without Web Locks. | **Corrected.** Every step is a transaction, serialized across contexts by IndexedDB itself. A discard keeps a record another context is sending (`keptInFlight`). Records already dispatched are removed but reported as **possibly saved**; a local discard never claims to undo a server commit. A dead sender's claim expires after 60 s and the entry is resent with the same id, which the server de-duplicates. | `discardRecords`; `lib/signOut.ts` | `rel04R4QueueIntegrity` D1, C1/C2 (no Web Locks), I1, F1/F2; Chromium CH7 (Web Locks removed) |
| 6 | Legacy: rewriting the shared array while old writers may be active. | **Corrected by deferral.** This build never rewrites or removes `offline_habit_queue`. Entries stay quarantined: never replayed, assigned or shown. They are counted only. The Home notice no longer offers removal. Cleanup is deferred until older writers can no longer be active. | `readLegacySnapshot` (read-only); `app/page.tsx` notice | `rel04R3QueueAuth` Q8; `rel04R4QueueIntegrity` L1; Chromium CH9 (old bundle writing during a new sign-out); `rel04R3HeadReproduction` X4 |
| 7 | Logout messaging can say "nothing removed" when legacy entries were removed. | **Corrected.** Owned and legacy outcomes are reported separately, from the counts the discard transaction observed (removed / possibly saved / kept in flight / failed / unknown; legacy kept). The confirmation asks about owned entries only. | `discardOutcomeMessage`, `describePendingWork` | `rel04R4QueueIntegrity` S1/S2; `signOutRel04`; `rel04R3HeadReproduction` X5 |
| 8 | IR-03: the app must say accurately whether sign-out completed. | **Corrected.** Every outcome has one statement (`signOutOutcomeMessage`): signed out (with the discard report); signed out on this device but unconfirmed (activity kept); another account now signed in; failed; busy; unverified. Cancelled says nothing. | `lib/signOut.ts`, `app/page.tsx` | `rel04R4QueueIntegrity` S3 |
| 9 | A-1: old bundles have no reload path; the blanket no-data-loss claim. | **Mitigated (activation-dependent).** The updated service worker (which Production pages already register) reloads an out-of-date page once, when the server refuses one of its unbound requests with `client_upgrade_required`. Current-bundle pages announce themselves and are never reloaded. The claim is **qualified**: queued activity is kept, but a refused action on an old screen, and unowned legacy entries, are not "recovered". | `public/sw.js`; `lib/serviceWorkerBridge.ts`; `app/AccountBoundaryRoot.tsx` | Chromium CH10 (old Production worker replaced; the old page reloaded into the current bundle; an announced page not reloaded) |
| 10 | A-2: false sign-out on old pages. | **Mitigated (activation-dependent).** The old page's sign-out is refused (cookie untouched); the worker then reloads that page, which shows the real session and a "did not complete" notice. **Residual:** pages not controlled by the updated worker. | as row 9 | Chromium CH10; CH10a (residual reproduced under the old worker) |
| 11 | A-3: cookie response ordering (CH4d). | **Mitigated (activation-dependent).** The worker sends sign-in and sign-out requests from every page it controls one at a time; the next starts only after the previous response, and its Set-Cookie, has arrived (bounded at 15 s). This covers old bundles and contexts without Web Locks. **Residual:** uncontrolled pages, and responses slower than the bound. | `public/sw.js` | Chromium CH11 (the CH4d race serialized; B survives); CH4d (uncontrolled residual) |
| 12 | A-4: deployment isolation evidence. | **Evidence obtained (read-only), §R4-6.** | — | `evidence/rel04-r4-9c32460/DEPLOYMENT_ISOLATION_READONLY.md` |
| 13 | Evidence gaps: command manifests and outputs tied to the head. | **Corrected.** Per-command logs plus manifests (head SHA, clean-tree flag, node version, command, step env, exit, duration, log sha256). | `test/evidence-tools/` | `evidence/rel04-r4-9c32460/` |
| — | Found during R4: the worker's notification-click `POST /api/reminders/seen` carries no header, so it would get 503 under the boundary. | **Corrected.** That route is `optional`; the route verifies ownership before writing. Push is not active in Production. | `lib/accountRoutePolicy.ts` | `rel04R3BoundaryJsdom` B1 inventory |

IR-06 is unchanged and stays CLOSED. AURA-CI-07 evidence is untouched.

## R4-2. Storage architecture decision

**Decision: the owned offline queue moves from localStorage to IndexedDB. There is no fallback store.**

- **Why.** Every remaining queue finding is a check-then-act race *between browsing contexts*. localStorage offers single-key atomicity but no compare-and-set across tabs. R3's immutable records closed write-write races, but not check-then-write (migration) or check-then-send (replay against discard) without Web Locks, and Web Locks are absent on supported older WebViews.
- An IndexedDB `readwrite` transaction is atomic and serialized against every overlapping transaction of the origin, in all tabs, with or without Web Locks. Each lifecycle step is therefore one transaction: create with identity check and the sender's claim; claim for dispatch; settle; discard; migrate with tombstone check.
- R3 rejected IndexedDB for three reasons. Re-examined:
  - "Migration sources live in localStorage": the copy is now made idempotent and race-free *inside* the IndexedDB transaction, and the source is removed only after commit.
  - "Presentation paths become async": the two Home reads are now awaited and dropped if the account changed meanwhile.
  - "jsdom lacks IndexedDB": the tests use `fake-indexeddb@6.2.5` (devDependency, exact version, published 2025-11-07), which implements the spec's transaction scheduling. The real-browser behaviour is shown in Chromium (CH1, CH2, CH6–CH9).
- **Failure.** If IndexedDB fails (unavailable, quota, read or write error), reads report *unreadable* (never empty) and writes report *not stored*. Nothing falls back to localStorage or memory (F1).
- **Existing data.**
  - The released Production bundle only ever wrote the unowned legacy array, which stays untouched (row 6).
  - The interim owned formats (R1 `offline_habit_queue_v2:<owner>`, R2 `aura_q3:…`, R3 `aura_q4:…` with `aura_q4t:` tombstones), which were never released, are migrated with their payloads intact. Unparseable sources are left in place (M1).

## R4-3. Remaining activation-dependent limitations

- **A-1 / A-2 / A-3: narrowed, not closed.** The service-worker bridge covers pages the *updated* worker controls. A browser fetches the updated worker on the next navigation anywhere in the origin; skipWaiting and clients.claim then apply it to already-open pages (CH10).
- **Not covered:**
  - browsers with service workers disabled or unsupported;
  - private modes that block them;
  - a hard reload, which bypasses the worker;
  - an old tab while *no* navigation has happened in the origin since deployment;
  - the Capacitor Android WebView, until D-W2 shows the worker controls it.
- For those clients, A-1 (generic failures until reload), A-2 (false signed-out screen) and A-3 (CH4d ordering) remain as described in R3 §R6.
- **AUTH-01 design note.** Server-side revocation would let an unbound legacy logout revoke the session it carries *without* any cookie mutation, which would close A-2 and A-3 for uncontrolled clients too. AUTH-01 remains separately authorized. Revocation alone does not fix response ordering; the worker serialization does, for controlled pages.
- **No-data-loss claim, qualified.** Queued activity on this device is kept across refusals. Not covered:
  - a new action refused on an old screen (for example creating a plan), which is not saved and must be repeated after the reload;
  - unowned legacy entries, which are kept but never synced;
  - a discarded entry that was already sent, which may already be saved on the server.
- **Older WebViews without Web Locks.** Queue integrity no longer depends on Web Locks (C1, CH7). Auth-transition exclusion between new-bundle pages is still marker-based there; D-W1 applies.
- **Android WebView download path** for blob downloads is unverified (D-X1).

## R4-4. Regression evidence (commit `9c32460`)

All evidence is under `docs/android/evidence/rel04-r4-9c32460/`. Each manifest records the head SHA, that the code tree was clean, the node version, and for every command its step env, exit code, duration and log sha256. Commands are taken verbatim from `.github/workflows/ci.yml` by `test/evidence-tools/ciCommands.py` and run by `runSweep.mjs`.

| Run | Result | Kind |
|---|---|---|
| `math-core-tests` job, every `npx ts-node` command (mounted application tests, REL-04 suites, structural tests) | **245/245 pass** (10 non-`ts-node` steps listed as skipped in the manifest: installs, builds and shell checks) | real application code (jsdom-mounted components, real route handlers, real middleware); REL-04 harness simulations are labelled in each suite |
| `day-constructor-acceptance-db-tests` job, every DB suite, fresh isolated Postgres 16 (port 55497, `prisma migrate deploy`, 54 migrations) | **76/76 pass** | real routes + real database |
| `rel04-chromium-multitab` (Chromium 151.0.7922.34, headless) | **22/22 pass** (also 22/22 on two earlier local runs) | real browser: storage, IndexedDB, Web Locks, cookies, service workers, against a loopback harness with synthetic accounts and an in-memory store |
| Generated-Prisma type check (`prisma generate` + `tsc -p apps/web/tsconfig.json`), root `tsc -p tsconfig.web.json` | exit 0 / exit 0 | — |

**New or changed REL-04 suites (local, at `9c32460`):**

| Suite | Result |
|---|---|
| `rel04R4QueueIntegrity` | 27/27 |
| `rel04R4SsrAgreementJsdom` | 20/20 |
| `rel04R3HeadReproduction` | 20/20 (8 fixture provenance checks plus X1–X6 reproduced on `b323d2a`, corrected at head) |
| `rel04R3QueueAuth` | 26/26 |
| `rel04AccountIsolation` | 50/50 |
| `rel04R3BoundaryJsdom` | 26/26 |
| `rel04R1HeadReproduction` | 22/22 |
| `rel04R2HeadReproduction` | 31/31 |
| `signOutRel04` | 19/19 |
| Chromium | 22/22, two consecutive runs |

**Harness-only (simulation) vs real:**
- The `rel04AccountIsolationHarness` suites are deterministic in-process simulations: real modules, routes and middleware; a simulated device, cookie jar and tabs; a spec-conformant in-memory IndexedDB.
- Chromium is a real browser, but not WebView or WKWebView.
- No Android WebView or WKWebView acceptance is claimed.

## R4-5. Exact-head CI

**CI run 45622705665 on `9c324602faef9567cf5212150d367cafa9d3a99f`: success, 8/8 jobs.** The jobs are:

- MCP Server, and MCP Server (Node 20);
- Database migration validation;
- Day Constructor acceptance DB tests;
- Ephemeris / panchang tests, which is the `math-core-tests` job and includes every REL-04 suite;
- Next.js production build;
- Palmistry upload pipeline (G5);
- REL-04 Chromium multi-tab.

The Vercel Preview also built.

**Superseded run.** The first R4 commit, `fc6536e`, failed one job (run 45621398826). `contentionTraceArchitecture` G10 forbids an exported function parameter named `sink`, and `lib/boundDownload.ts` had one. The fix is in `9c32460`.

The local sweep on `fc6536e` also showed an intermittent `rel04R4QueueIntegrity` H2 failure. The cause was entries queued in the same millisecond being ordered by a random record id, so the test sometimes discarded the record already being sent. The product kept it, correctly. `9c32460` orders ties deterministically and makes the test order-independent. The suite then passed 5/5 consecutive runs, and so did `rel04R3QueueAuth` and `rel04R4SsrAgreementJsdom`.

The report-and-evidence commit that follows `9c32460` changes only `docs/`. CI is rerun on it as well, and the result is recorded in the PR.

## R4-6. Deployment isolation (read-only, 2026-11-25)

Full record: `evidence/rel04-r4-9c32460/DEPLOYMENT_ISOLATION_READONLY.md`.

- **Git Production builds.** Ignored Build Step (sha256 `0faf045e…`) cancels every Production build before install. The latest merge (`7b80f98`, `dpl_HBA2…`) shows 7 events ending in the cancel; the nine merges before it were also cancelled. No install, build or migration ran.
- **Automatic promotion.** `autoAssignCustomDomains: true`, and no rolling release. It is neutralised only by the ignore step.
- **Routing.** `aura-updated.vercel.app` points to `dpl_3Sst…` (REL-04 web, `ac46fc3`).
- **Migrations.** Only Production-target builds run `prisma migrate deploy`. PR #392 adds none. `main` already carries 0054 (REM-01), which is unapplied in Production.
- **Rollback target.** `dpl_EhhkW…` (REL-03), which is READY. Never promote `dpl_GweqM…`.
- **Merge without activation.** Yes, while the ignore step stays as recorded. Re-read it immediately before the merge, and check that the merge's deployment is cancelled.
- **REL-05.** #392 has no flag. After a merge, REL-05 either (a) builds from a commit or release branch without #392, or (b) is the activation, under §R4-8. **Owner decision needed before the merge.**

## R4-7. Readiness conclusions

| | Conclusion |
|---|---|
| **Implementation** | **Complete** for every finding of the `b323d2a` assessment. Activation-dependent residuals are documented (§R4-3). Ready for independent evidence assessment. |
| **Controlled merge** | **NO-GO** for now. Requires: (1) the independent assessment; (2) the owner's REL-05 option (a) or (b), §R4-6; (3) explicit owner approval; (4) the ignore step re-read immediately before the merge. Merge-without-activation is otherwise evidenced. |
| **Production activation (shared web)** | **NO-GO / HOLD** pending its separate decision against §R4-8, with D-S8, D-S9, D-W2 (and D-W1) recorded. Android public release stays on HOLD (REL-03 supervised acceptance deferred, not waived). |

## R4-8. Activation criteria (replaces the R3 §R6.2 drain plan)

A time window is **not** an exit criterion. A low-traffic period proves nothing about already-loaded tabs or suspended WebViews.

**Before activation (all required):**
1. The ignore step is unchanged, and promotion is manual (re-read).
2. A Preview of the exact release commit passes the Chromium suite, and a manual smoke test with synthetic accounts covers sign-in, sign-out, an offline log and Plan Day.
3. Device rows D-S8, D-S9, D-Q1, D-X1, D-W2 are recorded on the release build.
4. The owner accepts, in writing, the residual for clients the worker does not control (§R4-3), or AUTH-01 revocation ships first.

**Observable exit criteria after promotion** (from Production logs and metrics, without user data):
- **Old-client exposure.** The rate of `client_upgrade_required` responses (503, code in body) falls to zero, or to a stated floor the owner accepts. Count unbound `POST /api/auth/logout` 503s separately: each is an old-page sign-out attempt.
- **Accurate sign-out.** Every unbound-logout 503 is followed by that client's reload: an HTML request carrying `aura_reloaded=upgrade` from the same client within seconds. An unbound 503 with no following reload is a client the worker does not control, and an A-2 exposure.
- **Session consistency.** 409 `account_mismatch` responses stay at their pre-activation baseline, and no route returns account data to a request whose stated account differs.
- **Queue preservation.** No rise in habit-log 4xx refusals beyond baseline, and no duplicate `clientRequestId` rows.

**Stop or roll back:**
- Unbound-logout 503s without reloads persist above the agreed floor.
- 409 or 5xx rates rise beyond the agreed thresholds.
- Any report of a wrong-account screen, a false sign-out or lost activity.
- The rollback is an alias promote back to `dpl_3Sst` (or `dpl_EhhkW`). #392 needs no database step. If the worker must be withdrawn, rolling back the deployment restores the previous `sw.js` on the next navigation.


---

## R1 (R3 round, historical). Finding-by-finding remediation (disposition of `091e3ce`)

### IR-01 Account isolation

| Finding | Correction | Reproduced on `091e3ce` | Corrected evidence |
|---|---|---|---|
| Boundary installed only from Home and `/find`; standalone Goals, Captures and Connected Apps use ambient cookies | The client boundary is installed for **every page** from the root layout (`app/AccountBoundaryRoot.tsx`, at module evaluation, before any page effect). Standalone surfaces are wrapped in `AccountScoped` ('reload' for server-rendered Goals, Goal detail, Captures and plan-day; 'remount' for Connected Apps). | E10 | B5 (Goals, Captures, Connected Apps mounted) |
| Wrapper forwards while the account is unknown | One shared verification (`ensureVerifiedAccount`) runs before any account-scoped request. If it fails, the request is **refused and never forwarded**. A tab that believes it is signed out states `~signed-out`. | E10 | B3, B4 |
| Middleware passes absent headers and edge-verification failures | `middleware.ts` plus one shared policy (`lib/accountRoutePolicy.ts`, used by both server and client):<br>• headerless account-scoped request **with a session** → 503 `client_upgrade_required`;<br>• `~signed-out` or another account → 409;<br>• cookie present but unverifiable at the edge → 503 `account_check_unavailable` (**fail closed**). | E7, E8 | B2, SB8 |
| Connected Apps excluded by the MCP prefix | Only the MCP **protocol** endpoint `/api/mcp` is exempt (bearer/OAuth; disabled status preserved). `/api/mcp/connections` (cookie management) is account-scoped. | E7b | B1 |
| Report over-claimed "all app reads state the account" | Replaced by the inventory below. Every exemption is listed with its reason; the client and middleware share one table. | — | B1 |
| My Day and PlanWithAura re-capture the binding at **Save anyway** | The original binding travels in the overlap refusal (`PlanOverlapSaveError.binding`, `PlanOverlapActionError.binding`) and pending state. The override re-sends with it. | Mounted, R2 components fail 2/5 | `rel04R3OverrideBindingJsdom` 5/0 |
| `/find`: restore, request-code and listener lack generation and cancellation protection | A per-flow `AbortController` plus generation check covers restore, search, request-code, verify and save continuations; a retired flow's requests are aborted. During its own sign-in the listener **counts** account changes: anything beyond its own is treated as competing (error, flow retired). | F7 (restore) | F6, F7, F4, F5 |
| Existing route and ownership protections | Unchanged:<br>• habit-log and plan 503/409 before database access;<br>• bound 401;<br>• session-user ownership on move, skip, log and delete;<br>• Day Constructor token check;<br>• guest discovery. | — | SB1–SB9, DB suites |

### Offline queue durability

| Finding | Correction | Reproduced on `091e3ce` | Corrected evidence |
|---|---|---|---|
| A direct 502 deletes the outbox entry | Any 5xx (incl. 502) or no response is **ambiguous**: the entry is kept and replayed with the same `clientRequestId` (server de-duplicates). Only 2xx or a definitive 4xx settles it. | E1 | Q1 |
| A per-entry read exception looks like an empty queue | Any storage exception (enumeration or per-record read) makes the read return `ok:false`, **unreadable**. Unparseable records are kept and counted. | E2 | Q2 |
| A later payload can overwrite or share an identity | Records are **immutable**, one per key `aura_q4:<owner>:<crid>:<recordId>`. Enqueueing a different payload under an existing identity is refused (`conflict`). Conflicting records written by other builds are **quarantined** (never sent, never removed, reported). | E3 | Q3 |
| Settlement or discard can remove a different or newer payload | Removal targets exact immutable keys only. A record written later has a different key. | — | Q4, C5d |
| Replay can send from a stale snapshot | Before each send, the exact record must still exist and no auth transition may be active (the held lock is consulted). | (in-process) | Q5, **CH2 (Chromium)** |
| Migration not interruption-safe; concurrent migration recreates settled entries | Owned interim formats (R1 `offline_habit_queue_v2:<owner>`, R2 `aura_q3:<owner>:<crid>`) copy to a **deterministic** record id, so a re-run is idempotent. A source is removed only after its copy exists. Settling or discarding a migrated record writes a **tombstone** first, so no migration can recreate it. | E4 | Q6, Q7 |
| An unreadable snapshot gives a "successful" logout with zero failures | Sign-out reports `discardUnknown: true` with an explicit message. Nothing is claimed removed. | E5 | Q2 |
| Discard of exact confirmed records; incomplete discard reporting | Discard removes exactly the snapshot (owned records, plus the legacy array via `discardLegacySnapshot`). Every removal is verified, and failures and kept-later entries are reported. | — | C5d, C7c, Q8 |
| An already-dispatched request may commit | The outbox keeps unresolved entries under their account with the original id. Replay with that id reconciles (exactly one row). Aborting is never treated as "not committed". | — | C3 |

IndexedDB was evaluated and not adopted (§R3).

### Legacy records

| Finding | Correction | Reproduced on `091e3ce` | Corrected evidence |
|---|---|---|---|
| **Add to this account** reassigns unowned records | **Removed.** Unowned legacy records stay quarantined: never replayed, never assigned, contents never shown. The only action is **Remove from this device**, applied to the confirmed snapshot only. Entries added later by an old tab are kept and reported. | E11 | Q8, D1 |

### IR-03 Sign-in / sign-out transitions

| Finding | Correction | Reproduced on `091e3ce` | Corrected evidence |
|---|---|---|---|
| Cross-tab suspension depends on the storage marker even with Web Locks | `isTransitionActiveNow()` consults the **held** auth lock (`navigator.locks.query`) as well as the marker. It is used by the wrapper, by `runActivityOperation`, and before each replay send. Marker writes are read back; coordination health is recorded. | E12 | A2, **CH3 (Chromium, marker blocked)** |
| Sign-in treats a 4xx as definitive | Any non-success is reconciled with a fresh, strictly parsed session answer. The prior state resumes only if that answer confirms it; otherwise the account switches or becomes unverified. | E6 | A1 |
| Unverified forwarding; failed verification | Covered by the IR-01 wrapper change; unverifiable state refuses all account-scoped work. | E10 | B3 |
| Marker failure without Web Locks; simultaneous transitions; suspended contexts | Defined behaviour (§R5): the transition proceeds in its own tab, coordination is recorded as unavailable, and other tabs rely on the server's account checks (409/503). | — | A3 |

### Mixed-version compatibility

| Finding | Correction | Reproduced on `091e3ce` | Corrected evidence |
|---|---|---|---|
| Headerless legacy logout clears the cookie, erasing a replacement account's session (confirmed in Chromium by the reviewer) | Headerless logout → 503 `client_upgrade_required`, **no Set-Cookie**. Bound logout remains 409 under another account's session. | E9; **CH4a (Chromium)** | SB7, **CH4b (Chromium)** |
| Upgrade results not surfaced from automatic replay | Any request, including automatic replay, that receives `client_upgrade_required` raises the reload prompt (`AccountBoundaryRoot`). The entry is kept. | — | Q9 |

### Tests and documentation

| Finding | Correction | Evidence |
|---|---|---|
| `pendingReplayReconciliation` stale structural assertion, and not in CI | The assertion now matches the per-identity settlement contract (classify, keep retry-worthy items, remove exactly the settled records; no batched rewrite). It is added to CI. | passes; CI step added |
| Five changed DB suites outside CI | Identified from the diff against the workflow:<br>• `planGoalActivityArchivedLifecycleDb`<br>• `planGoalActivityCompletionIntegrityDb`<br>• `planGoalActivityLinkDb`<br>• `planStatusPreservationDb`<br>• `plannedActivitySchedulingModeDb`<br>Verified in an isolated Postgres 16 and added to the CI DB job. | §R4 |

## R2 (R3 round, historical). Shared account boundary

### R2.1 Route coverage (`lib/accountRoutePolicy.ts`)

**Account-scoped** (default for every `/api` route): everything not listed below. That covers the remaining route files among the 88 under `app/api`, including:
- the habit, habit-log, plan, goal, capture, people and Aura Moment owner routes;
- my-day, day, day-constructor, daily-assistant, insights, panchang, timing-search, forward-planner, muhurtham-search, ask-aura, reminders and push-subscriptions;
- users/*, cities/custom and `/api/mcp/connections`.

**Exemptions, each with its reason:**

| Route | Class | Reason |
|---|---|---|
| `/api/auth/*` | exempt | Sign-in/out protocol. Logout enforces its own binding. |
| `/api/guest/*` | exempt | Guest discovery; no account |
| `/api/health`, `/api/push/public-key` | exempt | No account data |
| `/api/internal/*` | exempt | Server-to-server, shared secret |
| `/api/mcp` | exempt | MCP protocol: its own bearer/OAuth auth. Disabled (404) in production; status preserved. |
| `/api/location/*` | exempt | Requires a session but returns only public place data |
| `/api/aura-moments/<token>/response` | exempt | Public recipient link (bearer-link token) |
| `GET /api/calendar/feed`, `GET /api/users/export` | exempt | Link-navigation downloads (cannot carry a header). The response is a file for the current cookie holder, never rendered into an account-scoped screen. |
| `/api/product-events` | optional | Telemetry from guest and signed-in pages; a stated account is enforced |

**Surfaces:**

| Surface | Protection |
|---|---|
| Home | Account boundary; epoch-keyed remount |
| `/find` | Boundary; flow generation and abort; bound save |
| Goals, Goal detail, Captures, plan-day | Boundary; `AccountScoped` reload |
| Connected Apps | Boundary; `AccountScoped` remount |
| `/connect/sign-in` and LoginScreen | Shared `verifySignInCode` |
| `/moment/<token>` | Public; exempt response route |

### R2.2 Invariants

| # | Invariant |
|---|---|
| I1 | The verified account is set only from the newest session answer, with no intervening account change. |
| I2 | Account changes advance the epoch. Account-scoped UI remounts or reloads. |
| I3 | No account-scoped request is forwarded while the account is unknown, during any auth transition (local, marker, or held Web Lock), or after a failed verification. |
| I4 | Every account-scoped request states the account (or `~signed-out`). The server refuses a mismatch (409) and a headerless request carrying a session (503). An unverifiable cookie fails closed (503). The session cookie remains the **only authorization**. |
| I5 | Delayed actions (overlap overrides, CHECK-then-save, `/find` save) keep the binding of the user's original action. |
| I6 | One auth transition per browser (Web Locks; marker fallback). An unverifiable outcome leaves the account unverified, with work kept and Retry offered. |

## R3 (R3 round, historical). Queue storage design and migration

| Topic | Behaviour |
|---|---|
| Layout | `aura_q4:<owner>:<clientRequestId>:<recordId>` → immutable JSON record (ownerUserId, recordId, queuedAt) |
| Atomicity | Every mutation is one `setItem` of a new key or one `removeItem` of an exact key. There is no shared array and no rewrite, so integrity needs no lock. Web Locks only keep tabs from replaying the same account at once. |
| Identity | One `clientRequestId` maps to one payload: a conflicting enqueue is refused; conflicting records are quarantined. Identical-payload duplicates replay once and settle together. |
| Unreadable | Any storage exception means unreadable: replay stops and the logout discard is reported as unknown. |
| Ambiguity | No response, abort, or any 5xx keeps the entry. Only 2xx or a definitive 4xx settles it. Account holds (401/403/409/428) keep it for its owner. |
| Migration | Applies only to **owned** interim formats (ownership is evident from the owner key plus `ownerUserId`). It uses a deterministic recordId, copies before removing the source, writes a tombstone on settle or discard, and prunes tombstones after 30 days once no source remains. |
| Legacy (`offline_habit_queue`) | Unowned: quarantined, never migrated, assigned or shown. Discard works on the exact confirmed snapshot only. |
| No storage | Reported as not stored. No fallback to a weaker store. |

**IndexedDB was evaluated and not adopted:**
1. The migration sources are in localStorage, so IndexedDB transactions could not make migration atomic.
2. Every synchronous presentation path would become asynchronous.
3. jsdom has no IndexedDB, so a new test dependency would be needed.

The immutable-record design meets the whole contract in every supported environment, with or without Web Locks.

## R4 (R3 round, historical). Reproductions, regressions and browser tests

| Suite | Result | What it covers |
|---|---|---|
| `rel04R2HeadReproduction` | **31/0** | 10 provenance checks plus E1–E12. Each finding reproduces with `091e3ce` code and is prevented on R3. |
| `rel04R3QueueAuth` | **26/0** | Q1–Q9, A1–A3 |
| `rel04R3BoundaryJsdom` | **24/0** | Route inventory (all 88 route files), middleware policy, unknown/failed verification, signed-out statement, mounted Goals, Captures and Connected Apps |
| `rel04R3OverrideBindingJsdom` | **5/0** | Mounted PlanWithAura and My Day **Save anyway**. The R2 components fail 2/5 (local swap). |
| `rel04BoundWritesJsdom` | **22/0** | P1–P10, F4–F7. F7 fails on the R2 `/find`. F6 does not discriminate on R2 (its own reset masks it), so the request-code finding rests on code review plus F6. |
| `rel04Chromium` | **12/0** | Real Chromium 151, two tabs in one context: concurrent enqueue; replay versus discard; Web Locks auth exclusion with the marker blocked; delayed Set-Cookie ordering (R2 defect reproduced, corrected, coordinated case, documented residual); pre-REL-04 replay with valid and expired sessions |
| Preserved REL-04 suites | all pass | isolation 50/0, Home/`/find` 13/0, R1-head reproduction 22/0, a54daf6 reproduction 13/0, sign-out 19/0, search 22/0, RV-1 8/0, static 48/0 |
| `pendingReplayReconciliation` | passes | Assertion corrected; now in CI |

**Fixture provenance:**
- `rel04-reviewed-head` (a54daf6): 5 files, including the newly vendored logout route;
- `rel04-r1-head` (d09449b): 7 files;
- `rel04-r2-head` (091e3ce): 10 files.

All are byte-checked locally. CI's shallow clone skips the provenance checks.

**Database (isolated):** a throwaway Postgres 16 cluster in the scratchpad (own data directory and port; no existing database touched), `prisma migrate deploy` (54 migrations). Results:
- the five outside-CI suites pass on `091e3ce` (baseline) and on R3;
- **all 84 distinct DB suites** in the workflow (the DB job, now including the five, plus the DB suites in other jobs) pass on R3 when run with CI's exact commands and environment.

**Type check:** `apps/web` `tsc --noEmit` passes with a generated Prisma Client 5.22.0.

**Full offline sweep:** every non-DB test command in the workflow (270, including multi-line `run:` blocks) passes. The sweep found 1 regression: `signInResendChangeEmailJsdom` B8 needed to answer the new reconciling session read after a wrong code. It is fixed without weakening the test, and the reconciliation is now asserted.

## R5 (R3 round, historical). Authentication coordination: guarantees and limits

| Concern | Guarantee | Limit |
|---|---|---|
| Request-time account validation | Every account-scoped request is checked against the session. Wrong-account reads and writes are refused. | — |
| Server-side session revocation | Not in this PR. It is **AUTH-01**, shared with the auth files touched here (logout, verify-code, session, `middleware.ts`, `lib/edgeSession.ts`). AUTH-01 should add revocation to `getSessionFromRequest` and `readEdgeSession`, so both enforcement points follow one contract. | A copied token stays valid until `exp` (RV-1) |
| Browser cookie-response ordering | Coordinated new-bundle flows serialize sign-in after logout (CH4c). Unbound legacy logouts can no longer clear any cookie (CH4b). | An **uncoordinated** sign-in (old bundle, out-of-band) whose response lands before a bound logout's delayed response is cleared by it (CH4d). Neither request binding nor AUTH-01 resolves response ordering. |
| Already-loaded legacy clients | Their writes and reads are refused without data loss (queues kept, valid and expired). Their logout is refused without clearing. | Their UI cannot be corrected (§R6) |
| Older supported WebViews (no Web Locks) | Marker-based exclusion. Queue integrity is unaffected. | Simultaneous starts, suspended heartbeats or unavailable storage can defeat exclusion. Coordination is then recorded as unavailable and the server checks remain. Needs WKWebView acceptance. |

## R6 (R3 round, historical). Merge and activation readiness

### R6.1 Separate readiness

| | Status | Remaining |
|---|---|---|
| **Controlled merge** | Ready for independent verification | Verification, then owner approval. Merge must not activate the change automatically (A-4). |
| **Shared-web activation** | **NO-GO** | A-1…A-4 below, plus an owner decision on the rollout plan |

**Activation blockers:**
- **A-1 Old bundles degrade until reload.** After activation, every headerless account-scoped request from a page loaded earlier gets 503. Those pages show their own generic errors; the old code cannot show the reload prompt. No data is lost: old queues stay intact (CH5, D1).
- **A-2 Old-bundle sign-out is refused.** The old code ignores the result and shows a local signed-out screen while the session remains. On a shared device the user may wrongly believe they signed out, until a reload shows the real state. The new bundle cannot correct this.
- **A-3 Uncoordinated cookie ordering (CH4d).** This is bounded to old bundles and out-of-band sign-ins during the drain window.
- **A-4 Merge-to-deploy coupling** was not verified. Production git builds were last recorded as skipped by a preview-only ignore step; this must be re-confirmed.

### R6.2 Proposed activation plan (owner decision)

1. Confirm and keep Production promotion manual (A-4).
2. Deploy the merged head to a preview. Run the Chromium suite and a manual smoke test against it, with synthetic accounts.
3. Promote at a low-traffic time. Old pages fail closed with no data loss (A-1). Android: a cold start loads the new bundle, and resumed WebViews show errors until reloaded.
4. Treat a **drain window** (for example 72 h) as the exposure window for A-2 and A-3. The owner either accepts it in writing or defers activation.
5. From this release on, `client_upgrade_required` shows **Reload** in-app, so future version skews self-heal.

## 2. Sources and restrictions

**Sources:**
- the S5-A package;
- the three independent reviews above;
- current source.

**Restrictions honoured:**
- The REL-03 deferral and sealed archive were not touched.
- No merge, deployment, live database, real credentials, ADB, emulator, device, signing, packaging or Play Console activity.
- Auto-fix and Auto-merge are off.

## 3. Original REL-04 fixes

| Fix | State |
|---|---|
| F1 backup Option A (O-1) | BK-1 device check mandatory |
| F2 cookie flush | Best-effort. `CookieManager.flush()` blocks while writing the cookies visible at flush time; device acceptance D-S2/D-S6 required (IR-04). |
| F5 logout cookie attributes | Logout is now account-bound, and headerless logout is refused |
| F7 release gate | Partial; see §7 |

## 4. Authentication and session security

| Question | State |
|---|---|
| Authorization | The session cookie only. Stated accounts are constraints. |
| Wrong-account reads and writes | Refused (§R2) |
| Logout | Bound; bounded; strict acknowledgement; every non-acknowledgement reconciled; coordinated with sign-in |
| Sign-in | Coordinated; the server names the account and the client confirms it with a fresh session answer; any error reconciled |
| Revocation | AUTH-01 (public-release blocker, O-2) |

## 5. Outstanding Android findings

| Finding | State |
|---|---|
| FP-0, R-07, E-1 | Not applicable (S4 retired, O-5). Its guarantees are preserved by R2/R3 transitions, AUTH-01 and the device rows. |
| BK-1 | Mandatory on device |
| RV-1 | AUTH-01 |

## 6. Native experience

Unchanged from R2, plus:
- the reload prompt for out-of-date bundles;
- account-scoped standalone pages;
- the legacy notice with discard only.

## 7. Release configuration (IR-05, partial gate)

`verifyReleaseServerConfig` (release builds only) fails when:
- `server.url` is not HTTPS with a non-empty host;
- the host is `localhost`, ends with `.localhost` or `.local`, or matches `127.x`, `10.x`, `192.168.x` or `172.16–31.x` (these patterns only);
- cleartext is enabled;
- `errorPath` is not set;
- the WebView floor is not 91.

The release-candidate requirements stay: RC-7a…RC-7h (final origin, effective built configuration, packaged assets, explicit release version, cleartext and mixed-content policy, 16 KB alignment, debuggability, Huawei acceptance). minSdk 29 and targetSdk 36 are kept (O-7).

## 8. Validation summary

§R4; exact-head CI in the PR description.

## 9. Remaining release blockers

| # | Blocker |
|---|---|
| B-1 | In-app account deletion (O-8) |
| B-2 | Privacy policy (O-8) |
| B-3 | Final release origin (O-4) |
| B-4 | Device acceptance (§11), incl. BK-1, D-S rows and WKWebView |
| B-5 | Play setup |
| B-6 | AUTH-01 |
| B-7 | Independent verification of R3, then owner approval |
| B-8 | Activation blockers A-1…A-4 and the rollout decision (§R6) |
| B-9 | RC-7a…RC-7h |

## 10. Owner decisions

Recorded: O-1, O-2, O-3, O-5, O-6, O-7.

Open:
- O-4, O-8;
- approval to merge;
- the activation plan, including acceptance of the A-2/A-3 drain-window exposure.

## 11. Final device acceptance checklist

**Rules:**
- synthetic accounts A and B, a non-production backend, one build SHA;
- no coordinates;
- 0 FATAL / 0 ANR.

| # | Area | Steps | Pass |
|---|---|---|---|
| R1–R10 | REL-03 rows | As written | As written |
| **D-S1 (BK-1)** | Backup and transfer | `bmgr` (34/36), `adb backup` (29/30), transfer emulation | No `app_webview/` or app data; opens signed out |
| **D-S2** | Cookie persistence (best-effort) | Sign in/out → background → swipe → cold launch, 5× each; also with a delayed logout response and a mid-sign-out swipe | The expected state, or reconciled to the server state; pause-to-kill latency recorded |
| **D-S3** | Honest sign-out | Airplane mode, captive portal | Still A, or unverified with Retry; reconciliation before A's work resumes |
| **D-S4** | Pending activity at sign-out | **Control replay first:** log offline and stay offline (or block habit-logs) until the count step | |
| | (a) Cancel | Sign out → Cancel | Kept; syncs once later |
| | (b) Confirm, reachable | Sign out → OK | Exactly the confirmed logs removed; B never sees them |
| | (c) Server unavailable | Sign out → OK | Still A or unverified; kept |
| | (d) Lost acknowledgement | Proxy drops the logout response | Server state shown; logs kept for A |
| | (e) Unresolved write | Sign out while a log is sending | Counted ("may already be saved"); syncs exactly once after Cancel |
| | (f) Two windows | Sign out in one while the other logs | The other refuses during the transition, and is still suspended with the marker blocked (Web Locks devices) |
| | (g) Storage unavailable | Not device-feasible | Covered by Q2 and C7 |
| | (h) Session verification unavailable | Session endpoint blocked after sign-out | Unverified state, Retry, pending work kept |
| D-S5 / D-S6 / D-S7 | Switch, interruption, expiry | As in R2 | As in R2 |
| **D-S8** | Mixed versions (R4) | An old-build page open, deploy, open any other page of the app, then use the old page and sign out from it | Writes and reads refused without loss. The old page is reloaded by the updated service worker and shows the real session plus the "reloaded" notice. Record whether the worker took control; without it, A-2 is observed and recorded. The legacy notice shows a count only, with no removal |
| **D-S9** | Account-scoped pages (R4/R5) | Open Plan Day, Goals, Goal detail and Captures. Switch the account in another tab; also switch it *before* the page's first verification (cold start with a changed cookie) | R5: only "Checking your account…" until verification answers, then the page fetches its data for the verified account; after a switch it unmounts and refetches for the new account (no reload); no previous-account content or actions at any point; offline/unreadable-storage cases show the unavailable-queue notice on Home |
| **D-Q1** | IndexedDB queue (R4) | Log offline; kill and cold-start; log offline in two windows; sign out with an unanswered send | Entries survive restarts; each syncs exactly once; sign-out reports "already sent, may have been saved" for the unanswered one. If IndexedDB is unavailable, "not stored" is shown, never "pending" |
| **D-X1** | Bound downloads (R4) | Export Data and Download calendar; switch account mid-download | File for the tapped account only; after a switch, nothing downloaded and the message shown. Record whether the Android WebView hands a blob download to the system (the WebView `DownloadListener` path is unverified) |
| **D-W2** | Service worker in the WebView (R4) | Hosted bundle in the Capacitor WebView: check that the worker registers and controls the page, then run the D-S8 steps | Record the controller state. If no worker controls the WebView, A-1, A-2 and A-3 stay as documented for that client |
| **D-W1** | WKWebView without Web Locks (older iOS) | Two windows, simultaneous sign-out and sign-in; background one mid-transition | Exclusion holds, or the server refuses mismatched writes; record any coordination gap |
| D-L, D-U, D-N, D-R | Unchanged | — | — |

## 12. Release-candidate requirements

RC-1…RC-8 as in R2, and RC-1 now also requires the activation plan (§R6.2).

## 13. Independent verification request

**Scope:** `091e3ce..<R3 head>`.

**Questions:**
1. Is every surface and account-scoped route covered by the shared policy, and is each exemption justified?
2. Can any account-scoped request be forwarded while the account is unknown, during a transition, or after a failed verification?
3. Does any path still re-capture a binding for a delayed action?
4. Does the queue meet the full durability contract, with and without Web Locks?
5. Is legacy quarantine safe (no reassignment, exact-snapshot discard, accurate reporting)?
6. Is the sign-in error reconciliation correct?
7. Is the mixed-version behaviour as stated, and are A-1…A-4 complete?
8. Do the Chromium tests exercise what they claim?

**Not in scope:** AUTH-01, device behaviour, release preparation.

## 14. Observations

- iOS Podfile drift from a combined `cap sync` (needs an iOS ticket).
- `insightsHistoryWiring` and `plannedActivityCanonicalIdentity` fail on `main` and are not in CI.
- `useHabitLogs` and the `PastActivityModal` fallback are unused; they fail closed.
