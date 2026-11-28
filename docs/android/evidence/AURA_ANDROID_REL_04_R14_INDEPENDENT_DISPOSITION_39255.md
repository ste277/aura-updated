# 39255 AURA-ANDROID-REL-04 R14 independent verification

**NO-GO for controlled merge. Release remains on HOLD.** Keep ticket 39243 open. The exact F1–F3 schedules are corrected on the pinned integration. The broader outcome contract still permits unsupported “already recorded” results. Direct and replay can persist accepted decisions when no server record exists, and reconciliation trusts contradictory or incomplete durable decisions. A real two-tab Home test also produced a fresh-ID duplicate after an unresolved outcome and a stale refresh.

## Reviewed revisions and automatic integration

| Item | Verified full SHA |
|---|---|
| R13 implementation used as baseline | a8a976733d73d8acc5eb13e2af687f3648204471 |
| R14 implementation | 0df08780bd75e16b676efda6c99c1738bc72681b |
| R14 handover and pre-integration PR head | 39f262b16cca48e40e2fcb528ad221d188f8daad |
| CI-10 integration base | 73cea7dc409e2740b4474695e248338f87c374c0 |
| PR branch head | 6c69d7d9089566b44b7a24ff0725add754cb7dbd |
| Tested integration | 11a2129651c2f66a835c5c41abf54742f6c6e3ab |
| Tested tree, also the PR head tree | 49f635592bbf8f315f2982b839dad4156116286f |

The existing branch integration takes the handover and CI-10 base as its parents. The hosted merge commits that identical tree above CI-10 main and the PR head. An independent three-way merge calculation produced the same tree. R14's runtime files, dedicated regression suites, historical test adjustments and fixtures are byte-identical to the pre-integration implementation. The CI-10 Weekly Plan Review fixture is byte-identical to main and passed locally on disposable PostgreSQL and in the hosted DB job. There are no migration or schema deltas relative to main. I used 39252 and its original evidence, the R14 commit/handover and readiness report for 39253, and the branch merge message for 71044. The standalone integration addendum and its checksum were unavailable in the accessible sources. This review independently verified the integration tree and hosted execution. [Implementation](https://github.com/ste277/aura-updated/commit/0df08780bd75e16b676efda6c99c1738bc72681b) [Integration](https://github.com/ste277/aura-updated/commit/11a2129651c2f66a835c5c41abf54742f6c6e3ab)

| Automatically combined file | Preservation assessment |
|---|---|
| .github/workflows/ci.yml | R14 outcome, account isolation, browser and rendering invocations remain in their jobs. Main additions, including the MCP residual suites and Palmistry/PREF gates, remain. Hosted logs execute the R14 and CI-10 steps. |
| apps/web/components/PlanWithAuraView.tsx | Main's Find a Time preference hint is present with REL-04's original-account binding and overlap retry binding for plan saves. |
| apps/web/components/YouView.tsx | Main's availability and work-hours deep links are present with REL-04's account-bound export and calendar downloads. |
| test/findATimeConstraintsDb.test.ts | Retains bound route headers and the main expectation for work-hours metadata. |
| test/goalActivityDailyOccurrenceEligibilityDb.test.ts | Retains bound headers while using the main deterministic future fixture and race ordering. |
| test/planDayWiring.test.ts | Checks the account-scoped bootstrap/loader and the main availability deep-link behavior. |
| test/schedulingEligibilityErrorContractDb.test.ts | Retains bound requests and the main deterministic lifecycle date fixture. |
| test/schedulingEligibilityUiPresentationDb.test.ts | Retains bound requests and the main deterministic lifecycle date fixture. |

## F1–F3 and the unified outcome contract

| Finding | Disposition | Independent result |
|---|---|---|
| F1 | **PARTIAL overall. Original witness CLOSED.** | The unchanged R13 probe reproduced “storage-unavailable,” one row from cross-tab replay and a second from a fresh-ID retry. R14 returns already-recorded for the original exact request and keeps the server count at one, including same-ID retry. New authority failures below prevent closure of the full invariant. |
| F2 | **CLOSED** | On R13, a truncated v2 array containing the same activity is kept while sign-out reports removed. R14 reports discardedUnverified and unidentified, preserves the bytes, records the durable discard and blocks replay. The unreadable-v2 Chromium probe confirms no A sends across restart, and healthy B and clean-profile submissions. |
| F3 | **CLOSED** | R13 reports cleanup pending after an immediate read-back throws despite successful deletion. R14 reports verified removal when the later scan is clean, keeping the earlier error diagnostic. Known survivors, final-read failure, concurrent replacement, opaque legacy data, late retired writes and reconciled/uncertain discard are represented separately. Observed absence is limited to the reporting boundary. |

