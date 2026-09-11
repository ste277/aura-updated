/**
 * Daily Guidance Composer V1: regression suite for
 * packages/daily-guidance/src -- a deterministic, staged-eligibility
 * cross-family selection joining an already-computed
 * DailyPersonalFitContext (the personal-relevance axis) with
 * already-ranked, per-family WindowRankingContext results (the timing
 * axis) into up to N structured recommendations. See
 * packages/daily-guidance/README.md for the full convention (three fixed
 * stages, never a fourth; strict-interval, temporal-only diversity;
 * best-window-only; no numeric composite) this suite verifies against.
 *
 * "Independently hard-coded" (matching this repo's own established
 * convention, e.g. test/dailyPersonalFitEngine.test.ts's item 44): the
 * expected canonical family list below is a bare, hand-derived literal,
 * never imported from packages/daily-guidance/src/constants.ts's own
 * CANONICAL_ACTIVITY_FAMILIES.
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

import { deriveDailyGuidance, CANONICAL_ACTIVITY_FAMILIES, DAILY_GUIDANCE_ENGINE_VERSION, DAILY_GUIDANCE_SELECTION_POLICY_VERSION, DailyGuidanceValidationError } from '../packages/daily-guidance/src/index';
import type { DailyGuidanceInput, BehavioralAffinityTier } from '../packages/daily-guidance/src/index';
import type { MuhurtaActivityFamily } from '../packages/muhurta/src/muhurtaEngine';
import type { WindowRankingContext, RankedTimingWindow } from '../packages/window-ranking/src/index';
import type { DailyActivityFit, DailyPersonalFitContext, PersonalRelevance, DailyPersonalFitRelevantTheme } from '../packages/personal-intelligence/src/context';
import { CONTRACT_VERSION } from '../packages/personal-intelligence/src/provenance';

// ============================================================
// Independently hard-coded expectations (see module doc comment above).
// ============================================================

const EXPECTED_CANONICAL_FAMILIES: MuhurtaActivityFamily[] = [
  'DEEP_WORK', 'WORKOUT', 'LEARNING', 'MEDITATION', 'RELATIONSHIP', 'JOURNEY_START',
  'SOCIAL', 'MEAL', 'FINANCE', 'NEW_BEGINNING', 'ADMIN', 'WELLBEING', 'FOCUSED_WORK',
];

const EVAL_TIME = '2026-09-09T12:00:00.000Z';

// ============================================================
// Fixture builders.
// ============================================================

function buildWindow(overrides: Partial<RankedTimingWindow> = {}): RankedTimingWindow {
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
    rank: 1,
    ...overrides,
  };
}

function buildActivityFit(family: MuhurtaActivityFamily, relevance: PersonalRelevance, relevantThemes: DailyPersonalFitRelevantTheme[] = []): DailyActivityFit {
  return { activityFamily: family, personalRelevance: relevance, relevantThemes, evidence: [] };
}

function buildDailyPersonalFit(overrides: Partial<Record<MuhurtaActivityFamily, PersonalRelevance>> = {}, evaluationTime = EVAL_TIME): DailyPersonalFitContext {
  const activities = EXPECTED_CANONICAL_FAMILIES.map((family) => buildActivityFit(family, overrides[family] ?? 'BASELINE'));
  return { engineVersion: 'DAILY_PERSONAL_FIT_V1', evaluationTime, activities, evidence: [] };
}

function buildRanking(family: MuhurtaActivityFamily, windows: RankedTimingWindow[]): WindowRankingContext {
  return { engineVersion: 'WINDOW_RANKING_V1', activityFamily: family, windows };
}

function recommendationFor(context: ReturnType<typeof deriveDailyGuidance>, family: MuhurtaActivityFamily) {
  return context.recommendations.find((r) => r.activityFamily === family);
}

function expectThrows(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof DailyGuidanceValidationError;
  }
}

// ============================================================
// CANONICAL FAMILIES / ENGINE VERSION.
// ============================================================

check('CANONICAL_ACTIVITY_FAMILIES matches the independently hard-coded 13-value set exactly, in order', JSON.stringify(CANONICAL_ACTIVITY_FAMILIES) === JSON.stringify(EXPECTED_CANONICAL_FAMILIES));
check('engineVersion is the stable DAILY_GUIDANCE_V1 literal', DAILY_GUIDANCE_ENGINE_VERSION === 'DAILY_GUIDANCE_V1');
check('selectionPolicyVersion is the stable DAILY_GUIDANCE_SELECTION_POLICY_V2 literal (bumped by Behavioral Integration V1 -- the ordinal tuple itself changed)', DAILY_GUIDANCE_SELECTION_POLICY_VERSION === 'DAILY_GUIDANCE_SELECTION_POLICY_V2');

check(
  'result stamps both DAILY_GUIDANCE_ENGINE_VERSION and DAILY_GUIDANCE_SELECTION_POLICY_VERSION verbatim',
  (() => {
    const result = deriveDailyGuidance({ dailyPersonalFit: buildDailyPersonalFit(), windowRankings: [] });
    return result.engineVersion === DAILY_GUIDANCE_ENGINE_VERSION && result.selectionPolicyVersion === DAILY_GUIDANCE_SELECTION_POLICY_VERSION;
  })()
);

// ============================================================
// PRIMARY STAGED-POLICY FIXTURE (brief's own worked example).
// A = HIGHLY_RELEVANT + GOOD + 8.0, B = RELEVANT + EXCELLENT + 9.2, C = HIGHLY_RELEVANT + VERY_GOOD + 8.5.
// Expected order (Stage 1 tuple: relevance tier, then timing tier): C, A, B.
// ============================================================

check(
  'PRIMARY STAGED POLICY: within Stage 1, HIGHLY_RELEVANT precedes RELEVANT, and VERY_GOOD precedes GOOD -- expected order C, A, B',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'RELEVANT', MEDITATION: 'HIGHLY_RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'GOOD', score: 8.0 })]), // A
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'EXCELLENT', score: 9.2 })]), // B
      buildRanking('MEDITATION', [buildWindow({ start: '2026-09-09T08:00:00.000Z', end: '2026-09-09T09:00:00.000Z', label: 'VERY_GOOD', score: 8.5 })]), // C
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return (
      result.recommendations.length === 3 &&
      result.recommendations[0].activityFamily === 'MEDITATION' &&
      result.recommendations[1].activityFamily === 'DEEP_WORK' &&
      result.recommendations[2].activityFamily === 'LEARNING' &&
      result.recommendations.every((r, i) => r.rank === i + 1)
    );
  })()
);

// ============================================================
// WITHIN-STAGE-1 EDGE CASE (isolated, merge-critical): once both
// candidates already clear Stage 1's own GOOD+ timing floor, personal
// relevance is the FIRST within-stage tuple key -- HIGHLY_RELEVANT+GOOD
// ranks ahead of RELEVANT+EXCELLENT, the opposite of the cross-STAGE
// rule (RELEVANT+EXCELLENT beats HIGHLY_RELEVANT+USABLE) tested below.
// These are two different, deliberately distinct rules: the cross-stage
// rule is about which STAGE runs first; this one is about ordering
// WITHIN a stage once both candidates are already in it.
// ============================================================

check(
  'WITHIN STAGE 1 (isolated, 2-way): HIGHLY_RELEVANT + GOOD ranks AHEAD of RELEVANT + EXCELLENT -- both already cleared the Stage-1 GOOD+ floor, so relevance (the first within-stage tuple key) decides, even though EXCELLENT has a higher timing label/score',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'GOOD', score: 8.0 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'EXCELLENT', score: 9.2 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 2 });
    return result.recommendations.length === 2 && result.recommendations[0].activityFamily === 'DEEP_WORK' && result.recommendations[0].selectionReason === 'PRIMARY_FLOOR_MET' && result.recommendations[1].activityFamily === 'LEARNING' && result.recommendations[1].selectionReason === 'PRIMARY_FLOOR_MET';
  })()
);

// ============================================================
// MERGE-CRITICAL: RELEVANT+EXCELLENT beats HIGHLY_RELEVANT+USABLE.
// ============================================================

check(
  'MERGE CRITICAL: RELEVANT + EXCELLENT (Stage 1) is selected before HIGHLY_RELEVANT + USABLE (Stage 2) -- the timing floor gates eligibility before relevance is ever consulted across stages',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'USABLE', score: 6.0 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'EXCELLENT', score: 9.2 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 1 });
    return result.recommendations.length === 1 && result.recommendations[0].activityFamily === 'LEARNING' && result.recommendations[0].selectionReason === 'PRIMARY_FLOOR_MET';
  })()
);

check(
  'with a higher limit, HIGHLY_RELEVANT + USABLE is still eventually selected in Stage 2, ranked after every Stage 1 pick',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'USABLE', score: 6.0 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'EXCELLENT', score: 9.2 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations.length === 2 && result.recommendations[0].activityFamily === 'LEARNING' && result.recommendations[1].activityFamily === 'DEEP_WORK' && result.recommendations[1].selectionReason === 'RELAXED_TIMING_FLOOR';
  })()
);

// ============================================================
// CAUTION -- merge-critical, never eligible in any stage.
// ============================================================

check(
  'CAUTION: HIGHLY_RELEVANT + CAUTION is never selected, even as the only available candidate',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ FINANCE: 'HIGHLY_RELEVANT' });
    const windowRankings = [buildRanking('FINANCE', [buildWindow({ label: 'CAUTION', score: -2.0 })])];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations.length === 0;
  })()
);

// ============================================================
// BASELINE FALLBACK -- Stage 3 only, and only GOOD+.
// ============================================================

check(
  'BASELINE FALLBACK: BASELINE + EXCELLENT is selected (Stage 3) when nothing else is eligible',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit(); // every family BASELINE
    const windowRankings = [buildRanking('MEAL', [buildWindow({ label: 'EXCELLENT', score: 9.5 })])];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations.length === 1 && result.recommendations[0].activityFamily === 'MEAL' && result.recommendations[0].selectionReason === 'RELAXED_RELEVANCE_FLOOR';
  })()
);

check(
  'BASELINE + USABLE is NEVER selected in V1 -- no fourth stage exists',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit();
    const windowRankings = [buildRanking('MEAL', [buildWindow({ label: 'USABLE', score: 6.0 })])];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations.length === 0;
  })()
);

// ============================================================
// BEST WINDOW ONLY -- rank 2/3 never substituted.
// ============================================================

check(
  'BEST WINDOW ONLY: a family whose rank-1 window overlaps an already-selected recommendation is SKIPPED, never substituted with its own rank-2 window even when rank-2 would avoid the overlap',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T09:00:00.000Z', end: '2026-09-09T10:00:00.000Z', label: 'EXCELLENT', score: 9.0, rank: 1 })]),
      buildRanking('LEARNING', [
        buildWindow({ start: '2026-09-09T09:30:00.000Z', end: '2026-09-09T10:30:00.000Z', label: 'VERY_GOOD', score: 8.5, rank: 1 }), // overlaps DEEP_WORK
        buildWindow({ start: '2026-09-09T11:00:00.000Z', end: '2026-09-09T12:00:00.000Z', label: 'GOOD', score: 7.5, rank: 2 }), // would NOT overlap, but must never be used
      ]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations.length === 1 && result.recommendations[0].activityFamily === 'DEEP_WORK' && recommendationFor(result, 'LEARNING') === undefined;
  })()
);

// ============================================================
// OVERLAP / ADJACENCY (brief's own three-family example).
// ============================================================

check(
  'OVERLAP FIXTURE: DEEP_WORK 09:00-10:00, LEARNING 09:30-10:30 (overlaps), FINANCE 11:00-12:00 (no overlap) -- DEEP_WORK and FINANCE selected, LEARNING skipped',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT', FINANCE: 'HIGHLY_RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T09:00:00.000Z', end: '2026-09-09T10:00:00.000Z', label: 'EXCELLENT', score: 9.5 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T09:30:00.000Z', end: '2026-09-09T10:30:00.000Z', label: 'VERY_GOOD', score: 8.5 })]),
      buildRanking('FINANCE', [buildWindow({ start: '2026-09-09T11:00:00.000Z', end: '2026-09-09T12:00:00.000Z', label: 'GOOD', score: 7.5 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    const families = result.recommendations.map((r) => r.activityFamily);
    return families.includes('DEEP_WORK') && families.includes('FINANCE') && !families.includes('LEARNING') && result.recommendations.length === 2;
  })()
);

check(
  'ADJACENT FIXTURE: DEEP_WORK 09:00-10:00 and LEARNING 10:00-11:00 (end == start) do NOT overlap -- both selected',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T09:00:00.000Z', end: '2026-09-09T10:00:00.000Z', label: 'EXCELLENT', score: 9.5 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T10:00:00.000Z', end: '2026-09-09T11:00:00.000Z', label: 'VERY_GOOD', score: 8.5 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations.length === 2;
  })()
);

check(
  'NO OVERLAP RELAXATION: only 2 non-overlapping eligible recommendations exist -- result has length 2, never padded to 3',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T09:00:00.000Z', end: '2026-09-09T10:00:00.000Z', label: 'EXCELLENT', score: 9.5 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T09:30:00.000Z', end: '2026-09-09T10:30:00.000Z', label: 'VERY_GOOD', score: 8.5 })]), // overlaps DEEP_WORK
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations.length === 1; // LEARNING skipped entirely, no padding
  })()
);

// ============================================================
// EMPTY / MISSING WINDOW HANDLING.
// ============================================================

check(
  'EMPTY WINDOWS: HIGHLY_RELEVANT family with windows: [] produces no recommendation, no exception',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT' });
    const windowRankings = [buildRanking('DEEP_WORK', [])];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations.length === 0;
  })()
);

check(
  'MISSING WindowRankingContext entirely (family never supplied) produces no recommendation for it, no exception -- partial coverage',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT', RELATIONSHIP: 'HIGHLY_RELEVANT' });
    const windowRankings = [buildRanking('DEEP_WORK', [buildWindow({ label: 'EXCELLENT', score: 9.0 })]), buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T06:00:00.000Z', end: '2026-09-09T07:00:00.000Z', label: 'GOOD', score: 7.5 })])];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations.length === 2 && recommendationFor(result, 'RELATIONSHIP') === undefined;
  })()
);

check('EMPTY RESULT: no windowRankings supplied at all -> recommendations: [], never an error', deriveDailyGuidance({ dailyPersonalFit: buildDailyPersonalFit(), windowRankings: [] }).recommendations.length === 0);

// ============================================================
// UP-TO-3, NEVER EXACTLY 3.
// ============================================================

check(
  'UP TO 3: only 2 eligible candidates exist across all stages -- recommendations.length === 2',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'EXCELLENT', score: 9.5 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'GOOD', score: 7.5 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations.length === 2;
  })()
);

// ============================================================
// LIMIT VALIDATION.
// ============================================================

for (const limit of [1, 2, 3]) {
  check(
    `LIMIT ${limit}: caps recommendations at exactly ${limit} when at least ${limit} eligible candidates exist`,
    (() => {
      const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT', RELATIONSHIP: 'HIGHLY_RELEVANT' });
      const windowRankings = [
        buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'EXCELLENT', score: 9.5 })]),
        buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'EXCELLENT', score: 9.4 })]),
        buildRanking('RELATIONSHIP', [buildWindow({ start: '2026-09-09T08:00:00.000Z', end: '2026-09-09T09:00:00.000Z', label: 'EXCELLENT', score: 9.3 })]),
      ];
      const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit });
      return result.recommendations.length === limit;
    })()
  );
}

check('DEFAULT LIMIT: omitting limit defaults to 3', deriveDailyGuidance({ dailyPersonalFit: buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT' }), windowRankings: [buildRanking('DEEP_WORK', [buildWindow({ label: 'EXCELLENT', score: 9.0 })])] }).recommendations.length <= 3);

for (const invalidLimit of [0, -1, 1.5, NaN]) {
  check(`rejects an invalid limit (${invalidLimit})`, expectThrows(() => deriveDailyGuidance({ dailyPersonalFit: buildDailyPersonalFit(), windowRankings: [], limit: invalidLimit })));
}

// ============================================================
// VALIDATION -- duplicate / unknown / missing-join.
// ============================================================

check(
  'DUPLICATE FAMILY: two WindowRankingContexts for DEEP_WORK throws',
  expectThrows(() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT' });
    const windowRankings = [buildRanking('DEEP_WORK', [buildWindow()]), buildRanking('DEEP_WORK', [buildWindow({ score: 9.9 })])];
    return deriveDailyGuidance({ dailyPersonalFit, windowRankings });
  })
);

check(
  'UNKNOWN FAMILY: a non-canonical activityFamily in dailyPersonalFit.activities throws',
  expectThrows(() => {
    const dailyPersonalFit = buildDailyPersonalFit();
    (dailyPersonalFit.activities[0] as unknown as { activityFamily: string }).activityFamily = 'UNKNOWN';
    return deriveDailyGuidance({ dailyPersonalFit, windowRankings: [] });
  })
);

check(
  'UNKNOWN FAMILY: a non-canonical activityFamily in a WindowRankingContext throws',
  expectThrows(() => {
    const dailyPersonalFit = buildDailyPersonalFit();
    const windowRankings = [{ engineVersion: 'WINDOW_RANKING_V1', activityFamily: 'UNKNOWN' as unknown as MuhurtaActivityFamily, windows: [] }];
    return deriveDailyGuidance({ dailyPersonalFit, windowRankings });
  })
);

check(
  'INCOMPLETE DPF: a dailyPersonalFit missing a canonical family throws (enforces the "all 13" invariant DailyPersonalFitContext already guarantees)',
  expectThrows(() => {
    const dailyPersonalFit = buildDailyPersonalFit();
    dailyPersonalFit.activities = dailyPersonalFit.activities.slice(0, 12);
    return deriveDailyGuidance({ dailyPersonalFit, windowRankings: [] });
  })
);

check(
  'MISSING JOIN (structural, defense-in-depth): a windowRankings entry for a family absent from dailyPersonalFit.activities is rejected -- in practice this fires via the earlier "all 13 required" DPF check, since a genuinely dangling join is structurally unreachable once that check holds (see README\'s "Validation" section -- this test documents that finding, not a separate code path)',
  expectThrows(() => {
    const dailyPersonalFit = buildDailyPersonalFit();
    dailyPersonalFit.activities = dailyPersonalFit.activities.filter((a) => a.activityFamily !== 'MEAL');
    const windowRankings = [buildRanking('MEAL', [buildWindow()])];
    return deriveDailyGuidance({ dailyPersonalFit, windowRankings });
  })
);

check(
  'rejects windows[0].rank !== 1',
  expectThrows(() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT' });
    const windowRankings = [buildRanking('DEEP_WORK', [buildWindow({ rank: 2 })])];
    return deriveDailyGuidance({ dailyPersonalFit, windowRankings });
  })
);

// ============================================================
// PRESERVATION -- personal axis, timing axis, selection reason.
// ============================================================

check(
  'RELEVANT THEMES PRESERVATION: selected recommendation.relevantThemes equals the source DailyActivityFit.relevantThemes exactly, no filtering/reordering',
  (() => {
    const themes: DailyPersonalFitRelevantTheme[] = [{ theme: 'FOCUS', state: 'STRONGLY_ACTIVE' }, { theme: 'CAREER', state: 'QUIET' }];
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT' });
    dailyPersonalFit.activities.find((a) => a.activityFamily === 'DEEP_WORK')!.relevantThemes = themes;
    const windowRankings = [buildRanking('DEEP_WORK', [buildWindow({ label: 'EXCELLENT', score: 9.0 })])];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings });
    return JSON.stringify(recommendationFor(result, 'DEEP_WORK')?.relevantThemes) === JSON.stringify(themes);
  })()
);

check(
  'TIMING PRESERVATION: selected recommendation.timing matches the rank-1 window\'s start/end/score/label/windowRank exactly, never recomputed',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT' });
    const window = buildWindow({ start: '2026-09-09T09:42:00.000Z', end: '2026-09-09T11:06:00.000Z', label: 'VERY_GOOD', score: 8.6 });
    const windowRankings = [buildRanking('DEEP_WORK', [window])];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings });
    const timing = recommendationFor(result, 'DEEP_WORK')?.timing;
    return timing?.start === window.start && timing?.end === window.end && timing?.score === window.score && timing?.label === window.label && timing?.windowRank === window.rank;
  })()
);

check(
  'SELECTION REASON: Stage 1/2/3 candidates each carry their own exact, unambiguous selectionReason',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT', MEAL: 'BASELINE' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'EXCELLENT', score: 9.0 })]), // Stage 1
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'USABLE', score: 6.0 })]), // Stage 2
      buildRanking('MEAL', [buildWindow({ start: '2026-09-09T08:00:00.000Z', end: '2026-09-09T09:00:00.000Z', label: 'EXCELLENT', score: 9.5 })]), // Stage 3
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return recommendationFor(result, 'DEEP_WORK')?.selectionReason === 'PRIMARY_FLOOR_MET' && recommendationFor(result, 'LEARNING')?.selectionReason === 'RELAXED_TIMING_FLOOR' && recommendationFor(result, 'MEAL')?.selectionReason === 'RELAXED_RELEVANCE_FLOOR';
  })()
);

check(
  'cross-family rank is 1-based, in final selection order, and distinct from timing.windowRank',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'EXCELLENT', score: 9.5 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'EXCELLENT', score: 9.0 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return result.recommendations[0].rank === 1 && result.recommendations[1].rank === 2 && result.recommendations.every((r) => r.timing.windowRank === 1);
  })()
);

// ============================================================
// EVIDENCE.
// ============================================================

check(
  'EVIDENCE: each recommendation carries a DAILY_GUIDANCE selection-rule evidence entry, and a MUHURTA evidence entry only when reasons/conflicts are actually present',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'EXCELLENT', score: 9.0, reasons: [{ code: 'ABHIJIT_SUPPORT', factor: 'SOLAR_WINDOW', polarity: 'SUPPORT', impact: 8 }] })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'GOOD', score: 7.5, reasons: [], conflicts: undefined })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    const deepWork = recommendationFor(result, 'DEEP_WORK');
    const learning = recommendationFor(result, 'LEARNING');
    return (
      deepWork?.evidence.some((e) => e.source === 'DAILY_GUIDANCE') === true &&
      deepWork?.evidence.some((e) => e.source === 'MUHURTA') === true &&
      learning?.evidence.length === 1 && // no reasons/conflicts -> no MUHURTA entry
      learning?.evidence[0].source === 'DAILY_GUIDANCE'
    );
  })()
);

check('RESULT-LEVEL EVIDENCE: exactly one DAILY_GUIDANCE summary evidence entry on the top-level context', (() => {
  const result = deriveDailyGuidance({ dailyPersonalFit: buildDailyPersonalFit(), windowRankings: [] });
  return result.evidence.length === 1 && result.evidence[0].source === 'DAILY_GUIDANCE';
})());

check(
  'PAYLOAD SIZE: a representative 3-recommendation result serializes to well under 100KB',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT', RELATIONSHIP: 'RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'EXCELLENT', score: 9.0, reasons: [{ code: 'ABHIJIT_SUPPORT', factor: 'SOLAR_WINDOW', polarity: 'SUPPORT', impact: 8 }] })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'GOOD', score: 7.5 })]),
      buildRanking('RELATIONSHIP', [buildWindow({ start: '2026-09-09T08:00:00.000Z', end: '2026-09-09T09:00:00.000Z', label: 'VERY_GOOD', score: 8.5 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    const size = JSON.stringify(result).length;
    console.log(`    (approximate serialized size: ${size} characters / ~${Math.round(size / 1024)}KB)`);
    return size < 100_000;
  })()
);

// ============================================================
// DETERMINISM / IMMUTABILITY.
// ============================================================

check(
  'DETERMINISM: repeated calls with structurally identical input produce deeply-equal output',
  (() => {
    const input: DailyGuidanceInput = {
      dailyPersonalFit: buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'RELEVANT' }),
      windowRankings: [buildRanking('DEEP_WORK', [buildWindow({ label: 'EXCELLENT', score: 9.0 })])],
      limit: 3,
    };
    return JSON.stringify(deriveDailyGuidance(input)) === JSON.stringify(deriveDailyGuidance(input));
  })()
);

check(
  'IMMUTABILITY: neither dailyPersonalFit nor windowRankings is mutated by deriveDailyGuidance',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'RELEVANT' });
    const windowRankings = [buildRanking('DEEP_WORK', [buildWindow({ label: 'EXCELLENT', score: 9.0 })]), buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T06:00:00.000Z', end: '2026-09-09T07:00:00.000Z', label: 'GOOD', score: 7.5 })])];
    const dpfClone = JSON.parse(JSON.stringify(dailyPersonalFit));
    const wrClone = JSON.parse(JSON.stringify(windowRankings));
    deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3 });
    return JSON.stringify(dailyPersonalFit) === JSON.stringify(dpfClone) && JSON.stringify(windowRankings) === JSON.stringify(wrClone);
  })()
);

check(
  'EVALUATION TIME: output.evaluationTime equals dailyPersonalFit.evaluationTime verbatim',
  (() => {
    const time = '2026-09-09T15:30:00.000Z';
    const result = deriveDailyGuidance({ dailyPersonalFit: buildDailyPersonalFit({}, time), windowRankings: [] });
    return result.evaluationTime === time;
  })()
);

// ============================================================
// BEHAVIORAL AFFINITY (Behavioral Integration V1) -- merge-critical.
// Two same-relevance, same-label, same-score candidates (DEEP_WORK,
// LEARNING) isolate the new tuple key from every other one.
// ============================================================

function buildTiedCandidatesInput(affinities: Partial<Record<'DEEP_WORK' | 'LEARNING', BehavioralAffinityTier>>): DailyGuidanceInput {
  const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT' });
  const windowRankings = [
    buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'GOOD', score: 8.0 })]),
    buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'GOOD', score: 8.0 })]),
  ];
  return { dailyPersonalFit, windowRankings, limit: 2, behavioralAffinityByFamily: affinities };
}

check(
  'ABSENT INPUT: omitting behavioralAffinityByFamily entirely reproduces the exact same order as an explicit all-NEUTRAL map',
  (() => {
    const { behavioralAffinityByFamily, ...withoutBehavior } = buildTiedCandidatesInput({});
    const resultAbsent = deriveDailyGuidance(withoutBehavior);
    const resultAllNeutral = deriveDailyGuidance(buildTiedCandidatesInput({ DEEP_WORK: 'NEUTRAL', LEARNING: 'NEUTRAL' }));
    return JSON.stringify(resultAbsent) === JSON.stringify(resultAllNeutral);
  })()
);

check(
  'ABSENT INPUT reproduces the pre-Behavioral-Integration-V1 tie-break exactly (falls through to start-time ascending: DEEP_WORK\'s earlier start wins)',
  (() => {
    const { behavioralAffinityByFamily, ...withoutBehavior } = buildTiedCandidatesInput({});
    const result = deriveDailyGuidance(withoutBehavior);
    return result.recommendations[0].activityFamily === 'DEEP_WORK';
  })()
);

check(
  'AFFINITY TIE-BREAK: STRONG beats MODERATE, all else equal',
  deriveDailyGuidance(buildTiedCandidatesInput({ DEEP_WORK: 'MODERATE', LEARNING: 'STRONG' })).recommendations[0].activityFamily === 'LEARNING'
);

check(
  'AFFINITY TIE-BREAK: MODERATE beats NEUTRAL, all else equal',
  deriveDailyGuidance(buildTiedCandidatesInput({ DEEP_WORK: 'NEUTRAL', LEARNING: 'MODERATE' })).recommendations[0].activityFamily === 'LEARNING'
);

check(
  'AFFINITY TIE-BREAK: STRONG beats NEUTRAL, all else equal',
  deriveDailyGuidance(buildTiedCandidatesInput({ DEEP_WORK: 'NEUTRAL', LEARNING: 'STRONG' })).recommendations[0].activityFamily === 'LEARNING'
);

check(
  'MISSING FAMILY: a family absent from behavioralAffinityByFamily resolves to NEUTRAL (never throws) -- STRONG for the other family still wins',
  deriveDailyGuidance(buildTiedCandidatesInput({ LEARNING: 'STRONG' })).recommendations[0].activityFamily === 'LEARNING'
);

check(
  'PERSONAL RELEVANCE OUTRANKS AFFINITY (merge-critical): HIGHLY_RELEVANT + NEUTRAL beats RELEVANT + STRONG',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'GOOD', score: 8.0 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'GOOD', score: 8.0 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 2, behavioralAffinityByFamily: { DEEP_WORK: 'NEUTRAL', LEARNING: 'STRONG' } });
    return result.recommendations[0].activityFamily === 'DEEP_WORK';
  })()
);

check(
  'TIMING LABEL OUTRANKS AFFINITY (merge-critical): VERY_GOOD + NEUTRAL beats GOOD + STRONG',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'VERY_GOOD', score: 8.0 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'GOOD', score: 8.0 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 2, behavioralAffinityByFamily: { DEEP_WORK: 'NEUTRAL', LEARNING: 'STRONG' } });
    return result.recommendations[0].activityFamily === 'DEEP_WORK';
  })()
);

check(
  'TIMING SCORE OUTRANKS AFFINITY (merge-critical, proves affinity sits AFTER score in the tuple): same relevance, same label -- score 8.9 + NEUTRAL beats score 7.4 + STRONG',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'HIGHLY_RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'GOOD', score: 8.9 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'GOOD', score: 7.4 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 2, behavioralAffinityByFamily: { DEEP_WORK: 'NEUTRAL', LEARNING: 'STRONG' } });
    return result.recommendations[0].activityFamily === 'DEEP_WORK';
  })()
);

check(
  'CAUTION NEVER PROMOTED (merge-critical): HIGHLY_RELEVANT + CAUTION + STRONG is still never selected',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ FINANCE: 'HIGHLY_RELEVANT' });
    const windowRankings = [buildRanking('FINANCE', [buildWindow({ label: 'CAUTION', score: -2.0 })])];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3, behavioralAffinityByFamily: { FINANCE: 'STRONG' } });
    return result.recommendations.length === 0;
  })()
);

check(
  'NO FOURTH STAGE (merge-critical): BASELINE + USABLE + STRONG is still never selected -- affinity creates no new stage',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit(); // every family BASELINE
    const windowRankings = [buildRanking('MEAL', [buildWindow({ label: 'USABLE', score: 6.0 })])];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 3, behavioralAffinityByFamily: { MEAL: 'STRONG' } });
    return result.recommendations.length === 0;
  })()
);

check(
  'STAGE MEMBERSHIP UNCHANGED: affinity only sorts WITHIN a stage -- a RELEVANT+EXCELLENT+NEUTRAL candidate (Stage 1) still beats a HIGHLY_RELEVANT+USABLE+STRONG candidate (Stage 2)',
  (() => {
    const dailyPersonalFit = buildDailyPersonalFit({ DEEP_WORK: 'HIGHLY_RELEVANT', LEARNING: 'RELEVANT' });
    const windowRankings = [
      buildRanking('DEEP_WORK', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'USABLE', score: 6.0 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'EXCELLENT', score: 9.2 })]),
    ];
    const result = deriveDailyGuidance({ dailyPersonalFit, windowRankings, limit: 1, behavioralAffinityByFamily: { DEEP_WORK: 'STRONG', LEARNING: 'NEUTRAL' } });
    return result.recommendations.length === 1 && result.recommendations[0].activityFamily === 'LEARNING' && result.recommendations[0].selectionReason === 'PRIMARY_FLOOR_MET';
  })()
);

check(
  'DETERMINISM: behavioralAffinityByFamily key insertion order never affects the result',
  (() => {
    const a = deriveDailyGuidance(buildTiedCandidatesInput({ DEEP_WORK: 'NEUTRAL', LEARNING: 'STRONG' }));
    const b = deriveDailyGuidance(buildTiedCandidatesInput({ LEARNING: 'STRONG', DEEP_WORK: 'NEUTRAL' }));
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

check(
  'VALIDATION: a non-canonical family key in behavioralAffinityByFamily throws',
  expectThrows(() => {
    const input = buildTiedCandidatesInput({});
    (input.behavioralAffinityByFamily as Record<string, string>)['NOT_A_FAMILY'] = 'STRONG';
    return deriveDailyGuidance(input);
  })
);

check(
  'VALIDATION: an invalid tier value in behavioralAffinityByFamily throws',
  expectThrows(() => {
    const input = buildTiedCandidatesInput({});
    (input.behavioralAffinityByFamily as Record<string, string>)['DEEP_WORK'] = 'VERY_STRONG';
    return deriveDailyGuidance(input);
  })
);

check(
  'OUTPUT UNCHANGED: DailyGuidanceRecommendation carries no behavioralAffinity field -- #104\'s own public output contract is byte-for-byte unchanged by Behavioral Integration V1',
  (() => {
    const result = deriveDailyGuidance(buildTiedCandidatesInput({ DEEP_WORK: 'STRONG' }));
    return !('behavioralAffinity' in result.recommendations[0]);
  })()
);

// ============================================================
// STATIC SOURCE GUARDS.
// ============================================================

const SOURCE_FILES = ['constants', 'types', 'validation', 'eligibility', 'ordering', 'overlap', 'evidence', 'engine', 'provenance', 'index'];

function readDailyGuidanceSource(stripped = true): string {
  const files = SOURCE_FILES.map((name) => {
    const text = fs.readFileSync(`packages/daily-guidance/src/${name}.ts`, 'utf8');
    return stripped ? stripComments(text) : text;
  });
  return files.join('\n');
}

check(
  'no Date.now()/new Date() with no args/Math.random anywhere in the package source (comments stripped)',
  (() => {
    const code = readDailyGuidanceSource();
    return !/Date\.now\(\)/.test(code) && !/new Date\(\)(?!\.)/.test(code) && !/Math\.random\(\)/.test(code);
  })()
);

check(
  'no LLM/network usage anywhere in the package source (comments stripped)',
  !/openai|anthropic\b|\bllm\b|\bprompt\b/i.test(readDailyGuidanceSource())
);

check(
  'NO UPSTREAM RECOMPUTATION: no ACTUAL CALL (comments stripped) to runTimingSearch(, evaluateActivityFit(, evaluateMuhurta(, getPanchangForDate(, deriveLifeWeather(, or deriveDailyPersonalFit( anywhere in this package',
  !/runTimingSearch\(|evaluateActivityFit\(|evaluateMuhurta\(|getPanchangForDate\(|deriveLifeWeather\(|deriveDailyPersonalFit\(/.test(readDailyGuidanceSource())
);

check(
  'NO NUMERIC COMPOSITE: no forbidden identifier (guidanceScore/personalScore/combinedScore/priorityScore/weightedScore) and no arithmetic combination of RELEVANCE_TIER_ORDER, TIMING_LABEL_TIER_ORDER, or BEHAVIORAL_AFFINITY_TIER_ORDER with each other anywhere in this package',
  (() => {
    const code = readDailyGuidanceSource();
    return (
      !/guidanceScore|personalScore|combinedScore|priorityScore|weightedScore/i.test(code) &&
      !/RELEVANCE_TIER_ORDER\[[^\]]*\]\s*[+*]|TIMING_LABEL_TIER_ORDER\[[^\]]*\]\s*[+*]|BEHAVIORAL_AFFINITY_TIER_ORDER\[[^\]]*\]\s*[+*]/.test(code)
    );
  })()
);

check(
  'NO 90-MINUTE RULE: this package never reuses selectDiversePlanningOptions\' own 90-minute clock-proximity constant/logic',
  !/selectDiversePlanningOptions|90.{0,10}minute/i.test(readDailyGuidanceSource())
);

check(
  'NO SEMANTIC FAMILY GROUPING: no hand-authored group name (e.g. FOCUS_GROUP/WELLBEING_GROUP) anywhere in this package',
  !/FOCUS_GROUP|WELLBEING_GROUP|HEALTH_GROUP|semanticGroup/i.test(readDailyGuidanceSource())
);

check(
  'every import in this package is a relative import within itself, or into packages/personal-intelligence, packages/window-ranking, packages/muhurta, or packages/recommendation -- never packages/panchang, packages/bhrigu, apps/web, or Prisma',
  (() => {
    const code = readDailyGuidanceSource(false);
    const importLines = code.match(/from\s+'[^']+'/g) ?? [];
    return importLines.every((line) => /from\s+'(\.\.?\/|\.\.\/\.\.\/personal-intelligence\/|\.\.\/\.\.\/window-ranking\/|\.\.\/\.\.\/muhurta\/|\.\.\/\.\.\/recommendation\/)/.test(line));
  })()
);

// ============================================================
// ZERO-COUPLING REGRESSION (merge-critical).
// ============================================================

check(
  'ZERO COUPLING REGRESSION: packages/personal-intelligence still has no import from any other package (adding Daily Guidance contract types did not introduce a cross-package import)',
  (() => {
    const files = ['context', 'evidence', 'guidance', 'index', 'provenance', 'themes', 'types', 'validation'].map((name) => fs.readFileSync(`packages/personal-intelligence/src/${name}.ts`, 'utf8'));
    const code = files.join('\n');
    const importLines = code.match(/from\s+'[^']+'/g) ?? [];
    return importLines.every((line) => /from\s+'\.\/?/.test(line));
  })()
);

check(
  'ZERO COUPLING REGRESSION: no ACTUAL CODE (comments stripped) in packages/personal-intelligence references MuhurtaActivityFamily, TimingCandidateLabel, MuhurtaReason, TimingConflict, or WindowRankingContext',
  (() => {
    const files = ['context', 'evidence', 'guidance', 'index', 'provenance', 'themes', 'types', 'validation'].map((name) => stripComments(fs.readFileSync(`packages/personal-intelligence/src/${name}.ts`, 'utf8')));
    const code = files.join('\n');
    return !/MuhurtaActivityFamily|TimingCandidateLabel|MuhurtaReason|TimingConflict|WindowRankingContext/.test(code);
  })()
);

check('CONTRACT VERSION: CONTRACT_VERSION is still PERSONAL_INTELLIGENCE_CONTRACT_V2, no V3 bump', CONTRACT_VERSION === 'PERSONAL_INTELLIGENCE_CONTRACT_V2');

check(
  'OLD PLACEHOLDER PRESERVATION: DailyPersonalGuidance/PersonalRecommendation/PersonalActivityFit remain exactly as before -- no field added/removed/retyped',
  (() => {
    const src = fs.readFileSync('packages/personal-intelligence/src/guidance.ts', 'utf8');
    return (
      /interface\s+PersonalActivityFit\s*\{[^}]*activity:\s*ActivityIdentifier;[^}]*score:\s*NormalizedScore;[^}]*reasons:\s*PersonalReason\[\];[^}]*cautions:\s*PersonalReason\[\];[^}]*evidence:\s*PersonalEvidenceRef\[\];[^}]*\}/.test(src) &&
      /interface\s+PersonalRecommendation\s*\{[^}]*activity:\s*ActivityIdentifier;[^}]*startAt\?:\s*string;[^}]*endAt\?:\s*string;[^}]*score:\s*NormalizedScore;[^}]*\}/.test(src) &&
      /interface\s+DailyPersonalGuidance\s*\{[^}]*version:\s*string;[^}]*date:\s*string;[^}]*timezone:\s*string;[^}]*headline:\s*string;[^}]*summary:\s*string;[^}]*dominantThemes:\s*PersonalThemeSignal\[\];[^}]*recommendations:\s*PersonalRecommendation\[\];[^}]*evidence:\s*PersonalEvidenceRef\[\];[^}]*\}/.test(src)
    );
  })()
);

check(
  'packages/muhurta/src/muhurtaEngine.ts and packages/window-ranking/src/*.ts have no ACTUAL IMPORT of packages/daily-guidance (dependency direction preserved)',
  (() => {
    const muhurta = stripComments(fs.readFileSync('packages/muhurta/src/muhurtaEngine.ts', 'utf8'));
    const wr = ['adapter', 'constants', 'engine', 'index', 'normalize', 'provenance', 'types', 'validation'].map((n) => stripComments(fs.readFileSync(`packages/window-ranking/src/${n}.ts`, 'utf8'))).join('\n');
    return !/import[^;]*from\s+['"][^'"]*daily-guidance[^'"]*['"]/.test(muhurta) && !/import[^;]*from\s+['"][^'"]*daily-guidance[^'"]*['"]/.test(wr);
  })()
);

if (!allPassed) {
  console.error('\nSome Daily Guidance Composer Engine checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL DAILY GUIDANCE COMPOSER ENGINE CHECKS PASSED');
}
