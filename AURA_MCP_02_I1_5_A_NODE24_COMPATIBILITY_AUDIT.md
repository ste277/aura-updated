# AURA-MCP-02-I1.5-A: Node 24 Compatibility Audit

- **Date:** 2026-11-10, about 12:54–13:20 UTC
- **Mode:** audit only. No source, dependency, lockfile, CI, Docker or runtime changes. Nothing installed or switched.
- **Workspace:** a read-only inspection copy of the exact `origin/main` tree (`git archive`) in the session scratchpad. The primary checkout was not modified.

---

## 1. Baseline and evidence

| Item | Value |
|---|---|
| `origin/main` | `e921f54974c443966cd7d35953e8f03635b9d0ef`, tree `c5e1240a4ddbf879fb6389144c04b62cbc4a3f4b`. **Matches the M4 baseline**; no commits since. |
| Primary checkout | Local `main` and `HEAD` at `f35d35a` (stale, deliberately not updated); 0 tracked changes; untracked report files only; 1 unrelated stash (`pce4a-lahiri-ayanamsa-epoch-fix`), not touched; 117 worktrees, not touched |
| M4 report | `AURA_MCP_02_I1_M4_POST_MERGE_CLOSURE.md`: present and reviewed |
| Required checks | Next.js production build, MCP Server, Database migration validation, Ephemeris / panchang tests. All **success** on post-merge run `42813270945` (`e921f54`). Day Constructor fails with the #323 baseline only. |
| Credentials | Not needed. Vercel was read through `vercel project inspect`, `vercel env ls` (names only) and `vercel api` GETs; no values were printed. |

