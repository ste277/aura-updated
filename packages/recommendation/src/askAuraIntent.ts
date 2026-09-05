/**
 * Ask Aura Orchestration V1 -- the canonical intent contract + deterministic
 * parser. This module is PURE (no I/O, no Date.now(), no DB) so it can be
 * unit-tested with fixed inputs; the caller supplies `now` explicitly.
 *
 * Architecture rule (brief section 6): this file only classifies text into
 * structured fields. It never scores timing, never touches Panchang/Muhurta
 * math, and never resolves a SavedPerson (that needs a DB lookup + ownership
 * check, which belongs in apps/web/lib/askAuraOrchestrator.ts). Activity
 * resolution reuses findActivityIntent() from personalizedTasks.ts -- the
 * exact same catalog-alias lookup Timing Search's own classifyTask() uses --
 * so this can never diverge from what "workout" or "coding" already resolve
 * to everywhere else in the app.
 */

import { findActivityIntent } from './personalizedTasks';
import { isSupportedMuhurthamActivity } from './muhurthamFinder';
import { getDatePartsInTimezone } from '../../panchang/src/localDate';

export type AskAuraIntent =
  | 'GOOD_RIGHT_NOW'
  | 'TIMING_FIND'
  | 'TIMING_CHECK'
  | 'TIMING_COMPARE'
  | 'PANCHANG_QUERY'
  | 'PANCHANG_EXPLAIN'
  | 'MUHURTHAM_SEARCH'
  | 'PLAN_OPEN'
  | 'UNKNOWN';

export type AskAuraScope = 'GENERAL' | 'PERSONAL' | 'SHARED';

/** Phrase-level date bucket -- NOT a calendar computation. Turning this into
 * an actual {start,end} range happens in the orchestrator, which has a real
 * DailyAssistantContext (timezone-aware "today") to compute from -- this
 * parser never does its own date math. */
export type AskHorizonPhrase =
  | 'NOW'
  | 'TODAY'
  | 'TOMORROW'
  | 'THIS_WEEKEND'
  | 'NEXT_WEEKEND'
  | 'THIS_WEEK'
  | 'NEXT_7_DAYS'
  | 'NEXT_MONTH'
  | 'CUSTOM_DATE'
  | 'UNSPECIFIED';

export type AskTimePreference = 'ANY' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

/** What a PANCHANG_QUERY is actually asking for -- "only answer the
 * requested detail" (brief section 11), never a full Panchang dump. */
export type AskPanchangField = 'FULL' | 'RAHU_KALAM' | 'YAMA' | 'GULIKA' | 'ABHIJIT' | 'BRAHMA' | 'NAKSHATRA' | 'TITHI' | 'YOGA' | 'KARANA' | 'VARA';

export type AskFollowUpKind = 'WHY' | 'OTHER_TIMES' | 'PLAN_IT' | 'REPEAT_WITH_CHANGES';

export interface ParsedAskAuraRequest {
  intent: AskAuraIntent;
  /** LOW means "do not act on this" -- the orchestrator returns a
   * CLARIFICATION response instead of guessing (brief section 19). */
  confidence: 'HIGH' | 'LOW';

  activityId?: string;
  /** Free text, only set when no catalog activity resolved (brief section
   * 4: never invent a second activity catalog -- this is handed to the
   * SAME classifyTask() fallback Timing Search itself uses when it can't
   * resolve an activityId either). */
  taskTitle?: string;

  durationMinutes?: number;

  horizonPhrase?: AskHorizonPhrase;
  /** Only set when horizonPhrase === 'CUSTOM_DATE'. */
  customDate?: string;

  timePreference?: AskTimePreference;

  /** Ask Aura Exact Clock-Time CHECK V1 -- an explicit clock time from the
   * user's own words (e.g. "10 AM" -> "10:00", "6:45 PM" -> "18:45"),
   * normalized 24-hour "HH:mm". Only ever set when the parser found a
   * genuine, VALID explicit time; a malformed one (e.g. "13 PM") never
   * reaches here at all -- see parseExactClockTime()'s own doc comment for
   * why an invalid clock returns UNKNOWN rather than silently omitting
   * this field and falling through to a date-only search. */
  exactTime?: string;

  scope?: AskAuraScope;
  /** Raw name text extracted from the prompt (e.g. "Anna") -- resolved
   * against the owner's own SavedPeople list server-side; this parser
   * never sees or touches SavedPerson data. */
  personNameQuery?: string;

  /** Ask Aura Event Location V1 -- raw "in <location>" text extracted from
   * the prompt (e.g. "Chennai"), never resolved here (this file stays
   * I/O-free, brief section 5) -- resolved against the existing
   * CITY_OPTIONS list server-side in apps/web/lib/askAuraOrchestrator.ts.
   * V1 is ceremonial-only (brief section 1/2): this field is populated for
   * ANY "in X" phrase regardless of activity, but the orchestrator only
   * ever applies it as an Event Location override for a Muhurtham-eligible
   * activity -- an everyday activity's "in X" phrase reaches this same
   * field and is simply never consulted. */
  locationQuery?: string;

  panchangField?: AskPanchangField;
  /** For PANCHANG_EXPLAIN -- the raw term text (e.g. "Rohini"), looked up
   * against a small presentation-layer glossary in the orchestrator. */
  explainTerm?: string;

  followUp?: AskFollowUpKind;
}

// ============================================================
// Activity resolution (brief section 4) -- reuses findActivityIntent()
// verbatim, never a second alias table.
// ============================================================

function resolveActivity(text: string): { activityId?: string; taskTitle?: string } {
  const activity = findActivityIntent(text);
  if (activity) return { activityId: activity.id };
  return { taskTitle: text.trim() || undefined };
}

// ============================================================
// Duration (brief section 21) -- extraction only; the actual default (when
// none is stated) comes from the catalog activity's own
// defaultDurationMinutes, resolved by the orchestrator, never invented here.
// ============================================================

function parseDurationMinutes(text: string): number | undefined {
  // "an hour" / "a hour" -- no leading digit, so checked before the
  // digit-anchored patterns below.
  if (/\b(an?)\s+hour\b/i.test(text) && !/\d\s*hours?/i.test(text)) return 60;

  const hourMinuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:(\d+)\s*(?:minutes?|mins?))?/i);
  if (hourMinuteMatch) {
    const hours = Number(hourMinuteMatch[1]);
    const extraMinutes = hourMinuteMatch[2] ? Number(hourMinuteMatch[2]) : 0;
    return Math.round(hours * 60 + extraMinutes);
  }
  const minuteMatch = text.match(/(\d+)\s*(?:minutes?|mins?)/i);
  if (minuteMatch) return Number(minuteMatch[1]);
  return undefined;
}

// ============================================================
// Time preference (brief section 23) -- the exact same closed vocabulary
// TimingTimePreference already defines (ANY/MORNING/AFTERNOON/EVENING/
// NIGHT); no second range invented here, this only produces the enum tag.
// ============================================================

