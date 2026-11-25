# AURA-ANDROID-REL-04 — Application Release Readiness

**Date:** 2026-11-25 · **PR:** #392 · **Branch:** `aura-android-rel04-app-readiness`, cut from `main` `ad49e6a`

**Revision history**

| Revision | Head | What it did |
|---|---|---|
| Original | `a54daf6` | Initial application-readiness PR |
| R1 | `d09449b` | Remediated the first independent review |
| **R2 (this document)** | see §R7 | Remediates the **independent delta review of `d09449b`** (`~/Documents/ChatGPT/Product Onboarding/AURA_ANDROID_REL_04_DELTA_INDEPENDENT_REVIEW_REPORT.md`, sha256 `11becd10ac19c304…`) |

**Mode:** code, offline tests, a local Gradle compile and an isolated generated-Prisma-client type check. **Not done:** emulator, ADB, device, signing, packaging, Play Console, infrastructure, live database or Production action.

## 1. Verdict

**ALL REMAINING REL-04 FINDINGS CORRECTED — READY FOR FOCUSED INDEPENDENT VERIFICATION.**

- IR-01, IR-03 and IR-06 are **corrected but not CLOSED**. Closure requires the focused Codex verification.
- Android release and REL-03 acceptance stay on **HOLD**.
- AURA-AUTH-01 (server-side per-session revocation) remains a separate workstream and a public-release blocker.
- **No merge without owner approval.** Merging also must not automatically activate this change before the owner confirms the deployment plan (§R5).

Nothing here claims device or real multi-process browser behaviour:
- interleavings are **deterministic simulations** in one Node process;
- mounted tests use jsdom.

---

## R1. Delta-review findings and corrections

### IR-01 Account-bound writes

| Delta finding | Correction | Evidence |
|---|---|---|
| Ordinary `POST /api/plans` accepted unbound plan creation | Plan creation now **requires** `X-Aura-Expected-Account`:<br>• missing → 503 `client_upgrade_required` (§R5), decided before authentication;<br>• another account's session → 409;<br>• both refusals happen before any read or write.<br>The session stays the only authorization. | SB5 (real route, zero db calls); D2 reproduces R1 acceptance |
| Binding taken at dispatch, not at the user's action | `captureAccountBinding()` is called when the user acts and travels with the action: `saveUpcomingPlanFromCandidate({ binding })` and `boundFetch(binding, …)`. A binding that is no longer current is refused before sending, and the request states the bound account. | P1, P2 |
| Callers: Home (quick plan + overlap override), Forward Planner, Muhurtham Finder, My Day Story, Day Builder, PlanWithAura, Ask Aura (both branches), `/find` | All bind at the tap.<br>• **CHECK-then-save flows** (Home, Forward Planner, Ask Aura forward plan) bind **before** the CHECK request.<br>• **PlanWithAura's own save and Ask Aura PLAN_THIS** now use `boundFetch`.<br>• **Overlap overrides** (Home, Day Builder) store the original binding in their pending options and re-send with it. `PlanOverlapSaveError` carries the binding. | P3, P4 |
| Delayed confirmations, overrides and retries lose the binding | Same mechanism: the binding is reused verbatim. A recognized account switch → the client refuses. An unrecognized switch → the server refuses (409) and the tab re-verifies. | P2, P4, P5 |
| Existing plan/activity mutations bypass transition suspension and settling | `installAccountBoundFetch()` wraps `window.fetch` once (Home and `/find`). Every same-origin account-scoped **mutation**:<br>• states the account;<br>• is refused during an auth transition (this tab or another);<br>• is tracked, so sign-out aborts it and waits for it to settle.<br>Auth, guest, telemetry, location lookup, health/internal and MCP endpoints are untouched. | P7–P9 |
| Account-sensitive **reads** after an unrecognized cookie change | Reads also state the account. `middleware.ts` (edge, Web Crypto HMAC check of `as_session`) refuses any `/api` request whose stated account differs from the session: 409 `account_mismatch`. The wrapper then invalidates the account and the UI re-verifies. It never authorizes anything. | SB8, P10 |
| `/find`: verification not correlated with the account the save binds to; competing sign-in can rebind | `verify-code` now returns `userId`. `verifySignInCode` runs under the auth lock and requires a **fresh, strictly parsed** session answer for that same id; otherwise UNCONFIRMED. The save binds to the verified account and checks `binding.account === userId`. | F4, F4b (mounted) |
| `/find`: no signal to the save request; stale completion shown; account-sensitive state kept | • The save uses `boundFetch`, so the lease's abort reaches the real request.<br>• A `flowGen` check rejects completions for a retired flow.<br>• An account change elsewhere resets phase, guest token, code step and error.<br>• This page's own sign-in is excluded from that reset. | F5 (mounted) |
| Day Constructor acceptance, guest discovery | Unchanged:<br>• Day Constructor keeps its own token check (the wrapper only adds the stated account);<br>• guest `/api/guest/*` routes are not bound;<br>• `disc01` passes. | existing suites |

