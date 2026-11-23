-- AURA-MR1 (My Rhythm Foundation): optional pause state and scheduling
-- preferences for a weekly Goal Rhythm, stored directly on "GoalActivity"
-- beside the existing weekly policy (migration 0043). There is still no
-- separate rhythm table and no pre-generated sessions; sessions are created
-- only when the user accepts them, exactly as before.
--
-- ADDITIVE ONLY. No existing column is altered or dropped, no row is
-- updated, nothing is backfilled. Every existing row ends up with
-- "rhythmPausedAt" = NULL, "rhythmPreferredWeekdays" = '{}',
-- "rhythmPreferredTimeOfDay" = NULL and "rhythmPreferredDurationMinutes" =
-- NULL, which together mean "active, no preferences" -- byte-for-byte the
-- behavior every rhythm had before this migration.
--
-- NULL / DEFAULT SEMANTICS (canonical domain: apps/web/lib/goalActivityRhythmPreferences.ts):
--   "rhythmPausedAt"                 NULL = active; non-NULL = paused at that
--                                    instant (no new rhythm sessions may be
--                                    recommended or created). Never set by a
--                                    default.
--   "rhythmPreferredWeekdays"        '{}' = no weekday preference (any day).
--                                    Otherwise distinct civil weekdays,
--                                    0 = Sunday .. 6 = Saturday, stored
--                                    sorted -- the same encoding and the same
--                                    NOT NULL DEFAULT '{}' convention as
--                                    "User"."dailyRhythmWorkDays" (0050).
--                                    The constant default is a catalog-only
--                                    change on PostgreSQL 11+ (no table
--                                    rewrite).
--   "rhythmPreferredTimeOfDay"       NULL = any time of day. Otherwise one of
--                                    MORNING | AFTERNOON | EVENING | NIGHT --
--                                    the timing engine's own existing
--                                    preference vocabulary.
--   "rhythmPreferredDurationMinutes" NULL = the activity's existing default
--                                    duration. Otherwise a whole number of
--                                    minutes, 15..360 (the timing engine's
--                                    own supported range).
--
-- Values are validated in the application layer (same convention as 0040,
-- 0043 and 0051); no CHECK constraints are added.
ALTER TABLE "GoalActivity"
  ADD COLUMN "rhythmPausedAt" TIMESTAMPTZ(3),
  ADD COLUMN "rhythmPreferredWeekdays" INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN "rhythmPreferredTimeOfDay" TEXT,
  ADD COLUMN "rhythmPreferredDurationMinutes" INTEGER;
