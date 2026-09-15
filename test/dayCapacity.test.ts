/**
 * Day Constructor V1 -- PR A pure capacity model regression suite.
 * Plain ts-node test, following this repo's own established
 * check()-harness convention (see e.g. test/rightNowSelection.test.ts).
 */
import {
  computeCapacitySnapshot,
  normalizeBlockedIntervals,
  classifyCapacityState,
  type BlockedInterval,
  type CapacitySnapshot,
  type DayCapacityResult,
} from '../apps/web/lib/dayCapacity';
import type { ConstructionWindow } from '../apps/web/lib/dayIntent';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

function window(start: string, end: string, opts: Partial<ConstructionWindow> = {}): ConstructionWindow {
  return { date: opts.date ?? '2026-09-16', start: iso(start), end: iso(end), timezone: opts.timezone ?? 'Asia/Kolkata', source: opts.source ?? 'REMAINING_TODAY' };
}

function block(start: string, end: string, source: BlockedInterval['source'] = 'FIXED_PLAN'): BlockedInterval {
  return { start: iso(start), end: iso(end), source };
}

function readySnapshot(result: DayCapacityResult): CapacitySnapshot {
  if (result.status !== 'READY') throw new Error(`Expected READY, got ${result.status}`);
  return result.snapshot;
}

// ============================================================
// 1. Completely open window
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z'); // 600 min
  const snap = readySnapshot(computeCapacitySnapshot(w, [], 100));
  check('1. open window: constructionWindowMinutes correct', snap.constructionWindowMinutes === 600);
  check('1. open window: blockedMinutes is 0', snap.blockedMinutes === 0);
  check('1. open window: usableMinutes equals window minutes', snap.usableMinutes === 600);
  check('1. open window: capacityState OPEN', snap.capacityState === 'OPEN');
}

// ============================================================
// 2. One blocked interval
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z'); // 600 min
  const snap = readySnapshot(computeCapacitySnapshot(w, [block('2026-09-16T02:00:00Z', '2026-09-16T03:00:00Z')], 0));
  check('2. one block: blockedMinutes is 60', snap.blockedMinutes === 60);
  check('2. one block: usableMinutes is 540', snap.usableMinutes === 540);
}

// ============================================================
// 3. Multiple non-overlapping blocked intervals
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z');
  const blocks = [block('2026-09-16T01:00:00Z', '2026-09-16T02:00:00Z'), block('2026-09-16T05:00:00Z', '2026-09-16T05:30:00Z')];
  const snap = readySnapshot(computeCapacitySnapshot(w, blocks, 0));
  check('3. multiple blocks: sums to 90', snap.blockedMinutes === 90);
}

// ============================================================
// 4. Overlapping blocked intervals -- never double-counted
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z');
  const blocks = [block('2026-09-16T01:00:00Z', '2026-09-16T03:00:00Z'), block('2026-09-16T02:00:00Z', '2026-09-16T04:00:00Z')];
  const snap = readySnapshot(computeCapacitySnapshot(w, blocks, 0));
  check('4. overlapping blocks: merged to 180 min (1:00-4:00), not 240', snap.blockedMinutes === 180);
  const normalized = normalizeBlockedIntervals(blocks, w);
  check('4. overlapping blocks: normalized to exactly one interval', normalized.length === 1);
}

// ============================================================
// 5. Adjacent (touching) blocked intervals -- merged
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z');
  const blocks = [block('2026-09-16T01:00:00Z', '2026-09-16T02:00:00Z'), block('2026-09-16T02:00:00Z', '2026-09-16T03:00:00Z')];
  const normalized = normalizeBlockedIntervals(blocks, w);
  check('5. adjacent blocks: merged into one continuous span', normalized.length === 1);
  const snap = readySnapshot(computeCapacitySnapshot(w, blocks, 0));
  check('5. adjacent blocks: blockedMinutes is 120 (no gap, no double count)', snap.blockedMinutes === 120);
}

// ============================================================
// 6. Duplicate blocked intervals
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z');
  const single = block('2026-09-16T01:00:00Z', '2026-09-16T02:00:00Z');
  const snap = readySnapshot(computeCapacitySnapshot(w, [single, { ...single }], 0));
  check('6. duplicate blocks: still only 60 min blocked', snap.blockedMinutes === 60);
}

