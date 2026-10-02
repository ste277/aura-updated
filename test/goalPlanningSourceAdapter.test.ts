/**
 * Goals V2 Candidate A2 -- pure behavioral tests for the Goal
 * planning-source adapter: generic intent mapping, intent identity,
 * explicit-demand dedup, duplicate-input handling, no-cap/no-scoring,
 * downstream-limit diagnostics (factual only, never selection), ordering,
 * and purity. No DB access anywhere in this file -- see
 * test/goalDemandCandidates.test.ts / test/goalDemandCandidatesDb.test.ts
 * for A1's own eligibility-engine proof, which this file never re-derives.
 */
import { buildGoalPlanningSourceIntents, encodeGoalDemandIntentId, type GoalPlanningSourceInput } from '../apps/web/lib/goalPlanningSourceAdapter';
import type { GoalDemandCandidate } from '../apps/web/lib/goalDemandCandidates';
import { MAX_INTENTS_PER_REQUEST } from '../apps/web/lib/dayConstructorPreviewRequest';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function candidate(overrides: Partial<GoalDemandCandidate> & { goalActivityId: string }): GoalDemandCandidate {
  return {
    goalId: 'goal-1',
    goalTitle: 'Get fit',
    title: 'Workout',
    activityId: null,
    remainingThisWeek: 2,
    rhythm: { targetPerWeek: 2, completedThisWeek: 0, committedThisWeek: 0, remainingOccurrences: 2 },
    ...overrides,
  };
}

function input(overrides: Partial<GoalPlanningSourceInput> = {}): GoalPlanningSourceInput {
  return { candidates: [], planningLocalDate: '2026-10-06', manualGoalActivityIds: [], ...overrides };
}

