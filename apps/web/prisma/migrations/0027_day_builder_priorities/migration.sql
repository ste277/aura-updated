-- Personalization Foundation V1 -- lightweight, explicit, user-controlled
-- priorities that influence Day Builder's candidate ORDERING only. Never a
-- new taxonomy: dayBuilderPriorities stores UserPriorityGroup values (a
-- small presentation-layer enum defined in dayBuilder.ts that maps onto
-- the EXISTING DailyIntentionGroupId groups), and dayBuilderPriorityPersonIds
-- stores existing SavedPerson ids -- no new activity/person model.
--
-- dayBuilderPrioritiesPromptDismissed is separate from "has priorities"
-- (an empty dayBuilderPriorities array is a fully valid, permanent state,
-- brief section 2: "No preference selected must remain a valid state") --
-- it only tracks whether the one-time "What matters most lately?" prompt
-- should stop showing on Home after an explicit "Maybe later".
ALTER TABLE "User" ADD COLUMN "dayBuilderPriorities" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "User" ADD COLUMN "dayBuilderPriorityPersonIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "User" ADD COLUMN "dayBuilderPrioritiesPromptDismissed" BOOLEAN NOT NULL DEFAULT false;
