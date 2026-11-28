# AURA-ANDROID-REL-04 R11 — Independent Verification Handover (ticket 39245; review 39244)

**PR:** #392 · **Date:** 2026-11-26 · **Ticket 39243 stays open.** Not merged, not deployed, not activated; Auto-merge off; separate from REL-05. No branch synchronization with main.

| Item | SHA |
|---|---|
| Reviewed (39244) | final head `4a3717362070d2f65a170001a59048fafad6098f`, implementation `8f3d3167af2c48ea463d454600dc94358e4e7249` |
| **R11 implementation** | `abdd9d8192b77b9fcb844e9ad1e98cddded9b230` |
| **R11 handover head** | the commit adding this file (handover, report and evidence only; no code) |
| CI on the implementation (automatic) | run 45870363531, integration `aa2bcc2` (into `main` `a39f398`): **8/9**, see "CI" below |

## Structural correction

These replace the separate per-witness checks, all in `apps/web/lib/offlineHabitQueue.ts` and `apps/web/lib/signOut.ts`.

| Area | R11 |
|---|---|
| Identity resolution | `resolveIdentity(owner, contextOwner, outer, value, partial)` is the only way any copy is given an identity: IndexedDB record, v2, aura_q3 or aura_q4. It returns `valid`, `damaged`, `incomplete` or `contradictory`, from the storage context (key or record account; outer id, including a missing index or an incomplete aura_q4 key) plus the nested identity, and never from the signed-in account. Only `valid` copies can be sent. `valid` and `damaged` copies are discarded durably. `incomplete` and `contradictory` copies are preserved, never deleted, and block every candidate id. Unreadable storage leaves the queue unreadable (unchanged). |
| Transmission | `eligibilityGate` is evaluated in the claiming read-write transaction by both direct submission (`enqueueOwned`) and replay (`claimForDispatch`). It resolves every copy of the account, so a contradiction written before the claim is seen. Session eligibility (lease and transition) is checked with no await before the send. Sign-out's transition refuses any new submission and aborts the client side of an in-flight one; that activity is reported as possibly sent, never as cancelled. |
| Confirmed discard | The discard set is exactly the confirmed snapshot's identities, re-resolved inside the transaction; a replacement or newly appearing identity is never decided or deleted. A fresh claim from another context keeps the whole logical activity. Decisions commit before any cleanup, as in R9/X3. |
| Outcomes | Each activity gets exactly one outcome: removed, cleanup-pending, kept in flight, failed, uncertain or unidentified. The decision stores `possiblySent`, so it survives cleanup retries. An unconfirmed commit is checked by a separate read (decision present: cleanup-pending; absent: failed; read impossible: uncertain), never assumed rolled back. Each send is attributed once. Messages make no claims about later syncing or "never sent" for kept or unidentified copies. |

## Witnesses: before (unchanged R10) and after (R11)

The reviewer's `review-r10-edge.ts` ran unchanged on R10 `4a37173` and produced output identical to their `edge.log`. On R11 it shows every finding corrected (`docs/android/evidence/rel04-r11/`).

| ID | R10 (reviewer, reproduced) | R11 |
|---|---|---|
| D1 missing outer id, intact nested identity | no outcome, no decision; resubmission confirmed, 1 row | removed, 1 decision; resubmission refused, 0 rows |
| D2 contradictory IndexedDB candidate | direct submission refused but claim accepted; late contradiction replayed, 1 row | claim refused; replay 0 attempts, 0 rows |
| D3 aura_q3/aura_q4 key under A, value naming B | skipped; A 0 paused; A's same id confirmed, 1 row | contradictory: A paused 1, refused, preserved, reported unidentified; B unaffected; 0 rows |
| D4 identity replaced after confirmation | replacement deleted and decided; confirmed id undecided | confirmed id decided; replacement neither deleted nor decided |
| D5 damaged in-flight copy | retired copy removed, reported removed and possibly sent while the claim remained | whole activity kept in flight; damaged copy unidentified (no "never sent"); one send counted once |
| D6 prior send across cleanup retry | retry reports removedPossiblySent 0 (row exists) | retry reports removed 1, possibly sent 1 |
| D7 aura_q4 key without a record id | trusted: deleted and decided | incomplete: preserved, no decision, unidentified |
| P3 committed transaction, acknowledgement lost | reported failed (as a rollback) | verified: cleanup-pending, no cleanup attempted, refused, 0 rows |

The reviewer's earlier 39228 probe is still closed on R11. Their unreadable-v2 browser probe shows the same fail-closed behaviour (release condition below).

## Reproduce

```
TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R11StructuralQueue.test.ts
```

Expected **38/38**:
- fixture provenance against `8f3d316`;
- the 39244 evidence checksums;
- each witness above reproduced on the vendored R10 head and then corrected;
- the X1–X9 matrix: identity classes in every format, direct versus replay, contradiction before the claim, sign-out versus an in-flight request (server saw it or not) and no new transmission after confirmation, replacement identities, verified rollback versus uncertain, cleanup retries, mixed outcomes, cross-account isolation, healthy online and offline paths.

Deterministic barriers: Device gates, IndexedDB prototype hooks. Every discarded or contradictory request asserts its server rows.

The reviewer's own probe, run directly:
```
cp docs/android/evidence/rel04-r10-independent-39244/review-r10-edge.ts.txt test/review-r10-edge.ts
TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/review-r10-edge.ts
```

## Results (local, `abdd9d8`)

| Run | Result |
|---|---|
| R11 suite | 38/38 |
| math-core (every CI command) | 252/252 |
| Earlier suites, assertions unchanged | R4 27, R5 16, R6 22, R7 38, R8 43, R9 36, R10 25, account isolation 50, sign-out 19, token replay 8, replay reconciliation, reload visibility |
| Chromium / Next app | 29/29 / 14/14 |
| DB | **75/76**: `multiOccurrenceRhythmMoveCapacityDb`, the wall-clock issue below |
| Typechecks | exit 0 ×3 |

