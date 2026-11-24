# AURA-ANDROID-REL-04 — Application Release Readiness

**Date:** 2026-11-24 · **Branch:** `aura-android-rel04-app-readiness`, cut from `main` `ad49e6a` · **PR:** #392
**Revision:** R1, account isolation remediation of the independent review of `a54daf60fe562e83df96f5db90f792ce0f2341e7`.
**Mode:** code review, code fixes, offline tests, local Gradle compile/resource checks. No emulator, ADB, device, signing, packaging, Play Console, infrastructure, live database or Production action.

## 1. Verdict

**REL-04 ACCOUNT ISOLATION CORRECTED — READY FOR INDEPENDENT DELTA REVIEW.** Android release is still **NO-GO**, and the PR must not be merged before that review and owner approval.

- The independent review's material findings IR-01, IR-03 and IR-06 are corrected and covered by integrated regression tests.
- IR-04 and IR-05 are documented as directed (§R4).
- The original cross-account failure **reproduces with the reviewed head's code and is prevented on the corrected head** (§R3).
- What remains is listed in §9 and §10: owner decisions, two Google Play product features, server-side revocation (AURA-AUTH-01), release-candidate preparation and device acceptance.

Nothing in this report claims device behaviour. Every runtime claim comes from source reading, unit/jsdom/in-process integration tests, or a local Gradle task.

---

## R1. Remediation matrix (independent review of `a54daf6`)

