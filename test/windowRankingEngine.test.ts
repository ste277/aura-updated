/**
 * Window Ranking Engine V1: regression suite for packages/window-ranking/src --
 * a deterministic formalization of packages/recommendation's own already-live
 * timing-search ranking (runTimingSearch) into an explicit, per-activity-family
 * contract. See packages/window-ranking/README.md for the full convention
 * (order-preservation is authoritative -- the pure core never re-sorts;
 * personal relevance is deliberately absent) this suite verifies against.
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

import { deriveWindowRanking, rankActivityWindowsFromTimingSearch, WINDOW_RANKING_ENGINE_VERSION, WindowRankingValidationError } from '../packages/window-ranking/src/index';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import type { TimingCandidate, TimingConflict } from '../packages/recommendation/src/timingSearch';
import type { MuhurtaReason } from '../packages/muhurta/src/activityOntology';
import type { WindowRankingInput } from '../packages/window-ranking/src/index';

// ============================================================
// Fixture builders.
// ============================================================

function buildCandidate(overrides: Partial<TimingCandidate> = {}): TimingCandidate {
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

const chennaiContext = {
  now: new Date(Date.UTC(2026, 7, 21, 4, 0, 0)),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

// ============================================================
// RANK ASSIGNMENT.
// ============================================================

check(
  'RANK ASSIGNMENT: 3 candidates -> ranks 1, 2, 3, in exact input order',
  (() => {
    const a = buildCandidate({ start: '2026-09-09T04:00:00.000Z' });
    const b = buildCandidate({ start: '2026-09-09T06:00:00.000Z' });
    const c = buildCandidate({ start: '2026-09-09T08:00:00.000Z' });
    const result = deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates: [a, b, c] });
    return result.windows[0].rank === 1 && result.windows[0].start === a.start && result.windows[1].rank === 2 && result.windows[1].start === b.start && result.windows[2].rank === 3 && result.windows[2].start === c.start;
  })()
);

// ============================================================
// ORDER PRESERVATION OVER SCORE -- merge-critical.
// ============================================================

check(
  'ORDER PRESERVATION OVER SCORE: candidate[0].score=7.0, candidate[1].score=9.0 -- output order remains candidate 0 rank 1, candidate 1 rank 2 (never re-sorted by score)',
  (() => {
    const lowerScoreFirst = buildCandidate({ start: '2026-09-09T04:00:00.000Z', score: 7.0 });
    const higherScoreSecond = buildCandidate({ start: '2026-09-09T06:00:00.000Z', score: 9.0 });
    const result = deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates: [lowerScoreFirst, higherScoreSecond] });
    return result.windows[0].rank === 1 && result.windows[0].score === 7.0 && result.windows[1].rank === 2 && result.windows[1].score === 9.0;
  })()
);

// ============================================================
// NO MUTATION.
// ============================================================

check(
  'NO MUTATION: input candidates array (and its own nested objects) remain deeply equal after deriveWindowRanking runs',
  (() => {
    const candidates = [buildCandidate({ reasons: [{ code: 'ABHIJIT_SUPPORT', factor: 'SOLAR_WINDOW', polarity: 'SUPPORT', impact: 8 }] })];
    const clone = JSON.parse(JSON.stringify(candidates));
    deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates });
    return JSON.stringify(candidates) === JSON.stringify(clone);
  })()
);

// ============================================================
// FIELD PRESERVATION.
// ============================================================

check(
  'FIELD PRESERVATION: start/end/score/label/muhurtaScore/auraFitScore/reasons/conflicts/metadata all preserved exactly, only `rank` added',
  (() => {
    const reasons: MuhurtaReason[] = [{ code: 'ABHIJIT_SUPPORT', factor: 'SOLAR_WINDOW', polarity: 'SUPPORT', impact: 8, value: 'ABHIJIT' }];
    const conflicts: TimingConflict[] = [{ type: 'DURATION_EXCEEDS_DAY', message: 'test conflict message' }];
    const candidate = buildCandidate({ reasons, conflicts, muhurtaScore: 12, auraFitScore: 91 });
    const result = deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates: [candidate] });
    const window = result.windows[0];
    return (
      window.rank === 1 &&
      window.start === candidate.start &&
      window.end === candidate.end &&
      window.score === candidate.score &&
      window.label === candidate.label &&
      window.muhurtaScore === 12 &&
      window.auraFitScore === 91 &&
      JSON.stringify(window.reasons) === JSON.stringify(reasons) &&
      JSON.stringify(window.conflicts) === JSON.stringify(conflicts) &&
      JSON.stringify(window.metadata) === JSON.stringify(candidate.metadata)
    );
  })()
);

// ============================================================
// EMPTY RESULT.
// ============================================================

check(
  'EMPTY RESULT: candidates=[] -> windows=[], with a valid engineVersion and activityFamily, never an error',
  (() => {
    const result = deriveWindowRanking({ activityFamily: 'FINANCE', candidates: [] });
    return result.windows.length === 0 && result.engineVersion === WINDOW_RANKING_ENGINE_VERSION && result.activityFamily === 'FINANCE';
  })()
);

check('engineVersion is the stable WINDOW_RANKING_V1 literal', WINDOW_RANKING_ENGINE_VERSION === 'WINDOW_RANKING_V1');

// ============================================================
// CAUTION RETENTION.
// ============================================================

check(
  'CAUTION RETENTION: a CAUTION-labeled candidate is present, ranked, and unchanged -- never filtered',
  (() => {
    const cautionCandidate = buildCandidate({ label: 'CAUTION', score: 3.0 });
    const goodCandidate = buildCandidate({ start: '2026-09-09T06:00:00.000Z', label: 'GOOD', score: 7.5 });
    const result = deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates: [cautionCandidate, goodCandidate] });
    return result.windows.length === 2 && result.windows[0].label === 'CAUTION' && result.windows[0].rank === 1 && result.windows[1].label === 'GOOD' && result.windows[1].rank === 2;
  })()
);

// ============================================================
// REASON POLARITY PRESERVED.
// ============================================================

check(
  'REASON POLARITY PRESERVED: SUPPORT and CAUTION reasons on the same candidate both survive with their exact polarity -- never collapsed into a synthetic MIXED status',
  (() => {
    const reasons: MuhurtaReason[] = [
      { code: 'ABHIJIT_SUPPORT', factor: 'SOLAR_WINDOW', polarity: 'SUPPORT', impact: 8 },
      { code: 'RAHU_CAUTION', factor: 'SOLAR_WINDOW', polarity: 'CAUTION', impact: -4 },
    ];
    const result = deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates: [buildCandidate({ reasons })] });
    const window = result.windows[0];
    return window.reasons.length === 2 && window.reasons[0].polarity === 'SUPPORT' && window.reasons[1].polarity === 'CAUTION' && !('status' in window) && !('mixed' in window);
  })()
);

// ============================================================
// CONFLICT PRESERVATION.
// ============================================================

check(
  'CONFLICT PRESERVATION: TimingConflict[] input retained exactly in output',
  (() => {
    const conflicts: TimingConflict[] = [{ type: 'FRICTION_WINDOW_BLOCKED', message: 'This time falls in a high-friction period.' }];
    const result = deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates: [buildCandidate({ conflicts })] });
    return JSON.stringify(result.windows[0].conflicts) === JSON.stringify(conflicts);
  })()
);

// ============================================================
// DETERMINISM.
// ============================================================

check(
  'DETERMINISM: repeated calls with structurally identical input produce deeply-equal output',
  (() => {
    const input: WindowRankingInput = { activityFamily: 'LEARNING', candidates: [buildCandidate(), buildCandidate({ start: '2026-09-09T06:00:00.000Z' })] };
    return JSON.stringify(deriveWindowRanking(input)) === JSON.stringify(deriveWindowRanking(input));
  })()
);

check(
  'no Date.now()/new Date() with no args/Math.random anywhere in the package source (comments stripped)',
  (() => {
    const files = ['constants', 'types', 'validation', 'normalize', 'engine', 'adapter', 'provenance', 'index'].map((name) => stripComments(fs.readFileSync(`packages/window-ranking/src/${name}.ts`, 'utf8')));
    const code = files.join('\n');
    return !/Date\.now\(\)/.test(code) && !/new Date\(\)(?!\.)/.test(code) && !/Math\.random\(\)/.test(code);
  })()
);

// ============================================================
// ONE ACTIVITY ONLY -- no global/cross-family structure.
// ============================================================

check(
  'ONE ACTIVITY ONLY: WindowRankingContext has exactly one activityFamily and one ranked window list -- never a Map/array of families',
  (() => {
    const result = deriveWindowRanking({ activityFamily: 'SOCIAL', candidates: [buildCandidate()] });
    return typeof result.activityFamily === 'string' && Array.isArray(result.windows) && !('activityFamilies' in result) && !('families' in result);
  })()
);

// ============================================================
// NO PERSONAL RELEVANCE -- static source guard, merge-critical.
// ============================================================

check(
  'NO PERSONAL RELEVANCE: no ACTUAL CODE (comments stripped) references DailyPersonalFitContext, DailyActivityFit, PersonalRelevance, LifeWeatherContext, or packages/daily-personal-fit anywhere in this package',
  (() => {
    const files = ['constants', 'types', 'validation', 'normalize', 'engine', 'adapter', 'provenance', 'index'].map((name) => stripComments(fs.readFileSync(`packages/window-ranking/src/${name}.ts`, 'utf8')));
    const code = files.join('\n');
    return !/DailyPersonalFitContext|DailyActivityFit|PersonalRelevance|LifeWeatherContext|daily-personal-fit|personal-intelligence|life-weather|Bhrigu|Dasha|TransitActivation/i.test(code);
  })()
);

// ============================================================
// NO NEW SCORING FORMULA -- static source guard.
// ============================================================

check(
  'NO NEW SCORING FORMULA: no Aura Fit weight constants (0.45/0.20/0.10/0.05) or Muhurta modifier math anywhere in this package -- scoring stays owned by packages/recommendation and packages/muhurta',
  (() => {
    const files = ['constants', 'types', 'validation', 'normalize', 'engine', 'adapter', 'provenance', 'index'].map((name) => stripComments(fs.readFileSync(`packages/window-ranking/src/${name}.ts`, 'utf8')));
    const code = files.join('\n');
    return !/0\.45|0\.20|0\.10|muhurta\.modifier\s*\*|capabilities\.friction/i.test(code);
  })()
);

// ============================================================
// NO SORT -- static source guard, merge-critical.
// ============================================================

check(
  'NO SORT: no .sort( or .toSorted( anywhere in this package\'s own source (order authority belongs entirely to the input array)',
  (() => {
    const files = ['constants', 'types', 'validation', 'normalize', 'engine', 'adapter', 'provenance', 'index'].map((name) => stripComments(fs.readFileSync(`packages/window-ranking/src/${name}.ts`, 'utf8')));
    const code = files.join('\n');
    return !/\.sort\(|\.toSorted\(/.test(code);
  })()
);

// ============================================================
// NO REVERSE PROFILE INVENTION -- static source guard.
// ============================================================

check(
  'NO REVERSE PROFILE INVENTION: no production map from a MuhurtaActivityFamily literal to an ActivityProfile/activityId literal anywhere in this package',
  (() => {
    const adapterSrc = stripComments(fs.readFileSync('packages/window-ranking/src/adapter.ts', 'utf8'));
    // None of the 13 canonical family names appear as an object KEY mapping
    // to a hardcoded activity id/string literal (e.g. "DEEP_WORK: 'deep-work-default'").
    return !/(DEEP_WORK|WORKOUT|LEARNING|MEDITATION|RELATIONSHIP|JOURNEY_START|SOCIAL|MEAL|FINANCE|NEW_BEGINNING|ADMIN|WELLBEING|FOCUSED_WORK)\s*:\s*['"]/.test(adapterSrc);
  })()
);

check(
  'EXCLUSION GUARDS: no ACTUAL CODE (comments stripped) references packages/panchang directly, evaluateMuhurta, evaluateActivityFit, or getPanchangForDate -- only type-only imports from packages/recommendation and packages/muhurta are permitted',
  (() => {
    const files = ['constants', 'types', 'validation', 'normalize', 'engine', 'provenance', 'index'].map((name) => stripComments(fs.readFileSync(`packages/window-ranking/src/${name}.ts`, 'utf8')));
    const code = files.join('\n');
    return !/evaluateMuhurta\(|evaluateActivityFit\(|getPanchangForDate\(|packages\/panchang/.test(code);
  })()
);

check(
  'every import in this package is a relative import within itself, or into packages/muhurta or packages/recommendation -- never packages/panchang, packages/personal-intelligence, packages/daily-personal-fit, packages/life-weather, apps/web, or Prisma',
  (() => {
    const files = ['constants', 'types', 'validation', 'normalize', 'engine', 'adapter', 'provenance', 'index'].map((name) => fs.readFileSync(`packages/window-ranking/src/${name}.ts`, 'utf8'));
    const code = files.join('\n');
    const importLines = code.match(/from\s+'[^']+'/g) ?? [];
    return importLines.every((line) => /from\s+'(\.\.?\/|\.\.\/\.\.\/muhurta\/|\.\.\/\.\.\/recommendation\/)/.test(line));
  })()
);

// ============================================================
// VALIDATION.
// ============================================================

function expectThrows(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof WindowRankingValidationError;
  }
}

check('rejects a non-canonical activityFamily', expectThrows(() => deriveWindowRanking({ activityFamily: 'NOT_A_FAMILY' as never, candidates: [] })));
check('rejects a non-array candidates value', expectThrows(() => deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates: 'not-an-array' as never })));
check('rejects a candidate missing start', expectThrows(() => deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates: [{ ...buildCandidate(), start: '' }] })));
check('rejects a candidate with a non-finite score', expectThrows(() => deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates: [{ ...buildCandidate(), score: NaN }] })));
check('accepts a candidate with a negative score (CAUTION-range) without throwing', !expectThrows(() => deriveWindowRanking({ activityFamily: 'DEEP_WORK', candidates: [buildCandidate({ score: -1 })] })));

// ============================================================
// ADAPTER -- real runTimingSearch integration.
// ============================================================

const REAL_FIND_REQUEST = {
  activityId: 'dating',
  durationMinutes: 120,
  horizon: 'WEEKEND' as const,
  timePreference: 'EVENING' as const,
  context: chennaiContext,
  limit: 3,
};

check(
  'ADAPTER ORDER MATCHES runTimingSearch: same N, same order, rank = index+1, same start/end for every candidate',
  (() => {
    const direct = runTimingSearch({ mode: 'FIND', ...REAL_FIND_REQUEST });
    const viaAdapter = rankActivityWindowsFromTimingSearch({ activityFamily: 'RELATIONSHIP', ...REAL_FIND_REQUEST });
    if (direct.candidates.length === 0) return false; // fixture must produce real candidates for this test to be meaningful
    return (
      viaAdapter.windows.length === direct.candidates.length &&
      viaAdapter.windows.every((window, i) => window.rank === i + 1 && window.start === direct.candidates[i].start && window.end === direct.candidates[i].end)
    );
  })()
);

check(
  'ADAPTER DOES NOT CHANGE SCORE: every window\'s score/label/muhurtaScore/auraFitScore exactly matches the corresponding runTimingSearch candidate',
  (() => {
    const direct = runTimingSearch({ mode: 'FIND', ...REAL_FIND_REQUEST });
    const viaAdapter = rankActivityWindowsFromTimingSearch({ activityFamily: 'RELATIONSHIP', ...REAL_FIND_REQUEST });
    if (direct.candidates.length === 0) return false;
    return viaAdapter.windows.every((window, i) => {
      const original = direct.candidates[i];
      return window.score === original.score && window.label === original.label && window.muhurtaScore === original.muhurtaScore && window.auraFitScore === original.auraFitScore;
    });
  })()
);

check('ADAPTER: WindowRankingContext.activityFamily reflects the caller-supplied family, not anything derived from the resolved activity', rankActivityWindowsFromTimingSearch({ activityFamily: 'RELATIONSHIP', ...REAL_FIND_REQUEST }).activityFamily === 'RELATIONSHIP');

check(
  'ADAPTER: reasons/conflicts are forwarded verbatim from runTimingSearch output',
  (() => {
    const direct = runTimingSearch({ mode: 'FIND', ...REAL_FIND_REQUEST });
    const viaAdapter = rankActivityWindowsFromTimingSearch({ activityFamily: 'RELATIONSHIP', ...REAL_FIND_REQUEST });
    if (direct.candidates.length === 0) return false;
    return viaAdapter.windows.every((window, i) => JSON.stringify(window.reasons) === JSON.stringify(direct.candidates[i].reasons) && JSON.stringify(window.conflicts) === JSON.stringify(direct.candidates[i].conflicts));
  })()
);

if (!allPassed) {
  console.error('\nSome Window Ranking Engine checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL WINDOW RANKING ENGINE CHECKS PASSED');
}
