import { getDatePartsInTimezone } from './timezone';

/**
 * Pending Activity My Day Visibility V1 -- presentation composition only.
 * This module never calls buildDailyAgenda/buildDailyStory, never
 * recomputes completedCount/plannedCount/nextItem, never reads
 * localStorage, and never touches the DB/API. Its one job is turning
 * "which of today's logEntries are still pending" into the small,
 * display-only shape Your Day Timeline needs -- the canonical server
 * DailyAgenda (myDay.agenda) is composed alongside this at the render
 * boundary, never mutated by it.
 *
 * A pending direct-logged activity is never matched to a PlannedActivity
 * here (no title/timestamp/activityId matching to a Plan) -- Plan
 * logging (logPlannedActivity) has no offline/pending path at all, so a
 * locally pending HabitLog can never legitimately correspond to a
 * specific Plan's own completion. It is always presented as its own,
 * separate pending row.
 */

/**
 * A structural subset of LoggedEntryItem (CalendarViewSection.tsx) --
 * deliberately NOT importing that type directly. LoggedEntryItem's
 * canonical home is a .tsx file; this module has no other reason to
 * depend on JSX-aware type resolution, and the real page.tsx logEntries
 * array (which carries every field below, plus more) is assignable here
 * without any cast -- TypeScript's structural typing means this is the
 * exact same runtime data, just named by the narrower shape this file
 * actually reads. Kept in sync by hand with LoggedEntryItem's own
 * pending-relevant fields (a handful of stable, rarely-changed literals),
 * not duplicated wholesale.
 */
export interface LoggedEntryLike {
  id: string;
  activityTitle: string;
  activeWindow: string;
  loggedAt: Date;
  syncStatus?: 'pending';
  clientRequestId?: string;
  durationMinutes?: number;
  notes?: string | null;
  logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION';
  activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH';
}

/** Deliberately narrow: only what Your Day Timeline's pending row
 * actually renders (title, time, and enough metadata to be useful) --
 * not a general-purpose copy of LoggedEntryItem, and never an
 * activityId (QueuedHabitLog/LoggedEntryItem don't carry one; the same
 * activityTitle-based icon lookup habitLogToAgendaItem already uses
 * would apply equally here if an icon were ever added). */
export interface PendingActivityPresentationItem {
  id: string;
  clientRequestId: string;
  activityTitle: string;
  loggedAt: Date;
  durationMinutes?: number;
  notes?: string | null;
  logSource?: LoggedEntryLike['logSource'];
  activeWindow: string;
  activitySignificance?: LoggedEntryLike['activitySignificance'];
}

/**
 * Selects today's still-pending logEntries and maps them to the small
 * presentation shape above. "Today" uses the exact same Timing-Location
 * timezone semantics My Day itself already uses server-side
 * (getDatePartsInTimezone) and page.tsx already uses for
 * loggedActivitiesToday -- never browser-local, never UTC, never a
 * second definition of "today".
 *
 * Deduplication against confirmation is NOT reimplemented here: PR #91's
 * mergeConfirmedLogEntries already guarantees a logEntries row with
 * syncStatus === 'pending' has not yet been confirmed and is still
 * genuinely queued (or, for a live in-session entry, still mid-flight) --
 * this function only filters by that flag and by day, nothing more.
 */
export function selectTodaysPendingActivities(
  logEntries: LoggedEntryLike[],
  timezone: string,
  todayDateStr: string
): PendingActivityPresentationItem[] {
  if (!todayDateStr) return [];
  return logEntries
    .filter((entry): entry is LoggedEntryLike & { clientRequestId: string } =>
      entry.syncStatus === 'pending' &&
      Boolean(entry.clientRequestId) &&
      getDatePartsInTimezone(timezone, new Date(entry.loggedAt)).dateStr === todayDateStr
    )
    .map((entry) => ({
      id: entry.id,
      clientRequestId: entry.clientRequestId,
      activityTitle: entry.activityTitle,
      loggedAt: entry.loggedAt,
      durationMinutes: entry.durationMinutes,
      notes: entry.notes,
      logSource: entry.logSource,
      activeWindow: entry.activeWindow,
      activitySignificance: entry.activitySignificance,
    }))
    .sort((a, b) => b.loggedAt.getTime() - a.loggedAt.getTime());
}
