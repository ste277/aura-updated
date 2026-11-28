-- AURA-MP-4 (62025) -- Relationship Rhythms: a Life Rhythm (GoalActivity)
-- may be linked to one of the owner's saved people.
--
-- Additive only. Every existing GoalActivity keeps savedPersonId = NULL (no
-- backfill, no automatic association); a NULL link is never checked by the
-- foreign key below.
--
-- Same-account at the DATABASE level, the MP-1 PersonOccasion pattern: the
-- composite key (savedPersonId, userId) must match SavedPerson(id,
-- ownerUserId) (unique since 0056), so a rhythm can never point at another
-- user's person, whatever the writer.
--
-- ON DELETE is the default NO ACTION, deliberately not SET NULL: deleting a
-- person must also PAUSE its linked rhythms (design D7), which only the
-- application's person-deletion transaction does, in the same transaction
-- (deleteSavedPerson clears the link and pauses first). NO ACTION turns any
-- other person deletion that would leave a rhythm linked into an error
-- rather than a silently running, unlinked rhythm. (It also needs no
-- column-list SET NULL, so it is independent of the PostgreSQL version.)
-- Account deletion is unaffected: User -> SavedPerson and User ->
-- GoalActivity both cascade within one statement.
ALTER TABLE "GoalActivity" ADD COLUMN "savedPersonId" TEXT;

ALTER TABLE "GoalActivity" ADD CONSTRAINT "GoalActivity_person_owner_fkey"
  FOREIGN KEY ("savedPersonId", "userId") REFERENCES "SavedPerson"(id, "ownerUserId");

-- Relationship lookup (a person's rhythms) and the person-deletion path /
-- foreign-key check. Only linked rows are indexed.
CREATE INDEX "GoalActivity_savedPersonId_idx" ON "GoalActivity" ("savedPersonId") WHERE "savedPersonId" IS NOT NULL;
