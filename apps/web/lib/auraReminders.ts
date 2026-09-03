import type { AuraMoment, AuraMomentResponseState, PlannedActivity } from './db';

/**
 * Aura Reminders V1 -- time-based reminders for PlannedActivity and
 * AuraMoment (brief: "Aura should not stop after helping the user choose a
 * time. It should stay with the user until the activity happens.").
 *
 * Deliberately DERIVED, not stored, matching Aura Updates V1's own
 * "derive, don't persist" pattern (lib/auraUpdates.ts): the audit (brief
 * section 1) found neither PlannedActivity nor AuraMoment has any existing
 * reminder field, and a generic notifications table is not needed -- every
 * field an AuraReminder needs is already on one of those two rows (plus the
 * one small `plannedActivityId` dedup linkage migration 0021 added).
 *
 * This module computes ELIGIBILITY (which reminders are active right now)
 * and DATA (what to show), never DELIVERY. It deliberately does not know
 * about Web Push, Bell badges, or Home cards -- callers combine this output
 * with those concerns (brief section 3: "Do not conflate reminder
 * calculation with delivery"). A future push-delivery worker can call
 * deriveAuraReminders() with its own `now` and reuse these exact eligibility
 * rules without reimplementing them (brief section 28).
 */

export type AuraReminderType = 'PLAN_APPROACHING' | 'MOMENT_APPROACHING';
export type AuraReminderScheduledItemType = 'PLANNED_ACTIVITY' | 'AURA_MOMENT';

export interface AuraReminder {
  /** `${scheduledItemType}:${scheduledItemId}` -- stable and unique without
   * a separate id space, same convention AuraUpdate.id (momentToken) uses. */
  id: string;
  type: AuraReminderType;
  scheduledItemType: AuraReminderScheduledItemType;
  scheduledItemId: string;
  activityTitle: string;
  activityIcon: string | null;
  startAt: string; // ISO instant
  endAt: string; // ISO instant
  /** Display timezone (brief section 3) -- the item's own timezone for a
   * Moment, the owner's profile timezone for a Plan (PlannedActivity has no
   * timezone column of its own). Never used for the reminderAt/startAt math
   * itself, which is always absolute-instant arithmetic. */
  timezone: string;
  reminderAt: string; // ISO instant -- startAt minus the lead time
  /** Signed minutes until start, computed against the `now` deriveAuraReminders
   * was called with -- negative once the item has started. Display copy
   * ("Starts in X min" / "Starting now" / "Started X min ago") is a
   * presentation concern for callers, not computed here. */
  minutesUntilStart: number;
  target:
    | { type: 'PLAN'; planId: string }
    | { type: 'MOMENT'; momentToken: string };
  /** SHARED-scope Moments only (brief section 10: GENERAL/PERSONAL never get
   * participant copy). Absent for Plans entirely. */
  participantDisplayName?: string;
  /** Present only for MOMENT_APPROACHING. ANOTHER_TIME never reaches this
   * type (see deriveAuraReminders' own filter) -- the actionable Aura
   * Update takes priority instead (brief section 9), so this is effectively
   * 'ACCEPTED' | null in practice, typed against the full domain vocabulary
   * for forward compatibility. */
  momentResponseState?: AuraMomentResponseState | null;
}

/** Brief section 3: default reminder fires 15 minutes before start. */
export const DEFAULT_REMINDER_LEAD_MINUTES = 15;

/** Brief section 4: "must not stay active permanently... after a grace
 * period remove from active Upcoming... audit existing behavior to choose
 * the grace period." No existing precedent for this exists elsewhere in the
 * app (Window Alerts fires a one-shot native alert, it has no analogous
 * "still showing" window) -- 30 minutes past start is a deliberately chosen
 * constant, generous enough to cover "I'm running a few minutes behind"
 * without a reminder still claiming something is "starting soon" an hour
 * later. Named here, not scattered as a magic number. */
export const REMINDER_GRACE_PERIOD_MINUTES = 30;

/** The widest lead time the reminder preference domain supports (brief
 * section 14: OFF/10/15/30/60) -- bounds how far into the future
 * listPlannedActivitiesForReminders/listAuraMomentsForReminders need to
 * query (brief section 25). */
export const MAX_REMINDER_LEAD_MINUTES = 60;

function minutesBetween(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 60_000);
}

function isReminderWindowActive(now: Date, reminderAt: Date, startAt: Date): boolean {
  const relevantExpiry = new Date(startAt.getTime() + REMINDER_GRACE_PERIOD_MINUTES * 60_000);
  return now.getTime() >= reminderAt.getTime() && now.getTime() < relevantExpiry.getTime();
}

export interface DeriveAuraRemindersInput {
  /** Explicit, injected "now" (brief section 24) -- never `new Date()`
   * called internally, so this function is deterministic and testable. */
  now: Date;
  /** The owner's reminder lead time in minutes (brief section 3/14). */
  leadMinutes: number;
  /** The owner's own profile timezone -- used as the display timezone for
   * Plan reminders only (PlannedActivity has no timezone column). */
  ownerTimezone: string;
  /** Must already be scoped to this owner and bounded to a plausible
   * reminder window (see listPlannedActivitiesForReminders). */
  plans: PlannedActivity[];
  /** Must already be scoped to this owner, ACTIVE, unexpired, and bounded
   * to a plausible reminder window (see listAuraMomentsForReminders). */
  moments: AuraMoment[];
  /** Moment ids that HAVE been superseded by a successor (brief section 8)
   * -- i.e. ids that appear as some OTHER moment's previousMomentId. See
   * listMomentIdsWithSuccessorForOwner, already used by Aura Updates V1. */
  momentIdsWithSuccessor: Set<string>;
}