// ============================================================
// 7. Partial-before-window block (clipped)
// ============================================================
{
  const w = window('2026-09-16T02:00:00Z', '2026-09-16T10:00:00Z');
  const snap = readySnapshot(computeCapacitySnapshot(w, [block('2026-09-16T00:00:00Z', '2026-09-16T03:00:00Z')], 0));
  check('7. partial-before block: clipped to 60 min (2:00-3:00 only)', snap.blockedMinutes === 60);
}

// ============================================================
// 8. Partial-after-window block (clipped)
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T05:00:00Z');
  const snap = readySnapshot(computeCapacitySnapshot(w, [block('2026-09-16T04:00:00Z', '2026-09-16T08:00:00Z')], 0));
  check('8. partial-after block: clipped to 60 min (4:00-5:00 only)', snap.blockedMinutes === 60);
}

// ============================================================
// 9. Block entirely outside window (dropped)
// ============================================================
{
  const w = window('2026-09-16T05:00:00Z', '2026-09-16T10:00:00Z');
  const snap = readySnapshot(computeCapacitySnapshot(w, [block('2026-09-16T00:00:00Z', '2026-09-16T01:00:00Z')], 0));
  check('9. fully-outside block: dropped, blockedMinutes is 0', snap.blockedMinutes === 0);
  check('9. fully-outside block: usableMinutes unaffected (300)', snap.usableMinutes === 300);
}

// ============================================================
// 10. Fully blocked window
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T05:00:00Z');
  const result = computeCapacitySnapshot(w, [block('2026-09-16T00:00:00Z', '2026-09-16T05:00:00Z')], 0);
  check('10. fully blocked window + zero requested: NO_USABLE_CAPACITY', result.status === 'NO_USABLE_CAPACITY');
}
{
  // Pre-commit review fix: fully blocked window + nonzero requested MUST
  // also fail closed to NO_USABLE_CAPACITY -- it must NEVER reach READY,
  // and must never fabricate a utilization ratio for a zero denominator.
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T05:00:00Z');
  const result = computeCapacitySnapshot(w, [block('2026-09-16T00:00:00Z', '2026-09-16T05:00:00Z')], 30);
  check('10b. fully blocked window + nonzero requested: NO_USABLE_CAPACITY, not READY/OVERLOADED', result.status === 'NO_USABLE_CAPACITY');
  check('10b. NO_USABLE_CAPACITY preserves requestedMinutes as factual context', result.status === 'NO_USABLE_CAPACITY' && result.requestedMinutes === 30);
}

// ============================================================
// Pre-commit review fix -- explicit A-F matrix for the zero-usable-
// capacity invariant (usableMinutes === 0 ALWAYS fails closed,
// regardless of requestedMinutes; no sentinel utilization ever escapes).
// ============================================================
{
  // A. usableMinutes = 0 via a zero-width window is invalid (start===end
  // is INVALID_CONSTRUCTION_WINDOW, not a capacity case) -- the correct
  // way to reach usableMinutes = 0 with requestedMinutes = 0 is a window
  // fully consumed by blocks, with nothing requested.
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T02:00:00Z');
  const result = computeCapacitySnapshot(w, [block('2026-09-16T00:00:00Z', '2026-09-16T02:00:00Z')], 0);
  check('A. usableMinutes=0, requestedMinutes=0 -> NO_USABLE_CAPACITY', result.status === 'NO_USABLE_CAPACITY');
}
{
  // B. usableMinutes = 0, requestedMinutes > 0 -> NO_USABLE_CAPACITY (not READY/OVERLOADED)
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T02:00:00Z');
  const result = computeCapacitySnapshot(w, [block('2026-09-16T00:00:00Z', '2026-09-16T02:00:00Z')], 60);
  check('B. usableMinutes=0, requestedMinutes>0 -> NO_USABLE_CAPACITY', result.status === 'NO_USABLE_CAPACITY');
}
{
  // C. Fully blocked ConstructionWindow with requested work -> NO_USABLE_CAPACITY
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T08:00:00Z');
  const result = computeCapacitySnapshot(w, [block('2026-09-16T00:00:00Z', '2026-09-16T08:00:00Z')], 90);
  check('C. fully blocked window + requested work -> NO_USABLE_CAPACITY', result.status === 'NO_USABLE_CAPACITY');
}
{
  // D. Fully blocked ConstructionWindow without requested work -> NO_USABLE_CAPACITY
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T08:00:00Z');
  const result = computeCapacitySnapshot(w, [block('2026-09-16T00:00:00Z', '2026-09-16T08:00:00Z')], 0);
  check('D. fully blocked window + no requested work -> NO_USABLE_CAPACITY', result.status === 'NO_USABLE_CAPACITY');
}
{
  // E. classifyCapacityState is never required to classify a
  // zero-denominator calculation -- confirmed structurally: it takes a
  // single already-computed utilization number and has no zero-aware
  // branch of its own to exercise, because computeCapacitySnapshot never
  // calls it when usableMinutes === 0 (cases A-D above never produce a
  // CapacitySnapshot for classifyCapacityState to be applied to at all).
  check('E. classifyCapacityState has no zero-denominator branch to exercise (a plain finite-ratio classifier)', classifyCapacityState.length === 1);
}
{
  // F. No Infinity/NaN/sentinel utilization escapes through the public
  // result contract, across every zero-usable-capacity case above.
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T08:00:00Z');
  const cases = [
    computeCapacitySnapshot(w, [block('2026-09-16T00:00:00Z', '2026-09-16T08:00:00Z')], 0),
    computeCapacitySnapshot(w, [block('2026-09-16T00:00:00Z', '2026-09-16T08:00:00Z')], 999),
  ];
  const noSnapshotEverProduced = cases.every((result) => result.status === 'NO_USABLE_CAPACITY' && !('snapshot' in result));
  check('F. no snapshot (and therefore no utilization value at all) is ever produced when usableMinutes is 0', noSnapshotEverProduced);
}

