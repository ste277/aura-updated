/**
 * Goals V2 Rhythm R2 -- pure domain tests for GoalActivityRhythm: validation,
 * normalization, persistence shape, the local-calendar-week convention, and
 * the pure eligibility engine. No DB access -- see
 * test/goalActivityRhythmDb.test.ts for the live-database fact loader and
 * persistence round-trip proof.
 */
import {
  validateGoalActivityRhythm,
  normalizeGoalActivityRhythm,
  toPersistedGoalActivityRhythm,
  NONE_GOAL_ACTIVITY_RHYTHM,
  localCalendarWeekStart,
  deriveGoalActivityRhythmContribution,
  computeGoalActivityRhythmEligibility,
  resolveOccurrenceLocalDate,
  type GoalActivityRhythmOccurrenceFact,
} from '../apps/web/lib/goalActivityRhythm';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// 6. Validation
// ============================================================
check('6. NONE validates with no targetPerWeek', (() => { const r = validateGoalActivityRhythm({ kind: 'NONE' }); return r.ok && r.rhythm.kind === 'NONE' && r.rhythm.targetPerWeek === undefined; })());
check('6. NONE rejects a supplied targetPerWeek', validateGoalActivityRhythm({ kind: 'NONE', targetPerWeek: 3 }).ok === false);
check('6. N_PER_WEEK(3) validates', (() => { const r = validateGoalActivityRhythm({ kind: 'N_PER_WEEK', targetPerWeek: 3 }); return r.ok && r.rhythm.kind === 'N_PER_WEEK' && r.rhythm.targetPerWeek === 3; })());
check('6. N_PER_WEEK rejects 0', validateGoalActivityRhythm({ kind: 'N_PER_WEEK', targetPerWeek: 0 }).ok === false);
check('6. N_PER_WEEK rejects negative', validateGoalActivityRhythm({ kind: 'N_PER_WEEK', targetPerWeek: -1 }).ok === false);
check('6. N_PER_WEEK rejects fractional', validateGoalActivityRhythm({ kind: 'N_PER_WEEK', targetPerWeek: 2.5 }).ok === false);
check('6. N_PER_WEEK rejects missing targetPerWeek', validateGoalActivityRhythm({ kind: 'N_PER_WEEK' }).ok === false);
check('6. N_PER_WEEK rejects NaN', validateGoalActivityRhythm({ kind: 'N_PER_WEEK', targetPerWeek: NaN }).ok === false);
check('6. N_PER_WEEK rejects Infinity', validateGoalActivityRhythm({ kind: 'N_PER_WEEK', targetPerWeek: Infinity }).ok === false);
check('6. unknown kind rejected', validateGoalActivityRhythm({ kind: 'DAILY' }).ok === false);
check('6. no arbitrary maximum imposed (e.g. 7/week accepted)', validateGoalActivityRhythm({ kind: 'N_PER_WEEK', targetPerWeek: 7 }).ok === true);

// ============================================================
// 7. Normalization
// ============================================================
check('7. null rhythmKind normalizes to NONE', normalizeGoalActivityRhythm({ rhythmKind: null, rhythmTargetPerWeek: null }).kind === 'NONE');
check('7. valid persisted N_PER_WEEK(5) normalizes exactly', (() => { const r = normalizeGoalActivityRhythm({ rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 5 }); return r.kind === 'N_PER_WEEK' && r.targetPerWeek === 5; })());
check('7. corrupt/unknown persisted kind normalizes to NONE, never thrown', normalizeGoalActivityRhythm({ rhythmKind: 'WEEKLY_CUSTOM', rhythmTargetPerWeek: 3 }).kind === 'NONE');
check('7. N_PER_WEEK persisted with an invalid target (0) normalizes to NONE, never silently becomes recurrent with a bad number', normalizeGoalActivityRhythm({ rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 0 }).kind === 'NONE');
check('7. N_PER_WEEK persisted with a null target normalizes to NONE', normalizeGoalActivityRhythm({ rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: null }).kind === 'NONE');