### Queue atomicity

| Delta finding | Correction | Evidence |
|---|---|---|
| Cross-tab read-modify-write of one array: lost appends, resurrected entries, discard removing later work | **One storage key per entry:** `aura_q3:<owner>:<clientRequestId>`.<br>• enqueue = one `setItem`<br>• settle/remove = one `removeItem`<br>• snapshot = the keys present<br>• discard = remove exactly the snapshot's keys (each verified)<br>No shared array is ever rewritten. | C5a–C5d; D4 reproduces the R1 loss |
| No safe path without Web Locks | Data integrity does not depend on locks: every mutation is a single atomic storage operation. Web Locks only de-duplicate replays. Without them, concurrent replays may send an entry twice, and the server de-duplicates by `clientRequestId`. | C6 (`locks.enabled = false`) |
| Unresolved direct writes lost on abort | **Outbox:** a direct write is stored in its account's queue **before** it is sent, under its `clientRequestId`.<br>• A definitive answer removes it.<br>• An abort, a lost answer, or an account change mid-flight keeps it; it is replayed later with the **same id**.<br>Aborting is never treated as proof that no commit happened. | C3 (server committed or not: exactly one row) |
| Discard reported as successful when removal failed | Each removal is verified. A confirmed discard that could not remove N entries returns `discardFailed: N`, and Home tells the user the entries will only sync if they sign in to the same account again. | C7c, C7d |

### IR-03 Account transitions and logout

| Delta finding | Correction | Evidence |
|---|---|---|
| Concurrent same-epoch session answers; late old answer accepted | Every account change (including the first verification) advances `gen`. An answer applies only if it belongs to the **newest** session request and `gen` is unchanged. A caller whose answer went stale follows the newest answer, or re-checks at most twice; it is never stuck. | C12a; D5 reproduces the R1 acceptance |
| Stale answer after invalidation or cancellation | Cross-tab news and transition begin/end advance `gen` and abort in-flight session reads. | C12b, C12c |
| Cross-tab transition ownership; one overwritten marker slot | Sign-in and sign-out run under **one auth lock** (`withAuthLock`: Web Locks `aura-auth-transition`).<br>• **Without Web Locks:** a refusal while another tab's **fresh, heart-beaten** marker exists (TTL 15 s, heartbeat 4 s).<br>• **Separate keys** for the transition marker (`aura_auth_transition_v2`, with `tx` id) and account announcements (`aura_account_announce_v2`). | C10 (both modes) |
| Concurrent sign-in and sign-out | Sign-in while a logout is pending (any tab) → BUSY, no verify-code sent. A concurrent logout in another tab → busy, one logout request. | C10 |
| Cookie-response ordering | **Server side:** logout is account-bound; a logout carrying another account's session gets 409 and the cookie is untouched.<br>**Client side:** coordinated flows serialize sign-in after logout (lock).<br>**Limitation:** see §R6. | C11, SB6; D3 reproduces the R1 clear |
| Indefinitely pending logout / acknowledgement / reconciliation | Every stage is bounded (request plus body: 10 s; reconciliation: 10 s; verify-code: 15 s) with real aborts. | C8a–C8c |
| HTTP failure restored A without verification | **Every** non-acknowledgement is ambiguous, including any 4xx/5xx. It is reconciled with a fresh, strictly parsed session answer.<br>• same account → `failed` (resumed only on that answer);<br>• signed out → `signed-out-unconfirmed`, queue kept;<br>• another account → switch;<br>• unavailable → `unverified`: bound work refused, queue kept, Home shows **Retry**. | C9a–C9c, C8c, C8d |
| Acknowledgement MIME was a substring match | `isJsonMediaType`: the media type itself must be `application/json` (parameters allowed), and the body must be an object with `loggedOut === true`. The session answer is also strict: `{ user: null \| { id: non-empty string } }`. | signOutRel04 (19/0), C9c |

