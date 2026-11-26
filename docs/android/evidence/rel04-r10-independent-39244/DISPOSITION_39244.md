# 39244 AURA-ANDROID-REL-04 R10 independent verification

**Implementation disposition: OPEN.** Keep ticket 39243 and the implementation review open at PR #392 head 4a37173. The original R9 witnesses pass on R10. Additional probes reproduced a request selected for discard reaching the server, a replay claim accepting a contradictory identity, and sign-out discarding an activity outside the approved snapshot. The release-provenance finding for the unreadable v2 array is separate from those implementation blockers.

## Dispositions

| Finding | Disposition | Independent result |
|---|---|---|
| R9 X2 W1, durable discard of identifiable damaged copies | **PARTIAL** | Both original timestamp cases are closed. An IndexedDB copy with intact nested identity and a missing outer request ID still escapes durable discard (D1). |
| R9 X2 W2, possibly-sent attribution | **PARTIAL** | The original removed-versus-cleanup-pending split is correct. Retrying cleanup forgets an actual prior send (D6). A fresh claim plus an identity conflict also produces inconsistent counts and prior-send language (D5). |
| R9 X1, transmission boundary | **PARTIAL** | Original IndexedDB and localStorage read-failure witnesses remain closed. The claim path admits an IndexedDB identity conflict that direct submission refuses (D2). Retired keyed copies with a mismatched account value are skipped by both paths' shared inspection (D3). |
| R9 X3, decision before cleanup | **CLOSED** | The original premature-cleanup witness stays closed. An abort after a delete was issued rolls back the delete, and localStorage stays intact (P1). A decision survives lost acknowledgement and cleanup interruption (P2–P3). Separate confirmation and reporting defects are listed below. |

### Additional findings

