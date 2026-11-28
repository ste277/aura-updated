# AURA-ANDROID-REL-04 R17 — Focused Independent Verification Handover (39262)

**Ticket:** 39261 — Shared Recovery Decision Consolidation. **Responds to:** 39260 (NO-GO: G4 PARTIAL, G5 CLOSED, G6 PARTIAL; new G7, G8, G9).
**Architecture:** Option B (39256), retained. **Status:** READY FOR FOCUSED INDEPENDENT VERIFICATION (39262), subject to §6.

## 1. Revisions

| | Commit | Tree |
|---|---|---|
| Reviewed R16 head (39260) | `e94a86306bff8356447e35ef2530ebde18cfbdb6` | `43dba2e` |
| **R17 implementation** | `aff925946bfd39bcad2016b5711403d3fc2f4f57` | `4dab6b3` |
| Main at implementation | `b81faf3c8bfc7b333e2679d35e9724f05bdce220` (unchanged since 39260; no merge needed) | |

R17 runtime delta vs R16 (client only): `lib/offlineHabitQueue.ts`, `lib/activitySync.ts`, `lib/pendingReplayReconciliation.ts`, `app/page.tsx`, `components/HomeDashboard.tsx`, `components/PastActivityModal.tsx`. **No server, API, PostgreSQL schema, IndexedDB schema (`QUEUE_DB_VERSION` 2, stores unchanged), service-worker or middleware change** (`git diff e94a863 aff9259 -- apps/web/app/api apps/web/prisma apps/web/public/sw.js apps/web/middleware.ts` is empty).

## 2. Root cause and the one shared correction

In R16 three consumers each interpreted the durable evidence themselves: the projection (`readActivityOperations`: marker first, its body wins, a null-payload marker hides the copy), the fresh-submission check (in-memory projection only, so unloaded = "nothing open") and the explicit-Retry gate (an unverified marker plus a conflicting scan collapsed to "eligible, no copies"). They disagreed about whether the account had one exact usable operation.

R17 adds **`decideOperations(st, owner, q, only?)`** — THE account-scoped recovery decision. Per request id it evaluates the decision marker (via `decisionAuthority`, incl. receipt validation), every surviving copy (via `resolveIdentity`) and the retired localStorage state **together**, and yields one `status` (`pending | unresolved | conflict | confirmed | failed | discarded`), one `dispatchPayload` (or `null`), a display `body` and every `intents` entry the evidence names.

- A validated decision is final for its own payload; a surviving copy with another payload → `conflict`.
- No validated outcome: if the marker and copies name **more than one payload** → `conflict`, `dispatchPayload: null` (G7).
- An incomplete / proofless / malformed-receipt marker **never hides a live copy**: the single payload the evidence names is the intent; it is dispatchable when it comes from a live copy or a correctly bound marker (G9). An unbound marker's payload alone is never dispatchable.
- Paused / damaged / contradictory / retired copies → no dispatch payload; their titles still count as intents.

**Consumers (no other interpretation exists):**

| Consumer | Where | Rule |
|---|---|---|
| UI projection | `readActivityOperations` → `storedOperationOf` → `page.tsx applyStoredOperations` | body, `retryable`, `conflict`, `intents` come from the decision |
| NEW submission (G8) | `enqueueOwned({ newOperation })`, **inside the claiming read-write transaction** | an open operation matching the activity (`matchesActivityIntent`, the same rule as the in-memory `findRecoverableOperation`) → `recovery-required`, nothing written |
| Explicit Retry (G7) | `eligibilityGate` in the claiming transaction | eligible only if the claimed payload **equals** the decision's `dispatchPayload`; otherwise unresolved (`outcome-unknown`), nothing written |
| Automatic replay | `eligibilityGate` via `claimForDispatch` | a live copy is claimed only if it is the decision's dispatch payload |

**Page (`page.tsx`):** a fresh submission passes `newOperation` (Retry passes `explicitRetry`; "separate" passes neither). On `recovery-required` the candidate is withdrawn and the durable open operation is applied to the projection and offered ("Retry that entry" / Home Retry) — this works while startup reads are held. **Stale-read fencing:** one logical clock stamps projection reads at start and in-memory updates; a read older than the last applied read is discarded, a read never overwrites an operation updated after it started, and a read for another account is ignored. Retry is withheld where `retryable === false` (shared notice, Home card, Past Activity modal); the notice says the device holds conflicting copies.

Readiness contract (G8): the projection is presentation only. Whether a submission may proceed is decided in the claiming transaction, so an uninitialised, delayed, held or stale projection can neither admit a duplicate nor be read as "nothing open"; an unreadable store refuses (`storage-unavailable`; `readRecoveryDecision` → `null`, never `[]`). Read-only features are not blocked.

## 3. Witnesses — 39260 probes, unmodified

Reviewer probes run unchanged against a production build with disposable PostgreSQL 16 (port 55497).

