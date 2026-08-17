-- The app reads and writes HabitLog.notes (lib/db.ts listHabitLogs/insert),
-- and schema.prisma declares it, but no migration ever created the column —
-- 0009 only added durationMinutes. Without this, a database built from the
-- migrations errors on the very first habit-log read.
-- IF NOT EXISTS keeps this safe on databases where the column was already
-- added by hand while the migration was missing.
ALTER TABLE "HabitLog"
  ADD COLUMN IF NOT EXISTS notes TEXT;
