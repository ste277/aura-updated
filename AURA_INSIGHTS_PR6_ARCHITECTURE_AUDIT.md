# AURA — Insights V1 PR6 — Event History & Evidence Integrity Architecture Audit

**Mode:** Read-only architecture audit. No implementation. No PR. No commits. No migrations. No schema changes.
**Baseline verified [VERIFIED]:** `HEAD == origin/main == 7e1358642b000c8aff4b1e4058ac906b5eaa4373` (exact match to the ticket's stated baseline). Migration count: **48** (exact match). Working tree: clean except the standing untracked files already documented in every prior audit (`.claude/settings.local.json`, the five prior `AURA_INSIGHTS_*.md` docs). 46 worktrees present and untouched, including the PR4 and PR5 worktrees. No destructive git command was run anywhere in this audit — every inspection below was a read (`Read`, `grep`, `Bash` read-only commands).

**Workspace safety note, stated plainly (not a recovery claim):** `e2e/fixtures/cleanup.ts` and `test/personalizedDailyStoryDb.test.ts`'s pre-existing local modifications, lost during PR3's implementation phase, remain unrecovered. This audit touched neither file and makes no claim about their state.

Tags used throughout: **VERIFIED** (confirmed by direct code/schema inspection, cited file:line), **INFERRED** (a reasonable conclusion from verified facts, not itself directly observed), **UNRESOLVED** (a question this audit could not close), **RECOMMENDED** (a proposal, not yet approved policy).

---

## 1. Executive Summary

**Aura does not need a new event-history foundation in V1.** Every lifecycle action this audit traced (Move, Skip, Complete, Delete, Goal archive, Goal delete) already has either a dedicated, action-specific durable timestamp or a structurally-sound reconstruction path — with exactly **one** real, demonstrated gap, and that gap is a **reporting query limitation, not a data-loss problem**: a non-Goal-linked plan's completion evidence already survives hard deletion today, durably, via the existing `HabitLog` row (independent of `PlannedActivity`, never cascade-deleted, never itself deleted by any code path in this codebase) — PR4's reporting layer simply never reads it for a deleted plan.

This audit found **no other durable-evidence gap that blocks a demonstrated V1 user-facing capability**. Cancel is the one action with no dedicated timestamp column (only `updatedAt`, and — newly confirmed — Cancel is not even idempotent on retry, unlike Skip), which is a real, minor precision gap, but nothing in this codebase's product surface currently asks "when was this cancelled" — it is not a blocking gap today. A second, secondary finding: `PlanCreationIdempotency.plannedActivityId` (the Day-Constructor-acceptance idempotency claim) is `ON DELETE CASCADE`, the ONE inconsistent exception to every other `plannedActivityId` FK in this schema (all `SetNull`, specifically chosen to preserve evidence) — meaning the fact that an acceptance ever happened is fully destroyed once its resulting Plan is later hard-deleted. No current capability needs this record to survive, so this is noted as a minor schema-consistency observation, not a blocking gap.

**Recommended scope for PR6, if any:** **Option A** (reuse + correct one existing reader) for the one real gap found, **not** a new event log of any kind (neither a scoped evidence table nor a generic append-only log). This audit explicitly recommends **against implementing a generic event log**, and recommends the PR4/Signal-4 reporting fix as **optional, narrowly-scoped future work** rather than a required PR6 — because the existing `awaitingConfirmation`/`confirmedCompleted` count metrics already work correctly for the overwhelming majority of cases (any plan the user has not yet deleted), and the gap only matters for a user who both completed AND then explicitly cleared a non-Goal-linked plan from "Recently Completed" within the same reporting window — a narrow intersection.

**Final verdict:** `AURA — INSIGHTS V1 PR6 — ARCHITECTURE READY` for the one justified Option-A correction; this audit's own recommendation is **NO IMPLEMENTATION is also an acceptable, fully supportable outcome** — the capability gap closed is marginal, not a blocker to any currently-promised Insights behavior.

---

## 2. Repository Baseline

**[VERIFIED]** `HEAD`/`origin/main`: `7e1358642b000c8aff4b1e4058ac906b5eaa4373` (PR5's merge commit). 48 migrations, `0001_init` through `0048_goal_activity_execution_occurrence_link`. No migration name contains "event," "audit," "history," "trail," "timeline," or "changelog" in a sense suggesting a general domain event log (migration-name grep performed; see §3's evidence inventory for the closest candidates). No table has ever been dropped in this migration history (`grep DROP TABLE` across every `migration.sql`: zero matches) — nothing was ever built and removed.

---

## 3. Existing Evidence Inventory

**[VERIFIED]** 21 Prisma models total: `User`, `SavedPerson`, `AuraMoment`, `ProductEvent`, `CustomCity`, `HabitLog`, `PlannedActivity`, `VisitLog`, `Habit`, `AuthCode`, `DailyReflection`, `ReminderAttention`, `ReminderDelivery`, `PushSubscription`, `UserActivityPreference`, `UserAvailabilityPeriod`, `Goal`, `GoalActivity`, `GoalActivityExecution`, `GoalActivityOccurrence`, `Capture`. Two more tables exist as raw SQL only (not in the Prisma schema): `PlanCreationIdempotency` (migration 0025) and `DayBuilderDismissal` (migration 0026).

### 3.1 Existing audit/history/idempotency infrastructure — searched, not assumed absent

- **No generic audit-log / change-log / domain-event table exists.** The closest candidate, `ProductEvent` (`schema.prisma` ~line 251), is an explicitly-scoped, low-volume analytics/funnel log (`eventName`, optional `userId`/`auraMomentId`, a loosely-typed `metadata Json`, `createdAt` only) — it has no before/after state, no actor-vs-subject distinction, and its own doc comment explicitly disclaims being a transactional record. Not a substitute for durable domain evidence.
- **`HabitLog` is, in practice, already a genuine append-only, immutable-after-creation completion-event record** (full analysis in §6, re-confirmed by subagent trace). It already has an idempotency key (`clientRequestId`, nullable, partial-unique-indexed on `(userId, clientRequestId) WHERE clientRequestId IS NOT NULL`, migration 0032), is never updated after creation (`grep -n 'UPDATE "HabitLog"'`: zero matches — insert-only), and is never deleted by any production code path (`grep -rn 'DELETE FROM "HabitLog"'` across `apps/web/lib` and `apps/web/app/api`: zero matches). **Precision correction**: a real Postgres FK does exist — `PlannedActivity.habitLogId TEXT REFERENCES "HabitLog"(id) ON DELETE SET NULL` (migration `0013_planned_activities`) — though it is not represented as a Prisma `@relation` in `schema.prisma` (only a plain `habitLogId String?` field, schema.prisma:405). The FK runs **one direction only** (`PlannedActivity → HabitLog`): it would SET NULL `PlannedActivity.habitLogId` if a `HabitLog` row were ever deleted, but nothing ever deletes one, so this is dead code in practice. Critically, **no FK runs the other way** — `HabitLog` has no `plannedActivityId` column at all — so deleting a `PlannedActivity` row has no cascade path into `HabitLog` whatsoever. The net conclusion is unchanged: a `HabitLog` row, once created, survives its originating `PlannedActivity`'s deletion completely intact, just unreachable via that specific forward pointer (still fully queryable directly by `userId`+`logSource`+`logTimestamp`).
- **Idempotency-key infrastructure is already well-established**, under the consistent vocabulary `clientRequestId`, via three distinct mechanisms depending on context:
  1. A nullable column + partial unique index (`HabitLog.clientRequestId`, migration 0032).
  2. A dedicated raw-SQL "claim, then fill" table (`PlanCreationIdempotency`, migration 0025, used by Day Constructor acceptance; `GuestConversionRedemption`, migration 0024, same pattern for guest conversion).
  3. A deterministic-id derivation reusing the primary key itself (`apps/web/lib/goalCreateIdempotency.ts`: `Goal.id = sha256("goal-create:${userId}:${clientRequestId}")`, explicitly documented as deliberately avoiding a second idempotency table).
- **Replay/concurrency safety** uses per-user `pg_advisory_xact_lock(hashtext(...))` with exactly three keyspace prefixes in the entire codebase: `day-constructor-accept:<userId>` (4 call sites: `apps/web/app/api/plans/route.ts:270`, `apps/web/lib/dayConstructorAcceptancePersistence.ts:309`, `apps/web/lib/remainingDayRecompositionAcceptance.ts:182`, `apps/web/lib/planMove.ts:80`), `goal-evidence:<userId>` (`apps/web/lib/db.ts:1672`, `apps/web/lib/db.ts:2944`), `visit-log:<userId>` (`apps/web/lib/db.ts:1942`).

**Conclusion for §12 (architecture options):** this codebase has a strong, consistent, already-proven idempotency/durability vocabulary. If any new evidence write were ever justified, the correct pattern to extend is this existing one (`clientRequestId` + nullable column + partial unique index, or the HabitLog model's own existing shape) — never a new, generic, type-erased event table.

### 3.2 Evidence inventory table

| Entity / field | Writer | Timestamp | Identity | Retention | Deletion behavior | Reader | Historical reliability |
|---|---|---|---|---|---|---|---|
| `PlannedActivity.status`/`loggedAt` | `logPlannedActivity` (db.ts:1571) | `loggedAt`, server `completionInstant`, set only on this transition | Row id | Until explicit delete | Hard-deletable only when `status IN ('LOGGED','CANCELLED')` (`deletePlannedActivity`, db.ts:1551) | `insightsReporting.ts`, `PlanWithAuraView` | **VERIFIED HISTORICAL FACT** while the row exists |
| `PlannedActivity.status`/`skippedAt` | `skipPlannedActivity` (db.ts:1533) | `skippedAt`, set only on UPCOMING→SKIPPED, conditional UPDATE | Row id | Permanent (SKIPPED is terminal, never deleted by any path) | Never deleted (no delete path accepts SKIPPED) | planning-status reporting | **VERIFIED HISTORICAL FACT** |
| `PlannedActivity.status`/`movedAt` | `applyMoveWrites` (planMove.ts:296) | `movedAt`, set only on UPCOMING→MOVED, same statement as the status UPDATE | Row id (source) | Permanent for pre-terminal chain members (a MOVED row can never satisfy `deletePlannedActivity`'s `LOGGED`/`CANCELLED` guard) | Only the chain's live terminal is ever deletable | Move-chain evaluation (`improvementSignals.ts`) | **VERIFIED HISTORICAL FACT** for rows created after migration 0046; **NULL for legacy rows (never backfilled by design)** |
| `PlannedActivity.status`/`updatedAt` only (CANCELLED) | `cancelPlannedActivity` (db.ts:1502) | **No dedicated `cancelledAt` column** — only generic `updatedAt` | Row id | Permanent (CANCELLED is terminal, hard-deletable per the same LOGGED/CANCELLED guard) | Deletable | planning-status reporting | **RELIABLE DERIVATION in practice** (nothing else ever writes to a CANCELLED row, so `updatedAt` happens to equal the cancel instant) but **not a VERIFIED fact by column design** — see §9 |
| `HabitLog` (full row) | `logPlannedActivity` (db.ts:1764, `logSource='AURA_PLANNED'`) and the manual-logging API (`logSource='MANUAL'`/others) | `logTimestamp`, the real historical completion instant (`derivePlanCompletionHistory`), independent of `plannedStartAt` | `id` (own UUID), `clientRequestId` (idempotency) | **Permanent — never deleted by any code path** | N/A — no delete path exists | Behavioral duration personalization, Aura Fit, Insights | **VERIFIED HISTORICAL FACT**, durable independent of the originating `PlannedActivity`'s own lifetime |
| `PlannedActivity.habitLogId` | `logPlannedActivity` | N/A (identity pointer) | `String?`; real Postgres FK → `HabitLog.id`, `ON DELETE SET NULL` (migration 0013), not a Prisma `@relation` | Survives source-row deletion trivially (the FK runs `PlannedActivity → HabitLog` only; nothing cascades the other way, and nothing ever deletes `HabitLog`) | N/A | — | The pointer is forward-only; a deleted `PlannedActivity`'s `HabitLog` row becomes unreachable **by this pointer** (no reverse FK exists — `HabitLog` has no `plannedActivityId` column), but remains fully queryable directly by `userId`+`logSource`+`logTimestamp` |
| `PlanCreationIdempotency.plannedActivityId` (raw SQL, migration 0025) | Day Constructor acceptance's "claim, then fill" writer | `createdAt` (when first claimed) | `(userId, clientRequestId)` composite PK | **CASCADE-deleted** when its target `PlannedActivity` is hard-deleted (`ON DELETE CASCADE` — migration 0025, confirmed unaltered by any later migration) | **Unlike every other `plannedActivityId` FK in this schema (all `SetNull`), this ONE uses CASCADE** — an inconsistent convention | — | The acceptance event's own only durable record is destroyed along with the Plan — see §4 CREATE/ACCEPT row |
| `GoalActivityExecution` (full row) | `logPlannedActivity` (first write) / idempotent re-log (update only `currentValue`/`source`/`updatedAt`) | `createdAt`, set once, never touched again | `id`, `goalActivityOccurrenceId` (unique, durable), `plannedActivityId` (unique, `SET NULL` on delete) | Permanent — Goal deletion is the only thing that can remove it, and is itself gated (see §6) | `goalActivityId` CASCADEs (dies only with its Goal); `plannedActivityId` SETs NULL | `insightsReporting.ts`, Goal Detail | **VERIFIED HISTORICAL FACT**, durable across Plan deletion by design (PR3) |
| `GoalActivityOccurrence.scheduledWeekStart`/`scheduledWeekTimezone` | `materializeGoalActivityRhythmOccurrence`, `applyMoveWrites` | Snapshot frozen at creation/each Move, never re-derived from current timezone | Both fields always written together; a partial state throws rather than guesses | Permanent, additive-only, no backfill for pre-PR2 rows | `plannedActivityId` SETs NULL on Plan delete; the snapshot itself is untouched | Goal Rhythm eligibility, weekly reporting | **VERIFIED HISTORICAL FACT** for post-PR2 rows; **NULL for pre-PR2 legacy rows** — correctly excluded, never fabricated (`resolveOccurrenceLocalDateOrNull`) |
| `Goal.status`/`archivedAt` | `archiveGoal` (db.ts:2834) | `archivedAt`, `COALESCE`'d (idempotent, never overwritten by a repeat archive) | Row id | Permanent — archiving never deletes anything | All child rows (`GoalActivity`, `GoalActivityExecution`, `GoalActivityOccurrence`) remain fully intact | Goals list (filtered by status) | **VERIFIED HISTORICAL FACT**, and the Goal + every child row remains fully queryable |
| `Goal` hard delete | `deleteGoal` (db.ts:2941) | N/A | — | **Gated**: refuses (`'HAS_HISTORY'`) if any retained PlannedActivity linkage OR surviving `GoalActivityExecution` evidence exists (`goalHasRetainedPlanLinkage`) | CASCADEs `GoalActivity`→`GoalActivityExecution`→`GoalActivityOccurrence` only once the gate passes | — | Deletion is evidence-safe **by construction** — it is structurally impossible to lose completion evidence via `deleteGoal` while that evidence exists |
| `DailyReflection` | `upsertDailyReflection` (db.ts:2254, `POST /api/daily-assistant/reflection`) | `createdAt` (first submission), `updatedAt` (any edit); `reflectionDate` is a civil date, encoded as literal UTC midnight, never re-interpreted through any timezone | `@@unique([userId, reflectionDate])` — one row per civil day, true `ON CONFLICT ... DO UPDATE` upsert | Permanent; only removable via the owning `User`'s own `onDelete: Cascade` | No dedicated delete path; cascades only if the User itself is deleted | "Your Alignment" Insights card, reflection/alignment correlation | **VERIFIED**: a correction overwrites `outputLevel`/`followedGuidance`/`notes` in place; the ORIGINAL submission instant is not separately preserved once edited (only the latest `updatedAt`) — real, working precedent for "resubmit the same day" (§11.5) |

---

## 4. Lifecycle Evidence Matrix

**[VERIFIED]** For each lifecycle action: current persisted state, surviving historical fact, authoritative timestamp, actor, originating-activity knowability, transition reconstructability, deletion-destroys-evidence, replay-duplicate risk, local-date attributability.

| Action | Persisted state | Historical fact that survives | Authoritative timestamp | Actor identifiable | Originating activity known | Transition reconstructable | Deletion destroys evidence? | Replay can duplicate? | Local-date attributable |
|---|---|---|---|---|---|---|---|---|---|
| **CREATE** (Day Constructor acceptance) | `PlannedActivity` row, `UPCOMING` | The row itself; `PlanCreationIdempotency` claim (`createdAt` = first claim instant) | `createdAt` | Always this `userId` (single-user app, no multi-actor concept exists anywhere in this schema) | Yes — the row's own fields | N/A (origin point) | **Yes, fully** — `PlanCreationIdempotency.plannedActivityId` is `ON DELETE CASCADE` (migration 0025, confirmed unaltered by any later migration), unlike every other `plannedActivityId` FK in this schema (all `SetNull`). Once the resulting Plan is hard-deleted, the acceptance's own only durable record is destroyed with it — no tombstone, no `ProductEvent`, nothing | **No** — `PlanCreationIdempotency`'s claim-then-fill pattern returns the SAME stored rows on retry (`dayConstructorAcceptancePersistence.ts`) | Yes, via `plannedStartAt` |
| **ACCEPT** | Same row as CREATE — acceptance and creation are the same write in this system | Same as CREATE | Same as CREATE | Yes | Yes | N/A | Same as CREATE | Same as CREATE | Yes |
| **MOVE** | Source row → `MOVED`; new successor row → `UPCOMING`, `rescheduledFromPlanId` | Full chain, walkable via `rescheduledFromPlanId` | `movedAt` (post-migration-0046 rows) | Yes | Yes — source row's own fields | **Yes**, by walking the chain (§5) | Only the chain's live terminal is ever deletable; every interior hop is structurally permanent | **No** — exact-retry short-circuit returns the existing successor (planMove.ts:86-93); `UNIQUE(rescheduledFromPlanId)` is the DB-level backstop | Yes, per-hop via each row's own `plannedStartAt` |
| **COMPLETE** | `LOGGED`, `loggedAt` | `HabitLog` row (independent, permanent); `GoalActivityExecution` if Goal-linked | `loggedAt` / `HabitLog.logTimestamp` (same instant) | Yes | Yes | N/A (terminal) | **No for non-Goal-linked plans** (HabitLog survives, §6); **no for Goal-linked plans** (GoalActivityExecution survives, durably, by PR3 design) | **No** — idempotent re-log returns the existing `HabitLog`/execution unchanged (db.ts:1583-1599) | Yes |
| **SKIP** | `SKIPPED`, `skippedAt` | The row itself (never deleted — no delete path accepts SKIPPED) | `skippedAt` | Yes | Yes | N/A (terminal) | N/A — never deletable | **No** — idempotent (db.ts:1543-1547 returns the existing SKIPPED row) | Yes |
| **CANCEL** | `CANCELLED`, generic `updatedAt` only | The row itself, until deleted | **None dedicated — confirmed, no `cancelledAt` column exists anywhere in the schema** (`updatedAt` only; RELIABLE DERIVATION, not VERIFIED by design — see §9) | Yes, while the row exists | Yes, while the row exists | N/A (terminal) | **Yes if later hard-deleted** — no independent cancellation record exists anywhere | **Not idempotent** — unlike Skip, a second `cancelPlannedActivity` call on an already-CANCELLED row matches zero rows (`WHERE status = 'UPCOMING'` guard fails) and throws, rather than returning the existing row | Yes, while the row exists |
| **DELETE** | Row removed (`LOGGED`/`CANCELLED` only) | Durable evidence per-action above; FK `SET NULL` on every `GoalActivity`/`GoalActivityOccurrence`/`GoalActivityExecution`/self-referencing-`rescheduledFromPlanId` link, **except `PlanCreationIdempotency.plannedActivityId`, which CASCADEs** (see CREATE row above) | N/A | N/A — not itself a timestamped fact | N/A | N/A | **For CANCELLED plans** (no independent record at all, §8); **for the Day-Constructor-acceptance claim record** (CASCADE-deleted, see above); **not** for Goal-linked LOGGED plans (`GoalActivityExecution` durably survives, §6) or — once §7's reader fix is implemented — non-Goal-linked LOGGED plans either (`HabitLog` durably survives today already; only the READER doesn't yet use it) | N/A | N/A |
| **GOAL UPDATE** | `GoalActivity`/`Goal` fields change | `GoalActivityExecution`'s own snapshot fields are **immutable** once written — a later target edit never retroactively changes a past execution's `completionTargetValueSnapshot` | `updatedAt` on the edited row only | Yes | Yes | N/A | N/A | N/A | N/A |
| **GOAL ARCHIVE** | `Goal.status='ARCHIVED'`, `archivedAt` | Everything — fully non-destructive | `archivedAt` (idempotent, `COALESCE`'d) | Yes | Yes | N/A | **No** — zero evidence loss | **No** — idempotent | N/A |
| **GOAL DELETE** | Row + cascaded children removed | **Gated**: refuses when evidence would be lost | N/A | N/A | N/A | N/A | **No, by construction** (`goalHasRetainedPlanLinkage` blocks it) | N/A | N/A |

**Do not treat `updatedAt` as proof of a specific action — the one row in this matrix where that distinction actually matters is CANCEL**, flagged explicitly above and discussed further in §9.

---

## 5. Move History Findings

**[VERIFIED]** Full trace of `apps/web/lib/planMove.ts` (`movePlannedActivity`, `applyMoveWrites`, `enforceDestinationWeekCapacity`).

- **Chain mechanics confirmed**: `A (UPCOMING) --Move--> A (MOVED) ---> B (UPCOMING, rescheduledFromPlanId=A)`. `rescheduledFromPlanId` is `@unique` — at most one successor per row, enforced at the DB level, making the chain a true, forkless linked list.
- **Idempotency confirmed at the code level** (planMove.ts:86-93): if the source row is already `MOVED` and the caller's requested destination matches the EXISTING successor's own start time exactly, the function returns that successor without any write — a genuine replay-safe short-circuit, not merely a DB-constraint backstop.
- **`movedAt` is atomic with the status transition** (planMove.ts:296: `UPDATE ... SET status = 'MOVED', "movedAt" = now() ... WHERE status = 'UPCOMING'`) — a rolled-back transaction leaves no stamp; the idempotent-replay path above never re-executes this statement, so it never re-stamps.
- **Cross-week Move is enforced AND re-attributed in the same transaction**: `enforceDestinationWeekCapacity` re-checks the destination week's `N_PER_WEEK` capacity (closing a real gap that existed before PR2) and `applyMoveWrites` re-stamps `scheduledWeekStart`/`scheduledWeekTimezone` to the destination atomically with the repoint (planMove.ts:347-352) — confirmed, not inferred.
- **Legacy NULL `movedAt`**: never backfilled by design (migration 0046's own stated policy). Hop-count reconstruction (chain length via `rescheduledFromPlanId`) is **completely unaffected** — only the per-hop "when" is unavailable for pre-migration hops, never the "how many."
- **Deleted chain members**: structurally impossible for anything but a chain's current live terminal (a `MOVED` row can never satisfy `deletePlannedActivity`'s `status IN ('LOGGED','CANCELLED')` guard). Confirmed by direct re-trace of `deletePlannedActivity`'s own SQL.
- **Do not double-count source and successor**: `insightsReporting.ts`'s own fact model already gets this right — the source row (now `MOVED`) classifies `RESCHEDULED`; the successor classifies independently on its OWN current status. This is two distinct real facts ("a reschedule happened" + "here is the commitment's current state"), not a double-count — already correctly documented and implemented, re-confirmed by this audit.

**What would a new event record preserve that the existing chain cannot?** Nothing structural. The chain already proves: hop count, each hop's destination time (`plannedStartAt` of each row), each hop's commit instant (`movedAt`, where present), and the terminal's live status. The **only** thing a dedicated Move-event record would add is a timestamp for **pre-migration-0046** moves — a closed, non-growing historical gap this audit explicitly recommends **not** backfilling (§13: never fabricate a timestamp from `updatedAt`).

**Conclusion**: existing Move chains already provide sufficient durable event history. **No new Move-event record is justified.**

---

## 6. Completion Evidence Findings

**[VERIFIED]** Full trace of PR3's `GoalActivityExecution`/`goalActivityOccurrenceId` design, plus the newly-traced `HabitLog` relationship (§3.1).

- **Execution timestamps**: `createdAt` is set once, at first completion, and **never touched again** — even an idempotent re-log only updates `currentValue`/`source`/`updatedAt` (db.ts:1813-1820), never `createdAt`. This is a genuine, immutable "when was this occurrence first completed" fact.
- **Actual recorded values**: `currentValue` is never clamped to the snapshotted target — an actual value may legitimately exceed it (over-target) or fall short (partial), and both are preserved exactly as entered. The snapshot fields (`completionKindSnapshot`/`completionTargetValueSnapshot`/`completionUnitSnapshot`) are frozen at the execution's own creation and never re-derived from a later-edited `GoalActivity` — this audit explicitly re-confirms PR3's own design intent is preserved unchanged by every subsequent PR.
- **Goal/occurrence attribution**: `goalActivityId` (CASCADE, dies only with its Goal) + `goalActivityOccurrenceId` (`SET NULL`, durable across Plan deletion, `@unique` so one occurrence can never be double-credited) together give unambiguous, durable attribution.
- **Deleted completed plans (Goal-linked)**: fully durable by PR3's own design — re-confirmed, not re-derived, in this pass. `plannedActivityId` SETs NULL on delete; `currentValue`/snapshot/`goalActivityOccurrenceId` are completely untouched.
- **Deleted Goals**: cannot destroy retained evidence — `deleteGoal` is gated (§3, §4).
- **Legacy NULL links**: a pre-PR3 execution with no `goalActivityOccurrenceId` is handled by the documented fallback (`goalActivityId`-keyed "most recent" resolution) — a known, bounded, already-shipped-and-tested degradation, not a new gap.
- **Duplicate completion protection**: structural, not merely a DB-constraint backstop — `logPlannedActivity`'s own idempotent-retry early-return (db.ts:1583-1599) means the duplicate-write code path is **never even reached** on a second call for an already-`LOGGED` plan. The `goalActivityOccurrenceId`'s own `@unique` constraint is the DB-level backstop beneath that.
- **Retry/concurrency**: `goal-evidence:${userId}` advisory lock is held by both `logPlannedActivity`'s Goal-linked branch and `deleteGoal`, closing the exact TOCTOU window a concurrent Done-vs-delete race would otherwise open — already correctly implemented (PR3), re-verified.

**Would a separate completion event duplicate authoritative execution evidence?** **Yes, entirely** — `GoalActivityExecution` already IS the completion event for Goal-linked activities: it has a stable identity, an immutable creation timestamp, an immutable snapshot, a mutable-but-attributed measured value, and durable attribution surviving Plan/Goal deletion (short of Goal deletion itself, which is evidence-gated). **A new event record here would be pure duplication.**

---

## 7. Non-Goal Deletion Analysis — the one real finding

**[VERIFIED]** This is the audit's central finding, fully re-traced from the schema and `logPlannedActivity`/`deletePlannedActivity` source (not merely inferred from doc comments).

- **The known limitation, as previously stated in PR3/PR4 audits**: "a completed non-Goal-linked plan may lose its reporting credit after hard deletion."
- **Does underlying evidence actually survive?** **Yes.** `logPlannedActivity` (db.ts:1571) ALWAYS creates a `HabitLog` row on completion — Goal-linked or not — with `id = habitLogId` (a fresh UUID), and stamps that id forward onto `PlannedActivity.habitLogId`. A real Postgres FK does exist on that column (`habitLogId TEXT REFERENCES "HabitLog"(id) ON DELETE SET NULL`, migration 0013 — not represented as a Prisma `@relation`, only a plain `String?` field at schema.prisma:405), but it runs `PlannedActivity → HabitLog` only; `HabitLog` has no reverse `plannedActivityId` column, so there is structurally no cascade path from `PlannedActivity` deletion INTO `HabitLog`. Direct `grep` across the entire `apps/web/lib` and `apps/web/app/api` trees for `DELETE FROM "HabitLog"` returns **zero matches**, and `UPDATE "HabitLog"` likewise returns zero matches — no code path, anywhere, ever deletes or modifies a `HabitLog` row after creation.
- **The `HabitLog` row carries everything needed to attribute a completion**: `activityTitle` (copied from the plan's own title), `activityId` (copied verbatim from the plan), `logTimestamp` (the REAL completion instant, historically accurate via `derivePlanCompletionHistory`, independent of `plannedStartAt`/`plannedEndAt`), `durationMinutes`, `logSource='AURA_PLANNED'`.
- **So why can't reporting use it today?** Because it never tries to. `listPlannedActivitiesForReporting` (db.ts) and `summarizePlanningStatus`/`classifyPlanningStatus` (`insightsReporting.ts`) query **only** the `PlannedActivity` table for the requested date range — a deleted plan simply isn't in that result set, full stop. There is no fallback `UNION`/secondary query against `HabitLog WHERE userId = $1 AND logSource = 'AURA_PLANNED' AND logTimestamp BETWEEN ...` for rows whose originating Plan is gone.
- **The reverse link does not exist**: `HabitLog` itself has no `plannedActivityId` column — only the forward pointer (`PlannedActivity.habitLogId`) exists, and that pointer dies with the Plan. This means a durable `HabitLog` row, once its originating Plan is deleted, can still prove "a completion happened, at this real instant, for this activity title/catalog id" but **cannot** be re-linked to the specific now-gone `PlannedActivity.id` (irrelevant for a count-based metric like `confirmedCompleted`; it would matter for a UI action like "open this plan," which no longer has a target anyway).

**If evidence does not survive: smallest durable requirement.** N/A — evidence already survives.

**If evidence survives: why can't reporting use it, and what's the smallest fix?** Already answered above. **The smallest fix is a reader-side correction, not a new persistence requirement**: extend `listPlannedActivitiesForReporting`'s own composition (or add one small, additive, read-only `HabitLog`-sourced query, counted separately and summed into `confirmedCompleted`) to also count `HabitLog` rows with `logSource='AURA_PLANNED'` whose `logTimestamp` falls in the requested range and whose `id` has no corresponding live `PlannedActivity.habitLogId` (to avoid double-counting a still-live, already-counted Plan). **This closes the gap with zero new tables, zero new columns, zero new migrations** — confirming the ticket's own instruction: *"Do not automatically conclude that a generic event log is needed."* It did not need one.

**Materiality of this gap, honestly assessed**: narrow. It only matters when a user both completes a non-Goal-linked plan AND explicitly hard-deletes it from "Recently Completed" within the SAME reporting window being viewed. `confirmedCompleted` is already correct for every plan the user has not deleted. This is a real but low-severity undercounting bug, not a user-facing capability that is currently blocked.

---

## 8. Skip/Cancel Semantics

**[VERIFIED]**

| Status | Explicit action? | Dedicated timestamp | Survives after the fact? |
|---|---|---|---|
| `SKIPPED` | Yes (`skipPlannedActivity`) | `skippedAt`, action-specific | Yes — SKIPPED rows are never deletable (no delete path accepts this status) |
| `CANCELLED` | Yes (`cancelPlannedActivity`) | **No** — `updatedAt` only | While the row exists, yes (reliably, since nothing else writes to a terminal CANCELLED row); **lost entirely if the row is later hard-deleted** (CANCELLED is one of the two deletable statuses) |
| `MOVED` | Yes (an explicit user Move) | `movedAt` (post-migration-0046) | Yes — structurally permanent except at the live terminal |
| `LOGGED` | Yes (explicit Done) | `loggedAt` + independent `HabitLog` | Yes, durably (§7) |
| `UPCOMING`, still in the future | N/A — no action taken yet | N/A | N/A |
| **Derived MISSED** (a past, still-`UPCOMING` plan, as PR4 classifies `AWAITING_CONFIRMATION`) | **Explicitly not an event** — confirmed, `classifyPlanningStatus` (`insightsReporting.ts:55-72`) never writes anything; it is a pure, re-derived presentation label computed fresh on every read from `status` + elapsed time | N/A — there is nothing to persist; the "fact" is the ABSENCE of a recorded outcome, not an occurrence | N/A |

**Confirmed distinctions, preserved correctly throughout the current codebase**:
- **Confirmed action** (SKIP/CANCEL/MOVE/LOGGED — something the user explicitly did) vs. **current status** (the column's present value) vs. **unconfirmed outcome** (a past UPCOMING plan — genuinely unknown, not a judgment) vs. **derived presentation state** (`AWAITING_CONFIRMATION`/`SCHEDULED`, computed fresh on every read, never stored).
- **Missing completion evidence does not prove non-completion** — already correctly honored everywhere in this codebase; no reader anywhere infers `SKIPPED`/`MISSED`/failure from mere elapsed time. `classifyPlanningStatus`'s own doc comment makes this explicit.
- **Explicit Skip and Cancel remain historically distinguishable after subsequent changes**, as long as the row exists — SKIPPED is permanent; CANCELLED is distinguishable only until (if ever) hard-deleted, at which point the fact "this was explicitly cancelled, not merely never-happened" is lost along with the row. This is the one place in this entire audit where hard deletion destroys a real, if minor, historical distinction — flagged explicitly, see §9.

---

## 9. Goal Rhythm Historical Integrity

**[VERIFIED]** Re-confirmed PR2's `scheduledWeekStart`/`scheduledWeekTimezone` snapshot design end-to-end.

- **Cross-week Move**: re-stamped atomically with the repoint (§5) — survives correctly.
- **Timezone change**: the snapshot is frozen at write time and never re-derived from the user's CURRENT timezone on read (`resolveOccurrenceLocalDate`/`resolveOccurrenceLocalDateOrNull`, `goalActivityRhythm.ts:191-233`) — a later timezone change cannot retroactively reshuffle historical weekly credit. Confirmed by direct re-read of the resolver functions, not merely cited from memory.
- **Completion**: does not touch the snapshot at all — orthogonal concerns, confirmed by `logPlannedActivity`'s own write set (never touches `GoalActivityOccurrence.scheduledWeekStart`).
- **Plan deletion**: `resolveOccurrenceLocalDateOrNull` explicitly handles the deletion-tolerant case — a fully-populated (post-PR2) snapshot remains authoritative on its own even with no live Plan to derive from; a fully-EMPTY snapshot (pre-PR2 occurrence, Plan also since deleted) correctly returns `null` (excluded from weekly facts) rather than fabricating a week. A partially-populated snapshot (should be structurally impossible — both fields are always written together) throws rather than guessing.
- **Goal lifecycle changes**: archiving preserves everything (§3); deletion is evidence-gated (§3, §6).

**Would an event history improve any currently-unanswerable attribution question?** **No.** Every attribution question this audit could construct (which week did this occurrence count toward; does a later timezone change affect it; does deletion affect it; does a cross-week Move affect it) is already answered correctly and durably by the existing snapshot design. The one genuinely unanswerable question — "what week did a pre-PR2 occurrence whose Plan is ALSO since deleted count toward" — is a **closed, non-growing legacy gap** (every occurrence created after PR2 shipped always has the snapshot), not an ongoing one a new event history would meaningfully shrink.

---

## 10. PR4/PR5 Reporting Limitations

**[VERIFIED]**, re-inspected directly against the current, merged `insightsReporting.ts`/`improvementSignals.ts`/`improvementSignalsComposition.ts`.

| Metric/signal | Evidence source | Historical coverage | Data loss scenario | Attribution assumption | Duplicate risk | Retention limit |
|---|---|---|---|---|---|---|
| Confirmed progress (`confirmedCompleted`) | `PlannedActivity.status='LOGGED'` within the requested range | Full, for any plan not yet hard-deleted | **The §7 gap** — a deleted, non-Goal-linked completed plan is undercounted | `plannedStartAt`/`plannedEndAt` within range | None | Bounded by the caller's own `from`/`to` query params (default 30 days) |
| Goal Rhythm progress | `GoalActivityExecution` + `GoalActivityOccurrence.scheduledWeekStart` | Full, durable across Plan/sibling deletion (§6, §9) | None found | Snapshot-first, never re-derived from current timezone | None — `@unique` on `goalActivityOccurrenceId` | Current local week only (Rhythm is inherently a rolling-week concept, not retained history) |
| Planning patterns (scheduled/skipped/cancelled/rescheduled) | `PlannedActivity.status` directly | Full for live rows; **CANCELLED's own historical reliability degrades to "reliable derivation" rather than "verified fact" once hard-deleted (§8)** | A deleted CANCELLED plan vanishes from this count entirely (no survived evidence at all, unlike LOGGED's HabitLog fallback) | None beyond persisted status | A MOVED source + its live successor are two distinct, correctly-separate facts, re-confirmed never double-counted | Same range bound as above |
| Awaiting confirmation | Same `PlannedActivity` query, `AWAITING_CONFIRMATION` derived from elapsed time | Full, live-only (a presentation label, never stored) | None — this is explicitly NOT an event, nothing to lose | Elapsed-time-vs-`now` only | The aggregate suggestion is one signal regardless of underlying item count — not a duplication risk | Same |
| Repeated rescheduling | `rescheduledFromPlanId` chain walk, unbounded by any date range | Full for live chains (§5) | Only the closed, pre-migration-0046 per-hop timestamp gap | Terminal must be live `UPCOMING` | Dedup by `subjectId` in `rankAndSelectSuggestions` | None — chain evaluation is always current-state |
| Current overload (PR5 Signal 2) | **Live-only**, `computeCapacitySnapshot` against today's real availability + real commitments | **None, by design** — the underlying capacity model persists nothing, ever | N/A — nothing is ever stored to lose | Present-tense only; this audit re-confirms the shipped copy makes no frequency/trend claim | N/A | N/A — computed fresh every request |
| Weekly Goal opportunity (PR5 Signal 3) | Rhythm remaining-capacity (durable, §9) + live contiguous-free-slot feasibility recheck (never stored) | Full for the durable half; the feasibility half is live-only | N/A | Structural placeability only, not muhurta/auspicious-timing fit (an explicit, documented PR5 scope boundary) | Dedup by Goal id | N/A |

**Do not invent historical capacity snapshots or overload trends — re-confirmed, not violated anywhere in the current code.** PR5's own `evaluateOverloadSignal` doc comment and shipped copy ("Your current plans may need more time than you have available") were directly re-inspected in this pass and contain no digit, frequency, or trend claim.

---

## 11. User-Facing Capability Gaps

**[RECOMMENDED]** evaluated against the ticket's own five candidate capabilities:

| # | Capability | User benefit | Existing evidence | Missing evidence | Required UI | Required write path | Complexity | Privacy impact | V1 necessity |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Activity history timeline ("Planned Monday, moved Tuesday, completed Wednesday") | Transparency into what actually happened to a commitment | Fully reconstructable **while the chain/row survives** (§5): each hop's `plannedStartAt` + `movedAt`, terminal's `loggedAt`/`skippedAt` | None for a live chain; only pre-migration-0046 per-hop timing is unavailable (closed gap) | A new read-only timeline view, composing the Move chain + terminal status — **UI work, not evidence work** | **None** | Low-medium (UI composition over already-correct data) | Low — same `userId`-scoped data already shown elsewhere | **Not demonstrated as blocked** — no missing evidence; purely a UI feature, out of this audit's "do we need new evidence" question |
| 2 | Goal progress history (historical user-confirmed contributions/values) | Trust that progress numbers are real, not re-derived | Fully present: `GoalActivityExecution.currentValue`/snapshot fields, durable (§6) | None | A history list over existing `GoalActivityExecution` rows | **None** | Low | Low | **Not demonstrated as blocked** — pure UI/read work |
| 3 | Planning adjustment patterns (repeated Moves/Skips over a bounded period) | Awareness of friction patterns | PR5's own Signal 1 already does exactly this for Moves; Skip-pattern aggregation would reuse the identical `PlannedActivity.status='SKIPPED'` + `skippedAt` evidence, already fully durable | None | A new aggregate view/metric | **None** | Low | Low | **Not demonstrated as blocked** — evidence already exists; this would be a reporting feature, not an evidence gap |
| 4 | Explanation provenance ("Why is Aura suggesting this?") | Trust in suggestions | PR5's own `evidence` field on every `ImprovementSuggestion` (`improvementSignals.ts`) already carries a machine-readable reason, and the shipped copy always states the evidence-backed reason in plain language | A structured, user-FACING "why" beyond the copy itself (currently internal/test-only) | Minor UI surfacing (already-present `message` field is user-facing; `evidence` is not) | **None** | Very low | None | **Already substantially shipped** — PR5 already satisfies the spirit of this; no new evidence needed |
| 5 | Historical correction (what if a user needs to correct a previously recorded outcome?) | Fixes a wrong Done-tap/value | `DailyReflection`'s own `@@unique([userId, reflectionDate])` upsert design is existing, working precedent for "resubmit the same day"; `GoalActivityExecution.currentValue` is mutable (idempotent re-log updates it) | **A general "undo a Done" or "edit a past completion's value after the fact" flow does not exist today** — `logPlannedActivity`'s own idempotent path only RE-RETURNS the same value, it does not accept a NEW one for an already-LOGGED plan | A correction UI/flow | **A real gap**: no writer currently allows changing `GoalActivityExecution.currentValue` for an ALREADY-LOGGED plan, nor un-cancelling/un-skipping | Medium (needs its own product decision on whether corrections should be visible/audited) | Medium — a correction flow touches already-reported numbers | **The one capability with a genuine, if narrow, missing write path** — but this is a **product decision about whether correction should be supported at all**, not evidence this audit can unilaterally justify adding (§14 product gates) |

**Reject speculative features that do not solve a demonstrated user problem**: capabilities 1-4 require **zero new evidence** — they are UI/reporting work over data that already durably exists. Capability 5 is the only one with a real gap, and it is a **product-policy question** (should corrections be allowed, and should they be visible as "corrected" vs. silently overwritten), not an architecture question this audit can resolve unilaterally.

---

## 12. Architecture Comparison

**[RECOMMENDED]**

| | Correctness | Write-path complexity | Duplication | Replay/idempotency | Concurrency | Txn atomicity | Historical migration | Storage growth | Query performance | Privacy | Deletion semantics | Maintenance burden |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A — No new event history** (reuse + correct readers) | Fixes the one demonstrated gap (§7) exactly | None — zero new writes | None | N/A | N/A | N/A | None needed | None | One additional cheap, indexed, bounded-range query | No new data collected | Unchanged | Lowest — no new model to maintain |
| **B — Targeted durable evidence** (new facts for specific transitions, e.g. a `cancelledAt` column) | Closes the CANCEL-timestamp gap (§8) if ever needed | Minimal — one nullable column, one conditional UPDATE, same pattern as `skippedAt` | None | Trivial (same guard pattern already used everywhere) | None new | Trivial — same transaction as the existing UPDATE | None needed (additive, no backfill, same precedent as `movedAt`) | Negligible | No impact | No new data collected | Unchanged | Low |
| **C — Generic append-only event log** | Does not close any gap this audit actually found more completely than A/B already would | High — a new table, a new write on every lifecycle action, a new typed-payload discipline to maintain forever | **High** — duplicates `HabitLog`, `GoalActivityExecution`, `movedAt`/`skippedAt`, all of which already serve this exact purpose | Must be invented from scratch (though this codebase's existing `clientRequestId` pattern, §3.1, is directly reusable) | New locks/transactions needed for every write site | Must be proven atomic with EVERY existing domain write (real risk of the "async best-effort history that can silently diverge" the ticket explicitly warns against) | N/A (new table, nothing to migrate, but legacy rows could never be backfilled honestly — §13) | Unbounded, ongoing, for every future lifecycle action, forever | New indexes, pagination, retention policy all required from day one | Must be designed carefully (what's recorded, for how long) | Must be designed from scratch | **Highest** — a new, permanent, general-purpose subsystem with no current demonstrated need |
| **D — Hybrid** (existing records + narrowly-scoped new evidence for specific missing transitions) | Same as A+B combined | Same as B, additively | None, if scoped tightly | Same as B | Same as B | Same as B | Same as B | Same as B | Same as B | Same as B | Slightly higher than A alone, same as B |

**Recommendation: Option A for the §7 gap (no new write path needed at all — it is a reader fix). Option B only if/when the CANCEL-timestamp gap (§8) or the Historical Correction capability (§11.5) is explicitly product-approved as needed — neither is demonstrated as blocking today.** Option C is explicitly **not recommended** — it would duplicate multiple already-correct, already-durable evidence sources, and this codebase already has a consistent, proven idempotency vocabulary (`clientRequestId`) that a generic event log would not meaningfully improve on for any gap actually found.

---

## 13. Proposed Evidence Contract — NOT JUSTIFIED, not proposed

**[RECOMMENDED — explicitly declined]** Per the ticket's own instruction ("Only if new event storage is justified, propose a conceptual contract"): **this audit found no gap that justifies new event storage.** The §7 gap requires a reader correction, not a schema change. The §8 CANCEL-timestamp gap and §11.5 correction-flow gap are real but **not currently blocking any demonstrated capability**, and are product-policy questions, not architecture ones.

If a future ticket's own product-decision process DOES approve the CANCEL-timestamp gap for closure, the correct shape (stated here only as a non-binding sketch, since no implementation is authorized) would be a single nullable `cancelledAt DateTime? @db.Timestamptz(3)` column on `PlannedActivity`, set once, conditionally, in the same statement as the existing `UPDATE ... SET status = 'CANCELLED'` — **exactly** mirroring `skippedAt`'s own already-proven pattern. No new table, no new idempotency key beyond the existing `WHERE status = 'UPCOMING'` guard, no new transaction boundary beyond the one `cancelPlannedActivity` already uses.

---

## 14. Legacy Data and Backfill Policy

**[VERIFIED/RECOMMENDED]**

| Fact | Classification | Reasoning |
|---|---|---|
| Pre-migration-0046 `movedAt` | **NOT RECOVERABLE** | Never backfilled by explicit migration-0046 policy; chain length remains derivable, the per-hop instant does not |
| Pre-PR2 `scheduledWeekStart`/`scheduledWeekTimezone` | **NOT RECOVERABLE** (if the occurrence's Plan is also since deleted) / **DERIVABLE WITH LIMITATIONS** (if the Plan still exists — live re-derivation from `plannedStartAt` + current timezone is used, which is the function's own documented fallback, not a backfill) | `resolveOccurrenceLocalDateOrNull`'s own three-way branch IS the policy; re-confirmed, not proposed |
| CANCELLED plans with no dedicated timestamp, already hard-deleted | **NOT RECOVERABLE** | No independent record exists anywhere; `updatedAt` is already gone with the row |
| `HabitLog` rows whose originating Plan is since deleted | **EXACT** | The `HabitLog` row itself is complete and untouched — nothing to backfill, it already has everything (§7) |
| Any future generic event log's own "legacy" rows | **NOT RECOVERABLE** (N/A — no implementation is authorized) | Explicitly flagged: never manufacture event timestamps from `updatedAt`/`createdAt` without proving their meaning; never invent a Move/completion/Skip action for a legacy row that has no corresponding durable fact |

**Recommended explicit historical-coverage boundary, if the §7 reader fix is ever implemented**: state plainly, in the reporting response's own `limitations` array (the same mechanism PR4 already established for the "range predates account creation" case), that `confirmedCompleted` reflects `HabitLog`-durable evidence only from the point `logSource='AURA_PLANNED'` rows have existed — i.e., effectively since this completion path itself shipped, which is the entire production history of this feature, so in practice no explicit boundary disclaimer is even needed beyond what `insightsReporting.ts` already discloses.

---

## 15. Transaction/Concurrency Risks

**[VERIFIED]** For the one real recommended change (§7's reader fix): **zero** new transaction or concurrency risk — it is a pure, additional read-only `SELECT` against `HabitLog`, requiring no lock, no transaction boundary beyond what `GET /api/insights/reporting` already has (none — it is a read endpoint).

For the NOT-recommended Option C (generic event log), the risks the ticket itself anticipates are real and would materialize: every one of Plan acceptance / Move / Complete / Skip / Delete / Goal completion / Goal deletion would need a NEW write inside its EXISTING transaction (atomicity is non-negotiable per the ticket's own instruction: "No asynchronous best-effort history that can silently diverge") — this is exactly the `goal-evidence`/`day-constructor-accept` advisory-lock discipline already established, so it is technically achievable, but it is **unjustified complexity for a capability no finding in this audit demonstrates is needed**.

---

## 16. Performance Considerations

**[VERIFIED/RECOMMENDED]** For §7's reader fix specifically: `HabitLog` already has `@@index([userId, logTimestamp])` (schema.prisma:324) — the exact index shape a bounded-date-range, `userId`-scoped query needs. **Zero new index required.** The additional query is one more bounded, indexed `SELECT` per `GET /api/insights/reporting` call — the same cost class as every other query that endpoint already runs, no N+1 risk (one query, not one per plan). No pagination concern — this is a count aggregation, not an item list (matching PR4's own established `AWAITING_CONFIRMATION_ITEM_LIMIT` precedent if item-level detail were ever needed instead of just a count).

---

## 17. Real-DB Test Matrix

**[RECOMMENDED]**, mapped against the ticket's own 26-scenario list — noting which already have real-DB coverage in this codebase's EXISTING test suites (re-verified, not assumed) versus which would be net-new if §7's fix were implemented:

| # | Scenario | Existing coverage | If §7 implemented |
|---|---|---|---|
| 1-2 | Plan creation / acceptance | `dayConstructorAcceptancePersistenceDb.test.ts` (existing) | Unaffected |
| 3-6 | Single/multiple/cross-week Move, timezone change | `movePlannedActivityDb.test.ts`, `insightsReportingDb.test.ts` (existing, re-run clean in PR5's own final review) | Unaffected |
| 7-8 | Explicit Skip/Cancel | Covered implicitly by existing planning-status tests; a dedicated CANCEL-timestamp-gap regression does not yet exist | New test needed only if §13's sketch is ever implemented |
| 9-11 | Confirmed/partial/over-target completion | `goalActivityExecutionOccurrenceLinkDb.test.ts` (existing, 22 scenarios, re-run clean in PR5's final review) | Unaffected |
| 12-13 | Duplicate/concurrent Done | Covered (`logPlannedActivity`'s idempotent-retry path; concurrency re-confirmed in `movePlannedActivityDb.test.ts`'s own "concurrent Move" scenario, analogous discipline) | Unaffected |
| 14-15 | Deleted completed Goal-linked plan / **non-Goal-linked plan** | #14 covered (`goalActivityExecutionOccurrenceLinkDb.test.ts`); **#15 is new** — no existing test proves a `HabitLog` row survives and is (or currently is not) counted after its Plan is deleted | **New test required**: create a non-Goal plan, log it, delete it, assert the `HabitLog` row still exists with correct fields, assert current reporting EXCLUDES it (documenting the gap) or INCLUDES it (if fixed) |
| 16 | Deleted Move source | Structurally impossible, already regression-tested (PR5's own scenario 6 analog for Move chains; direct equivalent exists in Move test suites) | Unaffected |
| 17 | Goal deletion | `goalActivityExecutionOccurrenceLinkDb.test.ts` scenario 22 (existing) | Unaffected |
| 18-19 | Legacy NULL execution link / `movedAt` | Both covered (PR3/PR5 test suites) | Unaffected |
| 20 | Unconfirmed past plan | Covered (`insightsReportingDb.test.ts` scenario 7) | Unaffected |
| 21 | Derived MISSED | Covered by the same scenario (never persisted, re-derived on read) | Unaffected |
| 22 | User isolation | Covered throughout every existing real-DB suite | A new §7 query must be scoped `WHERE userId = $1` identically |
| 23 | No fabricated history | Covered by every existing suite's own explicit "never guess" assertions | The new query must never infer a deleted-plan's identity beyond what `HabitLog` itself states |
| 24 | Transaction rollback | Covered (PR3's own "20. an invalid actualValue rejects the whole completion attempt" scenario) | Unaffected — read-only |
| 25 | Read-only reporting | Covered (PR4/PR5's own explicit zero-write-side-effect scenarios) | The new query must also prove zero writes |
| 26 | Bounded query performance | Not explicitly benchmarked in any existing suite (informal only) | **RECOMMENDED but not currently tested anywhere** — a genuine, pre-existing gap in this codebase's own test discipline, independent of PR6 |

---

## 18. Product Decisions Required

**[UNRESOLVED — requires explicit product sign-off, not an engineering call]**

1. **Is the §7 undercounting gap worth fixing at all**, given its narrow materiality (only affects a user who both completes AND explicitly hard-deletes a non-Goal-linked plan within the same reporting window)? **Recommend yes** — it is cheap (§15-16) and the evidence already exists; declining fixes nothing and costs nothing to defer.
2. **Should the CANCEL-timestamp gap (§8) be closed?** No current feature needs it. **Recommend deferring** until a specific feature demonstrably needs "when was this cancelled."
3. **Should a historical-correction flow (§11.5) be built?** This is the one genuine open product question. **Recommend explicit scoping in a future, separate ticket** — it touches already-reported numbers and needs its own decision on whether corrections should be visible/audited or silent, which this audit cannot resolve unilaterally.
4. **Is a generic event log actually necessary?** **No** — directly answered by every section above. Reject.
5. **What is the smallest implementation that works?** For §7: one additive, read-only query against an already-existing, already-indexed, already-durable table. No migration.
6. **Is historical backfill safe?** Not applicable — no implementation requires one.
7. **Does this belong in Insights V1 or a later phase?** The §7 fix is small enough to belong in V1 if authorized; capabilities 1-4 of §11 are UI features that could ship independently, in any phase, without further evidence work; capability 5 (correction) belongs in a later, explicitly-scoped phase.
8. **Would PR6 add meaningful assistance, or only infrastructure?** **If scoped to §7 alone: meaningful, narrow assistance** (a real reporting-accuracy fix). **If scoped any wider (a new event log): infrastructure only, with no demonstrated capability it unlocks that existing evidence does not already support.**

---

## 19. Recommended PR6 Scope

**[RECOMMENDED]**

**Smallest justified scope**: extend `listPlannedActivitiesForReporting`'s own composition (or add one small, additive, read-only `HabitLog`-sourced count) so `confirmedCompleted` also reflects non-Goal-linked plans whose originating `PlannedActivity` row has since been hard-deleted, sourced from the already-durable, already-indexed `HabitLog` table, with zero new schema.

**Equally valid, and arguably the more disciplined choice given this gap's narrow materiality (§7, §18.1): NO IMPLEMENTATION.** This audit does not find a user-facing capability currently blocked badly enough to require immediate action — every other candidate capability (§11) already has its evidence; the one real gap is a minor undercount in one specific, narrow intersection of actions.

---

## 20. Explicit STOP Conditions

- **STOP** if any future ticket proposes a generic, typed-payload, append-only domain event log without first demonstrating a SPECIFIC capability that the existing `HabitLog`/`GoalActivityExecution`/Move-chain/`DailyReflection` evidence genuinely cannot support — this audit found none.
- **STOP** if any future ticket proposes backfilling `movedAt`, `scheduledWeekStart`, or a CANCEL timestamp from `updatedAt`/`createdAt` for legacy rows — this fabricates history this audit explicitly found is not recoverable.
- **STOP** if a §7-style reader fix is ever implemented and its own test suite does not include real-DB scenario #15 (§17) — proving the undercounting gap is actually closed, not merely asserted closed.
- **STOP** before building any "historical correction" flow (§11.5) without an explicit, separate, product-approved decision on whether corrections are visible/audited or silent.

---

## FINAL VERDICT

```
AURA — INSIGHTS V1 PR6 —
ARCHITECTURE READY
```

**With the explicit recommendation that the justified scope is narrow (§19's Option A reader fix, or NO IMPLEMENTATION at all) — not a new event history of any kind.** This audit's own product principle #7 ("Avoid redundant data models") and the ticket's own explicit instruction ("A generic event log must not be approved merely because event sourcing is architecturally attractive") are both directly honored: every lifecycle action this codebase performs already has durable, correctly-scoped evidence, with exactly one narrow, already-evidenced, reader-only gap.
