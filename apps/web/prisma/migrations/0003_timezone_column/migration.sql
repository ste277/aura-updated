ALTER TABLE "User" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- Best-effort backfill for existing rows from their old fixed offset. India-only
-- rows (offset 330) map cleanly since India has no DST; anything else defaults to
-- Asia/Kolkata and should be corrected by the user re-selecting their location.
UPDATE "User" SET "timezone" = 'Asia/Kolkata' WHERE "tzOffsetMinutes" = 330;

ALTER TABLE "User" DROP COLUMN "tzOffsetMinutes";
