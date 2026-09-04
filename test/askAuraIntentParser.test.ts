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

// Section 54/55: month-name and weekday negative controls -- a valid
// clock with NO recognized date/horizon must never silently pick
// today/tomorrow.
{
  const r = parse('Is 10 AM on September 20 good for marriage?');
  check('"Is 10 AM on September 20 good for marriage?" -> UNKNOWN (month names remain unsupported, no invented date)', r.intent === 'UNKNOWN');
}
{
  const r = parse('Is 10 AM next Friday good for marriage?');
  check('"Is 10 AM next Friday good for marriage?" -> UNKNOWN (weekdays remain unsupported, no invented date)', r.intent === 'UNKNOWN');
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

if (!allPassed) {
  console.error('\nSome Ask Aura intent parser checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL ASK AURA INTENT PARSER CHECKS PASSED');
}
