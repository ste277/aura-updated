AURA-AUTH-SESSION-01-I2 local evidence (disposable loopback PostgreSQL 16.14, 127.0.0.1:55992; synthetic users/codes only).
Base: main fd8b8f5. Fresh databases i2_db / i2_reg: prisma migrate deploy, 56 migrations applied.
- local-regression-i2.txt: 70 suites run sequentially (61 migrated route/regression tests + I1/I2 session suites): 62 passed, 8 failed.
  The 7 failures goalDecompositionPlanningHandoffDb, hpg5I2MyDaySaveDb, hpg5I3HomeSaveDb, multiOccurrenceRhythmCorrectiveDb,
  planDayWiring (87c only), planTabChooseMyOwnTime and planTabRecommendationChoiceRescheduleContext fail IDENTICALLY on unmodified
  main fd8b8f5 with the same runner (pre-existing; 6 of the 7 are not wired into CI; they are jsx/tsconfig invocation or unrelated
  assertions). remainingDayRecompositionDb failed once (check 61, local-today window) and passed on 2 immediate reruns on I2 and on
  main: non-reproducing, not in CI.
- authSessionI2Db.log (64 checks), authSessionCoverage.log (24), authSessionClient.log (12).
- MCP OAuth offline suites (mcpOAuthLocal/SecurityRegression/I2b/StagingBlockers/S8/S10/S11/S12, mcpRemoteTransport): all passed (637 checks).
- tsc: apps/web clean; root project (tests + packages) has only pre-existing errors (TS6142 jsx, TS2393, TS2550) in untouched files.
Hosted CI: see the uncommitted addendum (written after the run).