**Runtime evidence already available, observed rather than declared:**
- **Vercel builds and runs on Node 24.x.** The project setting is `Node.js Version 24.x`. Production `dpl_mYJAoAr1…` (`e921f54`) built on Vercel's Node 24 image: `prisma migrate deploy` ("51 migrations found / No pending"), `next build` with type checking, and the Palmistry scanner all ran. `/api/health` reports `db: connected`.
- **CI runs on Node 20.20.2** (`actions/setup-node@v4` with `node-version: 20`). GitHub already warns that the `checkout@v4` and `setup-node@v4` *action runtimes* are forced onto Node 24.
- **Local development:** the Homebrew default is Node **26.5.0**. `node@24` is also installed but was **not used** (switching runtime isn't authorized). During M1/M2 verification on Node 26, the root ts-node suites, `apps/mcp` (40/40), the remote MCP suite (67/67), Palmistry suites and `next build` all passed. That is evidence for Node ≥24 tooling, but **not** a Node 24 run.

**So Production already runs Node 24. The gap is that CI and Docker (and `.nvmrc`) still say 20, which means the tests don't exercise the Production runtime.**

**Lifecycle context:**
- Node 20 is past end-of-life, and Vercel lists Node 20 as deprecated from 2026-10-01.
- Vercel's *default* for new projects is now 26.x. A newly created project, such as the proposed `aura-staging`, would default to 26 unless pinned, which is another reason for A6.
- Node 24 is the current Active LTS line.

---

## 2. Runtime inventory

| # | File and location | Current | Affects |
|---|---|---|---|
| R1 | `.nvmrc` (repo root) | `20` | Local dev (nvm users) |
| R2 | `.github/workflows/ci.yml` lines 17, 673, 709, 751, 842: `actions/setup-node@v4` `node-version: 20` (jobs `math-core-tests`, `web-build`, `mcp-server`, `db-migration-validation`, `day-constructor-acceptance-db-tests`) | Node 20 (resolves to 20.20.2) | CI, including all 4 required checks |
| R3 | `.github/workflows/ci.yml`: `actions/checkout@v4`, `actions/setup-node@v4` | Action runtime Node 20, forced to Node 24 by GitHub (warning) | CI |
| R4 | `deploy/Dockerfile` stages `deps`, `build`, `runtime`: `FROM node:20-alpine` (×3) | Node 20 (Alpine) | Docker / Railway / self-hosted path (`deploy/compose.yml`) |
| R5 | `deploy/compose.yml`: `postgres:16-alpine`, `aura-app:latest` | No Node pin (uses the image from R4) | Docker path |
| R6 | Vercel project `aura-updated`: Node.js Version setting | **24.x** | Vercel Preview and Production |
| R7 | `package.json` (root), `apps/web/package.json`: `engines` | **None** | Vercel falls back to the project setting; npm doesn't warn |
| R8 | `apps/mcp/package.json`: `engines.node` | `>=20` | Local stdio MCP users |
| R9 | `@types/node`: root `^20.14.0`, `apps/web` `^20.14.0`, `apps/mcp` `20.14.0` (exact) | Node 20 typings | Type checking (all) |
| R10 | `packageManager` field | None (npm; lockfiles v3: root, `apps/web`, `apps/mcp`) | All |
| R11 | Vercel install command | `npm install --prefix ../.. && npm install` (npm bundled with Vercel's Node 24, i.e. npm 11) | Vercel |
| R12 | `apps/web/scripts/vercel-build.sh` | POSIX `sh`; runs `npx prisma migrate deploy` only when `VERCEL_ENV=production`, then `next build`, then the Palmistry scanner | Vercel |
| R13 | `.node-version`, `.tool-versions`, `.npmrc` | Absent | — |
| R14 | `deploy/deploy.sh`, `deploy/release.sh`, `deploy/backup.sh` | No Node pin. `deploy.sh` applies migrations with **`psql` into a custom `_migrations` table**, not Prisma. | Docker / self-hosted path |

---

## 3. Compatibility matrix

"Readiness" is judged from evidence: what has actually run on Node 24, upstream engine declarations, and the type of native code involved. It isn't taken from declared ranges alone.

| Component | Current runtime | Node 24 readiness | Risk | Proposed action |
|---|---|---|---|---|
| Next.js `14.2.35` (`apps/web`) | Vercel 24, CI 20, Docker 20 | **Proven on Vercel 24** (Production build and runtime) | Low | Run the CI `web-build` job on 24 |
| Prisma CLI and client `^5.17.0` (resolved **5.22.0**); `prisma migrate deploy` | Vercel 24 (migrate only), CI 20, Docker 20 (`prisma generate`) | **Proven on Vercel 24 for `migrate deploy`.** The runtime data layer is `pg`, not Prisma Client. Whether Prisma 5.x is upstream-tested on Node 24 is **unverified** (no source consulted); treat it as untested. | **Medium** (migrations are the critical path; Alpine needs the musl/OpenSSL 3 engine) | Run `db-migration-validation` on 24. Verify `prisma generate` on `node:24-alpine` in a Docker build. Keep the Prisma major unchanged in I1.5-B (no upgrade). |
| `pg` `^8.12` (web) / `^8.23` (root dev) | Vercel 24 at runtime | **Proven on Vercel 24** (health, DB-backed routes). The `pg-connection-string` SSL-mode deprecation warning already appears and is unrelated to Node. | Low | None. Note the SSL-mode warning for a separate ticket. |
| `@prisma/engines`, `.prisma` query engine | N-API library plus binaries | Prebuilt per platform, not compiled against the Node ABI | Low–Med (Alpine/OpenSSL) | Docker smoke test (build plus `/api/health`) |
| `@next/swc-*` | N-API prebuilt | ABI-stable across Node versions | Low | Covered by the build |
| `fsevents` | macOS dev only, optional | Prebuilt | Low | None |
| node-gyp-compiled modules | **None found** (only `.node` files are Prisma, SWC, fsevents). Install scripts exist only for `prisma`, `@prisma/client` and `@prisma/engines`. | — | Low | None |
| `ts-node` `^10.9.2` + `typescript` `^5.5.4` (root tests, CommonJS, `moduleResolution: node`) | CI 20 | Ran on Node 26 locally (M1/M2). Node ≥22.18 strips TypeScript types only for direct `node file.ts`; ts-node's require hook still applies. `require(esm)` is on by default in Node ≥22.12, which could change resolution for dual-format packages (`@modelcontextprotocol/server` exposes `require`, so it's fine). | **Medium** (largest CI surface: about 250 ts-node steps) | Run the full `math-core-tests` job on 24 and diff `OK`/`FAIL` counts against Node 20 |
| `jsdom` `^24.1.3` (+ `tsconfig.jsdom-tests.json`) | CI 20 | Supports Node ≥18. Ran on 26 locally (Palmistry jsdom 78/78). | Low | Covered by CI |
| `@playwright/test` `^1.62.1` (e2e, not in CI) | Local | Supports current LTS lines | Low | Optional local e2e smoke |
| `@modelcontextprotocol/server` `2.4.0` (root) | Vercel 24 (bundled), CI 20 | `engines >=20`. Built on Vercel 24 (`07a3ecd` Preview and `e921f54` Production). | Low | Covered |
| `@modelcontextprotocol/sdk` `1.32.2` (`apps/mcp`) | CI 20; end-user machines | `engines >=18`. Ran on 26 locally. | Low | Run `mcp-server` as a matrix [20, 24] (stdio users may still run 20) |
| `zod` `4.6.7`, `astronomy-engine` `^2.1.19` | All | Pure JS | Low | None |
| `web-push` `^3.6.7` | Vercel 24 (VAPID not configured in Production) | Uses `node:crypto` (ECDH/ECDSA P-256), which Node 24's OpenSSL 3.5 supports. Its dependencies may emit deprecation warnings (`url.parse`/`punycode`). | Low | Exercise `webPushServer` unit tests on 24. Note any warnings. |
| `@capacitor/cli` `^6.2.1` and platforms | Local only (`cap sync`) | Capacitor 6 CLI needs Node ≥18. Native builds were not run (prohibited). | Low (dev only) | Optional `npx cap sync --dry-run` equivalent in I1.5-B, if authorized |
| `@types/node` `^20.14` | Type checking | Node 20 typings can miss or contradict Node 24 APIs | Low | Bump to `^24` (root, web). Leave `apps/mcp` at 20.14.0 to match its `>=20` support floor (see A7). |
| npm 11 (bundled with Node 24) | Vercel; CI after change | Lockfile v3 is compatible. Vercel already installs with Node 24's npm. The existing `npm warn Unknown env config "cache-dir"` is Vercel environment noise. | Low | Watch for lockfile rewrites in CI (`npm install` should not modify the lockfile; check `git diff --exit-code`) |
| GitHub action runtimes (`checkout@v4`, `setup-node@v4`) | Forced to Node 24 | Deprecation warning only | Low | Move to the next major versions (v5) when bumping |
| Docker base `node:20-alpine` | Docker path | `node:24-alpine` exists (Active LTS) | Medium (no test coverage today; Prisma on musl) | Bump all 3 stages. Build and health-check smoke. |
| `.nvmrc` | Local | — | Low | `24` |

---

## 4. Dependency and tooling risks (ranked)

1. **Prisma 5.x on Node 24** (Medium). It's already proven for `migrate deploy` on Vercel 24 (glibc). It's unproven for `prisma generate` and engine loading on `node:24-alpine` (musl) in Docker. The I1.5-B gates are CI `db-migration-validation` on Node 24 plus a Docker build smoke.
2. **ts-node CommonJS test harness on Node 24** (Medium). The behaviour change to watch is `require(esm)` defaults (Node ≥22.12) and stricter deprecations. Gate: run the full `math-core-tests` and Day Constructor jobs on 24, with per-step `OK`/`FAIL` counts identical to the Node 20 baseline except for the documented #323 lines and #340.
3. **Time-zone and ICU data drift** (Low–Medium, Panchangam-specific). Node 24 ships newer ICU/tzdata. Timing and Panchangam tests depend on `Intl` time-zone resolution, so DST and edge-date assertions could shift if tz rules changed. Gate: the ephemeris, panchang, timing and DST parity tests must pass with identical outputs.
4. **Docker path drift** (Medium for the Docker path only). The Dockerfile already doesn't track `apps/mcp`, by design. A Node bump must not change the standalone output layout (`server.js` at the tracing root).
5. **Deprecation warnings** (Low): `url.parse`, `punycode` and the `pg` SSL-mode warning. Not failures; record them in CI logs.
6. **Local developer drift** (Low): `.nvmrc` says 20 while the Homebrew default is 26. Pin 24 to reduce "works on my machine" variance.

---

## 5. Proposed implementation changes (for I1.5-B; not implemented)

| ID | Change | File | Authorization |
|---|---|---|---|
| A1 | `.nvmrc`: `20` → `24` | `.nvmrc` | I1.5-B |
| A2 | `node-version: 20` → `24` in all 5 jobs | `.github/workflows/ci.yml` (lines 17, 673, 709, 751, 842) | I1.5-B (CI workflow change) |
| A3 | `actions/checkout@v4` → `@v5`, `actions/setup-node@v4` → `@v5` (pin to release tags) | `.github/workflows/ci.yml` | I1.5-B |
| A4 | `mcp-server` job as a matrix `node: [20, 24]`. Keep the job name **"MCP Server"** stable, or update the branch-protection required-check name in the same change window. | `.github/workflows/ci.yml` | I1.5-B, **plus governance approval if any required-check name changes** |
| A5 | `FROM node:20-alpine` → `node:24-alpine` (3 stages). Optionally pin a digest. | `deploy/Dockerfile` | I1.5-B (image build needs authorization) |
| A6 | Add `"engines": { "node": "24.x" }` to **`apps/web/package.json`** (the Vercel Root Directory). | `apps/web/package.json` | I1.5-B. Vercel's docs say `engines.node` **overrides** the project setting. Use the documented `24.x` form; Vercel's resolution of ranges like `>=24 <25` isn't documented, and `>=22` maps to the latest version (26.x). Root `package.json` engines are irrelevant to Vercel. If added for developers, expect `EBADENGINE` *warnings* (not failures) on the Node 20 `mcp-server` matrix leg and on local Node 26. The PR Preview log must show Node 24 before merging. |
| A7 | Keep `apps/mcp` `engines.node` at `>=20` (local stdio users), backed by the [20, 24] matrix from A4 | — | Decision only |
| A8 | `@types/node` → `^24` (root, `apps/web`) | `package.json` files and lockfiles | I1.5-B (lockfile change) |
| A9 | Add a CI guard that installs don't rewrite lockfiles (`git diff --exit-code -- '**/package-lock.json'` after the installs) | `.github/workflows/ci.yml` | I1.5-B (optional) |

**Explicitly excluded from I1.5-B:** Prisma, Next or Capacitor major upgrades; Vercel setting changes (already 24.x); switching Vercel's install to `npm ci` (separate ticket).

---

## 6. Test matrix, merge gates and rollback

**Test matrix (I1.5-B PR):**

| Surface | Node 20 (baseline) | Node 24 | Pass criterion |
|---|---|---|---|
| `math-core-tests` (ephemeris, Panchangam, timing, remote MCP 67, Palmistry) | from run `42813270945` | new | Same steps and same `OK` counts; 0 `FAIL` |
| `web-build` (+ type check + Palmistry scanner) | ✓ | new | Compiles; `[palmistry-bundle] OK: none of 8` |
| `mcp-server` | ✓ | new (matrix) | 40/40 on both |
| `db-migration-validation` | ✓ | new | Fresh-database chain of 51 migrations applies; status up to date |
| `day-constructor-acceptance-db-tests` | #323 only | new | Only the 3 #323 signatures (and #340 if its time window hits, with exact signature) |
| Docker | — | `docker build -f deploy/Dockerfile .` then `docker run` with a local, disposable Postgres; `GET /api/health` returns 200 | Image builds; `prisma generate` succeeds on musl; healthcheck passes. **Needs Docker authorization; no registry push.** This smoke test does **not** exercise `deploy/deploy.sh`'s `psql`/`_migrations` path. If that path is still used, add a disposable-Postgres run of it, or state that it's out of scope. |
| Local smoke (optional) | — | `PATH=/opt/homebrew/opt/node@24/bin:$PATH npm test` in `apps/mcp`; `npx ts-node test/mcpRemoteTransport.test.ts` | Same counts |

**Merge gates:**
1. All 4 required checks green on Node 24.
2. Day Constructor failures limited to the exact #323 signatures.
3. Docker smoke evidence attached.
4. No lockfile change except A8.
5. Independent review.
6. M-style pre-merge checklist.

**Rollback:** CI and Docker changes are a single revertible commit. Vercel is unaffected because it already runs 24, so production risk from I1.5-B is nil unless A6 (`engines`) is mis-set. Mitigation: A6 must use exactly `"24.x"`, and the PR Preview build must confirm `Node.js 24` in its log before merging. Docker rollback is to re-tag the previous image.

---

## 7. Independent review findings

An independent reviewer (read-only) verified the runtime inventory against the tree: `.nvmrc` 20; `ci.yml` `node-version: 20` at lines 17, 673, 709, 751 and 842; `node:20-alpine` ×3; Vercel `nodeVersion 24.x`; no engines in root or web; `apps/mcp` `>=20`. It confirmed that no node-gyp native modules exist, that Prisma is used for migrations and generate only (the runtime data layer is `pg`), and that `engines.node` overrides the dashboard setting.

**Round 1: APPROVE WITH NOTES.** No P0 or P1. P3s:
- A6 should use `"24.x"` in `apps/web` only, with the `EBADENGINE` note.
- Add lifecycle context (Node 20 past end-of-life; Vercel's default is 26.x).
- Mark the Prisma upstream-support claim as unverified.
- Inventory `deploy/*.sh` and note that the Docker smoke test doesn't cover the `psql`/`_migrations` path.

All were applied.

**Round 2: APPROVE WITH NOTES.** One residual P3: rollback wording should match `"24.x"` exactly. Applied.

## 8. Verdict

**I1.5-A audit: complete and independently reviewed, with no P0 or P1.** I1.5-B (CI, Docker and `.nvmrc` alignment to Node 24, per section 5) is ready for implementation authorization. The Docker build smoke test needs Docker authorization.