### Other findings

| Finding | Correction | Evidence |
|---|---|---|
| **Deployment compatibility**: old clients lost 3 entries on 428 (and on 401 when expired) | §R5 | D1 (actual pre-REL-04 client against both routes) |
| **IR-06**: repeated query text revived a retired, selectable row | Results, error and loading are stamped with an **input generation** that advances in the same render as each edit; only the current generation displays. | R9, R10 (R1 component fails R9 ×2) |
| **IR-04** wording | Corrected (§3 F2, `MainActivity` comment): `CookieManager.flush()` **blocks** and persists the cookies visible at flush time; best-effort. The unsupported "asynchronous on some WebViews" claim is removed. | — |
| **IR-05** wording | Corrected (§7): the actual host filters are listed; RC requirements expanded. | — |
| **D-S4** | Rewritten (§11): automatic replay is controlled before counting; multi-tab, unresolved-write, storage-failure and unavailable-verification cases added. | — |

## R2. Account-transition invariants

| # | Invariant |
|---|---|
| **I1** | The verified account is set only from the newest session answer, arriving with `gen` unchanged (no account change, transition or cross-tab event in between). |
| **I2** | `epoch` changes on every change between known accounts or invalidation. Home is keyed on it, so no account-scoped UI state survives. |
| **I3** | Bound work runs only with a verified account, outside any transition, bound to the account of the user's action. It is aborted on change. Aborting never proves that nothing was committed. |
| **I4** | The server is the guarantee: bound writes require the stated account and refuse a mismatch before any read or write. Reads with a stated account are refused on mismatch (middleware). The session is the sole authority. |
| **I5** | Sign-in and sign-out are one auth transition per browser (lock; marker fallback). |
| **I6** | Unverifiable state = unverified: writes refused, pending work kept, Retry offered. Never shown as signed out, never trusted as the old account. |

## R3. Queue synchronization and fallback

| Topic | Behaviour |
|---|---|
| Layout | `aura_q3:<ownerUserId>:<clientRequestId>` → entry JSON (with `ownerUserId`, `queuedAt`) |
| Mutations | All single-key `setItem`/`removeItem`, so they are atomic per entry in every supported environment. There is no read-modify-write. |
| Replay | One flight per tab and account. A Web Lock (`aura-habit-replay:<owner>`) keeps tabs from replaying the same account at once. It skips entries this tab is still sending, stops when the binding stops being current, and removes only settled entries. |
| Without Web Locks | Integrity is unchanged. Duplicate replays are possible and harmless (server idempotency by `clientRequestId`). Auth transitions fall back to the heart-beaten marker. |
| Discard | Removes exactly the confirmed snapshot. Later entries survive. Each removal is verified, and failures are reported. |
| Legacy (`offline_habit_queue`, unowned) | Quarantined: never replayed or assigned. Home shows a notice offering two explicit choices:<br>• **Add to <account>**, with a confirmation naming the account; the original ids are kept, so the server de-duplicates;<br>• **Discard**. |
| R1 interim format (`offline_habit_queue_v2:<owner>`, never released) | Migrated entry by entry on first read. |

## R4. Original-defect reproductions

