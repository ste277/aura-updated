# REL-04 R4: deployment isolation evidence (read-only)

This record was collected on 2026-11-25 at about 13:00 UTC by this session, for ticket 39213 (A-4).

**Read-only.** Every call was a GET:
- Vercel MCP: `get_project`, `list_deployments`, `list_aliases`, `get_rolling_release_config`;
- `vercel api` GETs: project settings, aliases, deployment events.

Nothing was changed: no hosting, project, repository or branch setting. `vercel curl` was not used. Nothing was deployed, promoted or cancelled.

**Scope.** Project `aura-updated` (`prj_iY4xteQOWUNsV85NnbyIylBAba6t`, team `aura-56a1`), Git link GitHub `ste277/aura-updated`, production branch `main`.

## 1. Git-triggered Production builds

| Setting | Current value |
|---|---|
| Ignored Build Step (`commandForIgnoringBuildStep`) | `if [ "$VERCEL_ENV" = "preview" ] && [ "$VERCEL_GIT_COMMIT_REF" != "staging" ]; then exit 1; else exit 0; fi`. sha256 prefix `0faf045e93a16d05`, unchanged since 2026-11-21 |
| Effect | A Preview for any branch except `staging` builds (exit 1). A **Production** build (`VERCEL_ENV=production`) exits 0, which cancels it before install |
| `gitProviderOptions.createDeployments` | `enabled`. A push to `main` still *creates* a Production deployment record, which the ignore step then cancels |
| Root directory / build command | `apps/web` / none set. Vercel therefore runs `npm run vercel-build`, which is `scripts/vercel-build.sh` |
| Deploy hooks | none |

**Observed on the most recent merge to `main`.** `7b80f98` (#391) created Production deployment `dpl_HBA2QxtJH39KWgGGs4mJYb2DBnwz` at 2026-11-25 12:04:28 UTC. Its state is **CANCELED**. It has 7 events:

1. build machine;
2. clone of `main@7b80f98`;
3. cache restore;
4. `Running "if [ "$VERCEL_ENV" = "preview" ] …"`;
5. "The deployment was canceled because the Ignored Build Step command returned exit code 0."

There was no install, no `vercel-build.sh`, no migration and no `next build`.

The nine merges before it (#382 to #390, from `list_deployments` with target production) show the same pattern: every Git Production deployment is CANCELED. The project's `targets.production` field points at the latest of these cancelled attempts, not at what is live (see section 3).

## 2. Automatic promotion

| Setting | Current value |
|---|---|
| `autoAssignCustomDomains` | `true`. A Production deployment that *builds* would take the production domains automatically |
| Rolling releases | not configured (`rollingRelease: null`) |
| `productionDeploymentsFastLane` | `true` |

**Conclusion.** Automatic promotion is on. It is neutralised only because Git Production builds never build (section 1). If the ignore step were changed, a merge to `main` would build, migrate and go live automatically.

## 3. Production routing

| Alias | Deployment | Since |
|---|---|---|
| `aura-updated.vercel.app` | `dpl_3SstUr7PBWFJHG6zM2oKjPxVBUhE` (commit `ac46fc3`, REL-04 web release; `isRollbackCandidate: true`) | alias updated 2026-11-24 08:31:47 UTC |

- Protection is SSO protection for all deployments except custom domains. There are no password or trusted-IP rules.
- The git-branch alias `aura-updated-git-aura-android-rel04-app-readiness-…` points at this PR's Preview deployment, not at Production.

## 4. Migration execution

- `scripts/vercel-build.sh` runs `prisma migrate deploy`, after the database-identity guard, **only when `VERCEL_ENV=production`**. It does this before `next build`. Previews skip it.
- Migrations therefore run only in a Production build. Git Production builds are cancelled before install, so a merge to `main` runs no migration. Production migrations happen only in an explicit Production-target build, such as the pinned CLI `vercel deploy --prod --skip-domain` used for REL-01 to REL-04.
- **PR #392 adds no migration.** `git diff merge-base..HEAD` touches nothing under `prisma/`, nor `vercel.json` or `scripts/`.
- `main` already contains `0054_reminder_dispatch_heartbeat` (REM-01), which is not yet applied in Production. Any Production-target build of `main`, with or without #392, would apply it. That is a REL-05 matter and predates this PR.

## 5. Approved rollback deployment

- **Current live deployment:** `dpl_3SstUr7PBWFJHG6zM2oKjPxVBUhE` (REL-04, `ac46fc3`, promoted 2026-11-24 08:31 UTC).
- **Approved rollback target** (REL-04 release record): `dpl_EhhkWfAgjaxviJ1TTrfsVydWdc3E` (REL-03, `7a9af83`). It is READY, its target is production, and it was created 2026-11-23 09:52:05 UTC.
- **Never promote** `dpl_GweqMXRVVPTipfcrAGZ54a2Tyzzb`. It is READY with target production but has no git metadata. It is the parallel build that applied migrations 0052 and 0053, and the owner's REL-04 record excludes it.

## 6. Can PR #392 merge without activating its changes?

**Yes, under the settings observed today.** A merge creates a Production deployment that the ignore step cancels before install: no build, no migration, no promotion. Production keeps serving `dpl_3Sst`. The merged code would reach users only through a separately authorised Production-target build and promotion (REL-05).

This holds only while the ignore step stays as recorded. Before the merge, re-read the ignore step. After the merge, check that its deployment shows the cancel event, the same procedure as for previous merges.

## 7. How REL-05 would exclude or accommodate the deferred Android activation changes

Merging #392 puts its shared-web changes on `main`: the account-boundary middleware, the IndexedDB queue and the service-worker bridge. **They are not behind a flag**, so every later Production build of `main` contains them. There are two options:

- **(a) Release REL-05 from a commit before the #392 merge**, or from a release branch without it. The pinned CLI build can target any commit, so other `main` work can still ship, for example REM-01 with migration 0054, and #385.
- **(b) Ship #392 in REL-05 as the activation itself.** This happens under the separate activation decision and the exit, stop and rollback criteria in the readiness report (§R4-8). Rolling back to `dpl_3Sst` or `dpl_EhhkW` needs no database step for #392, since it has no migration.

After #392 is merged, option (a) means every following release must be cut around it until activation is approved. The owner should choose an option before the merge.
