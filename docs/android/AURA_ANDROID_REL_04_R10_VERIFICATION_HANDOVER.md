# AURA-ANDROID-REL-04 R10 — Independent Verification Handover

**PR:** #392 · **Date:** 2026-11-26 · Not merged, not deployed, not activated; Auto-merge off; separate from REL-05.

| Item | SHA |
|---|---|
| Reviewed (39228-R9) | final head `9385eb2167b302daa7ce05f281d9af1679f577e2`, implementation `513c12b6d9a824bbe86b3e63df12a3aede21ac8f` |
| **R10 implementation** | `8f3d3167af2c48ea463d454600dc94358e4e7249` |
| R10 final head | the commit adding this file (report + evidence + handover only) |
| Automatic CI (not the authorized fresh integration CI) | run 45858803540 on `8f3d316`, merge ref `2824c22` into `main` `c8a9ca7`: success 9/9 |

## Scope (R10 only)

39228-R9 left **X2 PARTIAL** (X1 and X3 closed). R10 is limited to durable discard identity and sign-out reporting.

| 39228-R9 witness | R9 `513c12b` | R10 |
|---|---|---|
| Historical v2 entry, valid account + request id, damaged timestamp | removed with **no decision**; same request **confirmed**, 1 server row | discarded with a durable decision; request refused; **0 rows** |
| IndexedDB record, valid account + request id, damaged timestamp | same defect, 1 row | same correction, **0 rows** |
| One unsent log removed + one possibly-sent log pending cleanup | "may already have been sent" attributed to the **removed** log | removed 1 (not possibly sent); cleanup-pending 1 (possibly sent); message attributes it only there |

**Root cause.** Identity was derived only after full payload validation: an entry with a malformed non-identity field had no request id, so the discard deleted it without a decision. `removedPossiblySent` mixed the removed and cleanup-pending categories.

**Correction (`apps/web/lib/offlineHabitQueue.ts`, `apps/web/lib/signOut.ts`).**
- `activityIdentity(value, owner, expectedCrid)` establishes identity from identity fields alone (the storage location's own id, the value's `clientRequestId` and `ownerUserId`). It is used by retired-source inspection, the IndexedDB read, `enqueueOwned`, `claimForDispatch` and `discardOwned`.
- **Identified** activities are discarded durably whatever their other fields. **Missing, malformed or conflicting identity** (including a stored value naming another account) is preserved in quarantine: never discarded, never eligible, reported as "couldn't be identified safely".
- An unparseable v2 array stays **opaque**: preserved, and it blocks the account's transmission.
- Ownership is never inferred from the signed-in account.
- `discardOwned` puts each logical activity in exactly one outcome: removed, durably discarded pending cleanup, or not discarded (failed or unidentified). "Possibly sent" is counted within each category.

Unchanged: one transmission boundary (R9), one decision per transaction before any cleanup, no new format, migration or marker expiry, no worker change, and the released `offline_habit_queue` read-only contract.

**Earlier assertions changed** (made stricter, not weakened):
- R5 T2: a source whose key and value disagree is one conflicting entry, and both ids are now refused.
- R9 E4: an unparseable v2 array is now preserved by the discard, where before it was removed, and transmission stays blocked.

## Reproduce

```
TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R10DurableDiscardIdentity.test.ts
```

Expected **25/25**:
- fixture provenance, including the vendored R9 head `test/fixtures/rel04-r9-head`;
- the checksum of the preserved reviewer evidence;
- W1 (v2, IndexedDB) and W2, each reproduced on R9 and then corrected;
- M1–M10: non-identity damage in every format; missing, malformed and conflicting identity; mixed copies; foreign records; failed and ambiguous transactions; cleanup failure and retry; 20 submit/discard interleavings; per-category reporting with duplicates; healthy online and offline submission; the released legacy array.

Every discarded request in W1 has zero server rows. The reviewer's probe (`review-rel04R9Independent.ts`) and logs are preserved unchanged in `docs/android/evidence/rel04-r9-independent-39228/` with `SHA256SUMS`.

## Results

| Run | Result |
|---|---|
| math-core, every CI command | 251/251 |
| DB / Chromium / Next app | 76/76 / 29/29 / 14/14 |
| Closed-finding suites | R4 27, R5 16, R6 22, R7 38, R8 43, R9 36, account isolation 50, sign-out 19: all pass |
| Typechecks | exit 0 ×3 |

## Checksums (sha256)

| File | sha256 |
|---|---|
| `apps/web/lib/offlineHabitQueue.ts` | `a990b4f45537a7d04e95f0719c9d1452a60a1475906aa51e4439a95458d40ffc` |
| `apps/web/lib/signOut.ts` | `47cd86e587c17a7cd83e7c385cb5b1662a145f543690212c306ea66b48c083d5` |
| `apps/web/lib/activitySync.ts` | `bcf78bfe4b668f50e4ecc9b72117104df67795a58ad2bb8633c0c0dcf22ae96a` |
| `test/rel04R10DurableDiscardIdentity.test.ts` | `dd3dc9b213a350bc661dcc4f836abed1692128ba38d54c004cb21bcc7979e4f5` |
| `test/fixtures/rel04-r9-head/offlineHabitQueue.ts.txt` | `129060d0674d3a40d10aa5649223e444854a68a59732c7c2b4977ae5aec4cdfc` |
| `test/fixtures/rel04-r9-head/activitySync.ts.txt` | `bcf78bfe4b668f50e4ecc9b72117104df67795a58ad2bb8633c0c0dcf22ae96a` |
| `test/fixtures/rel04-r9-head/signOut.ts.txt` | `b04c54cc1ce74b467b9dd6e810a61a1eebcc0e73d0ae578049e3489d04ba899c` |
| `docs/android/evidence/rel04-r9-independent-39228/SHA256SUMS` | `8cd13bb6344bd05ee6c0b582b60cdf2380c94978819cb82aa8ad058cf1773d44` |
| `docs/android/evidence/rel04-r10-8f3d316/README.md` | `2e7ccdf16abf96568ba29d4f2cc766b71aecb83682243704d27a4637f46b83a1` |
| `docs/android/evidence/rel04-r10-8f3d316/math-core-tests/manifest.json` | `0912aa5923807e7ee3c7ec655581395e76fa9e041ed257c2e2f0e86a78ce4f95` |
| `docs/android/evidence/rel04-r10-8f3d316/db-and-browser-tests/manifest.json` | `1e8f0fbecdc558c3449e1f06ff0a0421bce619ad9f626f2a0cfda76634ceca44` |
| `docs/android/evidence/rel04-r10-8f3d316/typecheck/typecheck.log` | `c82a4510f7ab17a9dc549d2e7bd1391b37f5b1a8d8ad37a8f02f1915f19b3715` |
| `docs/android/evidence/rel04-r10-8f3d316/math-core-tests/logs/247-test_rel04R10DurableDiscardIdentity.test.ts.log` | `dc2a4e40d2779ec5ebf1d99bfe0c31df0d81d1b916a65742c6b31201d1170efd` |

**Limitations.**
- Unidentifiable development-format data is preserved, not removable in-app. An unparseable v2 array keeps the account's transmission blocked until it is removed outside the app; this is development data only.
- Not device evidence.
- Fresh authorized integration CI stays on HOLD until MCP-CI-02 is on main.
