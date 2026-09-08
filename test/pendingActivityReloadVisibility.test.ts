/**
 * Pending Activity Reload Visibility V1: regression suite for
 * apps/web/lib/offlineHabitQueue.ts -- the pure read/reconstruction/merge
 * helpers page.tsx wires into loadUserDataAndLogs and the reload-
 * reconstruction effect.
 *
 * Traced from source (not re-derived here): handleLogActivity's own
 * offline-queue write (page.tsx) already persists everything needed to
 * reconstruct a pending LoggedEntryItem -- activityTitle, activeWindow,
 * logTimestamp, durationMinutes, notes, logSource, activitySignificance,
 * and a stable clientRequestId generated once and reused across every
 * retry. GET /api/habit-logs already returns clientRequestId on every
 * confirmed row (a real HabitLog column, migration 0032) -- the client
 * just wasn't capturing it. No schema/API/server change was needed.
 *
 * The merge/dedup decisions behind loadUserDataAndLogs and the reload-
 * reconstruction effect are extracted into mergeConfirmedLogEntries and
 * selectQueueItemsToReconstruct specifically so they're real,
 * independently callable functions here -- not logic that can only be
 * proven by regexing page.tsx's source text. Only the wiring (that
 * page.tsx actually calls them) is checked structurally; every behavioral
 * property (dedup, still-queued preservation, permanent-rejection
 * removal, retry preservation) is proven by calling the real function.
 *
 * A DOM-less Node environment (ts-node, no browser) has no global
 * localStorage, so this test installs a minimal in-memory polyfill before
 * exercising readOfflineHabitQueue -- the same approach this repo already
 * uses for any browser-API-touching pure helper under plain ts-node.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Minimal in-memory localStorage polyfill (Node has none).
// ============================================================
class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = value;
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}
(global as any).localStorage = new MemoryStorage();

import {
  readOfflineHabitQueue,
  toPendingLoggedEntry,
  mergeConfirmedLogEntries,
  selectQueueItemsToReconstruct,
  QueuedHabitLog,
} from '../apps/web/lib/offlineHabitQueue';
import { LoggedEntryItem } from '../apps/web/components/CalendarViewSection';

function setQueue(items: unknown[]) {
  (global as any).localStorage.setItem('offline_habit_queue', JSON.stringify(items));
}

const queuedA: QueuedHabitLog = {
  activityTitle: 'Deep Work',
  activeWindow: 'BRAHMA',
  logMinuteOfDay: 360,
  logTimestamp: '2026-09-08T06:00:00.000Z',
  notes: 'felt good',
  durationMinutes: 45,
  logSource: 'AURA_DO_NOW',
  activitySignificance: 'HIGH',
  clientRequestId: 'client-req-aaaa-1111',
  tempId: 'temp-1111',
};
const queuedB: QueuedHabitLog = { ...queuedA, activityTitle: 'Evening Walk', clientRequestId: 'client-req-bbbb-2222', tempId: 'temp-2222' };

function pendingEntry(item: QueuedHabitLog): LoggedEntryItem {
  return toPendingLoggedEntry(item);
}
function confirmedEntry(id: string, clientRequestId: string, title = 'Deep Work'): LoggedEntryItem {
  return { id, activityTitle: title, activeWindow: 'BRAHMA', loggedAt: new Date('2026-09-08T06:00:00.000Z'), clientRequestId };
}

// ============================================================
// readOfflineHabitQueue / toPendingLoggedEntry -- reconstruction basics
// (1. pending survives reload, 2. multiple entries, 5. stable identity).
// ============================================================

(global as any).localStorage.clear();
setQueue([queuedA]);
const read1 = readOfflineHabitQueue();
check('readOfflineHabitQueue reads back the one queued entry', read1.length === 1);
const reconstructed1 = read1.map(toPendingLoggedEntry);
check('the reconstructed entry has syncStatus === \'pending\' (4. no accidental promotion -- always literal, never derived)', reconstructed1[0]?.syncStatus === 'pending');
check('the reconstructed entry preserves activityTitle/loggedAt/notes/source/significance from the queue', (
  reconstructed1[0]?.activityTitle === 'Deep Work' &&
  reconstructed1[0]?.loggedAt.toISOString() === '2026-09-08T06:00:00.000Z' &&
  reconstructed1[0]?.notes === 'felt good' &&
  reconstructed1[0]?.logSource === 'AURA_DO_NOW' &&
  reconstructed1[0]?.activitySignificance === 'HIGH'
));

(global as any).localStorage.clear();
setQueue([queuedA, queuedB]);
const reconstructedMulti = readOfflineHabitQueue().map(toPendingLoggedEntry);
check('two queued entries both reconstruct independently', reconstructedMulti.length === 2 && reconstructedMulti.every((e) => e.syncStatus === 'pending'));
check('each keeps its own distinct id (clientRequestId)', reconstructedMulti[0]?.id !== reconstructedMulti[1]?.id);

const firstPass = toPendingLoggedEntry(queuedA);
const secondPass = toPendingLoggedEntry(queuedA);
check('reconstructing the same queued item twice yields the same id (stable identity across repeated reloads)', firstPass.id === secondPass.id && firstPass.id === queuedA.clientRequestId);
check('clientRequestId is carried onto the reconstructed entry itself (never a freshly generated identity)', firstPass.clientRequestId === queuedA.clientRequestId);

// ============================================================
// 6. Successful queue removal -- a fresh read no longer includes an item
// once it's gone from the queue (inherent to reading live, not cached).
// ============================================================

(global as any).localStorage.clear();
setQueue([queuedB]); // queuedA removed, as if replay had confirmed/rejected + removed it
const afterRemoval = readOfflineHabitQueue();
check('an item removed from the queue is no longer read back', !afterRemoval.some((item) => item.clientRequestId === queuedA.clientRequestId));
check('the remaining still-queued item is still read back', afterRemoval.some((item) => item.clientRequestId === queuedB.clientRequestId));

// ============================================================
// Failure handling -- missing/corrupt/malformed queue data degrades
// gracefully, never throws, never fabricates an entry, never lets one
// malformed sibling destroy otherwise-valid entries.
// ============================================================

(global as any).localStorage.clear();
check('no queue key at all -> empty array, no throw', (() => { try { return readOfflineHabitQueue().length === 0; } catch { return false; } })());

(global as any).localStorage.setItem('offline_habit_queue', 'not valid json{{{');
check('corrupt JSON -> empty array, no throw', (() => { try { return readOfflineHabitQueue().length === 0; } catch { return false; } })());

(global as any).localStorage.setItem('offline_habit_queue', JSON.stringify({ not: 'an array' }));
check('a non-array value -> empty array, no throw', (() => { try { return readOfflineHabitQueue().length === 0; } catch { return false; } })());

(global as any).localStorage.setItem('offline_habit_queue', JSON.stringify([queuedA, { activityTitle: 'Missing required fields' }]));
const mixedRead = readOfflineHabitQueue();
check('a malformed sibling is dropped while a valid sibling in the SAME queue still reconstructs (one bad item does not destroy the rest)', mixedRead.length === 1 && mixedRead[0]?.clientRequestId === queuedA.clientRequestId);

(global as any).localStorage.setItem('offline_habit_queue', JSON.stringify([{ ...queuedA, logSource: 'NOT_A_REAL_SOURCE' }]));
check('an invalid logSource degrades to the safe MANUAL default rather than propagating garbage', readOfflineHabitQueue().map(toPendingLoggedEntry)[0]?.logSource === 'MANUAL');
(global as any).localStorage.clear();

// ============================================================
// mergeConfirmedLogEntries -- the loadUserDataAndLogs merge, called
// directly as a real function (3. confirmed logs preserved, 13.
// dedupe, 16. permanent-rejection removal, 17. retry preservation).
// ============================================================

check(
  '3. confirmed entries always survive the merge unconditionally',
  mergeConfirmedLogEntries([confirmedEntry('srv-1', 'client-req-aaaa-1111')], [], new Set()).some((e) => e.id === 'srv-1')
);

check(
  '13. dedupe -- a confirmed entry with the same clientRequestId wins; the reconstructed pending duplicate is dropped (exactly one logical row remains)',
  (() => {
    const result = mergeConfirmedLogEntries(
      [confirmedEntry('srv-1', queuedA.clientRequestId)],
      [pendingEntry(queuedA)],
      new Set([queuedA.clientRequestId]) // still technically in the queue at the instant this runs, but confirmation wins regardless
    );
    return result.length === 1 && result[0].id === 'srv-1' && result[0].syncStatus !== 'pending';
  })()
);

check(
  '17. retry preservation -- a pending entry with NO confirmed counterpart, but still present in the live queue (5xx/network retry), survives the merge',
  (() => {
    const result = mergeConfirmedLogEntries([], [pendingEntry(queuedA)], new Set([queuedA.clientRequestId]));
    return result.length === 1 && result[0].syncStatus === 'pending' && result[0].id === queuedA.clientRequestId;
  })()
);

check(
  '16. permanent-rejection removal -- a pending entry with NO confirmed counterpart AND no longer in the queue (4xx, already removed) is dropped, not left as a zombie (PR #86\'s own invariant, preserved)',
  (() => {
    const result = mergeConfirmedLogEntries([], [pendingEntry(queuedA)], new Set()); // empty queue: queuedA was removed
    return result.length === 0;
  })()
);

check(
  'confirmed entries from OTHER activities are unaffected by an unrelated pending entry\'s fate',
  (() => {
    const result = mergeConfirmedLogEntries(
      [confirmedEntry('srv-2', 'unrelated-client-req')],
      [pendingEntry(queuedA)],
      new Set() // queuedA removed
    );
    return result.length === 1 && result[0].id === 'srv-2';
  })()
);

check(
  'a pending entry with no clientRequestId at all is never preserved (cannot be reconciled against the queue, so it must not linger indefinitely)',
  mergeConfirmedLogEntries([], [{ id: 'temp-x', activityTitle: 'x', activeWindow: 'NEUTRAL', loggedAt: new Date(), syncStatus: 'pending' }], new Set()).length === 0
);

// ============================================================
// selectQueueItemsToReconstruct -- the reload-reconstruction effect's
// own decision, called directly (2. multiple entries, 13. dedupe against
// confirmed, stable/idempotent reconstruction).
// ============================================================

check(
  'an empty existing logEntries reconstructs every queued item',
  selectQueueItemsToReconstruct([queuedA, queuedB], []).length === 2
);

check(
  '13. dedupe -- a queued item already represented by a CONFIRMED entry (same clientRequestId) is excluded from reconstruction (strong identity only, no title/timestamp heuristic)',
  selectQueueItemsToReconstruct([queuedA], [confirmedEntry('srv-1', queuedA.clientRequestId)]).length === 0
);

check(
  'a queued item already present by id (already reconstructed, or a live optimistic entry sharing the id) is not reconstructed again -- idempotent, no duplicate pending rows',
  selectQueueItemsToReconstruct([queuedA], [pendingEntry(queuedA)]).length === 0
);

check(
  'reconstructing the same queue repeatedly never produces a duplicate: selecting against its own prior reconstruction output yields nothing new',
  (() => {
    const firstReconstruction = selectQueueItemsToReconstruct([queuedA, queuedB], []).map(toPendingLoggedEntry);
    const secondSelection = selectQueueItemsToReconstruct([queuedA, queuedB], firstReconstruction);
    return secondSelection.length === 0;
  })()
);

check(
  'a title/timestamp-only heuristic is never used for dedup -- two DIFFERENT clientRequestIds with the same title both reconstruct independently (no accidental collapsing)',
  selectQueueItemsToReconstruct([queuedA, { ...queuedA, clientRequestId: 'a-different-id' }], []).length === 2
);

// ============================================================
// Initialization order independence (14A/14B) -- the two entry points
// (confirmed fetch first vs. reconstruction first) converge on the same
// SET of entries with the same statuses regardless of order.
// ============================================================

check(
  '14A. reconstruction-first ordering: pending appears, then confirmed fetch resolves and preserves it via the merge',
  (() => {
    // Step 1: reconstruction runs against empty state.
    const afterReconstruction = selectQueueItemsToReconstruct([queuedA], []).map(toPendingLoggedEntry);
    // Step 2: confirmed fetch resolves (queuedA not yet confirmed, still queued).
    const afterConfirmedFetch = mergeConfirmedLogEntries([], afterReconstruction, new Set([queuedA.clientRequestId]));
    return afterConfirmedFetch.length === 1 && afterConfirmedFetch[0].syncStatus === 'pending';
  })()
);

check(
  '14B. confirmed-first ordering: confirmed fetch resolves against empty state, then reconstruction runs and adds the still-queued pending entry without duplicating',
  (() => {
    // Step 1: confirmed fetch resolves first (nothing confirmed yet, nothing pending yet).
    const afterConfirmedFetch = mergeConfirmedLogEntries([], [], new Set());
    // Step 2: reconstruction runs (queuedA still in the queue, not yet confirmed).
    const toReconstruct = selectQueueItemsToReconstruct([queuedA], afterConfirmedFetch).map(toPendingLoggedEntry);
    const final = [...toReconstruct, ...afterConfirmedFetch];
    return final.length === 1 && final[0].syncStatus === 'pending';
  })()
);

// ============================================================
// 15. Replay success -- confirmed X fully replaces pending X, exactly
// one X remains (composed from the two extracted functions together).
// ============================================================

check(
  '15. replay success: pending X + now-confirmed X (same clientRequestId, queue entry removed) -> exactly one X remains, confirmed',
  (() => {
    const pendingX = pendingEntry(queuedA);
    const confirmedX = confirmedEntry('srv-1', queuedA.clientRequestId);
    const merged = mergeConfirmedLogEntries([confirmedX], [pendingX], new Set()); // queue already cleared post-replay
    return merged.length === 1 && merged[0].id === 'srv-1';
  })()
);

// ============================================================
// Structural checks on page.tsx's wiring -- now minimal, since the
// actual decisions are proven above as real function calls. These only
// confirm page.tsx calls the extracted functions rather than
// reimplementing the logic inline again.
// ============================================================

const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const calendarSource = fs.readFileSync('apps/web/components/CalendarViewSection.tsx', 'utf8');
const timelineSource = fs.readFileSync('apps/web/components/Timeline.tsx', 'utf8');
const insightsSource = fs.readFileSync('apps/web/components/InsightsView.tsx', 'utf8');

check(
  'page.tsx imports the extracted helpers from the new lib module',
  /import \{ readOfflineHabitQueue, toPendingLoggedEntry, mergeConfirmedLogEntries, selectQueueItemsToReconstruct \} from '\.\.\/lib\/offlineHabitQueue';/.test(pageSource)
);
check('loadUserDataAndLogs calls mergeConfirmedLogEntries (no re-implemented inline merge logic)', /return mergeConfirmedLogEntries\(confirmedEntries, prev, queuedClientRequestIds\);/.test(pageSource));
check('the confirmed fetch propagates clientRequestId from the server row onto each entry', /clientRequestId: l\.clientRequestId \?\? undefined,/.test(pageSource));
check('the reload-reconstruction effect calls selectQueueItemsToReconstruct (no re-implemented inline selection logic)', /const reconstructed = selectQueueItemsToReconstruct\(queued, prev\)\.map\(toPendingLoggedEntry\);/.test(pageSource));
check('an empty queue is a no-op in the reconstruction effect (early return, no unnecessary setLogEntries call)', /if \(queued\.length === 0\) return;/.test(pageSource));

check('handleLogActivity is unchanged: still returns Promise<\'confirmed\' | \'pending\'>', /Promise<'confirmed' \| 'pending'>/.test(pageSource));
check(
  'the only change to handleLogActivity itself is stamping the already-generated clientRequestId onto the pending-marked entry',
  /prev\.map\(\(item\) => \(item\.id === tempId \? \{ \.\.\.item, syncStatus: 'pending', clientRequestId \} : item\)\)\);/.test(pageSource)
);
check('handleLogActivity\'s optimistic-entry literal (before the request) and offline-queue push are untouched', /const optimisticEntry: LoggedEntryItem = \{\s*id: tempId,\s*activityTitle,\s*activeWindow: activeWindowForLog,\s*loggedAt: targetDate,\s*logMinuteOfDay: calculatedMinute,\s*durationMinutes,\s*notes: notes \? String\(notes\)\.trim\(\) : null,\s*logSource: finalLogSource,\s*activitySignificance: inferredSignificance,\s*\};/.test(pageSource));
check('page.tsx still generates clientRequestId once per log attempt via crypto.randomUUID() (PR #86 idempotency untouched)', /const clientRequestId = crypto\.randomUUID\(\);/.test(pageSource));
check('page.tsx still imports classifyHabitLogSyncOutcome for offline-queue replay (PR #86 untouched)', /classifyHabitLogSyncOutcome/.test(pageSource));
check('the Offline Log Sync Listener queue-removal/retention logic is untouched (still classifies confirmed/retry/permanent-failure)', /const outcome = classifyHabitLogSyncOutcome\(res\.status\);/.test(pageSource));
check('Plan logging (handlePlanLogged) remains separate and untouched in page.tsx', /const handlePlanLogged = useCallback\(async \(\) => \{/.test(pageSource));
check('Timing Location save orchestration (handleLocationChanged) remains untouched in page.tsx', /const handleLocationChanged = useCallback\(async \(city: \{/.test(pageSource));
check('LocationPicker.tsx was not touched by this change (no reference to offlineHabitQueue there)', !fs.existsSync('apps/web/components/LocationPicker.tsx') || !/offlineHabitQueue/.test(fs.readFileSync('apps/web/components/LocationPicker.tsx', 'utf8')));

// PR #90's presentation surfaces and confirmed-only Insights evidence
// boundary are untouched by this PR -- reconstructed entries flow
// through the exact same syncStatus discriminator those already branch
// on, so no new presentation logic was (or needed to be) added.
check('CalendarViewSection.tsx\'s pending-row StatusBadge treatment (PR #90) is untouched', /log\.syncStatus === 'pending' \?[\s\S]*?<StatusBadge label="Pending sync" tone="caution" \/>/.test(calendarSource));
check('Timeline.tsx\'s PR #90 pending count/badge treatment is untouched', /windowPendingCount = windowLogs\.filter\(\(log\) => log\.syncStatus === 'pending'\)\.length/.test(timelineSource));
check('InsightsView.tsx\'s PR #90 confirmed-only evidence filter is untouched', /const confirmedLogEntries = logEntries\.filter\(\(entry\) => entry\.syncStatus !== 'pending'\);/.test(insightsSource));
check('InsightsView.tsx\'s Recent Activity Trail still visibly labels a pending entry (untouched)', /entry\.syncStatus === 'pending' && <StatusBadge label="Pending sync" tone="caution" \/>/.test(insightsSource));

if (!allPassed) {
  console.error('\nSome Pending Activity Reload Visibility checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL PENDING ACTIVITY RELOAD VISIBILITY CHECKS PASSED');
}
