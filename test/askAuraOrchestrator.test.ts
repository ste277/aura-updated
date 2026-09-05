/**
 * Non-DB orchestrator tests -- every branch here calls a REAL domain
 * function (runTimingSearch, getPanchangForDate, getActionCards,
 * handleMuhurthamSearchBody) with no mocking, proving the response is
 * genuinely derived from the same engine Plan/Panchang/Muhurtham Finder
 * use, not a parallel calculation (brief section 6). SHARED-scope paths
 * (SavedPerson resolution) need a live DB and are covered separately in
 * test/askAuraOrchestratorDb.test.ts.
 */
import { parseAskAuraRequest } from '../packages/recommendation/src/askAuraIntent';
import { orchestrateAskAura, resolveHorizonToDateRange, resolveEventLocationQuery, AskAuraOrchestratorDeps } from '../apps/web/lib/askAuraOrchestrator';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import { getActionCards } from '../packages/recommendation/src/actionCards';
import { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import { parseEventLocationSnapshot } from '../apps/web/lib/plansRequest';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const NOW = new Date('2026-08-23T10:00:00.000Z'); // a Sunday, matches parser test fixture
const context: DailyAssistantContext = {
  now: NOW,
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};
const deps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context, activeWindow: 'NEUTRAL' };

async function main() {
  // ============================================================
  // Section 31 -- GOOD_RIGHT_NOW: Ask Aura GOOD_RIGHT_NOW Personalized
  // Hybrid V1 -- SEMANTIC (not exact) parity with Home's own Good Right
  // Now. Composition: the first two curated base cards (getActionCards,
  // UNCHANGED) as safe anchors, plus one live-ranked, personalized
  // discovery candidate (getActivityDiscoveryCards) -- never a second
  // ranking function, always exactly 3 options, no activity-history query
  // (Ask Aura remains intentionally history-agnostic, unlike Home).
  // ============================================================
  {
    const parsed = parseAskAuraRequest('What should I do right now?', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    const base = getActionCards('NEUTRAL');
    check('GOOD_RIGHT_NOW intent', response.intent === 'GOOD_RIGHT_NOW');
    const options = (response.cards?.[0]?.options as Array<{ activityId?: string }>) ?? [];
    check('GOOD_RIGHT_NOW always returns exactly 3 options', options.length === 3);
    check('First two options are the curated base cards, byte-for-byte (unaffected anchors)', JSON.stringify(options[0]) === JSON.stringify(base[0]) && JSON.stringify(options[1]) === JSON.stringify(base[1]));
    check('Third option is a genuine discovery candidate, not the original base[2]', options[2]?.activityId !== base[2].activityId);
    const baseActivityIds = new Set(base.map((c) => c.activityId).filter(Boolean));
    check('Third option\'s activityId does not duplicate ANY of the three base cards (not just the two displayed anchors)', !baseActivityIds.has(options[2]?.activityId));
    check('OPEN_TIMELINE action is still present (no action regression)', Boolean(response.actions?.some((a) => a.type === 'OPEN_TIMELINE')));
  }

  // --- Personalization: the discovery-sourced third card is genuinely
  // evaluated with deps.context.personalContext, using the real canonical
  // evaluator -- no fabricated bonus, no mocking. ---
  {
    const personalizedDeps: AskAuraOrchestratorDeps = { ...deps, context: { ...context, personalContext: { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini', moonElement: 'FIRE' } } };
    const parsed = parseAskAuraRequest('What should I do right now?', { now: NOW });
    const generalResponse = await orchestrateAskAura(parsed, deps);
    const personalizedResponse = await orchestrateAskAura(parsed, personalizedDeps);
    const generalThird = (generalResponse.cards?.[0]?.options as Array<{ activityId?: string; description?: string }>)[2];
    const personalizedThird = (personalizedResponse.cards?.[0]?.options as Array<{ activityId?: string; description?: string }>)[2];
    check('Same discovery candidate resolves in both calls (deterministic fixed NOW/window -- personalization here changes the score, not which activity wins)', generalThird?.activityId === personalizedThird?.activityId);
    check('Personalized description genuinely differs from the general one (canonical personalSummary surfaced, never invented)', generalThird?.description !== personalizedThird?.description);
  }

  // --- Incomplete/absent birth profile: discovery ranking itself remains
  // useful even without natal personalization -- still exactly 3 options,
  // no error, no clarification, no profile-completion requirement. ---
  {
    const parsed = parseAskAuraRequest('What should I do right now?', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps); // deps.context.personalContext is already undefined
    const options = (response.cards?.[0]?.options as unknown[]) ?? [];
    check('Incomplete/absent birth profile -> still exactly 3 options, no error, no clarification', options.length === 3 && response.cards?.[0]?.type !== 'CLARIFICATION');
  }

  // --- Deterministic now: repeated calls with the identical fixed
  // context.now produce byte-identical output, proving the response is
  // driven by the request's own canonical instant, never a second,
  // independent internal wall-clock reading. ---
  {
    const parsed = parseAskAuraRequest('What should I do right now?', { now: NOW });
    const r1 = await orchestrateAskAura(parsed, deps);
    const r2 = await orchestrateAskAura(parsed, deps);
    check('Repeated GOOD_RIGHT_NOW calls with the same fixed context.now produce byte-identical cards', JSON.stringify(r1.cards) === JSON.stringify(r2.cards));
  }

  // --- Event Location structurally irrelevant (brief section 20): a
  // GOOD_RIGHT_NOW-classified prompt never even attaches a locationQuery in
  // the first place (step 4's own return in askAuraIntent.ts is a minimal
  // { intent, confidence } object, pre-existing and unaffected by this PR),
  // and handleGoodRightNow never reads deps.eventLocation either way -- an
  // "in X" phrase on such a prompt has zero effect on the response. ---
  {
    const withLocationParsed = parseAskAuraRequest('What should I do right now in Chennai?', { now: NOW });
    check('GOOD_RIGHT_NOW never carries a locationQuery, with or without an "in X" phrase in the prompt', withLocationParsed.intent === 'GOOD_RIGHT_NOW' && withLocationParsed.locationQuery === undefined);
    const withLocation = await orchestrateAskAura(withLocationParsed, deps);
    const withoutLocationParsed = parseAskAuraRequest('What should I do right now?', { now: NOW });
    const withoutLocation = await orchestrateAskAura(withoutLocationParsed, deps);
    check(
      'Response cards/actions/message are identical whether or not a location phrase was present (Event Location is ceremonial-only, ignored here)',
      JSON.stringify(withLocation.cards) === JSON.stringify(withoutLocation.cards) && JSON.stringify(withLocation.actions) === JSON.stringify(withoutLocation.actions) && withLocation.message === withoutLocation.message
    );
  }

  // ============================================================
  // Section 32 -- TIMING_CHECK: result equals a direct Timing Search CHECK
  // call for the same inputs.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('Can I work out now?', { now: NOW });
    check('parsed as TIMING_CHECK / workout / NOW', parsed.intent === 'TIMING_CHECK' && parsed.activityId === 'workout');
    const response = await orchestrateAskAura(parsed, deps);
    const direct = runTimingSearch({ mode: 'CHECK', activityId: 'workout', durationMinutes: 30, candidateStart: NOW.toISOString(), context });
    const requested = response.cards?.[0]?.requested as { score: number; label: string } | undefined;
    check('TIMING_CHECK response score matches direct Timing Search CHECK', requested?.score === direct.requestedCandidate?.score);
    check('TIMING_CHECK response label matches direct Timing Search CHECK', requested?.label === direct.requestedCandidate?.label);
    check('TIMING_CHECK carries a "Plan this" action', Boolean(response.actions?.some((a) => a.type === 'PLAN_THIS')));
  }

  // ============================================================
  // Section 33 -- TIMING_FIND: ranking equals direct Timing Search FIND.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('When should I do deep work tomorrow morning for 60 minutes?', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    const dateRange = resolveHorizonToDateRange(parsed.horizonPhrase, parsed.customDate, context);
    const direct = runTimingSearch({ mode: 'FIND', activityId: 'deep-work', durationMinutes: 60, dateRange, timePreference: 'MORNING', context, limit: 3 });
    const best = response.cards?.[0]?.best as { start: string; score: number } | undefined;
    check('TIMING_FIND best candidate start matches direct Timing Search FIND', best?.start === direct.candidates[0]?.start);
    check('TIMING_FIND best candidate score matches direct Timing Search FIND', best?.score === direct.candidates[0]?.score);
  }

  // ============================================================
  // Section 35 -- PANCHANG_QUERY: only the requested field renders.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('When is Rahu Kalam tomorrow?', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    check('PANCHANG_QUERY intent', response.intent === 'PANCHANG_QUERY');
    check('Only the requested window is mentioned -- no full Panchang dump (no cards)', !response.cards);
    check('Message names Rahu Kalam specifically', response.message.toLowerCase().includes('rahu kalam'));
  }
  {
    const parsed = parseAskAuraRequest("What is tomorrow's Panchang?", { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    check('Full Panchang query DOES return a PANCHANG_SUMMARY card', response.cards?.[0]?.type === 'PANCHANG_SUMMARY');
  }

  // ============================================================
  // PANCHANG_EXPLAIN -- no Panchang calculation call at all, pure glossary.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('What is Rohini?', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    check('PANCHANG_EXPLAIN intent', response.intent === 'PANCHANG_EXPLAIN');
    check('Explains Rohini as a Nakshatra', response.message.toLowerCase().includes('nakshatra'));
  }

  // ============================================================
  // Section 36 -- MUHURTHAM_SEARCH (GENERAL): strict eligibility preserved,
  // real Muhurtham engine called.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('Good dates for Griha Pravesh next month', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    check('MUHURTHAM_SEARCH intent', response.intent === 'MUHURTHAM_SEARCH');
    check('Carries an OPEN_MUHURTHAM action for the resolved activity', Boolean(response.actions?.some((a) => a.type === 'OPEN_MUHURTHAM' && a.activityId === 'griha-pravesh')));
  }

  // ============================================================
  // Section 37 -- regression: casual activity never routed through
  // Muhurtham Finder, even with search-y phrasing.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('Best time for coffee tomorrow', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    check('"Best time for coffee tomorrow" never becomes a MUHURTHAM_SEARCH response', response.intent !== 'MUHURTHAM_SEARCH');
  }

  // ============================================================
  // Section 39 -- "Why?" follow-up never recalculates, just echoes context.
  // ============================================================
  {
    const first = parseAskAuraRequest('Can I work out now?', { now: NOW });
    const firstResponse = await orchestrateAskAura(first, deps);
    const why = parseAskAuraRequest('Why?', { now: NOW, previous: firstResponse.context });
    const whyResponse = await orchestrateAskAura(why, deps);
    check('"Why?" reuses the same intent as the previous turn (no recomputation of a new intent)', whyResponse.intent === firstResponse.intent);
  }

  // ============================================================
  // Section 40 -- UNKNOWN -> CLARIFICATION, never a fabricated activity.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('asdkfjaslkdfj random gibberish', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    check('Gibberish -> UNKNOWN response', response.intent === 'UNKNOWN');
    check('Offers CLARIFICATION options, no activityId anywhere in the response', response.cards?.[0]?.type === 'CLARIFICATION' && !JSON.stringify(response).includes('"activityId"'));
  }

  // ============================================================
  // Section 41 -- privacy: no birth data, natal data, or internal ids ever
  // appear in a response for these non-personal intents.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('When should I do deep work tomorrow?', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    const serialized = JSON.stringify(response);
    const forbidden = ['birthDate', 'birthTime', 'birthTimezone', 'natalNakshatraIndex', 'janmaRashi', 'ownerUserId'];
    check('No birth/natal/ownership fields leak into the Ask Aura response', forbidden.every((needle) => !serialized.includes(needle)));
  }

  // ============================================================
  // Ask Aura Exact Clock-Time CHECK V1: everyday exact-time execution +
  // timezone/DST conversion. TIMING_CHECK + exactTime must evaluate the
  // EXACT requested local instant -- never a searched/substituted time --
  // converted through the real, DST-aware timezone utility.
  // ============================================================

  // Section 42: everyday exact-time execution.
  {
    const parsed = parseAskAuraRequest('Is 10 AM tomorrow good for deep work?', { now: NOW });
    check('"Is 10 AM tomorrow good for deep work?" parses exactTime=10:00', parsed.exactTime === '10:00');
    const response = await orchestrateAskAura(parsed, deps);
    check('Everyday exact-time CHECK stays TIMING_CHECK (generic Timing Search CHECK, not FIND)', response.intent === 'TIMING_CHECK');
    const requested = (response.cards?.[0] as { requested?: { startLabel?: string } } | undefined)?.requested;
    check('The requested candidate\'s local display time is exactly 10:00 AM, not a different searched time', requested?.startLabel === '10:00 AM');
  }

  // Section 43: timezone test (Chennai/Asia-Kolkata) -- the brief's own
  // worked example: 10:00 IST (UTC+5:30) must convert to exactly
  // 2026-09-20T04:30:00.000Z.
  {
    const parsed = parseAskAuraRequest('Is 10 AM on 2026-09-20 good for deep work?', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    const requested = (response.cards?.[0] as { requested?: { start?: string } } | undefined)?.requested;
    check('10:00 Asia/Kolkata on 2026-09-20 converts to exactly 2026-09-20T04:30:00.000Z UTC', requested?.start === '2026-09-20T04:30:00.000Z');
  }

  // Section 44: non-IST, DST-aware timezone test (America/New_York). The
  // SAME code path must produce a DIFFERENT, correct UTC offset depending
  // on the time of year -- proof this is genuine Intl-timezone-database
  // conversion (packages/panchang/src/localDate.ts's localDateTimeToUTC),
  // never a hardcoded fixed offset.
  {
    const nyContext: DailyAssistantContext = { now: NOW, latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', tzOffsetMinutes: -300 };
    const nyDeps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context: nyContext, activeWindow: 'NEUTRAL' };

    const septParsed = parseAskAuraRequest('Is 10 AM on 2026-09-20 good for deep work?', { now: NOW });
    const septResponse = await orchestrateAskAura(septParsed, nyDeps);
    const septRequested = (septResponse.cards?.[0] as { requested?: { start?: string } } | undefined)?.requested;
    check('10:00 America/New_York on 2026-09-20 (EDT, UTC-4) converts to 2026-09-20T14:00:00.000Z', septRequested?.start === '2026-09-20T14:00:00.000Z');

    const janParsed = parseAskAuraRequest('Is 10 AM on 2026-01-15 good for deep work?', { now: NOW });
    const janResponse = await orchestrateAskAura(janParsed, nyDeps);
    const janRequested = (janResponse.cards?.[0] as { requested?: { start?: string } } | undefined)?.requested;
    check('10:00 America/New_York on 2026-01-15 (EST, UTC-5) converts to 2026-01-15T15:00:00.000Z -- a DIFFERENT, correct offset from the September case, proving real DST-aware conversion', janRequested?.start === '2026-01-15T15:00:00.000Z');
  }

  // Section 36: everyday betterNearby is unchanged -- still a separate,
  // explicitly-labeled field, never conflated with the requested instant.
  {
    const parsed = parseAskAuraRequest('Is 10 AM tomorrow good for deep work?', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    const card = response.cards?.[0] as { requested?: unknown; betterNearby?: unknown } | undefined;
    check('Everyday exact-time CHECK can still surface betterNearby as a separate field (unchanged generic CHECK behavior)', 'requested' in (card ?? {}) && 'betterNearby' in (card ?? {}));
  }

  // ============================================================
  // Ask Aura Absolute Date + Weekday Parsing V1 follow-up: an explicit past
  // date must not silently execute as a normal future-planning result.
  // Confirmed directly (before this guard existed) that neither Timing
  // Search nor the Muhurtham engine has any "must be in the future" check
  // of its own -- both computed a real-looking score AND offered a
  // "Plan this" action for a 2020 date. Everyday date-only and exact-time
  // paths proven here; ceremonial paths proven in
  // test/askAuraMarriageRouting.test.ts.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('Is September 20 2020 good for deep work?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Everyday date-only explicit past date -> UNKNOWN at the parser', parsed.intent === 'UNKNOWN');
    const response = await orchestrateAskAura(parsed, deps);
    check('Everyday date-only explicit past date -> UNKNOWN response, no silent execution', response.intent === 'UNKNOWN');
    check('No "Plan this" action for a historical instant', !response.actions?.some((a) => a.type === 'PLAN_THIS'));
  }
  {
    const parsed = parseAskAuraRequest('Is 10 AM on September 20 2020 good for deep work?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Everyday exact-time explicit past date -> UNKNOWN at the parser', parsed.intent === 'UNKNOWN');
    const response = await orchestrateAskAura(parsed, deps);
    check('Everyday exact-time explicit past date -> UNKNOWN response, no silent execution', response.intent === 'UNKNOWN');
    check('No "Plan this" action for a historical instant', !response.actions?.some((a) => a.type === 'PLAN_THIS'));
  }
  {
    // A FUTURE explicit date must remain completely unaffected by the past-
    // date guard -- this is the regression control proving the fix is
    // narrowly scoped to genuinely past dates.
    const parsed = parseAskAuraRequest('Is September 20 2026 good for deep work?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Everyday date-only explicit FUTURE date is unaffected', parsed.intent === 'TIMING_FIND' && parsed.customDate === '2026-09-20');
    const response = await orchestrateAskAura(parsed, deps);
    check('Executes normally, not UNKNOWN', response.intent === 'TIMING_FIND');
  }

  // ============================================================
  // RESOLVED by Ask Aura Scope-Aware Everyday TIMING_CHECK V1 (previously:
  // "everyday non-ceremonial TIMING_CHECK cannot perform SHARED
  // personalization -- documented, not fixed"). "Is 10 AM tomorrow good for
  // Priya and me to meditate?" now genuinely reaches
  // handleEverydaySharedTimingCheck, which requires a real SavedPerson
  // resolution -- that end-to-end blend proof (RESOLVED/AMBIGUOUS/
  // NOT_FOUND/incomplete-profile, and the "SHARED no longer byte-identical
  // to GENERAL when personal signals diverge" assertion) now lives in
  // test/askAuraOrchestratorDb.test.ts, since it needs a live DB. Only the
  // parser-level routing shape (no DB call) is re-confirmed here.
  // ============================================================
  {
    const sharedParsed = parseAskAuraRequest('Is 10 AM tomorrow good for Priya and me to meditate?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('"...Priya and me to meditate?" parses TIMING_CHECK, SHARED, priya (routes to the everyday shared CHECK handler)', sharedParsed.intent === 'TIMING_CHECK' && sharedParsed.scope === 'SHARED' && sharedParsed.personNameQuery === 'priya');

    const genericParsed = parseAskAuraRequest('Is 10 AM tomorrow good for meditation?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('sanity: the no-SHARED-signal control parses the same activity/time, scope=GENERAL', genericParsed.activityId === sharedParsed.activityId && genericParsed.exactTime === sharedParsed.exactTime && genericParsed.scope === 'GENERAL');
  }

  // ============================================================
  // Ask Aura Scope-Aware Everyday TIMING_CHECK V1.
  // ============================================================

  // Section 5/6/35/36 -- GENERAL and PERSONAL generic CHECK must remain
  // byte-identical to before this PR (neither branches on scope; both were
  // already silently owner-personalized via context.personalContext, per
  // the audit -- this PR must not change that).
  {
    const personalizedContext: DailyAssistantContext = { ...context, personalContext: { natalNakshatraIndex: 1, janmaNakshatra: 'Bharani' } };
    const personalizedDeps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context: personalizedContext, activeWindow: 'NEUTRAL' };

    const generalParsed = parseAskAuraRequest('Is 10 AM tomorrow good for meditation?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('GENERAL parses scope=GENERAL', generalParsed.scope === 'GENERAL');
    const generalResponse = await orchestrateAskAura(generalParsed, personalizedDeps);

    const personalParsed = parseAskAuraRequest('Is 10 AM tomorrow good for me to meditate?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('PERSONAL parses scope=PERSONAL', personalParsed.scope === 'PERSONAL');
    const personalResponse = await orchestrateAskAura(personalParsed, personalizedDeps);

    // Compare everything EXCEPT the echoed `context` field -- that field
    // legitimately differs (it echoes back parsed.scope for follow-up
    // continuity), even though the underlying computed result is identical.
    const { context: _generalCtx, ...generalRest } = generalResponse;
    const { context: _personalCtx, ...personalRest } = personalResponse;
    check('GENERAL and PERSONAL generic CHECK produce byte-identical computed results (message/cards/actions) -- unchanged by this PR, documented pre-existing equivalence, not newly introduced', JSON.stringify(generalRest) === JSON.stringify(personalRest));
    check('GENERAL response intent is TIMING_CHECK, unaffected', generalResponse.intent === 'TIMING_CHECK');
  }

  // Section 39 -- fail-closed regression (PR #68): "for us"/"together" with
  // no deterministic partner must remain UNKNOWN, never reach the new
  // everyday shared CHECK path, never silently execute owner-only.
  {
    const parsed = parseAskAuraRequest('Is 10 AM tomorrow good for us to meditate?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('"for us" (no resolvable partner) still parses UNKNOWN -- PR #68 invariant unaffected', parsed.intent === 'UNKNOWN');
    const response = await orchestrateAskAura(parsed, deps);
    check('Orchestrator response is UNKNOWN, never a silent owner-only CHECK', response.intent === 'UNKNOWN');
  }

  // Section 31 -- ceremonial routing regression: a Muhurtham-eligible
  // activity's TIMING_CHECK must remain completely untouched by this PR,
  // still routing through handleMuhurthamTimingCheck/
  // evaluateMuhurthamCandidateAt, never the new everyday shared path.
  //
  // UPDATED by Ask Aura Date-Only CHECK Semantics V1: "Should I get married
  // tomorrow?" (no exact clock) now correctly parses TIMING_FIND, not
  // TIMING_CHECK -- an exact-clock variant is used here instead to keep
  // testing the thing this check actually cares about (a genuinely
  // CHECK-shaped ceremonial request never reaching the everyday-SHARED
  // handler PR #69 added).
  {
    const parsed = parseAskAuraRequest('Should I get married at 10 AM tomorrow?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Ceremonial (marriage) exact-clock request parses TIMING_CHECK', parsed.intent === 'TIMING_CHECK' && parsed.activityId === 'marriage' && parsed.exactTime === '10:00');
    const response = await orchestrateAskAura(parsed, deps);
    check('Ceremonial CHECK response is CHECK-shaped, never "Best dates for" (unaffected by this PR)', response.intent === 'TIMING_CHECK' && !response.message.includes('Best dates for'));
    check('Ceremonial CHECK response never carries a SHARED-everyday-shaped scope/personName field (proves it did NOT reach the new everyday shared handler)', !('scope' in (response.cards?.[0] ?? {})) && !('personName' in (response.cards?.[0] ?? {})));
    // PR B, omitted-location control (brief section 24): no explicit
    // Event Location -> PLAN_THIS behaves exactly as it always has, no
    // eventLocation field manufactured on the payload.
    const planAction = response.actions?.find((a) => a.type === 'PLAN_THIS');
    check('PLAN_THIS is present for a no-location ceremonial CHECK, exactly as before this PR', Boolean(planAction));
    check('No eventLocation field on the payload when no Event Location was resolved', !planAction?.planPayload || !('eventLocation' in planAction.planPayload));
  }
  // The date-only form now correctly reaches the canonical Muhurtham
  // search (via the existing, unchanged capability redirect), never a
  // fabricated single instant.
  {
    const parsed = parseAskAuraRequest('Should I get married tomorrow?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('"Should I get married tomorrow?" (no exact clock) now parses TIMING_FIND', parsed.intent === 'TIMING_FIND' && parsed.activityId === 'marriage' && parsed.exactTime === undefined);
    const response = await orchestrateAskAura(parsed, deps);
    check('Executes through the canonical Muhurtham search, never a fabricated-instant CHECK', response.intent === 'MUHURTHAM_SEARCH');
  }

  // Section 27 -- natural-date + duration composition (PR #66/#67) must
  // remain intact once routed through the new everyday shared path (parser
  // level here; full end-to-end blend proof with a real SavedPerson is in
  // test/askAuraOrchestratorDb.test.ts).
  {
    const parsed = parseAskAuraRequest('Is 10 AM next Friday good for Priya and me to meditate for 90 minutes?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Natural date + duration + pair grammar compose correctly: TIMING_CHECK, SHARED, priya, exactTime=10:00, durationMinutes=90, customDate resolved', parsed.intent === 'TIMING_CHECK' && parsed.scope === 'SHARED' && parsed.personNameQuery === 'priya' && parsed.exactTime === '10:00' && parsed.durationMinutes === 90 && parsed.horizonPhrase === 'CUSTOM_DATE' && Boolean(parsed.customDate));
  }

  // Section 28 -- dating regression: a non-Muhurtham activity with pair
  // grammar must resolve to the everyday shared CHECK path (not marriage),
  // proven here at the parser/routing level (full DB resolution proof is in
  // askAuraOrchestratorDb.test.ts).
  {
    const parsed = parseAskAuraRequest('Is 7 PM next Friday good for Priya and me to go on a date?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Dating + pair grammar parses activityId=dating, SHARED, priya (not marriage)', parsed.activityId === 'dating' && parsed.scope === 'SHARED' && parsed.personNameQuery === 'priya');
  }

  // Direct proof (no DB needed) that the requested candidate is preserved
  // exactly and that betterNearby -- if the everyday shared handler's own
  // mechanism is exercised -- compares candidates via nearbyCheckInstants(),
  // the SAME range/step/day-boundary rules generic CHECK's own betterNearby
  // scan already uses (imported directly to prove no broadened search).
  {
    const { nearbyCheckInstants } = await import('../packages/recommendation/src/timingSearch');
    const candidateStart = '2026-09-04T04:30:00.000Z';
    const instants = nearbyCheckInstants(candidateStart, 30, context);
    check('nearbyCheckInstants never includes the requested instant itself', !instants.includes(candidateStart));
    check('nearbyCheckInstants stays within the default 180-minute window (a sample of the returned instants should differ from candidateStart by at most 180 minutes)', instants.every((iso) => Math.abs(new Date(iso).getTime() - new Date(candidateStart).getTime()) <= 180 * 60000));
  }

  // ============================================================
  // Ask Aura Date-Only CHECK Semantics V1: end-to-end proof for an
  // everyday activity that the fabricated-instant bug is gone. Previously
  // "Should I meditate tomorrow?" silently evaluated the resolved date +
  // literal UTC noon -- confirmed via the audit to display as 5:30 PM in
  // Asia/Kolkata and 8:00 AM in America/New_York for the SAME UTC instant,
  // for the SAME kind of request. Now it correctly executes as a genuine
  // FIND across the day, with a result that is a real, specific window
  // returned by the unmodified canonical engine -- never that fabricated
  // instant, and never dependent on the server's own timezone.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('Should I meditate tomorrow?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('"Should I meditate tomorrow?" now parses TIMING_FIND (was a fabricated-instant CHECK)', parsed.intent === 'TIMING_FIND' && parsed.exactTime === undefined);
    const response = await orchestrateAskAura(parsed, deps);
    check('Executes as a genuine FIND across the day', response.intent === 'TIMING_FIND');
    const card = response.cards?.[0] as { best?: { start: string } } | undefined;
    check('Response carries a real "best" window candidate, never a single fabricated-noon instant', Boolean(card?.best?.start));
    // The old bug's own signature: a fabricated instant always fell exactly
    // on 'T12:00:00.000Z'. A genuine FIND-discovered window has no reason
    // to land there deterministically.
    check('The returned instant is not the old fabricated UTC-noon signature', !card?.best?.start.endsWith('T12:00:00.000Z'));
  }
  {
    // Range collapse regression: a multi-day horizon must not be reduced
    // to its first day alone.
    const parsed = parseAskAuraRequest('Should I meditate this weekend?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('"Should I meditate this weekend?" parses TIMING_FIND, THIS_WEEKEND (full range preserved)', parsed.intent === 'TIMING_FIND' && parsed.horizonPhrase === 'THIS_WEEKEND');
    const response = await orchestrateAskAura(parsed, deps);
    check('Executes as a genuine FIND across the full weekend range', response.intent === 'TIMING_FIND');
  }

  // ============================================================
  // Ask Aura Event Location V1: ceremonial-only Event Location routing.
  // deps/context above are Chennai's own coordinates, so a New York-based
  // caller context is used below wherever the test needs to PROVE the
  // Event Location actually overrode the search context, rather than
  // coincidentally matching it.
  // ============================================================
  const nyContext: DailyAssistantContext = { now: NOW, latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', tzOffsetMinutes: -300 };
  const nyDeps: AskAuraOrchestratorDeps = { userId: 'test-user-not-a-real-db-row', context: nyContext, activeWindow: 'NEUTRAL' };

  // --- Case-insensitive, comma-suffix-stripped resolution (brief section
  // 11): "chennai" and "san francisco" both resolve against CITY_OPTIONS. ---
  const chennai = resolveEventLocationQuery('chennai');
  check('resolveEventLocationQuery("chennai") resolves case-insensitively', chennai?.cityName === 'Chennai' && chennai?.timezone === 'Asia/Kolkata');
  check('resolveEventLocationQuery("Chennai") resolves identically regardless of case', resolveEventLocationQuery('Chennai')?.cityName === 'Chennai');
  const sanFrancisco = resolveEventLocationQuery('san francisco');
  check('resolveEventLocationQuery("san francisco") resolves the international CITY_OPTIONS entry with its ", USA" suffix stripped for matching', sanFrancisco?.cityName === 'San Francisco, USA' && sanFrancisco?.timezone === 'America/Los_Angeles');
  check('resolveEventLocationQuery("Atlantis") does not resolve (not in CITY_OPTIONS)', resolveEventLocationQuery('atlantis') === undefined);

  // --- GENERAL Muhurtham search with Event Location (brief section 16/21/
  // 26/27/28/33/36): fresh context built from the Event Location, owner
  // personalContext untouched (there is none for GENERAL), response echoes
  // {cityName, timezone} with no coordinates, wording names the location. ---
  {
    // Griha Pravesh (not marriage) over NEXT_MONTH deterministically returns
    // real candidate dates for this fixture's coordinates/date -- needed to
    // exercise the non-empty MUHURTHAM_RESULTS card (marriage next Friday/
    // next month both return zero real matches for this fixture, which
    // would only prove the OTHER, message-only branch below).
    const parsed = parseAskAuraRequest('Good dates for Griha Pravesh in Chennai next month', { now: NOW, timezone: chennai!.timezone });
    check('Parses MUHURTHAM_SEARCH, griha-pravesh, locationQuery=chennai', parsed.intent === 'MUHURTHAM_SEARCH' && parsed.activityId === 'griha-pravesh' && parsed.locationQuery === 'chennai');

    const response = await orchestrateAskAura(parsed, { ...nyDeps, eventLocation: chennai });
    check('GENERAL Muhurtham search with Event Location still executes MUHURTHAM_SEARCH -- no engine change', response.intent === 'MUHURTHAM_SEARCH');
    const card = response.cards?.[0] as { dates?: unknown[]; eventLocation?: { cityName?: string; timezone?: string } } | undefined;
    check('Real candidate dates were found (a non-empty result, exercising the card that carries the echo)', Boolean(card?.dates?.length));
    check('Response echoes the resolved Event Location (cityName + timezone)', card?.eventLocation?.cityName === 'Chennai' && card?.eventLocation?.timezone === 'Asia/Kolkata');
    check('Message names the Event Location explicitly', response.message.includes('Chennai'));
    check('No coordinates leaked into the response (brief section 26: cityName/timezone only)', !JSON.stringify(response).includes('13.0827') && !JSON.stringify(response).includes('80.2707'));
  }
  {
    // The empty-result branch (brief section 27: wording clarity) is a
    // real, deterministic outcome for THIS fixture -- confirmed directly --
    // and must still name the Event Location even with no card at all.
    const parsed = parseAskAuraRequest('Find a marriage Muhurtham in Chennai next Friday.', { now: NOW, timezone: chennai!.timezone });
    const response = await orchestrateAskAura(parsed, { ...nyDeps, eventLocation: chennai });
    check('Zero-result Muhurtham search still names the Event Location in its message', response.intent === 'MUHURTHAM_SEARCH' && response.message.includes('Chennai') && !response.cards);
  }

  // --- Ceremonial exact-clock TIMING_CHECK with Event Location (brief
  // section 19/24/26/27/28/42; PR B section 8/29/30: PLAN_THIS restored):
  // the candidate instant is evaluated in the EVENT LOCATION's timezone,
  // never the caller's own Timing Location (New York) -- proven by the
  // formatted display time, which would show a different clock reading
  // entirely if the instant had been computed against New York instead.
  // PR A suppressed PLAN_THIS here because the save payload couldn't carry
  // the Event Location; PR B threads it through, so PLAN_THIS is restored
  // unconditionally, and the payload is proven to actually survive
  // persistence by feeding it through the REAL, unmodified
  // parseEventLocationSnapshot() validator POST /api/plans itself uses. ---
  {
    const parsed = parseAskAuraRequest('Is 10 AM next Friday good for marriage in Chennai?', { now: NOW, timezone: chennai!.timezone });
    check('Parses TIMING_CHECK, marriage, exactTime=10:00, locationQuery=chennai', parsed.intent === 'TIMING_CHECK' && parsed.activityId === 'marriage' && parsed.exactTime === '10:00' && parsed.locationQuery === 'chennai');

    const response = await orchestrateAskAura(parsed, { ...nyDeps, eventLocation: chennai });
    check('Ceremonial exact-clock CHECK with Event Location executes (never a clarification)', response.intent === 'TIMING_CHECK');
    const card = response.cards?.[0] as { requested?: { start?: string; startLabel?: string }; eventLocation?: { cityName?: string; timezone?: string } } | undefined;
    check('Requested instant displays as 10:00 AM Chennai-local -- proves the candidate was computed in Chennai\'s timezone, not the caller\'s own New York Timing Location', card?.requested?.startLabel === '10:00 AM');
    check('Response echoes the resolved Event Location', card?.eventLocation?.cityName === 'Chennai' && card?.eventLocation?.timezone === 'Asia/Kolkata');

    const planAction = response.actions?.find((a) => a.type === 'PLAN_THIS');
    check('PR B: "Plan this" action is RESTORED for a location-aware ceremonial CHECK result', Boolean(planAction));
    check('"Open Muhurtham Finder" remains available (it already supports Event Location natively)', Boolean(response.actions?.some((a) => a.type === 'OPEN_MUHURTHAM')));

    const planPayload = planAction?.planPayload as { plannedStartAt?: string; eventLocation?: { cityName?: string; timezone?: string } } | undefined;
    check('planPayload carries the RESOLVED eventLocation (never re-derived from locationQuery -- brief section 27/28)', planPayload?.eventLocation?.cityName === 'Chennai' && planPayload?.eventLocation?.timezone === 'Asia/Kolkata');
    check('planPayload.plannedStartAt is the SAME absolute instant as the requested candidate -- never reinterpreted (brief section 15)', planPayload?.plannedStartAt === card?.requested?.start);

    // Persistence-survival proof (brief section 29/30): feed the EXACT
    // payload through the real, unmodified request-boundary validator
    // POST /api/plans already uses -- no mock, no re-implementation.
    const snapshot = parseEventLocationSnapshot(planPayload?.eventLocation);
    check('The planPayload.eventLocation is ACCEPTED by parseEventLocationSnapshot (would persist correctly via POST /api/plans, unmodified)', snapshot.ok === true);
    if (snapshot.ok) {
      check('Persisted eventTimezone would be Chennai\'s Asia/Kolkata, never the caller\'s own New York Timing Location', snapshot.eventTimezone === 'Asia/Kolkata');
      check('Persisted eventLocationName would be "Chennai"', snapshot.eventLocationName === 'Chennai');
    }
  }

  // --- PERSONAL scope, location-aware ceremonial CHECK (brief section 21/
  // 23): persistence behavior must be identical to GENERAL -- no
  // scope-specific Event Location logic -- and the owner's own natal
  // profile (personalContext) must never leak into the save payload. ---
  {
    const personalizedNyContext: DailyAssistantContext = { ...nyContext, personalContext: { natalNakshatraIndex: 1, janmaNakshatra: 'Bharani' } };
    const parsed = parseAskAuraRequest('Is 10 AM next Friday good for marriage for me in Chennai?', { now: NOW, timezone: chennai!.timezone });
    check('Parses TIMING_CHECK, marriage, PERSONAL, exactTime=10:00, locationQuery=chennai', parsed.intent === 'TIMING_CHECK' && parsed.activityId === 'marriage' && parsed.scope === 'PERSONAL' && parsed.exactTime === '10:00' && parsed.locationQuery === 'chennai');

    const response = await orchestrateAskAura(parsed, { userId: 'test-user-not-a-real-db-row', context: personalizedNyContext, activeWindow: 'NEUTRAL', eventLocation: chennai });
    const planAction = response.actions?.find((a) => a.type === 'PLAN_THIS');
    check('PERSONAL scope also gets PLAN_THIS restored, identical to GENERAL', Boolean(planAction));
    const planPayload = planAction?.planPayload as { eventLocation?: { cityName?: string; timezone?: string } } | undefined;
    check('PERSONAL scope\'s planPayload carries the same eventLocation snapshot', planPayload?.eventLocation?.cityName === 'Chennai' && planPayload?.eventLocation?.timezone === 'Asia/Kolkata');
    check('Owner natal profile never leaks into the save payload', !JSON.stringify(planPayload ?? {}).includes('Bharani') && !JSON.stringify(planPayload ?? {}).includes('natalNakshatraIndex'));
  }

  // --- Unknown Event Location fails closed (brief section 13/14/32/45):
  // never executes using the caller's own Timing Location as though the
  // stated location had succeeded. Proven via BOTH ceremonial dispatch
  // paths -- the TIMING_FIND->Muhurtham redirect, and the direct
  // MUHURTHAM_SEARCH intent. ---
  {
    const parsed = parseAskAuraRequest('Should I get married in Atlantis next Friday?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Parses TIMING_FIND with an unresolved locationQuery=atlantis', parsed.intent === 'TIMING_FIND' && parsed.locationQuery === 'atlantis');
    const response = await orchestrateAskAura(parsed, deps); // deps.eventLocation intentionally undefined, matching resolveEventLocationQuery('atlantis') === undefined
    check('Unresolved Event Location fails closed to a CLARIFICATION, never a Muhurtham result', response.cards?.[0]?.type === 'CLARIFICATION');
    check('No actions offered, as though nothing executed', !response.actions || response.actions.length === 0);
    check('Clarification message names the unmatched location text', response.message.toLowerCase().includes('atlantis'));
    check('No timing-result fields leaked from a partial execution (no "dates"/"requested" anywhere in the cards)', !JSON.stringify(response.cards ?? []).includes('"dates"') && !JSON.stringify(response.cards ?? []).includes('"requested"'));
  }
  {
    const parsed = parseAskAuraRequest('Find a marriage Muhurtham in Atlantis next Friday.', { now: NOW, timezone: 'Asia/Kolkata' });
    check('Parses MUHURTHAM_SEARCH directly with an unresolved locationQuery=atlantis', parsed.intent === 'MUHURTHAM_SEARCH' && parsed.locationQuery === 'atlantis');
    const response = await orchestrateAskAura(parsed, deps);
    check('Direct MUHURTHAM_SEARCH intent also fails closed on an unresolved Event Location', response.cards?.[0]?.type === 'CLARIFICATION');
  }

  // --- Everyday non-goal (brief section 2/47): even when Event Location
  // resolves successfully AND is explicitly present on deps, a
  // non-Muhurtham-eligible activity's request must NEVER apply it -- the
  // response is proven identical in shape to an ordinary Timing Search
  // FIND, with no trace of the Event Location anywhere. ---
  {
    const parsed = parseAskAuraRequest('Should I meditate in Chennai tomorrow?', { now: NOW, timezone: chennai!.timezone });
    check('Parses TIMING_FIND, meditation, locationQuery=chennai (extracted regardless of activity)', parsed.intent === 'TIMING_FIND' && parsed.activityId === 'meditation' && parsed.locationQuery === 'chennai');

    const response = await orchestrateAskAura(parsed, { ...nyDeps, eventLocation: chennai });
    check('Everyday (non-ceremonial) activity: still an ordinary TIMING_FIND, unaffected by the resolved Event Location', response.intent === 'TIMING_FIND');
    check('No eventLocation field anywhere on the response (everyday results never echo one)', !JSON.stringify(response).includes('eventLocation'));
    // parsed.locationQuery ('chennai') is legitimately carried forward on
    // response.context (brief section 29: forward-compatible echo, same as
    // scope/personNameQuery always are, regardless of whether THIS turn's
    // handler consumed it) -- the actual invariant under test is that
    // Chennai was never APPLIED: it must not appear in the executed
    // result's own cards or message.
    check('Chennai never appears in the executed result itself (cards/message) -- only in the carried-forward parsed context, never applied', !JSON.stringify(response.cards ?? []).toLowerCase().includes('chennai') && !response.message.toLowerCase().includes('chennai'));
  }

  // --- Omitted-location control (brief section 25/46): completely
  // byte-identical to pre-PR-A ceremonial behavior. ---
  {
    const parsed = parseAskAuraRequest('Should I get married next Friday?', { now: NOW, timezone: 'Asia/Kolkata' });
    check('No location phrase -> locationQuery undefined', parsed.locationQuery === undefined);
    const response = await orchestrateAskAura(parsed, deps); // deps.eventLocation is undefined
    check('Executes MUHURTHAM_SEARCH exactly as before this PR, no eventLocation field anywhere', response.intent === 'MUHURTHAM_SEARCH' && !JSON.stringify(response).includes('eventLocation'));
  }

  // --- FIX regression matrix item H (unknown EVERYDAY location, brief
  // section 10): an unresolvable "in X" on a non-ceremonial activity must
  // NEVER trigger the ceremonial fail-closed CLARIFICATION gate --
  // eventLocationGate() is only ever consulted from the three ceremonial
  // dispatch points, so a plain everyday TIMING_FIND must execute
  // normally here, exactly as if "in Atlantis" had never been said. ---
  {
    const parsed = parseAskAuraRequest('Should I meditate in Atlantis tomorrow?', { now: NOW, timezone: 'America/New_York' });
    check('Everyday activity + unresolvable location parses TIMING_FIND, meditation, locationQuery=atlantis (extracted but inert)', parsed.intent === 'TIMING_FIND' && parsed.activityId === 'meditation' && parsed.locationQuery === 'atlantis');
    const response = await orchestrateAskAura(parsed, deps); // deps.eventLocation undefined -- Atlantis was never resolvable anyway
    check('No ceremonial unknown-location CLARIFICATION for an everyday activity -- executes as an ordinary TIMING_FIND', response.intent === 'TIMING_FIND' && response.cards?.[0]?.type !== 'CLARIFICATION');
  }

  console.log(allPassed ? '\nALL ASK AURA ORCHESTRATOR CHECKS PASSED' : '\nSOME ASK AURA ORCHESTRATOR CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