function parseTimePreference(text: string): AskTimePreference | undefined {
  if (/\bmorning\b/.test(text)) return 'MORNING';
  if (/\bafternoon\b/.test(text)) return 'AFTERNOON';
  if (/\b(evening)\b/.test(text)) return 'EVENING';
  if (/\bnight\b/.test(text)) return 'NIGHT';
  return undefined;
}

// ============================================================
// Exact clock time (Ask Aura Exact Clock-Time CHECK V1). ONLY 12-hour
// AM/PM forms are recognized -- "10 AM", "10:30am", "6 PM", "6:45pm" -- no
// 24-hour ("18:30") or fuzzy ("around 10", "noon") forms; this is
// deliberately the narrowest reliable slice, not a general clock parser.
//
// Distinguishes three outcomes, not just string | undefined, because a
// malformed explicit time ("13 PM", "10:60 AM") must never be treated the
// same as no time being supplied at all (brief section 11/59) -- ABSENT
// silently falls through to existing date-only/FIND behavior unchanged;
// INVALID must be caught by the caller and turned into a clarification,
// never a silent date-only search.
// ============================================================

export type AskExactClockParseResult =
  | { status: 'ABSENT' }
  | { status: 'INVALID' }
  | { status: 'VALID'; exactTime: string };

// Deliberately loose on hour/minute digit count (not `[01]\d` etc.) so a
// malformed value like "13" or "60" is CAPTURED, not silently unmatched --
// validity is checked in code below, not enforced by the regex itself.
const EXACT_CLOCK_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;

function parseExactClockTime(text: string): AskExactClockParseResult {
  const match = text.match(EXACT_CLOCK_RE);
  if (!match) return { status: 'ABSENT' };

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3].toLowerCase();
  // 12-hour clock: 1-12 for the hour (never 0, never 13+); 0-59 for the
  // minute. "0 AM"/"13 PM"/"10:60 AM" are all rejected here.
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return { status: 'INVALID' };

  const hour24 = meridiem === 'am' ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
  return { status: 'VALID', exactTime: `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

// The only AskHorizonPhrase values that name a single concrete local
// calendar date (never a multi-day RANGE like THIS_WEEKEND/NEXT_MONTH) --
// combining an exact clock with a range horizon is ambiguous ("10 AM" on
// WHICH day of the weekend?) and out of scope for V1 (brief section 21:
// "exact clock CHECK should only work with temporal forms already
// supported by parseHorizonPhrase/customDate... today/tomorrow/tonight/ISO
// custom date"). NOW is included since parseHorizonPhrase's "tonight"/
// "today"/(absent) branches already resolve to a single local date.
const EXACT_CLOCK_USABLE_HORIZONS: ReadonlySet<AskHorizonPhrase> = new Set(['NOW', 'TODAY', 'TOMORROW', 'CUSTOM_DATE']);

// ============================================================
// Natural calendar dates -- month-name ("September 20", "Sep 20th 2026")
// and weekday ("Friday", "next Friday") text (Ask Aura Absolute Date +
// Weekday Parsing V1), normalized into the SAME {horizonPhrase:
// 'CUSTOM_DATE', customDate: "YYYY-MM-DD"} representation ISO dates and
// parseHorizonPhrase already produce -- so every existing consumer
// (resolveHorizonToDateRange, the exact-clock machinery from PR #66,
// PANCHANG_QUERY's own customDate threading) picks these up for free with
// no changes of its own.
//
// Deliberately NOT folded into parseHorizonPhrase itself: parseFollowUpChange
// (below) also calls parseHorizonPhrase on a follow-up delta, and its
// existing "What about October?" / "What about Chennai?" mis-parses (falls
// through to the with-a-name fallback) must stay exactly as broken as
// before -- these new functions are only ever invoked from
// parseAskAuraRequest's own top-level field extraction, never from the
// follow-up path, so there is no way for this change to alter that
// behavior.
//
// Pure text + (now, timezone) -> date, no external date library: "today"
// is resolved in the Timing Location's own local calendar (never the
// server's UTC date) via getDatePartsInTimezone(), the same DST-aware
// helper PR #66 already established as the one acceptable way to do
// timezone-aware date/time conversion anywhere in this codebase.
// ============================================================

export type AskNaturalDateParseResult =
  | { status: 'ABSENT' }
  | { status: 'INVALID' }
  | { status: 'VALID'; customDate: string };

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, sept: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
// Longest-first: regex alternation takes the first branch that matches, not
// the longest, so "september" must be tried before its own prefix "sep".
const MONTH_NAME_PATTERN = Object.keys(MONTH_NAME_TO_NUMBER)
  .sort((a, b) => b.length - a.length)
  .join('|');
const MONTH_FIRST_DATE_RE = new RegExp(`\\b(${MONTH_NAME_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4})\\b)?`, 'i');
const DAY_FIRST_DATE_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAME_PATTERN})\\b(?:\\s+(\\d{4})\\b)?`, 'i');

const WEEKDAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const WEEKDAY_NAME_PATTERN = Object.keys(WEEKDAY_NAME_TO_INDEX).join('|');
const WEEKDAY_DATE_RE = new RegExp(`\\b(?:(next|this)\\s+)?(${WEEKDAY_NAME_PATTERN})\\b`, 'i');

// A hyphen/"to"/"through"/"until" immediately following an otherwise-valid
// date match means the user actually asked for a RANGE ("September 20-25",
// "September 20 to September 25", "next Monday through Friday") --
// explicitly out of scope for V1 (brief section 30/55): never silently keep
// just the first date and drop the rest. The continuation can be a bare day
// number ("-25"), a weekday name ("through Friday"), or a full second
// month-name date ("to September 25"), so all three are checked.
const RANGE_CONTINUATION_RE = new RegExp(`^\\s*(-|to|through|until)\\s*(\\d|${WEEKDAY_NAME_PATTERN}|${MONTH_NAME_PATTERN})`, 'i');

