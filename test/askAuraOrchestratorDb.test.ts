/**
 * Live-database test for Ask Aura's SHARED-scope routing (brief section 10/
 * 34): SavedPerson resolution by name, ownership isolation, and the
 * ambiguous-name case. Requires a real, reachable DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/askAuraOrchestratorDb.test.ts
 */
import { createSavedPerson, deleteSavedPerson, upsertUserByEmail } from '../apps/web/lib/db';
import { parseAskAuraRequest } from '../packages/recommendation/src/askAuraIntent';
import { orchestrateAskAura, resolvePersonByName, AskAuraOrchestratorDeps } from '../apps/web/lib/askAuraOrchestrator';
import { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

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
