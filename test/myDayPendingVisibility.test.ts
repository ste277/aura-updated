/**
 * Pending Activity My Day Visibility V1: regression suite for
 * apps/web/lib/myDayPendingOverlay.ts -- the pure presentation-
 * composition helper behind Your Day Timeline's pending rows -- and the
 * boundary guarantees around it (canonical myDay/DailyAgenda/DailyStory
 * untouched, no Plan matching, no second offline-queue reader).
 *
 * Architecture (from the accepted design): canonical server My Day,
 * unmutated, plus a client-only pending presentation overlay.
 * selectTodaysPendingActivities consumes page.tsx's own logEntries
 * (already reload-safe and already correctly deduped against
 * confirmation by PR #91's mergeConfirmedLogEntries) -- it performs no
 * dedup of its own, no Plan matching, and never reads localStorage.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

import { selectTodaysPendingActivities, LoggedEntryLike } from '../apps/web/lib/myDayPendingOverlay';

// Deliberately built against LoggedEntryLike (myDayPendingOverlay.ts's own
// structural subset), not the canonical LoggedEntryItem -- this test file
// has no need to import a .tsx-declared type either; the real page.tsx
// logEntries (LoggedEntryItem[]) structurally satisfies LoggedEntryLike[]
// at every real call site, which is exactly what the wiring assertions
// below prove.
function pendingEntry(overrides: Partial<LoggedEntryLike> = {}): LoggedEntryLike {
  return {
    id: 'client-req-aaaa',
    activityTitle: 'Deep Work',
    activeWindow: 'BRAHMA',
    loggedAt: new Date('2026-09-09T05:00:00.000+05:30'), // 2026-09-08T23:30:00.000Z
    syncStatus: 'pending',
    clientRequestId: 'client-req-aaaa',
    ...overrides,
  };
}

function confirmedEntry(overrides: Partial<LoggedEntryLike> = {}): LoggedEntryLike {
  const { syncStatus, ...rest } = pendingEntry(overrides);
  return rest;
}

const KOLKATA = 'Asia/Kolkata';
const LOS_ANGELES = 'America/Los_Angeles';
const TODAY_KOLKATA = '2026-09-09';

// ============================================================
// A. Today's pending entry appears.
// ============================================================

check(
  "A. a pending entry logged today (Timing Location's today) appears in the overlay",
  selectTodaysPendingActivities([pendingEntry()], KOLKATA, TODAY_KOLKATA).length === 1
);
check(
  'the presentation item carries the fields Your Day Timeline needs (id, clientRequestId, title, loggedAt, activeWindow)',
  (() => {
    const [item] = selectTodaysPendingActivities([pendingEntry()], KOLKATA, TODAY_KOLKATA);
    return item?.id === 'client-req-aaaa' && item?.clientRequestId === 'client-req-aaaa' && item?.activityTitle === 'Deep Work' && item?.activeWindow === 'BRAHMA' && item?.loggedAt instanceof Date;
  })()
);

// ============================================================
// B. A confirmed entry (no syncStatus) never becomes a pending overlay
// row, even on the same day.
// ============================================================

check(
  'B. a confirmed entry (syncStatus undefined) is excluded, even though it happened today',
  selectTodaysPendingActivities([confirmedEntry()], KOLKATA, TODAY_KOLKATA).length === 0
);

// ============================================================
// C. Yesterday's pending entry is excluded, using Timing Location
// timezone (not browser-local, not UTC).
// ============================================================

check(
  "C. a pending entry from yesterday (Kolkata local date) is excluded from today's overlay",
  selectTodaysPendingActivities(
    [pendingEntry({ loggedAt: new Date('2026-09-08T05:00:00.000+05:30') })], // 2026-09-08 in Kolkata
    KOLKATA,
    TODAY_KOLKATA
  ).length === 0
);

// ============================================================
// D. Timezone boundary case -- the SAME UTC instant belongs to
// different local dates depending on the Timing Location timezone.
// 2026-09-08T23:30:00.000Z is 2026-09-09 05:00 in Kolkata (today) but
// 2026-09-08 16:30 in Los Angeles (a different local date).
// ============================================================

const boundaryInstant = new Date('2026-09-08T23:30:00.000Z');
check(
  "D. the same UTC instant IS classified as today in Kolkata (today's date, Kolkata-local)",
  selectTodaysPendingActivities([pendingEntry({ loggedAt: boundaryInstant })], KOLKATA, TODAY_KOLKATA).length === 1
);
check(
  "D. the exact same UTC instant is NOT classified as that same calendar date string in Los Angeles (genuinely timezone-aware, not a UTC/browser-local shortcut)",
  selectTodaysPendingActivities([pendingEntry({ loggedAt: boundaryInstant })], LOS_ANGELES, TODAY_KOLKATA).length === 0
);

// ============================================================
// E/F. Multiple pending entries -- including same-title entries with
// different clientRequestId -- remain distinct.
// ============================================================

const entryA = pendingEntry({ id: 'req-a', clientRequestId: 'req-a', activityTitle: 'Deep Work' });
const entryB = pendingEntry({ id: 'req-b', clientRequestId: 'req-b', activityTitle: 'Evening Walk' });
check('E. two distinct pending entries both appear, independently', selectTodaysPendingActivities([entryA, entryB], KOLKATA, TODAY_KOLKATA).length === 2);

const sameTitleA = pendingEntry({ id: 'req-x', clientRequestId: 'req-x', activityTitle: 'Meditation' });
const sameTitleB = pendingEntry({ id: 'req-y', clientRequestId: 'req-y', activityTitle: 'Meditation' });
const sameTitleResult = selectTodaysPendingActivities([sameTitleA, sameTitleB], KOLKATA, TODAY_KOLKATA);
check(
  'F. two same-title pending entries with different clientRequestId both remain, as distinct rows (no accidental collapsing)',
  sameTitleResult.length === 2 && sameTitleResult[0].clientRequestId !== sameTitleResult[1].clientRequestId
);

// ============================================================
// G. A pending direct activity is never matched/merged against a
// PlannedActivity -- the function's own input/output types carry no
// Plan-related identity at all, and it performs no such matching.
// ============================================================

const overlaySource = fs.readFileSync('apps/web/lib/myDayPendingOverlay.ts', 'utf8');
// Strip // and /* */ comments before checking for real code references --
// this file's own doc comments explain what it deliberately does NOT do
// (mentioning PlannedActivity/localStorage/buildDailyAgenda in prose),
// which must not false-positive these structural checks.
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
const overlayCode = stripComments(overlaySource);
check('G. myDayPendingOverlay.ts never imports PlannedActivity or dailyAgenda types (no Plan matching is even structurally possible)', !/PlannedActivity/.test(overlayCode) && !/from '\.\/dailyAgenda'/.test(overlayCode));
check('G. myDayPendingOverlay.ts never references planId/habitLogId (no Plan linkage of any kind)', !/planId/i.test(overlayCode) && !/habitLogId/.test(overlayCode));
check(
  'G. a pending "Meditation" entry produces exactly one row -- no attempt to locate/suppress/alter a same-titled Plan (the function has no Plan input to do so with)',
  selectTodaysPendingActivities([pendingEntry({ activityTitle: 'Meditation' })], KOLKATA, TODAY_KOLKATA).length === 1
);

