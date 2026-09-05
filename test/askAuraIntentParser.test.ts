import { extractLocationQuery, parseAskAuraRequest, parseFollowUpChange, ParsedAskAuraRequest } from '../packages/recommendation/src/askAuraIntent';
import { isSupportedMuhurthamActivity } from '../packages/recommendation/src/muhurthamFinder';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { resolveEventLocationQuery } from '../apps/web/lib/askAuraOrchestrator';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const NOW = new Date('2026-08-23T10:00:00.000Z'); // a Sunday

function parse(text: string, previous?: ParsedAskAuraRequest) {
  return parseAskAuraRequest(text, { now: NOW, previous });
}

// ============================================================
// Section 31/1 -- GOOD_RIGHT_NOW
// ============================================================
{
  const r = parse('What should I do right now?');
  check('"What should I do right now?" -> GOOD_RIGHT_NOW', r.intent === 'GOOD_RIGHT_NOW');
}
{
  const r = parse('What can I do?');
  check('"What can I do?" -> GOOD_RIGHT_NOW', r.intent === 'GOOD_RIGHT_NOW');
}

// ============================================================
// Section 32 -- TIMING_CHECK: "Can I work out now?"
// ============================================================
{
  const r = parse('Can I work out now?');
  check('"Can I work out now?" -> TIMING_CHECK', r.intent === 'TIMING_CHECK');
  check('...activityId = workout', r.activityId === 'workout');
  check('...horizonPhrase = NOW', r.horizonPhrase === 'NOW');
}

// ============================================================
// Section 33 -- TIMING_FIND: "When should I do deep work tomorrow morning for 60 minutes?"
// ============================================================
{
  const r = parse('When should I do deep work tomorrow morning for 60 minutes?');
  check('-> TIMING_FIND', r.intent === 'TIMING_FIND');
  check('...activityId = deep-work', r.activityId === 'deep-work');
  check('...horizonPhrase = TOMORROW', r.horizonPhrase === 'TOMORROW');
  check('...timePreference = MORNING', r.timePreference === 'MORNING');
  check('...durationMinutes = 60', r.durationMinutes === 60);
}

// ============================================================
// Section 34 -- SHARED: "Date night with Anna this weekend"
// ============================================================
{
  const r = parse('Best time for a date with Anna this weekend');
  check('-> TIMING_FIND', r.intent === 'TIMING_FIND');
  check('...scope = SHARED', r.scope === 'SHARED');
  check('...personNameQuery = Anna', r.personNameQuery?.toLowerCase() === 'anna');
  check('...horizonPhrase = THIS_WEEKEND', r.horizonPhrase === 'THIS_WEEKEND');
  check('...activityId resolves to a dating-family activity', r.activityId === 'dating' || r.activityId === 'date-night');
}

// ============================================================
// Section 35 -- PANCHANG_QUERY: "When is Rahu Kalam tomorrow?"
// ============================================================
{
  const r = parse('When is Rahu Kalam tomorrow?');
  check('-> PANCHANG_QUERY', r.intent === 'PANCHANG_QUERY');
  check('...panchangField = RAHU_KALAM', r.panchangField === 'RAHU_KALAM');
  check('...horizonPhrase = TOMORROW', r.horizonPhrase === 'TOMORROW');
}
{
  const r = parse("What's today's Nakshatra?");
  check('"What\'s today\'s Nakshatra?" -> PANCHANG_QUERY', r.intent === 'PANCHANG_QUERY');
  check('...panchangField = NAKSHATRA', r.panchangField === 'NAKSHATRA');
}
{
  const r = parse("What is tomorrow's Panchang?");
  check('"What is tomorrow\'s Panchang?" -> PANCHANG_QUERY', r.intent === 'PANCHANG_QUERY');
  check('...panchangField = FULL', r.panchangField === 'FULL');
  check('...horizonPhrase = TOMORROW', r.horizonPhrase === 'TOMORROW');
}

// ============================================================
// PANCHANG_EXPLAIN: "What is Rohini?" -- checked BEFORE PANCHANG_QUERY so a
// term explanation never falls into the "when is..." query bucket.
// ============================================================
{
  const r = parse('What is Rohini?');
  check('"What is Rohini?" -> PANCHANG_EXPLAIN, not PANCHANG_QUERY', r.intent === 'PANCHANG_EXPLAIN');
  check('...explainTerm = rohini', r.explainTerm === 'rohini');
}
{
  const r = parse('What does Yamagandam mean?');
  check('"What does Yamagandam mean?" -> PANCHANG_EXPLAIN', r.intent === 'PANCHANG_EXPLAIN');
}

// ============================================================
// Section 36 -- MUHURTHAM_SEARCH: "Good dates for Griha Pravesh next month"
// ============================================================
{
  const r = parse('Good dates for Griha Pravesh next month');
  check('-> MUHURTHAM_SEARCH', r.intent === 'MUHURTHAM_SEARCH');
  check('...activityId = griha-pravesh', r.activityId === 'griha-pravesh');
  check('...griha-pravesh really is Muhurtham-eligible (sanity check on the fixture itself)', isSupportedMuhurthamActivity('griha-pravesh'));
  check('...horizonPhrase = NEXT_MONTH', r.horizonPhrase === 'NEXT_MONTH');
  check('...scope defaults to GENERAL', r.scope === 'GENERAL');
}
// UPDATED by Ask Aura Richer SHARED Grammar V1's fail-closed follow-up:
// "for us" (no resolvable other-person name) used to silently execute as a
// GENERAL-equivalent Muhurtham search tagged scope=SHARED. The core
// invariant (scope === 'SHARED' && !personNameQuery for an executable
// timing request -> clarification) now applies uniformly.
{
  const r = parse('Good dates for Griha Pravesh for us next month');
  check('"...for us..." (no resolvable partner) -> UNKNOWN, never a silent GENERAL-equivalent search', r.intent === 'UNKNOWN');
}

// ============================================================
// Section 37 -- THE regression test: casual activity must NOT route to
// Muhurtham Finder even with search-y phrasing.
// ============================================================
{
  const r = parse('Best time for coffee tomorrow');
  check('"Best time for coffee tomorrow" -> TIMING_FIND, never MUHURTHAM_SEARCH', r.intent === 'TIMING_FIND');
  // "coffee" alone isn't in coffee-tea's own alias list (only "grab
  // coffee"/"meet for coffee"/etc) -- findActivityIntent() correctly
  // returns no match, so this falls through to the SAME free-text fallback
  // classifier Timing Search itself already uses for unresolved text
  // (brief section 4), not a fabricated activityId.
  check('...no activityId resolved -> falls through to taskTitle (existing fallback classifier), never a guessed id', !r.activityId && Boolean(r.taskTitle));
  check('...taskTitle is never routed through Muhurtham eligibility for an unresolved activity', !r.activityId || !isSupportedMuhurthamActivity(r.activityId));
}
{
  const r = parse('Good dates for coffee');
  check('"Good dates for coffee" (search-y phrasing + non-eligible activity) -> falls through to TIMING_FIND, not MUHURTHAM_SEARCH', r.intent !== 'MUHURTHAM_SEARCH');
}

// ============================================================
// Section 38 -- follow-up: "When should I work out tomorrow?" then "What about morning?"
// ============================================================
{
  const first = parse('When should I work out tomorrow?');
  check('First turn -> TIMING_FIND, workout, tomorrow', first.intent === 'TIMING_FIND' && first.activityId === 'workout' && first.horizonPhrase === 'TOMORROW');

  const delta = parseFollowUpChange('What about morning?', first);
  check('Follow-up "What about morning?" is recognized as a delta', delta !== null);
  check('...same activity reused', delta?.activityId === 'workout');
  check('...same horizon reused (tomorrow)', delta?.horizonPhrase === 'TOMORROW');
  check('...timePreference changed to MORNING', delta?.timePreference === 'MORNING');
}

// ============================================================
// Section 39 -- "Why?" follow-up carries no new fields, just marks followUp.
// ============================================================
{
  const first = parse('Can I work out now?');
  const why = parse('Why?', first);
  check('"Why?" reuses the previous parsed request verbatim', why.intent === first.intent && why.activityId === first.activityId);
  check('...tagged as a WHY follow-up', why.followUp === 'WHY');
}

// ============================================================
// Section 40 -- UNKNOWN: ambiguous/unsupported input never fabricates an
// activity or intent.
// ============================================================
{
  const r = parse('asdkfjaslkdfj random gibberish');
  check('Gibberish -> UNKNOWN, LOW confidence, no activityId', r.intent === 'UNKNOWN' && r.confidence === 'LOW' && !r.activityId);
}
{
  const r = parse('');
  check('Empty string -> UNKNOWN', r.intent === 'UNKNOWN');
}

// ============================================================
// Section 5 -- precedence rules.
// ============================================================
{
  const r = parse('Workout');
  check('Bare "Workout" (no verb) -> PLAN_OPEN, not a guessed timing search', r.intent === 'PLAN_OPEN');
  check('...activityId = workout', r.activityId === 'workout');
}
{
  const r = parse('Best time for workout');
  check('"Best time for workout" -> TIMING_FIND', r.intent === 'TIMING_FIND');
}
{
  const r = parse('Workout tomorrow morning');
  check('"Workout tomorrow morning" -> TIMING_FIND (activity + horizon, no verb needed)', r.intent === 'TIMING_FIND');
  check('...horizonPhrase = TOMORROW', r.horizonPhrase === 'TOMORROW');
  check('...timePreference = MORNING', r.timePreference === 'MORNING');
}