// `month` is 1-12. Date.UTC's own "month" arg is 0-indexed, so passing
// `month` (not `month - 1`) directly represents the FOLLOWING month; day 0
// of that month rolls back to the last real day of the intended 1-12
// month. Correctly leap-year-aware for February via JS's own Gregorian
// calendar math -- no manual leap-year table needed.
function isValidCalendarDayForMonth(year: number, month: number, day: number): boolean {
  if (day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// The most days `month` (1-12) can ever have in ANY year -- 2000 is a
// leap year, so this correctly reports 29 for February. Used to reject a
// day that's invalid for every possible year (e.g. "April 31",
// "February 30") independent of which year ends up chosen.
function maxDaysInMonth(month: number): number {
  return new Date(Date.UTC(2000, month, 0)).getUTCDate();
}

function formatDateStr(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Smallest year >= localYear such that (year, month, day) is both a real
 * calendar date and on-or-after the Timing Location's local "today" (brief
 * section 12/13/35): a month/day that already passed this year rolls to
 * next year; an implicit February 29 in a non-leap year skips forward to
 * the next valid future leap day -- both handled by this same loop, no
 * separate leap-day special case. Today's own exact month/day resolves to
 * THIS year (same-day policy), never rolled forward. */
function resolveImplicitYear(localYear: number, localMonth: number, localDay: number, month: number, day: number): number {
  for (let year = localYear; year < localYear + 8; year++) {
    if (!isValidCalendarDayForMonth(year, month, day)) continue;
    const onOrAfterToday = year > localYear || month > localMonth || (month === localMonth && day >= localDay);
    if (onOrAfterToday) return year;
  }
  // Unreachable for any genuinely valid (month, day): every ordinary date
  // recurs every year, and Feb 29 recurs at least once every 8 years.
  return localYear + 8;
}

function parseMonthNameDate(text: string, now: Date, timezone: string | undefined): AskNaturalDateParseResult {
  if (!timezone) return { status: 'ABSENT' };

  const monthFirst = text.match(MONTH_FIRST_DATE_RE);
  const dayFirst = text.match(DAY_FIRST_DATE_RE);

  let monthToken: string;
  let dayToken: string;
  let yearToken: string | undefined;
  let matchEnd: number;
  if (monthFirst && (!dayFirst || (monthFirst.index ?? Infinity) <= (dayFirst.index ?? Infinity))) {
    monthToken = monthFirst[1];
    dayToken = monthFirst[2];
    yearToken = monthFirst[3];
    matchEnd = (monthFirst.index ?? 0) + monthFirst[0].length;
  } else if (dayFirst) {
    dayToken = dayFirst[1];
    monthToken = dayFirst[2];
    yearToken = dayFirst[3];
    matchEnd = (dayFirst.index ?? 0) + dayFirst[0].length;
  } else {
    return { status: 'ABSENT' };
  }

  if (RANGE_CONTINUATION_RE.test(text.slice(matchEnd))) return { status: 'INVALID' };

  const month = MONTH_NAME_TO_NUMBER[monthToken.toLowerCase()];
  const day = Number(dayToken);
  if (day > maxDaysInMonth(month)) return { status: 'INVALID' };

  if (yearToken) {
    // Explicit year always wins, even a past one -- preserved exactly,
    // never silently rolled forward (brief section 11/31); only rejected
    // if the resulting calendar date isn't real (e.g. "February 29 2027").
    const year = Number(yearToken);
    if (!isValidCalendarDayForMonth(year, month, day)) return { status: 'INVALID' };
    return { status: 'VALID', customDate: formatDateStr(year, month, day) };
  }

  const local = getDatePartsInTimezone(timezone, now);
  const year = resolveImplicitYear(local.year, local.month, local.day, month, day);
  return { status: 'VALID', customDate: formatDateStr(year, month, day) };
}

function parseWeekdayDate(text: string, now: Date, timezone: string | undefined): AskNaturalDateParseResult {
  if (!timezone) return { status: 'ABSENT' };

  const match = text.match(WEEKDAY_DATE_RE);
  if (!match) return { status: 'ABSENT' };

  const matchEnd = (match.index ?? 0) + match[0].length;
  if (RANGE_CONTINUATION_RE.test(text.slice(matchEnd))) return { status: 'INVALID' };

  const modifier = match[1]?.toLowerCase();
  const targetWeekday = WEEKDAY_NAME_TO_INDEX[match[2].toLowerCase()];
  const local = getDatePartsInTimezone(timezone, now);

  // "next Friday" = the Friday of the FOLLOWING calendar week (Sunday..
  // Saturday, matching getDatePartsInTimezone's own weekday convention and
  // resolveHorizonDayOffsets' existing weekend-boundary calculation in
  // dailyAssistant.ts) -- NOT merely the next chronological Friday: if
  // today is Friday, "next Friday" is 7 days away, not today. Bare/"this"
  // Friday = the upcoming occurrence INCLUDING today (brief section
  // 17/18/19) -- if today IS Friday, bare "Friday" means today.
  const offset = modifier === 'next'
    ? (7 - local.weekday) + targetWeekday
    : (targetWeekday - local.weekday + 7) % 7;

  const resultUtc = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
  return {
    status: 'VALID',
    customDate: formatDateStr(resultUtc.getUTCFullYear(), resultUtc.getUTCMonth() + 1, resultUtc.getUTCDate()),
  };
}

/** Tries month-name-date first, then weekday -- a sentence containing both
 * ("Friday, September 20") treats the more specific explicit date as the
 * intended one. Only ever called when parseHorizonPhrase itself found no
 * relative-phrase match, so this never competes with today/tomorrow/next
 * weekend/next month/etc. */
function parseNaturalCalendarDate(text: string, now: Date, timezone: string | undefined): AskNaturalDateParseResult {
  const monthResult = parseMonthNameDate(text, now, timezone);
  if (monthResult.status !== 'ABSENT') return monthResult;
  return parseWeekdayDate(text, now, timezone);
}

/** True when `dateStr` ("YYYY-MM-DD") names a Timing-Location-local date
 * strictly before today. Lexical comparison is safe/correct for two
 * zero-padded ISO date strings. Used to reject an explicit past date (Ask
 * Aura Absolute Date + Weekday Parsing V1 follow-up: neither the generic
 * Timing Search engine nor the Muhurtham engine has any "must be in the
 * future" guard of their own -- both will happily compute a real Panchang-
 * based score for a historical date and even offer a "Plan this" action for
 * it, since historical timing evaluation was never an intentional Ask Aura
 * capability, just an unguarded date passthrough). Deliberately NEVER
 * mutates the date -- callers that detect a past date must reject/clarify,
 * never silently roll it forward to a future year. */
function isPastLocalDate(dateStr: string, now: Date, timezone: string): boolean {
  return dateStr < getDatePartsInTimezone(timezone, now).dateStr;
}

// ============================================================
// Horizon phrase (brief section 22).
// ============================================================

function parseHorizonPhrase(text: string): { horizonPhrase?: AskHorizonPhrase; customDate?: string } {
  const isoDateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDateMatch) return { horizonPhrase: 'CUSTOM_DATE', customDate: isoDateMatch[1] };

  if (/\bnext weekend\b/.test(text)) return { horizonPhrase: 'NEXT_WEEKEND' };
  if (/\bthis weekend\b|\bweekend\b/.test(text)) return { horizonPhrase: 'THIS_WEEKEND' };
  if (/\bnext (7|seven) days\b/.test(text)) return { horizonPhrase: 'NEXT_7_DAYS' };
  if (/\bnext month\b/.test(text)) return { horizonPhrase: 'NEXT_MONTH' };
  if (/\bnext week\b/.test(text)) return { horizonPhrase: 'NEXT_7_DAYS' }; // see completion report: no separate ISO-week boundary implementation in V1
  if (/\bthis week\b/.test(text)) return { horizonPhrase: 'THIS_WEEK' };
  if (/\btomorrow\b/.test(text)) return { horizonPhrase: 'TOMORROW' };
  if (/\b(right now|now)\b/.test(text)) return { horizonPhrase: 'NOW' };
  if (/\btoday\b|\btonight\b/.test(text)) return { horizonPhrase: 'TODAY' };

  return { horizonPhrase: undefined };
}

// ============================================================
// Scope (brief section 14; owner+person pair grammar added by Ask Aura
// Richer SHARED Grammar V1).
// ============================================================

// Owner+other-person pair grammar -- "Priya and I" / "I and Priya" /
// "Priya and me" / "me and Priya" -- extracts ONLY the other person's name,
// never the pronoun. Deliberately a SINGLE word after/before "and", same
// bound as the existing "with X" pattern below (and for the identical
// reason: a greedy multi-word capture risks swallowing trailing activity/
// date words -- brief section 29's own required boundary test, "...for
// Priya and me to get married?" must extract "priya", never "priya and me
// to get married"). This single-word bound also naturally rejects a
// three-person list ("Priya, Alex and I") rather than silently picking one
// name (brief section 28): the comma right after "Priya" breaks the
// single-word match, so the whole pattern fails to match at that position
// and the text falls through to whatever it would otherwise resolve as
// (typically UNKNOWN), never a fabricated two-person guess.
const PAIR_GRAMMAR_RE = /\b([a-z][a-z'\-]*)\s+and\s+(?:i|me)\b|\b(?:i|me)\s+and\s+([a-z][a-z'\-]*)\b/i;

function parseScope(text: string): { scope?: AskAuraScope; personNameQuery?: string } {
  // Checked FIRST, before "for me"/"for us" below (brief section 17/18):
  // "for me and Priya" contains the literal substring "for me", and
  // without this precedence it would wrongly resolve PERSONAL instead of
  // SHARED -- explicit owner+other-person grammar must always win over the
  // standalone PERSONAL/SHARED-no-name checks, never rely on accidental
  // substring order.
  const pairMatch = text.match(PAIR_GRAMMAR_RE);
  if (pairMatch) {
    const name = (pairMatch[1] ?? pairMatch[2])?.trim();
    if (name) return { scope: 'SHARED', personNameQuery: name };
  }

  // "with Anna" / "with Anna and me" -- capture the name only; resolving it
  // against the owner's own SavedPeople list happens server-side.
  // Deliberately a SINGLE word -- most real names in this app's own examples
  // are one first name ("Anna"), and a greedy two-word capture risks
  // swallowing a following stopword ("with Anna this weekend" -> "anna
  // this"). A two-word name is out of scope for V1's deterministic parser.
  //
  // Checked BEFORE the no-name SHARED markers below ("for us"/"together"/
  // "our wedding") so a request that combines both -- "our wedding with
  // Priya" -- resolves the explicitly given name, rather than the earlier
  // no-name clause returning first and discarding it (Ask Aura Richer
  // SHARED Grammar V1's fail-closed follow-up: this composition is exactly
  // what distinguishes "a name IS available, proceed normally" from "no
  // name at all, fail closed" below).
  const withMatch = text.match(/\bwith ([a-z][a-z'\-]*)\b/i);
  if (withMatch) {
    const name = withMatch[1].trim();
    // "with someone" / "with anyone" / "with a friend" are NOT names -- treat
    // as an unresolved SHARED request (the orchestrator asks who, rather
    // than trying to look up the literal word "someone").
    if (/^(someone|anyone|a friend|my partner|my wife|my husband|them|him|her)$/i.test(name)) {
      return { scope: 'SHARED' };
    }
    return { scope: 'SHARED', personNameQuery: name };
  }

  // "for us" / "together" / "our wedding" / "our marriage" -- all three
  // collapse to the SAME no-name SHARED shape (Ask Aura Richer SHARED
  // Grammar V1): there is no deterministic mechanism anywhere in this
  // codebase to know WHICH SavedPerson the request refers to, so this can
  // never resolve a personNameQuery on its own. "our wedding"/"our
  // marriage" is deliberately narrow (only these two nouns, not a
  // generalized "our <activity>" pattern). See the fail-closed guard in
  // parseAskAuraRequest below (scope === 'SHARED' && !personNameQuery for
  // an executable timing request -> clarification) -- a single shared
  // invariant covering all three phrasings, rather than three separate
  // phrase-specific guards.
  if (/\bfor us\b|\btogether\b|\bour\s+(wedding|marriage)\b/.test(text)) return { scope: 'SHARED' };
  if (/\bfor me\b/.test(text)) return { scope: 'PERSONAL' };

  return {};
}

// ============================================================
// Explicit Event Location (Ask Aura Event Location V1) -- text EXTRACTION
// ONLY (brief section 5): this function never imports apps/web/lib/cities,
// never resolves coordinates/timezone, never knows CITY_OPTIONS -- pure
// regex over the prompt text, matching this file's own I/O-free
// architecture rule (see the file-level doc comment). Resolution against
// the actual supported-city list is an I/O-adjacent lookup that belongs
// entirely in apps/web (askAuraOrchestrator.ts's resolveEventLocationQuery).
//
// V1 grammar is deliberately just "in <location>" (brief section 6) -- "at
// <location>" is intentionally NOT supported, since "at" is already
// meaningful for an exact clock time ("at 10 AM") and overloading it would
// create a real grammar collision with EXACT_CLOCK_RE above.
//
// Bounded, non-greedy multi-word capture (brief section 7/8): the lazy
// `[a-z\s'-]*?` only grows as far as the lookahead forces it to, so it
// stops at the FIRST existing temporal/scope keyword this parser already
// assigns meaning to (next/this/tomorrow/today/tonight/on/at/for/with/
// and), at punctuation, or at end of input -- "in Chennai next Friday"
// extracts "chennai", never "chennai next friday"; "in New Delhi tomorrow"
// extracts "new delhi", preserving the multi-word city name.
// ============================================================

const LOCATION_QUERY_RE = /\bin\s+([a-z][a-z\s'-]*?)(?=\s+(?:next|this|tomorrow|today|tonight|on|at|for|with|and)\b|[.,!?;:]|$)/i;

export function extractLocationQuery(rawText: string): string | undefined {
  const match = rawText.toLowerCase().match(LOCATION_QUERY_RE);
  if (!match) return undefined;
  const candidate = match[1].trim();
  return candidate || undefined;
}

// ============================================================
// Panchang term glossary keys (brief section 12) -- just enough to detect
// "what is <term>" as an EXPLAIN intent vs a QUERY; the actual explanation
// text lives in the orchestrator's small presentation-layer knowledge map.
// ============================================================

const PANCHANG_EXPLAIN_TERMS = [
  'rohini', 'ashwini', 'bharani', 'krittika', 'mrigashira', 'ardra', 'punarvasu', 'pushya', 'ashlesha',
  'magha', 'purva phalguni', 'uttara phalguni', 'hasta', 'chitra', 'swati', 'vishakha', 'anuradha', 'jyeshtha',
  'mula', 'purva ashadha', 'uttara ashadha', 'shravana', 'dhanishta', 'shatabhisha', 'purva bhadrapada',
  'uttara bhadrapada', 'revati',
  'rahu kalam', 'yamagandam', 'yama gandam', 'gulika kalam', 'gulika', 'abhijit muhurta', 'abhijit',
  'brahma muhurta', 'brahma',
  'tithi', 'nakshatra', 'yoga', 'karana', 'vara', 'muhurta', 'muhurtham', 'panchang', 'panchanga',
];

function matchPanchangField(text: string): AskPanchangField | undefined {
  if (/rahu\s*kalam/.test(text)) return 'RAHU_KALAM';
  if (/yama\s*gandam|\byama\b/.test(text)) return 'YAMA';
  if (/gulika/.test(text)) return 'GULIKA';
  if (/abhijit/.test(text)) return 'ABHIJIT';
  if (/brahma/.test(text)) return 'BRAHMA';
  if (/nakshatra/.test(text)) return 'NAKSHATRA';
  if (/\btithi\b/.test(text)) return 'TITHI';
  if (/\byoga\b/.test(text)) return 'YOGA';
  if (/\bkarana\b/.test(text)) return 'KARANA';
  if (/\bvara\b|\bweekday\b/.test(text)) return 'VARA';
  return undefined;
}

// ============================================================
// Follow-up detection (brief section 15/16) -- deterministic short-phrase
// matching only, never free conversation.
// ============================================================

function detectFollowUp(text: string): AskFollowUpKind | undefined {
  if (/^why\??$/.test(text) || /^why (is that|not)\??$/.test(text)) return 'WHY';
  if (/\bother times?\b|\bother options?\b|\balternatives?\b|\bwhat else\b/.test(text)) return 'OTHER_TIMES';
  if (/^plan it\.?$/.test(text) || /^plan this\.?$/.test(text)) return 'PLAN_IT';
  return undefined;
}

// ============================================================
// Intent classification (brief section 5) -- precedence, documented in
// order. A LOW-confidence UNKNOWN never fabricates an activity/intent.
// ============================================================

const GOOD_RIGHT_NOW_RE = /\b(what should i do|what can i do)\b.*\b(now|right now)?\b|^what should i do\??$|^what can i do( right now)?\??$|\bwhat's good (to do )?right now\b/;
const CHECK_VERB_RE = /\b(can i|should i|is it (ok|okay|good|fine) to|is now (a )?good time|is this a good time)\b/;
// "when should i" only matches when "i" is the word literally adjacent to
// "should" -- true for "when should I and Priya..." (a genuine substring
// hit) but NOT for "when should Priya and I...", "when should me and
// Priya...", "when should Priya and me..." (Ask Aura Richer SHARED
// Grammar V1's own required matrix, brief section 6/35). The two extra
// alternatives below cover exactly those three remaining pair orderings,
// bounded to a single word for the other person's name (same convention
// PAIR_GRAMMAR_RE uses) so this never spans an unrelated, much longer
// sentence or silently picks a name out of a longer list.
const FIND_VERB_RE = /\bwhen should i\b|\bwhen should [a-z][a-z'\-]*\s+and\s+(?:i|me)\b|\bwhen should me\s+and\s+[a-z][a-z'\-]*\b|\bwhen('s| is) (the )?best time\b|\bbest time (for|to)\b|\bwhen can i\b|\bfind (a|the best) time\b/;
const COMPARE_VERB_RE = /\bwhich is better\b|\bcompare\b.*\btimes?\b|\b(this|that) time or\b/;
// "auspicious" allows up to ~3 intervening words before date/time/day (Ask
// Aura Marriage Muhurtham Routing V1) so a named activity between the two
// -- "an auspicious WEDDING date" -- still matches; the original pattern
// only matched them directly adjacent ("an auspicious date"). Bounded
// (not `.*`) so this never spans an unrelated, much longer sentence.
const MUHURTHAM_SEARCH_RE = /\bgood dates?\b|\bauspicious\b(?:\s+\w+){0,3}\s+(date|time|day)s?\b|\bfavorable dates?\b|\bmuhurtham\b|\bmuhurta\b(?!\s*bala)/;
const PANCHANG_QUERY_RE = /\bwhen is\b|\bwhat('s| is) (today|tomorrow)'?s? panchang\b|\bwhat('s| is) (today|tomorrow)'?s? (nakshatra|tithi|yoga|karana|vara)\b|\brahu kalam\b|\byamagandam\b|\bgulika kalam\b/;
// Ask Aura Bare Ceremonial "Best Date" Routing follow-up: a bare
// short phrase asking for a "best/good/auspicious/favorable
// date/time/day" -- e.g. "Best marriage date." -- with no find/check
// verb and no adjacency to MUHURTHAM_SEARCH_RE's own direct patterns
// above. Bounded (not `.*`), same style as MUHURTHAM_SEARCH_RE's own
// "auspicious ... date" widening, so this never spans an unrelated,
// much longer sentence. Used ONLY as a narrow, capability-gated guard
// immediately before the generic bare-activity PLAN_OPEN fallback (see
// step 8b below) -- never checked this early in the precedence chain.
const CEREMONIAL_BEST_DATE_RE = /\b(best|good|auspicious|favorable)\b(?:\s+\w+){0,3}\s+(dates?|times?|days?)\b/;

export interface AskAuraParseContext {
  now: Date;
  /** IANA timezone (e.g. "Asia/Kolkata") for the Timing Location this
   * request should be interpreted against (Ask Aura Absolute Date +
   * Weekday Parsing V1) -- required to resolve a bare weekday ("Friday")
   * or an implicit-year month/day ("September 20") to a concrete date,
   * since "today" depends on where the user's Timing Location actually is,
   * never the server's own clock/zone. Optional only so callers that never
   * exercise natural-date parsing don't need to supply it; when absent,
   * month-name/weekday text is simply left unparsed (the same
   * no-match/ABSENT behavior as before this field existed) rather than
   * guessing a timezone. */
  timezone?: string;
  /** The prior turn's parsed request, if this looks like a follow-up
   * (brief section 15) -- used to fill in unstated fields (activity,
   * date, scope) rather than re-asking. */
  previous?: ParsedAskAuraRequest;
}

export function parseAskAuraRequest(rawText: string, context: AskAuraParseContext): ParsedAskAuraRequest {
  const text = rawText.trim().toLowerCase();
  if (!text) return { intent: 'UNKNOWN', confidence: 'LOW' };

  const followUp = detectFollowUp(text);
  if (followUp && context.previous) {
    return applyFollowUp(followUp, text, context.previous);
  }

  const { horizonPhrase: relativeHorizonPhrase, customDate: relativeCustomDate } = parseHorizonPhrase(text);
  // Only attempted when no relative phrase (today/tomorrow/next month/ISO
  // date/etc.) already matched, so this never competes with that existing,
  // higher-precedence vocabulary (brief section 39: "next month" must stay
  // NEXT_MONTH, never be reinterpreted as a named-month date).
  const naturalDate = relativeHorizonPhrase ? { status: 'ABSENT' as const } : parseNaturalCalendarDate(text, context.now, context.timezone);
  if (naturalDate.status === 'INVALID') {
    // An unsupported date RANGE, or a calendrically impossible date
    // ("February 30", "April 31", "February 29" in a non-leap year with an
    // explicit year) -- never silently normalized or dropped, never falls
    // through to a generic activity search (brief section 27/30).
    return { intent: 'UNKNOWN', confidence: 'LOW' };
  }
  const horizonPhrase = relativeHorizonPhrase ?? (naturalDate.status === 'VALID' ? 'CUSTOM_DATE' : undefined);
  const customDate = relativeCustomDate ?? (naturalDate.status === 'VALID' ? naturalDate.customDate : undefined);
  // An explicit PAST date (from either the ISO regex above or the new
  // month-name/weekday parsing) must never silently proceed as a normal
  // future-planning result -- neither Timing Search nor the Muhurtham
  // engine has any "must be in the future" guard of their own, so an
  // unguarded past customDate would compute a real-looking score and even
  // offer a "Plan this" action for a historical instant. Never mutates the
  // date (an explicit past year is preserved exactly, never rolled forward
  // -- only implicit-year resolution ever looks forward); only rejected
  // when a timezone is available to know what "today" actually is
  // locally -- without one, this is left exactly as it always was
  // (unchecked), same as every other natural-date behavior that needs a
  // timezone to resolve safely.
  if (customDate && context.timezone && isPastLocalDate(customDate, context.now, context.timezone)) {
    return { intent: 'UNKNOWN', confidence: 'LOW' };
  }
  const timePreference = parseTimePreference(text);
  const durationMinutes = parseDurationMinutes(text);
  const { scope, personNameQuery } = parseScope(text);
  const clockResult = parseExactClockTime(text);
  const locationQuery = extractLocationQuery(text);

  // Ask Aura Richer SHARED Grammar V1 fail-closed follow-up: the CORE
  // invariant is `scope === 'SHARED' && !personNameQuery` for an
  // executable timing request -- never a phrase-specific check for "for
  // us"/"together"/"our wedding" individually (all three already collapse
  // to this exact same shape via parseScope above). "for us"/"together"/
  // "our wedding"/"our marriage" clearly express couple intent, but there
  // is no deterministic way anywhere in this codebase to know WHICH
  // SavedPerson the request refers to, and guessing (first/most-recent/
  // alphabetical SavedPerson) is explicitly forbidden -- so this must
  // never silently execute as if GENERAL. Only short-circuits when the
  // request ALSO carries a genuine timing signal -- an exact clock, a
  // resolved horizon/date, an explicit time preference, or
  // FIND/CHECK/muhurtham-search/ceremonial-best-date language -- so a
  // non-timing phrase like "Plan our wedding" is completely unaffected and
  // still reaches step 9's ordinary PLAN_OPEN fallback below (brief
  // section 33 of the original brief / section 8 of this follow-up).
  // Deliberately does NOT fire for scope === 'SHARED' WITH a
  // personNameQuery ("with Priya", pair grammar) -- those must continue
  // into the existing SavedPerson RESOLVED/AMBIGUOUS/NOT_FOUND resolution
  // in the orchestrator, never be rejected here at the parser.
  if (scope === 'SHARED' && !personNameQuery) {
    const hasTimingSignal =
      clockResult.status === 'VALID' ||
      Boolean(horizonPhrase) ||
      Boolean(timePreference) ||
      FIND_VERB_RE.test(text) ||
      CHECK_VERB_RE.test(text) ||
      MUHURTHAM_SEARCH_RE.test(text) ||
      CEREMONIAL_BEST_DATE_RE.test(text);
    if (hasTimingSignal) {
      return { intent: 'UNKNOWN', confidence: 'LOW' };
    }
  }

  // 1. Panchang explanation -- "what is X" / "what does X mean" where X is
  // a recognized term. Checked BEFORE Panchang query so "What is Rohini?"
  // never falls into the "when is..." query bucket.
  const explainMatch = text.match(/^what (?:is|does)\s+([a-z\s]+?)\s*(?:mean)?\??$/);
  if (explainMatch) {
    const candidate = explainMatch[1].trim();
    const knownTerm = PANCHANG_EXPLAIN_TERMS.find((term) => candidate === term || candidate.includes(term));
    if (knownTerm) {
      return { intent: 'PANCHANG_EXPLAIN', confidence: 'HIGH', explainTerm: knownTerm };
    }
  }

  // Shared by the precedence guard below and by step 3 proper: only builds
  // a MUHURTHAM_SEARCH result when the resolved activity is actually
  // Muhurtham-eligible (brief section 13: "Do not route casual activities
  // through Muhurtham Finder" -- this is the section 37 regression test).
  // Carries `durationMinutes` through (Ask Aura Marriage Muhurtham Routing
  // V1): duration was already parsed above but was previously dropped for
  // this intent, so an explicit "90 minute marriage muhurtham" request
  // silently lost its duration -- the canonical Muhurtham path already
  // accepts and preserves an explicit duration when supplied, same as any
  // other Muhurtham-eligible activity.
  const buildMuhurthamSearchIfEligible = (): ParsedAskAuraRequest | undefined => {
    const resolved = resolveActivity(text);
    if (!resolved.activityId || !isSupportedMuhurthamActivity(resolved.activityId)) return undefined;
    return {
      intent: 'MUHURTHAM_SEARCH',
      confidence: 'HIGH',
      activityId: resolved.activityId,
      scope: scope ?? 'GENERAL',
      personNameQuery,
      locationQuery,
      durationMinutes,
      horizonPhrase: horizonPhrase ?? 'NEXT_MONTH',
      customDate,
    };
  };

  // 2. Panchang query -- "when is Rahu Kalam tomorrow", "what's today's
  // nakshatra". Checked before activity-based intents so a Panchang-window
  // NAME (Rahu Kalam, Gulika) is never misread as an activity.
  //
  // EXCEPTION (Ask Aura Marriage Muhurtham Routing V1): when the text ALSO
  // matches MUHURTHAM_SEARCH_RE (genuine muhurtham/auspicious-date search
  // language -- not merely a Panchang-window name) AND resolves to a
  // Muhurtham-eligible activity, the specific ceremonial timing request
  // wins over the generic Panchang query -- e.g. "When is a good muhurtham
  // for my wedding?" must become MUHURTHAM_SEARCH(activityId=marriage), not
  // PANCHANG_QUERY. Deliberately narrow: it requires BOTH a genuine
  // search-language match AND a resolved, capability-checked activity, so
  // a plain "When is Rahu Kalam?" (no eligible activity, no muhurtham/
  // auspicious-date language beyond the window's own name) is completely
  // unaffected and still returns PANCHANG_QUERY below.
  if (PANCHANG_QUERY_RE.test(text) && MUHURTHAM_SEARCH_RE.test(text)) {
    const muhurthamSearch = buildMuhurthamSearchIfEligible();
    if (muhurthamSearch) return muhurthamSearch;
  }
  if (PANCHANG_QUERY_RE.test(text)) {
    return {
      intent: 'PANCHANG_QUERY',
      confidence: 'HIGH',
      panchangField: matchPanchangField(text) ?? 'FULL',
      horizonPhrase: horizonPhrase ?? 'TODAY',
      customDate,
    };
  }

  // 3. Muhurtham search -- only when the resolved activity is actually
  // Muhurtham-eligible (see buildMuhurthamSearchIfEligible above).
  if (MUHURTHAM_SEARCH_RE.test(text)) {
    const muhurthamSearch = buildMuhurthamSearchIfEligible();
    if (muhurthamSearch) return muhurthamSearch;
    // "Good dates for coffee" -- the search-y phrasing matched, but coffee
    // isn't Muhurtham-eligible. Fall through to ordinary timing intents
    // below (brief section 37's explicit regression case) rather than
    // returning MUHURTHAM_SEARCH for a casual activity.
  }

  // 4. Good Right Now -- no activity mentioned, asking what to do now.
  if (GOOD_RIGHT_NOW_RE.test(text) && !FIND_VERB_RE.test(text)) {
    return { intent: 'GOOD_RIGHT_NOW', confidence: 'HIGH' };
  }

  // 5. Timing Compare.
  if (COMPARE_VERB_RE.test(text)) {
    const resolved = resolveActivity(text);
    return {
      intent: 'TIMING_COMPARE',
      confidence: resolved.activityId || resolved.taskTitle ? 'HIGH' : 'LOW',
      ...resolved,
      durationMinutes,
      timePreference,
      scope: scope ?? 'GENERAL',
      personNameQuery,
      locationQuery,
    };
  }

  // 5b. Exact clock-time CHECK inference (Ask Aura Exact Clock-Time CHECK
  // V1) -- the semantic discriminator between a CHECK-shaped and a
  // FIND-shaped "is X good for Y" question is whether an EXACT clock time
  // was actually stated, never a broadened CHECK_VERB_RE. Deliberately NOT
  // built as a bigger regex covering every English CHECK-like sentence
  // shape ("would X be good", "how is X for Y", etc.) -- the presence of a
  // resolved activity + a valid exact clock + a usable single-date horizon
  // is what matters, independent of which verb phrasing surrounds it.
  //
  // Checked AFTER explicit FIND_VERB_RE (guarded by the SAME
  // `!FIND_VERB_RE.test(text)` condition step 6 below already effectively
  // uses) so "Find the best time tomorrow after 10 AM for deep work."
  // keeps FIND precedence -- there the clock is a search CONSTRAINT/
  // reference point, not the candidate instant (brief section 16/49).
  //
  // Checked BEFORE step 6's own generic OR-condition (not merely after
  // FIND_VERB_RE) because that condition's second branch --
  // `(horizonPhrase || timePreference) && (personNameQuery || scope)` --
  // does not itself require FIND_VERB_RE and would otherwise steal any
  // SHARED/PERSONAL-scoped clock-bearing phrase ("...good for marriage
  // with Priya?") into TIMING_FIND before exactTime is ever considered.
  if (!FIND_VERB_RE.test(text)) {
    if (clockResult.status === 'VALID') {
      if (!horizonPhrase || !EXACT_CLOCK_USABLE_HORIZONS.has(horizonPhrase)) {
        // An exact time with no resolvable single calendar date (absent
        // entirely, or only a multi-day RANGE horizon like "this weekend")
        // must not silently default to today/tomorrow, and must not fall
        // through to a date-only FIND/PLAN_OPEN default either -- this
        // covers the month-name/weekday negative controls ("Is 10 AM on
        // September 20 good for marriage?", "Is 10 AM next Friday good for
        // marriage?": the clock parses fine, but no recognized date exists)
        // as well as the bare "Is 10 AM good for marriage?" no-date case
        // (brief section 24/54/55/56) -- all three get the same
        // conservative clarification, never an invented date.
        return { intent: 'UNKNOWN', confidence: 'LOW' };
      }
      const resolved = resolveActivity(text);
      if (resolved.activityId || resolved.taskTitle) {
        return {
          intent: 'TIMING_CHECK',
          confidence: 'HIGH',
          ...resolved,
          durationMinutes,
          horizonPhrase,
          customDate,
          exactTime: clockResult.exactTime,
          timePreference,
          scope: scope ?? 'GENERAL',
          personNameQuery,
          locationQuery,
        };
      }
    } else if (clockResult.status === 'INVALID') {
      // A malformed explicit time ("13 PM", "10:60 AM") must never be
      // treated the same as no time supplied at all -- it must not
      // silently disappear into a date-only FIND/PLAN_OPEN default (brief
      // section 11/47/59).
      return { intent: 'UNKNOWN', confidence: 'LOW' };
    }
  }

  // 6. Timing Find -- "When should I work out tomorrow?" / "Best time for
  // a date this weekend" (activity + find-phrasing, or activity + an
  // explicit horizon/time-preference even without a "when should I" verb).
  // Checked BEFORE Check: FIND_VERB_RE's "when should i" would otherwise
  // never be reached, since CHECK_VERB_RE's bare "should i" is a substring
  // of it -- "when" is what disambiguates the two, so the more specific
  // (FIND) match must win first.
  if (FIND_VERB_RE.test(text) || ((horizonPhrase || timePreference) && (personNameQuery || scope))) {
    const resolved = resolveActivity(text);
    if (!resolved.activityId && !resolved.taskTitle) {
      return { intent: 'UNKNOWN', confidence: 'LOW' };
    }
    return {
      intent: 'TIMING_FIND',
      confidence: 'HIGH',
      ...resolved,
      durationMinutes,
      horizonPhrase: horizonPhrase ?? 'TODAY',
      customDate,
      timePreference,
      scope: scope ?? 'GENERAL',
      personNameQuery,
      locationQuery,
    };
  }

  // 7. Timing Check -- "Can I work out now?" (activity + check-phrasing) --
  // ONLY when the request represents a genuine single instant: NOW itself,
  // or no date signal at all (defaults to NOW below, unchanged from
  // before). A valid exact clock always already returned at step 5b above
  // (with `exactTime` set), so by construction `clockResult.status` is
  // never VALID by the time execution reaches here -- this branch never
  // needs to check for one itself.
  //
  // Ask Aura Date-Only CHECK Semantics V1: a CHECK-verb phrase combined
  // with a real date/day/range but NO exact clock ("Should I meditate
  // tomorrow?", "Can I meditate this weekend?", "Should I meditate next
  // month?") does not supply the precision CHECK requires -- Ask Aura must
  // never invent an instant the user didn't provide. This used to
  // fabricate one anyway, downstream in resolveTimingCheckCandidateStart
  // (askAuraOrchestrator.ts): the resolved date + a literal
  // 'T12:00:00.000Z' suffix -- NOT local noon, just UTC noon, confirmed to
  // display as 5:30 PM in Asia/Kolkata and 8:00 AM in America/New_York for
  // the identical "tomorrow" request, and to silently collapse a multi-day
  // range (e.g. "this weekend") down to only its first day.
  //
  // The fix: fall through to the SAME TIMING_FIND shape step 8 below
  // already returns for a bare activity + horizon/timePreference/duration
  // signal -- reusing resolveActivity() here (activityId-or-taskTitle
  // fallback), not step 8's own catalog-only findActivityIntent(), so an
  // uncataloged free-text activity doesn't regress from "wrong CHECK" to
  // UNKNOWN merely because this branch now sometimes returns FIND instead
  // of CHECK.
  if (CHECK_VERB_RE.test(text)) {
    const resolved = resolveActivity(text);
    if (!resolved.activityId && !resolved.taskTitle) {
      return { intent: 'UNKNOWN', confidence: 'LOW' };
    }
    if (!horizonPhrase || horizonPhrase === 'NOW') {
      return {
        intent: 'TIMING_CHECK',
        confidence: 'HIGH',
        ...resolved,
        durationMinutes,
        horizonPhrase: horizonPhrase ?? 'NOW',
        customDate,
        timePreference,
        scope: scope ?? 'GENERAL',
        personNameQuery,
        locationQuery,
      };
    }
    return {
      intent: 'TIMING_FIND',
      confidence: 'HIGH',
      ...resolved,
      durationMinutes,
      horizonPhrase,
      customDate,
      timePreference,
      scope: scope ?? 'GENERAL',
      personNameQuery,
      locationQuery,
    };
  }

  // 8. An activity + an explicit horizon/duration/timePreference signal
  // (no recognizable find/check verb at all) -- e.g. "Workout tomorrow
  // morning" or "deep work tomorrow morning for 60 minutes". Checked
  // BEFORE the bare-short-phrase PLAN_OPEN fallback below, so a real
  // timing signal always wins over the "just an activity name" default.
  const bareActivity = findActivityIntent(text);
  if (bareActivity && (horizonPhrase || timePreference || durationMinutes)) {
    return {
      intent: 'TIMING_FIND',
      confidence: 'HIGH',
      activityId: bareActivity.id,
      durationMinutes,
      horizonPhrase: horizonPhrase ?? 'TODAY',
      customDate,
      timePreference,
      scope: scope ?? 'GENERAL',
      personNameQuery,
      locationQuery,
    };
  }

  // 8b. A bare recognized, Muhurtham-eligible activity phrased as a
  // "best/good/auspicious/favorable date/time/day" request, with no other
  // find/check verb or timing signal at all (Ask Aura Bare Ceremonial
  // "Best Date" Routing follow-up) -- e.g. "Best marriage date." Without
  // this, such a phrase would otherwise fall all the way to step 9's
  // generic PLAN_OPEN default below, even though the wording is clearly
  // asking for a timing search, not just "open Plan with this activity."
  // Checked AFTER step 8's own explicit-signal TIMING_FIND branch (so it
  // never overrides an already-more-specific match) and capability-gated
  // via isSupportedMuhurthamActivity -- e.g. "Best time for a date."
  // (dating, not eligible) never reaches this branch, so dating's own
  // PLAN_OPEN/TIMING_FIND behavior is completely unaffected. Reuses the
  // SAME buildMuhurthamSearchIfEligible() helper step 3 already uses,
  // not a second construction path.
  if (bareActivity && isSupportedMuhurthamActivity(bareActivity.id) && CEREMONIAL_BEST_DATE_RE.test(text)) {
    const muhurthamSearch = buildMuhurthamSearchIfEligible();
    if (muhurthamSearch) return muhurthamSearch;
  }

  // 9. A bare recognized activity with no intent verb or timing signal at
  // all -- "Workout" -- defaults to opening Plan with the activity
  // pre-filled (brief section 5: "default to activity selection / planning
  // assistance, not an arbitrary Panchang explanation"), never a guessed
  // timing search.
  if (bareActivity && text.split(/\s+/).length <= 4) {
    return { intent: 'PLAN_OPEN', confidence: 'HIGH', activityId: bareActivity.id };
  }

  return { intent: 'UNKNOWN', confidence: 'LOW' };
}

/** Follow-up turns (brief section 15/16) -- reuse the previous turn's
 * activity/date/scope, only changing what this turn actually stated. "Why?"
 * and "Other times?" carry NO new fields at all (the orchestrator re-uses
 * its own last computed result); "What about morning?" changes just
 * timePreference; "What about tomorrow?" changes just the horizon. */
function applyFollowUp(kind: AskFollowUpKind, text: string, previous: ParsedAskAuraRequest): ParsedAskAuraRequest {
  if (kind === 'WHY' || kind === 'OTHER_TIMES' || kind === 'PLAN_IT') {
    return { ...previous, followUp: kind };
  }

  // REPEAT_WITH_CHANGES is never returned by detectFollowUp() directly;
  // reaching here only happens if a caller wants generic "same activity,
  // new date/preference" reuse -- kept for parseFollowUpChange() below.
  return { ...previous, followUp: kind };
}

/** "What about morning?" / "What about tomorrow?" / "What about Anna?" --
 * short phrases that change exactly one field of the previous request
 * (brief section 16). Not auto-detected inside parseAskAuraRequest's own
 * followUp branch above (those are content-free acknowledgements); this is
 * called by the orchestrator when detectFollowUp() found nothing but the
 * text still looks like a minimal delta on the previous turn. */
export function parseFollowUpChange(rawText: string, previous: ParsedAskAuraRequest): ParsedAskAuraRequest | null {
  const text = rawText.trim().toLowerCase();
  const whatAboutMatch = text.match(/^what about (.+?)\??$/) || text.match(/^and (.+?)\??$/);
  if (!whatAboutMatch) return null;

  const delta = whatAboutMatch[1].trim();
  const timePreference = parseTimePreference(delta);
  if (timePreference) return { ...previous, timePreference, followUp: 'REPEAT_WITH_CHANGES' };

  const { horizonPhrase, customDate } = parseHorizonPhrase(delta);
  if (horizonPhrase) return { ...previous, horizonPhrase, customDate, followUp: 'REPEAT_WITH_CHANGES' };

  const { scope, personNameQuery } = parseScope(`with ${delta}`);
  if (personNameQuery) return { ...previous, scope, personNameQuery, followUp: 'REPEAT_WITH_CHANGES' };

  return null;
}