**`a54daf6` (first review)** — `rel04ReviewedHeadReproduction`: 12/0 locally; 8/0 in CI, where the 4 provenance checks skip on the shallow clone.
- Reproduced on `a54daf6`: R1 (expiry or switch → A's logs under B), R2 (replay spanning logout), R3 (A-expected write under B).
- All three are prevented on the corrected head.

**`d09449b` (delta review)** — `rel04R1HeadReproduction`: 21/0 locally; 14/0 in CI (7 provenance checks skip). Code is vendored verbatim from `d09449b` and byte-checked locally.

| # | Scenario | `d09449b` | Corrected |
|---|---|---|---|
| D1 | Pre-REL-04 client replays 3 entries, **session valid** | 428 ×3 → **key deleted** | 503 ×3 → entries kept **byte for byte**, nothing written |
| D1 | Same, **session expired** | 401 ×3 → **key deleted** | 503 ×3 → kept byte for byte |
| D1 | New client meets legacy entries | — | Quarantined; explicit "Add to account" syncs them once |
| D2 | Unbound plan creation | Passes the boundary (reaches body validation) | 503, zero db calls |
| D3 | A's logout carrying B's session | **Clears B's cookie** | 409, cookie untouched |
| D4 | Interleaved cross-context enqueues | **Loses one entry** | Both kept |
| D5 | Late older session answer | **Overrides the newer B → A** | B stands |
| IR-06 | `Kol` → `Kot` → `Kol` (local component swap) | R1 `LocationPicker` **fails R9 ×2** | Passes |

## R5. Mixed-version compatibility

**Behaviour:**
- **Refusal:** `POST /api/habit-logs` and `POST /api/plans` refuse a request **without** the stated account before authentication. The answer is HTTP **503** with `{ code: "client_upgrade_required" }`, `Cache-Control: no-store` and `Retry-After: 3600`.
- **Why 503:** the pre-REL-04 client classifies 5xx as "retry later" and keeps its queue. Its 4xx handling (including 401 when expired) would discard entries. Checking before authentication gives expired old tabs the same answer.
- **No retry loop:** old replay runs only on page load and on the browser `online` event.
- **Nothing is weakened:** nothing is written for unbound requests, and authentication is not relaxed: a bound request still needs a valid session.

**New client:**
- treats `client_upgrade_required` as "Aura was updated. Reload the app…";
- keeps legacy entries quarantined, with the explicit choice above;
- never assigns them automatically.

**Verified with the actual previous client code** (vendored a54daf6 enqueue/replay) against the corrected route: D1, both session states.

**Unavoidable limitations of already-loaded legacy bundles:**
1. **Direct log:** an old bundle's *direct* (online) activity log receives 503 and shows its normal failure. It is not queued, so the user re-logs after reloading.
2. **Plan save:** an old bundle's plan save receives 503 and shows "Unable to save plan" until reload.
3. **Persistence:** legacy entries keep being retried by old tabs until those tabs reload. They then stay quarantined until the user decides.
4. **Deploy coupling:** the refusal is permanent in code; there is no switch to remove. Whether a merge activates this change depends on the hosting configuration: Production git builds were last recorded as skipped by a preview-only ignore step, which this review did not re-verify. **Owner confirmation of the activation plan is required.**

## R6. Remaining limitations

1. **Uncoordinated cookie-response ordering.** Suppose a logout is *sent* with A's cookie and an uncoordinated sign-in (no lock) gets its response before that logout's response. The browser then applies the logout's `Set-Cookie` last. All app sign-in paths are coordinated; this needs an out-of-band sign-in (e.g. a second browser profile sharing cookies) or a client without Web Locks racing within the same instant.
2. **No-Web-Locks environments** (iOS WKWebView before 15.4): auth exclusion is marker-based (best-effort at the same instant). Queue integrity is unaffected (R3). Server checks still prevent wrong-account writes.
3. **Simulation, not processes.** Multi-tab and storage races are deterministic simulations. A real multi-process browser race has not run.
4. **Already-committed requests.** A request already sent with A's cookie commits for A, which is correct, even if the user switches meanwhile; Home shows it only under A.
5. **Unchanged from before:** copied-token residual (AURA-AUTH-01), device-only behaviour (§11).

## R7. Exact corrected head and CI

The exact head SHA and its CI results are recorded in the PR #392 description, since this file cannot contain its own commit hash.

---

## 2. Sources and restrictions

**Sources:**
- S5-A package (`~/Desktop/Claude/AuraEvidence/AURA_ANDROID_REL_02_S5_A_TEST_PLAN_CORRECTIONS_AND_SESSION_SAFETY/`, unchanged);
- the first independent review;
- the delta review (above);
- current source.

**Restrictions honoured:**
- The REL-03 deferral and sealed archive were not touched.
- P-1 and SAS-0 were not started.
- No emulator, ADB, device, signing, packaging, Play Console, infrastructure, live database, real credential or Production action.
- No merge. Auto-fix and Auto-merge are off.

## 3. Fixes (original REL-04 set, as amended)

| ID | State |
|---|---|
| **F1** backup Option A (O-1 selected) | Unchanged. BK-1 device verification mandatory. |
| **F2** cookie flush in `onPause` | Best-effort. `CookieManager.flush()` **blocks** while it writes the cookies the WebView holds at that moment, and may do I/O. It does not cover a kill before or during `onPause`, or a `Set-Cookie` arriving after the flush, and it does not confirm the write. Session safety does not depend on it. Device rows D-S2/D-S6 cover delayed responses, interrupted transitions, cold launches and pause latency. |
| F3/F4 | Superseded by IR-03/IR-01 (R1, R2) |
| F5 | Logout cookie attributes. Logout is now also account-bound (R2). |
| F6 | Completed by IR-06 (R1, R2) |
| **F7** release gate | **Partial**; see §7 |

## 4. Authentication and session security

| Question | State |
|---|---|
| Authorization | Signed `as_session` cookie only. Stated accounts are constraints, never credentials. |
| Writes under the wrong account | Refused at the bound write routes (required binding) and by the middleware. |
| Reads under the wrong account | Refused by the middleware when the client states its account (all app reads do). |
| Logout | Account-bound, bounded, strict acknowledgement, reconciled. Coordinated with sign-in across tabs. |
| Sign-in | Coordinated. The server names the account and the client confirms it with a fresh session answer before binding anything. |
| Revocation | **None** (RV-1 residual). Unacceptable for public release (O-2) → AURA-AUTH-01. Not implemented here; the shared auth files touched by R2 are `logout`, `verify-code`, `session` and `middleware.ts`. |
| Backup / transfer | Closed (F1); D-S1 mandatory |

## 5. Outstanding Android findings: disposition

| ID | State |
|---|---|
| FP-0/R-07/E-1 | Not applicable (S4 retired, O-5). The relevant guarantees are covered by R2's transitions, AURA-AUTH-01 and the D-S rows. |
| BK-1 | Implemented; device verification mandatory |
| RV-1 | Residual confirmed (in-process); public-release blocker |
| S5A-F4 | Infrastructure item (recorded) |
| REL-03 A5 | Device rows |

## 6. Native application experience

As before, plus:
- Home shows a **Retry** state when the session can't be verified (I6);
- Home shows a **legacy-entries notice**;
- `/find` resets account-sensitive state on account changes;
- the location search uses input generations.

## 7. Release configuration

**The release gate is partial (IR-05).** `verifyReleaseServerConfig` (release builds only) reads the generated `capacitor.config.json` and fails when any of the following holds:

| Field | Fails when |
|---|---|
| `server.url` | does not parse as a URL with scheme `https` and a non-empty host |
| host | is `localhost`, ends with `.localhost` or `.local`, or matches `127.x.x.x`, `10.x.x.x`, `192.168.x.x` or `172.16–31.x.x` (these exact patterns only: no IPv6 literals, no other reserved ranges, no DNS resolution) |
| `server.cleartext` | is `true` |
| `server.errorPath` | is not `unsupported-webview.html` |
| `android.minWebViewVersion` | is not `91` |

**It does not establish:**
- the **final release origin** (O-4);
- the **effective configuration inside the built artefact**;
- the **merged/packaged assets**;
- an **explicit release version**;
- effective **cleartext and mixed-content** policy in the built app;
- **16 KB** page alignment;
- that the artefact is **not debuggable**;
- **Huawei/no-Google-WebView** acceptance.

These are release-candidate requirements RC-7a…RC-7h (§12). minSdk 29 and targetSdk 36 are preserved (O-7).

## 8. Validation results (R2 working tree)

**REL-04 suites:**

| Suite | Local | Notes |
|---|---|---|
| `rel04AccountIsolation` | **50/0** | Real middleware and routes; simulated interleavings |
| `rel04HomeFindTransitionJsdom` | **13/0** | Real Home and `/find` mounted |
| `rel04BoundWritesJsdom` | **19/0** | Real plan helper and overrides; mounted `/find` competing sign-in and late completion |
| `rel04R1HeadReproduction` | **21/0** | 14 in CI |
| `rel04ReviewedHeadReproduction` | **12/0** | 8 in CI |
| `signOutRel04` | **19/0** | |
| `locationPickerRel04SearchRace` | **22/0** | |
| `rel04Rv1TokenReplay` | **8/0** | |
| `androidRel04AppReadiness` | **48/0** | |

**Existing suites updated for the new design (not weakened):**
- `pendingActivityReloadVisibility`: per-entry storage;
- `pendingReplayReconciliation` and `pendingActivityVisualConsistency`: replay in `lib/activitySync.ts`.

**Type check:** `apps/web` `tsc --noEmit` passes with a **generated Prisma client** (`prisma generate`, client 5.22.0) in the isolated worktree. No tracked file changed.

**Full offline sweep:** every CI test command (343, including multi-line `run:` blocks) was run locally without a database.
- **Database suites:** 78 `*Db.test.ts` suites stopped at their database precondition (no `DATABASE_URL`, connection refused, or "local disposable database only"). CI's DB jobs run them.
- **Everything else:** passes.
- **Regressions:** the sweep found 7 in existing suites, all caused by the intended stricter behaviour, and all fixed in the tests without weakening their intent:
  - `landingGuestEntryJsdom` and `signInResendChangeEmailJsdom`: sign-in now confirms the account via `verifySignInCode` plus a session read;
  - `findATimeConflictJsdom`, `findATimeErrorStatesJsdom`, `hpg5I2ConflictPanelJsdom` and `hpg5I3HomeSaveJsdom`: standalone component mounts now establish the verified account Home always provides;
  - `homeIntent1AskAuraHandoff`: the `/api/plans` call site is now `boundFetch(`.
- **Pre-existing failures:** `insightsHistoryWiring` and `plannedActivityCanonicalIdentity` are not in CI and fail on `main`.

## 9. Remaining release blockers

| # | Blocker |
|---|---|
| B-1 | In-app account deletion (O-8) |
| B-2 | Privacy policy (O-8) |
| B-3 | Final release origin (O-4) |
| B-4 | Device acceptance (§11), incl. BK-1 |
| B-5 | Upload key, Play App Signing, Play Console (owner) |
| B-6 | AURA-AUTH-01 server-side per-session revocation (O-2) |
| B-7 | Focused independent verification of R2, then owner approval to merge |
| B-8 | Activation plan for the shared web change (merge vs deploy, §R5) confirmed by the owner |
| B-9 | Release-gate completion RC-7a…RC-7h |

## 10. Owner decisions (recorded 2026-11-24)

| # | Decision |
|---|---|
| O-1 | Backup Option A; BK-1 device verification mandatory |
| O-2 | 30-day copied-session residual unacceptable for public release → AURA-AUTH-01 |
| O-3 | Explicit discard after confirmed logout: implemented as "confirmed **and** acknowledged, exactly the confirmed snapshot" |
| O-5 | S4 retired. Guarantees preserved through R2 transitions, AURA-AUTH-01 and device acceptance; **not yet independently verified** |
| O-6 | No location caching |
| O-7 | minSdk 29 / targetSdk 36 |

**Open:** O-4, O-8; approval to merge; activation plan.

## 11. Final device acceptance checklist

**Rules:**
- one build SHA; synthetic accounts A and B; a non-production backend;
- no coordinates recorded;
- 0 FATAL / 0 ANR; no spinner over 31 s.

**Device coverage:** API 29/30, API 34 and API 36 (P = physical preferred).

| # | Area | Steps | Pass |
|---|---|---|---|
| R1–R10 | REL-03 rows 1–10 | `AURA_ANDROID_REL_03_DEVICE_ACCEPTANCE_CHECKLIST.md` | As written |
| **D-S1 (BK-1, mandatory)** | Backup/transfer | `bmgr` local transport (34/36), `adb backup` (29/30), device-transfer emulation; list archives | No `app_webview/` or app data; opens signed out after restore or transfer |
| **D-S2** | Cookie persistence (best-effort flush) | Sign in / sign out → background within 3 s → swipe → cold launch, 5× each; repeat with the logout response delayed and with the swipe mid-sign-out | Signed-in/out as expected, or reconciled to the server's real state at cold launch; never "signed out" while the server still has A; record pause-to-kill latency |
| **D-S3** | Honest sign-out | Airplane mode → Sign out; captive-portal Wi-Fi if available | Still A with "Couldn't sign out…"; **or**, if the session endpoint is unreachable afterwards, the **unverified** state (Retry, pending work kept); after reconnect Retry reconciles before A's work resumes |
| **D-S4** | Pending activity at sign-out | **Control automatic replay first:** go offline before logging and stay offline (or block the habit-logs host) until the count step, so replay cannot change the count. Then log 2 activities as A. | |
| | (a) Cancel | Sign out → the question names 2 logs → Cancel | Still A; both pending; they sync once when online |
| | (b) Confirm, server reachable | Restore the network only for auth (or online with habit-logs blocked) → Sign out → OK | Signed out; logs removed; B never sees them |
| | (c) Server unavailable | Server down → Sign out → OK | Still A ("Couldn't sign out…") **or** unverified with Retry; logs kept; nothing resumes until reconciled |
| | (d) Lost acknowledgement | Proxy drops the logout response | After reconnect the app shows the server's real state; if signed out, A's logs are **kept** (not discarded) and never appear for B |
| | (e) Unresolved write | Log with a slow network, Sign out while it is sending | The question counts it ("may already have been saved"); after Cancel and reconnect it syncs exactly once |
| | (f) Two windows | Web build in two tabs (or two WebView windows if available): A in both; sign out in one while the other logs | The other window refuses the log during the sign-out; no A entry appears for B in either |
| | (g) Storage failure | Not device-feasible; covered by C7 | — |
| **D-S5** | Account switch | Sign out A → sign in B → cold launch; background/foreground | B only; no A data on any screen |
| **D-S6** | Interrupted transition / pause latency | Start sign-out, press Home mid-request; return after 10 s; cold launch | Fully signed out, fully A, or unverified with Retry; never a mix; no stuck spinner |
| **D-S7** | Session expiry | Short-lived synthetic token (test backend); foreground after expiry | Signed-out screen; no A data |
| **D-S8** | Mixed versions | Keep an old-build page open, deploy, log offline in it, return online | Old page keeps its entries (no loss); new page shows the legacy notice; Add/Discard work |
| D-L1…L6 | Location (incl. `Kol` → `Kot` → `Kol` on a throttled network: no retired row selectable) | — | As specified |
| D-U1…U4, D-N1/N2, D-R1/R2 | Unchanged | — | — |

## 12. Release-candidate requirements

| # | Requirement |
|---|---|
| RC-1 | Focused verification (B-7) → owner approval → merge **with a confirmed activation plan** (B-8) |
| RC-2 | B-1, B-2, B-3, B-6 |
| RC-3 | RC commit; debug RC for §11 |
| RC-4…RC-6 | Play account (closed-test rule), Play App Signing + upload key, listing, Data safety, privacy URL, testers |
| **RC-7a** | Final release origin (O-4) in the synced config |
| **RC-7b** | Effective configuration in the built AAB (`assets/capacitor.config.json`) |
| **RC-7c** | Merged/packaged assets (connection and WebView-floor pages, plugin config) |
| **RC-7d** | Explicit, increasing release version (`auraVersionCode`/`auraVersionName`); no defaults |
| **RC-7e** | Effective cleartext and mixed-content policy in the built app |
| **RC-7f** | 16 KB page alignment |
| **RC-7g** | Not debuggable |
| **RC-7h** | Huawei/no-Google-WebView acceptance decision |
| RC-8 | Internal testing upload; D-R1, D-R2 |

## 13. Focused independent verification request

**Scope:** `d09449b..<R2 head>`.

**Questions:**
1. Is every listed plan caller bound at the user's action, and preserved through delayed confirmations, overrides and retries?
2. Do `refuseUnboundWrite` and `refuseAccountMismatch` precede every read and write in both routes?
3. Does the middleware refuse mismatched reads without ever authorizing anything?
4. Can any queue mutation lose, resurrect or over-remove entries across contexts, with or without Web Locks?
5. Are unresolved writes preserved under their account?
6. Is every logout stage bounded? Is every non-acknowledgement reconciled before resumption?
7. Can an old logout clear a newer *coordinated* sign-in?
8. Is the stale-session handling correct under concurrency?
9. Does the mixed-version refusal preserve legacy entries in both session states?
10. Is IR-06 closed for repeated queries?

**Not in scope:** AURA-AUTH-01, device behaviour, release preparation.

## 14. Observations

- **iOS Podfile drift:** a combined `cap sync` changes the Podfile (reverted; needs an iOS ticket).
- **Pre-existing failures:** `insightsHistoryWiring` and `plannedActivityCanonicalIdentity` fail on `main` (not in CI).
- **Unused fallback writers:** `useHabitLogs` and the `PastActivityModal` fallback are unused and unbound. They receive 503 and fail closed.
