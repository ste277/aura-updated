/**
 * Home/Timeline Pending Replay Reconciliation V1 -- presentation
 * reconciliation only. This module never touches the offline queue
 * (localStorage['offline_habit_queue']), never POSTs, and never calls
 * loadUserDataAndLogs/loadMyDay itself. Its one job is answering "has THIS
 * locally-remembered pending activity since resolved?" against whatever
 * logEntries already is on a given render -- logEntries is already kept
 * current by loadUserDataAndLogs/mergeConfirmedLogEntries after every
 * replay attempt (apps/web/app/page.tsx's own syncOfflineLogs effect); a
 * caller (Timeline's per-card badge, Home's GoodRightNowCard) just needs
 * to react to it changing, not learn any new refresh mechanism.
 */

/**
 * A structural subset of LoggedEntryItem (CalendarViewSection.tsx) --
 * deliberately NOT imported here, same reasoning as myDayPendingOverlay.ts's
 * own LoggedEntryLike: LoggedEntryItem's canonical home is a .tsx file, and
 * this module has no other reason to depend on JSX-aware type resolution.
 * The real logEntries array (a superset of these two fields) is assignable
 * here without a cast.
 */
export interface SyncStatusEntry {
  activityTitle: string;
  syncStatus?: 'pending';
}

/**
 * Identity here is the same normalized-activityTitle key Timeline.tsx's
 * own allLoggedNormalized and HomeDashboard.tsx's own
 * loggedActivitiesToday-driven isLogged check already use for every other
 * "is this activity already logged/pending" decision in those two files --
 * deliberately not a new identity model, and deliberately not
 * clientRequestId: neither card's own click handler ever learns the
 * clientRequestId handleLogActivity generates (its resolved value is just
 * 'confirmed' | 'pending', pinned unchanged by
 * pendingActivityVisualConsistency.test.ts and
 * pendingActivityReloadVisibility.test.ts), so title is the only identity
 * already available at both the call site and here.
 *
 * 'confirmed' -- a logEntries row with this exact title exists and is no
 *   longer syncStatus 'pending' (the server now has it).
 * 'pending' -- a logEntries row with this title is still syncStatus
 *   'pending' (still queued, or still mid-flight) and none has confirmed.
 * 'gone' -- no logEntries row has this title at all. This is the
 *   permanent-failure case: mergeConfirmedLogEntries (offlineHabitQueue.ts)
 *   already drops a pending row once it's no longer in the live offline
 *   queue and never became confirmed (PR #86/#91's own invariant) -- a
 *   caller sees this as "stop showing pending," never as "show confirmed."
 */
export function resolvePendingActivityStatus(
  logEntries: SyncStatusEntry[],
  normalizedActivityTitle: string
): 'pending' | 'confirmed' | 'gone' {
  const matches = logEntries.filter(
    (entry) => entry.activityTitle.trim().toLowerCase() === normalizedActivityTitle
  );
  if (matches.length === 0) return 'gone';
  return matches.some((entry) => entry.syncStatus !== 'pending') ? 'confirmed' : 'pending';
}
