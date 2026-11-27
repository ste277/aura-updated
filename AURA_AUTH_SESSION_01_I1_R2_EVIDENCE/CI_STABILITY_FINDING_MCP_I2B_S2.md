# CI stability finding: MCP I2b-S2 post-send connection-loss attribution

**Status:** OPEN. This finding is recorded separately from AUTH-SESSION I1 and has not been investigated or corrected under 39235. No MCP code, test, harness or migration was changed.

| | |
|---|---|
| First observed | CI run **45998039990**, attempt 1, on 2026-11-27. PR #401 head `8419631`, integration commit `40f6cba` (main `38b7fa6` + head), tree `0ec112e`. |
| Job / step | Database migration validation (job 140502298446), step 11 "Run I2b-S2 staging-blocker DB test" (`test/mcpOAuthStagingBlockersDb.test.ts`) |
| Check | `I2b-1 post-send connection loss (attribution)` |
| Observation | stored **29** vs **30** attributed contributions on **three** shards: `preauth-mcp:global:g480n16:1`, `:9` and `:13`. Tally: confirmed 405, committed_ack_lost 55, no_commit 1 540, unresolved 0. 45 faults injected. |
| Effect | The suite ended "AURA-MCP-02-I2b-S2 staging-blocker DB FAILED (131 checks)". The job stopped at that step, so its later steps (including the I1 DB tests and the migration-ledger checks) did not run. The other 6 jobs passed. |
| Rerun | **None.** No deliberate rerun was made, by instruction. |
| Evidence | `r1-ci-failure-45998039990/`: the full job log, failure summary and final run results, with checksums. Preserved unchanged from R1. |

## What this does and does not establish

- **Evidence supporting an unrelated intermittent failure:**
  - AUTH-SESSION I1 changes no MCP code, test, harness or migration. `git diff 864da6f..8419631` over `packages/`, `apps/mcp`, `test/mcpOAuth*`, `apps/web/lib/mcp*`, `apps/web/pages` and migration 0052 is empty.
  - I1's CI steps run after this step.
  - The main-side delta (`5551166` to `38b7fa6`, #402) touches Palmistry files only.
  - The same step passed on this PR's three earlier runs.
- **That does not establish it.** The failure was not reproduced, and its cause was not identified. It belongs to the MCP CI workstream.
- **Rule under 39235:** if it recurs on the R2 run, stop and report. No automatic rerun and no unrelated correction.