| Probe | R16 `e94a863` (baseline) | R17 `aff9259` |
|---|---|---|
| startup — normal (control) | OK | OK |
| startup — held-projection (G8) | **FAIL** sentNew, retryVisible 0 | OK (heldReads 2, Retry visible, no new id) |
| startup — missing-marker-payload (G9) | **FAIL** sentNew, retryVisible 0 | OK |
| conflict (G7, Home + PG) | **FAIL** "Different marker activity" committed (row `5a09b43c-bd28-4562-9960-5ae107770776`) | Probe **times out** at its unconditional Retry click: R17 offers **no Retry** for a conflicting operation. Its assertion (no row with a changed title) holds — 0 rows; see §4 G7 |
| receipt (in-process G7 + matrix) | exit 1 (changed body committed) | exit 0 (projection body = live copy; Retry sends nothing) |
| timeline (regression) | — | OK |
| 429-separate (regression) | — | OK |

Logs: `docs/android/evidence/rel04-r17/baseline-r16-e94a863/`, `…/reviewer-probes-on-r17/`.

**Note for the reviewer's conflict probe:** it clicks `Retry` inside `[data-operation-id]` unconditionally. The R17 notice for that operation reads "Workout Check again · This device holds conflicting copies of this entry, so Aura won't send it." with no Retry button; making the click conditional lets the probe reach its own assertion.

## 4. Acceptance and negative controls

**`test/rel04R17RecoveryDecision.test.ts`** (jsdom, real page; CI math-core): 26/26 locally.
- W G7 / W G8 / W G9 on vendored R16 (`test/fixtures/rel04-r16-head`, provenance-checked against `e94a863`) — each reproduces on R16 (negative control) and is closed on R17 with exact POST counts, bodies, rows, copies and receipts.
- Storage failure (decision `null`, submission refused, copy kept); scope (unrelated and deliberately separate activities proceed); account isolation.
- **Decision matrix: 18 evidence combinations** (no marker, proofless, malformed / contradictory receipts, null-payload, field-incomplete, unbound, unparseable markers; valid receipts with and without conflicting copies; null discard; damaged and quarantined copies) — the decision, the projection, automatic replay and explicit Retry all agree.
- Page (Calendar / Past Activity, restart): control, **held startup projection**, null-marker, conflicting marker, and the shared notice; **stale-read fencing** (a snapshot computed before the recovery and delivered after it does not resurrect the confirmed operation).
- Negative controls: **N7** decision binding removed from the claim gate → conflicting body committed; **N8** in-transaction new-operation decision removed → duplicate with held projection (lib and page); **N9** marker-first rule → incomplete marker hides the live copy → duplicate. Page fence removed (manual control, `local-r17/negative-control-page-fence-removed.log`) → the fencing check fails (25/26).

**`test/rel04R17RecoveryChromiumDb.test.ts`** (production build, Chromium, PostgreSQL; CI `rel04-next-app-rendering`): 11/11 locally.
- G7 Home: notice shows "Workout", no Retry, no re-entry path, **0 POSTs after restart, 0 rows**, copy and marker unchanged.
- G8 held projection / G9 null marker / control: identical Calendar Save sends no new id (1 row); "Retry that entry" sends the original id and body; 1 row; valid v2 accepted receipt names it; no copy left.
- Control: after resolution, a deliberately new identical Calendar entry gets its own id, row and receipt.

**Preserved regressions on the R17 build:** R16 browser suite 15/15, R15 browser suite 15/15, reviewer timeline and 429-separate probes pass.

**R16 suite adjustments (`test/rel04R16OperationCorrection.test.ts`, 56/56):** every other assertion unchanged.
1. G5 after-send: an explicit Retry that may not be sent now reports `outcome-unknown` (unresolved) instead of `not-stored` — `not-stored` would close an operation that may exist. All safety conditions (1 POST, no settlement, copy kept) unchanged.
2. N11: the negative control now disables **both** layers of the shared contract (the in-memory match and the new-operation decision), so it still demonstrates the duplicate.
3. G6 source pin: allows the new `retryable` argument of `ActivityRecoveryRequiredError`.

## 5. CH15

Unchanged. The historical R5 worker fixture and both CH15 assertions are untouched; CI-DEBT-10 and the local 29/30 limitation remain open.

## 6. CI and local results

Local on `aff9259` (clean tree): math-core and DB sweeps — see `docs/android/evidence/rel04-r17/local-*-aff9259/manifest.json`. Hosted CI: see §6.1 (added after the run).

## 7. Limitations and release conditions

- The activity match only decides when to ask; an open operation for an activity withholds a NEW identical-activity entry until it is recovered or the user chooses "separate". An unresolved operation whose evidence names no payload and no title (e.g. a null-payload marker with no copy) cannot be matched and is shown with Check again only.
- A conflicting operation is never sent; it is resolved only by positive evidence (Check again's bound GET), or discarded at sign-out.
- Ticket **39243 stays OPEN** (writer-free origin, rollback allowlist with retained legacy tabs/workers and offline-restored profiles, account-scoped recovery of unreadable v2, Android device/session acceptance).
- No merge, deployment, Production activation, device operations or release configuration changes. Auto-merge and Auto-fix off. Production remains REL-05 `dpl_x9NB8` (`a39f398`).

## 8. Reproduce

```
TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R17RecoveryDecision.test.ts
DATABASE_URL=<disposable, 56 migrations> npx ts-node test/rel04R17RecoveryChromiumDb.test.ts   # builds apps/web unless REL04_SKIP_BUILD=1
```
Reviewer probes: copy `review-39260-*.local.ts.txt` into `test/` without `.txt`, `REL04_SKIP_BUILD=1 npx ts-node test/review-39260-<name>.local.ts`.