// ============================================================
// Duration parsing (brief section 3).
// ============================================================
{
  const r = parse('When should I do deep work for 1 hour?');
  check('"1 hour" -> 60 minutes', r.durationMinutes === 60);
}
{
  const r = parse('When should I do deep work for 90 mins?');
  check('"90 mins" -> 90 minutes', r.durationMinutes === 90);
}
{
  const r = parse('When should I do deep work for 1 hour 30 minutes?');
  check('"1 hour 30 minutes" -> 90 minutes', r.durationMinutes === 90);
}
{
  // Live walkthrough regression (section 43C): "an hour" has no leading
  // digit and was silently falling back to the 30-min default.
  const r = parse('When should I do deep work tomorrow morning for an hour?');
  check('"an hour" (no digit) -> 60 minutes', r.durationMinutes === 60);
}

// ============================================================
// Ask Aura Exact Clock-Time CHECK V1: an explicit clock time is the
// semantic discriminator between a CHECK-shaped and a FIND-shaped "is X
// good for Y" question -- never a broadened CHECK_VERB_RE. Section 40's
// required parser test matrix.
// ============================================================

for (const t of [
  'Is 10 AM tomorrow good for marriage?',
  'Is tomorrow at 10 AM good for marriage?',
  'Is 10:30 AM tomorrow good for marriage?',
  'Is 10am tomorrow good for marriage?',
  'Is 10:30am tomorrow good for marriage?',
  'Would 10 AM tomorrow be good for deep work?',
  'How is 10 AM tomorrow for deep work?',
]) {
  const r = parse(t);
  check(`"${t}" -> TIMING_CHECK`, r.intent === 'TIMING_CHECK');
}
{
  const r = parse('Is 10 AM tomorrow good for marriage?');
  check('"Is 10 AM tomorrow good for marriage?" -> exactTime=10:00, activityId=marriage, horizonPhrase=TOMORROW', r.exactTime === '10:00' && r.activityId === 'marriage' && r.horizonPhrase === 'TOMORROW');
}
{
  const r = parse('Is 6 PM today good for deep work?');
  check('"Is 6 PM today good for deep work?" -> exactTime=18:00, TODAY', r.intent === 'TIMING_CHECK' && r.exactTime === '18:00' && r.horizonPhrase === 'TODAY' && r.activityId === 'deep-work');
}
{
  const r = parse('Is 6:45 PM tonight good for a workout?');
  check('"Is 6:45 PM tonight good for a workout?" -> exactTime=18:45, TODAY (tonight aliased)', r.intent === 'TIMING_CHECK' && r.exactTime === '18:45' && r.horizonPhrase === 'TODAY' && r.activityId === 'workout');
}

// Section 46: midnight/noon -- a common parser bug.
{
  const r = parse('Is 12 AM tomorrow good for meditation?');
  check('"12 AM" -> 00:00 (midnight), not 12:00', r.intent === 'TIMING_CHECK' && r.exactTime === '00:00');
}
{
  const r = parse('Is 12 PM tomorrow good for deep work?');
  check('"12 PM" -> 12:00 (noon), not 00:00', r.intent === 'TIMING_CHECK' && r.exactTime === '12:00');
}

// Section 45: duration collision safety -- clock parsing must never
// confuse a duration phrase for a clock, and vice versa.
{
  const r = parse('Is 10 AM tomorrow good for 2 hours of deep work?');
  check('"2 hours" is parsed as duration=120, never mistaken for a clock', r.durationMinutes === 120 && r.exactTime === '10:00');
}
{
  const r = parse('Is 10 AM tomorrow good for a 90 minute marriage ceremony?');
  check('"90 minute" is parsed as duration=90 alongside exactTime=10:00', r.durationMinutes === 90 && r.exactTime === '10:00' && r.activityId === 'marriage');
}
{
  const r = parse('Is 6 PM good for a 45 minute workout?');
  // No recognized horizon here at all ("good for a 45 minute workout" has
  // no today/tomorrow/tonight word) -- per the no-date-clock control
  // (section 56), this must be a conservative clarification, not a
  // silently-invented date.
  check('"Is 6 PM good for a 45 minute workout?" (no date/horizon) -> UNKNOWN, not a silently-dated CHECK', r.intent === 'UNKNOWN');
}

// Section 47: invalid clock forms must be distinguishable from no clock at
// all -- never silently become a date-only FIND/PLAN_OPEN default.
for (const t of [
  'Is 13 PM tomorrow good for marriage?',
  'Is 0 AM tomorrow good for deep work?',
  'Is 10:60 AM tomorrow good for deep work?',
  'Is 25 PM tomorrow good for a workout?',
]) {
  const r = parse(t);
  check(`"${t}" (malformed clock) -> UNKNOWN, not silently a date-only FIND`, r.intent === 'UNKNOWN' && r.exactTime === undefined);
}

// Section 48: date-only CHECK-shaped language must remain completely
// unaffected -- no exactTime present, so existing FIND semantics apply.
for (const [t, expectedIntent] of [
  ['Is tomorrow good for marriage?', 'TIMING_FIND'],
  ['Is tomorrow good for deep work?', 'TIMING_FIND'],
  ['Is this weekend good for marriage?', 'TIMING_FIND'],
  ['Is next month good for marriage?', 'TIMING_FIND'],
  ['Is tomorrow morning good for deep work?', 'TIMING_FIND'],
] as const) {
  const r = parse(t);
  check(`"${t}" (date-only, no clock) -> ${expectedIntent}, no exactTime`, r.intent === expectedIntent && r.exactTime === undefined);
}

// Section 49: explicit FIND language must retain full precedence over
// exact-clock CHECK inference -- the clock there is a search constraint/
// reference point, not the candidate instant.
for (const [t, expectedIntent] of [
  ['Find the best time tomorrow for deep work.', 'TIMING_FIND'],
  ['When is the best time tomorrow for deep work?', 'PANCHANG_QUERY'], // pre-existing PANCHANG_QUERY_RE "when is" match, unrelated to this PR -- see implementation report
  ['Find a wedding muhurtham tomorrow.', 'MUHURTHAM_SEARCH'],
  ['Best wedding time tomorrow.', 'TIMING_FIND'],
] as const) {
  const r = parse(t);
  check(`"${t}" (explicit FIND/search language) -> ${expectedIntent}, unaffected`, r.intent === expectedIntent);
}
{
  // The critical explicit-FIND-with-clock-as-constraint case: "10 AM" here
  // is a search boundary ("after 10 AM"), not the candidate instant --
  // must remain TIMING_FIND, never captured by exact-clock CHECK inference.
  const r = parse('Find the best time tomorrow after 10 AM for deep work.');
  check('"Find the best time tomorrow after 10 AM for deep work." stays TIMING_FIND (clock is a constraint, not a CHECK instant)', r.intent === 'TIMING_FIND');
}

// Section 50: dating regression -- exact-clock CHECK must not affect
// activity resolution.
{
  const r = parse('Is 7 PM tomorrow good for a date?');
  check('"Is 7 PM tomorrow good for a date?" resolves dating, exact-clock CHECK', r.intent === 'TIMING_CHECK' && r.activityId === 'dating' && r.exactTime === '19:00');
}
{
  const r = parse('Is 7 PM tomorrow good for date night?');
  check('"Is 7 PM tomorrow good for date night?" resolves date-night, exact-clock CHECK', r.intent === 'TIMING_CHECK' && r.activityId === 'date-night' && r.exactTime === '19:00');
}

// Section 51/52: generic capability controls -- exact-clock CHECK must
// work identically for every Muhurtham-eligible activity, not just
// marriage (capability-driven, proven already by PR #65's own redirect;
// this only proves the PARSER correctly attaches exactTime regardless of
// which eligible activity resolves).
{
  const r = parse('Is 10 AM tomorrow good for griha pravesh?');
  check('"Is 10 AM tomorrow good for griha pravesh?" -> exactTime=10:00, griha-pravesh', r.intent === 'TIMING_CHECK' && r.activityId === 'griha-pravesh' && r.exactTime === '10:00');
}
{
  // "starting my business" has a pre-existing alias verb-form gap (does
  // not match business-start's own aliases, e.g. "start my business") --
  // unrelated to this PR, not fixed here. Using an alias-matching phrase
  // instead, per this PR's own brief section 52 instruction.
  const r = parse('Is 10 AM tomorrow good for start my business?');
  check('"Is 10 AM tomorrow good for start my business?" -> exactTime=10:00, business-start', r.intent === 'TIMING_CHECK' && r.activityId === 'business-start' && r.exactTime === '10:00');
}

// Section 53: ISO custom date -- both orderings.
{
  const r = parse('Is 10 AM on 2026-09-20 good for marriage?');
  check('"Is 10 AM on 2026-09-20 good for marriage?" -> CUSTOM_DATE=2026-09-20, exactTime=10:00', r.intent === 'TIMING_CHECK' && r.horizonPhrase === 'CUSTOM_DATE' && r.customDate === '2026-09-20' && r.exactTime === '10:00');
}
{
  const r = parse('Is 2026-09-20 at 10 AM good for marriage?');
  check('"Is 2026-09-20 at 10 AM good for marriage?" -> CUSTOM_DATE=2026-09-20, exactTime=10:00', r.intent === 'TIMING_CHECK' && r.horizonPhrase === 'CUSTOM_DATE' && r.customDate === '2026-09-20' && r.exactTime === '10:00');
}

// Section 54/55: month-name and weekday negative controls -- WITHOUT a
// timezone supplied (backward compat: many callers, including most of this
// file's own fixtures, never exercise natural-date parsing at all), a
// valid clock with NO recognized date/horizon must never silently pick
// today/tomorrow. Updated by Ask Aura Absolute Date + Weekday Parsing V1:
// month-name/weekday dates ARE now supported, but ONLY when the caller
// supplies a timezone (see the dedicated section below for the resolved,
// positive-result tests) -- with no timezone at all (this section), the
// same conservative UNKNOWN result is preserved unchanged.
{
  const r = parse('Is 10 AM on September 20 good for marriage?');
  check('"Is 10 AM on September 20 good for marriage?" with NO timezone -> UNKNOWN (natural-date parsing needs a timezone; see below for the resolved case)', r.intent === 'UNKNOWN');
}
{
  const r = parse('Is 10 AM next Friday good for marriage?');
  check('"Is 10 AM next Friday good for marriage?" with NO timezone -> UNKNOWN (natural-date parsing needs a timezone; see below for the resolved case)', r.intent === 'UNKNOWN');
}

