/**
 * HPG3-A1 -- pure domain tests for GoalActivityDailyFrequency: validation,
 * normalization, persistence shape, the enforceability predicate, and the
 * scheduledLocalDate/scheduledLocalTimezone pair validator. No DB access --
 * see test/goalActivityDailyFrequencySchemaDb.test.ts for the live-database
 * migration/column proof.
 */
import {
  validateGoalActivityDailyFrequency,
  normalizeGoalActivityDailyFrequency,
  toPersistedGoalActivityDailyFrequency,
  isGoalActivityDailyFrequencyEnforceable,
  validateScheduledLocalDatePair,
  ONCE_PER_DAY_GOAL_ACTIVITY_DAILY_FREQUENCY,
  GOAL_ACTIVITY_DAILY_FREQUENCY_KINDS,
} from '../apps/web/lib/goalActivityDailyFrequency';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Validation -- ONCE_PER_DAY / MULTIPLE_PER_DAY
// ============================================================
check('ONCE_PER_DAY validates with no limit', (() => { const r = validateGoalActivityDailyFrequency({ kind: 'ONCE_PER_DAY' }); return r.ok && r.frequency.kind === 'ONCE_PER_DAY' && r.frequency.limit === undefined; })());
check('ONCE_PER_DAY rejects a supplied limit', validateGoalActivityDailyFrequency({ kind: 'ONCE_PER_DAY', limit: 2 }).ok === false);
check('MULTIPLE_PER_DAY validates with no limit', (() => { const r = validateGoalActivityDailyFrequency({ kind: 'MULTIPLE_PER_DAY' }); return r.ok && r.frequency.kind === 'MULTIPLE_PER_DAY' && r.frequency.limit === undefined; })());
check('MULTIPLE_PER_DAY rejects a supplied limit', validateGoalActivityDailyFrequency({ kind: 'MULTIPLE_PER_DAY', limit: 5 }).ok === false);

// ============================================================
// Validation -- CUSTOM limit
// ============================================================
check('CUSTOM(3) validates', (() => { const r = validateGoalActivityDailyFrequency({ kind: 'CUSTOM', limit: 3 }); return r.ok && r.frequency.kind === 'CUSTOM' && r.frequency.limit === 3; })());
check('CUSTOM rejects 0', validateGoalActivityDailyFrequency({ kind: 'CUSTOM', limit: 0 }).ok === false);
check('CUSTOM rejects negative', validateGoalActivityDailyFrequency({ kind: 'CUSTOM', limit: -1 }).ok === false);
check('CUSTOM rejects fractional', validateGoalActivityDailyFrequency({ kind: 'CUSTOM', limit: 2.5 }).ok === false);
check('CUSTOM rejects missing limit', validateGoalActivityDailyFrequency({ kind: 'CUSTOM' }).ok === false);
check('CUSTOM rejects null limit', validateGoalActivityDailyFrequency({ kind: 'CUSTOM', limit: null }).ok === false);
check('CUSTOM rejects NaN', validateGoalActivityDailyFrequency({ kind: 'CUSTOM', limit: NaN }).ok === false);
check('CUSTOM rejects Infinity', validateGoalActivityDailyFrequency({ kind: 'CUSTOM', limit: Infinity }).ok === false);
check('no arbitrary maximum imposed on CUSTOM (e.g. 10/day accepted)', validateGoalActivityDailyFrequency({ kind: 'CUSTOM', limit: 10 }).ok === true);

