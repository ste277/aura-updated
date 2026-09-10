/**
 * Why Aura V1: pure-logic regression suite for
 * apps/web/lib/whyAuraViewModel.ts. Plain .ts import only (no .tsx) --
 * runnable via this repo's standard `npx ts-node test/*.test.ts` invocation
 * with no jsx compiler flag, following the exact same precedent
 * test/bestForYouViewModel.test.ts already established.
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

import { buildWhyAuraExplanation, deriveWhyAuraExplanation, resolveExpandedWhyAuraId } from '../apps/web/lib/whyAuraViewModel';
import type { DailyGuidanceRecommendation } from '../packages/personal-intelligence/src/context';
import type { ConcreteGuidanceCandidateSource } from '../apps/web/lib/dailyGuidanceTypes';

// ============================================================
// Fixture builder.
// ============================================================

type LifeWeatherState = 'QUIET' | 'ACTIVE' | 'STRONGLY_ACTIVE';

function buildRecommendation(overrides: Partial<DailyGuidanceRecommendation> = {}): DailyGuidanceRecommendation {
  return {
    rank: 1,
    activityFamily: 'DEEP_WORK',
    personalRelevance: 'RELEVANT',
    relevantThemes: [{ theme: 'FOCUS', state: 'ACTIVE' as LifeWeatherState }],
    timing: { start: '2026-09-09T04:00:00.000Z', end: '2026-09-09T05:00:00.000Z', score: 8.5, label: 'VERY_GOOD', windowRank: 1 },
    selectionReason: 'PRIMARY_FLOOR_MET',
    evidence: [],
    ...overrides,
  };
}

const PLAN: ConcreteGuidanceCandidateSource = 'PLAN';
const DAY_BUILDER: ConcreteGuidanceCandidateSource = 'DAY_BUILDER_INTENTION';

// ============================================================
// PERSONAL RELEVANCE POLICY.
// ============================================================

check(
  'HIGHLY_RELEVANT: strong wording, both themes named',
  (() => {
    const rec = buildRecommendation({
      personalRelevance: 'HIGHLY_RELEVANT',
      relevantThemes: [
        { theme: 'FOCUS', state: 'STRONGLY_ACTIVE' },
        { theme: 'CAREER', state: 'ACTIVE' },
      ],
    });
    const { lines } = buildWhyAuraExplanation(rec, PLAN);
    return lines[0] === 'This strongly fits your focus and career themes, which are active for you today.';
  })()
);

check(
  'RELEVANT: normal wording, not "strongly"',
  (() => {
    const rec = buildRecommendation({ personalRelevance: 'RELEVANT', relevantThemes: [{ theme: 'FOCUS', state: 'ACTIVE' }] });
    const { lines } = buildWhyAuraExplanation(rec, PLAN);
    return lines[0] === 'This fits your focus theme, which is active for you today.' && !lines[0].includes('strongly');
  })()
);

check(
  'BASELINE: no personal-fit line at all -- timing only',
  (() => {
    const rec = buildRecommendation({ personalRelevance: 'BASELINE', relevantThemes: [{ theme: 'FOCUS', state: 'STRONGLY_ACTIVE' }] });
    const { lines } = buildWhyAuraExplanation(rec, PLAN);
    return lines.length === 1 && !lines[0].toLowerCase().includes('theme');
  })()
);

check(
  'QUIET theme: never displayed, even when personalRelevance is elevated by another theme',
  (() => {
    const rec = buildRecommendation({
      personalRelevance: 'RELEVANT',
      relevantThemes: [
        { theme: 'FOCUS', state: 'ACTIVE' },
        { theme: 'LEARNING', state: 'QUIET' },
      ],
    });
    const { lines } = buildWhyAuraExplanation(rec, PLAN);
    return lines[0].includes('focus') && !lines[0].includes('learning');
  })()
);

// ============================================================
// THEME PRIORITY / TRUNCATION.
// ============================================================

check(
  'THEME PRIORITY: STRONGLY_ACTIVE themes come before ACTIVE themes, max 2 shown',
  (() => {
    const rec = buildRecommendation({
      personalRelevance: 'HIGHLY_RELEVANT',
      relevantThemes: [
        { theme: 'FOCUS', state: 'ACTIVE' },
        { theme: 'CAREER', state: 'STRONGLY_ACTIVE' },
        { theme: 'LEARNING', state: 'ACTIVE' },
      ],
    });
    const explanation = deriveWhyAuraExplanation(rec);
    const personal = explanation.reasons.find((r) => r.kind === 'PERSONAL_THEME');
    return JSON.stringify(personal?.themes) === JSON.stringify(['CAREER', 'FOCUS']);
  })()
);

check(
  '0 ACTIVE THEMES: personalRelevance elevated but no theme survives filtering -- no personal line, never crashes',
  (() => {
    // Defensive/structurally-unreachable case: personalRelevance says RELEVANT but every relevantThemes entry is QUIET.
    const rec = buildRecommendation({ personalRelevance: 'RELEVANT', relevantThemes: [{ theme: 'FOCUS', state: 'QUIET' }] });
    const { lines } = buildWhyAuraExplanation(rec, PLAN);
    return lines.length === 1 && !lines[0].toLowerCase().includes('theme');
  })()
);

check(
  '1 THEME GRAMMAR: "your focus theme" (singular)',
  buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'RELEVANT', relevantThemes: [{ theme: 'FOCUS', state: 'ACTIVE' }] }), PLAN).lines[0] ===
    'This fits your focus theme, which is active for you today.'
);

check(
  '2 THEME GRAMMAR: "your focus and career themes" (plural, "and")',
  buildWhyAuraExplanation(
    buildRecommendation({
      personalRelevance: 'RELEVANT',
      relevantThemes: [
        { theme: 'FOCUS', state: 'ACTIVE' },
        { theme: 'CAREER', state: 'ACTIVE' },
      ],
    }),
    PLAN
  ).lines[0] === 'This fits your focus and career themes, which are active for you today.'
);

check(
  '3+ THEMES: at most 2 names rendered, no third theme leaks into the line',
  (() => {
    const rec = buildRecommendation({
      personalRelevance: 'HIGHLY_RELEVANT',
      relevantThemes: [
        { theme: 'FOCUS', state: 'STRONGLY_ACTIVE' },
        { theme: 'CAREER', state: 'STRONGLY_ACTIVE' },
        { theme: 'LEARNING', state: 'STRONGLY_ACTIVE' },
      ],
    });
    const { lines } = buildWhyAuraExplanation(rec, PLAN);
    return !lines[0].includes('learning') && (lines[0].includes('focus') || lines[0].includes('career'));
  })()
);

// ============================================================
// TIMING WORDING.
// ============================================================

check(
  'TIMING EXCELLENT: "especially supportive"',
  buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'BASELINE', timing: { ...buildRecommendation().timing, label: 'EXCELLENT' } }), PLAN).lines[0] ===
    'Your planned time is especially supportive for this.'
);

check(
  'TIMING VERY_GOOD: "very supportive"',
  buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'BASELINE', timing: { ...buildRecommendation().timing, label: 'VERY_GOOD' } }), PLAN).lines[0] ===
    'Your planned time is very supportive for this.'
);

check(
  'TIMING GOOD: "supportive"',
  buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'BASELINE', timing: { ...buildRecommendation().timing, label: 'GOOD' } }), PLAN).lines[0] ===
    'Your planned time is supportive for this.'
);

check(
  'TIMING USABLE: "workable" -- never excellent/best/strongly supportive',
  (() => {
    const line = buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'BASELINE', timing: { ...buildRecommendation().timing, label: 'USABLE' } }), PLAN).lines[0];
    return line === 'Your planned time is workable for this.' && !/excellent|best|strongly supportive/i.test(line);
  })()
);

// ============================================================
// SELECTION-REASON ORDERING.
// ============================================================

check(
  'PRIMARY_FLOOR_MET: personal line precedes timing line',
  (() => {
    const rec = buildRecommendation({ personalRelevance: 'RELEVANT', selectionReason: 'PRIMARY_FLOOR_MET' });
    const { lines } = buildWhyAuraExplanation(rec, PLAN);
    return lines.length === 2 && lines[0].includes('theme') && lines[1].includes('supportive');
  })()
);

check(
  'RELAXED_TIMING_FLOOR: personal line still precedes timing line',
  (() => {
    const rec = buildRecommendation({ personalRelevance: 'RELEVANT', selectionReason: 'RELAXED_TIMING_FLOOR' });
    const { lines } = buildWhyAuraExplanation(rec, PLAN);
    return lines.length === 2 && lines[0].includes('theme') && lines[1].includes('supportive');
  })()
);

check(
  'RELAXED_RELEVANCE_FLOOR: timing line precedes personal line',
  (() => {
    const rec = buildRecommendation({ personalRelevance: 'RELEVANT', selectionReason: 'RELAXED_RELEVANCE_FLOOR' });
    const { lines } = buildWhyAuraExplanation(rec, PLAN);
    return lines.length === 2 && lines[0].includes('supportive') && lines[1].includes('theme');
  })()
);

check(
  'RELAXED_RELEVANCE_FLOOR + BASELINE: timing-only, no over-personalized language',
  (() => {
    const rec = buildRecommendation({ personalRelevance: 'BASELINE', selectionReason: 'RELAXED_RELEVANCE_FLOOR' });
    const { lines } = buildWhyAuraExplanation(rec, PLAN);
    return lines.length === 1 && !lines[0].includes('theme');
  })()
);

// ============================================================
// SOURCE-SPECIFIC TIMING WORDING.
// ============================================================

check(
  'PLAN SOURCE: implies an already-scheduled time being evaluated, never that Aura "found" it',
  (() => {
    const line = buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'BASELINE' }), PLAN).lines[0];
    return line.startsWith('Your planned time') && !line.includes('found');
  })()
);

check(
  'DAY_BUILDER_INTENTION SOURCE: may say Aura found the window',
  (() => {
    const line = buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'BASELINE' }), DAY_BUILDER).lines[0];
    return line.includes('Aura found') && line.includes('window');
  })()
);

check(
  'RAW SOURCE GUARD: neither PLAN nor DAY_BUILDER_INTENTION literal ever appears in rendered output',
  (() => {
    const planLine = buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'HIGHLY_RELEVANT' }), PLAN).lines.join(' ');
    const dbLine = buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'HIGHLY_RELEVANT' }), DAY_BUILDER).lines.join(' ');
    return !/PLAN|DAY_BUILDER_INTENTION/.test(planLine) && !/PLAN|DAY_BUILDER_INTENTION/.test(dbLine);
  })()
);

// ============================================================
// RAW-ENUM / RAW-SCORE / ASTROLOGY GUARDS.
// ============================================================

check(
  'RAW PERSONAL-RELEVANCE ENUM GUARD: HIGHLY_RELEVANT/RELEVANT/BASELINE never appear verbatim in output',
  (() => {
    const outputs = [
      buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'HIGHLY_RELEVANT' }), PLAN).lines.join(' '),
      buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'RELEVANT' }), PLAN).lines.join(' '),
      buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'BASELINE' }), PLAN).lines.join(' '),
    ].join(' ');
    return !/HIGHLY_RELEVANT|RELEVANT|BASELINE/.test(outputs);
  })()
);

check(
  'RAW SELECTION-REASON ENUM GUARD: PRIMARY_FLOOR_MET/RELAXED_TIMING_FLOOR/RELAXED_RELEVANCE_FLOOR never appear verbatim',
  (() => {
    const outputs = [
      buildWhyAuraExplanation(buildRecommendation({ selectionReason: 'PRIMARY_FLOOR_MET' }), PLAN).lines.join(' '),
      buildWhyAuraExplanation(buildRecommendation({ selectionReason: 'RELAXED_TIMING_FLOOR' }), PLAN).lines.join(' '),
      buildWhyAuraExplanation(buildRecommendation({ selectionReason: 'RELAXED_RELEVANCE_FLOOR' }), PLAN).lines.join(' '),
    ].join(' ');
    return !/PRIMARY_FLOOR_MET|RELAXED_TIMING_FLOOR|RELAXED_RELEVANCE_FLOOR/.test(outputs);
  })()
);

check(
  'RAW TIMING-LABEL ENUM GUARD: EXCELLENT/VERY_GOOD/GOOD/USABLE never appear verbatim (only their approved wording)',
  (() => {
    const labels = ['EXCELLENT', 'VERY_GOOD', 'GOOD', 'USABLE'];
    const outputs = labels
      .map((label) => buildWhyAuraExplanation(buildRecommendation({ personalRelevance: 'BASELINE', timing: { ...buildRecommendation().timing, label } }), PLAN).lines.join(' '))
      .join(' ');
    return !/EXCELLENT|VERY_GOOD|GOOD|USABLE/.test(outputs);
  })()
);

check(
  'RAW SCORE GUARD: a recognizable numeric score value never appears in rendered output',
  (() => {
    const rec = buildRecommendation({ timing: { ...buildRecommendation().timing, score: 73.4219 } });
    const lines = buildWhyAuraExplanation(rec, PLAN).lines.join(' ');
    return !lines.includes('73.4219') && !/\d/.test(lines);
  })()
);

check(
  'ASTROLOGY-CODE GUARD: no raw Dasha/transit/Bhrigu/Panchang term ever appears in rendered output across every tested input combination',
  (() => {
    const combos = ['EXCELLENT', 'VERY_GOOD', 'GOOD', 'USABLE'].flatMap((label) =>
      (['BASELINE', 'RELEVANT', 'HIGHLY_RELEVANT'] as const).flatMap((relevance) =>
        ([PLAN, DAY_BUILDER] as const).map((source) =>
          buildWhyAuraExplanation(
            buildRecommendation({
              personalRelevance: relevance,
              timing: { ...buildRecommendation().timing, label },
              relevantThemes: [
                { theme: 'FOCUS', state: 'STRONGLY_ACTIVE' },
                { theme: 'CAREER', state: 'ACTIVE' },
              ],
            }),
            source
          ).lines.join(' ')
        )
      )
    );
    const all = combos.join(' ');
    return !/Dasha|Mahadasha|Antardasha|Rahu|Ketu|Nakshatra|Tithi|Yoga|Karana|Abhijit|Gulika|TRINE|OPPOSITION|SAME_SIGN|THREE_ELEVEN|TWO_TWELVE/i.test(all);
  })()
);

check(
  'NO OUTCOME-CLAIM / CERTAINTY-LANGUAGE GUARD: no forbidden word appears across every tested wording combination',
  (() => {
    const combos = ['EXCELLENT', 'VERY_GOOD', 'GOOD', 'USABLE'].flatMap((label) =>
      (['BASELINE', 'RELEVANT', 'HIGHLY_RELEVANT'] as const).flatMap((relevance) =>
        ([PLAN, DAY_BUILDER] as const).map((source) =>
          buildWhyAuraExplanation(buildRecommendation({ personalRelevance: relevance, timing: { ...buildRecommendation().timing, label } }), source).lines.join(' ')
        )
      )
    );
    const all = combos.join(' ').toLowerCase();
    return !/guaranteed|destined|will succeed|more productive|better decisions|perfect|must\b|best possible|invest|profitable|safe time to/i.test(all);
  })()
);

// ============================================================
// NO EXPLANATION -- affordance must hide entirely.
// ============================================================

check(
  'NO EXPLANATION: BASELINE + unrecognized timing label -> empty lines, never a fabricated fallback',
  (() => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const rec = buildRecommendation({ personalRelevance: 'BASELINE', timing: { ...buildRecommendation().timing, label: 'SOMETHING_UNEXPECTED' } });
      const { lines } = buildWhyAuraExplanation(rec, PLAN);
      return lines.length === 0;
    } finally {
      console.error = originalError;
    }
  })()
);

check(
  'UNRECOGNIZED TIMING LABEL LOGGING: logs a console.error rather than failing silently or rendering a raw label',
  (() => {
    const originalError = console.error;
    let loggedCount = 0;
    console.error = () => {
      loggedCount++;
    };
    try {
      buildWhyAuraExplanation(buildRecommendation({ timing: { ...buildRecommendation().timing, label: 'SOMETHING_UNEXPECTED' } }), PLAN);
    } finally {
      console.error = originalError;
    }
    return loggedCount === 1;
  })()
);

// ============================================================
// DETERMINISM / IMMUTABILITY.
// ============================================================

check(
  'DETERMINISM: same input -> same lines, same order, same wording',
  (() => {
    const rec = buildRecommendation({ personalRelevance: 'HIGHLY_RELEVANT', selectionReason: 'RELAXED_RELEVANCE_FLOOR' });
    const first = buildWhyAuraExplanation(rec, DAY_BUILDER);
    const second = buildWhyAuraExplanation(rec, DAY_BUILDER);
    return JSON.stringify(first) === JSON.stringify(second);
  })()
);

check(
  'IMMUTABILITY: recommendation is never mutated by either function',
  (() => {
    const rec = buildRecommendation({ personalRelevance: 'HIGHLY_RELEVANT' });
    const clone = JSON.parse(JSON.stringify(rec));
    buildWhyAuraExplanation(rec, PLAN);
    deriveWhyAuraExplanation(rec);
    return JSON.stringify(rec) === JSON.stringify(clone);
  })()
);

// ============================================================
// EXPANSION-STATE RECONCILIATION -- merge-critical stale-reopen fix.
// ============================================================

check('RESOLVE EXPANDED: null in -> null out (nothing expanded, nothing to reconcile)', resolveExpandedWhyAuraId(null, ['a', 'b']) === null);

check('RESOLVE EXPANDED: a still-present id is preserved unchanged', resolveExpandedWhyAuraId('a', ['a', 'b']) === 'a');

check('RESOLVE EXPANDED: a missing id is cleared to null', resolveExpandedWhyAuraId('a', ['b', 'c']) === null);

check('RESOLVE EXPANDED: a missing id is cleared to null even against an empty current-items list', resolveExpandedWhyAuraId('a', []) === null);

check(
  'RESOLVE EXPANDED: STALE RE-OPEN GUARD -- an id that disappears and then coincidentally reappears in a LATER item set is not auto-reopened, because the caller re-runs this after every items change and clears it the moment it first disappears',
  (() => {
    // Simulates the exact scenario this fix targets: expand "a", a refresh
    // removes it (clears to null), a later refresh brings "a" back -- but
    // resolving against the id already cleared to null (not the original
    // "a") correctly stays null, since there is nothing to "re-match".
    const afterFirstRefreshRemovesA = resolveExpandedWhyAuraId('a', ['b']); // -> null
    const afterLaterRefreshReintroducesA = resolveExpandedWhyAuraId(afterFirstRefreshRemovesA, ['a', 'b']); // still null -- never re-derived from the stale "a"
    return afterFirstRefreshRemovesA === null && afterLaterRefreshReintroducesA === null;
  })()
);

// ============================================================
// STATIC GUARDS -- merge-critical.
// ============================================================

function readViewModelSource(stripped = true): string {
  const text = fs.readFileSync('apps/web/lib/whyAuraViewModel.ts', 'utf8');
  return stripped ? stripComments(text) : text;
}

check('NO EVIDENCE-SUMMARY ACCESS: whyAuraViewModel.ts never reads `.summary` anywhere in its own source', !/\.summary\b/.test(readViewModelSource()));

check('NO EVIDENCE ACCESS: whyAuraViewModel.ts never reads `.evidence` anywhere in its own source', !/\.evidence\b/.test(readViewModelSource()));

check(
  'NO ENGINE IMPORT: whyAuraViewModel.ts imports only types (DailyGuidanceRecommendation, ConcreteGuidanceCandidateSource, PersonalTheme) -- no runtime import of any engine package',
  (() => {
    const code = readViewModelSource(false);
    const importLines = code.match(/^import[^;]*;/gm) ?? [];
    return importLines.every((line) => /^import type /.test(line)) && !/deriveLifeWeather\(|deriveDailyPersonalFit\(|deriveDailyGuidance\(|deriveThemeContext\(|evaluateMuhurta\(|runTimingSearch\(/.test(code);
  })()
);

check(
  'NO RAW ASTROLOGY TERM IN SOURCE: whyAuraViewModel.ts never mentions a Dasha lord, Nakshatra, Rahu/Ketu, or Bhrigu relationship type in its own source (outside doc comments, which are already stripped)',
  !/Mahadasha|Antardasha|Nakshatra|\bRahu\b|\bKetu\b|SAME_SIGN|\bTRINE\b|OPPOSITION|THREE_ELEVEN|TWO_TWELVE/.test(readViewModelSource())
);

if (!allPassed) {
  console.error('\nSome Why Aura view-model checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL WHY AURA VIEW MODEL CHECKS PASSED');
}
