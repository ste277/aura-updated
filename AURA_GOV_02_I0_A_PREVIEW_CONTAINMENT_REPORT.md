# AURA-GOV-02-I0-A: Preview Credential Containment Report

**Date:** 2026-11-10 · **Repository:** `ste277/aura-updated` · **Vercel project:** `aura-updated` (`prj_iY4xteQOWUNsV85NnbyIylBAba6t`, team `aura-56a1`, Hobby)

## Verdict: **PARTIALLY CONTAINED — EXISTING DEPLOYMENT RISK**

- **Future** Preview builds can no longer receive any Production database, Neon or Resend credential.
- **145 existing READY Preview deployments** (146 retained non-production deployments in total) were built while those credentials targeted Preview, and still carry them in their runtime environment.
- That residual risk is closed by the I0-C rotation (old credentials revoked), or by deleting those deployments. Both need separate owner approval.

---

## 1. Baseline (2026-11-10T13:49:36Z, preflight)

| Item | Value |
|---|---|
| `origin/main` | `e921f54974c443966cd7d35953e8f03635b9d0ef`, tree `c5e1240a4ddbf879fb6389144c04b62cbc4a3f4b` |
| Vercel project | `aura-updated`, linked to GitHub `ste277/aura-updated` (repo id 1331993685) |
| Production deployment | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`, READY, SHA `e921f54`, created by a git push |
| Production health | `/` → 200. Live database read: `/moment/<nonexistent>` → `initialOutcome: NOT_FOUND`, which means the SELECT succeeded. |
| Protection | `protectionBypass` 0 entries; SSO `all_except_custom_domains`; auto-assign `true`; no Ignored Build Step; team OIDC issuer enabled |
| Shared or integration variables | Team-level shared env: 0. Integration-linked (`configurationId`): 0 of 23. |
| Remote MCP | `/api/mcp` → 404 (GET and POST) |
| Palmistry | `review-status.json` = `{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}` |
| Open PRs | #344 (draft), #346 (draft); neither changes migrations |

## 2. Variable inventory (names, IDs, types, targets; no values)

There are 23 entries and 22 distinct names. `AUTH_SECRET` has separate Preview and Production entries.

**In-scope Production credentials:** 19 names, each a single entry, type `sensitive`, targets `preview,production` before I0-A.
- **Reconciliation:** the earlier "18 variables" counted `DATABASE_URL` plus "16 others" plus `RESEND_API_KEY`. The correct figure is **18 database and Neon names plus `RESEND_API_KEY` = 19**.

| Name | Env ID | Type | Before | After | Classification |
|---|---|---|---|---|---|
| `DATABASE_URL` | 3Q4UaRKHCFs1ZAvD | sensitive | preview,production | **production** | Production database credential (in use) |
| `DATABASE_URL_UNPOOLED` | CMJF8iH2OnLnIpgV | sensitive | preview,production | **production** | Production database credential (unused by code) |
| `PGHOST` | MVC2Wpx2pOkIHHIJ | sensitive | preview,production | **production** | Connection component (unused) |
| `PGHOST_UNPOOLED` | s971O9IJTCkjVcgy | sensitive | preview,production | **production** | Connection component (unused) |
| `PGUSER` | jkHDP8ONUWiaLT7h | sensitive | preview,production | **production** | Connection component (unused) |
| `PGPASSWORD` | oCkfdERGhJHJAmi0 | sensitive | preview,production | **production** | Production database password (unused) |
| `PGDATABASE` | 0nyJq4kti66uYpOT | sensitive | preview,production | **production** | Connection component (unused) |
| `POSTGRES_URL` | bYdo0a2Xx173E30h | sensitive | preview,production | **production** | Production database credential (unused) |
| `POSTGRES_URL_NON_POOLING` | TPkzlaMm5maR3lYR | sensitive | preview,production | **production** | Production database credential (unused) |
| `POSTGRES_URL_NO_SSL` | ccirJQGAlpu7z8Ag | sensitive | preview,production | **production** | Production database credential (unused) |
| `POSTGRES_PRISMA_URL` | HGs2MZ12TokJo1Li | sensitive | preview,production | **production** | Production database credential (unused) |
| `POSTGRES_USER` | wuWamUChEmcac9rY | sensitive | preview,production | **production** | Connection component (unused) |
| `POSTGRES_PASSWORD` | bimO2TbWQaFfPmg6 | sensitive | preview,production | **production** | Production database password (unused) |
| `POSTGRES_DATABASE` | RNyRh5EGwkEIh4Rd | sensitive | preview,production | **production** | Connection component (unused) |
| `POSTGRES_HOST` | xoLVAEmwKrLkvwYp | sensitive | preview,production | **production** | Connection component (unused) |
| `NEON_PROJECT_ID` | Q9VxRGbYeTuSVBlP | sensitive | preview,production | **production** | Identifier (not a credential; unused) |
| `NEON_AUTH_BASE_URL` | KhTVL3uGJEeioeBA | sensitive | preview,production | **production** | Neon Auth endpoint (unused) |
| `VITE_NEON_AUTH_URL` | Hz7Oija6GZILBqu0 | sensitive | preview,production | **production** | Neon Auth endpoint (unused) |
| `RESEND_API_KEY` | 9wIWbQWLA3QdQ288 | sensitive | preview,production | **production** | Production email credential (in use) |

**Intentionally left targeting Preview:**
- `AUTH_SECRET` (AqGmwrfHJnUryOTN, Preview's own separate value);
- `AURA_SHADOW_POLICY_MODE` (HsXBm5kJmndHJC8D, Preview-only config);
- `RESEND_FROM_ADDRESS` (K34v1moeIbyO71R2, a sender address, not a credential).

D-3 (Preview email disabled) is met by removing `RESEND_API_KEY` from Preview. The app refuses to send sign-in email when no provider is configured (`app/api/auth/request-link/route.ts`: "no email provider configured … refusing to expose sign-in credentials").

## 3. Containment actions

**Method:** `PATCH /v9/projects/<id>/env/<envId>` with body `{"target":["production"]}` only.
- No value was supplied, retrieved or printed.
- Vercel accepted target-only edits for `sensitive` variables, so no delete-and-recreate or dashboard hand-off was needed.

**Order:**
1. **Test first** on `NEON_PROJECT_ID`, which no code uses. Response: same ID, type `sensitive`, target `["production"]`, no value field.
2. Then the remaining 17 unused variables.
3. Then `DATABASE_URL`, then `RESEND_API_KEY`.

All 19 succeeded. Log: `/private/tmp/claude-501/-Users-stephen-Desktop-Claude-auraschedule-math-core/b1121d49-418e-41ef-a69a-ffd7ecb8d667/scratchpad/i0/patch-log.tsv`.

## 4. Read-back evidence (after containment)

- Entries before 23, after 23. **Same entry IDs.** No type changes. **No entry lost its Production target.**
- Entries still targeting Preview: only `AURA_SHADOW_POLICY_MODE`, `AUTH_SECRET` (Preview entry) and `RESEND_FROM_ADDRESS`.
- **Value preservation:** sensitive values can't be read back. A target-only `PATCH` leaves the value unchanged per the API's optional-field semantics. **The live Production deployment doesn't depend on this:** a deployment's environment is fixed when it is built, so changing targets affects only future deployments. Both in-use values (`DATABASE_URL`, `RESEND_API_KEY`) are replaced in I0-C anyway, before any new Production deployment.
- Project settings unchanged: `protectionBypass` 0, auto-assign `true`, no Ignored Build Step, SSO unchanged.

## 5. Existing Preview deployment assessment

| Question | Finding |
|---|---|
| Which deployments were created with Production credentials? | All retained non-production deployments: **146** (145 READY, 1 ERROR), from 2026-08-17 to 13:28:54Z today. The credentials have targeted Preview since 2026-08-14, before every retained deployment. Vercel retains 228 deployments in total (82 production). |
| Embedded in build artifacts? | **No evidence of embedding.** Code doesn't reference the 17 unused variables. `DATABASE_URL` and `RESEND_API_KEY` are read through `process.env` at runtime on the server. No `NEXT_PUBLIC_*` variables, and no `env:` block in `next.config.js`. So the values aren't compiled into client or server bundles. Build logs weren't searched for values, to avoid handling them. |
| Runtime environment still accessible? | **Yes.** Each deployment's functions keep the environment they were built with. Any code path in such a deployment that reads `process.env` has them. Those deployments are behind Vercel SSO (`all_except_custom_domains`), so they can be reached only by the Vercel team (the owner). |
| Who authored the code in them? | All 145 retained READY deployments have commit author `ste277`. Commits are unsigned (`unverified`), so author is a claim, not proof. **Historical:** PRs **#1–#16** (2026-08-17) were authored **and merged by Greenaroz** from same-repo branches, after the credentials began targeting Preview on 2026-08-14. So code authored by Greenaroz did build with Production credentials available. One retained deployment comes from that period (`feat/capacitor`, PR #6, author field empty). **This is not evidence of misuse.** It establishes that the exposure was realised, not merely theoretical. |
| Does redeploying or deleting eliminate the exposure? | Redeploying an old Preview now would build without the credentials, but the old deployment would keep its environment. Only **deletion** (owner approval) removes these deployments' copies. **Revoking the old credentials (I0-C) makes all copies useless**, wherever they are, including any copied out during the window. |
| Are the URLs still accessible? | Yes, to authenticated team members only. A plain unauthenticated request gets the SSO redirect (seen in earlier tickets). |

### Remediation plan (owner decision; not executed)

1. **Primary:** I0-C rotation. Once the old Neon role's login and the old Resend key are revoked, every copy embedded in old deployments is dead.
2. **Optional, additional:** delete the 145 READY non-production deployments created before 2026-11-10T13:50Z (list in `all-deployments.jsonl`). Trade-off: loses historical Preview URLs; can't be undone; no Production impact. **Needs separate owner confirmation.**
3. **New Previews** (after 13:50Z) build without the credentials, so they're safe. Their database routes fail closed until GOV-02-I2.

## 6. Production verification (after containment)

- Production deployment `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`, unchanged.
- `/` → 200.
- Live database read OK (`initialOutcome: NOT_FOUND`).
- No bypass secrets. No other Vercel settings changed.

## 7. Residual exposure

| Residual | Closed by |
|---|---|
| 145 READY Preview deployments carry the Production database URL and Resend key in their runtime environment (SSO-protected) | I0-C revocation (primary) or deletion (optional) |
| Any copy taken between 2026-08-14 and 2026-11-10T13:50Z (cannot be ruled out) | I0-C rotation |
| 16 unused Production variables still hold the current (soon old) role's credentials | Dead after I0-C revocation; delete in I0-C or G-D4 |
| Previews of #344 and #346 lose database and email until GOV-02-I2 | I2 (`aura-preview`) |
| **Production `AUTH_SECRET` probably reached Preview from 2026-08-14 to 2026-08-21** (review F-1). Production entry `5zHVNkKL8cSkGHcn` was created 2026-08-14T07:33:28Z and updated 2026-08-21T16:35:50Z, 40 s after the Preview entry `AqGmwrfHJnUryOTN` was created. That pattern fits splitting a shared entry. The window covers Greenaroz's PR #1–#16 Previews. A leaked `AUTH_SECRET` allows forged sessions and magic links. | **I0-C: rotate Production `AUTH_SECRET`** (added to I0-B) |
| **Local plaintext copies** (review F-5): gitignored `apps/web/.env.local` and `apps/web/.env.production.local` (pulled by the Vercel CLI on 2026-09-22) in the primary checkout, plus 7 worktree `.env.local` files, hold the 19 names; some values are non-empty, including `DATABASE_URL`, `RESEND_API_KEY` and `AUTH_SECRET`. Local tools read them (`playwright.config.ts`, `e2e/fixtures/cleanup.ts`, `scripts/retention-report.js`). | I0-C rotation makes them dead. The owner then deletes `.env.production.local` and checks which database each `.env.local` points at. |
| **Build-time vector** (F-13): Preview builds ran `npm install` lifecycle scripts and `next build` with the credentials present | Rotation (not deletion) is the remedy |

**Corrections from the review:**
- **F-8:** of the 145 READY non-production deployments, 144 have author `ste277` and 1 has an empty author (`feat/capacitor`, PR #6). The single ERROR deployment is by `ste277`.
- **F-9:** the first test edit (`NEON_PROJECT_ID`, 13:50:08.945Z) isn't a row in `patch-log.tsv`. It is confirmed by its live `updatedAt` and the §3 read-back.
- **F-10:** retention is configured as 30 days, keeping 10, yet August Previews are still listed. Re-count at I0-C; don't rely on retention.

### Correction (2026-11-10, from I0-C0-R2)

- "Integration-linked (`configurationId`): 0" is **wrong**. The 18 database and Neon variables are **Vercel Marketplace Neon integration-store secrets** (`contentHint.type = integration-store-secret`, store `neon-aquamarine-yacht`). I had checked `configurationId` instead of `contentHint`.
- The store's project link still lists **Preview and Production**. A future store sync may re-add Preview targets, so **this containment isn't durable** until the store link is set to Production only. See preflight R2.11 and R2.12.

## 8. Independent review (I0-D)

**Verdict for I0-A: AGREE with PARTIALLY CONTAINED — EXISTING DEPLOYMENT RISK.**

The reviewer was an independent read-only subagent. It confirmed live:
- 23 entries; the 19 in-scope entries target Production only, with the same IDs and types;
- only `AUTH_SECRET` (Preview entry), `AURA_SHADOW_POLICY_MODE` and `RESEND_FROM_ADDRESS` reach Preview;
- Production unchanged (`dpl_mYJA…`, 200, database read OK, MCP 404);
- bypass count 0; no deployments after 13:49Z; GitHub untouched.

`VERCEL_OIDC_TOKEN` reaches Previews; that is acceptable while no federation trusts the team issuer. The reviewer widened the residual exposure with F-1, F-5 and F-13, now in §7.

**Disclosure:** to check F-2 and F-5, the reviewer read the local gitignored `.env*` files in memory. It printed only key names, booleans and anonymised role labels, never values or role names.
