/**
 * New Aura Home V1: pure-logic regression suite for
 * apps/web/lib/bestForYouViewModel.ts. Plain .ts import only (no .tsx) --
 * runnable via this repo's standard `npx ts-node test/*.test.ts`
 * invocation with no jsx compiler flag, unlike the small number of
 * existing Home-adjacent test files that import a .tsx file directly
 * (test/homeDashboardGoodRightNow.test.ts) and are, as a result,
 * confirmed NOT wired into .github/workflows/ci.yml today -- this file
 * deliberately avoids repeating that gap by keeping all Best For You
 * mapping/ordering/fallback logic in this plain .ts module.
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

import { mapGuidanceToBestForYouItems, formatFamilyFallbackTitle } from '../apps/web/lib/bestForYouViewModel';
import type { SelectedActivityMetadata } from '../apps/web/lib/dailyGuidanceTypes';
import type { DailyGuidanceContext, DailyGuidanceRecommendation } from '../packages/personal-intelligence/src/context';

// ============================================================
// Fixture builders.
// ============================================================

function buildRecommendation(overrides: Partial<DailyGuidanceRecommendation> = {}): DailyGuidanceRecommendation {
  return {
    rank: 1,
    activityFamily: 'DEEP_WORK',
    personalRelevance: 'HIGHLY_RELEVANT',
    relevantThemes: [],
    timing: { start: '2026-09-09T04:00:00.000Z', end: '2026-09-09T05:00:00.000Z', score: 8.5, label: 'VERY_GOOD', windowRank: 1 },
    selectionReason: 'PRIMARY_FLOOR_MET',
    evidence: [],
    ...overrides,
  };
}

function buildGuidance(recommendations: DailyGuidanceRecommendation[]): DailyGuidanceContext {
  return {
    engineVersion: 'DAILY_GUIDANCE_V1',
    selectionPolicyVersion: 'DAILY_GUIDANCE_SELECTION_POLICY_V1',
    evaluationTime: '2026-09-09T12:00:00.000Z',
    recommendations,
    evidence: [],
  };
}

function buildMetadata(overrides: Partial<SelectedActivityMetadata> = {}): SelectedActivityMetadata {
  return { activityId: 'deep-work', title: 'Deep Work Block', source: 'PLAN', sourceEntityId: 'plan-1', ...overrides };
}

// ============================================================
// ORDER PRESERVATION -- merge-critical.
// ============================================================

check(
  'ORDER PRESERVATION: 3 recommendations (RELATIONSHIP, DEEP_WORK, LEARNING) map to 3 items in the exact same order -- no time/score/family/source resort',
  (() => {
    const recommendations = [
      buildRecommendation({ rank: 1, activityFamily: 'RELATIONSHIP', timing: { start: '2026-09-09T10:00:00.000Z', end: '2026-09-09T11:00:00.000Z', score: 7.0, label: 'GOOD', windowRank: 1 } }),
      buildRecommendation({ rank: 2, activityFamily: 'DEEP_WORK', timing: { start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', score: 9.5, label: 'EXCELLENT', windowRank: 1 } }),
      buildRecommendation({ rank: 3, activityFamily: 'LEARNING', timing: { start: '2026-09-09T06:00:00.000Z', end: '2026-09-09T07:00:00.000Z', score: 8.0, label: 'VERY_GOOD', windowRank: 1 } }),
    ];
    const selectedActivities = {
      RELATIONSHIP: buildMetadata({ activityId: 'date-night', title: 'Date Night', sourceEntityId: 'plan-r' }),
      DEEP_WORK: buildMetadata({ activityId: 'deep-work', title: 'Deep Work Block', sourceEntityId: 'plan-d' }),
      LEARNING: buildMetadata({ activityId: 'learning', title: 'Learning Session', sourceEntityId: 'plan-l' }),
    };
    const items = mapGuidanceToBestForYouItems(buildGuidance(recommendations), selectedActivities);
    return items.length === 3 && items[0].title === 'Date Night' && items[1].title === 'Deep Work Block' && items[2].title === 'Learning Session' && items.every((item, i) => item.rank === i + 1);
  })()
);

check(
  '3-ITEM: three recommendations produce exactly three mapped items',
  mapGuidanceToBestForYouItems(
    buildGuidance([buildRecommendation({ rank: 1, activityFamily: 'DEEP_WORK' }), buildRecommendation({ rank: 2, activityFamily: 'LEARNING' }), buildRecommendation({ rank: 3, activityFamily: 'MEAL' })]),
    { DEEP_WORK: buildMetadata(), LEARNING: buildMetadata({ activityId: 'learning', title: 'Learning' }), MEAL: buildMetadata({ activityId: 'meal', title: 'Lunch' }) }
  ).length === 3
);

check(
  '2-ITEM: two recommendations produce exactly two mapped items, no placeholder third',
  mapGuidanceToBestForYouItems(buildGuidance([buildRecommendation({ rank: 1, activityFamily: 'DEEP_WORK' }), buildRecommendation({ rank: 2, activityFamily: 'LEARNING' })]), {
    DEEP_WORK: buildMetadata(),
    LEARNING: buildMetadata({ activityId: 'learning', title: 'Learning' }),
  }).length === 2
);

check('1-ITEM: one recommendation produces exactly one mapped item', mapGuidanceToBestForYouItems(buildGuidance([buildRecommendation({ rank: 1 })]), { DEEP_WORK: buildMetadata() }).length === 1);

check('0-ITEM: an empty recommendations array maps to an empty items array, no fabricated data', mapGuidanceToBestForYouItems(buildGuidance([]), {}).length === 0);

// ============================================================
// CONCRETE TITLE / FALLBACK.
// ============================================================

check(
  'CONCRETE TITLE: a matching selectedActivities entry\'s title is preserved verbatim',
  mapGuidanceToBestForYouItems(buildGuidance([buildRecommendation()]), { DEEP_WORK: buildMetadata({ title: 'Budget Review' }) })[0].title === 'Budget Review'
);

check(
  'FALLBACK TITLE: a missing selectedActivities entry for DEEP_WORK falls back to the mechanical Title-Case family label, never crashes',
  mapGuidanceToBestForYouItems(buildGuidance([buildRecommendation({ activityFamily: 'DEEP_WORK' })]), {})[0].title === 'Deep work'
);

check('JOURNEY FALLBACK: JOURNEY_START mechanically formats to "Journey start" -- no semantic rewrite', formatFamilyFallbackTitle('JOURNEY_START') === 'Journey start');
check('RELATIONSHIP FALLBACK: mechanical formatting only -- never "Important conversation" or any other invented meaning', formatFamilyFallbackTitle('RELATIONSHIP') === 'Relationship');
check('formatFamilyFallbackTitle is deterministic (same input -> same output)', formatFamilyFallbackTitle('FOCUSED_WORK') === formatFamilyFallbackTitle('FOCUSED_WORK') && formatFamilyFallbackTitle('FOCUSED_WORK') === 'Focused work');

check(
  'FALLBACK LOGGING: a missing selectedActivities entry logs an unexpected-contract-mismatch console.error rather than failing silently',
  (() => {
    const originalError = console.error;
    let loggedCount = 0;
    console.error = () => {
      loggedCount++;
    };
    try {
      mapGuidanceToBestForYouItems(buildGuidance([buildRecommendation({ activityFamily: 'WORKOUT' })]), {});
    } finally {
      console.error = originalError;
    }
    return loggedCount === 1;
  })()
);

// ============================================================
// RAW-CODE LEAK GUARD.
// ============================================================

check(
  'RAW CODE LEAK: mapped item fields never contain raw engine enum values (family/relevance/selectionReason/engineVersion literals) -- only the formatted fallback title, never the raw family string itself',
  (() => {
    const items = mapGuidanceToBestForYouItems(buildGuidance([buildRecommendation({ activityFamily: 'DEEP_WORK' })]), {});
    const serialized = JSON.stringify(items);
    return !/HIGHLY_RELEVANT|PRIMARY_FLOOR_MET|DAILY_GUIDANCE_V1|DAILY_GUIDANCE_SELECTION_POLICY_V1|"DEEP_WORK"/.test(serialized);
  })()
);

// ============================================================
// IMMUTABILITY.
// ============================================================

check(
  'IMMUTABILITY: neither guidance nor selectedActivities is mutated by the mapper',
  (() => {
    const guidance = buildGuidance([buildRecommendation()]);
    const selectedActivities = { DEEP_WORK: buildMetadata() };
    const guidanceClone = JSON.parse(JSON.stringify(guidance));
    const selectedClone = JSON.parse(JSON.stringify(selectedActivities));
    mapGuidanceToBestForYouItems(guidance, selectedActivities);
    return JSON.stringify(guidance) === JSON.stringify(guidanceClone) && JSON.stringify(selectedActivities) === JSON.stringify(selectedClone);
  })()
);

// ============================================================
// STATIC GUARDS -- merge-critical.
// ============================================================

function readViewModelSource(stripped = true): string {
  const text = fs.readFileSync('apps/web/lib/bestForYouViewModel.ts', 'utf8');
  return stripped ? stripComments(text) : text;
}

check('NO SORT: bestForYouViewModel.ts never calls .sort( anywhere in its own source', !/\.sort\(/.test(readViewModelSource()));

check(
  'NO ENGINE IMPORT: bestForYouViewModel.ts imports only types (DailyGuidanceContext, SelectedActivityMetadata, PersonalDailyGuidanceResult) -- no runtime import of any ranking/scoring/timing engine',
  (() => {
    const code = readViewModelSource(false);
    const importLines = code.match(/^import[^;]*;/gm) ?? [];
    return importLines.every((line) => /^import type /.test(line)) && !/runTimingSearch\(|evaluateActivityFit\(|deriveWindowRanking\(|deriveDailyGuidance\(|deriveDailyPersonalFit\(|deriveLifeWeather\(/.test(code);
  })()
);

check('NO SEMANTIC RELABELING: no hand-authored family-to-meaning dictionary (e.g. a RELATIONSHIP-keyed string literal map) anywhere in the source', !/RELATIONSHIP['"]?\s*:\s*['"]/.test(readViewModelSource()));

if (!allPassed) {
  console.error('\nSome Best For You view-model checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL BEST FOR YOU VIEW MODEL CHECKS PASSED');
}
