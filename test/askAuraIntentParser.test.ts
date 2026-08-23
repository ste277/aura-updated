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

if (!allPassed) {
  console.error('\nSome Ask Aura intent parser checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL ASK AURA INTENT PARSER CHECKS PASSED');
}