## CI (reported separately, not rerun)

- Run **45870363531** on `abdd9d8`, started automatically by the push: **8/9**, not green.
- The failing job is "Day Constructor acceptance DB tests", with one assertion in `multiOccurrenceRhythmMoveCapacityDb`, at 23:26 IST. Integration commit: `aa2bcc2`.
- This is a suspected wall-clock-window failure of that test, unrelated to R11, and recorded separately in `docs/android/evidence/rel04-r11/CI_STABILITY_NOTE_45870363531.md` with the logs, the assertion, the time and the test code. The test is not modified in this PR.
- The push of this handover commit also starts an automatic run; it is recorded in the PR body.

## Unreadable v2: separate release acceptance condition (not R11 scope)

**Behaviour is unchanged and fails closed.** For an account whose v2 array is unreadable on an origin and profile:
- no new activity is stored or sent (`storage-unavailable`), and queued activity is paused;
- sign-out discards readable entries but preserves the opaque bytes and reports one unidentified entry;
- the block persists across sign-in, account switching and restarts on that profile;
- other accounts and clean profiles are unaffected.

**Affected population.** Only origin/profile pairs that ran a PR #392 build between `d09449b` (the first v2 writer) and the R8 retirement:
- the SSO-protected Vercel Preview of this branch (a READY build of `d09449b` exists);
- any internal or sideloaded native shell pointed at such a Preview origin;
- shared test profiles.

Not affected: Production lineage (`ac46fc3`, `7a9af83`), `main` and the tags; no public release contains v2.

**Required before release to an exposed population:** a supported, account-scoped support or admin recovery procedure for the affected key. It must preserve unrelated accounts and queued data and be exercised on the release candidate. Verify the native origins and any private distribution first. No recovery UI, silent deletion or broad storage reset is part of R11.

## Checksums (sha256)

| File | sha256 |
|---|---|
| `apps/web/lib/offlineHabitQueue.ts` | `7cf8faf1dbfa90fc18a118f99c490b1cf06ce1994fd28240ad7da36d8d021bf3` |
| `apps/web/lib/signOut.ts` | `fc75da09a3893c6e9cfa414823fa384063c97f1aa7075dbc0ddc7fd5043e512e` |
| `apps/web/lib/activitySync.ts` | `bcf78bfe4b668f50e4ecc9b72117104df67795a58ad2bb8633c0c0dcf22ae96a` |
| `test/rel04R11StructuralQueue.test.ts` | `9aa02af5b43a88ff22ca99085009942608cb7658752ace7511cc9ab6ea10ff38` |
| `test/fixtures/rel04-r10-head/offlineHabitQueue.ts.txt` | `a990b4f45537a7d04e95f0719c9d1452a60a1475906aa51e4439a95458d40ffc` |
| `test/fixtures/rel04-r10-head/activitySync.ts.txt` | `bcf78bfe4b668f50e4ecc9b72117104df67795a58ad2bb8633c0c0dcf22ae96a` |
| `test/fixtures/rel04-r10-head/signOut.ts.txt` | `47cd86e587c17a7cd83e7c385cb5b1662a145f543690212c306ea66b48c083d5` |
| `docs/android/evidence/rel04-r10-independent-39244/SHA256SUMS` | `044f2224ca9b936633b0835e79cdb53386c00265be212a512f27aeff0b4d7ff9` |
| `docs/android/evidence/rel04-r11/README.md` | `38ce047be741235eae1c86e8974c3d5db851cbfec27d2a79722f1e220c0d4af1` |
| `docs/android/evidence/rel04-r11/CI_STABILITY_NOTE_45870363531.md` | `61854e4267bac618e463669be3e9e5c666e462973118770e450212222f1ac825` |
| `docs/android/evidence/rel04-r11/ci-45870363531/SHA256SUMS` | `9db9796785365ad867fca9aa7a15120fe31d7cb962ad11d10fd07c472f8f735b` |
| `docs/android/evidence/rel04-r11/math-core-tests/manifest.json` | `77d365dd87c085be96e01bfa8c723aaf82093cca14f0001d04b4eb54767ff007` |
| `docs/android/evidence/rel04-r11/db-and-browser-tests/manifest.json` | `1ab2814addc027956185bd551e8818f7c13595ad9f0e9df79e67c77bbbf97530` |
| `docs/android/evidence/rel04-r11/typecheck/typecheck.log` | `b447ac6c7713d69e34a0aa003220dffa1efe705ea97a6d77ec90b0521146e04f` |
| `docs/android/evidence/rel04-r11/math-core-tests/logs/248-test_rel04R11StructuralQueue.test.ts.log` | `6190e2adf90289ce7be613e1ee756514951c3b0dd984abd4cb65a305151a4322` |
| `docs/android/evidence/rel04-r11/review-r10-edge.on-4a37173.log` | `2942d4884afb6c5c173adbc0e9febd66df326d703985892f1c3fe4da0e3b07b9` |
| `docs/android/evidence/rel04-r11/review-r10-edge.on-r11.log` | `3739379e1e504e0d6f2784f07cb1c06e0279c1615099414be1dc0cdf7ed53df8` |
| `docs/android/evidence/rel04-r11/review-rel04R9Independent.on-r11.log` | `32e838b8e932f3e57cafa197df347b80ee058fb6b3138da3849d686d72332acd` |
| `docs/android/evidence/rel04-r11/review-r10-browser.on-r11.log` | `07a726dc8ca5f5c43408a1df9c5761088722c22d0a31fb07266833093544445e` |
