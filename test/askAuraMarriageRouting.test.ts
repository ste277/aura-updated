/**
 * Ask Aura Marriage Muhurtham Routing V1: regression suite for the three
 * production changes this PR makes --
 *
 * 1. packages/recommendation/src/personalizedTasks.ts: `marriage.aliases`
 *    populated (was deliberately `[]` while Marriage Muhurtham was
 *    incomplete -- see Marriage Muhurtham Foundation V1's own comment,
 *    since updated in test/marriageMuhurthamFoundation.test.ts section 28).
 * 2. packages/recommendation/src/askAuraIntent.ts: a narrow precedence
 *    guard so a resolved, Muhurtham-eligible activity + genuine muhurtham/
 *    auspicious-date search language beats a bare PANCHANG_QUERY_RE match;
 *    MUHURTHAM_SEARCH now carries `durationMinutes` through (it previously
 *    silently dropped an explicitly parsed duration); and a bounded
 *    widening of MUHURTHAM_SEARCH_RE's "auspicious ... date/time/day"
 *    pattern so an activity name between the two words ("an auspicious
 *    WEDDING date") still matches.
 * 3. apps/web/lib/askAuraOrchestrator.ts: a CAPABILITY-DRIVEN redirect --
 *    any TIMING_FIND whose resolved activityId is
 *    isSupportedMuhurthamActivity(...) executes through the canonical
 *    Muhurtham path (handleMuhurthamSearch) instead of runTimingSearch.
 *    Deliberately NOT `activityId === 'marriage'` -- this is exercised
 *    below for business-start, griha-pravesh, start-journey, financial-
 *    decision, and property-purchase too, to prove it's generic.
 *
 * No engine file (muhurthamFinder.ts, muhurtaRulePacks.ts, dailyAssistant.ts
 * scoring, timingSearch.ts scoring) is touched by this PR; every check here
 * exercises real, unmocked engine calls.
 */
