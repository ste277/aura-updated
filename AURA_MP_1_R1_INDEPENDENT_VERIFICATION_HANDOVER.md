# AURA-MP-1 R1: independent verification handover (62007, corrections to the 62006 NO-GO)

| | |
|---|---|
| **PR** | [ste277/aura-updated#400](https://github.com/ste277/aura-updated/pull/400). Open, unmerged, Auto-merge **off** |
| **Reviewed head (62006)** | `ecafb91608a12a0a3166eaaf8fb23f00c79cfc6c` |
| **R1 implementation head** | `3e6bce5a6a57e075caa12b2f52f832584effeb60` (code, tests, migration, CI, corrected design and ticket) |
| **R1 handover head** | The commit that adds this file, directly on top of `3e6bce5` (docs only; reported in the PR and the closing report) |
| **Base** | `main` `477723d` (not synchronized, by instruction; `main` has since moved to `5551166`) |
| **Scope** | F1–F5 and the evidence corrections only. No MP-2, no redesign, no merge, deployment, Production access, Production migration or activation |
| **Production** | Unchanged. My People is disabled: the server flag `AURA_MY_PEOPLE_ENABLED` is unset and fails closed |
| **Supersedes** | Where they conflict, this handover replaces `AURA_MP_1_INDEPENDENT_VERIFICATION_HANDOVER.md` (R0) and the untracked R0 CI-assessment addendum |
| **Evidence** | `AURA_MP_1_R1_EVIDENCE/` (SHA256SUMS in §9) |

## 1. Findings and corrections

| # | Finding (62006) | Correction | Where |
|---|---|---|---|
| **F1** (P1) | With My People disabled, editing a PARENT/CHILD/SIBLING person failed (400), because the legacy editor resubmitted the unchanged type and the legacy contract rejected it | **API:** with My People disabled, resubmitting the person's own unchanged type is an accepted no-op; *changing* to a My People type is still a 400. **Editor:** sends `relationshipType` only when the user changed it. Data is preserved across enable → disable → re-enable | `savedPersonRequest.ts` (`currentRelationshipType`), `people/[personId]/route.ts`, `PeopleView.tsx` |
| **F2** (P1) | One `NEXT_PUBLIC_` switch both enabled the server and defaulted ON outside Production | **Authoritative server flag** `AURA_MY_PEOPLE_ENABLED` (runtime, server-only, disabled unless exactly `"1"` in *every* environment); every route uses only it. **`NEXT_PUBLIC_AURA_MY_PEOPLE` is presentation-only:** the client presents My People only if it is `"1"` **and** the server's `x-aura-my-people` header says `enabled`. No external service | `myPeopleGate.ts`, all 6 server routes, `PeopleView.tsx` |
| **F3** (P2) | An impossible date (`2023-02-30`) passed validation, then threw a `RangeError` in the writer (500). `null`/`''` coordinates were coerced to 0 | Validation now calls the writers' own canonicalizer, so an impossible date is a 400 before any writer. Coordinates are optional, but if either key is present both must be finite numbers in range; null, `''`, numeric strings, NaN, ±Infinity and a missing partner are 400s, never coerced. All-or-none charts and explicit `chart: null` clearing are kept | `savedPersonRequest.ts` |
| **F4** (P2) | Concurrent partial special-day updates could persist a contradictory date, and the person / special-day limits could be exceeded by concurrent creates | **Update:** one transaction does `SELECT … FOR UPDATE` (owner- and person-scoped), merges onto the committed row, validates the merged record, then writes. **DB integrity (0056):** real month/day, 29 Feb only in leap years when the year is known, year ≥ 1900, OTHER needs a label. **Limits:** count and insert happen in one transaction, under a per-owner advisory lock for people and with the person row locked for special days | `db.ts`, occasion routes, `0056` |
| **F5** (P2) | The enabled list leaked notes, owner id and birth fields; `occasions` on create was silently dropped | The enabled list is exactly the design 4.1 item (`id, name, relationshipType, relationshipLabel, hasChartDetails, nextOccasion`); detail and export are unchanged. While disabled the list keeps the legacy shape for existing consumers. `occasions` on create → explicit 400 (no new occasion workflow) | `savedPersonView.ts`, `people/route.ts`, `savedPersonRequest.ts`, `PeopleView.tsx` / `MuhurthamFinderView.tsx` (use `hasChartDetails`) |

**Evidence corrections:**

| Topic | Correction |
|---|---|
| Runtime vs build-time switch | The R0 docs said one `NEXT_PUBLIC_` value was "read by server routes and client components". R0 evidence showed the server route read it at runtime while the client needed a rebuild, so the two could disagree. Now: the server flag is runtime and authoritative; the public flag is build-time and only presents. On Vercel either flag changes only with a **redeploy**, because environment variables are fixed per deployment. Design §11.5 and ticket §7 are rewritten accordingly |
| Plan ownership | The `PlannedActivity.savedPersonId` FK only proves the person **exists**. Ownership is enforced by the supported SQL writers (`createPlannedActivity`, `createPlannedActivityWithClient`), whose owner-checked subselect stores NULL for a foreign id. A raw SQL write is not prevented, and Move/Recomposition do not carry the link (an MP-3 concern). Design §11.4 is updated |
| Nested export `ownerUserId` | R0 stripped it from people but not from nested special days. **Assessment: omit at every level.** The export is the owner's own data, so the id is redundant and an unnecessary internal identifier. Record ids and `savedPersonId` are kept because they link records within the file. Implemented (`toPeopleExportPayload`) and tested |
| Local "module-setup" failures (R0) | Caused by my local runner ignoring CI step `env:` (`TS_NODE_COMPILER_OPTIONS`, job `DATABASE_URL`). R1 runs every step with its own environment (§4) |
| Merge and Production build (R0 §6) | The Vercel Ignored Build Step proceeds only for Preview builds, so a push to `main` does not run a Production build; it shows as CANCELED, which is how Vercel reports an ignored build (observed for `main` `5551166`). Only an authorised Production build runs `prisma migrate deploy` |

## 2. 0056 amendment: persistent-environment check (required before modifying 0056)

0056 was confirmed **not applied to any persistent environment** before the F4 CHECKs were added:

| Environment | Evidence | File |
|---|---|---|
| Vercel Production | The only Production deployment since 0056 was first pushed (2026-11-27 09:14Z) is `main` `5551166` (#399, no 0056), state CANCELED (Ignored Build Step). `vercel-build.sh` migrates only when `VERCEL_ENV=production` | `vercel_production_deployments_since_0056.json` (deployment metadata only; no env values, no DB) |
| Vercel Preview | Builds log `VERCEL_ENV=preview -- skipping migration step` | R0 `vercel_preview_…_excerpt.txt` |
| Local persistent Postgres (`localhost:5432`, 19 databases with a ledger) | 0 rows of 0056 in every `_prisma_migrations` | `0056_persistent_env_check.txt` |
| CI | Ephemeral service databases | — |

**Limit:** the Production database ledger itself was not read, because Production access is prohibited. The conclusion rests on the deployment pipeline (the only path that migrates Production) plus the release records (Production DB at 0054, REL-05).

Migration compatibility with AUTH-SESSION `0055_auth_session` was re-verified with the amended 0056 in both application orders (§5).

## 3. Before and after: independent witness (`r1_witness.ts`)

The witness is head-agnostic (it takes `MP1_ROOT`), checks correct behaviour only, and runs on a fresh disposable database per run.

| | Reviewed head `ecafb91` (clean detached worktree) | R1 head |
|---|---|---|
| F1 ×3 (PARENT, CHILD, SIBLING legacy edits) | **FAIL** (400 "relationshipType must be one of…") | PASS |
| F2 ×2 (default disabled; public flag cannot enable the server) | **FAIL** (200, 200) | PASS |
| F3 ×4 (2023-02-30, 2021-04-31, null latitude, `''` latitude) | **FAIL** (`RangeError` thrown ×2; 201 with latitude stored as 0; 201) | PASS |
| F4 ×3 (contradictory merge; 10 special days; 200 people) | **FAIL** (29 Feb 2023 persisted; 13/10; 202/200) | PASS |
| F5 ×2 (list contract; inline occasions) | **FAIL** (notes and birth fields listed; 201, silently dropped) | PASS |
| **Total** | **0/14** | **14/14** |

Files: `witness_BEFORE_reviewed_head_ecafb91.txt`, `witness_AFTER_r1_head.txt`.

**Negative controls (the new regression suites run against the reviewed head):**
- `myPeopleR1Db`: 31 FAIL.
- `peopleViewLegacyEditorDb`: 6 FAIL. The editor offers every My People type and resubmits the unchanged relationship.

Files: `negative_control_*_on_reviewed_head_ecafb91.txt`.

## 4. Regression and concurrency results (R1 head, local, CI step environments applied)

| Run | Result | File |
|---|---|---|
| `math-core-tests`: every CI step, with each step's `env:` | **245/245 PASS** | `local_ci_math_core_tests_all_steps.txt` |
| `day-constructor-acceptance-db-tests`: every step, fresh DB with amended 0056 | **77/77 PASS** (includes the 2 new R1 suites) | `local_ci_day_constructor_db_all_steps.txt` |
| `db-migration-validation` | Not reproduced locally (its psql steps are hard-wired to CI's service database); covered by PR CI. Prisma deploy and status were verified locally in both orders (§5) | `migration_order_*.txt` |
| `next build` (CI env) + 5 bundle/standalone checks | **build 0; all 5 checks 0**; all 5 `/api/people*` routes ƒ (dynamic) | — |
| Typecheck | `tsc -p tsconfig.web.json` and `apps/web` clean | — |

**New suites (wired into CI):**
- **`myPeopleR1Db`:**
  - F1 API;
  - F2 flags and capability header;
  - F3 routes (POST and PATCH, both switch states);
  - **F4 deterministic concurrency:**
    - two partial updates forced to read the same row before either writes, using a row-lock barrier that Postgres releases in FIFO order, in 3 orders;
    - limits under 5 and 4 concurrent creates with trigger-delayed inserts;
    - direct-SQL CHECK rejections;
  - F5 list contract and inline occasions;
  - export.
- **`peopleViewLegacyEditorDb`:** the real legacy editor in jsdom, driving the real route handlers and database.
  - F1: actual submissions and preservation across enable → disable → re-enable.
  - F2: graceful degradation with the public flag on and the server off; presentation can only hide.

**Existing assertions kept.** The changes are:

| Test | Change | Why |
|---|---|---|
| `savedPersonRequest` L60 | `1992-13-40` assertion flipped from `ok === true` to `ok === false`; leap-day and impossible-date checks added | It pinned the F3 defect (accepted, then a 500). The finding requires rejection |
| `myPeopleRequest` switch block | Single-switch assertions replaced by server-flag equivalents (fail-closed, only `"1"`), plus public-flag, client-effective and route-source checks | F2 removes the single switch by design; the fail-closed protections are kept for the authoritative flag |
| `myPeopleDb` C10 | "list carries My People fields (notes)" changed to the 4.1 contract; C10b/C10c added (no leaks; detail keeps notes) | It pinned the F5 defect |
| `birthDateCanonicalization` mutation | Target string updated for `createSavedPerson`'s new optional `executor` parameter | Same mutation, same detection |
| `myPeopleDb`, `myPeopleSwitchRollbackDb` | Use the server flag; the rollback suite keeps the public flag at `"1"` throughout | Proves the public flag cannot keep the server on |

Every other assertion is unchanged, including the R0 isolation, atomic delete, export, rollback and birth-date guards, and all their checks pass.

## 5. Migration compatibility (amended 0056)

Uses the real `0055_auth_session` (copied read-only from the AUTH-SESSION worktree; source hashes in `migration_sources.sha256`) and the **amended** 0056, on fresh disposable databases.

| Order | deploy 1 | deploy 2 | `migrate status` | Ledger | Objects |
|---|---|---|---|---|---|
| A: …0054, 0055, then 0056 | `0055_auth_session` applied | `0056_my_people_foundation` applied | exit 0, "Database schema is up to date!" | both finished, not rolled back | AuthSession ✔; all 6 PersonOccasion CHECKs ✔ (calendar, gregorian_date, kind, other_label, remind_days, year) |
| B: …0054, 0056, then 0055 | `0056` applied | `0055_auth_session` applied | exit 0, up to date | both finished | same ✔ |

The three "no new migration" guard tests still fail on a 0055 (R0 mutation M2), so AUTH-SESSION I1 must re-baseline them for 0055.

## 6. Feature switch: compiled Production artifacts

Two real `next build` Production artifacts (`NEXT_PUBLIC_AURA_MY_PEOPLE` unset / `=1`), each started as a standalone server with `AURA_MY_PEOPLE_ENABLED` unset / `=1`, against a local scratch database (`F2_production_artifact_matrix.txt`):

| Build (public flag) | Server flag | `/api/people` header | Special-day route | Name-only create | Legacy PARENT edit |
|---|---|---|---|---|---|
| unset | unset | `disabled`, legacy shape | 404 | 400 (legacy) | 200, PARENT kept |
| unset | `1` | `enabled`, 4.1 shape | 200 | 201 | 200 |
| **`1`** | **unset** | **`disabled`** | **404** | **400** | **200, PARENT kept** |
| `1` | `1` | `enabled`, 4.1 shape | 200 | 201 | 200 |

- **Bundles:**
  - In the public-on build the client has `"1"` inlined and no remaining `NEXT_PUBLIC_` reference.
  - In the public-unset build the client reads an undefined value, so presentation is off.
  - The server reads `process.env.AURA_MY_PEOPLE_ENABLED` at runtime.
  - **No client static file contains `AURA_MY_PEOPLE_ENABLED`.**
- **Real browser, public-on artifact with the server disabled:**
  - The People editor for a PARENT offers only the legacy types plus the person's own PARENT.
  - Saving a rename returns PATCH 200, and the database keeps PARENT.
  - The app's own request to the special-day route gets a 404, handled without error. Screenshot: `F2_browser_public_on_server_off_after_save.jpg`.
- **First attempt was invalid:** the first matrix run used a placeholder `AUTH_SECRET` shorter than the 32 characters a Production build requires, so both builds exited 1. The run was repeated with a valid local secret, and the invalid attempt is not part of the evidence.
- **Vercel:** environment variables are fixed per deployment. Changing either flag needs a redeploy, which this local matrix models as a fresh start or rebuild.

## 7. Preserved behaviour

These are covered by the passing CI-step runs in §4:
- owner isolation, including cross-owner 404s, the composite FK and the owner-checked plan link;
- atomic deletion with an injected failure;
- historical plans and moments kept;
- birth-date safety (canonicalization guard and mutation tests);
- the 9 null-safe natal read sites;
- Panchang ranking (no weight or scoring change; the consumer suites pass).

## 8. Final results

- **Reviewed head `ecafb91`:** 0/14 witness checks hold. All five findings reproduced.
- **R1 implementation head `3e6bce5`:**
  - witness 14/14;
  - `math-core-tests` 245/245 and Day Constructor DB job 77/77 locally, with each step's CI environment;
  - build and all 5 checks pass; typecheck clean;
  - migrations compatible in both orders;
  - artifact matrix and browser check pass.
- **PR CI:** triggered automatically by the push of these commits, not rerun deliberately. Its results are reported in the closing report.
- **Status: MP-1 R1 READY FOR INDEPENDENT VERIFICATION.**

## 9. Evidence checksums

`AURA_MP_1_R1_EVIDENCE/SHA256SUMS.txt` covers every evidence file. It is untracked, so the PR head is not moved by evidence. Verify with:
```
cd .claude/worktrees/aura-mp-01 && shasum -a 256 -c AURA_MP_1_R1_EVIDENCE/SHA256SUMS.txt
```
The SHA-256 of `SHA256SUMS.txt` itself is reported in the closing report.
