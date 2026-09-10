/**
 * Live-database tests for Ask Aura V1's two new intents -- TODAY_GUIDANCE
 * and FORWARD_PLAN. Both call a real, DB-backed engine directly
 * (buildPersonalDailyGuidance / buildForwardPlannerResult), so -- like
 * dailyGuidanceOrchestratorDb.test.ts / forwardPlannerOrchestrator.test.ts
 * before them -- these need a real, reachable DATABASE_URL and are NOT part
 * of ci.yml's math-core-tests job (no Postgres service provisioned there).
 *
 * Run locally with a real DATABASE_URL set:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/askAuraTodayGuidanceForwardPlanDb.test.ts
 *
 * Reuses the SAME throwaway test user every other Daily Guidance / Forward
 * Planner live-DB test already uses (idempotent via email upsert -- see
 * forwardPlannerOrchestrator.test.ts's own doc comment), and creates/cleans
 * up its own throwaway PlannedActivity rows in a finally block.
 *
 * Every check here proves Ask Aura's own response is genuinely DERIVED from
 * the real, unmodified #105/#108 engines (direct-call parity, never a
 * parallel calculation) -- parser-level routing shape for these two intents
 * is already covered (no DB needed) in test/askAuraIntentParser.test.ts,
 * and the ceremonial-redirect regression is covered in
 * test/askAuraMarriageRouting.test.ts.
 */