| Finding | Requirement | Correction | Evidence |
|---|---|---|---|
| **IR-01** Account isolation | Bind queued activity to its verified account | The queue is per verified account: `offline_habit_queue_v2:<userId>`, and every entry carries `ownerUserId` (`lib/offlineHabitQueue.ts`). Entries are queued only through `submitActivityLog`, under the lease's verified account. | S1, S5, S7; R1 |
| | Require verified identity before replay | `replayOfflineQueue` runs only with a verified account (the latest `GET /api/auth/session` answer that was still current) and reads only that account's key. | S1, S7, S8 |
| | Enforce expected account at the server write boundary; never authorize from it | `lib/expectedAccount.ts`. `POST /api/habit-logs` **requires** `X-Aura-Expected-Account` equal to the session user: 409 on mismatch, 428 if absent. It is checked right after the session check, before any database read or write. `POST /api/plans` enforces it when present (the `/find` sign-in-then-save flow sends it). Authorization still comes only from the signed session cookie; the header alone never authorizes (a request with no session gets 401). | SB1–SB5, S4; R1, R3 |
| | Reject mismatched writes without persisting | 409 before any db call (asserted: zero db calls, zero rows). | SB1, SB5, S4, R3 |
| | Legacy unowned entries | The pre-REL-04 key is **quarantined**: never replayed, never shown as the current account's pending work. It is removed only by an explicit, confirmed discard in the sign-out question, after an acknowledged logout. Ownership is never inferred. | S6 |
| | Concurrent replay / enqueue | Replay is single-flight per tab and per account, plus a Web Lock across tabs where available. Mutations are synchronous read-modify-writes of the latest value. Replay removes only the ids it settled; it never writes back a snapshot. | S5 |
| | Stop old-account work during transitions | Every activity operation runs under an `AccountLease` (`lib/accountSession.ts`). A transition or account change aborts in-flight operations and refuses new ones. | S2, S8, S15 |
| | Stale completions | Completions check `lease.isCurrent()`. A stale completion cannot queue, cannot restore a cleared queue (removal-only) and cannot update the next account's screen. | S2, S2b, S14, S15 |
| | Clear/partition dashboard state and caches | Home is keyed on the **account epoch**: any account change remounts the dashboard, so all component state, refs and in-component caches start empty. Late responses land on the unmounted instance. Account-scoped localStorage (briefing view state) was already keyed by user id; the queue is now too. | H2–H6 |
| | Account change, session expiry, multiple tabs | Session answers update the verified account; a change bumps the epoch. A cross-tab marker announces `signing-out`, `signed-out` and `account-verified` (with the account). The session is re-verified when the page returns to the foreground (Capacitor resume fires `visibilitychange`). | S7, S8, H5, H6 |
| **IR-03** Sign-out transition | Prevent concurrent sign-out | Single flight: a concurrent call gets the same promise; one question, one logout request. | S13 |
| | Exact acknowledgement; reject redirects and malformed answers | `redirect: 'error'`, `cache: 'no-store'`. Accepted only if: 200, not redirected, `application/json`, and `{ loggedOut: true }`. Anything else (204, string `"true"`, HTML, redirected, malformed) is ambiguous. | unit test 14/0; S11 |
| | Suspend submission and replay | `beginTransition()` refuses new writes and replays, aborts running ones, and suspends other tabs. | S2, S8, F3 |
| | Confirmation reflects actual pending work | Sign-out waits (bounded at 8 s) until no activity write is in flight, then counts. An aborted write is neither stored nor queued, so it is not counted. A write that will not settle → `busy`, still signed in. | S2, S15, S16 |
| | Preserve pending work on cancel/failure | Cancel, HTTP failure, offline, unexpected answer → `resumed`; the account's queue is untouched. | S6, S10, S11 |
| | Discard only the right account's work after confirmation + acknowledgement | Only the signed-out account's key, and the legacy key only if it was part of the confirmed question. Only after the exact acknowledgement. | S1, S6 |
| | Reconcile ambiguous outcomes | Ambiguous outcomes check `GET /api/auth/session` before anything resumes:<br>• same account → resume (`failed`);<br>• signed out → signed out but the queue is **kept** for its owner (`signed-out-unconfirmed`);<br>• another account → switch;<br>• unknown → nothing authenticated until re-verified. | S12, unit test |
| | Failing storage | Unreadable storage → the question says it couldn't check, and is asked anyway. Enqueue write failure → `not-stored`, and Home tells the user. Removal failure after acknowledgement → signed out; the undeletable entries stay partitioned under their owner and are never replayed by another account. | S9 |
| | Stale session/dashboard responses | `fetchVerifiedSession` discards any answer whose epoch changed or that arrived during a transition. Dashboard remount (above). | S14, H4 |
| | Same behaviour on Home and `/find` | `/find` uses the same `fetchVerifiedSession`, re-verifies on any account change and on foreground, and saves through `runActivityOperation` with the expected-account header. | F1–F3 |
| **IR-06** Location search | Hide outdated results immediately | Results and error are stored with the query they belong to; anything for another query is hidden on the very render the query changes. | R5 |
| | Abort obsolete requests; invalidate on unmount | One `AbortController` per query. The effect cleanup (next query or unmount) clears the debounce, aborts and retires the sequence id. | R6, R7 |
| | No stale errors/results/loading; keep debounce | Only the latest, unaborted request updates state; 400 ms debounce unchanged. | R1–R4, R8 |
| **IR-04** (deferred) Cookie flush | Document as best-effort | `MainActivity` comment and §3 F2 now say best-effort, not durability. Device rows D-S2 and D-S6 keep the delayed-response, interrupted-transition, cold-launch and pause-latency checks. | — |
| **IR-05** (deferred) Release gate | Describe as partial | §7 rewritten: the gate is **partial**. Release-candidate prerequisites RC-7a…RC-7e preserved. | — |

**Out of this PR, as directed:** server-side session revocation (AURA-AUTH-01).

## R2. Design summary (small, shared by web, Android and iOS)

```
lib/accountSession.ts  verified account · epoch · single-flight transition (+ cross-tab marker)
                       · tracked/abortable activity operations · foreground re-verification
lib/activitySync.ts    submitActivityLog / replayOfflineQueue (expected-account header, per-account queue)
lib/offlineHabitQueue  per-account keys, removal by id, legacy quarantine
lib/signOut.ts         the transition: settle → count → confirm → exact ack → discard | reconcile
lib/expectedAccount.ts server: header vs session (409/428) before any read/write
app/page.tsx           <DashboardPageInner key={epoch}/>; loads, replay and writes through the above
app/find/...           same session check, account-change listener, bound save
```