// ============================================================
// toPersisted round-trip
// ============================================================
check('toPersisted: NONE -> both columns null', (() => { const p = toPersistedGoalActivityRhythm(NONE_GOAL_ACTIVITY_RHYTHM); return p.rhythmKind === null && p.rhythmTargetPerWeek === null; })());
check('toPersisted: N_PER_WEEK(2) -> exact columns', (() => { const p = toPersistedGoalActivityRhythm({ kind: 'N_PER_WEEK', targetPerWeek: 2 }); return p.rhythmKind === 'N_PER_WEEK' && p.rhythmTargetPerWeek === 2; })());
check('round-trip: toPersisted then normalize returns the identical rhythm', (() => { const original = { kind: 'N_PER_WEEK' as const, targetPerWeek: 4 }; const back = normalizeGoalActivityRhythm(toPersistedGoalActivityRhythm(original)); return back.kind === 'N_PER_WEEK' && back.targetPerWeek === 4; })());

// ============================================================
// 10. Local calendar week (Monday-anchored)
// ============================================================
check('10. a Monday is its own week start', localCalendarWeekStart('2026-09-21') === '2026-09-21'); // 2026-09-21 is a Monday
check('10. a Tuesday belongs to the preceding Monday', localCalendarWeekStart('2026-09-22') === '2026-09-21');
check('10. a Sunday belongs to the PRECEDING Monday, not the next one', localCalendarWeekStart('2026-09-27') === '2026-09-21'); // 2026-09-27 is a Sunday
check('10. the following Monday starts a NEW week', localCalendarWeekStart('2026-09-28') === '2026-09-28');
check('10. week-start is idempotent (week-start of a week-start is itself)', localCalendarWeekStart(localCalendarWeekStart('2026-09-24')) === localCalendarWeekStart('2026-09-24'));

// ============================================================
// 14. occurrence-status interpretation
// ============================================================
check('14. LOGGED -> COMPLETED', deriveGoalActivityRhythmContribution('LOGGED') === 'COMPLETED');
check('14. UPCOMING -> COMMITTED', deriveGoalActivityRhythmContribution('UPCOMING') === 'COMMITTED');
check('16. SKIPPED -> NONE (does not consume capacity)', deriveGoalActivityRhythmContribution('SKIPPED') === 'NONE');
check('17. CANCELLED -> NONE (same treatment as SKIPPED, documented decision)', deriveGoalActivityRhythmContribution('CANCELLED') === 'NONE');
check('15. MOVED -> NONE (fails safe; a correct caller never reads a fact off a MOVED row at all)', deriveGoalActivityRhythmContribution('MOVED') === 'NONE');

// ============================================================
// 35. Pure eligibility test matrix
// ============================================================
const fact = (localDate: string, contribution: GoalActivityRhythmOccurrenceFact['contribution']): GoalActivityRhythmOccurrenceFact => ({ localDate, contribution });
const MON = '2026-09-21'; // the week of 2026-09-21..2026-09-27
const PLANNING = MON; // planning date itself, mid-week also tested separately below

check('12. NONE -> never Rhythm-eligible, remaining 0, regardless of any facts', computeGoalActivityRhythmEligibility({ rhythm: { kind: 'NONE' }, planningLocalDate: PLANNING, occurrences: [fact(MON, 'COMPLETED'), fact(MON, 'COMPLETED')] }).eligible === false && computeGoalActivityRhythmEligibility({ rhythm: { kind: 'NONE' }, planningLocalDate: PLANNING, occurrences: [] }).remainingOccurrences === 0);

// 1/week
check('1/week, 0 completed 0 committed -> remaining 1, eligible', (() => { const r = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 }, planningLocalDate: PLANNING, occurrences: [] }); return r.eligible === true && r.remainingOccurrences === 1; })());
check('1/week, 1 completed -> remaining 0, not eligible', (() => { const r = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 }, planningLocalDate: PLANNING, occurrences: [fact(MON, 'COMPLETED')] }); return r.eligible === false && r.remainingOccurrences === 0; })());
check('1/week, 1 committed -> remaining 0, not eligible (this ticket\'s own section 13 correction)', (() => { const r = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 }, planningLocalDate: PLANNING, occurrences: [fact(MON, 'COMMITTED')] }); return r.eligible === false && r.remainingOccurrences === 0; })());

