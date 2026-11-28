# AURA-ANDROID-REL-04 R9 — Independent Verification Handover

**PR:** #392 (`aura-android-rel04-app-readiness`) · **Date:** 2026-11-26 · **Kept separate from REL-05.** Not merged, not deployed, not activated.

| Item | SHA |
|---|---|
| Reviewed head (R8 assessment) | `2e32b914f011a83333fa0850c19d1997f36cd897` (implementation `eab072c9b3a41cae7e15d38ee2fd7ceae31989f7`) |
| **R9 implementation commit** | `513c12b6d9a824bbe86b3e63df12a3aede21ac8f` |
| **Integration** (CI checkout of `refs/pull/392/merge`, run 45814445236) | `7b07ae5eab8f818be0fdc5cedd641928ceb339a2` |
| **main base** | `3feff0342c48959be7006648ee4bdcaa71fbb162` |
| **R9 final head** | the commit that adds this file (report + evidence only; recorded in the PR body with its own CI run) |

## What to verify

The three blockers of the R8 assessment and their corrections are in the readiness report §R9 (`docs/android/AURA_ANDROID_REL_04_APPLICATION_READINESS_REPORT.md`); questions in §13 "R9".

1. **One transmission boundary.** `apps/web/lib/activitySync.ts` `submitActivityLog` (no direct-network fallback; `storage-unavailable`) and `replayOfflineQueue`; `apps/web/lib/offlineHabitQueue.ts` `enqueueOwned`, `claimForDispatch`, `inspectQuarantine` (request id from the key; `opaque`).
2. **Durable discard before cleanup.** `offlineHabitQueue.ts` `discardOwned` (one transaction: decisions + IndexedDB copies; localStorage removed only after commit; `failed` / `cleanupPending`), `discardQuarantined`; `apps/web/lib/signOut.ts` (uses `discardOwned`; logical counts; cleanup-pending message).
3. **Logical counts.** `readOwnedQueue` (`pending`, `paused`, `total`, `dispatched`); Home (`apps/web/app/page.tsx`) and sign-out use the same read.

## How to reproduce

```
TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R9LifecycleEnforcement.test.ts
```

Runs every R8-assessment witness against the vendored R8 code head (`test/fixtures/rel04-r8-head`, re-checked against `eab072c` when the commit is present) and against the current code, then E1–E9. Expected: **36 passed, 0 failed**; each "R8 HEAD reproduces" line shows the defect, each "CORRECTED" line its correction. The suite also verifies the preserved witnesses' checksums.

The assessor's original witness outputs are preserved unchanged in `docs/android/evidence/rel04-r8-independent-45804709468/` (`SHA256SUMS` included). The probe scripts were not in that directory; the witnesses are rebuilt from their logged shapes. `review-prod-transition.log` (Production `ac46fc3` → R8 transition, 0 posts, 0 rows) is preserved but not re-run (no script).

## Results

| Run | Result |
|---|---|
| R9 suite | 36/36 |
| math-core (every CI command) | 250/250 |
| DB suites | 75/76 — `dayConstructorPreviewItemDb` failed locally at 17:47 IST (muhurta engine refused every candidate time; clock-dependent; no R9 import); success in CI on `513c12b` |
| Chromium / Next app | 29/29 / 14/14 |
| Typechecks | exit 0 ×3 |
| CI run 45814445236 on `513c12b` | success, 9/9 |

## Checksums (sha256)

| File |  sha256 |
|---|---|
| `apps/web/lib/offlineHabitQueue.ts` | `129060d0674d3a40d10aa5649223e444854a68a59732c7c2b4977ae5aec4cdfc` |
| `apps/web/lib/activitySync.ts` | `bcf78bfe4b668f50e4ecc9b72117104df67795a58ad2bb8633c0c0dcf22ae96a` |
| `apps/web/lib/signOut.ts` | `b04c54cc1ce74b467b9dd6e810a61a1eebcc0e73d0ae578049e3489d04ba899c` |
| `apps/web/app/page.tsx` | `5e8e54a1570b175b8fc2ce1e8340080eed10ee31788e52c2b93f2b445c0993ea` |
| `test/rel04R9LifecycleEnforcement.test.ts` | `3f4b52781d7ad6ca5bb9d8c2d709f8162322783420b47778d2180cfa057c506e` |
| `test/fixtures/rel04-r8-head/offlineHabitQueue.ts.txt` | `04ad9e820a1c2552bea67c7e3e327d51c131d1917f6410d6f2a1a4644a08ffdf` |
| `test/fixtures/rel04-r8-head/activitySync.ts.txt` | `b3c021eedbdcd0a3411364e9b0b1f9460a2ee050e598194e10e6a577fa2894d7` |
| `test/fixtures/rel04-r8-head/signOut.ts.txt` | `791d8d6a5d15878226c42ca49f745475239ae6d4c9eeaca7e0990af1b83c99c5` |
| `docs/android/evidence/rel04-r8-independent-45804709468/SHA256SUMS` | `fee8eebb7576c26af3184d41cde512a6b5e6585350517083555206a4ddf67834` |
| `docs/android/evidence/rel04-r9-513c12b/README.md` | `c1188f9ffa7e887ddbb17740ae7348e704eabe4354ff322cc97d83f4dde3f5e9` |
| `docs/android/evidence/rel04-r9-513c12b/math-core-tests/manifest.json` | `d80b7b8e6c4abed71775b5b6ee172e89a5f437f932a891133ae3d58df4f487b4` |
| `docs/android/evidence/rel04-r9-513c12b/db-and-browser-tests/manifest.json` | `ea0b787b7cfc3cf83c710eca39359833f1ff6a8e2fb025cd4c1889637d73a6cd` |
| `docs/android/evidence/rel04-r9-513c12b/typecheck/typecheck.log` | `e980b32849e8f75f3bedd900f2ffa2b5589591001a5492b0e673bddcb79718e0` |
| `docs/android/evidence/rel04-r9-513c12b/math-core-tests/logs/246-test_rel04R9LifecycleEnforcement.test.ts.log` | `30612d6a29a063fa8dc978ba0334f98eef8c0a5c2cdc00f421a615b4d2f089f1` |

**Restrictions observed:** no new queue format, migration or marker expiry; no service-worker or AUTH-SESSION change; no regression assertion weakened (C7a and F1 made stricter); no historical CI rerun; no merge, deployment, Production access or activation.
