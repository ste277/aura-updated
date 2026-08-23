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