// ============================================================
// Validation -- unknown kind, fail-closed
// ============================================================
check('unknown kind rejected', validateGoalActivityDailyFrequency({ kind: 'DAILY' }).ok === false);
check('undefined kind rejected', validateGoalActivityDailyFrequency({ kind: undefined }).ok === false);
check('null kind rejected', validateGoalActivityDailyFrequency({ kind: null }).ok === false);
check('numeric kind rejected (never coerced to a string match)', validateGoalActivityDailyFrequency({ kind: 1 }).ok === false);
check('GOAL_ACTIVITY_DAILY_FREQUENCY_KINDS lists exactly the three defined kinds', GOAL_ACTIVITY_DAILY_FREQUENCY_KINDS.length === 3 && GOAL_ACTIVITY_DAILY_FREQUENCY_KINDS.includes('ONCE_PER_DAY') && GOAL_ACTIVITY_DAILY_FREQUENCY_KINDS.includes('MULTIPLE_PER_DAY') && GOAL_ACTIVITY_DAILY_FREQUENCY_KINDS.includes('CUSTOM'));

// ============================================================
// CUSTOM must not silently become an enforced scheduling policy
// ============================================================
check('CUSTOM is NOT enforceable', isGoalActivityDailyFrequencyEnforceable('CUSTOM') === false);
check('ONCE_PER_DAY IS enforceable', isGoalActivityDailyFrequencyEnforceable('ONCE_PER_DAY') === true);
check('MULTIPLE_PER_DAY IS enforceable', isGoalActivityDailyFrequencyEnforceable('MULTIPLE_PER_DAY') === true);

// ============================================================
// Normalization -- NULL normalizes to ONCE_PER_DAY
// ============================================================
check('null dailyFrequencyKind normalizes to ONCE_PER_DAY', normalizeGoalActivityDailyFrequency({ dailyFrequencyKind: null, dailyFrequencyLimit: null }).kind === 'ONCE_PER_DAY');
check('valid persisted MULTIPLE_PER_DAY normalizes exactly', normalizeGoalActivityDailyFrequency({ dailyFrequencyKind: 'MULTIPLE_PER_DAY', dailyFrequencyLimit: null }).kind === 'MULTIPLE_PER_DAY');
check('valid persisted CUSTOM(4) normalizes exactly', (() => { const r = normalizeGoalActivityDailyFrequency({ dailyFrequencyKind: 'CUSTOM', dailyFrequencyLimit: 4 }); return r.kind === 'CUSTOM' && r.limit === 4; })());
check('corrupt/unknown persisted kind normalizes to ONCE_PER_DAY, never thrown', normalizeGoalActivityDailyFrequency({ dailyFrequencyKind: 'HOURLY', dailyFrequencyLimit: null }).kind === 'ONCE_PER_DAY');
check('CUSTOM persisted with an invalid limit (0) normalizes to ONCE_PER_DAY, never silently becomes MULTIPLE_PER_DAY with a bad number', normalizeGoalActivityDailyFrequency({ dailyFrequencyKind: 'CUSTOM', dailyFrequencyLimit: 0 }).kind === 'ONCE_PER_DAY');
check('CUSTOM persisted with a null limit normalizes to ONCE_PER_DAY (the SAFER default, never the more permissive MULTIPLE_PER_DAY)', normalizeGoalActivityDailyFrequency({ dailyFrequencyKind: 'CUSTOM', dailyFrequencyLimit: null }).kind === 'ONCE_PER_DAY');

// ============================================================
// toPersisted round-trip
// ============================================================
check('toPersisted: ONCE_PER_DAY -> both columns null', (() => { const p = toPersistedGoalActivityDailyFrequency(ONCE_PER_DAY_GOAL_ACTIVITY_DAILY_FREQUENCY); return p.dailyFrequencyKind === null && p.dailyFrequencyLimit === null; })());
check('toPersisted: MULTIPLE_PER_DAY -> kind set, limit null', (() => { const p = toPersistedGoalActivityDailyFrequency({ kind: 'MULTIPLE_PER_DAY' }); return p.dailyFrequencyKind === 'MULTIPLE_PER_DAY' && p.dailyFrequencyLimit === null; })());
check('toPersisted: CUSTOM(6) -> exact columns', (() => { const p = toPersistedGoalActivityDailyFrequency({ kind: 'CUSTOM', limit: 6 }); return p.dailyFrequencyKind === 'CUSTOM' && p.dailyFrequencyLimit === 6; })());
check('round-trip: toPersisted then normalize returns the identical policy (CUSTOM)', (() => { const original = { kind: 'CUSTOM' as const, limit: 2 }; const back = normalizeGoalActivityDailyFrequency(toPersistedGoalActivityDailyFrequency(original)); return back.kind === 'CUSTOM' && back.limit === 2; })());
check('round-trip: toPersisted then normalize returns the identical policy (MULTIPLE_PER_DAY)', normalizeGoalActivityDailyFrequency(toPersistedGoalActivityDailyFrequency({ kind: 'MULTIPLE_PER_DAY' })).kind === 'MULTIPLE_PER_DAY');