// Section 56: no-date clock control.
{
  const r = parse('Is 10 AM good for marriage?');
  check('"Is 10 AM good for marriage?" (no date at all) -> UNKNOWN, conservative clarification', r.intent === 'UNKNOWN');
}
{
  const r = parse('Is 10 AM good for deep work?');
  check('"Is 10 AM good for deep work?" (no date at all) -> UNKNOWN, conservative clarification', r.intent === 'UNKNOWN');
}

// ============================================================
// Ask Aura Absolute Date + Weekday Parsing V1: month-name ("September 20")
// and weekday ("Friday", "next Friday") dates, resolved against the Timing
// Location's own local "today" (never the server's UTC date) via a new
// `timezone` field on AskAuraParseContext. Only exercised when a timezone
// is supplied -- see the negative controls above for the no-timezone case.
// ============================================================

const TZ = 'Asia/Kolkata';
function parseTz(text: string, now: Date, timezone: string | undefined = TZ) {
  return parseAskAuraRequest(text, { now, timezone });
}

// Fixed "now" whose Asia/Kolkata local date is 2026-09-04, a Friday.
const FRIDAY_NOW = new Date('2026-09-04T10:00:00.000Z');

// --- Month-name date forms ---
for (const t of [
  'Is September 20 good for marriage?',
  'Is Sep 20 good for marriage?',
  'Is Sept 20 good for marriage?',
  'Is September 20th good for marriage?',
  'Is 20 September good for marriage?',
  'Is 20th September good for marriage?',
  'Is 20 Sep good for marriage?',
]) {
  const r = parseTz(t, FRIDAY_NOW);
  check(`"${t}" -> customDate=2026-09-20`, r.horizonPhrase === 'CUSTOM_DATE' && r.customDate === '2026-09-20');
}

// --- Explicit year always wins for a FUTURE date (preserved exactly,
// never silently rolled forward) ---
for (const [t, expected] of [
  ['Is September 20 2026 good for marriage?', '2026-09-20'],
  ['Is September 20, 2026 good for marriage?', '2026-09-20'],
  ['Is 20 September 2026 good for marriage?', '2026-09-20'],
] as const) {
  const r = parseTz(t, FRIDAY_NOW);
  check(`"${t}" -> customDate=${expected} (explicit year wins)`, r.customDate === expected);
}

// --- Explicit PAST date: historical timing is not an intentional Ask Aura
// capability (neither Timing Search nor the Muhurtham engine has a
// "must be in the future" guard of their own -- verified directly, both
// will compute a real-looking score and even offer a "Plan this" action
// for a historical instant if not stopped here). The date must be
// preserved EXACTLY internally (never mutated into a future year -- this
// is what distinguishes it from the implicit-year "already passed this
// year" case just below, which DOES roll forward) but the request as a
// whole must resolve to UNKNOWN/clarification, never a silent
// future-planning-shaped result. ---
for (const t of ['Is September 20 2020 good for marriage?', 'Is September 20, 2020 good for marriage?', 'Is 20 September 2020 good for marriage?']) {
  const r = parseTz(t, FRIDAY_NOW);
  check(`"${t}" (explicit past date) -> UNKNOWN, never a silent past-date result`, r.intent === 'UNKNOWN');
}
// Same guard applies to the PRE-EXISTING ISO-date path too (this PR's
// natural-date and ISO customDate converge into the same field, so a
// single shared check covers both) -- confirmed via direct trace that
// this exact gap already existed on main before this PR, just via a
// different syntax; closing it here rather than leaving one path fixed
// and the other silently broken.
{
  const r = parseTz('Is 2020-09-20 good for marriage?', FRIDAY_NOW);
  check('"Is 2020-09-20 good for marriage?" (explicit past ISO date) -> UNKNOWN', r.intent === 'UNKNOWN');
}
// No timezone supplied -> the past-date guard itself is skipped (it needs
// a timezone to know what "today" locally even is), so behavior here is
// UNCHANGED from before this follow-up -- still whatever the pre-existing
// path already did (UNKNOWN via the generic bare-activity/no-signal
// fallback for this particular phrasing).
{
  const r = parseAskAuraRequest('Is September 20 2020 good for marriage?', { now: FRIDAY_NOW });
  check('No timezone supplied -> past-date guard not applied (unchanged pre-existing behavior)', r.intent === 'UNKNOWN');
}

// --- Implicit year: already-passed month/day rolls to next year; today's
// own exact month/day stays THIS year (same-day policy) ---
{
  const r = parseTz('Is August 20 good for marriage?', FRIDAY_NOW);
  check('"Is August 20 good for marriage?" (already passed this year, local today=2026-09-04) -> 2027-08-20', r.customDate === '2027-08-20');
}
{
  const r = parseTz('Is September 4 good for marriage?', FRIDAY_NOW);
  check('"Is September 4 good for marriage?" (== local today) -> 2026-09-04, not rolled to next year', r.customDate === '2026-09-04');
}
{
  const r = parseTz('Is September 5 good for marriage?', FRIDAY_NOW);
  check('"Is September 5 good for marriage?" (tomorrow) -> 2026-09-05', r.customDate === '2026-09-05');
}

// --- Leap day ---
{
  const r = parseTz('Is February 29 2028 good for marriage?', FRIDAY_NOW);
  check('"February 29 2028" (leap year, explicit) -> valid 2028-02-29', r.customDate === '2028-02-29');
}
{
  const r = parseTz('Is February 29 2027 good for marriage?', FRIDAY_NOW);
  check('"February 29 2027" (non-leap year, explicit) -> UNKNOWN, never normalized to March 1', r.intent === 'UNKNOWN');
}
{
  const r = parseTz('Is February 29 good for marriage?', FRIDAY_NOW);
  check('Implicit "February 29" (2026 is not a leap year) -> rolls to next valid future leap day, 2028-02-29', r.customDate === '2028-02-29');
}

// --- Invalid calendar dates: never silently JS-Date-rollover-normalized ---
for (const t of ['Is February 30 good for marriage?', 'Is April 31 good for marriage?', 'Is September 31 good for marriage?', 'Is November 31 good for marriage?', 'Is September 32 good for marriage?']) {
  const r = parseTz(t, FRIDAY_NOW);
  check(`"${t}" (impossible calendar date) -> UNKNOWN, never a fallback date`, r.intent === 'UNKNOWN');
}

// --- Weekday semantics: bare weekday = next occurrence INCLUDING today;
// "next <weekday>" = the following calendar week, not merely the next
// chronological occurrence (brief's own worked example: today=Friday). ---
{
  const r = parseTz('Is Friday good for marriage?', FRIDAY_NOW);
  check('Bare "Friday" when today IS Friday -> today, 2026-09-04', r.customDate === '2026-09-04');
}
{
  const r = parseTz('Is next Friday good for marriage?', FRIDAY_NOW);
  check('"next Friday" when today IS Friday -> 7 days later, 2026-09-11 (not today)', r.customDate === '2026-09-11');
}
{
  const r = parseTz('Is this Friday good for marriage?', FRIDAY_NOW);
  check('"this Friday" when today IS Friday -> today, 2026-09-04 (same inclusive semantics as bare)', r.customDate === '2026-09-04');
}
{
  const r = parseTz('Is Saturday good for marriage?', FRIDAY_NOW);
  check('Bare "Saturday" when today is Friday -> tomorrow, 2026-09-05', r.customDate === '2026-09-05');
}
{
  const r = parseTz('Is Thursday good for marriage?', FRIDAY_NOW);
  check('Bare "Thursday" when today is Friday -> next occurrence, 2026-09-10 (6 days away)', r.customDate === '2026-09-10');
}
// Second worked example from the brief: today=Thursday -- bare Friday is
// tomorrow, but "next Friday" is the Friday of the week AFTER this one
// (8 days away), not merely the next chronological Friday.
{
  const THURSDAY_NOW = new Date('2026-09-03T10:00:00.000Z'); // Asia/Kolkata local: 2026-09-03, Thursday
  const bareFriday = parseTz('Is Friday good for marriage?', THURSDAY_NOW);
  check('Bare "Friday" when today is Thursday -> tomorrow, 2026-09-04', bareFriday.customDate === '2026-09-04');
  const nextFriday = parseTz('Is next Friday good for marriage?', THURSDAY_NOW);
  check('"next Friday" when today is Thursday -> Friday of the FOLLOWING week, 2026-09-11 (not tomorrow)', nextFriday.customDate === '2026-09-11');
}
// Bare weekday equal to today, using the file's own shared Sunday fixture.
{
  const r = parseTz('Is Sunday good for marriage?', NOW);
  check('Bare "Sunday" when today IS Sunday (shared file fixture) -> today, 2026-08-23', r.customDate === '2026-08-23');
}

// --- CRITICAL timezone-date-boundary test: the UTC calendar date and the
// Timing Location's local calendar date differ -- weekday resolution must
// use the LOCAL date, never UTC. ---
{
  // UTC 2026-09-04T20:00:00.000Z is already 2026-09-05 (Saturday) in
  // Asia/Kolkata (UTC+5:30).
  const boundaryNow = new Date('2026-09-04T20:00:00.000Z');
  const utcParts = { year: boundaryNow.getUTCFullYear(), month: boundaryNow.getUTCMonth() + 1, day: boundaryNow.getUTCDate() };
  check('sanity: UTC calendar date is 2026-09-04 (Friday), one day behind local', utcParts.month === 9 && utcParts.day === 4);
  const r = parseTz('Is Saturday good for marriage?', boundaryNow, 'Asia/Kolkata');
  check('"Is Saturday good for marriage?" resolves against LOCAL 2026-09-05 (Saturday=today locally), not UTC 2026-09-04 (still Friday there)', r.customDate === '2026-09-05');
}