The historical R13 baseline is a meaningful negative control for ignoring settlement, fresh-ID retry, treating opaque data as absent and preferring a stale cleanup error. The R14 suite's adjusted R11 X1 assertion reflects the stronger F2 rule. The replay source assertion still orders retry before settlement and now checks the server-outcome-bearing settle call. The prior E1–E4 controls and N1/N3/N4/N6 witnessed protections remain. N5's exact reporting witnesses now pass, while N2 remains an independent activation condition. I found no regression in the supported authenticated claim and transmission fence.

**New authority blockers.**

- **G1 — an HTTP 200 fallback can become a durable accepted settlement.** Force a non-API HTML 200 on the POST without reaching the server handler. Direct submission returns confirmed with an empty server object. Replay increments confirmed. Both remove the active copy and store settled/accepted. Resubmitting the same account, request ID and payload then returns already-recorded with **zero server rows**. The earlier status-based success handling is now promoted into durable proof. Both send paths need the same authoritative API response decoder. An unrecognized 2xx or misbound response must leave the outcome unresolved with the original identity. [Direct and replay](https://github.com/ste277/aura-updated/blob/0df08780bd75e16b676efda6c99c1738bc72681b/apps/web/lib/activitySync.ts#L154-L162) [Replay settlement](https://github.com/ste277/aura-updated/blob/0df08780bd75e16b676efda6c99c1738bc72681b/apps/web/lib/activitySync.ts#L232-L247)
- **G2 — the decision lookup trusts a contradictory value or missing payload.** Store an accepted marker under A/X's key while its fields name B, name another request, or have a null payload. Each probe returns already-recorded for A/X with no POST and **zero A or B server rows**. This models inconsistent local evidence. The matching storage key alone does not establish identity. Accepted decisions need validated account, request and exact payload evidence; ambiguous decisions should keep the request unresolved. A null payload can still act conservatively as a blocking discard marker. [Request-state decision read](https://github.com/ste277/aura-updated/blob/0df08780bd75e16b676efda6c99c1738bc72681b/apps/web/lib/offlineHabitQueue.ts#L667-L681)

**Path assessment.** The account-bound Home client and replay use the same IndexedDB request-state decision and the claim carries the intended account, request, record and payload. The durable-state lookup repairs F1's active-copy-only race. It remains a separate problem to establish that a network response and the durable proof derived from it authorize success. Sign-out's decision-first cleanup and final tri-state verification address F2 and F3. The current database architecture supports a common authority rule without changing storage formats. The cross-store visibility gap with historical writers still needs origin isolation.

## Real Home, Chromium and PostgreSQL

**Real Home Start now in two Chromium tabs.** The integrated Next.js production build used the real habit-log route and a disposable PostgreSQL 16 database. I fixed the browser at a favorable activity window, clicked Start now and 30m, withheld the real IndexedDB completion acknowledgement, then advanced only the companion tab past the claim lifetime. With the durable decision already present before acknowledgement recovery, Home showed no error or retry. With PostgreSQL committed but the replay HTTP response held while the original Home reconciled, Home stayed pending and did not offer a retry. Both schedules had one bound replay POST, zero original-tab POSTs, one PostgreSQL row, one accepted decision and no remaining claims or active copies. The exact request bodies, account IDs, outbox and claim IDs, accepted markers and PostgreSQL IDs are preserved in the browser log.

**G3 — OPEN. Outcome uncertainty can still enable a fresh-ID retry from Home.** Hold the original tab's legitimate empty habit-logs GET response from before the save. Let the companion tab replay and settle the original Home request. When recovering the lost enqueue acknowledgement, fault the original tab's readonly decision lookup once. Home initially shows Saved offline. Release the older empty GET. The Home list merge compares it against active queue items, which are empty after settlement. It clears the pending state and re-enables Start now. Click Start now and 30m again. PostgreSQL contains **two rows**, with identical activity payload and different IDs, both under the same account. The two evidence faults are explicitly injected and this is a deterministic browser test, not a measured production occurrence. [Home merge](https://github.com/ste277/aura-updated/blob/0df08780bd75e16b676efda6c99c1738bc72681b/apps/web/app/page.tsx#L426-L445) [Home pending-to-idle transition](https://github.com/ste277/aura-updated/blob/11a2129651c2f66a835c5c41abf54742f6c6e3ab/apps/web/components/HomeDashboard.tsx#L2276-L2287)

| Browser G3 row | Request ID | PostgreSQL row ID |
|---|---|---|
| Original replay, account 37fb55d7-630f-4f94-b467-9fb52ef0788a | f5b67ee4-e3bb-4dd7-b1e3-805e5e8f0299 | 0210eb66-0cab-456e-b2dc-bd40cd8dec8e |
| Fresh Home retry, same account | 2ea87e5d-208f-4486-8a01-fef71524cc9b | 899be1fd-d157-4c81-b0c9-421bd58d085b |

Preserve unresolved request identity through Home refreshes. Re-enable another action only when evidence resolves the earlier request, and use the original ID for an explicit retry while its outcome remains unknown. An older server list combined with an empty active queue cannot establish that the request never committed.

The real PostgreSQL idempotency test passed against a disposable PostgreSQL 16 cluster with 54 migrations. Sequential and concurrent requests with one account/request ID converge to one row. Separate IDs can create distinct rows, and a shared ID never deduplicates across accounts. The unchecked HTML and contradictory decision probes use a synthetic network or local-state fault with the actual client code. They establish acceptance without authoritative evidence, rather than ordinary server success.

## Evidence, CI and regression verification

- Verified all 16 handover hashes, all 50 preserved 39252 entries against their original bytes, all 333 command-log hashes and all three historical R13 fixture bytes. Exact historical revision a8a9767 was available in the detached audit checkout. The independent R14 suite passed **28/28**, including those provenance checks.
- The pinned pre-integration local evidence has **255/255 math-core**, **75/76 DB** and two browser commands that exited zero. Its failed DB command is the old Weekly Plan Review same-date fixture. The corrected main fixture passed on the integrated candidate. Targeted R4–R13 suites, sign-out, account isolation, SSR agreement, replay reconciliation and reload visibility passed locally. The app built and both pinned typecheck projects passed (apps/web tsconfig.json and root tsconfig.web.json).
- Hosted run **46025314649** succeeded on attempt one with **9/9 jobs, 468/468 successful steps and 11/11 PR checks**. Checked the original checkout lines for all nine jobs against 11a2129. The hosted R14 suite reports 25 passing, with the three historical comparisons skipped for shallow history. Hosted Chromium is **30/30**. The independent local full browser suite ran twice with **29/30** each. CH16 and the current-worker CH15 assertion passed both times. The miss was CH15's historical R5-worker reload negative control. This local discrepancy is preserved and the hosted raw record distinguishes the two. CI-DEBT-10 was untouched. [Hosted run](https://github.com/ste277/aura-updated/actions/runs/46025314649)
- Historical failed runs **46002683525** and **46007450992** are preserved with their original manifests. Both failed the Weekly Plan Review same-date setup assertion before CI-10. The integration archive's original five checksums also verified. [Implementation failure](https://github.com/ste277/aura-updated/actions/runs/46002683525) [Handover failure](https://github.com/ste277/aura-updated/actions/runs/46007450992)

| Evidence anchor | Verified SHA-256 |
|---|---|
| Preserved 39252 independent checksum manifest | 58414687e5b96cf4e1f79883c2461b192e0f6b3d401b08ba83e1f7979d33831a |
| R14 math-core manifest | 02caa7713efdbea6871e380555644f96c90d898919f7399fe82c2e8ef714785a |
| R14 DB/browser manifest | c568f41cc6457242470bdd75dd48abb4855a94d824ad3e42aead966e30ea1aa8 |
| R14 outcome suite | 7fd1b9a80f1ee4e8a5f86534d4ed8ed2ff83adbf54cf207e7ac3103d1d6421c7 |

## Release isolation and remaining conditions

The inspected PR is open, and Auto-merge is null. The R14 commit is absent from fetched main. Auto-fix is reported off in the handover/PR record, and the review did not independently observe an address-comments setting. Hosting management metadata and the Vercel check identify a Preview and the existing live alias at a39f398. The inspected Production inventory has no R14 deployment. This independently verifies the observed live commit and isolation within that hosting project, which is consistent with the reported REL-05 baseline. It does not establish the configuration of private installations or provide Android device acceptance. [PR](https://github.com/ste277/aura-updated/pull/392)

Before any activation, execute the **writer-free origin and rollback allowlist** acceptance test with the actual release/rollback artifacts, retained legacy tabs and offline-restored profiles. For exposed populations, separately verify **account-scoped recovery of unreadable v2**. Neither requirement is waived. The current verdict calls for resolving the implementation blockers before controlled merge. No implementation change, branch synchronization, hosted CI rerun, merge, destructive user-storage operation, Production service access or activation occurred in this review.

## Reproduce independently

Use disposable checkouts at a8a9767 and 11a2129 with the normal project dependencies. Copy the preserved *review-r13-independent.ts* into *test/* on both. Copy *review-r14-authority.ts* and *review-r14-home.ts* into *test/* in the integration checkout. The Home script requires the built integrated app, Playwright Chromium, and a fresh loopback PostgreSQL database named *audit_r14* at port 55482 with project migrations applied. Its source pins the synthetic test settings. Use:

~~~sh
export TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}'
npx ts-node --project tsconfig.jsdom-tests.json test/review-r13-independent.ts
npx ts-node --project tsconfig.jsdom-tests.json test/rel04R14OutcomeReconciliation.test.ts
npx ts-node --project tsconfig.jsdom-tests.json test/review-r14-authority.ts
npx ts-node --project tsconfig.jsdom-tests.json test/review-r14-home.ts
~~~

The companion evidence includes probe source, full JSON observations, checksums, the automatic merge comparison and both original failed CI archives. From the integration checkout, run *verify-r14.py* with the workspace containing 39252's prior evidence as the sole argument. From the evidence directory, run *shasum -a 256 -c SHA256SUMS*.

