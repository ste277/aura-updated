# AURA-MCP-02-I2b-S12: residual activation blocker closure

- **Baseline:** `fdcbfab` (main after PR #388). **Branch:** `feature/aura-mcp-02-i2b-s12-residual-closure`.
- **Scope:** only the four residuals in `AURA_MCP_02_I2B_S11_INDEPENDENT_REVIEW_REPORT.md` (copy at `AURA_MCP_02_I2B_S11_INDEPENDENT_REVIEW/`, main checkout root).
- **Status:** ALL LOCAL ACTIVATION BLOCKERS RESOLVED; ready for controlled staging preparation.
  - MCP stays disabled, staging is a NO-GO and Production activation is on HOLD.
  - No deployment, migration, environment, credential, staging wiring, live database or merge.
  - No new dependencies.
- **Preserved:** the closed S11 findings P2-1 (client lifecycle: S11Db 19/19) and P3-3 (deterministic freeze: S10Db A6 and S11Db).

## 1. Disposition and evidence

### R-P2-1 Final redirect integrity: resolved
**Change.** `validateAuthorizationRedirect` replaces substring checks with structured validation. All of these must hold:
- status 302 or 303;
- an absolute URL with **exactly** the registered callback's origin and path, and no userinfo or fragment;
- the callback's **registered query parameters preserved** (compared as a multiset);
- **exactly one** `code` equal to the code;
- the requested `state` (exactly one), or none if none was requested;
- `iss` equal to the issuer (RFC 9207), at most once;
- **nothing else**, and the code occurring exactly once in the whole URL.

The callback must also be registered for that client. At `finish`, the hand-off must be **byte-identical** to the validated `Location`, with the same status. Query-only issuance, S256 PKCE, expiry, single use and cross-instance redemption are unchanged. Receipt is not claimed.

**Before** (pre-fix sources, S12Db): all 7 same-status replacements were committed **ACTIVE and redeemed (200) on another instance**, each issuing a token:
- code moved into the path;
- code also in the fragment;
- code also in an unrelated parameter;
- a duplicate code parameter;
- a changed callback;
- a changed state;
- code kept only in a wrong parameter.

**After:**
- All 7 are **pending, refused (400) on the other instance, with no token**.
- Valid issuance redeems once and reuse is refused.
- A callback with a registered query parameter (`?tenant=`) preserves it and validates.
- 25 validator unit cases cover path, fragment, unrelated or duplicate `code`, host, path or scheme changes, `state` changed, missing or extra, a wrong `iss`, extra parameters, userinfo, statuses 200 and 307, a relative URL, and registered parameters dropped or changed.

### R-P2-2 Limiter regression detection and audit visibility: resolved
**Causes.** `deadline`, `commit_timeout` and `commit_late` are expected shedding. `commit_lost` (connection failed after COMMIT was sent; accounting is ambiguous) is **infrastructure**. `commit_failed` (an explicit server refusal: a SQLSTATE error or the ROLLBACK tag; nothing counted) is **infrastructure**. `checkout`, `driver` and `internal` are infrastructure. Accounting stays conservative.

**Gate.**
- 0 unexpected failures;
- admitted ≤ counted ≤ G, with any over-count no larger than the ambiguous and late COMMITs;
- availability ≥ min(G, ½ × capacity), with capacity anchored to an **independent runner control**: plain transactions on a session TEMP table, with the same three round trips but no limiter code, and a fixed **K = 4** (7 versus 3 round trips × about 1.7 for contention).

**Audit.** The bounded `cause` (an allow-listed enum; anything else is dropped) now appears in the **sanitized application audit output** on the OAuth pre-auth path and on both MCP limiter paths.

**Before:**
- The calibration came from the limiter under test, so a slow limiter lowered its own floor.
- `commit_unknown` lumped post-send driver failures and explicit refusals together with shedding.
- The audit events had no `cause` (pre-fix S12Db: 3 audit failures).

**After:**
- **Real runner:** floor 480, admitted 480.
- **Shared slowdown** (runner and database both +10 ms per statement): the independent floor drops to about 70 and the flood admits about 194; it passes.
- **The same slow result measured against the real runner control FAILS**: a limiter-only slowdown cannot lower its own floor.
- **Injected faults:** pre-COMMIT `driver` faults fail the gate; **post-send loss** gives `commit_lost` (counted 480 ≤ G) and fails; an **explicit COMMIT refusal** gives `commit_failed` with nothing counted and fails.
- The synthetic "0 admitted, 2,000 unavailable" result and 0-admitted pure shedding both fail.
- Explicit-budget exactness is unchanged.
- **Application audit lines:**
  - OAuth carries `cause: "checkout"`;
  - MCP pre-auth carries `"checkout"`;
  - MCP per-user carries `"commit_failed"`;
  - no raw error, password, address, token or user id appears in any line.

### R-P3-1 Strict deadline boundaries: resolved
**Change.**
- `budgetedDeadlineAt` uses the request budget's **original** monotonic instant and never rebuilds it from a remaining-time sample.
- One comparison everywhere, `expiredAt(at) = now >= at`: in the store, held activation and limiter.
- Limiter checks run **after every ROLLBACK acknowledgement**, **before every attempt or retry**, and at the final decision. A late refusal becomes `unavailable/deadline`, never a timely 429.
- Ambiguous COMMIT handling is preserved.

**Before** (reviewer `limiter-rollback-clock.log`): with a 50 ms budget and +100 ms on ROLLBACK, the limiter returned a normal `user` refusal.

**After** (synthetic clock):
- That probe gives `unavailable/deadline` with no COMMIT.
- A missing-row ROLLBACK past the deadline starts no second attempt (1 BEGIN).
- An acknowledgement **exactly at** the deadline is treated as expired by the store (failure), the held activation (`unknown`) and the limiter (`commit_late`).
- The budget instant stays stable when the clock moves between reads.

**Scope:** these bounds cover database work. The HTTP response lifecycle (`finish` / `close`) is unchanged and is validated live in V2, V4 and V6.

### R-P3-2 Secret-format ambiguity: resolved (corrected after the focused review)
**Policy (deterministic, `assessConfiguredSecret`).**
- **New configuration must declare its format:** `hex:`, `base64:` or `base64url:`. The body must be a canonical encoding with at least 16 decoded bytes and must pass the vetoes: repeated block, step runs, skew, and a new **low-variety** veto (fewer than half the distinct characters expected for the declared alphabet; P(false refusal) ≤ 3e-9 for 16-byte values, far smaller for longer ones).
- **The string is used verbatim**, tag included. Nothing is decoded, stripped or transformed.
- **The current cookie key, pairwise salt and audit key require a tag.**
- **Compatibility path:** retained cookie keys may stay untagged and are judged by the legacy rule, where a **hex-lexical value earns hex credit only, never base64 or base64url credit**.
- Format checks cannot establish real entropy; provenance and custody remain D9.

**Before** (reviewer `secret-format-overlap.log`): a 35-character value made of 8 hex symbols was accepted with 208 bits of base64url credit.

**After:**
- That value is refused **untagged** (legacy text) and also **declared** (`base64url:`, low variety).
- Canonical decoding and lengths are checked (16, 24 and 32 bytes give 128, 192 and 256 bits).
- 7 non-canonical forms are refused.
- Untagged current keys, salts and audit keys are refused **without echoing the value**.
- An untagged retained key is accepted, and returned byte for byte.
- 10,000 CSPRNG samples for each of 6 declared formats were all accepted.

### R-P3-2 correction (focused review §4.1, owner-approved within PR #390)
The fresh-subagent focused review (`AURA_MCP_02_I2B_S12_INDEPENDENT_REVIEW/`, preserved unchanged) rated R-P3-2 **PARTIAL**, because the same mistake class still earned inflated credit.

**Before** (author reproduction at `b1f8e337`, 5,000 samples each):

| Case | Result |
|---|---|
| `base64:` + `openssl rand -hex 12` | 4,749 accepted, credited 144 bits (about 96 real) |
| `base64url:` + `openssl rand -hex 16` | 4,528 accepted, credited 192 bits (about 128 real) |
| untagged retained key of 32 characters from `ghijGHIJ` | 5,000 accepted, credited 192 bits (about 96 real) |

**Change** (no material transformed, no value echoed):
- **Hex-heavy ambiguity.** A body declared base64 or base64url is refused (`ambiguous_encoding`, with the advice to declare `hex:`) if its count of hex-alphabet characters has P(X ≥ k | n, 22/64) ≤ 1e-8.
  - This covers all-hex bodies, padded bodies and a few edited characters.
  - For a 22-character (16-byte) body the threshold is 21 or more hex characters; for 43 characters it is 34 or more.
  - The real false-refusal probability for CSPRNG output is ≤ 2.7e-9 for 16-byte bodies, and smaller for longer ones.
  - On the untagged path, a hex-heavy value earns no base64 credit and is judged by the legacy rule.
- **Untagged low variety.** The low-variety veto now also applies to retained untagged hex and base64-class values. Expected variety is computed from the character groups the value actually uses (lower, upper, digits, symbols), so a legitimate lower-case-alphanumeric generator key isn't judged against 64 symbols.
  - Worst-case false refusal across generator alphabets: 4.6e-9 (32 lower-case characters, which don't reach this path anyway).
  - About 4e-10 or below for every other alphabet.
  - The first version used a fixed 64-symbol alphabet and newly refused 5 of about 28,700 S8-accepted mixed-alphabet strings (S10 compatibility check). That was corrected before commit, and the check now reports 0 in 5 of 5 runs.

**After** (5,000 samples each): all three cases are **0 accepted**. Boundary tests (43 characters: 33 hex-alphabet characters accepted, 34 refused), padded all-hex, near-hex (21 + 1) and untagged near-hex are all refused. There were no false refusals in 10,000 CSPRNG samples for each of 3 declared and 3 untagged retained formats. Loader errors don't echo values, and a legitimate retained key is returned byte for byte.

**Remaining limitation (inherent):** format tags, decoded length, hex-heaviness and character variety are defensive checks, not proof of entropy. A deterministic or derived value in a supported format can still pass. CSPRNG generation and custody remain owner decision D9.

**Non-blocking follow-ups recorded (focused review §4.2, §4.3), not addressed here:**
- **P4:** `validateAuthorizationRedirect`'s origin comparison treats custom-scheme URLs as origin "null". This is unreachable, because client policy allows only https and loopback http.
- **P4:** the SQLSTATE pattern `/^[0-9A-Z]{5}$/` also matches errno codes such as `EPIPE`, so a lost connection could be labelled `commit_failed` instead of `commit_lost`. This is diagnostic only; both labels fail the gate.
- **Observation (pre-existing, outside S12):** the S8 offline check "address bucket is a keyed hash" refuses any random 32-hex-character hash that happens to contain the substring `db8` or `2001`, so it fails on about 0.7% of runs. It was seen once during this correction and left unchanged.

## 2. Verification (isolated PostgreSQL 16.14, socket only, TCP off, `LC_ALL=C`; Node 26.5.0; synthetic only)

| Suite | Result |
|---|---|
| mcpRemoteTransport | all passed |
| mcpOAuthLocal / SecurityRegression / I2b / StagingBlockers / S8 / S10 / S11 | 119 / 34 / 116 / 52 / 54 / 125 / 31 |
| **mcpOAuthS12 (new, offline)** | **84/84** (67 + 17 P3-correction checks) |
| mcpOAuthPostgresDb / StorageProtectionDb / StoreS4Db / CodeS6Db / S8Db | 36 / 42 / 13 / 14 / 11 |
| mcpOAuthStagingBlockersDb | 45/45 (independent-floor gate, shared versus limiter-only slowdown, post-send loss, explicit refusal, negative controls, exactness) |
| mcpOAuthS10Db / S11Db | 21 / 19 (S11 closed findings preserved) |
| **mcpOAuthS12Db (new)** | **15/15** |
| dbIdentityGuard | passed |

- **CI round 1 (run 45423351312, head `054b717`):** Database migration validation **failed**. The limiter suite leaked its per-scenario pools, which exhausted CI PostgreSQL's `max_connections = 100`, and later decisions returned `unavailable` with cause **`checkout`**. The new cause classification identified it immediately; the local cluster ran with 200 connections, which had hidden it.
  - It was a test-harness defect, not a product one.
  - Reproduced locally at `max_connections = 100`.
  - Fixed by closing every scenario's pools right after its flood (`endSince`).
  - Every DB suite then passed at 100 connections, and the limiter suite passed 3 further repeats.
  - No assertion changed.
- **Fixture updates for the policy:** the I2b, S8 and S10 loader fixtures now declare formats, and S10 asserts that untagged values are accepted only as retained keys. The assertions are not weakened.
- **Repeat stability:** see the PR description.
- **Safeguards:** `git diff fdcbfab` is empty for the gate, readiness, local OAuth wiring, `vercel.json`, `vercel-build.sh`, the routes, `next.config.js`, the standalone check, `prisma/`, `package.json` and the lockfile. There are no migrations or dependencies. Both new suites are wired into CI.

## 3. Remaining staging requirements (separately authorized)
- **V1 / V3:**
  - name the approved client builds and their registered callbacks;
  - verify discovery (`query`), S256, the structured redirect validation with real clients, and redemption across processes, including cold starts and instance turnover.
- **V2:** the Neon transaction pooler: backend affinity through a hold, `SET LOCAL`, rollback on disconnect, clean reuse, the bounded `FOR SHARE` wait, checked-out client errors and pool recovery; measure p50/p99.
- **V4:**
  - controlled load against an **approved fixed baseline or runner control**;
  - the 429 versus 503 split and the **`cause` distribution through the audit drain** (alert on `checkout`, `driver`, `internal`, `commit_failed` and `commit_lost`).
- **V5:**
  - configure secrets **with declared formats**;
  - confirm any retained cookie keys against the legacy rule before rotation;
  - a bounded audit-key cutover overlap.
- **V6:** post-response COMMIT completion on Vercel for warm, cold and concurrent requests and instance turnover. If completion isn't guaranteed, approval for the supported lifecycle mechanism.
- **D2–D10:** unchanged; the recommended defaults are in the S11 report §5. D9 now also covers declared formats for new secrets.

## 4. PR and review request
- The exact head and CI results are recorded in the PR description.
- Auto-fix and Auto-merge stay disabled, and nothing merges without approval.
- **Independent verification is requested for these four changes only.**
