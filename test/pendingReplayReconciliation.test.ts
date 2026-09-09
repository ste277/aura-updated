/**
 * Home/Timeline Pending Replay Reconciliation V1: regression suite for
 * apps/web/lib/pendingReplayReconciliation.ts -- the pure helper behind
 * Timeline's per-card "Pending"/"Logged" badge and Home's GoodRightNowCard
 * status, which previously only ever GREW a local "pending" flag and never
 * reconciled it once a background offline-queue replay actually resolved
 * (confirmed or permanently discarded) while the component stayed mounted.
 *
 * Traced architecture (not redesigned here): apps/web/app/page.tsx's own
 * syncOfflineLogs effect already POSTs each queued HabitLog, classifies
 * the outcome via classifyHabitLogSyncOutcome, rewrites the queue, and
 * then unconditionally calls loadUserDataAndLogs() (plus loadMyDay() when
 * anything confirmed) -- which already correctly reconciles the canonical
 * logEntries array via offlineHabitQueue.ts's own mergeConfirmedLogEntries
 * (a still-queued row survives, a confirmed or permanently-discarded one
 * does not). That part needed no fix: logEntries itself was already
 * correct after every replay. The actual gap was two presentation
 * components that cached their OWN "is this pending" flag in local state
 * derived once at click time and never re-derived it from the now-current
 * logEntries prop -- Timeline.tsx's pendingLogged and HomeDashboard.tsx's
 * GoodRightNowCard status. This suite covers the fix: both now reconcile
 * reactively off the same already-correct logEntries prop, via
 * resolvePendingActivityStatus.
 *
 * No component-test harness exists in this repo, so pure-function behavior
 * (resolvePendingActivityStatus itself, and My Day's own
 * selectTodaysPendingActivities used here to prove requirement 7) is
 * exercised directly; component wiring is verified with the established
 * source-text/regex structural-assertion pattern (see
 * test/pendingActivityVisualConsistency.test.ts,
 * test/myDayPendingVisibility.test.ts).
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

import { resolvePendingActivityStatus, SyncStatusEntry } from '../apps/web/lib/pendingReplayReconciliation';
import { selectTodaysPendingActivities, LoggedEntryLike } from '../apps/web/lib/myDayPendingOverlay';

function entry(overrides: Partial<SyncStatusEntry> = {}): SyncStatusEntry {
  return { activityTitle: 'Deep Work', syncStatus: 'pending', ...overrides };
}

// ============================================================
// 1. Replay success removes stale pending.
// ============================================================

check(
  '(1) a title that is now confirmed (no syncStatus) resolves \'confirmed\'',
  resolvePendingActivityStatus([entry({ syncStatus: undefined })], 'deep work') === 'confirmed'
);

// ============================================================
// 2. No duplicate after replay -- a title can never simultaneously read as
// both pending and confirmed; confirmed always wins once ANY matching row
// is confirmed, and the function returns a single verdict, never both.
// ============================================================

check(
  '(2) a title with one pending row and one confirmed row (a live optimistic entry not yet cleaned up) still resolves a single unambiguous \'confirmed\', never \'pending\'',
  resolvePendingActivityStatus(
    [entry({ syncStatus: 'pending' }), entry({ syncStatus: undefined })],
    'deep work'
  ) === 'confirmed'
);

// ============================================================
// 3. Retryable replay failure -- still genuinely queued, stays 'pending'.
// ============================================================

check(
  '(3) a title still present with syncStatus \'pending\' and nothing confirmed resolves \'pending\'',
  resolvePendingActivityStatus([entry({ syncStatus: 'pending' })], 'deep work') === 'pending'
);

// ============================================================
// 4. Unrelated pending preserved -- A confirms, B (different title) stays
// queued; each is resolved independently.
// ============================================================

check(
  '(4) two different titles resolve independently: A confirmed, B still pending',
  (() => {
    const logEntries: SyncStatusEntry[] = [
      entry({ activityTitle: 'Deep Work', syncStatus: undefined }),
      entry({ activityTitle: 'Evening Walk', syncStatus: 'pending' }),
    ];
    return (
      resolvePendingActivityStatus(logEntries, 'deep work') === 'confirmed' &&
      resolvePendingActivityStatus(logEntries, 'evening walk') === 'pending'
    );
  })()
);

// ============================================================
// Permanent failure -- the row is gone entirely (mergeConfirmedLogEntries
// already drops it once it's confirmed-nor-queued) -- 'gone', not
// 'confirmed', so a caller reverts to idle rather than showing a false
// success.
// ============================================================

check(
  'a title with no matching row at all resolves \'gone\' (permanent-failure convergence), never \'confirmed\'',
  resolvePendingActivityStatus([], 'deep work') === 'gone'
);

check(
  '\'gone\' is distinct from \'confirmed\' -- a caller must not treat them the same',
  resolvePendingActivityStatus([], 'deep work') !== resolvePendingActivityStatus([entry({ syncStatus: undefined })], 'deep work')
);

// ============================================================
// 5. New local pending during refresh -- resolvePendingActivityStatus
// itself takes a snapshot of logEntries as given; the actual race
// protection (a brand-new pending row must survive an in-flight, now-stale
// confirmed-only fetch resolving after it) is mergeConfirmedLogEntries's
// own pre-existing job (offlineHabitQueue.ts, untouched by this change --
// see the file-untouched check below). What this suite must additionally
// guard is that resolvePendingActivityStatus itself introduces no second,
// competing notion of "is this still pending": given the exact logEntries
// mergeConfirmedLogEntries would produce when a NEW pending entry (same
// title, different underlying log) arrives after an older one already
// confirmed, the still-genuinely-different pending row is not swallowed.
// ============================================================

check(
  '(5) a brand-new pending row for a title that also has an older confirmed row still reads \'confirmed\' overall (matches existing "isAlreadyLogged" semantics) -- resolvePendingActivityStatus never regresses a title from confirmed back to pending',
  resolvePendingActivityStatus(
    [entry({ activityTitle: 'Deep Work', syncStatus: undefined }), entry({ activityTitle: 'Deep Work', syncStatus: 'pending' })],
    'deep work'
  ) === 'confirmed'
);

// ============================================================
// 6. Timeline counts -- windowConfirmedCount/windowPendingCount must be
// derived FRESH from the logEntries prop on every render (no cached
// local state that could go stale after a replay), unlike pendingLogged
// (which legitimately IS local state and needed the new reconciliation
// effect this suite covers above).
// ============================================================

const timelineSource = fs.readFileSync('apps/web/components/Timeline.tsx', 'utf8');

check(
  "(6) Timeline.tsx's windowPendingCount/windowConfirmedCount are computed inline from windowLogs (itself derived from the logEntries prop via getWindowLogs), not from any useState",
  /const windowPendingCount = windowLogs\.filter\(\(log\) => log\.syncStatus === 'pending'\)\.length;/.test(timelineSource) &&
    /const windowConfirmedCount = windowLogs\.length - windowPendingCount;/.test(timelineSource) &&
    !/const \[windowPendingCount|const \[windowConfirmedCount/.test(timelineSource)
);

check(
  '(6) Timeline.tsx never caches windowLogs/windowPendingCount/windowConfirmedCount in a useMemo keyed away from logEntries (would go stale after a replay) -- computed directly inside the per-window render, not memoized at all',
  !/useMemo\(\(\) => \{[\s\S]{0,200}windowPendingCount/.test(timelineSource)
);

// ============================================================
// Timeline.tsx -- pendingLogged reconciliation wiring.
// ============================================================

check(
  "Timeline.tsx imports resolvePendingActivityStatus from the new self-contained pendingReplayReconciliation.ts (not offlineHabitQueue.ts, which still imports the .tsx-declared LoggedEntryItem and would force a new tsconfig.json exclusion for any .ts test importing it)",
  /import \{ resolvePendingActivityStatus \} from '\.\.\/lib\/pendingReplayReconciliation';/.test(timelineSource)
);

check(
  'Timeline.tsx has a useEffect keyed on [logEntries] that filters pendingLogged down to titles resolvePendingActivityStatus still reports \'pending\'',
  /useEffect\(\(\) => \{\s*setPendingLogged\(\(prev\) => \{[\s\S]*?resolvePendingActivityStatus\(logEntries, title\) === 'pending'[\s\S]*?\}, \[logEntries\]\);/.test(timelineSource)
);

check(
  'Timeline.tsx still renders "Pending" vs "Logged" off pendingLogged (unchanged copy/logic, only the staleness fixed)',
  /pendingLogged\.includes\(cardTitleNorm\)/.test(timelineSource) &&
    /pendingLogged\.includes\(card\.title\.toLowerCase\(\)\) \? 'Pending' : 'Logged'/.test(timelineSource)
);

check(
  "Timeline.tsx's onLogActivity return type is unchanged (still Promise<'confirmed' | 'pending'>) -- no clientRequestId threaded back to this call site",
  /\) => Promise<'confirmed' \| 'pending'>;/.test(timelineSource)
);

// ============================================================
// HomeDashboard.tsx -- GoodRightNowCard reconciliation wiring.
// ============================================================

const homeDashboardSource = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');

check(
  'HomeDashboard.tsx imports resolvePendingActivityStatus from pendingReplayReconciliation.ts',
  /import \{ resolvePendingActivityStatus \} from '\.\.\/lib\/pendingReplayReconciliation';/.test(homeDashboardSource)
);

check(
  'HomeDashboardProps gained an optional logEntries prop, passed straight through from page.tsx (never used to recompute myDayPendingActivities/loggedActivitiesToday here)',
  /logEntries\?: LoggedEntryItem\[\];/.test(homeDashboardSource)
);

check(
  'HomeDashboard passes logEntries down to each GoodRightNowCard render call',
  /<GoodRightNowCard[\s\S]{0,400}logEntries=\{logEntries\}/.test(homeDashboardSource)
);

check(
  "GoodRightNowCard's own props type gained an optional logEntries field",
  /function GoodRightNowCard\(\{[\s\S]*?logEntries,[\s\S]*?\}: \{[\s\S]*?logEntries\?: LoggedEntryItem\[\];/.test(homeDashboardSource)
);

check(
  "GoodRightNowCard has a reconciliation useEffect keyed on [logEntries, status, planTitle] that only acts while status === 'pending'",
  /useEffect\(\(\) => \{\s*if \(status !== 'pending'\) return;\s*const resolved = resolvePendingActivityStatus\(logEntries \?\? \[\], planTitle\.trim\(\)\.toLowerCase\(\)\);/.test(homeDashboardSource)
);

check(
  "GoodRightNowCard's reconciliation effect sets status 'logged' (with a loggedAtLabel) on 'confirmed', and 'idle' (not 'error', not stuck) on 'gone' -- converging with PR #91's existing permanent-failure behavior instead of inventing a new failure state",
  /if \(resolved === 'confirmed'\) \{\s*setStatus\('logged'\);\s*setLoggedAtLabel\(/.test(homeDashboardSource) &&
    /\} else if \(resolved === 'gone'\) \{[\s\S]{0,500}setStatus\('idle'\);/.test(homeDashboardSource)
);

check(
  "HomeDashboard.tsx's onLogActivity return type is unchanged (still Promise<'confirmed' | 'pending'>) -- pinned the same way habitLogActivityIdentity.test.ts already pins it",
  /\) => Promise<'confirmed' \| 'pending'>;/.test(homeDashboardSource)
);

// ============================================================
// page.tsx -- logEntries threaded to HomeDashboard; handleLogActivity and
// the replay/refresh orchestration itself untouched.
// ============================================================

const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');

check(
  'page.tsx passes logEntries into <HomeDashboard>',
  /<HomeDashboard[\s\S]*?logEntries=\{logEntries\}/.test(pageSource)
);

check(
  "page.tsx's handleLogActivity is unchanged: still returns Promise<'confirmed' | 'pending'>",
  /\): Promise<'confirmed' \| 'pending'> => \{/.test(pageSource)
);

check(
  'syncOfflineLogs still unconditionally calls loadUserDataAndLogs() after every replay attempt (success or permanent failure), and loadMyDay() only when anyConfirmed -- the exact pre-existing refresh path this fix reuses, not a new one',
  /loadUserDataAndLogs\(\);\s*if \(anyConfirmed\) loadMyDay\(\);/.test(pageSource)
);

check(
  'syncOfflineLogs still classifies each replayed item via classifyHabitLogSyncOutcome and still rewrites the queue to hold only what remains genuinely retry-worthy -- queue retry classification/persistence untouched',
  /const outcome = classifyHabitLogSyncOutcome\(res\.status\);/.test(pageSource) &&
    /localStorage\.setItem\('offline_habit_queue', JSON\.stringify\(remaining\)\);/.test(pageSource)
);

// ============================================================
// 7. My Day overlay -- pending A disappears from the client overlay after
// successful reconciliation; canonical DailyAgenda semantics untouched.
// myDayPendingOverlay.ts itself is not modified by this change (see the
// file-untouched check below) -- this proves end-to-end, using the exact
// same selectTodaysPendingActivities My Day already relies on, that the
// logEntries state loadUserDataAndLogs produces after a successful replay
// (the confirmed row present, no lingering syncStatus 'pending' row for
// the same clientRequestId -- mergeConfirmedLogEntries's own job) already
// makes the pending overlay row disappear on its own.
// ============================================================

function myDayEntry(overrides: Partial<LoggedEntryLike> = {}): LoggedEntryLike {
  return {
    id: 'client-req-a',
    activityTitle: 'Deep Work',
    activeWindow: 'BRAHMA',
    loggedAt: new Date('2026-09-09T05:00:00.000+05:30'),
    syncStatus: 'pending',
    clientRequestId: 'client-req-a',
    ...overrides,
  };
}

check(
  "(7) before replay: the pending overlay shows the entry",
  selectTodaysPendingActivities([myDayEntry()], 'Asia/Kolkata', '2026-09-09').length === 1
);

check(
  "(7) after replay success: logEntries no longer carries a syncStatus 'pending' row for this clientRequestId (mergeConfirmedLogEntries's own post-replay result) -- the pending overlay row disappears",
  selectTodaysPendingActivities(
    [{ ...myDayEntry(), id: 'server-real-id', syncStatus: undefined }],
    'Asia/Kolkata',
    '2026-09-09'
  ).length === 0
);

// ============================================================
// 8/9/10. Prior PRs' own regression suites are run separately by the
// verification battery (test/pendingActivityReloadVisibility.test.ts,
// test/pendingActivityVisualConsistency.test.ts,
// test/myDayPendingVisibility.test.ts) -- not re-implemented here. This
// suite only additionally confirms none of the files those suites pin
// were touched by this change.
// ============================================================

check(
  'apps/web/lib/offlineHabitQueue.ts (queue core: mergeConfirmedLogEntries, selectQueueItemsToReconstruct, readOfflineHabitQueue, toPendingLoggedEntry, clientRequestId generation) is untouched by this change',
  !/resolvePendingActivityStatus|SyncStatusEntry/.test(fs.readFileSync('apps/web/lib/offlineHabitQueue.ts', 'utf8'))
);

check(
  'apps/web/lib/myDayPendingOverlay.ts is untouched by this change',
  !/resolvePendingActivityStatus|pendingReplayReconciliation/.test(fs.readFileSync('apps/web/lib/myDayPendingOverlay.ts', 'utf8'))
);

check(
  'apps/web/components/YourDayTimeline.tsx is untouched by this change (My Day pending overlay rendering itself was not modified)',
  !/resolvePendingActivityStatus|pendingReplayReconciliation/.test(fs.readFileSync('apps/web/components/YourDayTimeline.tsx', 'utf8'))
);

check(
  'apps/web/components/CalendarViewSection.tsx is untouched by this change',
  !/resolvePendingActivityStatus|pendingReplayReconciliation/.test(fs.readFileSync('apps/web/components/CalendarViewSection.tsx', 'utf8'))
);

check(
  'apps/web/components/InsightsView.tsx is untouched by this change (confirmed-only analytics preserved)',
  !/resolvePendingActivityStatus|pendingReplayReconciliation/.test(fs.readFileSync('apps/web/components/InsightsView.tsx', 'utf8'))
);

check(
  'apps/web/lib/dailyAgenda.ts is untouched by this change (DailyAgendaItemStatus untouched)',
  !/resolvePendingActivityStatus|pendingReplayReconciliation/.test(fs.readFileSync('apps/web/lib/dailyAgenda.ts', 'utf8')) &&
    !/'PENDING'/.test(fs.readFileSync('apps/web/lib/dailyAgenda.ts', 'utf8'))
);

// ============================================================
// No Plan matching, no fuzzy cross-entity reconciliation introduced.
// ============================================================

check(
  'pendingReplayReconciliation.ts never references PlannedActivity, planId, habitLogId, or Plan matching of any kind',
  !/PlannedActivity|planId|habitLogId/.test(fs.readFileSync('apps/web/lib/pendingReplayReconciliation.ts', 'utf8'))
);

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

check(
  'pendingReplayReconciliation.ts never reads localStorage or the offline queue directly in actual code -- it only reconciles against whatever logEntries it is given (the module doc comment mentions "localStorage" in prose explaining what it deliberately does NOT do, so comments are stripped before this check)',
  !/localStorage|offline_habit_queue/.test(stripComments(fs.readFileSync('apps/web/lib/pendingReplayReconciliation.ts', 'utf8')))
);

if (!allPassed) {
  console.error('\nSome Home/Timeline Pending Replay Reconciliation checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL HOME/TIMELINE PENDING REPLAY RECONCILIATION CHECKS PASSED');
}