// ============================================================
// scheduledLocalDate / scheduledLocalTimezone pair -- both-or-neither
// ============================================================
check('both NULL is valid (the legacy / not-yet-scheduled state)', (() => { const r = validateScheduledLocalDatePair({ localDate: null, timezone: null }); return r.ok && r.localDate === null && r.timezone === null; })());
check('both undefined is valid, same as both null', (() => { const r = validateScheduledLocalDatePair({ localDate: undefined, timezone: undefined }); return r.ok && r.localDate === null && r.timezone === null; })());
check('a valid date + valid timezone pair validates exactly', (() => { const r = validateScheduledLocalDatePair({ localDate: '2026-10-28', timezone: 'Asia/Kolkata' }); return r.ok && r.localDate === '2026-10-28' && r.timezone === 'Asia/Kolkata'; })());
check('date present, timezone null -- REJECTED, not silently repaired', validateScheduledLocalDatePair({ localDate: '2026-10-28', timezone: null }).ok === false);
check('timezone present, date null -- REJECTED, not silently repaired', validateScheduledLocalDatePair({ localDate: null, timezone: 'Asia/Kolkata' }).ok === false);

// ============================================================
// scheduledLocalDate -- invalid calendar dates (reuses isValidCivilDateString)
// ============================================================
check('a syntactically-shaped but calendrically-invalid date (Feb 30) is rejected', validateScheduledLocalDatePair({ localDate: '2026-02-30', timezone: 'Asia/Kolkata' }).ok === false);
check('month 13 is rejected', validateScheduledLocalDatePair({ localDate: '2026-13-01', timezone: 'Asia/Kolkata' }).ok === false);
check('a malformed date string is rejected', validateScheduledLocalDatePair({ localDate: 'not-a-date', timezone: 'Asia/Kolkata' }).ok === false);
check('a date with a time component is rejected (civil date only)', validateScheduledLocalDatePair({ localDate: '2026-10-28T00:00:00Z', timezone: 'Asia/Kolkata' }).ok === false);
check('a valid leap-day date (2028-02-29) is accepted', validateScheduledLocalDatePair({ localDate: '2028-02-29', timezone: 'Asia/Kolkata' }).ok === true);
check('the SAME string (2026-02-29) is rejected in a non-leap year', validateScheduledLocalDatePair({ localDate: '2026-02-29', timezone: 'Asia/Kolkata' }).ok === false);

// ============================================================
// scheduledLocalTimezone -- valid IANA timezones (reuses isValidIanaTimezone)
// ============================================================
check('a real IANA zone is accepted', validateScheduledLocalDatePair({ localDate: '2026-10-28', timezone: 'America/New_York' }).ok === true);
check('a fabricated, non-existent zone is rejected', validateScheduledLocalDatePair({ localDate: '2026-10-28', timezone: 'Mars/Phobos' }).ok === false);
check('an empty string timezone is rejected', validateScheduledLocalDatePair({ localDate: '2026-10-28', timezone: '' }).ok === false);
check('a bare offset (not an IANA zone name) is rejected', validateScheduledLocalDatePair({ localDate: '2026-10-28', timezone: '+05:30' }).ok === false);

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY DAILY FREQUENCY CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY DAILY FREQUENCY CHECKS PASSED');