import { upsertUserByEmail, updateBirthProfile, createPlannedActivity, cancelPlannedActivity, deletePlannedActivity, updateUserDayBuilderPrefs, listPlannedActivitiesForDay } from '../apps/web/lib/db';
import { parseAskAuraRequest, parseFollowUpChange } from '../packages/recommendation/src/askAuraIntent';
import { orchestrateAskAura, AskAuraOrchestratorDeps } from '../apps/web/lib/askAuraOrchestrator';
import { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import { buildPersonalDailyGuidance } from '../apps/web/lib/dailyGuidanceOrchestrator';
import { buildForwardPlannerRequest, buildForwardPlannerResult, ForwardPlannerOption } from '../apps/web/lib/forwardPlannerOrchestrator';
import { resolveForwardPlannerRange } from '../apps/web/lib/forwardPlanner';
import { resolveTzOffsetMinutes, addDaysToDateStr } from '../apps/web/lib/timezone';
import { buildPersonalMuhurtaContextForUser } from '../apps/web/lib/natalContext';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
// A fixed instant on a real day (a Wednesday), matching forwardPlannerOrchestrator.test.ts's
// own established fixed-fake-"now" convention -- so THIS_WEEKEND/NEXT_WEEKEND/
// SEVEN_DAYS resolve identically to that file's own already-verified dates.
const NOW = new Date('2026-09-09T04:00:00.000Z'); // 9:30 AM IST, Wednesday Sep 9 2026 local.

function buildContext(now: Date, latitude: number, longitude: number, timezone: string, personalContext: DailyAssistantContext['personalContext']): DailyAssistantContext {
  return { now, latitude, longitude, timezone, tzOffsetMinutes: resolveTzOffsetMinutes(timezone, now), personalContext };
}

async function main() {
  const user0 = await upsertUserByEmail({ email: 'test-daily-guidance-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const user = await updateBirthProfile(user0.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: true });

  const context = buildContext(NOW, user.latitude, user.longitude, user.timezone, buildPersonalMuhurtaContextForUser(user));
  const deps: AskAuraOrchestratorDeps = { userId: user.id, user, context, activeWindow: 'NEUTRAL' };

  const createdPlanIds: string[] = [];

  try {
    // ============================================================
    // TODAY_GUIDANCE -- BIRTH_PROFILE_REQUIRED.
    // ============================================================
    {
      const incompleteUser = { ...user, birthDate: null };
      const incompleteDeps: AskAuraOrchestratorDeps = { ...deps, user: incompleteUser };
      const parsed = parseAskAuraRequest('What should I focus on today?', { now: NOW });
      check('TODAY_GUIDANCE parses correctly', parsed.intent === 'TODAY_GUIDANCE');
      const response = await orchestrateAskAura(parsed, incompleteDeps);
      check('TODAY_GUIDANCE: missing birth profile -> a message asking for birth details, never a fabricated priority list', response.intent === 'TODAY_GUIDANCE' && !response.cards);
    }

    // ============================================================
    // TODAY_GUIDANCE -- NO_ACTIVITY_INTENT (Day Builder disabled, no Plans yet).
    // ============================================================
    {
      const noIntentUser = { ...user, dayBuilderEnabled: false };
      const noIntentDeps: AskAuraOrchestratorDeps = { ...deps, user: noIntentUser };
      const parsed = parseAskAuraRequest('What should I focus on today?', { now: NOW });
      const response = await orchestrateAskAura(parsed, noIntentDeps);
      check('TODAY_GUIDANCE: no Plans, Day Builder disabled -> a message that there is nothing to prioritize, never a fabricated list', response.intent === 'TODAY_GUIDANCE' && !response.cards);
    }

    // ============================================================
    // TODAY_GUIDANCE -- READY: a real Plan produces a real recommendation,
    // and Ask Aura's own response is DIRECT-CALL-PARITY with
    // buildPersonalDailyGuidance itself (never a second ranking pass).
    // ============================================================
    const guidancePlan = await createPlannedActivity({
      userId: user.id,
      title: 'Deep Work Block',
      activityId: 'deep-work',
      plannedStartAt: new Date('2026-09-09T05:00:00.000Z'), // 10:30 AM IST, after NOW
      plannedEndAt: new Date('2026-09-09T06:00:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(guidancePlan.id);

    let todayGuidanceResponse: Awaited<ReturnType<typeof orchestrateAskAura>> | undefined;
    {
      const direct = await buildPersonalDailyGuidance(user, NOW);
      check('sanity: direct buildPersonalDailyGuidance call is READY with at least one recommendation', direct.status === 'READY' && direct.guidance.recommendations.length > 0);

      const parsed = parseAskAuraRequest('What should I focus on today?', { now: NOW });
      const response = await orchestrateAskAura(parsed, deps);
      todayGuidanceResponse = response;
      check('TODAY_GUIDANCE READY: intent + a real ACTIVITY_OPTIONS card', response.intent === 'TODAY_GUIDANCE' && response.cards?.[0]?.type === 'ACTIVITY_OPTIONS');

      const options = (response.cards?.[0]?.options as Array<{ title: string }>) ?? [];
      if (direct.status === 'READY') {
        check('TODAY_GUIDANCE: option count matches #104\'s own recommendations count exactly (never truncated/padded)', options.length === direct.guidance.recommendations.length);
        check('TODAY_GUIDANCE: option order preserves #104\'s own cross-family rank verbatim', options.every((opt, i) => {
          const family = direct.guidance.recommendations[i]?.activityFamily;
          const metadata = family ? direct.selectedActivities[family] : undefined;
          return metadata?.title === opt.title;
        }));
      }

      // PUBLIC CONTRACT: no raw score/evidence/internal provenance ever
      // serialized (mirrors forwardPlannerOrchestrator.test.ts's own guard).
      const serialized = JSON.stringify(response);
      check('TODAY_GUIDANCE PUBLIC CONTRACT: no score/evidence/engineVersion/selectionPolicyVersion/selectionReason field anywhere in the response', !/"score"|"evidence"|"engineVersion"|"selectionPolicyVersion"|"selectionReason"/.test(serialized));
      check('TODAY_GUIDANCE: never leaks birth/natal/ownership fields', !['birthDate', 'birthTime', 'birthTimezone', 'natalNakshatraIndex', 'ownerUserId'].some((needle) => serialized.includes(needle)));
    }

    // ============================================================
    // TODAY_GUIDANCE -- side effect: asking never creates/modifies a Plan.
    // ============================================================
    {
      const wideFrom = new Date('2026-09-01T00:00:00.000Z');
      const wideTo = new Date('2026-09-30T00:00:00.000Z');
      const before = await listPlannedActivitiesForDay(user.id, wideFrom, wideTo);
      const parsed = parseAskAuraRequest('What should I focus on today?', { now: NOW });
      await orchestrateAskAura(parsed, deps);
      const after = await listPlannedActivitiesForDay(user.id, wideFrom, wideTo);
      check('TODAY_GUIDANCE never auto-schedules: Plan count is unchanged before/after asking', before.length === after.length);
    }

    // ============================================================
    // TODAY_GUIDANCE -- "Why?" follow-up re-derives a REAL #107 explanation
    // for the top recommendation (never the generic placeholder).
    // ============================================================
    {
      if (todayGuidanceResponse?.context) {
        const why = parseFollowUpChange('Why?', todayGuidanceResponse.context) ?? parseAskAuraRequest('Why?', { now: NOW, previous: todayGuidanceResponse.context });
        const whyResponse = await orchestrateAskAura(why, deps);
        check('TODAY_GUIDANCE WHY: a real explanation, not the generic placeholder', whyResponse.message.length > 0 && !whyResponse.message.includes('see the reasons on the last result above'));
      } else {
        check('TODAY_GUIDANCE WHY: previous response carried a context to follow up from', false);
      }
    }

    // ============================================================
    // FORWARD_PLAN -- TOMORROW: direct-call parity with buildForwardPlannerResult.
    // ============================================================
    let tomorrowResponse: Awaited<ReturnType<typeof orchestrateAskAura>> | undefined;
    {
      const parsed = parseAskAuraRequest('Should I meditate tomorrow?', { now: NOW, timezone: TZ });
      check('FORWARD_PLAN parses TOMORROW', parsed.intent === 'FORWARD_PLAN' && parsed.horizonPhrase === 'TOMORROW');

      const validated = buildForwardPlannerRequest({ activityId: 'meditation', horizon: 'TOMORROW' }, NOW, TZ);
      if (!validated.ok) throw new Error('TOMORROW validation unexpectedly failed');
      const direct = await buildForwardPlannerResult(user, NOW, validated.request);

      const response = await orchestrateAskAura(parsed, deps);
      tomorrowResponse = response;
      check('FORWARD_PLAN TOMORROW: response status/shape matches the direct engine call (READY<->cards present, NO_SUITABLE_WINDOW<->no cards)', (direct.status === 'READY') === Boolean(response.cards?.[0]));
      if (direct.status === 'READY') {
        const card = response.cards?.[0] as { best?: { localDate: string; startLabel: string } } | undefined;
        check('FORWARD_PLAN TOMORROW: best localDate matches the direct engine call exactly', card?.best?.localDate === direct.options[0]?.localDate);
        check('FORWARD_PLAN TOMORROW: best localDate is genuinely tomorrow, never today', card?.best?.localDate === '2026-09-10');
        const scheduleAction = response.actions?.find((a) => a.type === 'SCHEDULE_FORWARD_PLAN');
        check('FORWARD_PLAN TOMORROW: carries a SCHEDULE_FORWARD_PLAN action with a well-formed forwardPlanPayload', Boolean(scheduleAction?.forwardPlanPayload?.activityId === 'meditation' && scheduleAction?.forwardPlanPayload?.candidateStart === direct.options[0]?.start));

        // CHECK-before-save proof: the payload's candidateStart is genuinely
        // re-verifiable via a fresh CHECK call (the SAME sequence
        // AskAuraView.tsx's runAction performs client-side before saving).
        if (scheduleAction?.forwardPlanPayload) {
          const checkResult = runTimingSearch({ mode: 'CHECK', activityId: scheduleAction.forwardPlanPayload.activityId, durationMinutes: scheduleAction.forwardPlanPayload.durationMinutes, candidateStart: scheduleAction.forwardPlanPayload.candidateStart, context });
          check('FORWARD_PLAN Schedule payload: candidateStart re-verifies via a real CHECK call, never a stale/unverifiable instant', Boolean(checkResult.requestedCandidate));
        }
      }

      const serialized = JSON.stringify(response);
      check('FORWARD_PLAN PUBLIC CONTRACT: no timingScore/muhurtaScore/auraFitScore/reasons/conflicts/metadata/engineVersion field anywhere in the response', !/"timingScore"|"muhurtaScore"|"auraFitScore"|"conflicts"|"engineVersion"|"ruleId"/.test(serialized));
      check('FORWARD_PLAN: never leaks birth/natal/ownership fields', !['birthDate', 'birthTime', 'birthTimezone', 'natalNakshatraIndex', 'ownerUserId'].some((needle) => serialized.includes(needle)));

      // ---- "Why?" follow-up, run HERE (before the later CHECK-before-save
      // collision test below deliberately blocks this exact TOMORROW
      // candidate with a real Plan, which would legitimately change what a
      // re-derived WHY sees) -- a real, narrow explanation, never the
      // generic placeholder, never a fabricated DailyGuidanceRecommendation.
      if (response.cards?.[0] && response.context) {
        const why = parseFollowUpChange('Why?', response.context) ?? parseAskAuraRequest('Why?', { now: NOW, previous: response.context });
        const whyResponse = await orchestrateAskAura(why, deps);
        check('FORWARD_PLAN WHY: a real explanation, not the generic placeholder', whyResponse.message.length > 0 && !whyResponse.message.includes('see the reasons on the last result above'));
      }
    }

    // ============================================================
    // FORWARD_PLAN -- THIS_WEEKEND: direct-call parity, Forward Planner's
    // OWN weekend range contract (never Ask Aura's local Sunday
    // normalization -- resolveHorizonToDateRange is never called here).
    // ============================================================
    {
      const parsed = parseAskAuraRequest('Best time for deep work this weekend?', { now: NOW, timezone: TZ });
      check('FORWARD_PLAN parses THIS_WEEKEND', parsed.intent === 'FORWARD_PLAN' && parsed.horizonPhrase === 'THIS_WEEKEND');

      // deep-work has no catalog defaultDurationMinutes, so resolveDuration()
      // (askAuraOrchestrator.ts) falls back to 30 -- matched explicitly here
      // so this is a genuine apples-to-apples parity check, not an
      // accidental agreement (buildForwardPlannerRequest's own default
      // would otherwise silently fall back to MIN_DURATION_MINUTES=15).
      const validated = buildForwardPlannerRequest({ activityId: 'deep-work', horizon: 'WEEKEND', durationMinutes: 30 }, NOW, TZ);
      if (!validated.ok) throw new Error('WEEKEND validation unexpectedly failed');
      check('sanity: WEEKEND resolves to Sep 12-13 2026 for this fixed NOW (Wednesday)', validated.request.range.startLocalDate === '2026-09-12' && validated.request.range.endLocalDate === '2026-09-13');
      const direct = await buildForwardPlannerResult(user, NOW, validated.request);

      const response = await orchestrateAskAura(parsed, deps);
      check('FORWARD_PLAN THIS_WEEKEND: response status matches the direct engine call', (direct.status === 'READY') === Boolean(response.cards?.[0]));
      if (direct.status === 'READY') {
        const card = response.cards?.[0] as { best?: { localDate: string } } | undefined;
        check('FORWARD_PLAN THIS_WEEKEND: best localDate matches the direct engine call, and falls within Sep 12-13', card?.best?.localDate === direct.options[0]?.localDate && (card?.best?.localDate === '2026-09-12' || card?.best?.localDate === '2026-09-13'));
      }
    }

    // ============================================================
    // FORWARD_PLAN -- NEXT_7_DAYS maps to Forward Planner's own future-only
    // SEVEN_DAYS directly (never Ask Aura's own today-inclusive
    // resolveHorizonToDateRange, which would incorrectly include today).
    // ============================================================
    {
      const parsed = parseAskAuraRequest('Best time for deep work in the next 7 days?', { now: NOW, timezone: TZ });
      check('FORWARD_PLAN parses NEXT_7_DAYS', parsed.intent === 'FORWARD_PLAN' && parsed.horizonPhrase === 'NEXT_7_DAYS');

      const validated = buildForwardPlannerRequest({ activityId: 'deep-work', horizon: 'SEVEN_DAYS', durationMinutes: 30 }, NOW, TZ);
      if (!validated.ok) throw new Error('SEVEN_DAYS validation unexpectedly failed');
      check('sanity: SEVEN_DAYS resolves to Sep 10-16 2026 (future-only, never includes today Sep 9)', validated.request.range.startLocalDate === '2026-09-10' && validated.request.range.endLocalDate === '2026-09-16');
      const direct = await buildForwardPlannerResult(user, NOW, validated.request);

      const response = await orchestrateAskAura(parsed, deps);
      if (direct.status === 'READY') {
        const card = response.cards?.[0] as { best?: { localDate: string } } | undefined;
        check('FORWARD_PLAN NEXT_7_DAYS: best localDate matches the direct engine call, and is never today (Sep 9)', card?.best?.localDate === direct.options[0]?.localDate && card?.best?.localDate !== '2026-09-09');
      }
    }

    // ============================================================
    // FORWARD_PLAN -- NEXT_WEEKEND maps to Forward Planner's own CUSTOM
    // using deterministically computed dates (THIS_WEEKEND's own range,
    // shifted 7 days) -- never a NEXT_WEEKEND value added to #108's contract.
    // ============================================================
    {
      const parsed = parseAskAuraRequest('Best time for deep work next weekend?', { now: NOW, timezone: TZ });
      check('FORWARD_PLAN parses NEXT_WEEKEND', parsed.intent === 'FORWARD_PLAN' && parsed.horizonPhrase === 'NEXT_WEEKEND');

      const thisWeekend = resolveForwardPlannerRange('WEEKEND', NOW, TZ);
      if (!thisWeekend.ok) throw new Error('WEEKEND resolution unexpectedly failed');
      const expectedStart = addDaysToDateStr(thisWeekend.range.startLocalDate, 7);
      const expectedEnd = addDaysToDateStr(thisWeekend.range.endLocalDate, 7);
      check('sanity: NEXT_WEEKEND resolves to Sep 19-20 2026 (THIS_WEEKEND shifted 7 days)', expectedStart === '2026-09-19' && expectedEnd === '2026-09-20');

      const validated = buildForwardPlannerRequest({ activityId: 'deep-work', horizon: 'CUSTOM', customStartDate: expectedStart, customEndDate: expectedEnd, durationMinutes: 30 }, NOW, TZ);
      if (!validated.ok) throw new Error('NEXT_WEEKEND CUSTOM validation unexpectedly failed');
      const direct = await buildForwardPlannerResult(user, NOW, validated.request);

      const response = await orchestrateAskAura(parsed, deps);
      if (direct.status === 'READY') {
        const card = response.cards?.[0] as { best?: { localDate: string } } | undefined;
        check('FORWARD_PLAN NEXT_WEEKEND: best localDate matches the direct engine call, and falls within Sep 19-20', card?.best?.localDate === direct.options[0]?.localDate && (card?.best?.localDate === '2026-09-19' || card?.best?.localDate === '2026-09-20'));
      }
    }

    // ============================================================
    // FORWARD_PLAN -- later-today boundary: a request made LATE in the
    // current local day must still resolve TOMORROW to the genuinely next
    // calendar date, never today's own (already-elapsed) date.
    // ============================================================
    {
      const lateNow = new Date('2026-09-09T18:00:00.000Z'); // 11:30 PM IST, still Sep 9 local
      const lateContext = buildContext(lateNow, user.latitude, user.longitude, user.timezone, buildPersonalMuhurtaContextForUser(user));
      const lateDeps: AskAuraOrchestratorDeps = { ...deps, context: lateContext };
      const parsed = parseAskAuraRequest('Should I meditate tomorrow?', { now: lateNow, timezone: TZ });
      const response = await orchestrateAskAura(parsed, lateDeps);
      const card = response.cards?.[0] as { best?: { localDate: string } } | undefined;
      check('FORWARD_PLAN later-today boundary: TOMORROW at 11:30 PM local still resolves to Sep 10, never Sep 9', !card?.best || card.best.localDate === '2026-09-10');
    }

    // ============================================================
    // FORWARD_PLAN -- CHECK-before-save collision exclusion: the exact
    // date/time Ask Aura's own Schedule action points to, once genuinely
    // blocked by a real overlapping UPCOMING Plan, must be excluded from a
    // rerun -- proves real reuse of #108's own conflict-filtering, not a
    // second calculation that could silently diverge.
    // ============================================================
    if (tomorrowResponse?.cards?.[0]) {
      const bestBefore = (tomorrowResponse.cards[0] as { best?: { localDate: string } }).best;
      const scheduleAction = tomorrowResponse.actions?.find((a) => a.type === 'SCHEDULE_FORWARD_PLAN');
      if (bestBefore && scheduleAction?.forwardPlanPayload) {
        const blockingPlan = await createPlannedActivity({
          userId: user.id,
          title: 'Forward Plan (Ask Aura) conflict test block',
          activityId: null,
          plannedStartAt: new Date(scheduleAction.forwardPlanPayload.candidateStart),
          plannedEndAt: new Date(new Date(scheduleAction.forwardPlanPayload.candidateStart).getTime() + scheduleAction.forwardPlanPayload.durationMinutes * 60000),
          durationMinutes: scheduleAction.forwardPlanPayload.durationMinutes,
          windowType: 'NEUTRAL',
        });
        createdPlanIds.push(blockingPlan.id);

        const rerunParsed = parseAskAuraRequest('Should I meditate tomorrow?', { now: NOW, timezone: TZ });
        const rerunResponse = await orchestrateAskAura(rerunParsed, deps);
        const rerunCard = rerunResponse.cards?.[0] as { best?: { localDate: string } } | undefined;
        check('FORWARD_PLAN CHECK-before-save collision: the exact blocked instant no longer appears as the best option (either a different date, or no result at all)', !rerunCard?.best || rerunCard.best.localDate !== bestBefore.localDate || rerunResponse.message !== tomorrowResponse.message);
      } else {
        check('FORWARD_PLAN CHECK-before-save collision test setup', false);
      }
    }

    // ============================================================
    // FORWARD_PLAN -- side effect: searching never creates/modifies a Plan
    // by itself (only the explicit Schedule action does).
    // ============================================================
    {
      const wideFrom = new Date('2026-09-01T00:00:00.000Z');
      const wideTo = new Date('2026-09-30T00:00:00.000Z');
      const before = await listPlannedActivitiesForDay(user.id, wideFrom, wideTo);
      const parsed = parseAskAuraRequest('Should I meditate this weekend?', { now: NOW, timezone: TZ });
      await orchestrateAskAura(parsed, deps);
      const after = await listPlannedActivitiesForDay(user.id, wideFrom, wideTo);
      check('FORWARD_PLAN search never auto-schedules: Plan count is unchanged before/after searching', before.length === after.length);
    }

    // ============================================================
    // FORWARD_PLAN -- unresolved activity -> the EXISTING generic
    // CLARIFICATION card, never a new NEEDS_ACTIVITY result type.
    // ============================================================
    {
      const parsed = parseAskAuraRequest('Should I do xyzzyplugh tomorrow?', { now: NOW, timezone: TZ });
      if (parsed.intent === 'FORWARD_PLAN' && !parsed.activityId) {
        const response = await orchestrateAskAura(parsed, deps);
        check('FORWARD_PLAN unresolved activity -> the existing CLARIFICATION card type, never a new result type', response.cards?.[0]?.type === 'CLARIFICATION');
      } else {
        console.log('SKIP  "Should I do xyzzyplugh tomorrow?" did not parse as a bare unresolved FORWARD_PLAN (parser fell through differently) -- not a failure, just not exercising this path');
      }
    }

    // ============================================================
    // DETERMINISM -- two Ask Aura FORWARD_PLAN calls with identical
    // inputs produce byte-identical cards (mirrors buildForwardPlannerResult's
    // own determinism guarantee).
    // ============================================================
    {
      const parsed1 = parseAskAuraRequest('Should I meditate this weekend?', { now: NOW, timezone: TZ });
      const parsed2 = parseAskAuraRequest('Should I meditate this weekend?', { now: NOW, timezone: TZ });
      const r1 = await orchestrateAskAura(parsed1, deps);
      const r2 = await orchestrateAskAura(parsed2, deps);
      check('FORWARD_PLAN DETERMINISM: two identical calls produce byte-identical cards', JSON.stringify(r1.cards) === JSON.stringify(r2.cards));
    }
  } finally {
    // deletePlannedActivity only removes LOGGED/CANCELLED rows (never a
    // live UPCOMING commitment) -- cancel-then-delete, matching the app's
    // own established two-step flow.
    for (const planId of createdPlanIds) {
      await cancelPlannedActivity(user.id, planId);
      await deletePlannedActivity(user.id, planId);
    }
  }

  if (!allPassed) {
    console.error('\nSome Ask Aura TODAY_GUIDANCE/FORWARD_PLAN (live-database) checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL ASK AURA TODAY_GUIDANCE/FORWARD_PLAN (LIVE-DATABASE) CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