// ============================================================
// H. Retryable pending state remains visible -- the overlay has no
// concept of "which attempt" or "how many retries"; it only reflects
// logEntries' own current syncStatus, exactly as PR #91 already
// maintains it.
// ============================================================

check(
  "H. a pending entry remains visible regardless of how many times it's been retried (the overlay is stateless -- it just reflects the current syncStatus)",
  selectTodaysPendingActivities([pendingEntry()], KOLKATA, TODAY_KOLKATA).length === 1 &&
    selectTodaysPendingActivities([pendingEntry()], KOLKATA, TODAY_KOLKATA).length === 1 // calling it "again" (simulating a re-render after a retry) changes nothing by itself
);

// ============================================================
// I. A pending row disappears once it's no longer in the upstream
// logEntries -- this function holds no internal state/cache of its own.
// ============================================================

check('I. an empty logEntries array (upstream item already removed/confirmed) produces an empty overlay', selectTodaysPendingActivities([], KOLKATA, TODAY_KOLKATA).length === 0);
check(
  'I. re-selecting against logEntries with the item removed produces zero results, even immediately after a call that included it',
  (() => {
    const withItem = selectTodaysPendingActivities([pendingEntry()], KOLKATA, TODAY_KOLKATA);
    const withoutItem = selectTodaysPendingActivities([], KOLKATA, TODAY_KOLKATA);
    return withItem.length === 1 && withoutItem.length === 0;
  })()
);

// ============================================================
// Failure/edge handling.
// ============================================================