// 3/week full matrix
const threePerWeek = (occurrences: GoalActivityRhythmOccurrenceFact[]) => computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, planningLocalDate: PLANNING, occurrences });
check('3/week, 0/0 -> remaining 3', threePerWeek([]).remainingOccurrences === 3);
check('3/week, 1 completed/0 committed -> remaining 2', threePerWeek([fact(MON, 'COMPLETED')]).remainingOccurrences === 2);
check('3/week, 0 completed/1 committed -> remaining 2', threePerWeek([fact(MON, 'COMMITTED')]).remainingOccurrences === 2);
check('3/week, 1 completed/1 committed -> remaining 1', threePerWeek([fact(MON, 'COMPLETED'), fact(MON, 'COMMITTED')]).remainingOccurrences === 1);
check('3/week, 2 completed/1 committed -> remaining 0 (the ticket\'s own worked example)', threePerWeek([fact(MON, 'COMPLETED'), fact(MON, 'COMPLETED'), fact(MON, 'COMMITTED')]).remainingOccurrences === 0);
check('3/week, 3 completed -> remaining 0', threePerWeek([fact(MON, 'COMPLETED'), fact(MON, 'COMPLETED'), fact(MON, 'COMPLETED')]).remainingOccurrences === 0);
check('3/week, 4 completed (over target) -> remaining clamped to 0, never negative', threePerWeek([fact(MON, 'COMPLETED'), fact(MON, 'COMPLETED'), fact(MON, 'COMPLETED'), fact(MON, 'COMPLETED')]).remainingOccurrences === 0);

check('16. a SKIPPED fact does not consume capacity (3/week, 1 completed + 1 skipped -> remaining 2, not 1)', threePerWeek([fact(MON, 'COMPLETED'), fact(MON, 'NONE')]).remainingOccurrences === 2);
check('17. a CANCELLED fact does not consume capacity (same as SKIPPED -- both map to NONE contribution)', threePerWeek([fact(MON, 'NONE'), fact(MON, 'NONE')]).remainingOccurrences === 3);

// Move safety (15): simulate the pure model's own invariant directly -- a
// caller that (incorrectly) fed BOTH a stale MOVED-away fact and its
// successor's fact would still be safe, because deriveGoalActivityRhythmContribution
// maps MOVED to NONE unconditionally; a CORRECT caller never does this at
// all (R1's own plannedActivityId uniqueness prevents two live facts for
// one occurrence), but this proves the engine fails safe either way.
check('15. a stale MOVED-mapped fact never contributes, even if a caller mistakenly included one alongside its successor\'s UPCOMING fact', threePerWeek([fact(MON, 'NONE'), fact(MON, 'COMMITTED')]).remainingOccurrences === 2);

// ============================================================
// 19. Week reset / no carry-over debt
// ============================================================
const PREV_WEEK = '2026-09-14'; // the Monday of the week BEFORE MON
check('19. a PRIOR week\'s completions do not reduce the CURRENT week\'s remaining capacity', threePerWeek([fact(PREV_WEEK, 'COMPLETED'), fact(PREV_WEEK, 'COMPLETED')]).remainingOccurrences === 3);
check('19. a PRIOR week\'s skip is irrelevant either way (it never consumed anything to begin with)', threePerWeek([fact(PREV_WEEK, 'NONE')]).remainingOccurrences === 3);
check('19. a PRIOR week\'s commitment (now necessarily resolved/expired) does not reduce current remaining', threePerWeek([fact(PREV_WEEK, 'COMMITTED')]).remainingOccurrences === 3);

// ============================================================
// 20. planning-date-driven week selection (not server "now")
// ============================================================
const SUN_BEFORE = '2026-09-20'; // Sunday, belongs to the week starting 2026-09-14
const MON_AFTER = '2026-09-21'; // Monday, belongs to the NEW week
check('20. planning for Sunday (end of one week) only counts THAT week\'s facts', computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, planningLocalDate: SUN_BEFORE, occurrences: [fact(SUN_BEFORE, 'COMPLETED')] }).remainingOccurrences === 2);
check('20. planning for the VERY NEXT DAY (Monday, a new week) ignores the prior week\'s completion entirely -- "Sunday planning Monday" belongs to the new week', computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, planningLocalDate: MON_AFTER, occurrences: [fact(SUN_BEFORE, 'COMPLETED')] }).remainingOccurrences === 3);