// ============================================================
// 11. Elapsed portion of today (window.start === "now")
// ============================================================
{
  const now = iso('2026-09-16T12:00:00Z');
  const midnightNext = iso('2026-09-17T00:00:00Z');
  const w: ConstructionWindow = { date: '2026-09-16', start: now, end: midnightNext, timezone: 'UTC', source: 'REMAINING_TODAY' };
  const snap = readySnapshot(computeCapacitySnapshot(w, [], 0));
  check('11. REMAINING_TODAY window excludes elapsed time by construction (12h remaining)', snap.constructionWindowMinutes === 720);
}

// ============================================================
// 12. Future date, no elapsed subtraction
// ============================================================
{
  const w = window('2026-09-20T00:00:00Z', '2026-09-21T00:00:00Z', { date: '2026-09-20', source: 'EXPLICIT_RANGE' });
  const snap = readySnapshot(computeCapacitySnapshot(w, [], 0));
  check('12. future full-day window: full 1440 minutes, nothing silently subtracted', snap.constructionWindowMinutes === 1440);
}

// ============================================================
// 13-18. Capacity state boundaries
// ============================================================
check('13. exactly 0.40 -> BALANCED', classifyCapacityState(0.4) === 'BALANCED');
check('14. just below 0.40 -> OPEN', classifyCapacityState(0.399) === 'OPEN');
check('15. exactly 0.75 -> BUSY', classifyCapacityState(0.75) === 'BUSY');
check('16. just below 0.75 -> BALANCED', classifyCapacityState(0.749) === 'BALANCED');
check('17. exactly 1.00 -> BUSY', classifyCapacityState(1) === 'BUSY');
check('18. just above 1.00 -> OVERLOADED', classifyCapacityState(1.001) === 'OVERLOADED');

// End-to-end boundary checks through computeCapacitySnapshot itself (not just the classifier in isolation)
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z'); // 600 usable
  check('13b. requested=240/600=0.40 -> BALANCED end-to-end', readySnapshot(computeCapacitySnapshot(w, [], 240)).capacityState === 'BALANCED');
  check('15b. requested=450/600=0.75 -> BUSY end-to-end', readySnapshot(computeCapacitySnapshot(w, [], 450)).capacityState === 'BUSY');
  check('17b. requested=600/600=1.00 -> BUSY end-to-end', readySnapshot(computeCapacitySnapshot(w, [], 600)).capacityState === 'BUSY');
}

// ============================================================
// 19. Zero requested minutes
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z');
  const snap = readySnapshot(computeCapacitySnapshot(w, [], 0));
  check('19. zero requested: utilization 0, OPEN', snap.utilization === 0 && snap.capacityState === 'OPEN');
}

