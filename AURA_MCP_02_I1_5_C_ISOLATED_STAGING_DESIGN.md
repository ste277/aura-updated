# AURA-MCP-02-I1.5-C: Isolated Staging Architecture (Design)

- **Date:** 2026-11-10
- **Baseline:** `origin/main` `e921f54974c443966cd7d35953e8f03635b9d0ef`, tree `c5e1240`
- **Mode:** design only. Nothing provisioned, configured or deployed. Environment variables are listed by **name only**.

---

## 1. Current deployment architecture

| Element | Current state (verified read-only) |
|---|---|
| Vercel team / plan | `aura-56a1`, **Hobby** |
| Project | `aura-updated`: root `apps/web`; Node 24.x; Production branch `main`; install `npm install --prefix ../.. && npm install`; build `npm run vercel-build` → `scripts/vercel-build.sh` |
| Production | `aura-updated.vercel.app` → `dpl_mYJAoAr1…` (`e921f54`); publicly reachable |
| Preview | Every non-`main` branch builds a Preview. **Vercel SSO protection** (`ssoProtection: all_except_custom_domains`, i.e. Standard Protection: production domains stay public); unauthenticated requests get a 302 to SSO. **An automation protection-bypass secret also exists on `aura-updated`** (`protectionBypass` scope `automation-bypass`, exposed as an environment variable), so anyone holding it can reach Previews, which use the Production database. Its value was not read. |
| Project ID | `aura-updated` = `prj_iY4xteQOWUNsV85NnbyIylBAba6t` (not a secret) |
| Database | Neon Postgres (`NEON_PROJECT_ID` present). **`DATABASE_URL` is one variable scoped to Preview *and* Production**, so Preview uses the Production database (D2 G4). `AUTH_SECRET` has separate Preview and Production values. |
| Migrations | `vercel-build.sh` runs `prisma migrate deploy` **only when `VERCEL_ENV=production`** |
| Cron | `apps/web/vercel.json`: `/api/internal/reminders/dispatch` at `0 13 * * *` (runs on the project's production deployment) |
| Alternate path | `deploy/Dockerfile` + `deploy/compose.yml` (self-hosted "vf-1": own Postgres container, nginx front). Not the active production path. |
| Native shells | Capacitor 6 remote-URL mode. `capacitor.config.ts` uses `server.url = CAP_SERVER_URL ?? http://localhost:3000`. The synced `capacitor.config.json` files are git-ignored (iOS and Android). Its comment suggests `CAP_SERVER_URL=https://<railway-app-url>` for production. |

**Why Preview is not staging:** Preview shares the Production `DATABASE_URL`, its migrations are skipped, and it can only be reached through Vercel SSO.

---

## 2. Proposed staging architecture

```
GitHub ste277/aura-updated
   ├─ branch main ───────────► Vercel project "aura-updated" (unchanged)  ──► Neon PROD project
   └─ branch staging ────────► Vercel project "aura-staging" (NEW)        ──► Neon STAGING project (NEW, empty)
                                 • Production Branch = staging
                                 • Preview builds for other branches: DISABLED (ignored build step)
                                 • Deployment Protection: ON for all deployments, incl. the staging domain
                                 • Env: staging-only values, entered manually (no integration sharing)
```

### 2.1 Vercel isolation

| Requirement | Design |
|---|---|
| Separate project | A new project, **`aura-staging`**, in team `aura-56a1`, linked to the same repository with root `apps/web`. Same install and build commands as Production, so builds stay identical. |
| Branch mapping | **Production Branch = `staging`**: the staging site is the staging project's "production" target. Other branches must not build: set the Ignored Build Step to `[ "$VERCEL_GIT_COMMIT_REF" != "staging" ]` (exit 0 skips). `main` never deploys to `aura-staging`. |
| No accidental Production promotion | The projects are separate, so no promotion path exists between them. Production stays `main` on `aura-updated` only. No `vercel promote` across projects. Nobody adds a Production domain to `aura-staging`. |
| No secret inheritance | **Do not connect the existing Neon marketplace integration to `aura-staging`.** It injects `DATABASE_URL`, `PG*`, `POSTGRES_*` and `NEON_*` for the linked Neon project. Every staging variable is entered manually and scoped to `aura-staging` only. Team-level shared environment variables: none exist today, and none may be created. |
| `VERCEL_ENV` consequence | Staging deployments run with `VERCEL_ENV=production` and `NODE_ENV=production`. That's intentional: it exercises the real production code paths, including the closed Palmistry gate and the closed auth dev-login fallback. It also means **`vercel-build.sh` will run `prisma migrate deploy` against the staging database**, so the database identity guard in section 3.3 is mandatory **before** the first staging build. |
| Access control (**mandatory**) | `ssoProtection.deploymentType = "all"` on `aura-staging`, so Vercel Authentication covers **every** deployment, **including the staging production domain**. Vercel's current docs state that protecting all deployments is available on all plans and that Vercel Authentication is available on Hobby; confirm this in the dashboard or API at provisioning. `protectionBypass` on `aura-staging` must be **empty**: no automation bypass and no shareable links. Access is limited to the team owner. **Staging must never be public:** it has real Resend sign-in, so a public URL would be an open sign-up surface. If `all` can't be set, **STOP**. Proceeding publicly would need a separate, explicit owner risk acceptance and is not part of this design. |
| Domain | Default `aura-staging.vercel.app`, or a custom `staging.<domain>` if the owner wants one (DNS change; owner). The staging hostname must be distinct from every Production hostname. |
| Existing project side effect (**prerequisite**) | `aura-updated` would build a **Preview** of the `staging` branch, and that Preview uses the Production `DATABASE_URL` and the Production `RESEND_API_KEY` (both scoped to Preview and Production). **Before the `staging` branch is created**, one of these is required: (a) an Ignored Build Step on `aura-updated` that skips `staging` (a Production project configuration change; **separate authorization**), or (b) a documented owner risk acceptance. Option (a) is recommended. |
| Shared repo config | Both projects use root `apps/web`, so they share `apps/web/vercel.json`. Both get the daily cron, and any future Git or deploy settings added to `vercel.json` would apply to both. Keep project-specific behaviour in each project's dashboard settings, not in `vercel.json`. |

### 2.2 Environment-variable inventory (names only)

**Code-referenced variables** (from `process.env.*` in `apps/web`, `packages`, scripts), compared with what Production has today and the staging recommendation:

| Variable | Used for | In Production Vercel today | Staging |
|---|---|---|---|
| `DATABASE_URL` | `pg` pool (runtime) **and** `prisma migrate deploy` (`schema.prisma` reads only `DATABASE_URL`; there is no `directUrl`) | yes (shared with Preview) | **New staging Neon URL of the same kind Production proves works for `migrate deploy`.** Production has migrated successfully through its `DATABASE_URL`. Determine whether that is the pooled or direct endpoint (the operator checks the host form, without revealing it) and mirror it. A transaction-mode pooler can break `migrate deploy` advisory locks. |
| `DATABASE_URL_UNPOOLED` | Not referenced by code or the schema | yes (integration) | **Do not set** |
| `AUTH_SECRET` | HMAC session, magic-link and other tokens (≥32 chars in production) | yes (separate Preview and Production values) | **New random value**, never reused |
| `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` | Sign-in email (Resend) | yes | **Separate Resend key, restricted** (section 4) |
| `MOM_API_KEY`, `MOM_FROM_EMAIL`, `MOM_API_URL` | Sign-in email (Mail-o-Mail; preferred if set) | no | **Unset** |
| `OPENCAGE_API_KEY` | Geocoding (location search and reverse) | no | Unset (feature off), or separate free-tier key if location search must be tested |
| `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT` | Web Push | no | **Unset** (push disabled) |
| `INTERNAL_REMINDER_DISPATCH_SECRET` | Cron reminder dispatch auth | no | **Unset**, so the cron call gets 401 (fails closed) |
| `INTERNAL_METRICS_SECRET` | Internal product-metrics endpoint | no | **Unset** (endpoint closed) |
| `AURA_SHADOW_POLICY_MODE` | Shadow policy (`OFF` or `SHADOW`) | Preview only | **Unset** (OFF) |
| `E2E_TIME_OVERRIDE_ENABLED` | Playwright time override (test hook) | no | **Must be unset** |
| `AURA_MCP_REMOTE_ENABLED`, `AURA_MCP_RESOURCE_URL`, `AURA_MCP_AUTHORIZATION_SERVER` | Remote MCP | no | **Must be unset** |
| `CAP_SERVER_URL` | Capacitor sync (local build time only; not a Vercel variable) | n/a | Not on Vercel (section 6) |
| `NODE_ENV`, `VERCEL_ENV` | Set by the platform | — | — |

**Present in Production but not referenced by code:** `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `POSTGRES_HOST`, `NEON_PROJECT_ID`. **Do not create these in staging.** `.env.example` also lists `GEMINI_API_KEY`, which no code references; do not set it.

**Staging allowlist (complete):** `DATABASE_URL`, `AUTH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `AURA_STAGING_EXPECTED_DB_HOST`, `AURA_STAGING_EXPECTED_DB_NAME`, `AURA_STAGING_EXPECTED_DB_USER`, `AURA_STAGING_FORBIDDEN_DB_HOSTS` (section 3.3), and optionally `OPENCAGE_API_KEY`. **Nothing else.** No integration-linked variables (no `configurationId`), no team-level shared variables attached, and no storage integration connected.

**Operator tooling rules** (secret-leak prevention; both projects share root `apps/web`, so they share `apps/web/.vercel/project.json` and `apps/web/.env.local`):
- Always pass explicit `--project` and `--scope` flags, or use a separate checkout for staging work.
- **Never run `vercel env pull` against `aura-updated` Production**, because it would write Production database credentials to `.env.local`. Note that `scripts/retention-report.js` auto-loads `.env.local`.
- Never run `vercel link` in a way that relinks the shared directory without checking the result.
- Delete any pulled `.env.local` after use. Both `.env*` and `.vercel` are git-ignored, so pulled files won't be committed.

---

## 3. Database isolation

### 3.1 Provisioning shape

- **A separate Neon project** (not a branch of the Production project). A Neon branch is a copy-on-write clone of Production **data**, so it is forbidden.
- **Region:** the same region as the staging functions (`iad1`), for latency only.
- **Own role and password**, own pooled and unpooled connection strings.
- **Created empty.** No restore, copy, dump, branch or seed from Production.
- **Seed data**, if any later, must be synthetic, created by scripts in the repository and reviewed, with clearly fake emails such as `@example.test`.

### 3.2 Credentials

- Entered only into `aura-staging` environment variables, scoped to **Production** (which is the staging site) and nowhere else.
- Never committed. Never pasted into reports.
- Rotation: on any suspected exposure, rotate in Neon and Vercel.

### 3.3 Migration strategy and identity verification (mandatory)

Staging migrations run through the existing `vercel-build.sh` path, because staging's `VERCEL_ENV` is `production`. Before the first staging deploy, I1.5-D must add a **database identity guard** to `vercel-build.sh` that runs before `prisma migrate deploy`.

**The guard fails closed: every unknown or missing input means exit 1, so the build fails and nothing is promoted.**

1. Run the guard only when `VERCEL_ENV=production`. Otherwise migrations are already skipped.
2. **If `VERCEL_PROJECT_ID` is empty or unset, exit 1.** System environment variables are exposed today (`autoExposeSystemEnvs: true`). Their absence is treated as an error, never as "skip the check".
3. If `VERCEL_PROJECT_ID` equals the **committed Production project ID** `prj_iY4xteQOWUNsV85NnbyIylBAba6t`, proceed exactly as today. Production behaviour is unchanged.
4. For **any other** project ID:
   - Require `AURA_STAGING_EXPECTED_DB_HOST`, `AURA_STAGING_EXPECTED_DB_NAME`, `AURA_STAGING_EXPECTED_DB_USER` and `AURA_STAGING_FORBIDDEN_DB_HOSTS` to be present and non-empty. If any is missing, exit 1.
   - Once the staging project exists, **pin its ID in the script** and exit 1 for any third project ID.
5. **Parse** `DATABASE_URL` with a real URL parser (not regex) into host, user and database, without printing it. On a parse failure, exit 1.
6. **Normalise hosts:** lowercase, and strip Neon's `-pooler` endpoint suffix so pooled and direct hosts compare equal.
7. Require the normalised host, user and database to **all** match the expected values. The database name alone isn't discriminating, since Neon's default `neondb` is likely shared.
8. Refuse (exit 1) if the normalised host matches any entry in `AURA_STAGING_FORBIDDEN_DB_HOSTS`. That variable may hold **SHA-256 hashes** of the normalised Production host(s) rather than plaintext; compare hashes.
9. **Log the outcome only**, never the URL, host or credentials: `[vercel-build] DB identity verified (staging)` or `[vercel-build] DB identity REFUSED: <reason code>`.
10. A **negative test is mandatory** (acceptance test 3b): a staging build with a deliberately wrong `AURA_STAGING_EXPECTED_DB_HOST` must fail **before** `prisma migrate deploy` runs, and no deployment may be promoted.

**Empty-before-first-migration check** (one-off, operator-run in I1.5-D, read-only against the *staging* database):

```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
```

It must return 0, and `_prisma_migrations` must not exist. If the result is anything else, STOP.

### 3.4 Provisioning sequence (mandatory order)

The Vercel Git-import flow defaults the production branch to `main` and offers an immediate Deploy. A first build before the guard and settings exist could migrate an unintended database. So:

1. Merge the identity guard (3.3) to `main` through the normal PR and CI process.
2. Satisfy the `aura-updated` Preview prerequisite (2.1): Ignored Build Step or owner risk acceptance.
3. Create the `staging` branch from that `main` commit. Add branch protection on `staging`, allowing fast-forwards from `main` only.
4. Create the staging Neon project. Run the empty-database check.
5. Create `aura-staging` **without deploying**: no Git connection yet, or abandon the import before clicking Deploy.
6. Configure it: Production Branch `staging`, Node 24.x, Ignored Build Step, `ssoProtection` set to `all`, `protectionBypass` empty, and allowlisted variables only.
7. **Mandatory:** pin the new staging project ID in the guard (3.3 step 4) through a PR to `main`, and fast-forward `staging` to it. Until this lands, any third project with the guard variables would pass the guard.
8. Connect Git and trigger the first `staging` build.

**Note for the guard PR's rollback section:** the guard also runs in **Production** builds. If `VERCEL_PROJECT_ID` were ever missing there, Production builds would fail. That fails safe, since the previous deployment keeps serving, and the fix is to revert the guard PR. An optional later hardening is a reverse check: the Production project ID is refused if its database host matches the staging host.

**STOP** if any deployment occurs on `aura-staging` before step 6 is complete.

### 3.5 Code provenance for staging

`ci.yml` runs only on pushes and PRs to `main`, so code on `staging` would otherwise be deployed, and migrated, without CI. Rules:
- `staging` may only fast-forward to commits that already passed CI on `main`, or on a green PR head targeting `main`. Alternatively, add `staging` to the CI triggers (a CI change, I1.5-D).
- **Migrations must never land on `staging` before `main`.** Otherwise the staging migration history diverges from the main chain.
- Acceptance test 18 checks the deployed staging SHA has a green CI run.

### 3.6 Backup, retention and cleanup

- Use Neon's default point-in-time history. No extra backups are needed, since staging data is synthetic.
- **Retention:** staging data is disposable. Document a reset procedure: drop and recreate the staging Neon project, or reset its branch to empty.
- **Teardown:** delete the `aura-staging` project and the staging Neon project. Both are independent of Production.

---

## 4. External integration strategy

Only integrations with evidence in the repository are listed.

| Integration (evidence) | Purpose | Staging behaviour | Rationale |
|---|---|---|---|
| **Resend** (`lib/email.ts`, `https://api.resend.com`) | Magic-link and 6-digit sign-in email | **Separate restricted credentials.** A dedicated Resend API key (sending-only), using the sandbox sender `onboarding@resend.dev` or a verified staging sender. Recipients limited to the owner's own address(es). | Under `NODE_ENV=production` the sign-in route **refuses** to work without an email provider (it fails closed and never returns dev codes), so staging needs real email to sign in at all. |
| **Mail-o-Mail** (`lib/email.ts`, `https://mail-o-mail.com`) | Alternate email provider (wins when configured) | **Disabled** (unset) | One provider is enough. It must not be set alongside Resend. |
| **OpenCage** (`lib/geocoding.ts`) | Location search and reverse geocode | **Disabled** by default; it throws "not configured", and so does Production today. Optional separate free-tier key, if approved. | Not configured in Production either |
| **Web Push / VAPID** (`lib/webPushServer.ts`, `web-push`) | Push notifications | **Disabled** (unset) | Avoids push to real devices. Not configured in Production either. |
| **Vercel Cron** (`vercel.json` → `/api/internal/reminders/dispatch`) | Daily reminder dispatch | **Effectively disabled:** `INTERNAL_REMINDER_DISPATCH_SECRET` unset, so the route returns 401. It runs daily on the staging production target and is harmless. | Fails closed by code |
| **Internal metrics** (`/api/internal/product-metrics`, `INTERNAL_METRICS_SECRET`) | Product metrics | **Disabled** (unset) | Not needed |
| **Product events** (`lib/productEvents`, `trackEvent`) | First-party analytics into the app's **own** database | Allowed. Writes go to the staging database only. | No third-party analytics found |
| **Shadow policy** (`AURA_SHADOW_POLICY_MODE`) | Internal evaluation mode | **OFF** (unset) | Default |
| **Remote MCP** (`AURA_MCP_*`) | MCP endpoint | **Blocked until separately approved** (unset, giving 404) | Security |
| **Payments** | — | None found in the repository | — |
| **OAuth / third-party sign-in** | — | None found. Aura uses its own email-code sign-in. | — |
| **Neon Auth** (`NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL` in Production variables) | Not referenced by code | **Do not configure** | Unused |
| **GEMINI** (`.env.example` only) | Not referenced by code | **Do not configure** | Unused |

---

## 5. MCP and Palmistry safeguards

- **MCP:** `AURA_MCP_REMOTE_ENABLED`, `AURA_MCP_RESOURCE_URL` and `AURA_MCP_AUTHORIZATION_SERVER` are not created in `aura-staging`, so `/api/mcp` and both metadata URLs return 404 for every method (fail-closed config, proven in I1/M1/M2). There's no OAuth authorization server and no OAuth credentials, Production or otherwise. No externally accessible MCP testing in this phase. Deployment Protection stays on, so even the 404s aren't public.
- **Palmistry:** staging builds run `vercel-build.sh`, so the bundle scanner runs and fails the build on any leak. `NODE_ENV=production` keeps the publication gate closed. `packages/palmistry/src/review-status.json` stays `PENDING_HUMAN_REVIEW` / `approvedBy: null`. Staging must not be used to "preview publication" by editing that file.

---

## 6. Capacitor / native configuration

- **Risk today:** `CAP_SERVER_URL` is free-form at `npx cap sync` time. A developer could point a native shell at **Production** (`aura-updated.vercel.app`), or at a **Preview** (which uses the Production database). The synced config is git-ignored, so the choice is invisible in review.
- **Future design** (I1.5-D or a native ticket; **not changed now**):
  1. Add an explicit `CAP_ENV` (`local`, `staging` or `production`) that decides the URL. `CAP_SERVER_URL` is then only an override, validated against an allowlist for that `CAP_ENV`.
  2. `capacitor.config.ts` refuses any `*.vercel.app` preview hostname, any Production hostname unless `CAP_ENV=production`, and anything unexpected. It **throws at sync time**.
  3. Staging native builds use a **distinct appId**, e.g. `com.greenarrow.auraschedule.staging`, and app name ("Aura Staging"), so a staging build can't overwrite or be mistaken for Production on a device.
  4. Staging URL is the `aura-staging` production URL. Note that Vercel Authentication blocks native webviews, so native staging testing needs either a team-authenticated session in the webview or a later, separately approved access approach. **No bypass secret in this phase.**
- No native builds or launches in this ticket.

---

## 7. Staging acceptance tests

To be run in I1.5-D after authorized provisioning; **not run now**.

| # | Check | Evidence | STOP if |
|---|---|---|---|
| 1 | Vercel project identity | `vercel project inspect aura-staging`: project ID differs from `aura-updated`; root `apps/web`; Node 24.x; Production Branch `staging` | It is `aura-updated`, or Production Branch is `main` |
| 2 | Deployment source | `vercel inspect <staging url>`: `githubCommitRef=staging`, expected SHA, target production (staging) | Ref `main` or an unexpected SHA |
| 3 | Database identity (positive) | Build log shows `DB identity verified (staging)` before `prisma migrate deploy`; the operator compares the normalised staging and Production hosts by **hash** | Hosts equal, guard line missing, or migrate ran before the guard |
| 3b | Database guard (negative, mandatory) | Set `AURA_STAGING_EXPECTED_DB_HOST` to a wrong value and trigger a build. The log shows `DB identity REFUSED`, the build fails before `migrate deploy`, and no deployment is promoted. Then restore the correct value. Also confirm that a missing `VERCEL_PROJECT_ID` or missing guard variable fails closed (unit test of the guard script in CI). | The build succeeds or migrate runs with a wrong expected host |
| 4 | Empty before migrations | The section 3.3 SQL returns 0 tables before the first deploy | Any table exists |
| 5 | No Production data | After migrations: `SELECT count(*) FROM "User"` = 0 (or the synthetic seed count only); no non-`@example.test` emails | Any real-looking user row |
| 6 | No Production secrets | `vercel env ls` on `aura-staging` lists only the allowlist (2.2). `AUTH_SECRET` and DB credentials are confirmed newly generated (operator attestation). No `NEON_*`, `PG*` or `POSTGRES_*` integration variables. | Any non-allowlisted variable, integration-linked variable, or reused secret |
| 7 | Production services inaccessible | No Production DB host in any staging variable; the forbidden-host guard is active; push, cron and metrics secrets unset (endpoints 401 or disabled) | Any staging path that can reach the Production DB |
| 8 | Remote MCP disabled | No `AURA_MCP_*` variables; with team auth, `/api/mcp` and both `/.well-known/oauth-protected-resource[/api/mcp]` return 404 for all methods | Any non-404 |
| 9 | Palmistry gate | Build log `[palmistry-bundle] OK: none of 8`; Explore shows three cards; `review-status.json` unchanged | Scanner missing or failing, or a fourth card |
| 10 | Health and migrations | Build log "51 migrations found" then (first deploy) applied / (later) "No pending"; `/api/health` returns 200 with `db: connected` (team-authenticated) | Migration error or health ≠ 200 |
| 11 | Safe app and mobile URLs | Staging URL ≠ any Production hostname; the native config guard (section 6, when implemented) rejects Production and Preview hosts | A staging artifact points at Production or a Preview |
| 12 | No Production changes | `aura-updated` settings, variables, domains, `ssoProtection` and `protectionBypass` metadata are unchanged (diff of `vercel project inspect`, `env ls` names and the project API before and after), except the separately authorized Ignored Build Step (2.1). The Production deployment ID is unchanged. | Any unapproved Production drift |
| 13 | Staging access protection | `ssoProtection.deploymentType = "all"` and empty `protectionBypass` on `aura-staging` (project API). An **unauthenticated** `curl` to the staging production domain **and** to a deployment URL returns 401 or a 302 to Vercel SSO. | Any unauthenticated 200, or any bypass configured |
| 14 | Sequencing | `aura-staging` deployment history shows no deployment before configuration was complete (3.4) | Any early deployment |
| 15 | Branch filtering | Pushing a non-`staging` branch produces no deployment, or a CANCELED one, on `aura-staging` (canceled builds still count toward quota) | A non-`staging` build completes |
| 16 | Cron closed | The daily cron call to `/api/internal/reminders/dispatch` on staging returns 401 (deployment logs), and Hobby cron limits allow the second project's cron | Cron returns 2xx |
| 17 | Email restricted | The Resend key is restricted (sending-only); sign-in email reaches only the allowlisted owner address(es) | Mail delivered to a non-allowlisted address |
| 18 | Code provenance | The deployed staging SHA has a successful CI run (required checks green) and is reachable from `main` | Staging SHA has no green CI run or isn't on `main` |
| 19 | No integration or shared-variable linkage | The `aura-staging` project API shows no `configurationId` on any variable, no connected storage or Neon integration, and no team shared variables attached | Any linkage present |
| 20 | `aura-updated` Preview of `staging` | The Ignored Build Step on `aura-updated` skips `staging` (deployment shows CANCELED), or the owner risk acceptance is on record | A completed `aura-updated` Preview of `staging` without risk acceptance |

---

## 8. Provisioning prerequisites and costs (owner approval required)

| Item | Need | Cost / limit notes |
|---|---|---|
| Vercel project `aura-staging` | Create in team `aura-56a1` (**Hobby**) | Hobby allows multiple projects. Vercel's current docs say protecting **all** deployments (including production domains) is available on all plans and Vercel Authentication is available on Hobby. **Confirm at provisioning**; if `all` can't be set, STOP (2.1). Also confirm the Hobby terms on non-commercial use and the Hobby cron limit for a second project. A Pro upgrade (about $20/member/month; verify current pricing) is only needed if a Hobby limit blocks the design. |
| `aura-updated` Ignored Build Step for `staging` | Prerequisite (2.1) | Production project configuration change; separate authorization |
| `staging` branch protection | Fast-forward from `main` only | GitHub settings change; separate authorization |
| `staging` branch | Create from `main` | Free |
| Neon staging project | A new, separate project | **Unverified:** project limits on the current Neon plan and whether the existing marketplace integration constrains it. A separate Neon account or org may be cleanest. |
| Resend restricted key | New API key | Free tier is likely enough (verify) |
| Optional OpenCage key | Only if location search must be tested | Free tier (verify) |
| `vercel-build.sh` database identity guard (3.3), fail-closed, with unit test | Code change merged to `main` **before** the staging project exists (3.4) | Part of I1.5-D implementation |
| Optional custom staging domain | DNS change | Owner |

---

## 9. Independent review findings

An independent reviewer (read-only) checked the draft against the repository and Vercel metadata.

**Round 1: REQUEST CHANGES.**
- **P1-1:** the database guard failed open.
- **P1-2:** staging Deployment Protection was unresolved and untested.
- **P2-1 to P2-5:**
  - the automation bypass secret on `aura-updated` wasn't inventoried;
  - project-creation sequencing;
  - no CI on `staging`;
  - the `aura-updated` Preview of `staging` was optional;
  - tooling secret-leak paths.
- **P3s:** `DATABASE_URL_UNPOOLED` unused; pooled vs direct URL; more acceptance tests.

**Round 2: APPROVE WITH NOTES.** Both P1s are resolved (§3.3 fail-closed guard and negative test 3b; §2.1 mandatory `ssoProtection: all` with an empty `protectionBypass` and test 13). All P2s are addressed (§1, §3.4, §3.5, §2.1, §2.2, tests 12–20). The residual P3s have now been applied: mandatory pinning of the staging project ID before the first build, the fail-safe Production-build note in the guard PR, and the optional reverse check.

**Verified correct by the reviewer:**
- `VERCEL_ENV=production` on the staging production branch, so `vercel-build.sh` will migrate.
- The Ignored Build Step expression is correct (exit 1 builds, exit 0 skips).
- The variable inventory is complete (22 code-referenced names; no middleware; `next.config.js` reads only `NODE_ENV`).
- `engines.node` overrides the dashboard setting.
- The MCP and Capacitor treatment is adequate.

**Remaining unknowns, to confirm at provisioning:**
- Hobby Deployment Protection scope `all` (docs say it is available on all plans).
- Neon project limits.
- Hobby cron and terms.
- Whether Production's `DATABASE_URL` is pooled or direct.
- Team shared variables (not verified by the reviewer).

## 10. Verdict

**I1.5-C design: complete and independently reviewed, with no unresolved P0 or P1.** Provisioning (I1.5-D) needs explicit owner approval of the section 8 prerequisites.
