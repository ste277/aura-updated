# AURA-MP-1: My People data and API foundation, independent verification handover

| | |
|---|---|
| **Ticket** | AURA-MP-1 (62005). HOLD lifted 2026-11-27 after REL-05 |
| **Design** | [AURA_MP_01_PRODUCT_AND_ARCHITECTURE_DESIGN.md](AURA_MP_01_PRODUCT_AND_ARCHITECTURE_DESIGN.md) (D1–D10 + R1–R3 approved) · [ticket](AURA_MP_1_DATA_AND_API_FOUNDATION_TICKET.md) |
| **Branch / PR** | `feature/aura-mp-1-data-api-foundation`, base `main` `477723d` · [PR #400](https://github.com/ste277/aura-updated/pull/400) |
| **State** | Implemented and tested locally. **Not merged, not deployed.** Merge and deployment need separate approval |
| **Production** | My People is **off** (`NEXT_PUBLIC_AURA_MY_PEOPLE` unset → fail-closed). No Production, Vercel, Neon or credential action was taken |
| **Scope** | MP-1 only. No MP-2 screens, Home card, notifications, invitations, contact import, MCP or GoalActivity link |

## 1. What changed

| Area | Files | Claim to verify |
|---|---|---|
| Migration **0056** | `apps/web/prisma/migrations/0056_my_people_foundation/`, `schema.prisma` | Additive/relaxing only, no backfill. Chart trio nullable with an all-or-none CHECK. Five new optional SavedPerson columns. `PersonOccasion` with a composite owner FK, `calendar` column, CHECKs and a one-birthday partial unique index. `PlannedActivity.savedPersonId` (SET NULL) |
| Data layer | `lib/db.ts` | Partial `updateSavedPerson` (absent key = unchanged). All SavedPerson chart writes go through `savedPersonChartParams` (canonical birth date). `deleteSavedPerson` is ONE transaction with all clean-up. Owner-scoped special-day CRUD. Export loader. Plan INSERT re-checks person ownership in SQL |
| Validation | `lib/savedPersonRequest.ts` | Two contracts: legacy (switch off) and My People (on). Partial chart always 400. Special-day rules |
| Date logic | `lib/personOccasions.ts` | Pure. Unknown year, 29 Feb → 28 Feb, civil-day maths in the user's timezone, one `nextOccurrence` branching on `calendar` |
| Switch | `lib/myPeopleGate.ts` | Production: on only for `"1"`. Local/dev: on unless `"0"`. Gates new capabilities only |
| Routes | `app/api/people/**`, `app/api/plans`, `app/api/users/export` | Contracts per design §4 / §11.5. Every My People route `force-dynamic` |
| Consumers | `savedPersonNatalContext.ts`, `muhurtham-search`, `timing-search/shared`, `askAuraOrchestrator.ts` (4 sites), `dayBuilderOrchestrator.ts`, `PeopleView.tsx`, `MuhurthamFinderView.tsx`, `everydayTimingFit.ts` (type only) | All 9 birth-detail read sites use `natalContextForSavedPerson` (null-safe). SHARED Muhurtham → friendly 422 / reply. Everyday shared timing, Day Builder → neutral partner side |
| Privacy | `productEvents.ts`, export route | `notes`, `note`, `relationshipLabel`, `interests`, `locationName` forbidden in event metadata. Export adds `people[]` (no `ownerUserId`, no natal context) |
| CI | `.github/workflows/ci.yml` | 3 steps in `math-core-tests`, 3 in `day-constructor-acceptance-db-tests` (incl. the existing `savedPersonDb.test.ts`, never wired before) |
| Guard test | `test/birthDateCanonicalization.test.ts` Part 4 | Updated to the new structure. Same invariant: no bare birthDate reaches SQL. Mutation self-tests extended |

## 2. Reviewer checklist

1. **Existing chart profiles unchanged.** The migration rewrites no row. Every pre-existing suite passes unchanged (§4).
2. **Partial update preserves chart details.** `myPeopleDb` B1–B6, including a byte-identical comparison of all six chart columns and the DB CHECK refusing a half chart.
3. **Switch on → off → on.** `myPeopleSwitchRollbackDb` 1.1–3.4. A mutation (removing the null guard) makes it fail.
4. **Isolation.** `myPeopleDb` D1–D8: every route returns 404 cross-owner and changes nothing. The composite FK refuses a cross-owner special day (direct SQL). Plan INSERT stores NULL for a foreign person even when the route is bypassed.
5. **Atomic delete.** `myPeopleDb` E1–E7: a trigger fails the final DELETE after every clean-up statement ran. Everything rolls back, and the route returns 500 "Nothing was changed".
6. **Export.** `myPeopleDb` F1–F3.
7. **Panchang ranking unchanged.** No ranking weight or scoring code changed. The only package change is making `partnerContext` optional in `everydayTimingFit.ts` (type).
8. **No scope creep.** No new screen, card, notification, invitation, import or MCP change.

## 3. Migration number

- `main` latest is `0054`. `0055` is reserved for AUTH-SESSION-01 I1 (its worktree is on current main and has not created it). So MP-1 uses **0056**.
- Verified on a scratch database: apply through 0056, then add a dummy 0055 → `prisma migrate deploy` applies it, and `prisma migrate status` reports "up to date". Either PR can merge first.

## 4. Local evidence

All runs used a disposable local Postgres 16 cluster (port 55491) with the full chain through 0056 applied by `prisma migrate deploy`. No shared database was used.

| Check | Result |
|---|---|
| New suites | `myPeopleRequest` ✔ · `personOccasions` ✔ · `peopleViewNullChartJsdom` 11/11 ✔ · `myPeopleDb` 38/38 ✔ · `myPeopleSwitchRollbackDb` 26/26 ✔ |
| Mutation control | Removing the null guard in `natalContextForSavedPerson` makes the rollback suite fail (crash at the detail route) |
| `math-core-tests`, every CI step locally | 223/245 on the first pass. After fixes, all 22 remaining failures are environmental: the same 14 fail identically on unchanged `main` in a clean detached worktree (`--jsx` / component-module resolution in this local setup) |
| Fixed during the run | Fixture typing (`PlannedActivity.savedPersonId` made optional); the palmistry isolation check (a comment mentioned Palmistry); three "no new migration" guards re-baselined for 0056 (the same pattern AURA-REM-01 used for 0054); the plans-route structural guards (kept the `schedulingMode … }, client);` shape) |
| `day-constructor-acceptance-db-tests`, every CI step on a fresh DB | 72/75. The 3 failures (`goalDecompositionPlanningHandoffDb`, `hpg5I2MyDaySaveDb`, `hpg5I3HomeSaveDb`) fail identically on `main` (same component-import environment issue) |
| Consumer suites (incl. not-in-CI) | sharedMuhurtham, muhurthamSearchApi, dayBuilderOrchestrator, askAuraOrchestrator, productEvents, auraMoment*, dailyStory, askAura*, muhurthamFinder, auraUpdates, auraMomentsDb, dayBuilderDb, dailyGuidanceOrchestratorDb, birthDateWritersDb, savedPersonDb: all ✔ |
| Typecheck | `tsc -p tsconfig.web.json` clean · `apps/web` clean · root test tsconfig: 6 errors, all in untouched files (pre-existing) |
| `next build` + bundle/standalone checks | ✔. The build **caught a real bug**: `/api/people/occasions/upcoming` was prerendered static (○) with the build-time switch-off 404 baked in. Fixed with `export const dynamic = 'force-dynamic'` on all 5 My People routes (now ƒ) plus a guard check in `myPeopleRequest` |
| Migration order | 0056 then a later 0055: `migrate deploy` applies it; `migrate status` is up to date |

## 5. Known pre-existing failures (not MP-1)

`askAuraOrchestratorDb.test.ts` (7 FAIL) and `personalizedDailyStoryDb.test.ts` (2 FAIL) fail identically on unchanged `main` `477723d` (checked in a clean detached worktree). Neither is wired into CI. They look date/time-of-day dependent.

## 6. Merge and release notes (for whoever approves)

- **Merging triggers a Production build attempt.** `scripts/vercel-build.sh` runs `prisma migrate deploy` only when `VERCEL_ENV=production`, so the existing Prod-build hold or cancellation must apply, as for earlier PRs. Preview builds skip migrations and run with My People off.
- 0056 is safe to apply ahead of the code (additive), but releasing it is a Production DB change and needs its own approval.
- Turning My People on in Production is a separate decision. Rollback = unset the variable; no data migration.

## 7. PR

[ste277/aura-updated#400](https://github.com/ste277/aura-updated/pull/400), opened 2026-11-27 from implementation commit `763c84f`. It is open and unmerged; Auto-fix and Auto-merge are off. The PR's CI results are the authoritative check for the environment-only local failures in §4.