The native shells load this same web bundle, so Android and iOS get the boundary unchanged. No native code changed for IR-01/IR-03.

## R3. Original defect: reproduction and corrected result

`test/rel04ReviewedHeadReproduction.test.ts` runs the **reviewed head's own code** against the same in-process server and cookie-at-send semantics. The code is vendored verbatim in `test/fixtures/rel04-reviewed-head/`:
- the habit-logs route;
- `lib/signOut.ts`;
- the `page.tsx` enqueue and `syncOfflineLogs` blocks.

The fixtures are re-checked byte for byte against `a54daf6` when that commit is present.

| Scenario | Reviewed head `a54daf6` | Corrected head |
|---|---|---|
| R1 A queues offline; A's session ends without an ordinary logout; B signs in on the device | **Reproduced:** A's 2 queued activities are stored under **B** | B's replay sends nothing; 0 rows under B. An out-of-date client replaying under B is refused (428). |
| R2 A's replay is running when sign-out starts; B signs in | **Reproduced:** sign-out does not stop the replay; A's items 2 and 3 are stored under **B** | The replay is aborted by the transition; 0 rows under B (and none under A) |
| R3 A stale tab's write meant for A arrives with B's session | **Reproduced:** accepted under B | 409, nothing stored |

Result: 12/0 (4 provenance checks, 3 reproductions, 5 corrected-head checks).

## R4. Integrated regression evidence

