-- Product Structure V2: generalize AuraMoment creation beyond Muhurtham
-- Finder. Every AuraMoment now records WHERE the selected timing came from
-- -- Plan's own Find/Check/Compare + everyday shared timing, or Muhurtham
-- Finder's GENERAL/PERSONAL/SHARED occasion search -- so analytics and any
-- future source-specific behavior never have to guess.
--
-- DEFAULT 'MUHURTHAM' on the existing column: every AuraMoment row created
-- before this migration came from Muhurtham Finder (it was, until this PR,
-- the only caller of POST /api/aura-moments) -- so backfilling existing
-- rows to 'MUHURTHAM' is not a guess, it's simply true.
ALTER TABLE "AuraMoment" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MUHURTHAM';

-- Drop the default once existing rows are backfilled -- new INSERTs must
-- always specify source explicitly (db.ts's createAuraMoment requires it),
-- the same convention every other AuraMoment column follows.
ALTER TABLE "AuraMoment" ALTER COLUMN "source" DROP DEFAULT;