// --- Range rejection: never silently keep just the first date ---
for (const t of ['Is September 20-25 good for marriage?', 'Is September 20 to September 25 good for marriage?', 'Is September 20 to 25 good for marriage?', 'Is next Monday through Friday good for marriage?']) {
  const r = parseTz(t, FRIDAY_NOW);
  check(`"${t}" (unsupported date RANGE) -> UNKNOWN, never partially consumed`, r.intent === 'UNKNOWN');
}

// --- Month-only (no day number) must NOT become a single date ---
{
  const r = parseTz('Is October good for marriage?', FRIDAY_NOW);
  check('Bare "October" (no day) -> not resolved as CUSTOM_DATE', r.horizonPhrase !== 'CUSTOM_DATE');
}

// --- "next month" must stay NEXT_MONTH, never reinterpreted as a named-
// month date ---
{
  const r = parseTz('Find the best time next month for a workout.', FRIDAY_NOW);
  check('"next month" -> NEXT_MONTH horizon, unaffected by month-name date parsing', r.horizonPhrase === 'NEXT_MONTH');
}

// --- ISO date / today / tomorrow precedence preserved unchanged ---
{
  const r = parseTz('Is 2026-09-20 good for marriage?', FRIDAY_NOW);
  check('ISO date still resolves directly -> 2026-09-20', r.customDate === '2026-09-20');
}
{
  const r = parseTz('Is today good for marriage?', FRIDAY_NOW);
  check('"today" -> TODAY horizon (relative-phrase precedence preserved)', r.horizonPhrase === 'TODAY');
}
{
  const r = parseTz('Is tomorrow good for marriage?', FRIDAY_NOW);
  check('"tomorrow" -> TOMORROW horizon (relative-phrase precedence preserved)', r.horizonPhrase === 'TOMORROW');
}

// --- No timezone supplied at all -> natural-date parsing stays ABSENT
// (backward compat: the field is optional). Calling parseAskAuraRequest
// directly here (not via parseTz, whose `timezone` parameter defaults to
// TZ even when explicitly passed `undefined` -- JS default-parameter
// substitution applies to an explicit `undefined` argument too) so the
// context object genuinely has no `timezone` key at all. ---
{
  const r = parseAskAuraRequest('Is September 20 good for marriage?', { now: FRIDAY_NOW });
  check('No timezone supplied -> "September 20" is NOT parsed as a date', r.horizonPhrase !== 'CUSTOM_DATE');
}
{
  const r = parseAskAuraRequest('Is Friday good for marriage?', { now: FRIDAY_NOW });
  check('No timezone supplied -> "Friday" is NOT parsed as a date', r.horizonPhrase !== 'CUSTOM_DATE');
}

// --- Month date / weekday date + exact clock -> TIMING_CHECK (the
// exact-clock machinery from PR #66 works automatically, unmodified, once
// customDate is resolved) ---
{
  const r = parseTz('Is 10 AM on September 20 good for marriage?', FRIDAY_NOW);
  check('"Is 10 AM on September 20 good for marriage?" -> TIMING_CHECK, exactTime=10:00, customDate=2026-09-20', r.intent === 'TIMING_CHECK' && r.exactTime === '10:00' && r.customDate === '2026-09-20');
}
{
  const r = parseTz('Is 10 AM next Friday good for marriage?', FRIDAY_NOW);
  check('"Is 10 AM next Friday good for marriage?" -> TIMING_CHECK, exactTime=10:00, customDate=2026-09-11', r.intent === 'TIMING_CHECK' && r.exactTime === '10:00' && r.customDate === '2026-09-11');
}

// --- Date-only (no clock) -> TIMING_FIND, never CHECK, for both marriage
// and an everyday activity (the orchestrator's own capability redirect,
// unchanged by this PR, is what sends marriage's TIMING_FIND on to the
// canonical Muhurtham engine -- proven in test/askAuraMarriageRouting.test.ts) ---
{
  const r = parseTz('Is September 20 good for marriage?', FRIDAY_NOW);
  check('Marriage date-only (no clock) -> TIMING_FIND, never TIMING_CHECK', r.intent === 'TIMING_FIND' && r.customDate === '2026-09-20');
}
{
  const r = parseTz('Best time for a workout on September 20?', FRIDAY_NOW);
  check('Everyday date-only -> TIMING_FIND', r.intent === 'TIMING_FIND' && r.activityId === 'workout' && r.customDate === '2026-09-20');
}
{
  const r = parseTz('Workout on Saturday.', FRIDAY_NOW);
  check('Everyday bare weekday date -> TIMING_FIND', r.intent === 'TIMING_FIND' && r.activityId === 'workout' && r.customDate === '2026-09-05');
}

// --- Dating alias regression: "date" terminology near a natural calendar
// date must not confuse activity resolution ---
{
  const r = parseTz('Is Friday at 7 PM good for a date?', FRIDAY_NOW);
  check('"Is Friday at 7 PM good for a date?" still resolves activityId=dating, unaffected by date-parsing collision', r.activityId === 'dating');
}

// --- Duration regression: an arbitrary 4-digit number attached to
// "minutes" must never be mistaken for a year/date ---
{
  const r = parseTz('Best time for deep work for 2026 minutes.', FRIDAY_NOW);
  check('"2026 minutes" duration is never treated as a year/date', r.horizonPhrase !== 'CUSTOM_DATE' && r.durationMinutes === 2026);
}

// --- SHARED grammar unaffected: only existing "with <name>"/"for us"/"for
// me" forms, alongside a resolved natural date ---
{
  const r = parseTz('Is September 20 good for marriage with Priya?', FRIDAY_NOW);
  check('SHARED "with Priya" resolves correctly alongside a natural date', r.scope === 'SHARED' && r.personNameQuery === 'priya' && r.customDate === '2026-09-20');
}

// --- Explicit FIND precedence preserved even with a natural date present ---
{
  const r = parseTz('Find the best time on September 20 for a workout.', FRIDAY_NOW);
  check('Explicit "Find the best time..." phrasing + natural date -> TIMING_FIND', r.intent === 'TIMING_FIND' && r.customDate === '2026-09-20');
}

// --- Panchang regression: PANCHANG_QUERY_RE's own existing "when is"
// pattern is untouched, but now incidentally carries a resolved customDate
// through (the field extraction it already consumed is simply more often
// populated) -- documented as an incidental benefit, not a redesign. ---
{
  const r = parseTz('When is Rahu Kalam on September 20?', FRIDAY_NOW);
  check('Panchang query now carries the resolved customDate through (incidental improvement, PANCHANG_QUERY_RE itself untouched)', r.intent === 'PANCHANG_QUERY' && r.customDate === '2026-09-20');
}

// --- Follow-up regression: "What about October?" / "What about Chennai?"
// must remain EXACTLY as broken as before -- parseFollowUpChange never
// calls the new natural-date functions, only the original, untouched
// parseHorizonPhrase, so this is unaffected by construction. ---
{
  const previous = parseTz('Is tomorrow good for marriage?', FRIDAY_NOW);
  check('sanity: previous turn has horizonPhrase=TOMORROW (not CUSTOM_DATE)', previous.horizonPhrase === 'TOMORROW');
  const octoberDelta = parseFollowUpChange('What about October?', previous);
  check('Follow-up "What about October?" still mis-parsed exactly as before (personNameQuery=october, delta itself never resolves a date)', octoberDelta !== null && octoberDelta.personNameQuery === 'october' && octoberDelta.horizonPhrase === 'TOMORROW');
  const chennaiDelta = parseFollowUpChange('What about Chennai?', previous);
  check('Follow-up "What about Chennai?" still mis-parsed exactly as before (personNameQuery=chennai)', chennaiDelta !== null && chennaiDelta.personNameQuery === 'chennai');
}

// --- Partial-consumption safety: a date-shaped prefix followed by
// unrelated garbage must not silently produce a truncated/wrong date ---
{
  const r = parseTz('Is Septemberish 20 good for marriage?', FRIDAY_NOW);
  check('"Septemberish" (not a real month name) -> not resolved as a date', r.horizonPhrase !== 'CUSTOM_DATE');
}

// --- Stretch goal: "Friday morning" resolves to CUSTOM_DATE + MORNING
// with FIND semantics (an activity must still be present for this to
// route anywhere at all). ---
{
  const r = parseTz('Workout Friday morning.', FRIDAY_NOW);
  check('"Workout Friday morning." -> TIMING_FIND, CUSTOM_DATE=2026-09-04 (today, Friday), timePreference=MORNING', r.intent === 'TIMING_FIND' && r.horizonPhrase === 'CUSTOM_DATE' && r.customDate === '2026-09-04' && r.timePreference === 'MORNING');
}

// ============================================================
// Ask Aura Richer SHARED Grammar V1: owner+other-person pair grammar
// ("Priya and I" / "I and Priya" / "Priya and me" / "me and Priya"),
// normalized to scope=SHARED, personNameQuery="priya" -- the SAME shape
// the pre-existing "with Priya" form already produces, so every existing
// consumer (SavedPerson resolution, the capability-driven Muhurtham
// redirect) picks these up for free.
// ============================================================

const PAIR_ORDERINGS = [
  'Priya and I',
  'I and Priya',
  'Priya and me',
  'me and Priya',
];

