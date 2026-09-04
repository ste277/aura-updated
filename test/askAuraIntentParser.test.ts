import { parseAskAuraRequest, parseFollowUpChange, ParsedAskAuraRequest } from '../packages/recommendation/src/askAuraIntent';
import { isSupportedMuhurthamActivity } from '../packages/recommendation/src/muhurthamFinder';

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
{
  const r = parse('Good dates for Griha Pravesh for us next month');
  check('"...for us..." -> scope SHARED', r.scope === 'SHARED');
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

if (!allPassed) {
  console.error('\nSome Ask Aura intent parser checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL ASK AURA INTENT PARSER CHECKS PASSED');
}
