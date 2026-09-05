/**
 * Live-database test for Ask Aura's SHARED-scope routing (brief section 10/
 * 34): SavedPerson resolution by name, ownership isolation, and the
 * ambiguous-name case. Requires a real, reachable DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/askAuraOrchestratorDb.test.ts
 */
import { createSavedPerson, deleteSavedPerson, upsertUserByEmail } from '../apps/web/lib/db';
import { parseAskAuraRequest } from '../packages/recommendation/src/askAuraIntent';
import { orchestrateAskAura, resolveHorizonToDateRange, resolvePersonByName, AskAuraOrchestratorDeps } from '../apps/web/lib/askAuraOrchestrator';
import { DailyAssistantContext, profileFromActivity } from '../packages/recommendation/src/dailyAssistant';
import { evaluateEverydaySharedCandidate } from '../packages/recommendation/src/everydayTimingFit';
import { nearbyCheckInstants, runTimingSearch } from '../packages/recommendation/src/timingSearch';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { natalContextFromBirthDetails } from '../apps/web/lib/natalContext';
import { localDateTimeToUTC } from '../packages/panchang/src/localDate';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const NOW = new Date('2026-08-23T10:00:00.000Z');

async function main() {
  const owner = await upsertUserByEmail({ email: 'test-ask-aura-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const otherOwner = await upsertUserByEmail({ email: 'test-ask-aura-other-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  const context: DailyAssistantContext = { now: NOW, latitude: owner.latitude, longitude: owner.longitude, timezone: owner.timezone, tzOffsetMinutes: 330 };
  const deps: AskAuraOrchestratorDeps = { userId: owner.id, context, activeWindow: 'NEUTRAL' };

  const created: string[] = [];
  try {
    // ============================================================
    // Ownership isolation (brief section 10/41) -- a person belonging to a
    // DIFFERENT owner must never resolve, and the error must not reveal
    // whether that name exists for someone else.
    // ============================================================
    await createSavedPerson(otherOwner.id, { name: 'Anna', relationshipType: 'PARTNER', birthDate: '1990-05-15', birthTime: '08:30', birthTimezone: 'Asia/Kolkata' });
    const isolationResolution = await resolvePersonByName(owner.id, 'Anna');
    check('A person owned by a DIFFERENT user never resolves for this owner', isolationResolution.status === 'NOT_FOUND');

    // ============================================================
    // NOT_FOUND -- no SavedPerson at all for this owner yet.
    // ============================================================
    const notFoundResolution = await resolvePersonByName(owner.id, 'Nobody');
    check('An unknown name resolves NOT_FOUND', notFoundResolution.status === 'NOT_FOUND');

    // ============================================================
    // Section 34 -- RESOLVED: "Best time for a date with Anna this weekend"
    // end to end, real SavedPerson, real everyday shared timing engine.
    // ============================================================
    const anna = await createSavedPerson(owner.id, { name: 'Anna', relationshipType: 'PARTNER', birthDate: '1990-05-15', birthTime: '08:30', birthTimezone: 'Asia/Kolkata' });
    created.push(anna.id);

    const resolution = await resolvePersonByName(owner.id, 'Anna');
    check('Anna resolves for her real owner', resolution.status === 'RESOLVED' && resolution.person.id === anna.id);

    const parsed = parseAskAuraRequest('Best time for a date with Anna this weekend', { now: NOW });
    check('Parsed as TIMING_FIND / SHARED / Anna', parsed.intent === 'TIMING_FIND' && parsed.scope === 'SHARED' && parsed.personNameQuery?.toLowerCase() === 'anna');

    const response = await orchestrateAskAura(parsed, deps);
    check('SHARED TIMING_FIND response has intent TIMING_FIND', response.intent === 'TIMING_FIND');
    const card = response.cards?.[0] as { scope?: string; personName?: string } | undefined;
    check('Response card is scoped SHARED and carries only the display name, never the SavedPerson id', card?.scope === 'SHARED' && card?.personName === 'Anna');

    // Privacy (brief section 41): never leak birth data, natal data, or
    // ownership fields into the response. The SavedPerson's own id IS
    // expected inside actions[].momentPayload.savedPersonId -- that's the
    // real, necessary reference "Make this a Moment" sends back to the
    // EXISTING AuraMoment creation endpoint (brief section 25); it is not
    // sensitive on its own (never paired with birth/natal data here) and
    // the owner is already looking at their own data.
    const serialized = JSON.stringify(response);
    const forbidden = ['birthDate', 'birthTime', 'birthTimezone', 'natalNakshatraIndex', 'ownerUserId'];
    check('SHARED response never leaks birth/natal/ownership data', forbidden.every((needle) => !serialized.includes(needle)));

    if (response.actions?.some((a) => a.type === 'CREATE_MOMENT')) {
      const momentAction = response.actions.find((a) => a.type === 'CREATE_MOMENT');
      check('CREATE_MOMENT action carries the real savedPersonId for the actual save call (not displayed, just wired for the button)', momentAction?.momentPayload?.savedPersonId === anna.id);
    }

    // ============================================================
    // AMBIGUOUS -- two people with the same name.
    // ============================================================
    const secondAnna = await createSavedPerson(owner.id, { name: 'Anna', relationshipType: 'FRIEND', birthDate: '1992-01-01', birthTime: '10:00', birthTimezone: 'Asia/Kolkata' });
    created.push(secondAnna.id);
    const ambiguousResolution = await resolvePersonByName(owner.id, 'Anna');
    check('Two people named Anna -> AMBIGUOUS, not a silent pick', ambiguousResolution.status === 'AMBIGUOUS' && ambiguousResolution.matches.length === 2);

    const ambiguousParsed = parseAskAuraRequest('Best time for a date with Anna this weekend', { now: NOW });
    const ambiguousAskResponse = await orchestrateAskAura(ambiguousParsed, deps);
    check('Ambiguous name -> a CLARIFICATION card asking who, not a guess', ambiguousAskResponse.cards?.[0]?.type === 'CLARIFICATION');

    // ============================================================
    // Ask Aura Richer SHARED Grammar V1: owner+person pair grammar
    // ("Priya and I" / "I and Priya" / "Priya and me" / "me and Priya")
    // resolved end-to-end through the SAME SavedPerson resolution and
    // canonical engines the existing "with Anna" form already uses -- no
    // duplicated evaluator logic, no new scoring.
    // ============================================================
    const priya = await createSavedPerson(owner.id, { name: 'Priya', relationshipType: 'PARTNER', birthDate: '1991-03-10', birthTime: '06:15', birthTimezone: 'Asia/Kolkata' });
    created.push(priya.id);

    // Section 37 -- SHARED ceremonial CHECK: exact clock + pair grammar,
    // resolvable partner, canonical single-candidate evaluator.
    {
      const parsed = parseAskAuraRequest('Is 10 AM tomorrow good for Priya and me to get married?', { now: NOW, timezone: owner.timezone });
      check('"Is 10 AM tomorrow good for Priya and me to get married?" parses TIMING_CHECK, SHARED, priya, exactTime=10:00, marriage', parsed.intent === 'TIMING_CHECK' && parsed.scope === 'SHARED' && parsed.personNameQuery === 'priya' && parsed.exactTime === '10:00' && parsed.activityId === 'marriage');

      const response = await orchestrateAskAura(parsed, deps);
      check('Response stays TIMING_CHECK (canonical ceremonial evaluator, not a new intent)', response.intent === 'TIMING_CHECK');
      check('Response is CHECK-shaped, never "Best dates for" (single requested candidate, not a full search)', !response.message.includes('Best dates for'));
      const checkCard = response.cards?.[0] as { requested?: { start: string; startLabel: string } } | undefined;
      check('Requested candidate is exactly 10:00 AM local -- the owner+partner personalization path, same evaluateMuhurthamCandidateAt() the existing SHARED ceremonial CHECK already uses', checkCard?.requested?.startLabel === '10:00 AM');
    }

    // Section 38 -- SHARED Muhurtham FIND: "best wedding date" + pair
    // grammar + "next month" -- parser labels this TIMING_FIND (the SAME
    // shape the pre-existing "with Priya next month" form already
    // produces, since a resolved horizon+person hits step 6's precedence
    // before the bare-best-date step 8b guard is ever reached), and the
    // orchestrator's existing capability redirect + SHARED dispatch routes
    // it through the canonical SHARED Muhurtham search, never GENERAL.
    {
      const parsed = parseAskAuraRequest('Find the best wedding date for Priya and me next month.', { now: NOW, timezone: owner.timezone });
      check('"Find the best wedding date for Priya and me next month." parses TIMING_FIND, SHARED, priya, marriage', parsed.intent === 'TIMING_FIND' && parsed.scope === 'SHARED' && parsed.personNameQuery === 'priya' && parsed.activityId === 'marriage');

      const response = await orchestrateAskAura(parsed, deps);
      check('Executes through the canonical SHARED Muhurtham search (MUHURTHAM_SEARCH), never GENERAL', response.intent === 'MUHURTHAM_SEARCH');
      const findCard = response.cards?.[0] as { scope?: string; personName?: string } | undefined;
      check('Response card is scoped SHARED and carries Priya\'s display name', findCard?.scope === 'SHARED' && findCard?.personName === 'Priya');
    }

    // Section 39 -- GENERAL control: the exact same "best wedding date...
    // next month" phrasing WITHOUT pair grammar must stay GENERAL, proving
    // the SHARED routing above is driven by the parsed scope, not merely
    // by the activity or phrasing.
    {
      const parsed = parseAskAuraRequest('Find the best wedding date next month.', { now: NOW, timezone: owner.timezone });
      check('"Find the best wedding date next month." (no pair grammar) parses scope=GENERAL', parsed.scope === 'GENERAL');
      const response = await orchestrateAskAura(parsed, deps);
      const generalCard = response.cards?.[0] as { scope?: string } | undefined;
      check('Executes as GENERAL (or at least never scoped SHARED)', generalCard?.scope !== 'SHARED');
    }

    // Section 36 -- pair grammar + AMBIGUOUS SavedPerson -> clarification,
    // never a silent GENERAL or PERSONAL fallback (brief section 16/17).
    // Reuses the two Annas already created above.
    {
      const parsed = parseAskAuraRequest('Is 10 AM tomorrow good for Anna and me to get married?', { now: NOW, timezone: owner.timezone });
      check('"...for Anna and me..." parses SHARED, personNameQuery=anna', parsed.scope === 'SHARED' && parsed.personNameQuery === 'anna');
      const response = await orchestrateAskAura(parsed, deps);
      check('Ambiguous "Anna" -> CLARIFICATION, never a silent GENERAL/PERSONAL timing result', response.cards?.[0]?.type === 'CLARIFICATION');
      check('Response intent stays TIMING_CHECK (a clarification WITHIN the intent, never UNKNOWN, never a fabricated GENERAL result)', response.intent === 'TIMING_CHECK');
    }

    // Section 36 -- pair grammar + NOT_FOUND SavedPerson -> clarification,
    // never a silent GENERAL/PERSONAL fallback.
    {
      const parsed = parseAskAuraRequest('When should Nobody and I get married?', { now: NOW, timezone: owner.timezone });
      check('"When should Nobody and I get married?" parses SHARED, personNameQuery=nobody', parsed.scope === 'SHARED' && parsed.personNameQuery === 'nobody');
      const response = await orchestrateAskAura(parsed, deps);
      check('Unknown name "Nobody" -> a clarification message, never a silent GENERAL Muhurtham search', response.message.toLowerCase().includes("couldn't find"));
      check('Never silently executes as GENERAL (no OPEN_MUHURTHAM/dates card for an unresolved partner)', response.intent !== 'MUHURTHAM_SEARCH' || !('dates' in (response.cards?.[0] ?? {})));
    }

    // ============================================================
    // Ask Aura Scope-Aware Everyday TIMING_CHECK V1: everyday (non-
    // ceremonial) SHARED TIMING_CHECK, end to end with the real Priya
    // fixture created above.
    // ============================================================
    // The EXACT instant "Is 10 AM tomorrow good for ... to meditate?"
    // resolves to -- computed the SAME way resolveTimingCheckCandidateStart
    // itself does (resolveHorizonToDateRange for the local date, then
    // localDateTimeToUTC for the exact clock time), so the betterNearby
    // reproduction below evaluates the identical instant the real handler
    // does, not an approximation.
    const everydayTomorrow = resolveHorizonToDateRange('TOMORROW', undefined, context).start;
    const everydayCandidateStart = localDateTimeToUTC(everydayTomorrow, '10:00', owner.timezone);

    // RESOLVED -- genuine two-person blend, exact requested instant
    // preserved, distinct SHARED wording, no GENERAL/PERSONAL fallback.
    {
      const parsed = parseAskAuraRequest('Is 10 AM tomorrow good for Priya and me to meditate?', { now: NOW, timezone: owner.timezone });
      check('"...Priya and me to meditate?" parses TIMING_CHECK, SHARED, priya, exactTime=10:00, meditation', parsed.intent === 'TIMING_CHECK' && parsed.scope === 'SHARED' && parsed.personNameQuery === 'priya' && parsed.exactTime === '10:00' && parsed.activityId === 'meditation');

      const response = await orchestrateAskAura(parsed, deps);
      check('Response stays TIMING_CHECK', response.intent === 'TIMING_CHECK');
      const card = response.cards?.[0] as { scope?: string; personName?: string; requested?: { start: string; startLabel: string; score: number } } | undefined;
      check('Response card is scoped SHARED and carries Priya\'s display name', card?.scope === 'SHARED' && card?.personName === 'Priya');
      check('Requested candidate\'s LOCAL display time is exactly 10:00 AM -- the exact requested instant, never moved', card?.requested?.startLabel === '10:00 AM');
      check('Response uses distinct SHARED wording ("...for both of you"), never GENERAL\'s "You can."/"I\'d hold off for now."', response.message.includes('both of you'));
      check('Response never claims relationship compatibility -- no "compatible"/"relationship"/"auspicious" wording', !/compatible|relationship|auspicious/i.test(response.message));

      // Deterministic divergence proof: this file's own `deps`/`context`
      // carries NO owner personalContext (matching its existing
      // convention throughout this file), so the owner's own delta from
      // the general baseline is EXACTLY 0 -- meaning sharedScore
      // necessarily differs from the plain GENERAL score whenever Priya's
      // real (complete) natal data contributes ANY non-neutral personal
      // signal, which it deterministically does (her personalPatternScore
      // can never equal exactly the neutral-context default of 65). No
      // coincidental match is possible here, unlike an arbitrary owner
      // fixture would risk.
      const generalParsed = parseAskAuraRequest('Is 10 AM tomorrow good for meditation?', { now: NOW, timezone: owner.timezone });
      const generalResponse = await orchestrateAskAura(generalParsed, deps);
      const generalCard = generalResponse.cards?.[0] as { requested?: { score: number } } | undefined;
      check('SHARED score genuinely differs from the plain GENERAL score for the identical instant (a real two-person blend, not owner-only)', card?.requested?.score !== generalCard?.requested?.score);
    }

    // AMBIGUOUS -- everyday SHARED CHECK, reusing the two Annas created
    // above; must clarify, never silently evaluate GENERAL/PERSONAL.
    {
      const parsed = parseAskAuraRequest('Is 10 AM tomorrow good for Anna and me to meditate?', { now: NOW, timezone: owner.timezone });
      check('"...Anna and me to meditate?" parses SHARED, personNameQuery=anna', parsed.scope === 'SHARED' && parsed.personNameQuery === 'anna');
      const response = await orchestrateAskAura(parsed, deps);
      check('Ambiguous "Anna" -> CLARIFICATION, never a silent timing evaluation', response.cards?.[0]?.type === 'CLARIFICATION');
      check('No requested-candidate card for an ambiguous partner', !('requested' in (response.cards?.[0] ?? {})));
    }

    // NOT_FOUND -- everyday SHARED CHECK.
    {
      const parsed = parseAskAuraRequest('Is 10 AM tomorrow good for Nobody and me to meditate?', { now: NOW, timezone: owner.timezone });
      check('"...Nobody and me to meditate?" parses SHARED, personNameQuery=nobody', parsed.scope === 'SHARED' && parsed.personNameQuery === 'nobody');
      const response = await orchestrateAskAura(parsed, deps);
      check('Unknown name "Nobody" -> a not-found clarification message', response.message.toLowerCase().includes("couldn't find"));
      check('No requested-candidate card for an unresolved partner', !('requested' in (response.cards?.[0] ?? {})));
    }

    // Dating regression -- a non-Muhurtham activity's SHARED CHECK must
    // route through the everyday shared path (never marriage collision),
    // and genuinely execute (not a clarification, since Priya resolves).
    {
      const parsed = parseAskAuraRequest('Is 7 PM next Friday good for Priya and me to go on a date?', { now: NOW, timezone: owner.timezone });
      check('Dating + pair grammar parses activityId=dating, SHARED, priya', parsed.activityId === 'dating' && parsed.scope === 'SHARED' && parsed.personNameQuery === 'priya');
      const response = await orchestrateAskAura(parsed, deps);
      check('Executes as a genuine SHARED CHECK (not a clarification -- Priya resolves cleanly)', response.intent === 'TIMING_CHECK' && response.cards?.[0]?.type === 'TIMING_RESULT');
      const card = response.cards?.[0] as { scope?: string; personName?: string } | undefined;
      check('Response card is scoped SHARED for dating, proving no marriage collision', card?.scope === 'SHARED' && card?.personName === 'Priya');
    }

    // Incomplete partner profile: NOTE -- the SavedPerson DB schema
    // (SavedPerson.birthDate/birthTime/birthTimezone are all NOT NULL
    // columns, confirmed in apps/web/lib/db.ts's own SavedPerson/
    // SavedPersonInput types) makes a genuinely incomplete SavedPerson
    // impossible to construct via createSavedPerson -- there is no
    // reachable "SavedPerson exists but birthTime is missing" state in
    // this data model, unlike the OWNER's own User.birthDate/birthTime/
    // birthTimezone, which CAN be null (buildPersonalMuhurtaContextForUser
    // already guards exactly that case). The equivalent code path this
    // brief cares about -- a missing/incomplete PersonalMuhurtaContext
    // producing evaluatePersonalMuhurtaFit's neutral default (65) rather
    // than a hard error -- is already proven directly at the domain level
    // in test/everydayTimingFit.test.ts ("A partner/user with no natal
    // data still returns OK"), which passes `partnerContext: {}` straight
    // into evaluateEverydaySharedCandidate/findEverydaySharedTiming
    // without going through a SavedPerson at all. No new DB-level test is
    // added here since the DB layer cannot represent this state.

    // Section 34 -- betterNearby SHARED comparison: prove the winner is
    // chosen by SHARED score, not the owner-only score, by independently
    // reproducing the EXACT SAME per-candidate methodology and nearby-scan
    // range/step (via the same exported primitives the real handler uses)
    // and asserting the orchestrator's own betterNearby (if any) matches.
    {
      const durationMinutes = 30;
      const candidateStart = everydayCandidateStart.toISOString();
      const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === 'meditation')!;
      const profile = profileFromActivity(activity);
      const generalContext: DailyAssistantContext = { ...context, personalContext: undefined };
      const partnerContext = natalContextFromBirthDetails('1991-03-10', '06:15', 'Asia/Kolkata');

      const evaluateSharedAt = (iso: string) => {
        const generalResult = runTimingSearch({ mode: 'CHECK', activityId: 'meditation', durationMinutes, candidateStart: iso, context: generalContext });
        return evaluateEverydaySharedCandidate({ profile, generalCandidate: generalResult.requestedCandidate!, durationMinutes, context, partnerContext });
      };
      const requestedShared = evaluateSharedAt(candidateStart);
      let expectedBest: ReturnType<typeof evaluateSharedAt> | undefined;
      for (const iso of nearbyCheckInstants(candidateStart, durationMinutes, context)) {
        const candidate = evaluateSharedAt(iso);
        if (!expectedBest || candidate.sharedScore > expectedBest.sharedScore) expectedBest = candidate;
      }
      const expectBetterNearby = Boolean(expectedBest) && expectedBest!.sharedScore >= requestedShared.sharedScore + 0.5;

      const parsed = parseAskAuraRequest('Is 10 AM tomorrow good for Priya and me to meditate?', { now: NOW, timezone: owner.timezone });
      const response = await orchestrateAskAura(parsed, deps);
      const card = response.cards?.[0] as { betterNearby?: { score: number } } | undefined;
      if (expectBetterNearby) {
        check('betterNearby appears when an independently-reproduced SHARED-score comparison also finds a strictly-better nearby candidate', Boolean(card?.betterNearby));
        check('betterNearby score matches the independently-reproduced best SHARED score exactly (proves the comparison uses the blended shared score, not an owner-only score)', card?.betterNearby?.score === expectedBest!.sharedScore);
      } else {
        check('No betterNearby when the independently-reproduced SHARED comparison also finds none', !card?.betterNearby);
      }
    }

    // ============================================================
    // Ask Aura Date-Only CHECK Semantics V1: SHARED date-only CHECK-verb
    // phrasing (no exact clock) now correctly reaches genuine SHARED FIND
    // (findEverydaySharedTiming, owner+Priya blend) rather than a
    // fabricated-instant SHARED CHECK -- proving this fix composes
    // correctly with the real SavedPerson resolution PR #69 established.
    // ============================================================
    {
      const parsed = parseAskAuraRequest('Should Priya and me meditate tomorrow?', { now: NOW, timezone: owner.timezone });
      check('"Should Priya and me meditate tomorrow?" -> TIMING_FIND, SHARED, priya, no exactTime', parsed.intent === 'TIMING_FIND' && parsed.scope === 'SHARED' && parsed.personNameQuery === 'priya' && parsed.exactTime === undefined);
      const response = await orchestrateAskAura(parsed, deps);
      check('Executes through the canonical SHARED everyday FIND (findEverydaySharedTiming), never a fabricated single instant', response.intent === 'TIMING_FIND');
      const card = response.cards?.[0] as { scope?: string; personName?: string } | undefined;
      check('Response card is scoped SHARED and carries Priya\'s display name (real two-person blend, not a fabricated-instant CHECK)', card?.scope === 'SHARED' && card?.personName === 'Priya');
    }
    // The exact-clock SHARED form remains completely unaffected (PR #69).
    {
      const parsed = parseAskAuraRequest('Should Priya and me meditate at 10 AM tomorrow?', { now: NOW, timezone: owner.timezone });
      check('"Should Priya and me meditate at 10 AM tomorrow?" -> TIMING_CHECK, SHARED, priya, exactTime=10:00, unaffected', parsed.intent === 'TIMING_CHECK' && parsed.scope === 'SHARED' && parsed.personNameQuery === 'priya' && parsed.exactTime === '10:00');
      const response = await orchestrateAskAura(parsed, deps);
      check('Executes through the Scope-Aware Everyday TIMING_CHECK path (PR #69), never rerouted to FIND', response.intent === 'TIMING_CHECK');
    }
  } finally {
    for (const id of created) {
      await deleteSavedPerson(owner.id, id).catch(() => {});
    }
  }

  console.log(allPassed ? '\nALL ASK AURA ORCHESTRATOR DB CHECKS PASSED' : '\nSOME ASK AURA ORCHESTRATOR DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