// --- Required matrix (brief section 35): all 4 orderings across exact-time
// CHECK, date-only FIND, and best-date Muhurtham. ---
for (const pair of PAIR_ORDERINGS) {
  const r = parseTz(`Is 10 AM tomorrow good for ${pair} to get married?`, FRIDAY_NOW);
  check(`Exact-time CHECK: "...for ${pair}..." -> TIMING_CHECK, SHARED, priya, exactTime=10:00, marriage`, r.intent === 'TIMING_CHECK' && r.scope === 'SHARED' && r.personNameQuery === 'priya' && r.exactTime === '10:00' && r.activityId === 'marriage');
}
for (const pair of PAIR_ORDERINGS) {
  const r = parseTz(`Is next Friday good for ${pair}?`, FRIDAY_NOW);
  check(`Date-only FIND: "Is next Friday good for ${pair}?" -> TIMING_FIND, SHARED, priya, customDate=2026-09-11`, r.intent === 'TIMING_FIND' && r.scope === 'SHARED' && r.personNameQuery === 'priya' && r.customDate === '2026-09-11');
}
for (const pair of PAIR_ORDERINGS) {
  const r = parseTz(`Best wedding date for ${pair}`, FRIDAY_NOW);
  check(`Best-date Muhurtham: "Best wedding date for ${pair}" -> MUHURTHAM_SEARCH, SHARED, priya, marriage`, r.intent === 'MUHURTHAM_SEARCH' && r.scope === 'SHARED' && r.personNameQuery === 'priya' && r.activityId === 'marriage');
}
for (const pair of PAIR_ORDERINGS) {
  const r = parseTz(`When should ${pair} get married?`, FRIDAY_NOW);
  check(`FIND-verb form: "When should ${pair} get married?" -> TIMING_FIND, SHARED, priya, marriage`, r.intent === 'TIMING_FIND' && r.scope === 'SHARED' && r.personNameQuery === 'priya' && r.activityId === 'marriage');
}

// --- Existing controls must remain unaffected (brief section 14/15/19). ---
{
  const r = parseTz('Find the best wedding date with Priya next month.', FRIDAY_NOW);
  check('"with Priya" control -> SHARED, priya (regression preserved)', r.scope === 'SHARED' && r.personNameQuery === 'priya');
}
// UPDATED by Ask Aura Richer SHARED Grammar V1's fail-closed follow-up:
// "for us"/"together" alone (no resolvable other-person name) now fails
// closed to UNKNOWN/clarification for an executable timing request,
// rather than silently producing scope=SHARED with no way to ever
// personalize it -- see the dedicated fail-closed matrix further below for
// the full required-behavior coverage (this section only re-confirms the
// underlying scope-parsing shape hasn't otherwise changed).
{
  const r = parseTz('Is next Friday good for us?', FRIDAY_NOW);
  check('"for us" (no resolvable partner, timing signal present) -> UNKNOWN, never a silent SHARED-with-no-name execution', r.intent === 'UNKNOWN');
}
{
  const r = parseTz('Is next Friday good together?', FRIDAY_NOW);
  check('"together" (no resolvable partner, timing signal present) -> UNKNOWN, never a silent SHARED-with-no-name execution', r.intent === 'UNKNOWN');
}
{
  const r = parseTz('Is next Friday good for me?', FRIDAY_NOW);
  check('PERSONAL "for me" control -> PERSONAL, never SHARED merely because "me" appears (brief section 13)', r.scope === 'PERSONAL');
}

// --- The critical §17 regression: "for me and X" must never fall into the
// PERSONAL "for me" substring trap. ---
{
  const r = parseTz('Is 10 AM tomorrow good for me and Priya?', FRIDAY_NOW);
  check('"for me and Priya" -> SHARED, priya, NEVER PERSONAL (the exact substring risk the brief warned about)', r.scope === 'SHARED' && r.personNameQuery === 'priya');
}
{
  const r = parseTz('Best wedding date for me and Priya', FRIDAY_NOW);
  check('"best wedding date for me and Priya" -> SHARED, priya, NEVER PERSONAL', r.scope === 'SHARED' && r.personNameQuery === 'priya');
}

// --- "Is next Friday good for Priya?" (bare name, no pair grammar) must
// stay exactly as it was before this PR -- this PR does not change the
// meaning of "for <name>" alone (brief section 12). ---
{
  const before = parseTz('Is next Friday good for Priya?', FRIDAY_NOW);
  check('Bare "for Priya" (no pair grammar) -> UNKNOWN, unchanged from before this PR', before.intent === 'UNKNOWN');
}

// --- Dating collision (brief section 25): pair grammar must not interfere
// with activity alias resolution. ---
{
  const r = parseTz('Is 7 PM next Friday good for Priya and me to go on a date?', FRIDAY_NOW);
  check('"...Priya and me to go on a date?" -> activityId=dating, not marriage, SHARED, priya', r.activityId === 'dating' && r.scope === 'SHARED' && r.personNameQuery === 'priya');
}

// --- Duration composition (brief section 21/general regression): duration
// + exact clock + natural weekday date compose correctly together,
// unaffected by this PR's changes. ---
{
  const r = parseTz('Is 10 AM next Friday good for 2 hours of deep work?', FRIDAY_NOW);
  check('Duration + exact clock + weekday date compose: exactTime=10:00, durationMinutes=120, customDate=2026-09-11, TIMING_CHECK', r.exactTime === '10:00' && r.durationMinutes === 120 && r.customDate === '2026-09-11' && r.intent === 'TIMING_CHECK');
}

// --- Explicit FIND precedence preserved with pair grammar present (brief
// section 22). ---
{
  const r = parseTz('Find the best wedding time September 20 for Priya and me.', FRIDAY_NOW);
  check('Explicit FIND phrasing + pair grammar -> TIMING_FIND, SHARED, priya', r.intent === 'TIMING_FIND' && r.scope === 'SHARED' && r.personNameQuery === 'priya');
}

// --- Multi-word name (brief section 26): a documented, bounded limitation
// -- the single-word bound (matching the existing "with X" convention)
// truncates to the LAST word rather than swallowing an unbounded phrase or
// silently misresolving activity/date text as part of the name. Not a
// general NER system; this is the same tradeoff "with Anna" already makes. ---
{
  const r = parseTz('Is next Friday good for Mary Jane and I?', FRIDAY_NOW);
  check('"Mary Jane and I" -> personNameQuery truncated to "jane" (documented single-word-name limitation, matches existing "with X" convention)', r.personNameQuery === 'jane');
}

// --- Multiple other people (brief section 28): must reject/clarify, never
// silently choose one of the two names. ---
{
  const r = parseTz('When should Priya, Alex and I get married?', FRIDAY_NOW);
  check('"Priya, Alex and I" (3-person list) -> UNKNOWN, never silently resolves either name', r.intent === 'UNKNOWN' && r.personNameQuery === undefined);
}

// --- "our wedding" / "our marriage" with an unresolved partner (brief
// section 14/16): must produce a clarification (UNKNOWN), never silently
// execute as GENERAL, when a genuine timing signal is present. ---
{
  const r = parseTz('Is 10 AM tomorrow good for our wedding?', FRIDAY_NOW);
  check('"our wedding" + exact clock, no resolvable partner -> UNKNOWN, never a silent GENERAL CHECK', r.intent === 'UNKNOWN');
}
{
  const r = parseTz('Is next Friday good for our marriage?', FRIDAY_NOW);
  check('"our marriage" + date, no resolvable partner -> UNKNOWN, never a silent GENERAL FIND', r.intent === 'UNKNOWN');
}
{
  const r = parseTz('Best wedding date for our wedding.', FRIDAY_NOW);
  check('"our wedding" + best-date language, no resolvable partner -> UNKNOWN, never a silent GENERAL Muhurtham search', r.intent === 'UNKNOWN');
}
{
  // "Plan our wedding" has NO timing signal at all -- must remain
  // completely unaffected (brief section 33), still reaching the ordinary
  // bare-activity PLAN_OPEN fallback.
  const r = parseTz('Plan our wedding', FRIDAY_NOW);
  check('"Plan our wedding" (no timing signal) -> PLAN_OPEN, unaffected by the "our wedding" guard', r.intent === 'PLAN_OPEN' && r.activityId === 'marriage');
}
{
  // When a resolvable name IS present alongside "our wedding", the
  // unresolved-partner guard must not fire -- normal SHARED resolution
  // proceeds exactly as it would for "with Priya" alone.
  const r = parseTz('Is 10 AM tomorrow good for our wedding with Priya?', FRIDAY_NOW);
  check('"our wedding with Priya" -> SHARED, priya, NOT the unresolved-partner guard (a name IS present)', r.intent === 'TIMING_CHECK' && r.scope === 'SHARED' && r.personNameQuery === 'priya');
}

// --- Everyday SHARED control (brief section 24): the grammar itself
// resolves scope=SHARED for a NON-ceremonial activity too -- generic, not
// marriage-specific. Whether EXECUTION personalizes for the resolved
// partner is an orchestrator/engine-level question, not a parser one; see
// test/askAuraOrchestratorDb.test.ts and its own documented finding that
// the generic (non-Muhurtham) TIMING_CHECK handler does not currently read
// scope/personNameQuery at all (a pre-existing asymmetry with TIMING_FIND,
// which does) -- this PR does not change that, per its own explicit
// non-goal against new product semantics. ---
{
  const r = parseTz('Is 10 AM tomorrow good for Priya and me to meditate?', FRIDAY_NOW);
  check('Everyday activity + pair grammar -> scope=SHARED, priya (grammar-level resolution, generic across activities)', r.scope === 'SHARED' && r.personNameQuery === 'priya' && r.intent === 'TIMING_CHECK');
}

// --- GENERAL control (brief section 39): plain marriage requests with no
// SHARED signal at all must remain GENERAL, never implicitly SHARED. ---
{
  const r = parseTz('Find the best wedding date next month.', FRIDAY_NOW);
  check('"Find the best wedding date next month." (no SHARED signal) -> GENERAL', r.scope === 'GENERAL');
}

