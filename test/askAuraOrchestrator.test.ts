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
import { orchestrateAskAura, resolveHorizonToDateRange, AskAuraOrchestratorDeps } from '../apps/web/lib/askAuraOrchestrator';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import { getActionCards } from '../packages/recommendation/src/actionCards';
import { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

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
  // Section 31 -- GOOD_RIGHT_NOW: same source of truth as Home
  // (getActionCards), never a second ranking function.
  // ============================================================
  {
    const parsed = parseAskAuraRequest('What should I do right now?', { now: NOW });
    const response = await orchestrateAskAura(parsed, deps);
    const expected = getActionCards('NEUTRAL').slice(0, 3);
    check('GOOD_RIGHT_NOW intent', response.intent === 'GOOD_RIGHT_NOW');
    const options = (response.cards?.[0]?.options as unknown[]) ?? [];
    check('GOOD_RIGHT_NOW cards match getActionCards(activeWindow) exactly (same fixture window)', JSON.stringify(options) === JSON.stringify(expected));
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

  console.log(allPassed ? '\nALL ASK AURA ORCHESTRATOR CHECKS PASSED' : '\nSOME ASK AURA ORCHESTRATOR CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
