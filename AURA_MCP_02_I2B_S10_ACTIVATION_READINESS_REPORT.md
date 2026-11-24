# AURA-MCP-02-I2b-S10: consolidated activation readiness

- **Baseline:** `b2e0f8c` (main, PR #382 merged). **Branch:** `feature/aura-mcp-02-i2b-s10-activation-readiness`.
- **References:** the S8 remediation report; the S9 independent review (`AURA_MCP_02_I2B_S8_INDEPENDENT_REVIEW/`); the S5 and S7 reviews, recovered in this ticket (§7).
- **Status:** MCP remains disabled, and staging and Production activation remain on HOLD.
  - No deployment, environment variable, credential or gate was touched.
  - No live database was accessed, and only synthetic identities were used.

## 1. Outcome

| # | Item | Result |
|---|---|---|
| 1 | **S3-1** cross-instance code safety | **Closed in code.** A code becomes redeemable only through an activation COMMIT that is sent after the complete response has been handed off. Every abandonment path leaves the code pending in the shared database without any further write. The S8 instance-local hold and background retry are removed. No architectural decision is needed (§2.4). |
| 2 | Secret validation compatibility | **Fixed.** Every supported CSPRNG format is accepted for every role, including retained rotation keys. Nothing S8 accepted is newly refused. All S8 weak patterns, plus the S9 "predictable balanced" sample, are refused (§3). |
| 3 | Request time budget | **Bounded.** One deadline now covers checkout, statement and COMMIT, and one per-request budget caps all store calls (§4). |
| 4 | Intermittent concurrency failure (run 45372768632) | **Root-caused and reproduced.** A test-harness coupling to runner speed met by-design fail-closed load shedding. It is not a limiter defect, and the harness was fixed without weakening any assertion (§5). |
| 5 | Operational readiness | The minimum live validations are V1–V6 (§6). The risk register is consolidated in §8. |
| 6 | Tests | 14 MCP suites pass on isolated PostgreSQL 16: 683 counted checks plus the transport suite. Two mutation tests prove the new S3-1 checks discriminate. Five repeat runs of the concurrency-sensitive suites are stable (§9). |

## 2. S3-1: authorization-code issuance (closed)

### 2.1 Why S8 could not close it
- **The defect.** S4–S8 committed the activation before the response was written. A failure after that commit (a lost acknowledgement, a disconnect, a replaced response) could only be undone by a later DELETE. That DELETE fails in exactly the outage that caused the problem, so S8 refused the code only in the issuing process's memory.
- **What the reviewers found.** S5 (P1), S7 and S9 each showed a code that the server had abandoned but that was still active in the database. S9's preserved log shows a second instance redeeming it with 200.

### 2.2 Design: commit only after hand-off
1. **Pending by default.** The provider writes the code PENDING, as since S4. A pending code is invisible to `find`, and `consume` now refuses it as well (`AND NOT pending`), so the database itself enforces it.
2. **Prepare before writing.** The outermost middleware checks that the response is deliverable: status below 400, the code present in `Location` or the form_post body, headers not yet sent, and the client still connected.
   - It then calls `beginIssuedActivation`, which runs the activation `UPDATE` in a transaction (`heldStatement`) that is left open with its row locked.
   - If the live pending row does not exist, the response is 503 and nothing is sent.
3. **Commit after hand-off.** The code is committed only on `finish`, and only if the finished response still has the same status below 400 and still carries the code. The COMMIT runs outside the request budget and is bounded by `activationCommitMs`, 1500 ms. `handle()` awaits the outcome, so the request does not end before the COMMIT.
4. **Everything else abandons it.** Every other outcome aborts the activation:
   - `close` before `finish` (a disconnect or partial write);
   - a replaced response (S7 P3);
   - a hand-off that never comes (`activationHoldMs`, 2000 ms, plus a backstop);
   - a crash, a freeze or an unreachable database.

   **Aborting performs no write.** The connection is dropped, or the server's `idle_in_transaction_session_timeout` (hold + 1000 ms) ends it, and PostgreSQL rolls the transaction back. The code stays pending on every instance, with no reliance on instance memory, a deny list or a revocation write.
5. **Races wait instead of guessing.** Lookups of codes by id use `FOR SHARE`. A redemption that races an in-flight activation (the client can receive the code before the COMMIT lands) waits for the row lock, bounded by `lock_timeout`, instead of reading a half-decided row.

### 2.3 Abandoned versus issued (what is and is not claimed)

| Outcome | Bytes left the server? | Database state | Redeemable anywhere? | Test |
|---|---|---|---|---|
| Activation UPDATE fails | no | pending | **no** | A1 |
| Database unreachable after the code write | no | pending | **no**, with no write needed | A2 |
| Disconnect observed before the write | no | pending | **no** | A3, S6-6/7 |
| Partial delivery: the Location header with the code was written to the socket, then the connection broke | **yes** | pending | **no** | A4 |
| Response replaced (500, code removed) after activation | no | pending | **no** | A5 |
| Process frozen between hand-off and COMMIT | yes | pending (server-side timeout rollback) | **no**, including on a restarted instance | A6 |
| Handed off, COMMIT confirmed | yes | active | **issued**: once, by the PKCE verifier holder, within 60 s | I1, I3b |
| Handed off, COMMIT acknowledgement lost | yes | active or pending | **issued, outcome unknown**: both outcomes are safe | I2, S6-3/4 |
| Handed off, client never reads it | yes (to the OS) | active | **issued**: only with the verifier | I3 |

- **No atomicity between persistence and delivery is claimed.** "Issued" means handed to the runtime, not received.
- **A code that was handed off but never received** stays redeemable only with its PKCE verifier, only once, and only until its 60 s TTL. This is standard OAuth behaviour, not a residual of this design.
- **A COMMIT lost after hand-off** can only cost the client a failed redemption; it is fail-closed.

### 2.4 Why no architectural decision is needed
The S9 requirement was to "require shared fail-closed enforcement at redemption, or an issuance design that provides the same guarantee during an ambiguous commit."
- **Option two is met.** An ambiguous COMMIT can now occur only after hand-off, where both outcomes are safe.
- **A deny list cannot do this.** Any design that undoes a commit after the fact needs a write during the same outage, and no deny list avoids that.
- **Moving the commit point removes the need for an undo.** The design uses existing PostgreSQL semantics only: rollback on a dropped connection and `idle_in_transaction_session_timeout`. It needs no new infrastructure.

### 2.5 Remaining limitations (honest)
- **L1. Hand-off is not receipt.** This is inherent; see the table above.
- **L2. The COMMIT runs after the response.** On a serverless platform that freezes the function at `res.end`, the COMMIT may never be sent. The code then stays pending and the client's redemption fails: fail-closed, but an availability loss. **Live validation V6.**
- **L3. A held activation pins one pool connection** for the duration of the hand-off, typically under 1 ms and capped at 2 s. A frozen holder delays only redemptions of that one code (each waits up to 1 s for the lock, then gets 503).
- **L4. Pending rows of abandoned codes** stay until the TTL and then `cleanupExpired` (D8). They are unredeemable throughout.

## 3. Secret validation compatibility (I2b-R-6 follow-up)

**Measured S8 false refusals of genuine CSPRNG output** (Python model of the S8 rule, 200,000 samples per format):

| Format | Length | S8 rejected |
|---|---|---|
| `openssl rand -hex 16` (128 bits) | 32 | **200,000 / 200,000** |
| hex, 20 bytes | 40 | 35 / 200,000 |
| `openssl rand -base64 24` | 32 | 30 / 200,000 |
| base64url, 24 bytes | 32 | 25 / 200,000 |
| hex 32 bytes; base64 / base64url 32 bytes | 64 / 43–44 | 0 |

The S8 "at least 10 distinct characters" rule alone can also refuse random 16-byte hex: the minimum observed was 9.

**The S10 rule (`assessSecret`):**
- **Format-aware strength.** Hex in one case with at least one letter counts 4 bits per character. Base64 or base64url using at least 2 of lower, upper and digit counts 6 bits per character (padding allowed). Anything else uses the unchanged S8 Shannon estimate with at least 10 distinct characters.
- **Acceptance.** A secret is accepted if it is at least 32 characters and **either** the S8 estimate or the format estimate reaches 128 bits.
- **Mistake vetoes** (a repeated block; for hex and base64, a run of 12 or more repeating or one-step characters in the format's alphabet, or a character more frequent than chance allows at p < 1e-12) can refuse it anyway. A uniform random string trips a veto with probability below about 1e-11.

**Results:**
- 0 refusals in 300,000 samples for each of 8 CSPRNG formats (Python model), and 0 in 20,000 for each format in the TypeScript suite.
- **The loader accepts** 16-byte hex and 24-byte base64 for each role: the current cookie key, a **retained** cookie key, the pairwise salt and the audit key.
- **It refuses** all six S8 weak patterns, the S9 balanced sample `0123456789abcdeffedcba9876543210` and its upper-case form, hex counting runs, alphabet runs, skewed and digits-only strings, lower-case word phrases, 15-byte hex and 16-byte base64. No error message contains the value.
- **Compatibility:** of 28,733 random mixed-alphabet strings that the S8 rule accepted, none is newly refused. The synthetic fixtures are still accepted.

**Supported formats (documented in `keys.ts` and the README):** `openssl rand -hex 16` or longer, `openssl rand -base64 24` or `-base64 32`, or base64url equivalents. This remains a floor against mistakes, not a proof of randomness. No real credentials were generated, rotated or read.

## 4. Request time budget

| Phase | Bound (defaults) | Mechanism |
|---|---|---|
| Pre-auth limiter decision | 1250 ms; on expiry the request is denied (`unavailable`, 503) | unchanged |
| One store call (checkout, BEGIN, statement, **COMMIT**) | 3000 ms. S10: COMMIT no longer restarts the clock (S8 allowed up to about 6 s). `commitDeadlineMs` can only tighten it. | `boundedStatement` |
| All store calls of one authorization-server request | **`requestBudgetMs` = 5000 ms**. Each call uses min(its deadline, budget left). A call after the budget is spent fails at once without touching the database. | `runWithRequestBudget` (AsyncLocalStorage) |
| Code activation COMMIT after hand-off | 1500 ms (`activationCommitMs`); a hold without hand-off is capped at 2000 ms | `heldStatement` |
| **Authorization-server request, worst case** | **about 1.25 + 5 + 1.5 ≈ 7.8 s** plus write time | |
| `/api/mcp` | 1.25 s limiter + one 3 s token lookup, plus tool time | unchanged |

- **Ambiguous outcomes are preserved.** A deadline that expires after COMMIT was sent is reported as StoreUnavailableError, and the connection is destroyed, never returned to the pool.
- **Coverage.** The tests cover timeout, cancellation of phase 1, a spent budget, work run outside the budget, connection recovery after a destroyed connection, and the held-transaction outcomes (S10 offline, BUD/DL/HOLD).
- **Integration (B1).** With every store call at about 450 ms and a 1000 ms budget, no request of the flow exceeded **1003 ms**, and the request that ran out answered 503.

## 5. Intermittent concurrency failure (run 45372768632, 188 of 480)

- **Evidence from the run:**
  - The 2,000-decision flood took 1.33 s, against the 1250 ms decision deadline.
  - Postgres logged 12 × "unexpected EOF … open transaction", which is the deadline's connection destroy.
  - It logged no `lock_timeout`, `statement_timeout` or deadlock errors during the flood.
  - The shard counts sum to exactly 188, so nothing was over-admitted.
  - There were no 429s: all 1,812 denials were `unavailable`.
- **Mechanism.** The flood pushes 2,000 decisions through 18 connections, and each decision's deadline includes its pool wait. Finishing in time needs about 11 ms per decision. Passing runs managed about 2,100 decisions/s; the failing runner managed about 150/s. On the most recent passing run (`b2e0f8c`) the block took 1.21 s, within 40 ms of the deadline.
- **Classification:** a **test-harness issue on a slow runner, meeting by-design fail-closed load shedding. Not an implementation defect.**
- **Reproduced locally.** The same flood with +10 ms per statement admitted 209–243 per run (over 14 runs) and denied the rest as `unavailable`, with 0 × 429 and nothing above G.
- **Found while repeating it: an ambiguous COMMIT over-counts.** A decision whose 1250 ms deadline fires while its COMMIT is in flight is reported as a deny but can still land. In 3 of 14 slow runs the shards counted 4 more than the decisions reported admitted (for example, 237 counted against 233 admitted).
  - This is the limiter's documented fail-closed behaviour: capacity is lost, but there is never over-admission, because the database caps every shard.
  - The exact safety invariant is therefore **admitted ≤ counted ≤ G**. The first version of the new safety check (`counted == admitted`) was wrong and would itself have been flaky, so it was corrected before commit.
- **Harness fix** (`mcpOAuthStagingBlockersDb`), at the same concurrency, with no assertion weakened:
  1. **Safety under the production deadline**, asserted unconditionally: admitted ≤ counted ≤ G, and every denial is a 429 or `unavailable`.
  2. **Exactness under an explicit 30 s budget**: exactly 480 admitted, every shard at 30, only 429s. These are the original assertions.
  3. **The slow-database reproduction**.
  4. **Diagnostics** (elapsed time, outcome counts) printed every time.
- **Product note.** Under a burst larger than pool max × (1250 ms ÷ latency) per instance, the limiter sheds load as 503 rather than 429. That is acceptable, but it needs measurement (V4) and a metric.
- The Day Constructor failure on `b2e0f8c` (a goal-occurrence race) is outside MCP and is not addressed here.

## 6. Minimum live validation before any activation (separately authorized)

- **V1. Trusted edge headers.**
  - On staging, confirm that Vercel overwrites the trusted address header (`x-vercel-forwarded-for` / `x-real-ip`): send a forged value and read it back from `oauth.address_unresolved` / limiter buckets with synthetic traffic.
  - Confirm that `AURA_MCP_CLIENT_ADDRESS_SOURCE` resolves for both the authorization server and `/api/mcp`.
  - Confirm that origin pinning holds behind the edge: discovery, redirects and cookie `secure`.
- **V2. Neon pooler and timeouts.**
  - Through the transaction-mode pooler, `SET LOCAL statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout` take effect.
  - An aborted held activation (client destroy) is rolled back, and the server connection is not reused dirty.
  - A redemption's `FOR SHARE` waits on a held activation, and its `lock_timeout` holds.
  - Measure p50/p99 per statement and calibrate the 3 s, 5 s and 1.25 s budgets.
- **V3. Multiple serverless instances.** Run at least two concurrent instances against one database: a code issued on one instance redeems on another; abandonment cases A3, A4 and A5 are reproduced with synthetic clients; and there is no cross-instance redemption of a pending code.
- **V4. Controlled concurrent load.** Ramp synthetic pre-auth traffic past the per-instance pool capacity and record the 429 versus 503 split, decision latency and admitted ≤ G. Set the alert threshold for `unavailable`.
- **V5. Audit-key rotation.**
  - Do a coordinated cutover: change `AURA_MCP_AUDIT_KEY` on all instances in one deploy. Per-address limiter counters restart, since buckets are keyed from the audit key, giving a fresh 60 s window; global shards and the `unresolved` bucket are unaffected.
  - Audit user references change; record the cutover time.
  - Cookie-key rotation keeps the retained keys: new key first, old keys retained until sessions drain.
- **V6. COMMIT after hand-off on Vercel (new, follows from §2.5 L2).** On staging, verify that the post-response activation COMMIT completes: `CodeActivationUnconfirmed` and `CodeActivationNotCommitted` should be 0, and synthetic flows should redeem 100%. If the platform freezes after `res.end`, adopt `waitUntil` (a dependency change needing approval) before going further.

## 7. Recovered S5/S7 evidence
Both reports were found outside the repository, in `~/Documents/ChatGPT/Product Onboarding/`. They are preserved byte for byte, with a SHA-256 manifest, in `AURA_MCP_02_I2B_S5_S7_REVIEWS/` (main checkout root, untracked).

| Review | Verdict | Finding | S10 status |
|---|---|---|---|
| S5 (Codex, `c8fc66b`) | FAIL P1 | A committed activation with a lost ack leaves a live code behind a 503 | **Closed.** A lost ack can only follow hand-off (§2.2) |
| S5 | P3 | The COMMIT phase is bounded only by the pool's query timeout; query-only adapters have no server timeouts | **Closed.** One deadline through COMMIT, plus the request budget. Query-only adapters are test fakes and are documented as such |
| S7 (Codex, `3c390a1`) | CONDITIONAL PASS | Absolute invariant open (double revocation failure) | **Closed.** There is no revocation path left |
| S7 | P3 | `writableFinished` is not receipt; a Koa replacement-error response can leave the code active | **Closed for replacement** (A5). Receipt is addressed by the explicit "issued = hand-off" semantics (§2.3 L1) |

## 8. Consolidated risk register (supersedes the scattered lists in S8 §5/§6, MERGE_RECORD.md and the closure report §4)

| ID | Item | Status after S10 | Needed before |
|---|---|---|---|
| S3-1 | Cross-instance redemption of an abandoned code | **CLOSED** in code (§2) | V3 and V6 confirm it live |
| S5-P3 / S9 | COMMIT deadline and request budget | **CLOSED** (§4) | V2 calibration |
| S7-P3 | Replaced response / `writableFinished` | **CLOSED** / documented (L1) | — |
| S9 | Secret entropy floor compatibility | **CLOSED** (§3) | Validate the formats at configuration time (D9) |
| CI-I2b-1 | Intermittent aggregate limiter failure | **CLOSED**: harness fix; load shedding documented | V4 |
| I2b-R-3 | Edge trust boundary | Closed in code; **live check open** | V1 |
| S3-8 / Neon | Pooler semantics for SET LOCAL and held transactions | **Live check open** | V2 |
| L2 | COMMIT after response on serverless | **New, open** | V6 |
| L3 / L4 | Held-connection pinning; pending rows until cleanup | Accepted design properties | D8 |
| Rotation | Audit-key cutover resets per-address counters | Documented (V5) | V5 |
| Preflight | Readiness preflight still falls back to `DATABASE_URL` | Open (pre-existing) | Before staging wiring |
| RRC-2 | Device flow / PAR fields unsealed | Deferred: the features stay disabled | Before enabling them |
| RRC-3, RR-3 | Non-object `Session.state` tolerated; non-canonical base64url seals | Deferred P3 | — |
| R-4, R-5, R-7, R-8 | `?host=` local DB check; tokens left valid by a redemption race; 429 audit flooding; bidi characters in client labels | Deferred P3 | Before Production |
| I2b-2…5 | Global-only fallback; `openid` advertised; session-bound tokens; no scheduled cleanup | Deferred P3 | D6, D8 |
| S4 residuals | Failed flows still set session cookies; 3 round trips per statement | Deferred P3 | V2 latency |

**Owner decisions (unchanged; no new governance phase):**
- **D1:** merge only. Applying migration 0052 in a Production release needs separate approval.
- **D2:** client registration (static only, or DCR/CIMD).
- **D3:** token lifetimes.
- **D4:** ID tokens.
- **D5:** staging build or gate strategy.
- **D6:** pre-auth ceiling, limits and /64 bucketing.
- **D7:** audit destination and retention.
- **D8:** expired-row cleanup (opportunistic or cron).
- **D9:** key generation, custody and rotation (now with the supported formats of §3).
- **D10:** a dedicated database or least-privilege role.

**Approvals still required:**
- the staging gate change;
- migration 0052 on staging;
- staging access for V1–V6;
- Production activation later.

## 9. Test evidence (isolated PostgreSQL 16.14, socket only, TCP off, `LC_ALL=C`, all 53 migrations applied, Node 26.5.0)

| Suite | Result |
|---|---|
| mcpRemoteTransport | all passed |
| mcpOAuthLocal (gate and local flow) | 119/119 |
| mcpOAuthSecurityRegression | 34/34 |
| mcpOAuthI2b | 116/116 |
| mcpOAuthStagingBlockers | 52/52 |
| mcpOAuthS8 | 54/54 |
| **mcpOAuthS10 (new, offline)** | **121/121** |
| mcpOAuthPostgresDb | 36/36 (+1: the seeded code goes through the issuance path) |
| mcpOAuthStorageProtectionDb | 42/42 |
| mcpOAuthStagingBlockersDb | 40/40 (+3: safety, reproduction, split exactness) |
| mcpOAuthStoreS4Db | 13/13 |
| mcpOAuthCodeS6Db | 14/14 (expectations moved to the stricter S10 invariant; the removed revocation path's check was dropped) |
| mcpOAuthS8Db | 11/11 (the hold cases moved to S10) |
| **mcpOAuthS10Db (new)** | **21/21** |

- **Baseline.** The six DB suites passed at `b2e0f8c` before any change (159 checks).
- **Mutation 1** (commit before the write, the pre-S10 ordering): S10Db FAILS A4, A5, I2 and I4. Partial-delivery and replaced-response codes become redeemable on another instance.
- **Mutation 2** (`FOR SHARE` removed): S10Db FAILS I4, because a racing redemption reads a half-decided row.
- **Repeat stability:** S10Db 5/5 and S6Db 5/5 green. StagingBlockersDb failed 1 of 5 on the first, wrong form of the new safety check (it exposed the over-count in §5); after the correction it is 8/8 green.
- **Safeguards unchanged:**
  - `git diff b2e0f8c` is empty for `mcpAuthGate.ts`, `mcpRemoteReadiness.ts`, `vercel.json`, the OAuth Pages route, `/api/mcp`, `next.config.js`, `scripts/check-standalone-oauth.js` and `prisma/`.
  - The gate tests in mcpOAuthLocal pass, and the standalone 404 check runs in CI (Next.js production build job).
  - Both new suites are wired into `.github/workflows/ci.yml`.

## 10. Files
- **Source:**
  - `packages/mcp-tools/src/security/deadline.ts`: the request budget, one deadline through COMMIT, `heldStatement`.
  - `packages/mcp-tools/src/auth/postgresAdapter.ts`: held activation, `FOR SHARE`, the pending filter in `consume`, hold and retry removed.
  - `packages/mcp-tools/src/auth/oauthStore.ts`: the `beginIssuedActivation` contract.
  - `packages/mcp-tools/src/auth/authorizationServer.ts`: commit-after-hand-off middleware, `requestBudgetMs`.
  - `packages/mcp-tools/src/auth/keys.ts`: `assessSecret`.
  - `packages/mcp-tools/README.md`.
- **Tests:**
  - new: `test/mcpOAuthS10.test.ts`, `test/mcpOAuthS10Db.test.ts`;
  - updated: `test/mcpOAuthCodeS6Db.test.ts`, `test/mcpOAuthS8Db.test.ts`, `test/mcpOAuthPostgresDb.test.ts`, `test/mcpOAuthStagingBlockersDb.test.ts`, `test/mcpOAuthI2bHarness.ts` (a test-only per-request hook).
- **CI:** `.github/workflows/ci.yml` (two steps).