// --- PERSONAL control (brief section 40): "for me" alone must remain
// PERSONAL, never SHARED merely because the grammar now includes "me". ---
{
  const r = parseTz('Find the best wedding date for me next month.', FRIDAY_NOW);
  check('"...for me next month." (no pair grammar) -> PERSONAL, unaffected', r.scope === 'PERSONAL');
}

// --- Follow-up isolation (brief section 30): the new pair-grammar helper
// must not be reachable from parseFollowUpChange -- "What about Priya?"
// remains exactly as unsupported as before (parseScope's own "with X"
// fallback still requires the literal word "with", which the follow-up
// delta parser prepends itself; pair grammar requires "and i/me", which a
// bare name delta never has). ---
{
  const previous = parseTz('Is next Friday good with Priya?', FRIDAY_NOW);
  const delta = parseFollowUpChange('What about Priya?', previous);
  // parseFollowUpChange prepends "with " to the delta before calling
  // parseScope -- "with priya" -- so this SPECIFIC phrase still resolves
  // via the existing "with X" fallback (unrelated to the new pair-grammar
  // helper, which never fires here since there's no "and i/me" in "with
  // priya"). Documented as pre-existing, unaffected follow-up behavior.
  check('Follow-up "What about Priya?" behavior is unchanged by this PR (still governed solely by the pre-existing "with X" fallback, never the new pair-grammar helper)', delta !== null && delta.personNameQuery === 'priya');
}

// --- Event Location isolation (brief section 31): a trailing city name
// must not corrupt person extraction, and this PR must not claim any
// event-location field was set (no such field exists in the contract). ---
{
  const r = parseTz('Is next Friday good for Priya and me in Chennai?', FRIDAY_NOW);
  check('"...Priya and me in Chennai?" -> SHARED, priya (city text does not corrupt the single-word-bounded name extraction)', r.scope === 'SHARED' && r.personNameQuery === 'priya');
  check('No event-location-shaped field exists on the parsed request', !('eventLocation' in r) && !('location' in r));
}

// --- Panchang regression (brief section 32): a nonsensical Panchang+pair
// phrase must preserve whatever it already resolved to, never gain new
// SHARED Panchang semantics. ---
{
  const r = parseTz('What is the Panchang for Priya and me next Friday?', FRIDAY_NOW);
  check('"What is the Panchang for Priya and me next Friday?" resolves exactly as before this PR (PANCHANG_EXPLAIN, unaffected)', r.intent === 'PANCHANG_EXPLAIN');
}

// --- UNKNOWN regression (brief section 34): general relationship questions
// must never become SHARED timing requests, and CHECK_VERB_RE's own bare
// "should i" requirement is deliberately NOT broadened to match "should
// Priya and I" (only the FIND-shaped "when should" form was extended). ---
{
  const r = parseTz('Does Priya like me?', FRIDAY_NOW);
  check('"Does Priya like me?" -> UNKNOWN, never a fabricated SHARED timing request', r.intent === 'UNKNOWN');
}
{
  const r = parseTz('Should Priya and I get married?', FRIDAY_NOW);
  check('"Should Priya and I get married?" (bare "should", no "when") -> UNKNOWN, unaffected -- CHECK_VERB_RE intentionally not broadened', r.intent === 'UNKNOWN');
}

// ============================================================
// Ask Aura Date-Only CHECK Semantics V1: a CHECK-verb phrase ("should I"/
// "can I"/"is it good to"/etc.) combined with a real date/day/range but NO
// exact clock must resolve TIMING_FIND, never a TIMING_CHECK that would
// otherwise have to fabricate an instant (previously the resolved date +
// literal UTC noon -- confirmed to display as 5:30 PM in Asia/Kolkata and
// 8:00 AM in America/New_York for the identical "tomorrow" request, and to
// silently collapse a multi-day range down to only its first day).
// ============================================================

// --- Required matrix: every currently-supported non-NOW horizon form ---
for (const [t, expectedHorizon, expectedCustomDate] of [
  ['Should I meditate tomorrow?', 'TOMORROW', undefined],
  ['Can I meditate tomorrow?', 'TOMORROW', undefined],
  ['Should I meditate today?', 'TODAY', undefined],
  ['Should I meditate next Friday?', 'CUSTOM_DATE', '2026-09-11'],
  ['Can I meditate September 20?', 'CUSTOM_DATE', '2026-09-20'],
  ['Should I meditate this weekend?', 'THIS_WEEKEND', undefined],
  ['Can I meditate next 7 days?', 'NEXT_7_DAYS', undefined],
  ['Should I meditate next month?', 'NEXT_MONTH', undefined],
] as const) {
  const r = parseTz(t, FRIDAY_NOW);
  check(`"${t}" -> TIMING_FIND (was TIMING_CHECK with a fabricated instant), horizonPhrase=${expectedHorizon}`, r.intent === 'TIMING_FIND' && r.horizonPhrase === expectedHorizon && r.customDate === expectedCustomDate && r.exactTime === undefined);
}

// --- timePreference must be preserved, never synthesized into a clock ---
{
  const r = parseTz('Should I meditate tomorrow morning?', FRIDAY_NOW);
  check('"Should I meditate tomorrow morning?" -> TIMING_FIND, timePreference=MORNING, no exactTime fabricated from it', r.intent === 'TIMING_FIND' && r.timePreference === 'MORNING' && r.exactTime === undefined);
}
{
  const r = parseTz('Would Friday evening be good for deep work?', FRIDAY_NOW);
  check('"Would Friday evening be good for deep work?" -> TIMING_FIND, timePreference=EVENING', r.intent === 'TIMING_FIND' && r.activityId === 'deep-work' && r.timePreference === 'EVENING' && r.exactTime === undefined);
}

// --- duration must be preserved ---
{
  const r = parseTz('Should I meditate tomorrow for 90 minutes?', FRIDAY_NOW);
  check('"Should I meditate tomorrow for 90 minutes?" -> TIMING_FIND, durationMinutes=90', r.intent === 'TIMING_FIND' && r.durationMinutes === 90 && r.horizonPhrase === 'TOMORROW');
}

// --- Ordinary "is X good for Y" date-only phrasing was already correct;
// must remain unaffected by this fix (it never matched CHECK_VERB_RE). ---
{
  const r = parseTz('Is tomorrow good for meditation?', FRIDAY_NOW);
  check('"Is tomorrow good for meditation?" (unaffected control) -> TIMING_FIND, unchanged', r.intent === 'TIMING_FIND' && r.horizonPhrase === 'TOMORROW');
}

// --- NOW must remain TIMING_CHECK -- this fix targets non-NOW periods
// only, never NOW itself. ---
for (const t of ['Should I meditate now?', 'Can I meditate now?', 'Is now a good time for meditation?']) {
  const r = parseTz(t, FRIDAY_NOW);
  check(`"${t}" -> TIMING_CHECK, horizonPhrase=NOW, unaffected`, r.intent === 'TIMING_CHECK' && r.horizonPhrase === 'NOW');
}

// --- No-horizon CHECK control: "Should I meditate?" (no date at all)
// defaults to NOW, exactly as before this fix -- this PR is about explicit
// non-NOW temporal periods, not a conversational-semantics redesign. ---
{
  const r = parseTz('Should I meditate?', FRIDAY_NOW);
  check('"Should I meditate?" (no date at all) -> TIMING_CHECK, horizonPhrase=NOW, unchanged', r.intent === 'TIMING_CHECK' && r.horizonPhrase === 'NOW');
}

// --- Exact clock must remain TIMING_CHECK -- never rerouted to FIND. ---
for (const t of ['Should I meditate at 10 AM tomorrow?', 'Is 10 AM tomorrow good for meditation?']) {
  const r = parseTz(t, FRIDAY_NOW);
  check(`"${t}" -> TIMING_CHECK, exactTime=10:00, unaffected`, r.intent === 'TIMING_CHECK' && r.exactTime === '10:00');
}

// --- Invalid exact clock must retain existing fail-closed behavior (PR
// #66) -- never silently discarded and downgraded to a date-only FIND. ---
{
  const r = parseTz('Should I meditate at 25 PM tomorrow?', FRIDAY_NOW);
  check('"Should I meditate at 25 PM tomorrow?" (invalid clock) -> UNKNOWN, never silently becomes FIND', r.intent === 'UNKNOWN' && r.exactTime === undefined);
}

// --- Free-text taskTitle fallback must be preserved: an uncataloged
// activity + CHECK-verb + date must become TIMING_FIND with taskTitle
// preserved, never UNKNOWN (the exact regression risk this PR's own
// implementation brief flagged: step 8's bareActivity is catalog-only, so
// this branch must keep using resolveActivity()'s taskTitle fallback, not
// switch to findActivityIntent()). ---
{
  const r = parseTz('Should I do unicycle rehearsal tomorrow?', FRIDAY_NOW);
  check('Uncataloged free-text activity + "should I" + date -> TIMING_FIND (never UNKNOWN), taskTitle preserved', r.intent === 'TIMING_FIND' && r.activityId === undefined && r.taskTitle === 'should i do unicycle rehearsal tomorrow?' && r.horizonPhrase === 'TOMORROW');
}

// --- PERSONAL date-only: existing scope machinery, now reached via the
// FIND path automatically. ---
{
  const r = parseTz('Is tomorrow good for me to meditate?', FRIDAY_NOW);
  check('PERSONAL date-only control -> TIMING_FIND, PERSONAL, unaffected', r.intent === 'TIMING_FIND' && r.scope === 'PERSONAL');
}

// --- SHARED date-only and exact-clock: PR #68/#69 machinery composes
// automatically through the fixed branch. ---
{
  const r = parseTz('Is tomorrow good for Priya and me to meditate?', FRIDAY_NOW);
  check('SHARED date-only control -> TIMING_FIND, SHARED, priya, unaffected', r.intent === 'TIMING_FIND' && r.scope === 'SHARED' && r.personNameQuery === 'priya');
}
{
  const r = parseTz('Should Priya and me meditate at 10 AM tomorrow?', FRIDAY_NOW);
  check('SHARED exact-clock -> TIMING_CHECK, SHARED, priya, exactTime=10:00 -- never rerouted to FIND', r.intent === 'TIMING_CHECK' && r.scope === 'SHARED' && r.personNameQuery === 'priya' && r.exactTime === '10:00');
}