check('an empty todayDateStr (My Day not yet loaded) safely returns no pending rows rather than misclassifying', selectTodaysPendingActivities([pendingEntry()], KOLKATA, '').length === 0);
check('a pending entry missing clientRequestId is excluded (the overlay requires strong identity, same as PR #91)', selectTodaysPendingActivities([pendingEntry({ clientRequestId: undefined })], KOLKATA, TODAY_KOLKATA).length === 0);

// ============================================================
// O. No localStorage read in the My Day overlay helper.
// ============================================================

check('O. myDayPendingOverlay.ts never references localStorage (no second offline-queue reader)', !/localStorage/.test(overlayCode));
check('myDayPendingOverlay.ts never calls buildDailyAgenda/buildDailyStory (presentation composition only, no orchestration duplication)', !/buildDailyAgenda/.test(overlayCode) && !/buildDailyStory/.test(overlayCode));

// ============================================================
// J/K/L/M/N -- structural boundary guarantees on the wiring: canonical
// myDay/DailyAgenda/DailyStory/completedCount/plannedCount/nextItem are
// never touched by this feature's new code.
// ============================================================

const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const homeDashboardSource = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');
const timelineSource = fs.readFileSync('apps/web/components/YourDayTimeline.tsx', 'utf8');

check('J. page.tsx still passes myDay?.agenda to HomeDashboard completely unmodified (no spread/merge with pending data)', /myDayAgenda=\{myDay\?\.agenda\}/.test(pageSource));
check('N. page.tsx still passes myDay?.story to HomeDashboard completely unmodified (Daily Story untouched by this feature)', /myDayStory=\{myDay\?\.story\}/.test(pageSource));
check('page.tsx never calls setMyDay from the new pending-overlay code (myDayPendingActivities is a separate useMemo, not a myDay mutation)', (() => {
  const overlayMemoMatch = pageSource.match(/const myDayPendingActivities = useMemo\(([\s\S]*?)\n {2}\);/);
  return overlayMemoMatch !== null && !/setMyDay/.test(overlayMemoMatch[1]);
})());
check('K/L/M. YourDayTimeline never references completedCount/plannedCount/nextItem\'s value being recomputed from pending data (nextItemId still comes only from agenda.nextItem)', /const nextItemId = agenda\?\.nextItem\?\.id;/.test(timelineSource) && !/completedCount/.test(timelineSource) && !/plannedCount/.test(timelineSource));
check('the canonical agenda rows (completedRows/otherRows) are still derived only from agenda.items, never from pendingActivities', /const \{ rows, hiddenCount \} = expanded \|\| !agenda \? \{ rows: agenda\?\.items \?\? \[\], hiddenCount: 0 \} : selectCompactAgendaRows\(agenda\);/.test(timelineSource));
check('pending rows are rendered as their own separate section (PendingActivityRow), never passed into AgendaRow/GroupedCompletedRows/selectCompactAgendaRows', /pendingActivities\.map\(\(item\) => \(\s*<PendingActivityRow/.test(timelineSource));
check('PendingActivityRow uses the existing StatusBadge label="Pending sync" tone="caution" (no new visual language)', /<StatusBadge label="Pending sync" tone="caution" \/>/.test(timelineSource));
check('HomeDashboard passes myDayPendingActivities straight through to YourDayTimeline (no local filtering/recomputation in HomeDashboard)', /pendingActivities=\{myDayPendingActivities\}/.test(homeDashboardSource));
check('DailyAgendaItemStatus is not touched by this PR (no new "PENDING" status value added to the shared server-derived type)', !/'PENDING'/.test(fs.readFileSync('apps/web/lib/dailyAgenda.ts', 'utf8')));

// ============================================================
// Good Right Now duplicate suppression already covers pending entries
// (documented, not reimplemented) -- regression guard that this remains
// true and untouched.
// ============================================================

check(
  'loggedActivitiesToday (feeding Good Right Now\'s existing duplicate-suppression) still includes pending entries unfiltered by syncStatus -- untouched, still doing this job for free',
  (() => {
    const match = pageSource.match(/const loggedActivitiesToday = useMemo\(\(\) => \{([\s\S]*?)\n {2}\}, \[logEntries, userTz, todayDateStr\]\);/);
    return match !== null && !/syncStatus/.test(match[1]);
  })()
);

if (!allPassed) {
  console.error('\nSome Pending Activity My Day Visibility checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL PENDING ACTIVITY MY DAY VISIBILITY CHECKS PASSED');
}
