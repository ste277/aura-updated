# AURA-ANDROID-REL-04 R14: Final Integration Addendum (authorization 71044, post-CI-10)

**PR:** #392 · **Date:** 2026-11-27 · **Status: ANDROID REL-04 R14 READY FOR INDEPENDENT VERIFICATION**
This addendum is uncommitted. Ticket 39243 stays OPEN. Nothing is merged, deployed or activated.

## Revisions

| Item | Value |
|---|---|
| Previous head, verified before integration | `39f262b16cca48e40e2fcb528ad221d188f8daad`: R14 handover (docs only) |
| R14 implementation | `0df08780bd75e16b676efda6c99c1738bc72681b` (unchanged) |
| Approved integration base: `main` | `73cea7dc409e2740b4474695e248338f87c374c0` (#404, CI-10); verified equal to `origin/main` before integration |
| **New branch head** | `6c69d7d9089566b44b7a24ff0725add754cb7dbd`: a merge commit, `--no-ff`, no rebase, no force push |
| Merge parents | ^1 `39f262b`, ^2 `73cea7d` |
| Merge tree | `49f635592bbf8f315f2982b839dad4156116286f` |
| Previous merge base | `ad49e6a797d91c7c781a1700902505f398c4c5c6` |
| CI checkout | `11a2129`, the GitHub test merge "Merge 6c69d7d into 73cea7d" |

A fresh run without changing the branch would have required closing and reopening the PR, which changes the PR state. The authorized merge of the pinned `main` was used instead.

## Merge

**No conflicts.** Git auto-merged eight files that both sides had changed:
- `.github/workflows/ci.yml` (all 27 REL-04 step references retained);
- `PlanWithAuraView.tsx` and `YouView.tsx`;
- five `test/*Db` / `planDayWiring` tests.

No implementation changes. These R14 and REL-04 files have blob IDs identical to `39f262b`:
- `apps/web/lib/offlineHabitQueue.ts`, `activitySync.ts`, `signOut.ts`;
- `apps/web/app/page.tsx`;
- `test/rel04R14OutcomeReconciliation.test.ts`, `rel04Chromium.test.ts`, `rel04AccountIsolationHarness.ts`.

The `docs/android/**` evidence is unchanged by the merge. No migrations were added.

**CI-10 is included.**
- `test/weeklyPlanReviewClientDb.test.ts` in the merge has the same blob as `73cea7d`.
- `73cea7d` is an ancestor of the new head.
- In CI, step "Run Weekly plan review client DB test" printed "OK 8. setup: … SAME local date", "OK 8. setup (CI-10) …" and "ALL WEEKLY PLAN REVIEW CLIENT DB CHECKS PASSED".

## Fresh CI (naturally triggered by the push; nothing rerun)

**Run 46025314649** · attempt **1** · event `pull_request` · head `6c69d7d` · conclusion **success**

**Jobs: 9/9. Steps: 468/468.**

| Job id | Job | Steps |
|---|---|---|
| 140595091819 | Day Constructor acceptance DB tests (incl. Weekly Plan Review) | 88/88 |
| 140595091881 | Ephemeris / panchang tests (incl. R4–R14 suites) | 277/277 |
| 140595091889 | REL-04 Chromium multi-tab tests (incl. CH16) | 10/10 |
| 140595091771 | REL-04 Next.js app rendering tests | 13/13 |
| 140595091810 | Database migration validation | 23/23 |
| 140595091732 | Next.js production build | 14/14 |
| 140595091874 | Palmistry upload pipeline tests (G5) | 27/27 |
| 140595091744 | MCP Server | 8/8 |
| 140595091427 | MCP Server (Node 20 compatibility) | 8/8 |

**Other checks:** 11/11 passing; mergeState CLEAN.
- The supplementary checks are Vercel Preview Comments and the Vercel status.
- The Vercel status is preview deployment `dpl_2jD57Px4Cp1zYpFhnpufWPopa53N`, target `null` (not Production).

**R14 suite in CI:** 25 passed, 0 failed.
- The three `a8a9767` git-provenance checks print SKIP because CI uses a shallow clone, as all earlier rounds' fixture re-checks do.
- Locally on `6c69d7d`, the full clone gives **28 passed, 0 failed**.

**CH16 in CI:** "OK CH16 (R14, real Chromium) commit + lost acknowledgement + another tab settles it …".

## Historical CI (preserved, not rerun)

| Run | Head | Result |
|---|---|---|
| 45985719059 | `a8a9767` (R13) | 9/9 |
| 45989628096 | `f6a8cbe` (R13) | 8/9 on attempt 1 (CI-DEBT-10, `rel04R4SsrAgreementJsdom` S3); 9/9 after one approved targeted rerun |
| 46002683525 | `0df0878` (R14) | **8/9**: Day Constructor, `weeklyPlanReviewClientDb` check 8 (CI-10) |
| 46007450992 | `39f262b` (R14 docs) | **8/9**: Day Constructor job 140534111033, the same CI-10 check 8 |

## Preserved (unchanged)

- R14 F1–F3 corrections and the unified outcome contract (handover `AURA_ANDROID_REL_04_R14_VERIFICATION_HANDOVER.md`, evidence `docs/android/evidence/rel04-r14/`).
- The 39252 reviewer evidence.
- **Mandatory release conditions:**
  - N2 writer-free origin and rollback allowlist;
  - account-scoped recovery for unreadable v2 storage.
- CI-DEBT-10 is still a separate finding; that test was not modified.
- Existing verification limitations from the R14 handover:
  - localStorage and IndexedDB are not one transaction;
  - "removed" is an observation at a point in time;
  - decisions written before R14 carry no server answer and resolve to `outcome-unknown`.

## Controls

- Auto-merge: **off** (`autoMergeRequest` null).
- Auto-fix: **off**; address-comments off.
- PR state: OPEN, not draft (unchanged).
- No feature merge into `main`, no deployment, no Production database access, no activation.

## Production isolation (read-only Vercel metadata)

- The latest READY Production deployment is still REL-05 `dpl_x9NB8B9N5vVvPxVWRM8bRcxjTxqM` (`a39f398`); the rollback candidate is REL-04 `dpl_3Sst…` (`ac46fc3`).
- The only deployment for `6c69d7d` is the Preview `dpl_2jD57…` (target null).

## Checksums (sha256)

| File | sha256 |
|---|---|
| `Desktop/Claude/AuraEvidence/REL-04-R14-INTEG-CI-46025314649/SHA256SUMS` | `441c26333b98da5ebc94ba6cfbf625201e9bf1bb22aec4fa705e4f516c4ad258` |
| `Desktop/Claude/AuraEvidence/REL-04-R14-CI-46007450992/SHA256SUMS` | `5a89df4d0fece29e6f0f57a303b4e04f8c98cdb03891ab1ca74b1422c9e64642` |
| `Desktop/Claude/AuraEvidence/REL-04-R14-CI-46002683525/SHA256SUMS` | `2601a29f02c44a0e9489806c151d97158d52c6777972080e91e5b7e8296f4caa` |
| `Desktop/Claude/AuraEvidence/REL-04-R14-INTEG-CI-46025314649/run.json` | `4958e6b5d0f0ec4c213f6f054569825c76d69321d6378cf72cc451347fb8ced0` |
| `Desktop/Claude/AuraEvidence/REL-04-R14-INTEG-CI-46025314649/vercel-status.txt` | `0a0139e12446b6c412069148a4772e521c5150d6dee10df6d9942fd0be991d92` |
| `Desktop/Claude/AuraEvidence/REL-04-R14-INTEG-CI-46025314649/job-140595091819.log` | `6b0ebbe10560286b228535e093e99ea05f3fabf5949d7347329b513bc592d572` |
| `Desktop/Claude/AuraEvidence/REL-04-R14-INTEG-CI-46025314649/job-140595091881.log` | `106e6868cad2dedc824ebcabaf86b854a98184bd208bf56d79ac7c555993d6d8` |
| `Desktop/Claude/AuraEvidence/REL-04-R14-INTEG-CI-46025314649/job-140595091889.log` | `62a298d8565b76568762e64c122a85daffce63f9c2e99bae06de6706242ed5f5` |
| `Desktop/Claude/AuraEvidence/REL-04-R14-CI-46007450992/run.json` | `a0b696340127ab8361113614dca341d52d460b390c3ad82a476f1c2c476fbf5f` |
| `docs/android/AURA_ANDROID_REL_04_R14_VERIFICATION_HANDOVER.md` | `4e470387f34badee7e83fc257bcab3f990d3efdf4455444d8b3a87b04a65f858` |
| `docs/android/evidence/rel04-r14/README.md` | `8b3d7add4ff81baf89890e7133783770d8cd48067df2a6cbee5700a01b670ed7` |