// --- Ceremonial date-only: the most consequential fix -- must reach
// TIMING_FIND so the orchestrator's existing capability redirect sends it
// to the canonical Muhurtham search, never a fabricated-instant CHECK. ---
for (const t of ['Should I get married tomorrow?', 'Can I get married next Friday?']) {
  const r = parseTz(t, FRIDAY_NOW);
  check(`"${t}" -> TIMING_FIND, marriage, no exactTime (was a fabricated-instant CHECK)`, r.intent === 'TIMING_FIND' && r.activityId === 'marriage' && r.exactTime === undefined);
}

// --- Ceremonial exact clock must remain TIMING_CHECK, unaffected. ---
{
  const r = parseTz('Should I get married at 10 AM next Friday?', FRIDAY_NOW);
  check('"Should I get married at 10 AM next Friday?" -> TIMING_CHECK, marriage, exactTime=10:00, unaffected', r.intent === 'TIMING_CHECK' && r.activityId === 'marriage' && r.exactTime === '10:00');
}

// --- Existing ceremonial FIND control (never matched CHECK_VERB_RE) must
// stay unaffected. ---
{
  const r = parseTz('Is next Friday good for marriage?', FRIDAY_NOW);
  check('"Is next Friday good for marriage?" (unaffected control) -> TIMING_FIND, marriage', r.intent === 'TIMING_FIND' && r.activityId === 'marriage');
}

// --- Regressions: Panchang query/explain, PLAN_OPEN, explicit FIND must
// all remain completely unaffected by this narrowly-scoped fix. ---
check('"What\'s Rahu Kalam tomorrow?" stays PANCHANG_QUERY, unaffected', parseTz("What's Rahu Kalam tomorrow?", FRIDAY_NOW).intent === 'PANCHANG_QUERY');
{
  const r = parseTz('Plan my meditation tomorrow', FRIDAY_NOW);
  check('"Plan my meditation tomorrow" resolves exactly as before this fix (no CHECK_VERB_RE match, unaffected)', r.intent === 'TIMING_FIND' && r.activityId === 'meditation');
}
for (const t of ['Find a good time tomorrow for meditation.', 'When should I meditate tomorrow?', 'Best time tomorrow for meditation.']) {
  const r = parseTz(t, FRIDAY_NOW);
  check(`"${t}" (explicit FIND, unaffected) -> TIMING_FIND`, r.intent === 'TIMING_FIND');
}

// ============================================================
// Ask Aura Event Location V1: extractLocationQuery() -- pure text
// extraction, no resolution. This file never imports apps/web/lib/cities;
// case-insensitivity and CITY_OPTIONS lookup are proven separately in
// askAuraOrchestrator.test.ts against the actual resolver.
// ============================================================

// --- Basic single- and multi-word extraction (brief section 39). ---
for (const [t, expected] of [
  ['in Chennai', 'chennai'],
  ['IN CHENNAI', 'chennai'],
  ['in chennai', 'chennai'],
  ['in New Delhi', 'new delhi'],
  ['in New York', 'new york'],
  ['in San Francisco', 'san francisco'],
] as const) {
  check(`extractLocationQuery("${t}") === "${expected}"`, extractLocationQuery(t) === expected);
}

// --- Boundaries (brief section 8): must stop before existing temporal/
// scope grammar, punctuation, or end of input -- never swallow it. ---
for (const [t, expected] of [
  ['in Chennai next Friday', 'chennai'],
  ['in New Delhi tomorrow', 'new delhi'],
  ['in Chennai at 10 AM', 'chennai'],
  ['in Chennai for me', 'chennai'],
  ['in Chennai with Priya', 'chennai'],
  ['in Chennai.', 'chennai'],
  ['in Chennai?', 'chennai'],
  ['in Chennai, next week', 'chennai'],
] as const) {
  check(`extractLocationQuery("${t}") stops correctly -> "${expected}"`, extractLocationQuery(t) === expected);
}

// --- No "in X" phrase -> undefined. "within" must not false-positive --
// \bin\b requires a real word boundary, "within"'s "in" is not preceded by
// one. ---
check('extractLocationQuery("Should I get married next Friday?") === undefined (no location phrase)', extractLocationQuery('Should I get married next Friday?') === undefined);
check('extractLocationQuery("within Chennai") === undefined (word-boundary check, not a false "in" match)', extractLocationQuery('within Chennai') === undefined);

// --- End-to-end parser matrix (brief section 9/40/42/43): locationQuery
// threaded through the same intents PR #66/#67/#70 already established,
// reusing the FRIDAY_NOW/TZ fixtures above. ---
{
  const r = parseTz('Should I get married in Chennai next Friday?', FRIDAY_NOW);
  check('"Should I get married in Chennai next Friday?" -> TIMING_FIND, marriage, locationQuery=chennai, date-only (never CHECK)', r.intent === 'TIMING_FIND' && r.activityId === 'marriage' && r.locationQuery === 'chennai' && r.horizonPhrase === 'CUSTOM_DATE');
}
{
  const r = parseTz('Is 10 AM next Friday good for marriage in Chennai?', FRIDAY_NOW);
  check('"Is 10 AM next Friday good for marriage in Chennai?" -> TIMING_CHECK, exactTime=10:00, locationQuery=chennai', r.intent === 'TIMING_CHECK' && r.activityId === 'marriage' && r.exactTime === '10:00' && r.locationQuery === 'chennai');
}
{
  const r = parseTz('Find a marriage Muhurtham in Chennai next Friday.', FRIDAY_NOW);
  check('"Find a marriage Muhurtham in Chennai next Friday." -> MUHURTHAM_SEARCH, locationQuery=chennai', r.intent === 'MUHURTHAM_SEARCH' && r.activityId === 'marriage' && r.locationQuery === 'chennai');
}
{
  const r = parseTz('Can Priya and I get married in Chennai next Friday?', FRIDAY_NOW);
  check('"Can Priya and I get married in Chennai next Friday?" -> TIMING_FIND, SHARED, priya, locationQuery=chennai', r.intent === 'TIMING_FIND' && r.scope === 'SHARED' && r.personNameQuery === 'priya' && r.locationQuery === 'chennai');
}
{
  const r = parseTz('Can Priya and I get married at 10 AM next Friday in Chennai?', FRIDAY_NOW);
  check('"...at 10 AM next Friday in Chennai?" -> TIMING_CHECK, SHARED, priya, exactTime=10:00, locationQuery=chennai', r.intent === 'TIMING_CHECK' && r.scope === 'SHARED' && r.personNameQuery === 'priya' && r.exactTime === '10:00' && r.locationQuery === 'chennai');
}

// --- Unknown location text is still EXTRACTED at the parser level -- this
// file stays I/O-free and never resolves it; fail-closed clarification is
// an orchestrator-level concern (see askAuraOrchestrator.test.ts). ---
{
  const r = parseTz('Should I get married in Atlantis next Friday?', FRIDAY_NOW);
  check('"...in Atlantis..." -> locationQuery="atlantis" extracted regardless of resolvability', r.intent === 'TIMING_FIND' && r.locationQuery === 'atlantis');
}

// --- Everyday non-goal (brief section 47): the parser extracts
// locationQuery for ANY activity -- it is the ORCHESTRATOR's job (never
// the parser's) to ignore it for a non-Muhurtham-eligible activity. ---
{
  const r = parseTz('Should I meditate in Chennai tomorrow?', FRIDAY_NOW);
  check('"Should I meditate in Chennai tomorrow?" -> TIMING_FIND, meditation, locationQuery still extracted here (orchestrator ignores it for non-ceremonial activities)', r.intent === 'TIMING_FIND' && r.activityId === 'meditation' && r.locationQuery === 'chennai');
}

// --- Omitted-location control (brief section 25/46): completely
// unaffected by this PR. ---
{
  const r = parseTz('Should I get married next Friday?', FRIDAY_NOW);
  check('"Should I get married next Friday?" (no location phrase) -> locationQuery undefined, unaffected', r.intent === 'TIMING_FIND' && r.locationQuery === undefined);
}

// --- Timezone-boundary proof (brief section 40): once an Event Location's
// timezone is threaded into AskAuraParseContext.timezone -- exactly as
// route.ts does pre-parse (brief section 10/17) -- it changes which
// calendar date is resolved, independent of the caller's own Timing
// Location timezone. NOW is chosen so Asia/Kolkata's local date is already
// September 5 while America/New_York's is still September 4; "September 4"
// (no year) then resolves against EACH timezone's own local "today" via
// resolveImplicitYear's same-day-vs-already-passed policy. ---
{
  const BOUNDARY_NOW = new Date('2026-09-04T20:00:00.000Z');
  const kolkata = parseAskAuraRequest('Is September 4 good for marriage?', { now: BOUNDARY_NOW, timezone: 'Asia/Kolkata' });
  const newYork = parseAskAuraRequest('Is September 4 good for marriage?', { now: BOUNDARY_NOW, timezone: 'America/New_York' });
  check('Asia/Kolkata local "today" is already Sept 5 -> "September 4" (already passed) rolls forward to next year', kolkata.customDate === '2027-09-04');
  check('America/New_York local "today" is still Sept 4 -> "September 4" resolves to THIS year (same-day policy)', newYork.customDate === '2026-09-04');
  check('Same real-world instant, different Event Location timezone -> genuinely different resolved date', kolkata.customDate !== newYork.customDate);
}