| Suite | Covers | Result |
|---|---|---|
| `test/rel04AccountIsolation.test.ts` | **Server boundary:** SB1–SB5<br>**Scenarios:**<br>S1 A queues → sign-out → B<br>S2 replay during logout<br>S2b in-flight replay across a switch<br>S3 direct write after logout<br>S4 A identity + B session<br>S5 concurrent replay/enqueue<br>S6 legacy entries<br>S7 expiry and switch without logout<br>S8 multiple tabs<br>S9 storage read, write and remove failures<br>S10 offline / HTTP failure + retry<br>S11 HTML 200, redirect, malformed acknowledgement + retry<br>S12 lost acknowledgement<br>S13 concurrent logout<br>S14 late session answer<br>S15 in-flight write at sign-out<br>S16 unsettled write → busy | **61/0** |
| `test/rel04HomeFindTransitionJsdom.test.ts` | The **real Home page and `/find`** mounted: H1–H4 sign-out → B with late session and dashboard responses (no A on screen; every post-switch dashboard request carries B's session); H5 session expiry noticed on foreground; H6 another tab's account switch; F1–F3 `/find` boundary, guest after sign-out, refusal during another tab's sign-out | **13/0** |
| `test/rel04ReviewedHeadReproduction.test.ts` | §R3 | **12/0** |
| `test/signOutRel04.test.ts` | Acknowledgement matrix (204, string `"true"`, HTML, redirected, malformed, 503, lost answer to signed-out and to B), wording | **14/0** |
| `test/locationPickerRel04SearchRace.test.ts` | R1–R4 races; R5 immediate hide; R6 abort; R7 unmount teardown; R8 debounce | **14/0**. The reviewed head's `LocationPicker` fails R5, R6 and R7. |
| `test/rel04Rv1TokenReplay.test.ts` | RV-1 residual (unchanged) | **8/0** |
| `test/androidRel04AppReadiness.test.mjs` | Backup/transfer, flush, release gate, logout attributes | **48/0** |

**Synthetic only:** in-process route handlers over an in-memory db stub. Unexpected db calls are recorded and fail the test. There is no database, no network, no real credential, and no device.

**Updated existing suites (design change, not weakened):**
- `pendingActivityReloadVisibility`: reads the per-account key.
- `pendingReplayReconciliation`: replay and classification asserted in `lib/activitySync.ts`.
- `locationPickerSmartSelection`: unchanged assertion, now satisfied.

**Pre-existing failures on `main`, untouched and not in CI:** `insightsHistoryWiring` and `plannedActivityCanonicalIdentity`. Both fail identically on a clean `origin/main` export.

**Full offline sweep of the CI test commands (local, no database):**
- 341 commands were run: every `node test/...` and `npx ts-node ... test/...` line in `.github/workflows/ci.yml`, including those inside multi-line `run: |` blocks.
- All pass except **78 `*Db.test.ts` suites**. Each of those stops at its database precondition (no `DATABASE_URL`, `InitPostgres` connection refused, or "refusing: local disposable database only"). CI's DB jobs run them.
- The sweep found 2 regressions, both fixed and re-run:
  - an outdated structural assertion in `pendingActivityVisualConsistency`;
  - a duplicate `/find` session request (its account listener now reacts only to an epoch change), caught by `disc01GuestActivityDiscoveryJsdom`.

Exact-head CI: see §R6.

## R5. Owner decision dispositions (recorded 2026-11-24)

| # | Direction | Effect on this PR |
|---|---|---|
| **O-1** | Backup **Option A selected**. BK-1 device verification stays mandatory. | Implemented (F1); D-S1 mandatory |
| **O-2** | The up-to-30-day copied-session residual is **unacceptable for public release**. Per-session revocation is preferred. | RV-1 residual is a **public-release blocker** (B-6). Revocation is AURA-AUTH-01, not this PR. |
| **O-3** | Explicit discard of **account-owned** unsynced activity is permitted after confirmed logout. | Implemented: discard only after confirmation **and** exact acknowledgement; otherwise kept |
| **O-4** | Final release origin | Separate work (unchanged) |
| **O-5** | **Retire S4** as a release dependency for this lineage. Preserve its guarantees through shared account transitions, server revocation and device acceptance. | FP-0, R-07 and E-1 closed as not applicable. Guarantees now come from IR-01/IR-03 (here), AURA-AUTH-01, and D-S rows. |
| **O-6** | Keep fresh-location behaviour; no caching | No `maximumAge`; unchanged |
| **O-7** | Preserve minSdk 29 / targetSdk 36 | Unchanged; enforced by static tests |
| **O-8** | Privacy policy / account deletion | Separate work (unchanged) |

## R6. Exact corrected head and CI

The exact head SHA and its CI results are recorded in the PR #392 description and its remediation comment once CI completes on that head. This file cannot contain its own commit hash.

---

## 2. Sources and restrictions

**Sources read.** The original S5-A package (read only), sealed at `~/Desktop/Claude/AuraEvidence/AURA_ANDROID_REL_02_S5_A_TEST_PLAN_CORRECTIONS_AND_SESSION_SAFETY/`:

| File | sha256 (first 8) |
|---|---|
| `S5A_FINDINGS_REGISTER.md` | `f0757999` |
| `S5A_ANDROID_BACKUP_DECISION.md` | `bc0ec57d` |
| `S5A_SERVER_REVOCATION_DECISION.md` | `8efcf449` |
| `S5A_R07_E1_RELEASE_CLASSIFICATION.md` | `673c0070` |
| `S5A_SR02_FRESH_PROCESS_TEST.md` | `5e9d755d` |

Also read: the REL-03 supervised plan R1 §5, the REL-03 functional readiness report and checklist (`docs/android/`), the independent review of `a54daf6` (findings as stated in the remediation ticket), and the current source.

**Restrictions honoured:**
- The REL-03 deferral and sealed archive were not touched; P-1 and SAS-0 were not started.
- No emulator, ADB or device; no host configuration change; no credential or signing operation; no APK/AAB packaging (so the debug keystore was never used).
- No Play Console, infrastructure, live database or Production change.
- No merge. Auto-fix and Auto-merge stay off.

## 3. Fixes (original REL-04 set, as amended by R1)

| ID | Defect | Fix | Status after R1 |
|---|---|---|---|
| **F1 (S5A-F2 / BK-1)** | Backup and device transfer carried the WebView profile, including the session cookie | S5-A Option A: `allowBackup="false"`, `fullBackupContent="false"`, `data_extraction_rules.xml` excluding all 9 domains for cloud backup and device transfer | Unchanged; owner selected Option A (O-1) |
| **F2** | Cookie changes reach disk lazily | `MainActivity.onPause()` → `CookieManager.flush()`. **Best-effort persistence, not a durability guarantee** (IR-04): asynchronous on some WebView versions; kills before or during `onPause` and responses arriving after it are not covered. Session safety rests on the server boundary and the transition, not on this. | Wording corrected |
| **F3** | Sign-out reported success it did not get | Replaced by the IR-03 transition (§R1) | **Superseded** |
| **F4** | Offline queue replayed under the next account | Replaced by the IR-01 per-account queue and server boundary (§R1) | **Superseded** |
| **F5** | Logout cookie removal attributes | `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/`, `Max-Age=0`, `Cache-Control: no-store` | Unchanged |
| **F6** | Search race | Completed by IR-06 (§R1) | **Completed** |
| **F7** | Release-build guard | `verifyReleaseServerConfig` + validated versioning: a **partial** gate (§7) | Wording corrected |

## 4. Authentication and session security

| Question | Finding |
|---|---|
| Issuance | `verify-code` → HMAC-signed `{userId, email, exp: +30 d}` cookie `as_session` (HttpOnly, SameSite=Lax, Secure in production). |
| Server state / revocation | **None** (S5A-F3). A token copied before logout stays valid until `exp` (RV-1, executed in-process). **Unacceptable for public release** (O-2); scheduled as AURA-AUTH-01. |
| Logout | The IR-03 transition with exact acknowledgement; the cookie is removed with its issuing attributes. |
| Writes under the wrong account | **Closed at the server**. Activity writes require the expected account; mismatch → 409 before any read/write. Plans saves enforce it when stated. |
| Account switching / expiry / tabs | Epoch-based isolation on the client; server boundary as the guarantee. |
| Backup / device transfer | Closed (F1); device verification D-S1 mandatory. |

## 5. Outstanding Android findings: disposition

| ID | Status |
|---|---|
| **FP-0 / S5A-F1, R-07, E-1** | **Closed as not applicable.** They target the S4/S4.1 guard, which is not on `main`. The owner retired S4 as a release dependency (O-5). |
| **BK-1** | Option A implemented; **device verification mandatory** (D-S1). |
| **RV-1** | Executed in-process: residual confirmed; **public-release blocker** (O-2 → AURA-AUTH-01). |
| **S5A-F4** | Infrastructure item, recorded (nginx query-string logging). |
| **REL-03 A5 device-only risks** | Unchanged; device rows D-L*, D-U*. |

## 6. Native application experience: review

Unchanged from the original review, except as amended in R1:
- authentication persistence and sign-out (IR-03);
- offline replay (IR-01);
- location search (IR-06);
- the cookie flush, now described as best-effort (IR-04).

| Area | State |
|---|---|
| Geolocation | Coarse only; fresh fix (no `maximumAge`, O-6) |
| Permission flows | No new defect |
| Timeout / retry | No new defect |
| Back button | `OnBackPressedCallback` everywhere; predictive-back compatible |
| Lifecycle / resume | Session re-verified on foreground (R1) |
| Offline | Connection page; account-bound queue (R1) |
| Safe area | Unchanged |

## 7. Release configuration

The **release gate is partial** (IR-05). `verifyReleaseServerConfig` runs before release builds and rejects the following, using the generated `capacitor.config.json`:
- a non-HTTPS or local/private `server.url`;
- cleartext;
- a missing `errorPath`;
- a WebView floor other than 91.

It does **not** prove:
- that the URL is the **final release origin** (O-4);
- the **effective** configuration inside the packaged artefact;
- that the **merged assets** in the AAB match the synced config;
- that an **explicit release version** was supplied (defaults 1 / "1.0" still build);
- the WebView policy on devices without Google WebView, such as **Huawei/HMS** devices.

These stay release-candidate prerequisites RC-7a…RC-7e (§12).

| Item | State |
|---|---|
| minSdk / target / compile | 29 / 36 / 36 (O-7) |
| Toolchain | AGP 8.10.1, Gradle 8.11.1, JDK 17 |
| Capacitor | 6.2.1; not officially validated at target 36 (device rows D-U*) |
| Manifest | INTERNET + ACCESS_COARSE_LOCATION; backup/transfer off; no cleartext |
| Release build type | `minifyEnabled false`; no signing config (owner action) |
| Versioning | `-PauraVersionCode` / `-PauraVersionName` (validated) |

## 8. Validation results

See §R4 for the REL-04 suites and §R6 for exact-head CI. Existing Android/location suites were re-run on this branch and all pass:
- minimum support 74/0;
- COMPAT-03 21/0, 15/0, 24/0;
- COMPAT-05 160/0;
- M2-D 63/0;
- timeout diagnostics 14/0;
- StrictMode 19/0;
- REL-03 supersede 14/0;
- IOS-02 35/0;
- reverse-geocode POST 19/0;
- smart selection, native geolocation, location search API, back navigation and clientId: all PASS.

`tsc --noEmit` (`apps/web`) is clean. Gradle compile and resource checks are as in the original report.

**Not run:** DB-backed suites against a real database; anything needing an emulator, ADB, a device, signing, secrets, the network or Production; packaging.

## 9. Remaining release blockers

| # | Blocker | Needs |
|---|---|---|
| B-1 | In-app account deletion (Google Play) | O-8 product work |
| B-2 | Privacy policy page (Google Play) | O-8 content + approval |
| B-3 | Final release origin `CAP_SERVER_URL` | O-4 |
| B-4 | Device acceptance (§11), including BK-1 and the D-S rows | Supervised run |
| B-5 | Upload key, Play App Signing, Play Console | Owner (RC-4…RC-6) |
| **B-6** | **Server-side per-session revocation** (RV-1 residual unacceptable for public release, O-2) | AURA-AUTH-01 |
| B-7 | Independent delta review of this remediation, then owner approval to merge | Codex delta review (§13) |
| B-8 | Release-gate completion (RC-7a…RC-7e) | RC preparation |

## 10. Owner decisions

All directions recorded in §R5. Still open:
- O-4 (final release origin);
- O-8 (privacy policy and account deletion scope);
- approval to merge after the delta review.

## 11. Consolidated final device acceptance checklist

**Rules:**
- one build SHA, disposable synthetic accounts A and B, a non-production backend;
- no coordinates recorded;
- 0 FATAL / 0 ANR; no spinner over 31 s.

**Device coverage:** API 29 or 30, API 34, and API 36 (P = physical preferred).

| # | Area | Steps | Pass |
|---|---|---|---|
| R1–R10 | REL-03 rows 1–10 | As in `AURA_ANDROID_REL_03_DEVICE_ACCEPTANCE_CHECKLIST.md` | As written there |
| **D-S1 (BK-1, mandatory)** | Backup and transfer | Signed in on the debug RC: `bmgr backupnow` with a local transport (API 34/36), `adb backup` (API 29/30), device-transfer emulation where available; list each archive | No `app_webview/` and no app data in any archive; after restore or transfer the app opens **signed out** |
| **D-S2** | Cookie persistence (best-effort) across process death | (a) Sign in → background within 3 s → swipe from Recents → cold launch. (b) Sign out → same. 5× each. Repeat with the logout **response delayed** (slow network, so the answer lands after backgrounding) and with the swipe **during** the sign-out. | (a) signed in; (b) signed out, or, where the acknowledgement never arrived, the app reconciles to the server's real state at cold launch and never shows a "signed out" screen while the server still has A. Record every deviation, with the pause-to-kill latency. |
| **D-S3** | Honest sign-out | Airplane mode → Sign out; then a captive-portal Wi-Fi (HTML 200) if available | "Couldn't sign out…"; still A; online retry signs out |
| **D-S4** | Pending activity at sign-out (updated) | Offline, log 2 activities as A. Then each of: | |
| | (a) Cancel | Sign out → question names 2 logs → **Cancel** | Still A; both logs pending; they sync later as A |
| | (b) Confirm, online | Sign out → **OK** | Signed out; logs removed; sign in as B → B never shows or receives A's logs |
| | (c) Logout fails | Server down or airplane → Sign out → OK | "Couldn't sign out…"; still A; both logs kept and sync as A when online |
| | (d) Lost acknowledgement | Drop the connection right after the request is sent (proxy) | After reconnect, the app shows the server's real state; if signed out, A's logs are **kept** (not discarded) and never appear for B |
| | (e) Replay running | Online with a slow network, open the app (replay starts) → Sign out immediately | Question counts the logs still pending; after B signs in, no A log appears in B's history |
| | (f) Storage unavailable | Not device-feasible; covered by S9 | — |
| **D-S5** | Account switch | Sign out A → sign in B → cold launch; then background and foreground the app | B shown; A never reappears; no A data on any tab |
| **D-S6** | Interrupted transition / pause latency | Start sign-out, press Home mid-request; return after 10 s; cold launch | Either fully signed out or fully A; never a mix; no stuck spinner |
| **D-S7** | Session expiry | Synthetic account with a short-lived token (test backend), wait past expiry, foreground the app | Signed-out screen; no A data |
| **D-L1…L6** | Location | API 29–30 acquisition; permission flows; spinner lifecycle; search on a throttled network ("Ko" → "Kollam": no "Ko" row is selectable) | As in REL-03; IR-06 behaviour |
| **D-U1…U4** | Edge-to-edge, keyboard, predictive back, large screens | — | As in the original checklist |
| **D-N1/N2** | Connection page; WebView floor | — | As in the original checklist |
| **D-R1 (P)/R2** | Release build from internal track; pre-launch report | — | As in the original checklist |

## 12. Release-candidate preparation requirements

| # | Item |
|---|---|
| RC-1 | Delta review (B-7) → owner approval → merge |
| RC-2 | Resolve B-1, B-2, B-3, B-6 |
| RC-3 | RC commit; debug RC for device acceptance (§11) |
| RC-4…RC-6 | Play account (closed-test rule), Play App Signing + upload key, listing, Data safety, privacy URL, testers |
| **RC-7a** | Validate the **final release origin** (O-4) in the synced config |
| **RC-7b** | Inspect the **effective configuration** in the built AAB (`capacitor.config.json` in assets) |
| **RC-7c** | Verify **merged assets** (connection and WebView-floor pages, plugin config) in the AAB |
| **RC-7d** | Supply an **explicit release version** (`auraVersionCode` > every prior upload; `auraVersionName`); do not ship defaults |
| **RC-7e** | Decide the **Huawei/no-Google-WebView policy** (WebView floor behaviour on HMS devices; distribute or exclude) |
| RC-7f | 16 KB alignment, not debuggable (`bundletool` / APK Analyzer) |
| RC-8 | Internal testing upload; D-R1, D-R2 |

## 13. Independent delta review request

A focused **Codex** delta review is requested, from a model outside the implementing lineage.

**Scope:** `a54daf6..<corrected head>` (see §R6).

**Questions:**
1. Can any activity write be stored under an account other than the one the user saw, including:
   - requests already on the wire;
   - replays;
   - other tabs;
   - session expiry;
   - lost logout acknowledgements?
2. Is the server check (`lib/expectedAccount.ts`) placed before every read and write in both routes, and does the header ever authorize?
3. Can a stale completion restore a cleared queue or previous-account data on Home or `/find`?
4. Are legacy entries ever replayed or attributed?
5. Is every ambiguous logout outcome reconciled before authenticated work resumes?
6. Are the IR-06 search guarantees complete?
7. Do the tests exercise real client transitions and the real route handlers, as claimed?

**Not in scope:** server-side revocation (AURA-AUTH-01), device behaviour, release preparation.

## 14. Observations (outside scope)

- **Out-of-date clients:** a page loaded before this change, still open after deploy, gets 428 on activity writes. Its own replay treats 4xx as permanent and drops that entry, which is safe but loses the entry; the user sees a failed log. Reloading picks up the new client.
- **`useHabitLogs` and the `PastActivityModal` fallback:** both are unused by the app. They post without the header and so fail closed (428).
- **iOS Podfile drift** from a combined `cap sync` (reverted; needs an iOS ticket).
- **`insightsHistoryWiring` / `plannedActivityCanonicalIdentity`:** these fail on `main` (not in CI).