// ============================================================
// 36. Timezone test matrix -- the week boundary must be computed from the
// USER's local date (via getDatePartsInTimezone), never the machine/UTC
// date. A single UTC instant near a day boundary resolves to a DIFFERENT
// local date (and sometimes a different local week) depending on timezone.
// ============================================================
{
  // 2026-09-27T23:30:00Z: a Sunday night in UTC, but already Monday morning
  // in Asia/Kolkata (UTC+5:30) -- the new week has already begun there.
  const instant = new Date('2026-09-27T23:30:00Z');
  const utcLocal = getDatePartsInTimezone('UTC', instant).dateStr;
  const kolkataLocal = getDatePartsInTimezone('Asia/Kolkata', instant).dateStr;
  const nyLocal = getDatePartsInTimezone('America/New_York', instant).dateStr;
  check('36. the SAME instant resolves to different local dates across timezones (not relying on machine/UTC time)', utcLocal === '2026-09-27' && kolkataLocal === '2026-09-28' && nyLocal === '2026-09-27');
  check('36. UTC: this instant is still in the OLD week (week start 2026-09-21)', localCalendarWeekStart(utcLocal) === '2026-09-21');
  check('36. Asia/Kolkata: the SAME instant is already in the NEW week (week start 2026-09-28) -- a local-week boundary crossed purely by timezone, not by time passing', localCalendarWeekStart(kolkataLocal) === '2026-09-28');
  check('36. America/New_York: still the old week, same as UTC for this particular instant', localCalendarWeekStart(nyLocal) === '2026-09-21');

  // Eligibility itself must reflect this: a completion logged "at" this
  // instant, localized per-user, lands in different weeks for different
  // users -- proving the pure engine's week math is genuinely
  // timezone-sensitive end-to-end, not just at the date-string layer.
  const kolkataEligibility = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 }, planningLocalDate: kolkataLocal, occurrences: [fact(utcLocal, 'COMPLETED')] });
  check('36. a completion whose own local date falls in the OLD week does not satisfy a NEW week\'s target for a Kolkata user planning the new week', kolkataEligibility.eligible === true && kolkataEligibility.remainingOccurrences === 1);
}

// ============================================================
// Insights V1 PR2 -- resolveOccurrenceLocalDate: prefers a written
// scheduled-week snapshot over live re-derivation, and fails safely
// (throws) rather than silently combining a partially-populated one.
// ============================================================
{
  const plannedStartAt = new Date('2026-10-14T10:00:00Z'); // a Wednesday
  const liveDerivedForUtc = getDatePartsInTimezone('UTC', plannedStartAt).dateStr; // '2026-10-14'

  check('37. a fully-populated snapshot (both fields set) is preferred verbatim, even when it disagrees with what live derivation would produce', resolveOccurrenceLocalDate({ scheduledWeekStart: '2026-09-28', scheduledWeekTimezone: 'Asia/Kolkata' }, plannedStartAt, 'UTC') === '2026-09-28');
  check('38. a fully-NULL snapshot (both fields null) falls back to exact live derivation under the CALLER-supplied (current) timezone', resolveOccurrenceLocalDate({ scheduledWeekStart: null, scheduledWeekTimezone: null }, plannedStartAt, 'UTC') === liveDerivedForUtc);
  check('39. a partial snapshot (scheduledWeekStart set, scheduledWeekTimezone null) is refused -- throws, never silently falls back or blends', (() => {
    try { resolveOccurrenceLocalDate({ scheduledWeekStart: '2026-09-28', scheduledWeekTimezone: null }, plannedStartAt, 'UTC'); return false; } catch { return true; }
  })());
  check('39. the OTHER partial direction (scheduledWeekTimezone set, scheduledWeekStart null) is refused identically', (() => {
    try { resolveOccurrenceLocalDate({ scheduledWeekStart: null, scheduledWeekTimezone: 'Asia/Kolkata' }, plannedStartAt, 'UTC'); return false; } catch { return true; }
  })());
  check('40. a snapshot\'s own scheduledWeekStart, fed back through localCalendarWeekStart (exactly what computeGoalActivityRhythmEligibility does to every fact\'s localDate), is idempotent -- an already-Monday date reduces to itself', (() => {
    const snapshotWeekStart = resolveOccurrenceLocalDate({ scheduledWeekStart: '2026-09-28', scheduledWeekTimezone: 'Asia/Kolkata' }, plannedStartAt, 'UTC');
    return localCalendarWeekStart(snapshotWeekStart) === snapshotWeekStart && snapshotWeekStart === '2026-09-28';
  })());
}

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY RHYTHM CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY RHYTHM CHECKS PASSED');