// ============================================================
// FIX: Ceremonial-Only Pre-Parse Timezone Gate. The Event Location's
// timezone must feed AskAuraParseContext.timezone ONLY when the raw
// prompt targets a Muhurtham-eligible (ceremonial) activity -- an
// everyday activity's temporal grammar ("tomorrow"/"next Friday") must
// ALWAYS resolve against the caller's own Timing Location timezone,
// regardless of whether an "in X" phrase is present and regardless of
// whether it resolves, since the everyday engines always execute against
// the caller's own Timing Location. Before this fix, route.ts chose
// `resolvedEventLocation?.timezone ?? user.timezone` UNCONDITIONALLY --
// producing an invalid mixed state (date interpreted in Chennai, but
// executed against the user's own Timing Location coordinates).
//
// route.ts is a Next.js API route handler (NextRequest/session/DB) and
// isn't independently importable in this DB-free harness, so this mirrors
// its exact decision function using the SAME exported, pure, timezone-
// independent primitives route.ts itself composes: extractLocationQuery
// (this file), resolveEventLocationQuery (askAuraOrchestrator.ts),
// findActivityIntent (personalizedTasks.ts), isSupportedMuhurthamActivity
// (muhurthamFinder.ts) -- the exact same pair buildMuhurthamSearchIfEligible
// already composes internally via resolveActivity(), reused here verbatim
// rather than a new/duplicated capability list. Keep this mirror in sync
// with route.ts's own gate if that logic ever changes.
// ============================================================

function resolveParseTimezoneForTest(prompt: string, userTimezone: string): string {
  const locationQuery = extractLocationQuery(prompt);
  const eventLocation = locationQuery ? resolveEventLocationQuery(locationQuery) : undefined;
  const promptActivity = findActivityIntent(prompt);
  const isCeremonial = Boolean(promptActivity && isSupportedMuhurthamActivity(promptActivity.id));
  const useEventTimezone = Boolean(eventLocation) && isCeremonial;
  return useEventTimezone ? eventLocation!.timezone : userTimezone;
}

const GATE_USER_TZ = 'America/New_York';

// --- The gate itself (brief section 2/9/10/17): ceremonial prompts select
// the Event Location's timezone; everyday prompts NEVER do, regardless of
// whether the location resolves. ---
check('Ceremonial (marriage) + resolvable Chennai -> gate selects Chennai\'s timezone', resolveParseTimezoneForTest('Should I get married in Chennai next Friday?', GATE_USER_TZ) === 'Asia/Kolkata');
check('Everyday (meditation) + resolvable Chennai + "tomorrow" -> gate selects the USER\'s own timezone, never Chennai', resolveParseTimezoneForTest('Should I meditate in Chennai tomorrow?', GATE_USER_TZ) === GATE_USER_TZ);
check('Everyday (meditation) + resolvable Chennai + weekday phrasing -> still the USER\'s own timezone', resolveParseTimezoneForTest('Should I meditate in Chennai next Friday?', GATE_USER_TZ) === GATE_USER_TZ);
check('Everyday (meditation) + resolvable Chennai + exact clock -> still the USER\'s own timezone', resolveParseTimezoneForTest('Is 10 AM next Friday good for meditation in Chennai?', GATE_USER_TZ) === GATE_USER_TZ);
check('Ceremonial (marriage) + UNRESOLVED city -> falls back to the USER\'s own timezone (no mixed state; the fail-closed clarification is a separate, orchestrator-level concern)', resolveParseTimezoneForTest('Should I get married in Atlantis next Friday?', GATE_USER_TZ) === GATE_USER_TZ);
check('Everyday (meditation) + UNRESOLVED city ("Atlantis") -> USER\'s own timezone, zero effect either way (brief section 10)', resolveParseTimezoneForTest('Should I meditate in Atlantis tomorrow?', GATE_USER_TZ) === GATE_USER_TZ);
check('Ceremonial, no location phrase at all -> USER\'s own timezone, unaffected (brief section 3/D)', resolveParseTimezoneForTest('Should I get married next Friday?', GATE_USER_TZ) === GATE_USER_TZ);

// --- "Tomorrow" itself carries no parser-level customDate (parseHorizonPhrase
// is pure regex, never consults timezone) -- so the gate's choice has NO
// observable effect on a bare TOMORROW/TODAY/weekend/month phrase either
// way; the actual date range for those is computed downstream in the
// orchestrator via resolveHorizonToDateRange(..., deps.context), and
// deps.context is ALWAYS built from the user's own Timing Location in
// route.ts, never overridden for an everyday activity. The gate's fix is
// only numerically OBSERVABLE for weekday/absolute-date forms ("next
// Friday", "September 4"), proven below. ---
check('"tomorrow" parses identically regardless of which timezone the gate chose (no customDate to diverge)', parseAskAuraRequest('Should I meditate in Chennai tomorrow?', { now: NOW, timezone: 'Asia/Kolkata' }).horizonPhrase === parseAskAuraRequest('Should I meditate in Chennai tomorrow?', { now: NOW, timezone: GATE_USER_TZ }).horizonPhrase);

// --- Weekday-boundary proof (brief section 11/12): a genuine customDate
// divergence. NOW is chosen so America/New_York's local date is Saturday
// Sept 5 while Asia/Kolkata's is already Sunday Sept 6 -- crossing a
// SATURDAY->SUNDAY boundary specifically (not just any day boundary)
// because "next Friday"'s own (7 - localWeekday) + 5 offset formula
// otherwise cancels out a plain one-day date/weekday shift (advancing the
// local date by 1 also advances the local weekday by 1, leaving the
// computed offset, and therefore the final date, unchanged) -- confirmed
// empirically before writing this fixture. Crossing INTO Sunday (weekday
// wraps 6->0) breaks that cancellation, landing the two timezones on
// Fridays a full week apart. This test would have FAILED before this fix,
// since the old code used Chennai's timezone unconditionally whenever "in
// Chennai" resolved, regardless of activity. ---
{
  const BOUNDARY_NOW = new Date('2026-09-06T03:00:00.000Z');
  const ceremonialText = 'Should I get married in Chennai next Friday?';
  const everydayText = 'Should I meditate in Chennai next Friday?';
  const ceremonialTz = resolveParseTimezoneForTest(ceremonialText, GATE_USER_TZ);
  const everydayTz = resolveParseTimezoneForTest(everydayText, GATE_USER_TZ);
  check('Ceremonial "next Friday" gate resolves to Chennai (Asia/Kolkata)', ceremonialTz === 'Asia/Kolkata');
  check('Everyday "next Friday" gate resolves to the user\'s own America/New_York, never Chennai', everydayTz === GATE_USER_TZ);
  const ceremonialParsed = parseAskAuraRequest(ceremonialText, { now: BOUNDARY_NOW, timezone: ceremonialTz });
  const everydayParsed = parseAskAuraRequest(everydayText, { now: BOUNDARY_NOW, timezone: everydayTz });
  check('The two resolved customDates genuinely differ for the identical real-world instant and identical "next Friday" phrase', ceremonialParsed.customDate !== everydayParsed.customDate);
}

// --- Exact-clock boundary proof (brief section 14): same mechanism, an
// exact-clock CHECK-shaped phrase, reusing the same Saturday->Sunday
// boundary instant established above (a plain one-day shift would
// coincidentally cancel out in "next Friday"'s own offset formula). ---
{
  const BOUNDARY_NOW = new Date('2026-09-06T03:00:00.000Z');
  const ceremonialText = 'Is 10 AM next Friday good for marriage in Chennai?';
  const everydayText = 'Is 10 AM next Friday good for meditation in Chennai?';
  const ceremonialTz = resolveParseTimezoneForTest(ceremonialText, GATE_USER_TZ);
  const everydayTz = resolveParseTimezoneForTest(everydayText, GATE_USER_TZ);
  const ceremonialParsed = parseAskAuraRequest(ceremonialText, { now: BOUNDARY_NOW, timezone: ceremonialTz });
  const everydayParsed = parseAskAuraRequest(everydayText, { now: BOUNDARY_NOW, timezone: everydayTz });
  check('Ceremonial exact-clock "next Friday in Chennai" -> gate=Asia/Kolkata, exactTime=10:00', ceremonialTz === 'Asia/Kolkata' && ceremonialParsed.exactTime === '10:00');
  check('Everyday exact-clock "next Friday in Chennai" -> gate=America/New_York, exactTime=10:00 (no mixed semantics)', everydayTz === GATE_USER_TZ && everydayParsed.exactTime === '10:00');
  check('The resolved customDates genuinely differ for the identical exact-clock phrasing', ceremonialParsed.customDate !== everydayParsed.customDate);
}

// --- Implicit-year absolute-date proof (brief section 13), reusing the
// SAME boundary fixture already established above. ---
{
  const BOUNDARY_NOW = new Date('2026-09-04T20:00:00.000Z');
  const ceremonialText = 'Is September 4 good for marriage in Chennai?';
  const everydayText = 'Is September 4 good for meditation in Chennai?';
  const ceremonialTz = resolveParseTimezoneForTest(ceremonialText, GATE_USER_TZ);
  const everydayTz = resolveParseTimezoneForTest(everydayText, GATE_USER_TZ);
  const ceremonialParsed = parseAskAuraRequest(ceremonialText, { now: BOUNDARY_NOW, timezone: ceremonialTz });
  const everydayParsed = parseAskAuraRequest(everydayText, { now: BOUNDARY_NOW, timezone: everydayTz });
  check('Ceremonial: Chennai\'s local "today" is already Sept 5 -> "September 4" (already passed) rolls forward to next year', ceremonialParsed.customDate === '2027-09-04');
  check('Everyday: the user\'s own (New York) local "today" is still Sept 4 -> "September 4" resolves to THIS year (same-day policy), never Chennai\'s rolled-forward date', everydayParsed.customDate === '2026-09-04');
}

if (!allPassed) {
  console.error('\nSome Ask Aura intent parser checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL ASK AURA INTENT PARSER CHECKS PASSED');
}
