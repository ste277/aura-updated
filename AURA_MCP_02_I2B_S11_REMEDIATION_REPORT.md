# AURA-MCP-02-I2b-S11: final activation blocker remediation

- **Baseline:** `a724997` (main after PR #387). **Branch:** `feature/aura-mcp-02-i2b-s11-blocker-remediation`.
- **Scope:** the six findings of the S10 independent review (`AURA_MCP_02_I2B_S10_INDEPENDENT_REVIEW/`, main checkout root).
- **Status:** LOCAL ACTIVATION BLOCKERS RESOLVED; ready for final independent verification.
  - MCP stays disabled, staging is a NO-GO and Production activation is on HOLD.
  - Nothing was deployed, configured, activated or merged, no credentials or environment variables were touched, and Neon was never accessed.

## 1. Disposition

| ID | Finding | Disposition | Before → after (regression) |
|---|---|---|---|
| **P2-1** | Checked-out pg client emits an unhandled `error` | **Fixed.** `guardClient` attaches one listener per checkout, in store statements, held activations and limiter decisions. A clean release removes exactly that listener; a discarded connection keeps it for late socket errors. The first error marks the client broken and discards it. | Pre-fix: **2 uncaught exceptions** per terminated or idle-timed-out held activation (S11Db P2-1a, P2-1b, A6). Post-fix: **0**. The commit reports the precise `not_committed`, the code stays pending, the pool recovers, and **0 listeners** remain on a client after 180 checkouts. Real `pg` Pool with `MCP_PG_POOL_BOUNDS`, no test listeners. |
| **P2-2** | A body-carried code's final check is status-only | **Fixed by restriction.** Each static client has `response_modes: ['query']`, so `form_post` and `fragment` are refused (`invalid_request`) before a code exists. A code is deliverable only in `Location`. At `finish`, the same status below 400 **and** a `Location` that still carries the code are required. Discovery advertises `query` only. MCP / OAuth 2.1 clients use the query redirect with PKCE. | Pre-fix: `form_post` **created a code and sent it in the response body**, `fragment` created a code, and discovery listed 3 modes. Post-fix: no code is created for either mode, a same-status replacement (303 kept, `Location` without the code) is never committed (pending, 400 on the other instance), explicit `query` issues normally, and discovery shows `["query"]`. |
| **P2-3** | The limiter safety check accepts arbitrary infrastructure failures | **Fixed.** Every `unavailable` decision carries a diagnostic `cause`: `deadline`, `commit_unknown`, `checkout`, `driver` or `internal`. The production-deadline flood (application pool bounds, 5 per instance) is now a gate. It requires 0 unexpected failures, admitted ≤ counted ≤ G with any over-count no larger than the number of `commit_unknown` outcomes, and **admitted ≥ min(G, ½ × calibrated capacity)**. | Pre-fix: "0 admitted, 2,000 unavailable" passed. Post-fix: the negative controls (that synthetic result, injected `driver` faults, and pure shedding with 0 admitted) **fail** the gate. The real flood passes, with threshold 480 on the local runner. The slow-database flood passes its own calibrated threshold, with every denial classified as shedding. Exactness under an explicit budget is unchanged. |
| **P3-1** | Deadlines enforced by timer callbacks only | **Fixed.** One absolute monotonic instant (`performance.now`, injectable in tests). It is checked after checkout (a late connection is returned unused), before COMMIT (never sent late; the connection is discarded and rolls back) and on the acknowledgement. A confirmed but late acknowledgement counts as failure or `unknown`: it landed, but it is never reported as a timely success. The request budget uses the same clock. Applies to the store, held activations and limiter decisions. | Pre-fix: the reviewer's probe (100 ms budget, clock at 150 ms during the statement) **committed and succeeded** (`logs/deadline-clock.log`). Post-fix: no COMMIT and a `StoreUnavailableError`. Late checkout, pre-COMMIT expiry, late acknowledgement, hold expiry and both limiter phases are covered by the fake-clock checks. |
| **P3-2** | Secret validation is regex- and count-based | **Fixed.** The format estimate applies only to **canonical** encodings: hex of even length and one case; base64 padded with canonical pad bits; base64url unpadded and canonical. Strength is **8 × decoded bytes**. Anything else is legacy and gets the unchanged S8 rule. **Explicit legacy policy:** an S8-accepted value is refused only if it trips an obvious-mistake veto (patterned, so regenerate it). This is still an obvious-mistake filter, not proof of entropy; provenance is D9. | Pre-fix (`logs/secret-probe.log`): odd-length hex scored 132 bits, an impossible 33-character base64 scored 198, non-canonical pad bits were accepted as base64, and 43 characters scored 258. Post-fix: all three non-canonical values are judged as legacy text, and 43 characters score 256. The canonical value with a run stays refused (by policy), and the deterministic digest stays accepted (documented, D9). 10,000 CSPRNG samples per supported format are all canonical and accepted. |
| **P3-3** | A6 hard-codes a 400 during a lock race | **Fixed.** **During** the hold: refusal (400, or a lock-wait 503), no token, row pending. The rollback is **observed** (the frozen backend is gone) before the deterministic check. **After** it: a 400 (S11Db) or not-found plus `ReplayDetectedError` (S10Db). Backend recovery: a fresh flow issues and redeems. The S10 fixture's own client listener, which masked P2-1, is removed; the fault pool now forwards `on`/`off` so the application's guard is exercised. | Pre-fix: one review repeat returned 503 against a hard-coded 400. Post-fix: stable across repeats (§3). |

## 2. Design notes
- **P2-1 listener lifecycle.** node-pg removes the pool's idle-client listener at checkout and re-adds it on a clean release. The guard therefore removes only its own listener, and only on a clean release. A client released with an error is dropped by the pool, so leaving the listener on it is safe and absorbs late socket errors.
- **P2-2 compatibility.** Static clients only (D2). Intended MCP clients use authorization code + PKCE with a query redirect. If D2 later admits a client that needs `form_post`, the body would have to be verified at hand-off first. That is not built: issuance would remain refused.
- **P3-1 scope: database budgets versus HTTP deadlines.** The absolute deadlines bound **database work**:

  | Bound | Value |
  |---|---|
  | Store call | 3 s |
  | Request store budget | 5 s |
  | Limiter decision | 1.25 s |
  | Activation hold | 2 s |
  | Activation commit | 1.5 s |

  The **end-to-end HTTP deadline** (socket and platform maximum duration) is unchanged and is not claimed by this code. `handle()` waits for the response's `finish` or `close` and then the activation settlement. Both are bounded by the timers above, under normal event-loop operation.

## 3. Verification (isolated PostgreSQL 16.14, socket only, TCP off, `LC_ALL=C`, all migrations; Node 26.5.0; synthetic identities only)

| Suite | Result |
|---|---|
| mcpRemoteTransport | all passed |
| mcpOAuthLocal / SecurityRegression / I2b / StagingBlockers / S8 / S10 | 119 / 34 / 116 / 52 / 54 / 121 |
| **mcpOAuthS11 (new, offline)** | **31/31** |
| mcpOAuthPostgresDb / StorageProtectionDb / StoreS4Db / CodeS6Db / S8Db | 36 / 42 / 13 / 14 / 11 |
| mcpOAuthStagingBlockersDb | 42/42 (gate, slow-database gate, 3 negative controls, exactness) |
| mcpOAuthS10Db | 21/21 (A6 deterministic; no masking listener) |
| **mcpOAuthS11Db (new)** | **19/19** |

- **Before the fix:** S11Db on the `a724997` sources failed 7 checks (P2-1 ×4, P2-2 ×3). The S11 offline and limiter suites cannot compile against the old API, so for P3-1, P3-2 and P2-3 the reviewer's probe logs are the before-evidence.
- **Repeat stability:** see the PR description. S11Db, S10Db, StagingBlockersDb and CodeS6Db each ran 5×.
- **Safeguards:** `git diff a724997` is empty for `mcpAuthGate.ts`, `mcpRemoteReadiness.ts`, `mcpLocalOAuth.ts`, `vercel.json`, `vercel-build.sh`, the OAuth Pages route, `/api/mcp`, `next.config.js`, `scripts/check-standalone-oauth.js` and `prisma/`. There are no migrations. Both new suites are wired into CI.
- **PR head and CI:** recorded in the PR (§6).

## 4. Remaining staging validations (separately authorized)
- **V1. Edge trust:** the trusted address header is overwritten at the edge and resolved the same way on OAuth and `/api/mcp`; the pinned issuer, redirect origin and `secure` cookies hold.
- **V2. Neon:** the transaction-mode pooler keeps backend affinity through a hold, `SET LOCAL` values take effect, a disconnect rolls back and the backend is reused clean, and the redemption `FOR SHARE` wait is bounded. Measure p50/p99, and exercise **checked-out client errors and pool recovery (now handled; verify through the pooler)**.
- **V3. Multiple instances:** cold starts and instance turnover, issue on one instance and redeem on another, abandoned and replaced responses stay pending.
- **V4. Controlled load:** hold and checkout occupancy, per-shard counts, 429 versus 503, and the **`cause` distribution** (only `deadline` or `commit_unknown` is acceptable). Agree the availability threshold and alert (D6, D7).
- **V5. Rotation:** a coordinated audit-key cutover (per-address buckets and audit references change), with retained cookie and sealing keys usable until old data drains.
- **V6. Vercel lifecycle:** the post-response activation COMMIT completes for warm, cold and concurrent requests (end-to-end redemption telemetry). If the deployed wrapper doesn't guarantee completion, adopt the supported post-response mechanism (`waitUntil`; a dependency change needing approval).

## 5. Owner decisions D2–D10 (recommended defaults)

| ID | Decision | Recommended default |
|---|---|---|
| D2 | Client registration | Static allow-list only (current); no DCR/CIMD until a registration policy exists; query response mode only |
| D3 | Token lifetimes | Keep: access 10 min; refresh 7 days idle and 30 days absolute, rotated, replay revokes the grant |
| D4 | ID tokens | Keep disabled (`openid` stripped); revisit only with a claims and privacy policy |
| D5 | Staging build and gate | A dedicated staging project with a runtime gate keyed to an explicit staging identity and opt-in flag, separately approved; Production stays build-time excluded |
| D6 | Limits | Global 6000/min, 16 shards, per-address 120/min, IPv6 /64; set the availability target from V4 |
| D7 | Audit | A structured log drain with ≥ 30 days of retention and restricted access; alert on `unavailable` causes other than shedding, and on `CodeActivationUnconfirmed`/`NotCommitted` |
| D8 | Expired-row cleanup | A scheduled daily cleanup (cron) with storage monitoring; keep opportunistic cleanup as a backstop |
| D9 | Keys | CSPRNG only (`openssl rand -base64 32` / `-hex 32`), kept in the platform secret store with no human copies; documented provenance; rotate cookie keys with the old key retained until sessions drain; coordinate audit-key cutovers (V5); reject legacy-format secrets for new configuration |
| D10 | Database role | A least-privilege role limited to the two MCP tables, with an explicit staging identity; no `DATABASE_URL` fallback before wiring |

## 6. PR
The exact head, CI run and results are recorded in the PR description and its checks. Auto-fix and Auto-merge stay disabled, and nothing merges without approval.