/**
 * Pure, deterministic reminder derivation. Callers are responsible for
 * pre-scoping `plans`/`moments` to one owner and a bounded time window
 * (brief section 25) -- this function applies no ownership or query-bound
 * filtering of its own, only eligibility/lifecycle rules and shaping.
 */
export function deriveAuraReminders({
  now,
  leadMinutes,
  ownerTimezone,
  plans,
  moments,
  momentIdsWithSuccessor,
}: DeriveAuraRemindersInput): AuraReminder[] {
  // Dedup (brief section 7): a Plan that already has a Moment linked to it
  // (AuraMoment.plannedActivityId) never generates its own reminder -- the
  // Moment's reminder wins, since it can show response/participant state
  // the Plan alone cannot ("Prefer Moment where it contains richer
  // coordination state").
  const linkedPlanIds = new Set(
    moments.map((moment) => moment.plannedActivityId).filter((id): id is string => Boolean(id))
  );

  const planReminders: AuraReminder[] = plans
    .filter((plan) => plan.status === 'UPCOMING' && !linkedPlanIds.has(plan.id))
    .map((plan) => {
      const startAt = new Date(plan.plannedStartAt);
      const reminderAt = new Date(startAt.getTime() - leadMinutes * 60_000);
      return { plan, startAt, reminderAt };
    })
    .filter(({ startAt, reminderAt }) => isReminderWindowActive(now, reminderAt, startAt))
    .map(({ plan, startAt, reminderAt }) => ({
      id: `PLANNED_ACTIVITY:${plan.id}`,
      type: 'PLAN_APPROACHING' as const,
      scheduledItemType: 'PLANNED_ACTIVITY' as const,
      scheduledItemId: plan.id,
      activityTitle: plan.title,
      activityIcon: plan.icon,
      startAt: startAt.toISOString(),
      endAt: new Date(plan.plannedEndAt).toISOString(),
      // Event Location Plan Persistence V1: a plan that snapshotted a
      // custom Event Location displays/speaks in ITS OWN timezone, never
      // the viewing owner's current Timing Location -- this doc comment's
      // own type (see `timezone` field above) already anticipated this
      // exact gap ("PlannedActivity has no timezone column of its own");
      // it now does, for the plans that used one. The reminderAt/startAt
      // trigger math above is untouched -- only which timezone the
      // eventual notification TEXT is formatted in changes.
      timezone: plan.eventTimezone ?? ownerTimezone,
      reminderAt: reminderAt.toISOString(),
      minutesUntilStart: minutesBetween(startAt, now),
      target: { type: 'PLAN' as const, planId: plan.id },
    }));

  // Moment lifecycle rules (brief section 8/9):
  //   - REVOKED / expired: excluded (the DB query already filters these for
  //     the normal caller, but this function re-checks so it stays correct
  //     for any caller, e.g. tests, that hands it unfiltered rows).
  //   - Superseded by a successor: the ORIGINAL never reminds again -- its
  //     successor (a separate AuraMoment row with its own startAt) reminds
  //     at ITS OWN time instead, with no special-casing needed here.
  //   - ANOTHER_TIME with no successor yet: do NOT remind as if agreed --
  //     the existing actionable "wants another time" Aura Update already
  //     covers this, a reminder here would contradict it.
  const momentReminders: AuraReminder[] = moments
    .filter((moment) => {
      if (moment.status !== 'ACTIVE') return false;
      if (moment.expiresAt && new Date(moment.expiresAt).getTime() <= now.getTime()) return false;
      if (momentIdsWithSuccessor.has(moment.id)) return false;
      if (moment.responseState === 'ANOTHER_TIME') return false;
      return true;
    })
    .map((moment) => {
      const startAt = new Date(moment.startAt);
      const reminderAt = new Date(startAt.getTime() - leadMinutes * 60_000);
      return { moment, startAt, reminderAt };
    })
    .filter(({ startAt, reminderAt }) => isReminderWindowActive(now, reminderAt, startAt))
    .map(({ moment, startAt, reminderAt }) => ({
      id: `AURA_MOMENT:${moment.id}`,
      type: 'MOMENT_APPROACHING' as const,
      scheduledItemType: 'AURA_MOMENT' as const,
      scheduledItemId: moment.id,
      activityTitle: moment.activityTitle,
      activityIcon: moment.activityIcon,
      startAt: startAt.toISOString(),
      endAt: new Date(moment.endAt).toISOString(),
      timezone: moment.timezone,
      reminderAt: reminderAt.toISOString(),
      minutesUntilStart: minutesBetween(startAt, now),
      target: { type: 'MOMENT' as const, momentToken: moment.publicToken },
      // Section 10: only a SHARED moment ever has a named participant --
      // GENERAL/PERSONAL moments get no participant copy at all.
      participantDisplayName: moment.scope === 'SHARED' ? moment.sharedPersonDisplayName ?? undefined : undefined,
      momentResponseState: moment.responseState,
    }));

  // Deterministic ordering: most imminent first, ties broken by id so the
  // result never depends on incoming array order (brief section 41's
  // "deterministic most-imminent choice" test).
  return [...planReminders, ...momentReminders].sort(
    (a, b) => a.minutesUntilStart - b.minutesUntilStart || a.id.localeCompare(b.id)
  );
}

/** Presentation helper shared by Home's Starting Soon card and the Updates
 * screen's Upcoming section, so the two surfaces can never phrase the same
 * reminder differently. Pure formatting only -- no new calculation (brief
 * section 4/20's "before start show X, after start show Y"). */
export function formatReminderTiming(minutesUntilStart: number): string {
  if (minutesUntilStart > 0) return `Starts in ${minutesUntilStart} min`;
  if (minutesUntilStart === 0) return 'Starting now';
  return `Started ${Math.abs(minutesUntilStart)} min ago`;
}
