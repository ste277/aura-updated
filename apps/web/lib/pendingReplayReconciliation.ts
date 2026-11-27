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

// ------------------------------------------------------------------ AURA-ANDROID-REL-04 R15 (39256 option B)
/**
 * R15 -- the ID-KEYED UI projection of activity operations. `resolvePendingActivityStatus` above infers an outcome
 * from a title in a list; that is no longer used to RELEASE anything: a missing row, a stale list, a same-title
 * unrelated record or an empty queue view never resolves an operation. Every surface (Home Good Right Now,
 * Timeline, Calendar / Past Activity) reads its operation by request id from this projection, which page.tsx keeps
 * from the ONE outcome authority (lib/activitySync.ts + lib/offlineHabitQueue.ts).
 */
export type OperationStatus = 'pending' | 'unresolved' | 'confirmed' | 'failed' | 'discarded';
export interface ActivityOperationView {
  clientRequestId: string;
  status: OperationStatus;
  /** The operation's own activity (from its immutable body): used only to REATTACH the initiating card after a remount. */
  activityTitle: string;
  activityId?: string;
  logSource?: string;
  /** ms epoch the operation was anchored (queued / decided). */
  at: number;
  /** The account the operation belongs to (the projection is account-scoped; R16 recovery never crosses accounts). */
  account?: string;
}
export type ActivityOperations = Readonly<Record<string, ActivityOperationView>>;

/** Unresolved copy, shared by every surface. */
export const UNVERIFIED_ACTIVITY_MESSAGE = "Couldn't verify whether this activity was saved.";

/** An operation that still holds its identity (no new operation may replace it). */
export const isOpen = (op: ActivityOperationView | undefined) => Boolean(op && (op.status === 'pending' || op.status === 'unresolved'));

/**
 * Reattachment after remount / refresh / restart: the most recent still-OPEN operation the initiating surface
 * created for this activity (activity id when the card has one, else its title), anchored since `sinceMs`.
 * Reattachment only DISPLAYS an operation; it never resolves one.
 */
export function findAttachableOperation(
  operations: ActivityOperations | undefined,
  match: { activityTitle: string; activityId?: string; logSource?: string; sinceMs?: number }
): ActivityOperationView | undefined {
  if (!operations) return undefined;
  const title = match.activityTitle.trim().toLowerCase();
  let best: ActivityOperationView | undefined;
  for (const op of Object.values(operations)) {
    if (!isOpen(op)) continue;
    if (match.logSource && op.logSource && op.logSource !== match.logSource) continue;
    if (match.sinceMs !== undefined && op.at < match.sinceMs) continue;
    const same = match.activityId ? op.activityId === match.activityId : op.activityTitle.trim().toLowerCase() === title;
    if (same && (!best || op.at > best.at)) best = op;
  }
  return best;
}

/** R15: what an activity-logging call resolves to (a definitive failure rejects). */
export type ActivityLogResult = 'confirmed' | 'pending' | 'unresolved';
/**
 * R15: `retryOf` = the user's Retry of THAT operation (same request id and body); `onOperation` learns the id of the
 * operation the call creates or resumes, before it is dispatched. R16: `separate` = the user explicitly chose to log
 * a NEW, separate activity although an earlier one for the same activity is still open (identical intent allowed).
 */
export interface ActivityOperationRequest { retryOf?: string; onOperation?: (clientRequestId: string) => void; separate?: boolean }

/**
 * R16 (39258 G6) -- THE shared recovery contract every entry point goes through (page.tsx handleLogActivity), so it
 * does not depend on any component's local state, on remounts or on a history response:
 * a NEW submission for an activity that still has an OPEN operation (pending or unresolved, from the durable
 * projection -- restart-safe) is withheld until the user chooses: recover THAT operation (Check again / Retry under
 * its original id) or deliberately log a separate activity (`separate`). The activity match only decides when to
 * ASK; it never resolves, releases, deduplicates or merges anything.
 */
export class ActivityRecoveryRequiredError extends Error {
  constructor(readonly clientRequestId: string, readonly activityTitle: string) {
    super(UNVERIFIED_ACTIVITY_MESSAGE);
    this.name = 'ActivityRecoveryRequiredError';
  }
}
export const recoveryOperationOf = (err: unknown): string | undefined => (err instanceof Error && err.name === 'ActivityRecoveryRequiredError' ? (err as ActivityRecoveryRequiredError).clientRequestId : undefined);
export function findRecoverableOperation(
  operations: ActivityOperations | undefined,
  next: { activityTitle: string; activityId?: string }
): ActivityOperationView | undefined {
  if (!operations) return undefined;
  const title = next.activityTitle.trim().toLowerCase();
  let best: ActivityOperationView | undefined;
  for (const op of Object.values(operations)) {
    if (!isOpen(op)) continue;
    const same = next.activityId && op.activityId ? op.activityId === next.activityId : op.activityTitle.trim().toLowerCase() === title;
    if (same && (!best || op.at > best.at)) best = op;
  }
  return best;
}
/** R16: the account's operations that may have been saved but could not be verified (shown on every surface). */
export const unresolvedOperations = (operations: ActivityOperations | undefined) => Object.values(operations ?? {}).filter((op) => op.status === 'unresolved').sort((a, b) => b.at - a.at);
/** R15: "Check again" for one operation (or, without an id, a re-read of the account's operations). */
export type CheckActivity = (clientRequestId?: string) => Promise<OperationStatus>;
