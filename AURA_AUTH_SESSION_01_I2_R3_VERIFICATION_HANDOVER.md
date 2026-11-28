# AURA-AUTH-SESSION-01-I2-R3: focused corrections (39253)

This corrects the three 39251 merge blockers on PR #407 (NO-GO at `e725ed8`).
- **Unchanged:** Option D, Rev 4, the separate Aura and MCP OAuth databases, migration 0057 and the no-reuse rule.
- **Not added:** no migration, grant reuse, caching or new architecture.

| # | Finding (reproduced on unchanged `e725ed8`) | Correction |
|---|---|---|
| 1 | **Expiry at finalization.** `expiresAt > now()` used the transaction-start time. A `FOR SHARE` that waits on a row lock is not re-evaluated when the row is unchanged. **Witness:** a session that expired naturally during a lock wait was finalized (303, one row). | The insert uses `clock_timestamp()`. A **commit-boundary guard** runs in the **same simple-query message as COMMIT**: a `DO` block that re-checks, at that instant and while this transaction still holds the row `FOR SHARE`, that the token's session row is unrevoked and unexpired by the database clock. If not, PostgreSQL skips the COMMIT (SQLSTATE `P0A02`) and the outcome is `refused`. Logout ordering, ownership and token binding are unchanged. |
| 2 | **Listing outage.** `GET /api/mcp/connections` let a typed `StoreUnavailableError` from listing escape (500). | The route maps **typed** unavailability only (`StoreUnavailableError`, `SessionVerificationUnavailableError`) to **503 + Retry-After**, for listing and disconnect. "No connections" stays 200 and "signed out" stays 401. |
| 3 | **Consent deadline.** The form body was read without a deadline. **Witness:** a delayed body was answered after 2 604 ms. | `readForm` is bounded by what **remains** of the existing consent deadline (`requestBudgetRemainingMs()`), with no separate budget. If the body is not received in time, the request answers 503 + Retry-After with `Connection: close`, and the socket is destroyed after the response, so a late body is never processed. The 4 096-byte limit, the 300 ms floor and the 503 responses are unchanged. |

## Verification

**New regression test.** `test/authSessionI2R3Db.test.ts` (CI DB job, two databases) passes **13/13**. On unchanged `e725ed8` it fails the three findings (4 failures; `witness-e725ed8/`). It covers:
- natural expiry with the token and row unchanged and matching throughout, plus a live-session lock-wait control;
- the real route: empty → 200, listed → 200, outage → 503, no cookie → 401;
- delayed body → 503 inside 2 s, nothing written, connection closed; oversized body → 403; a normal consent still completes.

**Preserved suites:**
- the two-database Option D suite passes **46/46**;
- the session integration suite passes **64/64**;
- completed authorizations still survive ordinary logout (C1);
- F1.6b fresh-grant behaviour is unchanged.

The C5/C6 COMMIT fault injection now targets the guarded COMMIT message.

**Negative controls.** `controls/mutations-r3.json` holds 14 controls: the ten Option D controls plus the R3 defects.
- D2 and D4 now remove **both** the insert check and the commit guard: the guard is an independent second check, so removing only one is not a bypass.
- R3-1 removes the guard; R3-1b restores the exact R2 defect.
- R3-2 removes the route mapping; R3-3 removes the body deadline.

**R2 package.** The R2 witness and the ten original R2 mutation results are included under `r2-package/`, with the R2 `SHA256SUMS` re-verified.

**39248.** Its disposition was not available locally when this was written.

**Migrations.** MP-4 owns 0058. Confirmed order: MP-4 merged first (`45e9cca`); #407 merges second and reconciles guards 11o, S9 and G12 to 0055–0058 (done in I2-R4).
