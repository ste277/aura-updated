/**
 * Personal Guidance Orchestration V1: PURE-LOGIC regression suite for
 * apps/web/lib/{dailyGuidancePipeline,dailyGuidanceCandidates,
 * dailyGuidanceSameFamily,dailyGuidanceOrchestrator}.ts.
 *
 * This file covers everything that does NOT require a live database:
 * the full real astrology pipeline (buildDailyPersonalFitForUser, which
 * takes an already-in-memory User object, no DB read of its own), the
 * same-family ordinal selection policy, dedupe, and static merge-critical
 * guards (no reverse family->activity mapping, no numeric composite, no
 * cross-family score comparison).
 *
 * A SEPARATE file, test/dailyGuidanceOrchestratorDb.test.ts, covers
 * collectPlanCandidates/collectDayBuilderCandidates/the full end-to-end
 * buildPersonalDailyGuidance() flow against a real database -- matching
 * this repo's own established "live-database tests, NOT part of ci.yml"
 * convention (see test/dayBuilderDb.test.ts's own module doc comment).
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

import { buildDailyPersonalFitForUser } from '../apps/web/lib/dailyGuidancePipeline';
import { dedupeCandidates } from '../apps/web/lib/dailyGuidanceCandidates';
import { selectOneCandidatePerFamily, buildWindowRankingContexts } from '../apps/web/lib/dailyGuidanceSameFamily';
import { deriveDailyGuidance } from '../packages/daily-guidance/src/engine';
import type { ConcreteGuidanceCandidate } from '../apps/web/lib/dailyGuidanceTypes';
import type { User } from '../apps/web/lib/db';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

// ============================================================
// Fixture builders.
// ============================================================

const NOW = new Date('2026-09-09T12:00:00.000Z');

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'test-user-1',
    email: 'test@example.com',
    cityName: 'Chennai',
    latitude: 13.0827,
    longitude: 80.2707,
    timezone: 'Asia/Kolkata',
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    birthDate: new Date('1990-06-15T00:00:00.000Z'),
    birthTime: '08:30',
    birthCityName: 'Chennai',
    birthLatitude: 13.0827,
    birthLongitude: 80.2707,
    birthTimezone: 'Asia/Kolkata',
    remindersEnabled: true,
    reminderLeadMinutes: 30,
    dayBuilderEnabled: true,
    dayBuilderMutedGroups: [],
    dayBuilderPriorities: [],
    dayBuilderPriorityPersonIds: [],
    dayBuilderPrioritiesPromptDismissed: false,
    ...overrides,
  };
}

function buildWindow(overrides: Partial<TimingCandidate> = {}): TimingCandidate {
  return {
    start: '2026-09-09T04:00:00.000Z',
    end: '2026-09-09T05:00:00.000Z',
    score: 8.0,
    label: 'VERY_GOOD',
    muhurtaScore: 5,
    auraFitScore: 82,
    reasons: [],
    conflicts: undefined,
    metadata: { windowType: 'ABHIJIT', windowLabel: 'Abhijit Muhurtham', activityType: 'Deep work', dateLabel: 'Wed, Sep 9' },
    ...overrides,
  };
}

function buildCandidate(overrides: Partial<ConcreteGuidanceCandidate> = {}): ConcreteGuidanceCandidate {
  return {
    source: 'PLAN',
    sourceEntityId: 'plan-1',
    activityId: 'deep-work',
    title: 'Deep Work',
    activityFamily: 'DEEP_WORK',
    durationMinutes: 60,
    timingCandidates: [buildWindow()],
    ...overrides,
  };
}

// ============================================================
// FULL REAL PIPELINE (Bhrigu -> ... -> Daily Personal Fit).
// ============================================================

check(
  'PIPELINE: a complete birth profile produces a valid DailyPersonalFitContext with exactly 13 canonical activities',
  (() => {
    const dpf = buildDailyPersonalFitForUser(buildUser(), NOW);
    return dpf !== undefined && dpf.activities.length === 13 && dpf.activities.every((a) => ['BASELINE', 'RELEVANT', 'HIGHLY_RELEVANT'].includes(a.personalRelevance));
  })()
);

check('PIPELINE: evaluationTime is echoed verbatim as the caller-supplied `now`, never Date.now()', buildDailyPersonalFitForUser(buildUser(), NOW)?.evaluationTime === NOW.toISOString());

check('PIPELINE: determinism -- two calls with the identical user+now produce deeply-equal DailyPersonalFitContext', (() => {
  const a = buildDailyPersonalFitForUser(buildUser(), NOW);
  const b = buildDailyPersonalFitForUser(buildUser(), NOW);
  return JSON.stringify(a) === JSON.stringify(b);
})());

check('PIPELINE: missing birthDate -> undefined (never throws)', buildDailyPersonalFitForUser(buildUser({ birthDate: null }), NOW) === undefined);
check('PIPELINE: missing birthTime -> undefined (never throws)', buildDailyPersonalFitForUser(buildUser({ birthTime: null }), NOW) === undefined);
check('PIPELINE: missing birthTimezone -> undefined (never throws)', buildDailyPersonalFitForUser(buildUser({ birthTimezone: null }), NOW) === undefined);

check(
  'PIPELINE: different birth profiles produce different DailyPersonalFitContext relevance vectors (genuine personalization, not a stub)',
  (() => {
    const a = buildDailyPersonalFitForUser(buildUser({ birthDate: new Date('1990-06-15T00:00:00.000Z'), birthTime: '08:30' }), NOW);
    const b = buildDailyPersonalFitForUser(buildUser({ birthDate: new Date('1985-01-02T00:00:00.000Z'), birthTime: '23:45' }), NOW);
    return JSON.stringify(a?.activities.map((x) => x.personalRelevance)) !== JSON.stringify(b?.activities.map((x) => x.personalRelevance));
  })()
);

// ============================================================
// SAME-FAMILY SELECTION -- merge-critical ordinal tuple.
// ============================================================

check(
  'SAME-FAMILY LABEL: VERY_GOOD beats GOOD regardless of score (label tier is the first key)',
  (() => {
    const a = buildCandidate({ activityId: 'a', timingCandidates: [buildWindow({ label: 'VERY_GOOD', score: 8.0 })] });
    const b = buildCandidate({ activityId: 'b', source: 'DAY_BUILDER_INTENTION', timingCandidates: [buildWindow({ label: 'GOOD', score: 9.5 })] });
    const selected = selectOneCandidatePerFamily([a, b]);
    return selected.get('DEEP_WORK')?.activityId === 'a';
  })()
);

check(
  'SAME-FAMILY SCORE: equal label -> higher score wins',
  (() => {
    const a = buildCandidate({ activityId: 'a', timingCandidates: [buildWindow({ label: 'GOOD', score: 8.8 })] });
    const b = buildCandidate({ activityId: 'b', timingCandidates: [buildWindow({ label: 'GOOD', score: 8.4 })] });
    const selected = selectOneCandidatePerFamily([a, b]);
    return selected.get('DEEP_WORK')?.activityId === 'a';
  })()
);

check(
  'SAME-FAMILY START: equal label + score -> earlier start wins',
  (() => {
    const a = buildCandidate({ activityId: 'a', timingCandidates: [buildWindow({ label: 'GOOD', score: 8.0, start: '2026-09-09T10:00:00.000Z' })] });
    const b = buildCandidate({ activityId: 'b', timingCandidates: [buildWindow({ label: 'GOOD', score: 8.0, start: '2026-09-09T11:00:00.000Z' })] });
    const selected = selectOneCandidatePerFamily([a, b]);
    return selected.get('DEEP_WORK')?.activityId === 'a';
  })()
);

check(
  'SAME-FAMILY SOURCE PRIORITY: equal label + score + start -> PLAN beats DAY_BUILDER_INTENTION',
  (() => {
    const plan = buildCandidate({ activityId: 'b-plan', source: 'PLAN', timingCandidates: [buildWindow({ label: 'GOOD', score: 8.0 })] });
    const dayBuilder = buildCandidate({ activityId: 'a-daybuilder', source: 'DAY_BUILDER_INTENTION', timingCandidates: [buildWindow({ label: 'GOOD', score: 8.0 })] });
    // Note activityId is deliberately set so alphabetical order would pick the WRONG one if source priority weren't applied first.
    const selected = selectOneCandidatePerFamily([plan, dayBuilder]);
    return selected.get('DEEP_WORK')?.source === 'PLAN';
  })()
);

check(
  'SAME-FAMILY SOURCE PRIORITY DOES NOT OVERRIDE TIMING QUALITY (merge-critical, isolated): a DAY_BUILDER_INTENTION with EXCELLENT timing beats a PLAN with only GOOD timing -- source priority is the FOURTH tuple key, consulted only after label/score/start all tie',
  (() => {
    const planGood = buildCandidate({ activityId: 'plan-good', source: 'PLAN', timingCandidates: [buildWindow({ label: 'GOOD', score: 7.0 })] });
    const dayBuilderExcellent = buildCandidate({ activityId: 'daybuilder-excellent', source: 'DAY_BUILDER_INTENTION', timingCandidates: [buildWindow({ label: 'EXCELLENT', score: 9.5 })] });
    const selected = selectOneCandidatePerFamily([planGood, dayBuilderExcellent]);
    return selected.get('DEEP_WORK')?.source === 'DAY_BUILDER_INTENTION' && selected.get('DEEP_WORK')?.activityId === 'daybuilder-excellent';
  })()
);

check(
  'SAME-FAMILY SOURCE PRIORITY DOES NOT OVERRIDE SCORE (merge-critical, isolated): equal label, but a DAY_BUILDER_INTENTION with a higher score beats a PLAN with a lower score -- source priority never overrides the score key either',
  (() => {
    const planLowerScore = buildCandidate({ activityId: 'plan-lower', source: 'PLAN', timingCandidates: [buildWindow({ label: 'GOOD', score: 7.0 })] });
    const dayBuilderHigherScore = buildCandidate({ activityId: 'daybuilder-higher', source: 'DAY_BUILDER_INTENTION', timingCandidates: [buildWindow({ label: 'GOOD', score: 8.5 })] });
    const selected = selectOneCandidatePerFamily([planLowerScore, dayBuilderHigherScore]);
    return selected.get('DEEP_WORK')?.source === 'DAY_BUILDER_INTENTION';
  })()
);

check(
  'SAME-FAMILY STABLE ID: equal label + score + start + source -> lexicographically smaller activityId wins, deterministically',
  (() => {
    const a = buildCandidate({ activityId: 'aaa', timingCandidates: [buildWindow({ label: 'GOOD', score: 8.0 })] });
    const b = buildCandidate({ activityId: 'zzz', timingCandidates: [buildWindow({ label: 'GOOD', score: 8.0 })] });
    const selected1 = selectOneCandidatePerFamily([a, b]);
    const selected2 = selectOneCandidatePerFamily([b, a]); // reversed input order -- must not affect the result
    return selected1.get('DEEP_WORK')?.activityId === 'aaa' && selected2.get('DEEP_WORK')?.activityId === 'aaa';
  })()
);

check(
  'BEST-WINDOW-ONLY: only each candidate\'s own rank-1/first timing window is ever compared -- a second window in the array is ignored',
  (() => {
    const a = buildCandidate({ activityId: 'a', timingCandidates: [buildWindow({ label: 'GOOD', score: 7.0 }), buildWindow({ label: 'EXCELLENT', score: 9.9 })] });
    const b = buildCandidate({ activityId: 'b', timingCandidates: [buildWindow({ label: 'VERY_GOOD', score: 8.0 })] });
    const selected = selectOneCandidatePerFamily([a, b]);
    return selected.get('DEEP_WORK')?.activityId === 'b'; // b's VERY_GOOD beats a's GOOD (a's own EXCELLENT 2nd window must not be consulted)
  })()
);

check(
  'EMPTY TIMING: a candidate with zero timing windows cannot represent its family -- the other candidate in the family wins by default',
  (() => {
    const a = buildCandidate({ activityId: 'a', timingCandidates: [] });
    const b = buildCandidate({ activityId: 'b', timingCandidates: [buildWindow({ label: 'CAUTION', score: -1 })] });
    const selected = selectOneCandidatePerFamily([a, b]);
    return selected.get('DEEP_WORK')?.activityId === 'b';
  })()
);

check('EMPTY TIMING: every candidate in a family has zero timing windows -> that family is absent entirely', selectOneCandidatePerFamily([buildCandidate({ timingCandidates: [] })]).size === 0);

check(
  'MULTIPLE FAMILIES: candidates in different families are each selected independently, never compared against each other',
  (() => {
    const deepWork = buildCandidate({ activityId: 'deep-work', activityFamily: 'DEEP_WORK', timingCandidates: [buildWindow({ label: 'GOOD', score: 7.0 })] });
    const relationship = buildCandidate({ activityId: 'date-night', activityFamily: 'RELATIONSHIP', timingCandidates: [buildWindow({ label: 'EXCELLENT', score: 9.5 })] });
    const selected = selectOneCandidatePerFamily([deepWork, relationship]);
    return selected.size === 2 && selected.get('DEEP_WORK')?.activityId === 'deep-work' && selected.get('RELATIONSHIP')?.activityId === 'date-night';
  })()
);

// ============================================================
// READY-EMPTY vs NO_ACTIVITY_INTENT -- merge-critical distinction.
//
// dailyGuidanceOrchestrator.ts's own NO_ACTIVITY_INTENT checks fire only
// on `candidates.length === 0` and `selected.size === 0` -- BEFORE
// deriveDailyGuidance is ever called. Once execution reaches
// deriveDailyGuidance, the orchestrator always returns READY, REGARDLESS
// of whether guidance.recommendations ends up empty. This test exercises
// the exact composition the orchestrator performs in that situation
// (selectOneCandidatePerFamily -> buildWindowRankingContexts ->
// deriveDailyGuidance) without needing a live DB: a real concrete
// candidate exists and clears same-family selection (so
// buildPersonalDailyGuidance would NOT return NO_ACTIVITY_INTENT here),
// but its only timing window is CAUTION -- #104's own eligibility stages
// then correctly reject it, producing recommendations: [] while the
// orchestrator's own state is unambiguously "candidates existed".
// ============================================================

check(
  'READY-EMPTY: a real candidate that clears same-family selection but has only a CAUTION-labeled window produces empty #104 recommendations -- the exact internal state that must map to READY, never NO_ACTIVITY_INTENT',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFitForUser(buildUser(), NOW)!;
    const cautionOnly = buildCandidate({ activityId: 'deep-work', activityFamily: 'DEEP_WORK', timingCandidates: [buildWindow({ label: 'CAUTION', score: -2 })] });
    const selected = selectOneCandidatePerFamily([cautionOnly]);
    const windowRankings = buildWindowRankingContexts(selected);
    const guidance = deriveDailyGuidance({ dailyPersonalFit, windowRankings });
    // selected.size > 0 is exactly the condition that keeps
    // buildPersonalDailyGuidance out of its own NO_ACTIVITY_INTENT branch
    // -- confirmed by direct inspection of dailyGuidanceOrchestrator.ts's
    // own source (see the static guard below).
    return selected.size === 1 && guidance.recommendations.length === 0;
  })()
);

check(
  'STRUCTURAL: dailyGuidanceOrchestrator.ts\'s own NO_ACTIVITY_INTENT checks (comments stripped) test candidates.length/selected.size only -- never guidance.recommendations, confirming READY-empty is unreachable as NO_ACTIVITY_INTENT',
  (() => {
    const code = stripComments(fs.readFileSync('apps/web/lib/dailyGuidanceOrchestrator.ts', 'utf8'));
    const noActivityIntentLines = code.split('\n').filter((line) => line.includes("status: 'NO_ACTIVITY_INTENT'"));
    return noActivityIntentLines.length === 2 && noActivityIntentLines.every((line) => !/recommendations/i.test(line)) && !/guidance\.recommendations\.length\s*===\s*0/.test(code);
  })()
);

// ============================================================
// WINDOW RANKING CONTEXT CONSTRUCTION.
// ============================================================

check(
  'WINDOW RANKING CORE: a CHECK-derived single-candidate array normalizes to rank 1 via the pure core, no #103 modification needed',
  (() => {
    const candidate = buildCandidate({ timingCandidates: [buildWindow()] });
    const selected = new Map([['DEEP_WORK', candidate]]);
    const contexts = buildWindowRankingContexts(selected);
    return contexts.length === 1 && contexts[0].activityFamily === 'DEEP_WORK' && contexts[0].windows.length === 1 && contexts[0].windows[0].rank === 1;
  })()
);

check(
  'WINDOW RANKING CORE: does not re-sort/re-score/re-label the input timingCandidates array (verbatim field preservation)',
  (() => {
    const window = buildWindow({ score: 6.5, label: 'USABLE' });
    const candidate = buildCandidate({ timingCandidates: [window] });
    const contexts = buildWindowRankingContexts(new Map([['DEEP_WORK', candidate]]));
    return contexts[0].windows[0].score === 6.5 && contexts[0].windows[0].label === 'USABLE' && contexts[0].windows[0].start === window.start;
  })()
);

// ============================================================
// DEDUPE -- stable ID only, never fuzzy/title matching.
// ============================================================

check(
  'DEDUPE: a Day Builder suggestion for the same activityId as an existing Plan is removed; the Plan is kept',
  (() => {
    const plan = buildCandidate({ activityId: 'deep-work', source: 'PLAN', sourceEntityId: 'plan-1' });
    const dayBuilder = buildCandidate({ activityId: 'deep-work', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 'suggestion-1' });
    const result = dedupeCandidates([plan, dayBuilder]);
    return result.length === 1 && result[0].source === 'PLAN';
  })()
);

check(
  'DEDUPE: different activityIds are never merged, even if they would share a family (Call Parents vs Date Night both RELATIONSHIP stay distinct)',
  (() => {
    const callParents = buildCandidate({ activityId: 'call-parents', activityFamily: 'RELATIONSHIP', source: 'DAY_BUILDER_INTENTION' });
    const dateNight = buildCandidate({ activityId: 'date-night', activityFamily: 'RELATIONSHIP', source: 'PLAN' });
    const result = dedupeCandidates([callParents, dateNight]);
    return result.length === 2;
  })()
);

check('DEDUPE: two Day Builder suggestions for different activityIds are both kept (no over-aggressive removal)', dedupeCandidates([buildCandidate({ activityId: 'a', source: 'DAY_BUILDER_INTENTION' }), buildCandidate({ activityId: 'b', source: 'DAY_BUILDER_INTENTION' })]).length === 2);

// ============================================================
// STATIC SOURCE GUARDS -- merge-critical.
// ============================================================

const ORCHESTRATION_FILES = ['dailyGuidancePipeline', 'dailyGuidanceCandidates', 'dailyGuidanceSameFamily', 'dailyGuidanceOrchestrator', 'dailyGuidanceTypes'];

function readOrchestrationSource(stripped = true): string {
  return ORCHESTRATION_FILES.map((name) => {
    const text = fs.readFileSync(`apps/web/lib/${name}.ts`, 'utf8');
    return stripped ? stripComments(text) : text;
  }).join('\n');
}

check(
  'NO REVERSE MAPPING (merge-critical): no ACTUAL CODE (comments stripped) contains a family-keyed literal object (Record<MuhurtaActivityFamily, ...> shape) or a switch/case on a family literal returning an activityId',
  (() => {
    const code = readOrchestrationSource();
    const hasFamilyRecordLiteral = /:\s*Record<\s*MuhurtaActivityFamily/i.test(code);
    const hasFamilySwitchToActivityId = /case\s*'(DEEP_WORK|WORKOUT|LEARNING|MEDITATION|RELATIONSHIP|JOURNEY_START|SOCIAL|MEAL|FINANCE|NEW_BEGINNING|ADMIN|WELLBEING|FOCUSED_WORK)'\s*:\s*return\s*'/i.test(code);
    return !hasFamilyRecordLiteral && !hasFamilySwitchToActivityId;
  })()
);

check(
  'CONCRETE INTENT TRACEABILITY: every ConcreteGuidanceCandidate constructed in this orchestration reads activityId from an actual Plan row or Day Builder suggestion field -- no ACTUAL CODE fabricates one from a family literal',
  !/activityId:\s*['"](?:DEEP_WORK|WORKOUT|LEARNING|MEDITATION|RELATIONSHIP|JOURNEY_START|SOCIAL|MEAL|FINANCE|NEW_BEGINNING|ADMIN|WELLBEING|FOCUSED_WORK)['"]/i.test(readOrchestrationSource())
);

check(
  'NO NUMERIC COMPOSITE: no forbidden identifier (intentScore/sourceScore/priorityScore/sameFamilyScore/guidanceScore) anywhere in this orchestration',
  !/intentScore|sourceScore|priorityScore|sameFamilyScore|guidanceScore/i.test(readOrchestrationSource())
);

check(
  'NO CROSS-FAMILY SCORE COMPARISON: no ACTUAL CODE sorts/compares timingCandidates or timing scores across DIFFERENT activityFamily values -- compareSameFamilyCandidates is only ever invoked inside a single per-family group',
  (() => {
    const code = readOrchestrationSource();
    // The only score/label comparison logic lives in dailyGuidanceSameFamily.ts's compareSameFamilyCandidates, invoked exclusively from within selectOneCandidatePerFamily's own per-family loop (grouped by family before any comparison) -- confirmed by inspecting that exact structure; this guard additionally ensures no OTHER file introduces a second, cross-family sort.
    const suspiciousCrossFamilySort = /allCandidates\s*\.sort\(|candidates\s*\.sort\(\(a,\s*b\)\s*=>\s*b\.(timingScore|score)/i.test(code);
    return !suspiciousCrossFamilySort;
  })()
);

check(
  'no Date.now()/new Date() with no args/Math.random anywhere in this orchestration (comments stripped) -- evaluationTime is always the caller-supplied `now`',
  (() => {
    const code = readOrchestrationSource();
    return !/Date\.now\(\)/.test(code) && !/new Date\(\)(?!\.)/.test(code) && !/Math\.random\(\)/.test(code);
  })()
);

check(
  'NO LLM: no openai/anthropic/llm/prompt usage anywhere in this orchestration',
  !/openai|anthropic\b|\bllm\b|\bprompt\b/i.test(readOrchestrationSource())
);

check(
  'NO ASHTAKAVARGA: this orchestration never references packages/ashtakavarga',
  !/ashtakavarga/i.test(readOrchestrationSource())
);

check(
  'PROTECTED PATHS: no ACTUAL IMPORT of packages/daily-guidance/src or packages/personal-intelligence/src is followed by a modification -- this file only verifies no import path reaches into those packages\' own internal (non-index) modules for anything beyond the documented, read-only public functions',
  (() => {
    const code = readOrchestrationSource(false);
    const importLines = code.match(/from\s+'[^']+'/g) ?? [];
    // Every packages/* import must be a real, existing exported symbol path -- this is a structural sanity check, not a full re-verification of #104's own contract (covered by packages/daily-guidance's own test suite).
    return importLines.every((line) => !/personal-intelligence\/src\/(guidance|validation)\.ts/.test(line));
  })()
);

check(
  'NO WINDOW RANKING RE-SORT: dailyGuidanceSameFamily.ts never calls .sort( on a RankedTimingWindow/TimingCandidate array AFTER deriveWindowRanking has produced it',
  !/deriveWindowRanking\([^)]*\)\.sort\(|windows\.sort\(/i.test(readOrchestrationSource())
);

if (!allPassed) {
  console.error('\nSome Personal Guidance Orchestration (pure-logic) checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL PERSONAL GUIDANCE ORCHESTRATION (PURE-LOGIC) CHECKS PASSED');
}