import { parseAskAuraRequest, parseFollowUpChange } from '../packages/recommendation/src/askAuraIntent';
import { orchestrateAskAura, AskAuraOrchestratorDeps } from '../apps/web/lib/askAuraOrchestrator';
import { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { isSupportedMuhurthamActivity } from '../packages/recommendation/src/muhurthamFinder';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const NOW = new Date('2026-08-23T10:00:00.000Z');
const context: DailyAssistantContext = { now: NOW, latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata', tzOffsetMinutes: 330 };
const deps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context, activeWindow: 'NEUTRAL' };

function parse(text: string) {
  return parseAskAuraRequest(text, { now: NOW });
}

async function main() {
  // ============================================================
  // Section 7/9: Marriage activity resolution -- direct.
  // ============================================================
  for (const t of ['marriage', 'wedding', 'wedding ceremony', 'get married', 'getting married', 'marry', 'married', 'marriage ceremony']) {
    check(`findActivityIntent("${t}") resolves to marriage`, findActivityIntent(t)?.id === 'marriage');
  }

  // ============================================================
  // Section 8/30: "date" collision matrix -- must all resolve marriage,
  // never dating.
  // ============================================================
  for (const t of ['best marriage date', 'marriage dates', 'good dates for marriage', 'date for my wedding', 'wedding date', 'best date to get married']) {
    check(`findActivityIntent("${t}") resolves marriage, not dating`, findActivityIntent(t)?.id === 'marriage');
  }

  // ============================================================
  // Section 6/31: dating must remain unaffected.
  // ============================================================
  check('findActivityIntent("plan a date tonight") still resolves date-night', findActivityIntent('plan a date tonight')?.id === 'date-night');
  check('findActivityIntent("best time for a date") still resolves dating', findActivityIntent('best time for a date')?.id === 'dating');
  check('findActivityIntent("date night with priya") still resolves date-night', findActivityIntent('date night with priya')?.id === 'date-night');
  check('findActivityIntent("romantic dinner with priya") still resolves dating', findActivityIntent('romantic dinner with priya')?.id === 'dating');

  // ============================================================
  // Section 29: required parser matrix.
  // ============================================================
  {
    const p = parse('When should I get married?');
    check('"When should I get married?" -> activityId=marriage', p.activityId === 'marriage');
    check('"When should I get married?" -> TIMING_FIND (parser label; execution redirect verified separately below)', p.intent === 'TIMING_FIND');
  }
  {
    const p = parse('Find a wedding muhurtham.');
    check('"Find a wedding muhurtham." -> MUHURTHAM_SEARCH, marriage', p.intent === 'MUHURTHAM_SEARCH' && p.activityId === 'marriage');
  }
  {
    // Fully fixed by the Ask Aura Bare Ceremonial "Best Date" Routing
    // follow-up -- previously activityId resolved correctly (marriage,
    // not dating) but the intent fell through to PLAN_OPEN (bare
    // <=4-word activity phrase, no timing signal). Now resolves directly
    // to MUHURTHAM_SEARCH via the new capability-gated guard.
    const p = parse('Best marriage date.');
    check('"Best marriage date." -> MUHURTHAM_SEARCH, activityId=marriage, NOT dating, NOT PLAN_OPEN', p.intent === 'MUHURTHAM_SEARCH' && p.activityId === 'marriage');
  }
  {
    const p = parse('Good dates for my wedding.');
    check('"Good dates for my wedding." -> MUHURTHAM_SEARCH, marriage', p.intent === 'MUHURTHAM_SEARCH' && p.activityId === 'marriage');
  }
  {
    const p = parse('When is a good muhurtham for my wedding?');
    check('"When is a good muhurtham for my wedding?" -> MUHURTHAM_SEARCH, marriage, NOT PANCHANG_QUERY', p.intent === 'MUHURTHAM_SEARCH' && p.activityId === 'marriage');
  }
  {
    const p = parse('Find an auspicious wedding date.');
    check('"Find an auspicious wedding date." -> MUHURTHAM_SEARCH, marriage', p.intent === 'MUHURTHAM_SEARCH' && p.activityId === 'marriage');
  }
  {
    const p = parse('Best time to get married next month.');
    check('"Best time to get married next month." -> marriage, NEXT_MONTH', p.activityId === 'marriage' && p.horizonPhrase === 'NEXT_MONTH');
  }
  {
    const p = parse('Find a 90 minute marriage muhurtham next month.');
    check('"Find a 90 minute marriage muhurtham next month." -> marriage, duration=90, NEXT_MONTH', p.intent === 'MUHURTHAM_SEARCH' && p.activityId === 'marriage' && p.durationMinutes === 90 && p.horizonPhrase === 'NEXT_MONTH');
  }

  // ============================================================
  // Section 32: Panchang regression -- generic window/informational
  // queries must remain informational, never hijacked by the new
  // precedence guard (which requires BOTH a genuine search-language match
  // AND a resolved eligible activity).
  // ============================================================
  check('"when is Rahu Kalam" stays PANCHANG_QUERY', parse('when is Rahu Kalam').intent === 'PANCHANG_QUERY');
  check('"what is Rahu Kalam" stays PANCHANG_EXPLAIN', parse('what is Rahu Kalam').intent === 'PANCHANG_EXPLAIN');
  check('"what is marriage muhurtham" stays PANCHANG_EXPLAIN (informational, not a search)', parse('what is marriage muhurtham').intent === 'PANCHANG_EXPLAIN');
  check('"what does a wedding muhurtham mean" stays PANCHANG_EXPLAIN', parse('what does a wedding muhurtham mean').intent === 'PANCHANG_EXPLAIN');
  check('"what does Panchang say about marriage" stays PANCHANG_EXPLAIN', parse('what does Panchang say about marriage').intent === 'PANCHANG_EXPLAIN');

  // ============================================================
  // Section 28: informational/planning false positives -- must not
  // execute a Muhurtham search.
  // ============================================================
  for (const t of ['Why is marriage timing important?', 'What is a good wedding?', 'Help me plan my wedding.', 'Add wedding planning to my day.', 'Remind me about the wedding.', 'I attended a wedding yesterday.']) {
    const p = parse(t);
    check(`"${t}" does not become MUHURTHAM_SEARCH`, p.intent !== 'MUHURTHAM_SEARCH');
  }

  // ============================================================
  // Section 25: ordinary timing controls -- must stay plain TIMING_FIND
  // in EXECUTION (not redirected), since their activity is not Muhurtham-
  // eligible.
  // ============================================================
  for (const t of ['Best time for deep work.', 'Best time to work out.', 'When should I study?']) {
    const p = parse(t);
    check(`"${t}" activity is not Muhurtham-eligible`, Boolean(p.activityId) && !isSupportedMuhurthamActivity(p.activityId!));
    const response = await orchestrateAskAura(p, deps);
    check(`"${t}" executes as TIMING_FIND (not redirected to MUHURTHAM_SEARCH)`, response.intent === 'TIMING_FIND');
  }

  // ============================================================
  // Section 12/21: GENERAL execution through canonical Muhurtham for an
  // explicit MUHURTHAM_SEARCH request. Zero-result semantics preserved:
  // a genuine empty search result is MUHURTHAM_SEARCH with the canonical
  // "couldn't find a strong Muhurtham" message, never UNKNOWN.
  // ============================================================
  {
    const p = parse('Find a wedding muhurtham.');
    const response = await orchestrateAskAura(p, deps);
    check('GENERAL "Find a wedding muhurtham." executes MUHURTHAM_SEARCH', response.intent === 'MUHURTHAM_SEARCH');
    check('Zero-result message is the canonical Muhurtham zero-result message, not an UNKNOWN/parser-failure message', typeof response.message === 'string' && response.message.includes("couldn't find a strong Muhurtham"));
  }

  // ============================================================
  // Section 9-12: TIMING_FIND capability redirect -- the parser may label
  // this TIMING_FIND, but EXECUTION must go through canonical Muhurtham.
  // ============================================================
  for (const t of ['When should I get married?', 'Best time to get married next month.']) {
    const p = parse(t);
    check(`"${t}" parses as TIMING_FIND`, p.intent === 'TIMING_FIND');
    const response = await orchestrateAskAura(p, deps);
    check(`"${t}" EXECUTES through canonical Muhurtham (response.intent === MUHURTHAM_SEARCH)`, response.intent === 'MUHURTHAM_SEARCH');
  }

  // ============================================================
  // Section 24: business-start capability redirect -- proves the redirect
  // is capability-driven, not `activityId === 'marriage'`.
  // ============================================================
  {
    const p = parse('Best time to start my business.');
    check('"Best time to start my business." parses as TIMING_FIND, activityId=business-start', p.intent === 'TIMING_FIND' && p.activityId === 'business-start');
    const response = await orchestrateAskAura(p, deps);
    check('"Best time to start my business." EXECUTES through canonical Muhurtham (proves generic capability-driven redirect, not marriage-specific)', response.intent === 'MUHURTHAM_SEARCH');
  }

  // ============================================================
  // Section 26: griha-pravesh control -- must remain unchanged (already
  // reached MUHURTHAM_SEARCH directly before this PR).
  // ============================================================
  {
    const p = parse('Find a griha pravesh muhurtham.');
    check('"Find a griha pravesh muhurtham." still parses MUHURTHAM_SEARCH directly', p.intent === 'MUHURTHAM_SEARCH' && p.activityId === 'griha-pravesh');
    const response = await orchestrateAskAura(p, deps);
    check('"Find a griha pravesh muhurtham." still executes MUHURTHAM_SEARCH', response.intent === 'MUHURTHAM_SEARCH');
  }

  // ============================================================
  // Section 27: other Muhurtham-eligible activities -- TIMING_FIND-shaped
  // prompts also redirect.
  // ============================================================
  for (const [text, activityId] of [
    ['Best time to start a journey.', 'start-journey'],
    ['When should I make a financial decision?', 'financial-decision'],
    ['Best time for property purchase.', 'property-purchase'],
  ] as const) {
    const p = parse(text);
    check(`"${text}" parses TIMING_FIND, activityId=${activityId}`, p.intent === 'TIMING_FIND' && p.activityId === activityId);
    const response = await orchestrateAskAura(p, deps);
    check(`"${text}" executes through canonical Muhurtham`, response.intent === 'MUHURTHAM_SEARCH');
  }

  // ============================================================
  // Section 13: duration threads through the canonical Muhurtham path
  // end-to-end (a real engine call, using a known-good real fixture date
  // from the Friction-Boundary/Solar-Score-Boundary PRs: 2026-06-01 New
  // York, which returns a genuine Marriage candidate). Default (no stated
  // duration) uses the canonical 60-minute default; an explicit duration
  // is preserved and actually changes the returned window's width.
  // ============================================================
  {
    const nyNow = new Date('2026-05-01T04:00:00.000Z');
    const nyContext: DailyAssistantContext = { now: nyNow, latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', tzOffsetMinutes: -300 };
    const nyDeps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context: nyContext, activeWindow: 'NEUTRAL' };

    async function firstDateEntry(text: string) {
      const p = parseAskAuraRequest(text, { now: nyNow });
      const response = await orchestrateAskAura(p, nyDeps);
      const dates = (response.cards?.[0] as { dates?: { date: string; startLabel: string; endLabel: string }[] } | undefined)?.dates;
      return { parsedDuration: p.durationMinutes, first: dates?.[0] };
    }

    const noDuration = await firstDateEntry('Find a wedding muhurtham.');
    const ninety = await firstDateEntry('Find a 90 minute wedding muhurtham.');
    const thirty = await firstDateEntry('Find a wedding muhurtham for 30 minutes.');

    check('No explicit duration: parsed.durationMinutes is undefined', noDuration.parsedDuration === undefined);
    check('No explicit duration: canonical Muhurtham default (60 min) window returned', Boolean(noDuration.first) && noDuration.first!.startLabel === '12:53 PM' && noDuration.first!.endLabel === '1:53 PM');
    check('"90 minute" explicit duration: parsed as 90', ninety.parsedDuration === 90);
    check('"90 minute" explicit duration: returned window is exactly 90 minutes (12:53 PM - 2:23 PM), not the 60-min default', Boolean(ninety.first) && ninety.first!.startLabel === '12:53 PM' && ninety.first!.endLabel === '2:23 PM');
    check('"for 30 minutes" explicit duration: parsed as 30', thirty.parsedDuration === 30);
    check('"for 30 minutes" explicit duration: returned window is exactly 30 minutes (12:53 PM - 1:23 PM)', Boolean(thirty.first) && thirty.first!.startLabel === '12:53 PM' && thirty.first!.endLabel === '1:23 PM');
  }

  // ============================================================
  // Section 23: SHARED with existing supported "with <name>" phrasing --
  // parser-level only here (SavedPerson resolution needs a live DB; see
  // test/askAuraOrchestratorDb.test.ts's own pattern for that layer, which
  // this PR does not modify).
  // ============================================================
  {
    const p = parse('Find a wedding muhurtham with Priya.');
    check('"Find a wedding muhurtham with Priya." -> MUHURTHAM_SEARCH, marriage, SHARED, personNameQuery=priya', p.intent === 'MUHURTHAM_SEARCH' && p.activityId === 'marriage' && p.scope === 'SHARED' && p.personNameQuery === 'priya');
  }
  {
    const p = parse('Wedding muhurtham for us.');
    check('"Wedding muhurtham for us." -> MUHURTHAM_SEARCH, marriage, SHARED', p.intent === 'MUHURTHAM_SEARCH' && p.activityId === 'marriage' && p.scope === 'SHARED');
  }

  // ============================================================
  // Section 19: follow-up context -- a supported horizon/time-preference
  // delta preserves activityId=marriage and the MUHURTHAM_SEARCH intent;
  // month-name/location deltas remain unsupported (section 33/37/38, not
  // touched by this PR).
  // ============================================================
  {
    const turn1 = parse('Find a wedding muhurtham.');
    check('Turn 1 "Find a wedding muhurtham." -> MUHURTHAM_SEARCH, marriage', turn1.intent === 'MUHURTHAM_SEARCH' && turn1.activityId === 'marriage');

    const nextWeek = parseFollowUpChange('What about next week?', turn1);
    check('Follow-up "What about next week?" preserves marriage + MUHURTHAM_SEARCH, changes only horizonPhrase', Boolean(nextWeek) && nextWeek!.activityId === 'marriage' && nextWeek!.intent === 'MUHURTHAM_SEARCH' && nextWeek!.horizonPhrase === 'NEXT_7_DAYS');

    const morning = parseFollowUpChange('What about morning?', turn1);
    check('Follow-up "What about morning?" preserves marriage + MUHURTHAM_SEARCH, sets timePreference=MORNING', Boolean(morning) && morning!.activityId === 'marriage' && morning!.intent === 'MUHURTHAM_SEARCH' && morning!.timePreference === 'MORNING');
  }

  // ============================================================
  // Ask Aura Bare Ceremonial "Best Date" Routing follow-up: a bare
  // "best/good/auspicious/favorable date/time/day" phrase for a
  // Muhurtham-eligible activity, with no find/check verb, must reach
  // MUHURTHAM_SEARCH rather than falling through to the generic
  // bare-activity PLAN_OPEN default. Capability-gated (CEREMONIAL_BEST_
  // DATE_RE in askAuraIntent.ts), so this generalizes to every eligible
  // activity, not just marriage.
  // ============================================================
  for (const t of ['Best marriage date.', 'Best wedding date.', 'Good dates for marriage.', 'Good wedding dates.', 'Best date to get married.', 'Best marriage time.', 'Best auspicious wedding date.']) {
    const p = parse(t);
    check(`"${t}" -> MUHURTHAM_SEARCH, activityId=marriage`, p.intent === 'MUHURTHAM_SEARCH' && p.activityId === 'marriage');
  }

  // Generic ceremonial controls -- proves the guard is capability-driven,
  // not marriage-specific. "Best time to start a journey." already
  // resolves via the pre-existing FIND_VERB_RE ("best time to") rather
  // than this new guard, and was already covered above (Section 27).
  for (const [text, activityId] of [
    ['Best griha pravesh date.', 'griha-pravesh'],
    ['Best date to start my business.', 'business-start'],
    ['Best date for property purchase.', 'property-purchase'],
  ] as const) {
    const p = parse(text);
    check(`"${text}" -> MUHURTHAM_SEARCH, activityId=${activityId}`, p.intent === 'MUHURTHAM_SEARCH' && p.activityId === activityId);
    const response = await orchestrateAskAura(p, deps);
    check(`"${text}" executes through canonical Muhurtham`, response.intent === 'MUHURTHAM_SEARCH');
  }

  // Ordinary planning phrases must stay OUT of Muhurtham search (no
  // best/good/auspicious/favorable + date/time/day wording present).
  for (const t of ['Plan my wedding.', 'Help me plan my wedding.', 'Open wedding planning.', 'Wedding planning.']) {
    const p = parse(t);
    check(`"${t}" does not become MUHURTHAM_SEARCH`, p.intent !== 'MUHURTHAM_SEARCH');
  }

  // Dating must remain completely unaffected -- the new guard is
  // capability-gated (isSupportedMuhurthamActivity), and dating/date-night
  // are not Muhurtham-eligible, so it never fires for them regardless of
  // wording.
  check('"Best time for a date." still resolves dating (via pre-existing FIND_VERB_RE, unaffected)', parse('Best time for a date.').activityId === 'dating' && parse('Best time for a date.').intent === 'TIMING_FIND');
  check('"Plan a date tonight." still resolves date-night, unaffected', parse('Plan a date tonight.').activityId === 'date-night');
  check('"Date night with Priya." still resolves date-night, unaffected', parse('Date night with Priya.').activityId === 'date-night');
  check('"Romantic dinner with Priya." still resolves dating via PLAN_OPEN, unaffected', parse('Romantic dinner with Priya.').intent === 'PLAN_OPEN' && parse('Romantic dinner with Priya.').activityId === 'dating');

  // Panchang controls must remain unaffected -- this guard sits very late
  // in precedence (after PANCHANG_EXPLAIN/PANCHANG_QUERY/MUHURTHAM_SEARCH/
  // GOOD_RIGHT_NOW/COMPARE/FIND/CHECK all fail to match), so none of these
  // ever reach it.
  check('"When is Rahu Kalam?" stays PANCHANG_QUERY, unaffected', parse('When is Rahu Kalam?').intent === 'PANCHANG_QUERY');
  check('"What is Rahu Kalam?" stays PANCHANG_EXPLAIN, unaffected', parse('What is Rahu Kalam?').intent === 'PANCHANG_EXPLAIN');
  check('"What is marriage muhurtham?" stays PANCHANG_EXPLAIN, unaffected', parse('What is marriage muhurtham?').intent === 'PANCHANG_EXPLAIN');
  check('"What does a wedding muhurtham mean?" stays PANCHANG_EXPLAIN, unaffected', parse('What does a wedding muhurtham mean?').intent === 'PANCHANG_EXPLAIN');

  // ============================================================
  // Section 33/34: known limitations -- explicitly NOT fixed by this PR.
  // Documented here as a living regression: if any of these ever starts
  // resolving marriage via SHARED "me and X"/"X and I"/"our" phrasing, or
  // gains CHECK-phrasing/date-language support, this test should be
  // revisited (not silently left describing stale behavior).
  // ============================================================
  check('KNOWN LIMITATION (B, richer SHARED phrasing, untouched): "When should Priya and I get married?" does not resolve a SHARED scope with personNameQuery (parseScope has no "X and I" support)', parse('When should Priya and I get married?').personNameQuery === undefined);
  check('KNOWN LIMITATION (B): "Find our best wedding date." does not resolve a SHARED scope ("our" unrecognized)', parse('Find our best wedding date.').scope !== 'SHARED');
  // RESOLVED by Ask Aura Absolute Date + Weekday Parsing V1 (previously
  // KNOWN LIMITATION A: "no month-name date parsing exists"). With no
  // timezone supplied (this file's own `parse()` helper, matching every
  // other call in this file), the conservative UNKNOWN result is still
  // correct -- natural-date parsing requires a timezone by design (see
  // test/askAuraIntentParser.test.ts's dedicated section for the resolved,
  // positive-result case, and the marriage-specific section below for
  // orchestrator-level execution proof).
  check('"Is September 20 good for marriage?" with no timezone supplied -> still UNKNOWN (natural-date parsing needs a timezone)', parse('Is September 20 good for marriage?').intent === 'UNKNOWN');
  check('KNOWN LIMITATION (C, named Event Location, untouched): "Find a wedding muhurtham in Chennai." carries no location field (Ask Aura has no city-parsing path)', !('eventLocation' in parse('Find a wedding muhurtham in Chennai.')));

  // ============================================================
  // Ask Aura Ceremonial TIMING_CHECK Capability Redirect V1: TIMING_CHECK
  // for a Muhurtham-eligible activity must execute through the canonical
  // single-candidate ceremonial evaluator (evaluateMuhurthamCandidateAt),
  // never generic Timing Search's own CHECK mode alone -- the same
  // capability-driven pattern the TIMING_FIND redirect above already
  // proves, now applied to CHECK. Response wording must be CHECK-shaped
  // ("This is a strong time for X." / "I'd avoid this time for X."),
  // never FIND/search wording ("Best dates for X:").
  // ============================================================

  for (const t of ['Should I get married tomorrow?', 'Can I get married tomorrow?', 'Is now a good time to get married?', 'Is this a good time to get married?']) {
    const p = parse(t);
    check(`"${t}" parses TIMING_CHECK, activityId=marriage`, p.intent === 'TIMING_CHECK' && p.activityId === 'marriage');
    const response = await orchestrateAskAura(p, deps);
    check(`"${t}" response stays TIMING_CHECK (no new intent introduced)`, response.intent === 'TIMING_CHECK');
    check(`"${t}" response is CHECK-shaped, never FIND/search wording ("Best dates for")`, !response.message.includes('Best dates for'));
    check(`"${t}" response says either "strong time" or "avoid this time", conservative wording only`, response.message.includes('strong time') || response.message.includes('avoid this time'));
    const card = response.cards?.[0] as { requested?: { start: string; end: string } } | undefined;
    check(`"${t}" card carries a single "requested" candidate (no FIND-shaped "best"/"others"/date list)`, Boolean(card?.requested) && !('dates' in (response.cards?.[0] ?? {})) && !('best' in (response.cards?.[0] ?? {})));
  }

  // ============================================================
  // Contradiction regression (the audit's headline finding): for the SAME
  // real fixture (2026-06-12 New York), a FIND-shaped prompt (already
  // redirected) and a CHECK-shaped prompt (newly redirected by this PR)
  // must now both go through the canonical Muhurtham engine -- not
  // asserting identical wording/instant (CHECK evaluates a different,
  // horizon-derived instant than FIND's own discovered best window), but
  // asserting neither one can any longer silently fall back to generic-
  // only Timing Search for this activity.
  // ============================================================
  {
    const nyNow = new Date('2026-06-11T04:00:00.000Z');
    const nyContext: DailyAssistantContext = { now: nyNow, latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', tzOffsetMinutes: -300 };
    const nyDeps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context: nyContext, activeWindow: 'NEUTRAL' };

    const findParsed = parseAskAuraRequest('Is tomorrow good for marriage?', { now: nyNow });
    const findResponse = await orchestrateAskAura(findParsed, nyDeps);
    check('"Is tomorrow good for marriage?" (FIND) executes MUHURTHAM_SEARCH', findResponse.intent === 'MUHURTHAM_SEARCH');

    const checkParsed = parseAskAuraRequest('Should I get married tomorrow?', { now: nyNow });
    const checkResponse = await orchestrateAskAura(checkParsed, nyDeps);
    check('"Should I get married tomorrow?" (CHECK) stays TIMING_CHECK but now via the ceremonial evaluator (never "Best dates for" wording)', checkResponse.intent === 'TIMING_CHECK' && !checkResponse.message.includes('Best dates for'));
  }

  // ============================================================
  // Generic capability tests -- proves the CHECK redirect is capability-
  // driven (isSupportedMuhurthamActivity), not marriage-specific.
  // ============================================================
  for (const [text, activityId] of [
    ['Should I do griha pravesh tomorrow?', 'griha-pravesh'],
    ['Should I start my business tomorrow?', 'business-start'],
  ] as const) {
    const p = parse(text);
    check(`"${text}" parses TIMING_CHECK, activityId=${activityId}`, p.intent === 'TIMING_CHECK' && p.activityId === activityId);
    const response = await orchestrateAskAura(p, deps);
    check(`"${text}" response is CHECK-shaped (ceremonial evaluator used, not generic-only)`, response.intent === 'TIMING_CHECK' && !response.message.includes('Best dates for'));
  }

  // ============================================================
  // Everyday negative controls -- must remain fully unaffected (generic
  // handler, betterNearby still present, "You can."/"I'd hold off"
  // wording unchanged).
  // ============================================================
  for (const t of ['Can I work out now?', 'Should I do deep work now?', 'Is this a good time for meditation?']) {
    const p = parse(t);
    check(`"${t}" activity is not Muhurtham-eligible`, Boolean(p.activityId) && !isSupportedMuhurthamActivity(p.activityId!));
    const response = await orchestrateAskAura(p, deps);
    check(`"${t}" uses the UNCHANGED generic CHECK wording ("You can."/"I'd hold off for now.")`, response.message === 'You can.' || response.message === "I'd hold off for now.");
  }

  // ============================================================
  // Dating negative control -- Marriage aliases/capability routing must
  // not affect dating in any way, including under CHECK phrasing.
  // ============================================================
  {
    const p = parse('Should I go on a date tonight?');
    check('"Should I go on a date tonight?" resolves dating, not marriage', p.activityId === 'dating');
    const response = await orchestrateAskAura(p, deps);
    check('"Should I go on a date tonight?" uses the unchanged generic CHECK wording', response.message === 'You can.' || response.message === "I'd hold off for now.");
  }

  // ============================================================
  // PERSONAL ceremonial CHECK -- reuses the same natal/Tara Bala signal
  // path as PERSONAL Muhurtham search, no new personalization formula.
  // ============================================================
  {
    const p = parse('Can I get married for me?');
    check('"Can I get married for me?" parses TIMING_CHECK, scope=PERSONAL, marriage', p.intent === 'TIMING_CHECK' && p.scope === 'PERSONAL' && p.activityId === 'marriage');
    const personalDeps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context: { ...context, personalContext: { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini' } }, activeWindow: 'NEUTRAL' };
    const response = await orchestrateAskAura(p, personalDeps);
    check('"Can I get married for me?" executes the ceremonial CHECK path (never "Best dates for")', response.intent === 'TIMING_CHECK' && !response.message.includes('Best dates for'));
  }

  // ============================================================
  // Duration -- an explicit duration on a CHECK-shaped prompt must be
  // evaluated as that exact span, not silently dropped or defaulted.
  // ============================================================
  {
    const p = parse('Should I get married tomorrow for 90 minutes?');
    check('"Should I get married tomorrow for 90 minutes?" parses durationMinutes=90', p.durationMinutes === 90);
    const response = await orchestrateAskAura(p, deps);
    const card = response.cards?.[0] as { requested?: { start: string; end: string } } | undefined;
    check('"Should I get married tomorrow for 90 minutes?" evaluates a genuinely 90-minute span, not the default', Boolean(card?.requested) && (new Date(card!.requested!.end).getTime() - new Date(card!.requested!.start).getTime()) === 90 * 60000);
  }

  // ============================================================
  // Ask Aura Exact Clock-Time CHECK V1: ceremonial exact-time execution.
  // Fixes the ORIGINAL confirmed defect the Natural CHECK Phrasing audit
  // found: "Is 10 AM tomorrow good for marriage?" must evaluate EXACTLY
  // 10 AM -- never silently substitute a different (e.g. 12:55 PM)
  // searched time -- and must go through the ceremonial single-candidate
  // evaluator (evaluateMuhurthamCandidateAt, PR #65), never a full-day
  // Muhurtham search.
  // ============================================================
  {
    const nyNow = new Date('2026-06-11T04:00:00.000Z'); // "tomorrow" = 2026-06-12, known-good marriage fixture
    const nyContext: DailyAssistantContext = { now: nyNow, latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', tzOffsetMinutes: -300 };
    const nyDeps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context: nyContext, activeWindow: 'NEUTRAL' };

    const parsed = parseAskAuraRequest('Is 10 AM tomorrow good for marriage?', { now: nyNow });
    check('"Is 10 AM tomorrow good for marriage?" parses TIMING_CHECK, exactTime=10:00, activityId=marriage', parsed.intent === 'TIMING_CHECK' && parsed.exactTime === '10:00' && parsed.activityId === 'marriage');

    const response = await orchestrateAskAura(parsed, nyDeps);
    check('Response intent remains TIMING_CHECK (no new intent, no MUHURTHAM_SEARCH)', response.intent === 'TIMING_CHECK');
    check('Response is CHECK-shaped, never "Best dates for" (no full-day search)', !response.message.includes('Best dates for'));

    const card = response.cards?.[0] as { requested?: { start: string; startLabel: string }; dates?: unknown; best?: unknown } | undefined;
    check('No FIND/search-shaped card fields ("dates" list or "best") -- single requested candidate only', !('dates' in (card ?? {})) && !('best' in (card ?? {})));
    check('The requested candidate\'s LOCAL display time is exactly 10:00 AM (never silently substituted, e.g. never 12:55 PM)', card?.requested?.startLabel === '10:00 AM');
    check('The requested candidate\'s UTC instant corresponds to 10:00 America/New_York on 2026-06-12 (EDT, UTC-4) -- 2026-06-12T14:00:00.000Z', card?.requested?.start === '2026-06-12T14:00:00.000Z');
  }

  // Section 39: exact time + SHARED -- reuses the same "with <name>"
  // phrasing and SavedPerson resolution PR #65 already established; parser
  // level only here (live SavedPerson resolution needs a DB, tested
  // separately in test/askAuraOrchestratorDb.test.ts, unchanged by this PR).
  {
    const p = parse('Is 10 AM tomorrow good for marriage with Priya?');
    check('"Is 10 AM tomorrow good for marriage with Priya?" -> TIMING_CHECK, scope=SHARED, personNameQuery=priya, exactTime=10:00', p.intent === 'TIMING_CHECK' && p.scope === 'SHARED' && p.personNameQuery === 'priya' && p.exactTime === '10:00' && p.activityId === 'marriage');
  }

  // Section 38: exact time + PERSONAL.
  {
    const p = parse('Is 10 AM tomorrow good for marriage for me?');
    check('"Is 10 AM tomorrow good for marriage for me?" -> TIMING_CHECK, scope=PERSONAL, exactTime=10:00', p.intent === 'TIMING_CHECK' && p.scope === 'PERSONAL' && p.exactTime === '10:00' && p.activityId === 'marriage');
    const personalDeps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context: { ...context, personalContext: { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini' } }, activeWindow: 'NEUTRAL' };
    const response = await orchestrateAskAura(p, personalDeps);
    check('PERSONAL exact-time CHECK executes the ceremonial evaluator (never "Best dates for")', response.intent === 'TIMING_CHECK' && !response.message.includes('Best dates for'));
  }

  // Section 51: generic capability control -- griha-pravesh exact-time
  // CHECK, proving the fix is capability-driven, not marriage-specific.
  {
    const p = parse('Is 10 AM tomorrow good for griha pravesh?');
    const response = await orchestrateAskAura(p, deps);
    check('"Is 10 AM tomorrow good for griha pravesh?" executes the ceremonial evaluator with the exact requested time', response.intent === 'TIMING_CHECK' && !response.message.includes('Best dates for'));
    const card = response.cards?.[0] as { requested?: { startLabel: string } } | undefined;
    check('Griha Pravesh exact-time CHECK requested candidate is exactly 10:00 AM local', card?.requested?.startLabel === '10:00 AM');
  }

  // ============================================================
  // Ask Aura Absolute Date + Weekday Parsing V1: marriage-specific
  // orchestrator-level execution proof. The parser change is generic
  // (askAuraIntent.ts), but marriage is the activity every prior audit/
  // implementation in this sequence has used as the primary ceremonial
  // proof case, so it's proven end-to-end here too -- reusing the SAME
  // known-good New York marriage fixture (nyNow=2026-06-11, "tomorrow"=
  // 2026-06-12) the Ceremonial TIMING_CHECK and Exact Clock-Time sections
  // above already established, to show a month-name date produces the
  // IDENTICAL result as the existing "tomorrow" phrasing for the same
  // instant -- proof the new date parser feeds the exact same downstream
  // machinery, not a parallel path.
  // ============================================================
  {
    const nyNow = new Date('2026-06-11T04:00:00.000Z'); // matches the file's own established fixture above
    const nyContext: DailyAssistantContext = { now: nyNow, latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', tzOffsetMinutes: -300 };
    const nyDeps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context: nyContext, activeWindow: 'NEUTRAL' };

    const tomorrowParsed = parseAskAuraRequest('Is 10 AM tomorrow good for marriage?', { now: nyNow, timezone: 'America/New_York' });
    const monthDateParsed = parseAskAuraRequest('Is 10 AM on June 12 good for marriage?', { now: nyNow, timezone: 'America/New_York' });
    // "tomorrow" itself carries horizonPhrase=TOMORROW with no customDate at
    // the PARSER level (customDate is only set for horizonPhrase=CUSTOM_DATE
    // -- TOMORROW only becomes a concrete date later, in the orchestrator's
    // own resolveHorizonToDateRange), so the two are compared on the
    // EXECUTED instant below, not on this raw field.
    check('"Is 10 AM on June 12 good for marriage?" resolves customDate=2026-06-12', monthDateParsed.customDate === '2026-06-12');
    check('Both parse identically otherwise (intent, exactTime, activityId)', monthDateParsed.intent === tomorrowParsed.intent && monthDateParsed.exactTime === tomorrowParsed.exactTime && monthDateParsed.activityId === tomorrowParsed.activityId);

    const tomorrowResponse = await orchestrateAskAura(tomorrowParsed, nyDeps);
    const monthDateResponse = await orchestrateAskAura(monthDateParsed, nyDeps);
    const tomorrowCard = tomorrowResponse.cards?.[0] as { requested?: { start: string } } | undefined;
    const monthDateCard = monthDateResponse.cards?.[0] as { requested?: { start: string } } | undefined;
    check('Month-name date "June 12" executes through the SAME ceremonial evaluator and produces the identical requested instant as "tomorrow"', monthDateResponse.intent === 'TIMING_CHECK' && monthDateCard?.requested?.start === tomorrowCard?.requested?.start);

    // Explicit-year form for the same fixture date.
    const explicitYearParsed = parseAskAuraRequest('Is 10 AM on June 12 2026 good for marriage?', { now: nyNow, timezone: 'America/New_York' });
    check('"Is 10 AM on June 12 2026 good for marriage?" also resolves 2026-06-12', explicitYearParsed.customDate === '2026-06-12');
  }

  // Marriage date-only (no clock) through a month-name date -- must still
  // execute through the canonical Muhurtham engine (capability redirect,
  // unchanged), not the generic Timing Search FIND path.
  {
    const parsed = parseAskAuraRequest('Is September 20 good for marriage?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('"Is September 20 good for marriage?" (with timezone) parses TIMING_FIND, customDate=2026-09-20', parsed.intent === 'TIMING_FIND' && parsed.customDate === '2026-09-20');
    const response = await orchestrateAskAura(parsed, deps);
    check('Executes through canonical Muhurtham (capability redirect, unaffected by this PR)', response.intent === 'MUHURTHAM_SEARCH');
  }

  // CRITICAL timezone-date-boundary test: the UTC calendar date and the
  // Timing Location's local calendar date differ -- weekday resolution
  // (and therefore which day gets evaluated) must follow the LOCAL date.
  {
    // UTC 2026-09-04T20:00:00.000Z is already 2026-09-05 (Saturday) in
    // Asia/Kolkata (UTC+5:30).
    const boundaryNow = new Date('2026-09-04T20:00:00.000Z');
    const parsed = parseAskAuraRequest('Is Saturday good for marriage?', { now: boundaryNow, timezone: 'Asia/Kolkata' });
    check('"Is Saturday good for marriage?" at a UTC/local calendar-date boundary resolves against LOCAL 2026-09-05, not UTC 2026-09-04', parsed.customDate === '2026-09-05');
  }

  // ============================================================
  // Ask Aura Absolute Date + Weekday Parsing V1 follow-up: ceremonial
  // explicit-past-date safety. Confirmed directly (before this guard
  // existed) that the ceremonial evaluator has no "must be in the future"
  // check either -- "Is September 20 2020 good for marriage?" returned a
  // real MUHURTHAM_SEARCH zero-result message, and the exact-time form
  // returned a genuine ("I'd avoid this time for Marriage") CAUTION
  // verdict WITH a "Plan this" action for a 2020 instant. Everyday paths
  // proven in test/askAuraOrchestrator.test.ts.
  // ============================================================
  {
    const p = parse('Is September 20 2020 good for marriage?');
    check('Ceremonial date-only explicit past date -> UNKNOWN at the parser (no timezone here; see the timezone-supplied case below)', p.intent === 'UNKNOWN');
  }
  {
    const p = parseAskAuraRequest('Is September 20 2020 good for marriage?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Ceremonial date-only explicit past date (timezone supplied) -> UNKNOWN at the parser', p.intent === 'UNKNOWN');
    const response = await orchestrateAskAura(p, deps);
    check('-> UNKNOWN response, never a silent MUHURTHAM_SEARCH zero-result message', response.intent === 'UNKNOWN');
    check('No "Plan this" or "Open Muhurtham Finder" action for a historical instant', !response.actions?.some((a) => a.type === 'PLAN_THIS' || a.type === 'OPEN_MUHURTHAM'));
  }
  {
    const p = parseAskAuraRequest('Is 10 AM on September 20 2020 good for marriage?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Ceremonial exact-time explicit past date -> UNKNOWN at the parser', p.intent === 'UNKNOWN');
    const response = await orchestrateAskAura(p, deps);
    check('-> UNKNOWN response, never a silent CAUTION verdict for a historical instant', response.intent === 'UNKNOWN');
    check('No "Plan this" action for a historical instant', !response.actions?.some((a) => a.type === 'PLAN_THIS'));
  }
  {
    // Regression control: a FUTURE explicit date for marriage is completely
    // unaffected by the past-date guard.
    const p = parseAskAuraRequest('Is September 20 2026 good for marriage?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Ceremonial date-only explicit FUTURE date is unaffected', p.intent === 'TIMING_FIND' && p.customDate === '2026-09-20' && p.activityId === 'marriage');
    const response = await orchestrateAskAura(p, deps);
    check('Executes through canonical Muhurtham, not UNKNOWN', response.intent === 'MUHURTHAM_SEARCH');
  }

  console.log(allPassed ? '\nALL ASK AURA MARRIAGE ROUTING CHECKS PASSED' : '\nSOME ASK AURA MARRIAGE ROUTING CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main();
