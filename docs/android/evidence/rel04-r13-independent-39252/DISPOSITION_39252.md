# 39252 AURA-ANDROID-REL-04 R13 independent verification

**Disposition — NO-GO for controlled integration.** Keep ticket 39243 open and Auto-merge off. R13 closes the four exact E1–E4 witnesses. A new lost-acknowledgement interleaving still tells the user a saved activity was never saved or sent, which can lead to a duplicate under a new request ID. Two further checks disprove R13's physical-removal guarantees. These are implementation findings. Origin isolation, scoped v2 recovery and Android release acceptance are separate.

## What was reviewed

| Item | Full revision |
|---|---|
| Unchanged R12 comparison | 6373fd9eac74aaac2596aefaeecfd147482dfb26 |
| R13 implementation | a8a976733d73d8acc5eb13e2af687f3648204471 |
| R13 handover | f6a8cbeff26ac344828201a80082cbf8bab662aa |
| Integration base for both runs | 555116639486baa2bd84a8c1678da96838d61213 |
| Implementation CI checkout | 20a0712d08c447bfc6cc285c623cfd5d1a8a539c |
| Handover CI checkout, attempts 1 and 2 | efcaa07e08a1452fd3bb278fd76af9e6d396a051 |

The R12, implementation and handover commits form a direct parent chain. The four runtime changes are Home, activity sync, the queue and sign-out. Supporting changes add one CI invocation, one suite, three fixtures and preserved reviewer evidence. R13 changes no historical assertion. The handover changes 343 paths, all documentation and evidence. Reviewed 39249 directly. The R13 commit, handover and PR record the 39250 correction. The supplied request and PR record the 39251 approval, and the original attempt metadata and manifests establish what ran. Standalone 39250 and 39251 ticket bodies were unavailable in the accessible sources. [Implementation](https://github.com/ste277/aura-updated/commit/a8a976733d73d8acc5eb13e2af687f3648204471) [Handover](https://github.com/ste277/aura-updated/commit/f6a8cbeff26ac344828201a80082cbf8bab662aa)

## Original E1–E4 and updated N1–N6

The 39249 TypeScript probe was copied byte-for-byte and run against 6373fd9 and a8a9767. It reproduces the R12 failures and observes the following R13 results. Local counts come from the real API handler over the synthetic harness store.

| Finding | Disposition | R12 and R13 comparison |
|---|---|---|
| E1 | **CLOSED** | R12 claimed B's replacement and posted with A's lease, producing one A row. R13 commits the same replacement injection, posts zero, and leaves B's record with no claims or decisions. |
| E2 | **CLOSED** | R12 returned storage-unavailable while committing a row that replay later sent. R13 returns the same initial status after aborting the write. Zero rows, claims, decision markers and replay POSTs. See F1 for a different late-outcome schedule. |
| E3 | **CLOSED** | R12 reports removed after a visible Q3 write during the reporting scan. R13 sees the same surviving Q3 copy, reports cleanup pending, and preserves a marker that prevents retry. |
| E4 | **CLOSED** | An unreadable final IndexedDB scan with a known decision now reports discarded-unverified instead of asserting that a copy could not be removed. F2 and F3 test different storage observations. |
| N1 | **CLOSED** | Replay verifies the inspected account, request ID and canonical payload at claim against the exact physical ID. A/B same-ID same-payload replacement, changed request ID and changed payload all preserve replacements. If the equivalent row moves to a different physical ID, the stale replay attempts zero. A new inspection sends it once. |
| N2 | **PARTIAL, activation condition outstanding** | The original two visible-write schedules remain fail-closed. Cross-context ordering still depends on excluding historic writers from the release origin. |
| N3 | **CLOSED** | A response to the earlier legitimate send preserves the later contradictory copy, records only the claimed decision and leaves one A row and zero B rows. |
| N4 | **CLOSED** | The original missing outer owner and incomplete Q4 cases preserve bytes and records, write no decisions and refuse the candidate. |
| N5 | **PARTIAL** | Known late survivors are counted correctly in the original witnesses. An opaque source can still hide a copy while the UI asserts removal, and a stale provisional cleanup error overrides a later verified absence. |
| N6 | **CLOSED for the reported acknowledgement cases** | A recovered discard decision with no copy reports removed. A failed decision reconciliation reports uncertain. A known decision with unreadable final physical state reports discarded-unverified. |

Original D2, D3, D7 and P3 and previously closed D1, D4, D5 and D6 pass the preserved probes. Account switching, sign-out fencing, local rollback, cross-account copies, one healthy direct send and one offline replay pass the controls. The retired released-unowned array remains outside owned transmission and discard.

## Independent implementation blockers

| ID | Disposition | Deterministic witness and result |
|---|---|---|
| F1 — a settled request becomes “unsaved” after lost enqueue acknowledgement | **OPEN, transaction integrity blocker** | Let the first enqueue commit the row and claim, withhold its acknowledgement, advance the test clock past the 60-second lease, and replay in another verified A tab. Replay sends the original ID once, settles it and leaves a durable marker with no active copy. Deliver the synthetic lost acknowledgement to the first caller. R13 reads only active equivalents, overlooks the settled marker, and returns storage-unavailable. Home's matching branch says the activity was not saved or sent and invites retry. A same-ID retry cannot create a second row. Emulating the invited new Home submission with its fresh ID produces **two A rows** with the same activity payload and different IDs. This is an injected acknowledgement fault and deterministic lease expiry, not a claim that a real browser emitted both transaction events. [Queue reconciliation](https://github.com/ste277/aura-updated/blob/a8a976733d73d8acc5eb13e2af687f3648204471/apps/web/lib/offlineHabitQueue.ts#L720-L732) [Home status and retry](https://github.com/ste277/aura-updated/blob/a8a976733d73d8acc5eb13e2af687f3648204471/apps/web/app/page.tsx#L1454-L1464) [Home failure message](https://github.com/ste277/aura-updated/blob/a8a976733d73d8acc5eb13e2af687f3648204471/apps/web/app/page.tsx#L1538-L1549) |
| F2 — opaque retired source invalidates absence | **OPEN, cleanup reporting** | Put an identifiable IndexedDB activity alongside the exact same item in a truncated v2 array. Confirm sign-out. It writes a discard marker, removes the active copy and preserves the opaque bytes, with zero POSTs and a refused retry. It reports removed=1 and unidentified=1 even though the retired bytes still contain the item. Quarantine correctly records that the array is opaque, but physical verification considers only named candidate IDs and treats the absence of candidates as evidence of absence. No concurrent old writer is needed. [Physical verification](https://github.com/ste277/aura-updated/blob/a8a976733d73d8acc5eb13e2af687f3648204471/apps/web/lib/offlineHabitQueue.ts#L953-L975) |
| F3 — provisional cleanup error overrides final verified absence | **OPEN, cleanup reporting** | Let removal of the confirmed Q3 source succeed, then throw once on its immediate read-back. The later complete scan can read storage and sees no surviving copy. The result still says cleanupPending=1 and tells the user Aura could not delete the copy. The marker exists, both stores are empty, and zero rows were posted. The provisional flag overrides the final successful observation. [Cleanup and final report](https://github.com/ste277/aura-updated/blob/a8a976733d73d8acc5eb13e2af687f3648204471/apps/web/lib/offlineHabitQueue.ts#L1059-L1081) |

## Account and transaction assessment

**Account and queue identity — CLOSED in the tested supported paths.** Home, Timeline and the wired calendar modal use submitActivityLog with a verified lease. The queue stores and claims in the account-scoped IndexedDB transaction. Replay snapshots then claims the same account, request, payload and physical ID, fences on the claimed account before HTTP, and settles the token's authority. The real handler and account boundary independently bind the request to the authenticated account. The unused useHabitLogs hook and the modal's optional direct fallback have no caller on the supported write path. The production sign-out caller uses discardOwned and its snapshot. discardRecords has no application caller.

The independent direct tests commit owner-only, payload-only, request-ID and physical-record-ID replacements before the transaction runs. A payload conflict refuses with zero POSTs. An unrelated same-account request or B copy survives while A submits through a newly authorized A claim. The equivalent physical relocation is claimed under its new ID. The probe logs the exact body and claim owner at the POST. The unchanged R12 E1 replay is a negative control for the account guard. R13's wrong-token mutation and the independent payload/refusal controls further distinguish meaningful rejection from a no-op test.

**Transaction outcome — OPEN.** The did-not-write, rollback, late-storage-failure after known commit, and unresolved acknowledgement paths work in the original cases. The independent unresolved case retained the exact request ID, produced zero immediate POSTs, and replayed once after expiration, with one row on the server and a settled marker. A server acceptance followed by local settlement failure returned confirmed. Replay sent the exact same account and body a second time, produced one total row, and cleared the local copy with a decision. Server uniqueness is per user and request, leaving a fresh-ID retry unprotected. F1 defeats the stronger outcome invariant even with clean release storage.

The existing IndexedDB architecture can enforce the invariant using one reconciliation contract across enqueue, replay, settlement and discard. Read the durable account/request/payload decision before interpreting active-copy absence, and distinguish a confirmed abort, a known queued record, an already settled or discarded request, and a genuinely unknown outcome. Where the device cannot establish a terminal state, keep the original ID for reconciliation and keep Home's fresh-ID retry path out of that state. A separate backend or a new queue format is not required to distinguish these outcomes. The browser still cannot make localStorage and IndexedDB one transaction.

**Sign-out and cleanup — PARTIAL.** Durable decisions precede physical cleanup and fenced requests do not resurrect. A runtime-owned copy is deleted only for the approved logical identity. A replacement identity and other accounts' pending work survive. For presentation, the same physical observation should drive each result: a verified remaining copy, verified absence, or unknown. An opaque source that could contain that request must count as unknown unless another verified survivor already establishes that something remains. A fully successful final verification supersedes a provisional cleanup error. Report the discard decision independently of physical state. The account-scoped recovery procedure must leave unrelated or unidentified data untouched.

## Legacy writer safeguard and release isolation

The 39249 origin probe and result were verified byte-for-byte as part of the 34 preserved items. It ran an actual historical writer in Chromium. A retained legacy tab could write after the same origin replaced the app. After restart the historical worker served an explicitly seeded cached legacy navigation, whose page also wrote. The separately keyed origin saw neither write. The cache was seeded as an adversarial test and does not prove any deployed client cached that response. Workers can supply the historical page even though the older page performs the localStorage write. R13 did not remove old scripts, tabs or profiles.

**Required before activation.** Record a writer-free release origin and a rollback allowlist excluding R1–R3 writers and R4–R7 migrators. For an exposed population use a clean origin that has never served those builds. With the actual release candidate and approved rollback, exercise each supported browser/WebView class using retained historical tabs, offline worker navigation and a restored profile. Show a successful old-origin write as a control, zero legacy mutations and zero retired data crossing into the release origin, correctly attributed online submission and replay, and fail-closed behavior for a visible contradiction on a disposable historical origin. Verify the native origin and record both artifact SHAs. Same-origin coexistence with unmodified writers leaves N2 open. Separately test a supported account-scoped recovery procedure for unreadable v2 before releasing to exposed Preview, internal or sideloaded users. The unchanged Chromium v2 probe confirmed byte-for-byte preservation, zero sends for the affected account across sign-out and restart, and healthy submission for B and on a clean profile. [Web Storage concurrency](https://html.spec.whatwg.org/multipage/webstorage.html) [Storage origin keys](https://storage.spec.whatwg.org/#storage-keys)

**Direct repository and deployment findings.** GitHub shows #392 open at f6a8cbe and Auto-merge null. Neither R13 commit is in fetched main. Vercel management metadata still names main for Production, reports protected previews outside custom domains, and retains the Preview-only Git build rule excluding staging. The live alias resolves to deployment dpl_x9NB8B9N5vVvPxVWRM8bRcxjTxqM, commit a39f398. The Production deployment inventory shows no R13 deployment, and the alias is unchanged. That supports no Production activation on the inspected infrastructure. It does not establish the origins of all private/sideloaded clients or activity outside the inspected project. No production service traffic, databases or secrets were accessed. Ticket 39243 remains open per instruction and the PR record. No independent tracker mutation or tracker status query was performed. [PR #392](https://github.com/ste277/aura-updated/pull/392)

## Regression and CI evidence

All 17 targeted local suites passed, including R13 28/28, R12 36/36, R11 38/38, account isolation 50/50 and SSR agreement 21/21. Real local Chromium passed 29/29, and the unchanged unreadable-v2 probe passed. The supplied exact-head sweeps verify 254/254 math-core commands and 78/78 DB/browser commands (76 DB, Chromium 29/29 and Next rendering 14/14). Independent verification matched all 332 log hashes, environments, commands and exit codes against pinned manifests, instead of re-executing the entire sweep. The phase tests run against a synthetic handler store. The unchanged real PostgreSQL habitLogIdempotencyDb test passed against a fresh disposable PostgreSQL 16 instance with all 54 migrations. It verified sequential and racing same-ID writes, distinct IDs and account-scoped duplicate protection. The cluster was stopped after the test.

| Run and attempt | Verified outcome |
|---|---|
| 45985719059 attempt 1 | 9/9, a8a9767 paired with 20a0712. Existing job checkout and the merge parents agree. |
| 45989628096 attempt 1 | **8/9**. Ephemeris job 140473871872 failed the final S3 Bob bootstrap/render assertion at 17:04:42 IST. |
| 45989628096 attempt 2 | Ephemeris job 140485698496 passed S3 at 17:29:42 IST. Both Ephemeris job logs show checkout efcaa07. GitHub duplicates inventory job IDs for the eight successes in its attempt-2 response, but each has the exact original start time, end time and step outcomes. Only Ephemeris executed again. Cumulative **9/9 after targeted rerun**. |

The preserved S3 log shows the previous checks passed, including immediate removal of Alice's data while checking. The failing composite assertion checks one Bob bootstrap, the account header and the DOM after a fixed settle(14). The logs do not identify which subcondition missed. The source and its relevant Plan Day, AccountScoped and account-session dependencies are unchanged by the R13 delta. The implementation integration passed, the initial local suite passed 21/21, and three additional unchanged local runs all passed 21/21. A timing-sensitive stability finding separate from R13 has **moderate confidence**. The diagnosis of settle(14) specifically remains a hypothesis, and neither the targeted retry nor local passes prove it. The failing attempt remains preserved. [Implementation run](https://github.com/ste277/aura-updated/actions/runs/45985719059) [Failed job](https://github.com/ste277/aura-updated/actions/runs/45989628096/job/140473871872) [Targeted rerun](https://github.com/ste277/aura-updated/actions/runs/45989628096/job/140485698496)

## Checksums and reproduction

Verified 16 handover hashes, all 34 preserved R12 files against the independent originals and three historical runtime fixtures against unchanged R12.

| Anchor | SHA-256 |
|---|---|
| R13 math-core manifest | 966ad6f025368ee3583ae2465052da0173eb57ce2cf28799b311b71a10f53493 |
| R13 DB/browser manifest | bce774621d2631bbd0695c4a3881081f8965eb5a4788b22370c5a83f8ec881e1 |
| R13 28/28 suite log | 662948fe4236568dfba993cf92a4b9bb5acd7c53e347c8ef8582e46db4acdc37 |
| Preserved R12 independent manifest | 2355dd2ea1915ed65e972076774eefe2dbf6cca7b1118aa77005a5222b5ed15b |
| Supplied CI attempt-1 manifest | fb3eb95b92e7bfc2502748ee96c42164f45d7166df70e7faa6564340b8b16b5f |
| Supplied CI attempt-2 manifest | 7ece0c6f9ba9ad245d15e1a7a456ed317a5020bb323929cfbcb2a6fa80be0dad |

Copy *review-r13-independent.ts* to *test/* in a disposable a8a9767 checkout with project dependencies. The independent probe logs F1–F3 and the controls. Copy the preserved *review-r12-independent.ts* from the companion evidence into both a8a9767 and 6373fd9 to reproduce E1–E4 unchanged. Use:

~~~sh
export TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}'
npx ts-node --project tsconfig.jsdom-tests.json test/review-r13-independent.ts
npx ts-node --project tsconfig.jsdom-tests.json test/review-r12-independent.ts
npx ts-node --project tsconfig.jsdom-tests.json test/rel04R13QueueIntegrity.test.ts
~~~

From the handover checkout, invoke *verify-integrity.py* with the workspace containing the earlier independent evidence as its sole argument. From the companion directory, run *shasum -a 256 -c SHA256SUMS*. The CI subdirectory preserves both supplied bundles without changing their bytes. Run *shasum -a 256 -c SHA256SUMS* and *shasum -a 256 -c SHA256SUMS.attempt2* there to verify each.

**Closure recommendation.** Keep 39243 open. Independently retest F1–F3 with all original controls before controlled integration. Record and exercise N2 origin protection and the approved rollback, keep unreadable-v2 recovery for exposed populations, and retain Android/native acceptance and owner authorization as separate gates. This turn did not alter the implementation, synchronize the PR branch, rerun CI, merge, change origins or activate anything.