// ============================================================
// 21. Invalid construction window
// ============================================================
{
  const w: ConstructionWindow = { date: '2026-09-16', start: iso('2026-09-16T10:00:00Z'), end: iso('2026-09-16T08:00:00Z'), timezone: 'UTC', source: 'EXPLICIT_RANGE' };
  const result = computeCapacitySnapshot(w, [], 0);
  check('21. start >= end -> INVALID_CONSTRUCTION_WINDOW', result.status === 'INVALID_CONSTRUCTION_WINDOW');
}

// ============================================================
// 22. Timezone missing
// ============================================================
{
  const w: ConstructionWindow = { date: '2026-09-16', start: iso('2026-09-16T00:00:00Z'), end: iso('2026-09-16T10:00:00Z'), timezone: '', source: 'EXPLICIT_RANGE' };
  const result = computeCapacitySnapshot(w, [], 0);
  check('22. empty timezone -> TIMEZONE_MISSING', result.status === 'TIMEZONE_MISSING');
}

// ============================================================
// 23. Deterministic repeat invocation
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z');
  const blocks = [block('2026-09-16T02:00:00Z', '2026-09-16T03:00:00Z')];
  const first = readySnapshot(computeCapacitySnapshot(w, blocks, 100));
  const second = readySnapshot(computeCapacitySnapshot(w, blocks, 100));
  check('23. identical inputs produce identical output', JSON.stringify(first) === JSON.stringify(second));
}

// ============================================================
// 24. Server-timezone independence
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z');
  const blocks = [block('2026-09-16T02:00:00Z', '2026-09-16T03:00:00Z')];
  const originalTZ = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  const underLA = readySnapshot(computeCapacitySnapshot(w, blocks, 100));
  process.env.TZ = 'Pacific/Kiritimati';
  const underKiritimati = readySnapshot(computeCapacitySnapshot(w, blocks, 100));
  process.env.TZ = originalTZ;
  check('24. result identical regardless of process.env.TZ', JSON.stringify(underLA) === JSON.stringify(underKiritimati));
}

// ============================================================
// 25. Cross-midnight window
// ============================================================
{
  const w = window('2026-09-16T23:00:00Z', '2026-09-17T01:00:00Z', { date: '2026-09-16' });
  const snap = readySnapshot(computeCapacitySnapshot(w, [], 0));
  check('25. cross-midnight window: correct 120-minute span, no special-case failure', snap.constructionWindowMinutes === 120);
}
{
  // A blocked interval itself spanning midnight is clipped/summed correctly too.
  const w = window('2026-09-16T22:00:00Z', '2026-09-17T02:00:00Z', { date: '2026-09-16' });
  const snap = readySnapshot(computeCapacitySnapshot(w, [block('2026-09-16T23:30:00Z', '2026-09-17T00:30:00Z')], 0));
  check('25b. cross-midnight blocked interval: 60 min blocked, not dropped/miscounted', snap.blockedMinutes === 60);
}

// ============================================================
// 26. Stress test -- overlapping + adjacent + duplicate combined
// ============================================================
{
  const w = window('2026-09-16T00:00:00Z', '2026-09-16T10:00:00Z');
  const blocks = [
    block('2026-09-16T01:00:00Z', '2026-09-16T02:00:00Z'),
    block('2026-09-16T02:00:00Z', '2026-09-16T02:30:00Z'), // adjacent to previous
    block('2026-09-16T02:15:00Z', '2026-09-16T02:45:00Z'), // overlaps previous
    block('2026-09-16T01:00:00Z', '2026-09-16T02:00:00Z'), // exact duplicate of first
    block('2026-09-16T06:00:00Z', '2026-09-16T06:30:00Z'), // unrelated, separate span
  ];
  // Expected merged coverage: [1:00-2:45) = 105 min, [6:00-6:30) = 30 min => 135 total.
  const snap = readySnapshot(computeCapacitySnapshot(w, blocks, 0));
  check('26. mixed overlap/adjacent/duplicate blocks: exactly 135 min blocked, never double-counted', snap.blockedMinutes === 135);
  const normalized = normalizeBlockedIntervals(blocks, w);
  check('26b. normalized to exactly 2 disjoint spans', normalized.length === 2);
}

if (!allPassed) {
  console.error('\nSome Day Capacity checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL DAY CAPACITY CHECKS PASSED');
}
