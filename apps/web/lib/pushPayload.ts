import type { AuraReminder } from './auraReminders';
import type { AuraMoment } from './db';
import { getActivityDefinition } from '../../../packages/recommendation/src/activityDefinitions';

/**
 * Web Push V1 -- builds the safe, minimal notification DTO (brief section
 * 12) from an already-derived AuraReminder plus (for Moments only) the raw
 * AuraMoment row, which is where the catalog activityId actually lives --
 * AuraReminder itself never carries activityId (brief section 11 kept it
 * off the client DTO), so ceremonial-vs-everyday copy can only be decided
 * here, with the row the delivery service already has in hand.
 *
 * PLANNED_ACTIVITY reminders have NO catalog link at all (audited:
 * PlannedActivity has no activityId column, only free-text activityType --
 * the same limitation Aura Reminders V1's dedup linkage already
 * documented) -- so a Plan reminder's body is always the same restrained,
 * generic copy. This is an accepted V1 limitation, not an oversight.
 *
 * Never includes: birth data, natal context, SavedPerson ids/details,
 * Muhurta reasons, Aura Fit internals, the public Moment token, or the
 * participant's display name in the notification body (brief section 12/33
 * -- the brief's own worked examples never name the participant either;
 * followed literally rather than assumed safe by extension).
 */

export interface PushNotificationPayload {
  title: string;
  body: string;
  target: AuraReminder['target'];
  scheduledItemType: AuraReminder['scheduledItemType'];
  scheduledItemId: string;
  reminderAt: string;
}

function leadMinutesFor(reminder: AuraReminder): number {
  return Math.max(0, Math.round((new Date(reminder.startAt).getTime() - new Date(reminder.reminderAt).getTime()) / 60_000));
}

function baseFields(reminder: AuraReminder) {
  return {
    target: reminder.target,
    scheduledItemType: reminder.scheduledItemType,
    scheduledItemId: reminder.scheduledItemId,
    reminderAt: reminder.reminderAt,
  };
}

/** PLAN_APPROACHING copy (brief section 13) -- one restrained, generic
 * body for every Plan (see the module doc comment for why: no catalog
 * link exists to personalize it further). */
export function buildPlanPushPayload(reminder: AuraReminder): PushNotificationPayload {
  const icon = reminder.activityIcon ?? '🔔';
  const lead = leadMinutesFor(reminder);
  return {
    title: `${icon} ${reminder.activityTitle} starts in ${lead} min`,
    body: 'Your planned activity is coming up.',
    ...baseFields(reminder),
  };
}

/** MOMENT_APPROACHING copy (brief section 14/15) -- response-aware for
 * SHARED moments, restrained for a CEREMONIAL/Muhurtham occasion (checked
 * via the moment's own activityId -> ActivityDefinition.planningMode,
 * never inferred from title text), generic for GENERAL/PERSONAL. */
export function buildMomentPushPayload(reminder: AuraReminder, moment: AuraMoment): PushNotificationPayload {
  const icon = reminder.activityIcon ?? '❤️';
  const lead = leadMinutesFor(reminder);
  const planningMode = getActivityDefinition(moment.activityId)?.experience.planningMode;

  let body: string;
  if (planningMode === 'CEREMONIAL') {
    body = 'Your selected Muhurtham is coming up.';
  } else if (reminder.momentResponseState === 'ACCEPTED') {
    body = "You're both in.";
  } else if (moment.scope === 'SHARED') {
    body = 'Your shared moment is coming up.';
  } else {
    body = 'Your Aura Moment is coming up.';
  }

  return {
    title: `${icon} ${reminder.activityTitle} starts in ${lead} min`,
    body,
    ...baseFields(reminder),
  };
}