async function main() {
  // ============================================================
  // 1/2. One/two candidates -> one/two generic intents
  // ============================================================
  {
    const r1 = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1' })] }));
    check('1. one Goal candidate produces exactly one generic intent', r1.status === 'OK' && r1.intents.length === 1);
    const r2 = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1' }), candidate({ goalActivityId: 'ga-2' })] }));
    check('2. two distinct Goal candidates produce exactly two generic intents', r2.status === 'OK' && r2.intents.length === 2);
  }

  // ============================================================
  // 3. Same input twice -> byte-equivalent output (purity)
  // ============================================================
  {
    const i = input({ candidates: [candidate({ goalActivityId: 'ga-1' }), candidate({ goalActivityId: 'ga-2' })] });
    const a = buildGoalPlanningSourceIntents(i);
    const b = buildGoalPlanningSourceIntents(i);
    check(
      '3. identical input produces byte-equivalent output across repeated calls',
      JSON.stringify(a.status === 'OK' ? { intents: a.intents, links: [...a.goalActivityLinks.entries()], diagnostics: a.diagnostics } : a) ===
        JSON.stringify(b.status === 'OK' ? { intents: b.intents, links: [...b.goalActivityLinks.entries()], diagnostics: b.diagnostics } : b)
    );
  }

  // ============================================================
  // 4/5/6. Intent identity (this ticket's own section 5/12)
  // ============================================================
  {
    const r = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1' }), candidate({ goalActivityId: 'ga-2' })] }));
    check('4. different GoalActivities produce distinct intentIds', r.status === 'OK' && r.intents[0].id !== r.intents[1].id);
  }
  {
    const r1 = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1' })], planningLocalDate: '2026-10-06' }));
    const r2 = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1' })], planningLocalDate: '2026-10-06' }));
    check('5. same GoalActivity + same planning date -> same intentId', r1.status === 'OK' && r2.status === 'OK' && r1.intents[0].id === r2.intents[0].id);
  }
  {
    const today = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1' })], planningLocalDate: '2026-10-06' }));
    const tomorrow = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1' })], planningLocalDate: '2026-10-07' }));
    check(
      '6. same GoalActivity + different planning date -> different intentId (Today vs Tomorrow never collide)',
      today.status === 'OK' && tomorrow.status === 'OK' && today.intents[0].id !== tomorrow.intents[0].id
    );
    check('6b. encodeGoalDemandIntentId is deterministic and matches the adapter\'s own output', today.status === 'OK' && today.intents[0].id === encodeGoalDemandIntentId('2026-10-06', 'ga-1'));
  }

  // ============================================================
  // 7/8. Title/goalTitle changes do not affect intent identity
  // ============================================================
  {
    const r1 = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1', title: 'Workout A' })] }));
    const r2 = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1', title: 'Workout B (renamed)' })] }));
    check('7. a changed activity title does not change the intentId', r1.status === 'OK' && r2.status === 'OK' && r1.intents[0].id === r2.intents[0].id);
  }
  {
    const r1 = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1', goalTitle: 'Get fit' })] }));
    const r2 = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1', goalTitle: 'Get fit (renamed)' })] }));
    check('8. a changed Goal title does not change the intentId', r1.status === 'OK' && r2.status === 'OK' && r1.intents[0].id === r2.intents[0].id);
  }

  // ============================================================
  // 9/10/11/12. Explicit/manual deduplication (this ticket's own section 6)
  // ============================================================
  {
    const r = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1' })], manualGoalActivityIds: ['ga-1'] }));
    check('9. manual GA-1 + automatic GA-1 -> exactly one (manual wins, automatic omitted)', r.status === 'OK' && r.intents.length === 0);
  }
  {
    const r = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1' }), candidate({ goalActivityId: 'ga-2' })], manualGoalActivityIds: ['ga-1'] }));
    check('10. manual GA-1 + automatic GA-2 -> GA-2 remains (different GoalActivity not excluded)', r.status === 'OK' && r.intents.length === 1 && r.goalActivityLinks.get(r.intents[0].id) === 'ga-2');
  }
  {
    // dedup is keyed by goalActivityId -- NOT title (same title, different id must not exclude each other).
    const r = buildGoalPlanningSourceIntents(
      input({ candidates: [candidate({ goalActivityId: 'ga-1', title: 'Workout' })], manualGoalActivityIds: [] })
    );
    const rTitleMismatch = buildGoalPlanningSourceIntents(
      input({ candidates: [candidate({ goalActivityId: 'ga-2', title: 'Workout' })], manualGoalActivityIds: ['ga-1'] }) // different id, same title as a manually-seeded (different) activity
    );
    check('11. dedup uses goalActivityId, not title -- a different id with the same title is never excluded', r.status === 'OK' && r.intents.length === 1 && rTitleMismatch.status === 'OK' && rTitleMismatch.intents.length === 1);
  }
  {
    // dedup is keyed by goalActivityId -- NOT activityId (shared catalog activityId must not cause cross-exclusion).
    const r = buildGoalPlanningSourceIntents(
      input({ candidates: [candidate({ goalActivityId: 'ga-2', activityId: 'workout-catalog' })], manualGoalActivityIds: ['ga-1'] }) // manual GA-1 shares no real relation to GA-2 besides activityId
    );
    check('12. dedup uses goalActivityId, not activityId -- a shared catalog activityId never causes exclusion', r.status === 'OK' && r.intents.length === 1);
  }

  // ============================================================
  // 13/14. Duplicate-input handling (this ticket's own section 7)
  // ============================================================
  {
    const same = candidate({ goalActivityId: 'ga-1', remainingThisWeek: 3 });
    const r = buildGoalPlanningSourceIntents(input({ candidates: [same, { ...same }] }));
    check('13. a byte-identical duplicate A1 record collapses deterministically to exactly ONE emitted intent', r.status === 'OK' && r.intents.length === 1 && r.diagnostics.duplicateGoalActivityIdsCollapsed.includes('ga-1'));
  }
  {
    const r = buildGoalPlanningSourceIntents(
      input({ candidates: [candidate({ goalActivityId: 'ga-1', remainingThisWeek: 3 }), candidate({ goalActivityId: 'ga-1', remainingThisWeek: 1 })] })
    );
    check('14. a CONFLICTING duplicate A1 record (same id, different facts) returns an invariant-violation diagnostic, never a guess', r.status === 'INVARIANT_VIOLATION' && r.conflictingGoalActivityIds.includes('ga-1'));
  }

  // ============================================================
  // 15/16/17. Generic field mapping purity (this ticket's own section 8)
  // ============================================================
  {
    const r = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1', remainingThisWeek: 5 })] }));
    const intent = r.status === 'OK' ? (r.intents[0] as unknown as Record<string, unknown>) : {};
    check('15. remainingThisWeek never enters the generic intent (not a scheduling field)', !('remainingThisWeek' in intent));
    check('16. no duration is invented -- durationMinutes is absent, letting the existing generic resolution chain decide', !('durationMinutes' in intent));
    check(
      '17. no Goal/Rhythm field enters the generic Constructor-facing intent',
      !('goalActivityId' in intent) && !('goalId' in intent) && !('goalTitle' in intent) && !('rhythmKind' in intent) && !('rhythmTargetPerWeek' in intent)
    );
  }
  {
    // activityId passthrough and flexibility default, proven against the exact manual-handoff defaulting rule.
    const withActivity = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1', activityId: 'workout' })] }));
    const withoutActivity = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-2', activityId: null })] }));
    check(
      '17b. activityId is carried through verbatim when present, and omitted (never null) when absent -- flexibility defaults to FLEXIBLE, matching an unedited manual Goal row',
      withActivity.status === 'OK' &&
        withActivity.intents[0].activityId === 'workout' &&
        withActivity.intents[0].flexibility === 'FLEXIBLE' &&
        withoutActivity.status === 'OK' &&
        !('activityId' in (withoutActivity.intents[0] as unknown as Record<string, unknown>))
    );
  }

  // ============================================================
  // 18/19. No cap; downstream-limit diagnostic is factual only
  // ============================================================
  {
    const many = Array.from({ length: 13 }, (_, i) => candidate({ goalActivityId: `ga-${i}` }));
    const r = buildGoalPlanningSourceIntents(input({ candidates: many }));
    check('18. 13 eligible candidates are returned in full -- never silently truncated to the 12-intent transport ceiling', r.status === 'OK' && r.intents.length === 13);
    check('18b. with no explicitIntentCount supplied, the limit diagnostic is honestly null/unknown, not a guessed true/false', r.status === 'OK' && r.diagnostics.combinedIntentCount === null && r.diagnostics.exceedsDownstreamIntentLimit === null);

    const rWithExplicit = buildGoalPlanningSourceIntents(input({ candidates: many, explicitIntentCount: 1 }));
    check(
      '19. downstream-limit diagnostic is correct when explicitIntentCount is supplied (13 + 1 = 14 > 12), and no candidate is dropped because of it',
      rWithExplicit.status === 'OK' &&
        rWithExplicit.intents.length === 13 &&
        rWithExplicit.diagnostics.candidateCount === 13 &&
        rWithExplicit.diagnostics.combinedIntentCount === 14 &&
        rWithExplicit.diagnostics.exceedsDownstreamIntentLimit === true &&
        MAX_INTENTS_PER_REQUEST === 12
    );
    const rUnderLimit = buildGoalPlanningSourceIntents(input({ candidates: [candidate({ goalActivityId: 'ga-1' })], explicitIntentCount: 2 }));
    check('19b. combined count under the limit reports exceedsDownstreamIntentLimit false', rUnderLimit.status === 'OK' && rUnderLimit.diagnostics.combinedIntentCount === 3 && rUnderLimit.diagnostics.exceedsDownstreamIntentLimit === false);
  }

  // ============================================================
  // 20. Stable ordering (A1's own non-semantic order preserved)
  // ============================================================
  {
    const candidates = [candidate({ goalActivityId: 'ga-zzz' }), candidate({ goalActivityId: 'ga-aaa' }), candidate({ goalActivityId: 'ga-mmm' })];
    const r = buildGoalPlanningSourceIntents(input({ candidates }));
    const order = r.status === 'OK' ? [...r.goalActivityLinks.values()] : [];
    check('20. output order matches the input array order exactly (no re-ranking) -- A1 is the one place ordering is decided', order.join(',') === 'ga-zzz,ga-aaa,ga-mmm');
  }

  // ============================================================
  // 21/22. Purity -- no Date.now()/random dependency, no DB dependency
  // ============================================================
  {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/goalPlanningSourceAdapter.ts'), 'utf8');
    // Doc-comment prose describing the purity restriction itself (e.g. "never
    // Date.now()") is excluded -- only real code is checked, same convention
    // as goalActivityRhythmStructuralGuards.test.ts's own stripComments.
    const srcNoComments = stripComments(src);
    check('21. the adapter module never calls Date.now() or constructs a clock-reading Date in real code', !/Date\.now\(\)|new Date\(/.test(srcNoComments));
    check('21b. the adapter module never references crypto.randomUUID or a random-id generator in real code', !/randomUUID|Math\.random/.test(srcNoComments));
    check('22. the adapter module performs no DB/network access in real code (no pool.query, no fetch, no beginTransaction)', !/pool\.query|beginTransaction|fetch\(/.test(srcNoComments));
  }
}

main()
  .then(() => {
    if (!allPassed) {
      console.error('SOME GOAL PLANNING SOURCE ADAPTER CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL GOAL PLANNING SOURCE ADAPTER CHECKS PASSED');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
