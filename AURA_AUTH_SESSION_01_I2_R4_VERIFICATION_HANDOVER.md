# AURA-AUTH-SESSION-01-I2-R4: focused corrections and MP-4 integration (39255)

This corrects the 39254 NO-GO findings on PR #407 (at `8ba986d`) and integrates main `45e9cca` (MP-4).
- **Unchanged:** Option D, Rev 4, the separate databases, migration 0057, the no-reuse rule and every closed finding.
- **Not added:** no migration, grant reuse, caching or new architecture.

| # | Finding (reproduced on unchanged `8ba986d`) | Correction |
|---|---|---|
| 1 | **Deadline not absolute.** If a body completes after the 2 000 ms deadline but before the late body-read timer runs, it is processed. **Witness:** an invalid CSRF value got 403, and a valid one got a store-budget 503 without `Connection: close`. | After the body completes and before any form use, the consent handler rechecks the absolute monotonic deadline (`requestBudgetRemainingMs() > 0`). An expired request gets the existing 503 + Retry-After + `Connection: close`, and its socket is destroyed after the response. The 4 KB limit and the 300 ms floor are unchanged. |
| 2 | **Initial session outage.** `GET` and `POST /api/mcp/connections` answered 503 **without** Retry-After when the route's own session verification was unavailable. | The same typed mapping as listing and disconnect (`StoreUnavailableError`, `SessionVerificationUnavailableError` → 503 + Retry-After). Other errors are rethrown. 401 and 200 are unchanged. |
| 3 | **D9 control invalid.** The R2/R3 D9 control made `isFinalized` return a function, which is truthy, instead of modelling an outage. | D9 now swallows the lookup outage as "not finalized": `isConsentFinalized(...).catch(() => false)`. It is caught by the outage-contract checks C8b and C8c. |

## Migration reconciliation (MP-4 merged first, `45e9cca`; #407 merges second)

- **Migration guards:** 11o, S9 and G12 now allow exactly 0055, 0056, 0057 and 0058. S9 and G12 keep 0054.
- **Byte identity:** 0057 is identical to `8ba986d` (sha256 `5c258600…`) and 0058 to main (`c1d07ca6…`). All other migrations match both sides.
- **Migration deploy:**
  - **Fresh database:** `prisma migrate deploy` applies 0001…0058 in order, `status` is up to date, and the ledger has 58 distinct applied names.
  - **Existing database:** a 0057 (R3) database applies 0058 incrementally.
- **Schema check:** schema.prisma against the migrated database shows a pre-existing drift, identical to main's; 0057 and 0058 add nothing to it.
- **Route conflicts:**
  - **Dismiss route:** combines I2's awaited session and 503 with MP-4's `savedPersonId` / `PERSON_LINK_CHANGED` handling.
  - **`people/[personId]/rhythms` GET/POST:** now await the centralized verification and return 503 when it is unavailable.
  - The session-coverage scanner reports the unadapted handler (C5).
- **MP-4 DB tests:** now use real v2 test sessions, as the MP-3 tests already do.

## Verification

**New regression test.** `test/authSessionI2R4Db.test.ts` (CI DB job, two databases) passes **15/15**, and fails 4 on unchanged `8ba986d` (`witness-8ba986d/`).
- **X4:** the monotonic deadline clock passes the deadline while the real body-read timer is still pending (the state a stalled event loop produces). Expected result: 503 within 1 s of the body, `Connection: close`, nothing written, a bad CSRF value never evaluated; the in-deadline control gets 303.
- **X5:** the initial session outage gives 503 + Retry-After on GET and POST with nothing mutated; the controls (signed out, invalid token, no connections) give 401, 401 and 200.

**Negative controls** (`controls/mutations-r4.json`): the 14 R3 controls, with D9 corrected, plus:
- R4-1, removing the recheck;
- R4-2, restoring the R3 initial-outage response;
- R4-3, the un-awaited MP-4 handler, caught by the coverage scanner.

**R2 evidence.** The 12 nested entries missing from the R3 `r2-package/` (`hosted-ci-46145422599/` ×8, `local/` ×4) are the ORIGINAL files from the untouched R2 evidence directory. They are copied unmodified to `r2-package-complete/`, and all 17 entries verify against the original R2 `SHA256SUMS`. Nothing was reconstructed.

**39248.** Its disposition is still not available locally.