| ID | Disposition | Reproduction and observed result |
|---|---|---|
| D1 | **OPEN** | In R10 IndexedDB, seed a record with the outer owner and record ID, omit the outer request ID, and retain the matching nested owner and request ID with a damaged timestamp. The snapshot identifies the request. Confirmed sign-out reports zero outcomes and leaves the row and zero discard decisions. Submitting the same request after signing back in returns **confirmed** and creates one server row. Discard and submission depend on an index absent from the damaged copy. [Queue read and discard](https://github.com/ste277/aura-updated/blob/8f3d3167af2c48ea463d454600dc94358e4e7249/apps/web/lib/offlineHabitQueue.ts#L798-L818) |
| D2 | **OPEN** | Queue Y and store a second IndexedDB copy indexed as X whose nested request ID is Y. The queue read pauses Y and direct submission returns **not-stored**, while the claim for Y succeeds. In a second probe, insert the same conflict after replay's readonly request finishes and before its read-write claim. Replay attempts and confirms one POST for Y, creating one row. The claim looks only under Y's compound index. [Claim path](https://github.com/ste277/aura-updated/blob/8f3d3167af2c48ea463d454600dc94358e4e7249/apps/web/lib/offlineHabitQueue.ts#L590-L604) |
| D3 | **OPEN** | For each of *aura_q3* and *aura_q4*, place a key under A with request X and a serialized value naming B and X. A and B both report zero paused. A's fresh same-ID submission confirms and creates one A row. Sign-out reports zero unidentified and preserves the raw copy. B receives zero rows, and the stored foreign payload is never posted. The mismatch bypasses quarantine before identity classification. [Retired-source inspection](https://github.com/ste277/aura-updated/blob/8f3d3167af2c48ea463d454600dc94358e4e7249/apps/web/lib/offlineHabitQueue.ts#L415-L427) |
| D4 | **OPEN** | Capture sign-out confirmation for one damaged IndexedDB activity. During logout and after confirmation, replace the value at its existing record ID with a different, internally consistent owner-matching request identity. Aura removes the replacement and writes a discard decision for its unseen request ID, then reports one removal from the confirmation. The original request has no decision. [Discard snapshot handling](https://github.com/ste277/aura-updated/blob/8f3d3167af2c48ea463d454600dc94358e4e7249/apps/web/lib/offlineHabitQueue.ts#L783-L818) |
| D5 | **OPEN** | Claim X in another tab, damage the nested owner of the active copy, then add a valid retired copy of X. The confirmation counts two entries and zero dispatched. Sign-out records **removed=1, removedPossiblySent=1, unidentified=1, keptInFlight=0**, deletes the retired copy, and leaves the damaged active copy and the fresh claim. It describes the retained entry as never sent. The claim check depends on a well-identified active copy. [Claim and discard accounting](https://github.com/ste277/aura-updated/blob/8f3d3167af2c48ea463d454600dc94358e4e7249/apps/web/lib/offlineHabitQueue.ts#L805-L846) |
| D6 | **OPEN** | Let the server save X, lose its response, seed a retired copy and fail cleanup. The first sign-out correctly reports one cleanup-pending item that may already have been sent. On retry, sign-out removes the copy and reports **removedPossiblySent=0**, although the server row still exists. The first discard clears the dispatch mark without retaining this fact in its decision. [Decision and dispatch cleanup](https://github.com/ste277/aura-updated/blob/8f3d3167af2c48ea463d454600dc94358e4e7249/apps/web/lib/offlineHabitQueue.ts#L812-L820) |
| D7 | **OPEN** | Seed *aura_q4:A:X* with unreadable JSON and no record-ID delimiter. The parser treats the incomplete suffix as trustworthy X, sign-out deletes the raw entry, and a discarded marker is created for X. The historical Q4 writer emits both request and record ID. [Retired key parsing](https://github.com/ste277/aura-updated/blob/8f3d3167af2c48ea463d454600dc94358e4e7249/apps/web/lib/offlineHabitQueue.ts#L415-L425) |
| P3, outcome on indeterminate acknowledgement | **PARTIAL** | A synthetic lost-acknowledgement injection after commit yields **failed=1**, a committed marker, a deleted IndexedDB copy, a byte-identical retired copy, and zero POSTs. Data safety passes. The result collapses uncertainty into the same outcome as a confirmed rollback, and the sign-out message treats failed items as kept and eligible to sync later. This injection simulates uncertainty at the acknowledgement boundary. It does not establish that a browser emits both transaction events. [Failure result](https://github.com/ste277/aura-updated/blob/8f3d3167af2c48ea463d454600dc94358e4e7249/apps/web/lib/offlineHabitQueue.ts#L824-L830) [User message](https://github.com/ste277/aura-updated/blob/8f3d3167af2c48ea463d454600dc94358e4e7249/apps/web/lib/signOut.ts#L143-L155) |

## Exact witness results

The preserved 39228 probe was copied verbatim into detached checkouts of 513c12b and 4a37173. Both processes exited zero. These are the reviewer's original witnesses, including the real route handlers over a synthetic server store.

| Witness | Unchanged R9 implementation 513c12b | R10 final head 4a37173 |
|---|---|---|
| W1, v2 copy with readable ID and damaged timestamp | Paused 1, removed 1, zero decisions, same-ID submit confirmed, one row | Paused 1, removed 1, one discarded decision, same-ID submit not-stored, zero rows |
| W1, IndexedDB copy with readable ID and damaged timestamp | Paused 1, removed 1, zero decisions, same-ID submit confirmed, one row | Paused 1, removed 1, one discarded decision, same-ID submit not-stored, zero rows |
| W2, unsent removed + previously sent cleanup-pending | Removed 1 and removedPossiblySent 1. Cleanup pending 1. The warning describes the wrong log | Removed 1 and removedPossiblySent 0. Cleanup pending 1 and cleanupPendingPossiblySent 1. The warning follows the log with the actual server row |

## Storage, race and historical checks

- The normal identity paths pass in active IndexedDB and historical v2, Q3 and Q4. A sound identity survives an absent title or damaged/missing timestamp, and identified duplicates count once. Standard malformed nested IDs, key/value disagreement and exact-account v2/IndexedDB contradictions are preserved by the supplied probes. D1–D3 and D7 qualify coverage for damaged index fields, replay-time contradictions and keyed historical records.
- In P1, inject a marker-write failure after a delete request has succeeded within its transaction. The copy and its raw v2 source survive, no marker exists, sign-out discard reports failed, and the request posts zero rows. In P2, fail physical cleanup after marker commit. A cannot submit or replay the request after signing back in, and the marker survives a later successful cleanup. B can independently submit the same request ID and gets its own row. P3 independently exercises committed-but-ambiguous completion.
- The R10 suite passed 20 submit/discard scheduling alternations with zero sends and a durable decision. The R9 suite passed its original competing-claim checks. D4 and D5 cover different interleavings and state changes.
- **R5 T2.** The changed assertion strengthens the integrity condition. It still requires the already-approved ID to be decided and the changed raw value to survive, and now verifies that neither contradictory candidate can enter the queue. One unidentified entry is the defensible count for that single contradictory copy. D2 shows why an equivalent check is also needed at the replay claim.
- **R9 E4.** The new assertion strengthens preservation, requires an unidentified outcome and proves zero sends. It also removes the old recovery behavior: sign-out no longer restores submission for an opaque v2 array. The assertion honestly captures the new tradeoff, with the availability and release consequences below.
- Local suite results on 4a37173 were R10 **25/25**, R9 **36/36**, R8 **43/43**, R7 **38/38**, R6 **22/22**, R5 **16/16**, R4 queue **27/27**, R4 SSR **21/21**, account isolation **50/50**, sign-out **19/19**, Home→Find **15/15**, and token replay **8/8**. Pending replay reconciliation also passed. The R10 healthy path confirms one online write and one offline write replayed once. The released legacy array retains its read-only quarantine. Previously exercised R4–R9 witnesses pass with the exceptions to the broader lifecycle guarantees stated above.

## Unreadable v2 array

**Release provenance.** The first writer is PR #392 commit d09449b. The key is absent from the fetched *main* history and from the app trees at *main* a39f398, tags v1.0.0 and v1.1.0, production ac46fc3 and rollback 7a9af83. GitHub lists one release with zero attached build assets. The Vercel live alias points to deployment dpl_3SstUr7PBWFJHG6zM2oKjPxVBUhE (ac46fc3). Six Production-target deployments after the v2 writer commit were all canceled in the inspected inventory. There was **actual Preview exposure**: Vercel reports a READY build of d09449b with the PR branch alias, and the project reports SSO protection for deployments except custom domains. The native shell loads its configured remote origin. Production and public GitHub release evidence supports **no public shipment** of v2. It does not establish which people or sideloaded or internal clients used the protected Preview. Verify the intended native origins and any private distribution or shared test profiles before relying on the public-release conclusion. [V2 writer](https://github.com/ste277/aura-updated/commit/d09449b655d21c213f8bbb29cf90f5bdc71c208e) [GitHub releases](https://github.com/ste277/aura-updated/releases) [Recorded production routing](https://github.com/ste277/aura-updated/blob/4a3717362070d2f65a170001a59048fafad6098f/docs/android/evidence/rel04-r4-9c32460/DEPLOYMENT_ISOLATION_READONLY.md)

**Account and device impact.** In Chromium 151, a truncated v2 value under A's key blocks all A activity submissions on that origin and profile, even new IDs with network available. New submissions return *storage-unavailable* without being queued or sent. Previously queued A activity pauses and replay attempts zero. Confirmed sign-out still works and can discard readable A entries. It leaves the opaque bytes intact, reports one unidentified storage entry and cannot know how many activities it contains. Signing into B on the same profile works and B submits normally. Switching back to A and closing and relaunching Chromium with the same user-data directory both preserve A's block. A in a fresh profile submits normally. The probe observed exactly two log POSTs, one for B and one for A in the fresh profile. The scope is A's localStorage on that origin and profile, so other tabs sharing that storage inherit the block. The probe uses a real browser, synthetic accounts and a loopback origin.

**Recovery disposition: PARTIAL, release acceptance.** Preserve the fail-closed behavior. A supported, scoped support or admin recovery procedure is required before releasing into an origin/profile population that may have used the v2 writer. It should handle the affected key and preserve unrelated accounts and queued data, and be exercised in the release candidate. The inspected production lineage does not require an in-app v2 migration for a public release on clean origins. Before public release, confirm that any Preview consumer population is excluded or covered by recovery. Sign-out, reauthentication and restart cannot provide that recovery.

## Provenance, checksums and CI

- 8f3d316 directly follows 9385eb2. Runtime changes are confined to *offlineHabitQueue.ts* and *signOut.ts*. The other implementation-commit changes are a CI invocation, the R10 regression suite, the R5 and R9 assertion updates, three historical fixtures and the preserved R9 evidence. *activitySync.ts* is byte-identical to 513c12b. The final commit 4a37173 directly follows 8f3d316 and updates 335 paths exclusively in the readiness report, R10 handover and R10 evidence. Four trailing whitespace notices are confined to a captured test log. [Implementation commit](https://github.com/ste277/aura-updated/commit/8f3d3167af2c48ea463d454600dc94358e4e7249) [Final commit](https://github.com/ste277/aura-updated/commit/4a3717362070d2f65a170001a59048fafad6098f)
- Verified **13/13** handover hashes, **11/11** R9 evidence hashes and byte equality with the earlier local reviewer files, all three vendored R9 module copies against 513c12b, **251/251** math-core log hashes and **78/78** DB/Chromium/Next log hashes against their manifests. Manifest entries declare the implementation SHA and zero exits. All 329 commands and their environment overrides match the pinned workflow. The typecheck log records three zero exits. [Handover](https://github.com/ste277/aura-updated/blob/4a3717362070d2f65a170001a59048fafad6098f/docs/android/AURA_ANDROID_REL_04_R10_VERIFICATION_HANDOVER.md)
- GitHub confirms both requested runs completed on their respective full head SHAs and all nine jobs succeeded on attempt one. The existing CI and implementation evidence cover Chromium 29/29, Next app rendering 14/14 and DB command results. The independent assessment used the targeted local suites and a separate Chromium persistence probe. [Implementation run](https://github.com/ste277/aura-updated/actions/runs/45858803540) [Final-head run](https://github.com/ste277/aura-updated/actions/runs/45862518425)

| Evidence anchor | Verified SHA-256 |
|---|---|
| R9 SHA256SUMS | 8cd13bb6344bd05ee6c0b582b60cdf2380c94978819cb82aa8ad058cf1773d44 |
| R10 math-core manifest | 0912aa5923807e7ee3c7ec655581395e76fa9e041ed257c2e2f0e86a78ce4f95 |
| R10 DB/browser manifest | 1e8f0fbecdc558c3449e1f06ff0a0421bce619ad9f626f2a0cfda76634ceca44 |
| R10 typecheck log | c82a4510f7ab17a9dc549d2e7bd1391b37f5b1a8d8ad37a8f02f1915f19b3715 |
| R10 25/25 command log | dc2a4e40d2779ec5ebf1d99bfe0c31df0d81d1b916a65742c6b31201d1170efd |

## Reproduce locally

Use disposable checkouts with the repository's Node and web test dependencies installed. Copy the two accompanying *review-r10-*.ts files into *test/* at 4a37173. The browser probe also needs the installed Playwright Chromium binary, loopback access and a writable temporary directory. Its account data is synthetic. The edge probe prints the actual observations for each named case, including failing invariants.

~~~sh
export TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}'
npx ts-node --project tsconfig.jsdom-tests.json test/review-r10-edge.ts
npx ts-node --project tsconfig.jsdom-tests.json test/review-r10-browser.ts
npx ts-node --project tsconfig.jsdom-tests.json test/rel04R10DurableDiscardIdentity.test.ts
~~~

To run the original witness, take *docs/android/evidence/rel04-r9-independent-39228/review-rel04R9Independent.ts.txt* from 4a37173 and copy it unchanged as *test/review-rel04R9Independent.ts* into both 513c12b and 4a37173. From each checkout run:

~~~sh
TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/review-rel04R9Independent.ts
~~~

The companion evidence directory contains the outputs and SHA-256 manifest. Verify it with *shasum -a 256 -c SHA256SUMS* from that directory.

## Closure and release gates

Implementation closure requires D1–D7 to pass independent retest, with the original witnesses and healthy paths still passing. The ambiguous-completion result must accurately reflect which facts are known. Release acceptance remains a separate hold for verified origin and distribution, scoped recovery wherever v2 Preview exposure can carry forward, merge-time deployment isolation and owner approval, fresh integration CI after MCP-CI-02 under separate authorization, activation and rollback readiness, AUTH-01 and supported-client requirements, and native/REL-03 supervised device acceptance. Verification was read-only on the PR. It used local synthetic tests and existing CI metadata.

