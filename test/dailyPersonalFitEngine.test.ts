/**
 * Daily Personal Fit Engine V1: regression suite for
 * packages/daily-personal-fit/src -- a deterministic synthesis layer
 * projecting an already-computed LifeWeatherContext onto Aura's canonical
 * Muhurta activity-family vocabulary (MuhurtaActivityFamily, 13 values)
 * to determine structural personal relevance. See
 * packages/daily-personal-fit/README.md for the full convention (Option
 * B hard boundary -- no Panchang/Muhurta/Aura-Fit/timing/ranking; max-state
 * relevance derivation; natalStrength/natalDirection never drive fit) this
 * suite verifies against.
 *
 * "Independently hard-coded mapping" (per this PR's own brief, item 44):
 * the expected activity-family -> theme mapping below is a bare,
 * hand-derived literal, never imported from packages/daily-personal-fit/src/mapping.ts's
 * own ACTIVITY_THEME_MAPPING.
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

import { deriveDailyPersonalFit, CANONICAL_ACTIVITY_FAMILIES, DAILY_PERSONAL_FIT_ENGINE_VERSION, DailyPersonalFitValidationError } from '../packages/daily-personal-fit/src/index';
import { PERSONAL_THEMES } from '../packages/personal-intelligence/src/themes';
import type { PersonalTheme } from '../packages/personal-intelligence/src/types';
import type { LifeWeatherContext, LifeWeatherState, LifeWeatherTheme } from '../packages/personal-intelligence/src/context';
import type { DailyPersonalFitInput } from '../packages/daily-personal-fit/src/index';
import type { MuhurtaActivityFamily } from '../packages/muhurta/src/muhurtaEngine';

// ============================================================
// Independently hard-coded expectations (see module doc comment above).
// ============================================================

const EXPECTED_CANONICAL_FAMILIES: MuhurtaActivityFamily[] = [
  'DEEP_WORK', 'WORKOUT', 'LEARNING', 'MEDITATION', 'RELATIONSHIP', 'JOURNEY_START',
  'SOCIAL', 'MEAL', 'FINANCE', 'NEW_BEGINNING', 'ADMIN', 'WELLBEING', 'FOCUSED_WORK',
];

const EXPECTED_MAPPING: Record<MuhurtaActivityFamily, PersonalTheme[]> = {
  DEEP_WORK: ['FOCUS', 'CAREER', 'LEARNING', 'CREATIVITY'],
  WORKOUT: ['WELLBEING'],
  LEARNING: ['LEARNING', 'FOCUS'],
  MEDITATION: ['SPIRITUALITY', 'WELLBEING'],
  RELATIONSHIP: ['RELATIONSHIPS'],
  JOURNEY_START: ['EXPLORATION'],
  SOCIAL: ['SOCIAL', 'RELATIONSHIPS'],
  MEAL: ['WELLBEING'],
  FINANCE: ['FINANCE'],
  NEW_BEGINNING: ['CAREER', 'CREATIVITY', 'EXPLORATION'],
  ADMIN: ['FOCUS', 'CAREER'],
  WELLBEING: ['WELLBEING'],
  FOCUSED_WORK: ['FOCUS', 'CAREER'],
};

// ============================================================
// Fixture builders.
// ============================================================

const EVAL_TIME = '2026-09-09T12:00:00.000Z';

function buildLifeWeather(params: {
  states?: Partial<Record<PersonalTheme, LifeWeatherState>>;
  natalStrengths?: Partial<Record<PersonalTheme, number>>;
  natalDirections?: Partial<Record<PersonalTheme, 'SUPPORTIVE' | 'NEUTRAL' | 'CHALLENGING'>>;
  evaluationTime?: string;
} = {}): LifeWeatherContext {
  const themes: LifeWeatherTheme[] = PERSONAL_THEMES.map((theme) => ({
    theme,
    natalStrength: params.natalStrengths?.[theme] ?? 0.3,
    natalDirection: params.natalDirections?.[theme] ?? 'NEUTRAL',
    state: params.states?.[theme] ?? 'QUIET',
    reinforcementSources: [],
    contributors: [],
    evidence: [],
  }));
  return {
    engineVersion: 'LIFE_WEATHER_V1',
    evaluationTime: params.evaluationTime ?? EVAL_TIME,
    themes,
    evidence: [],
  };
}

function activityResult(context: ReturnType<typeof deriveDailyPersonalFit>, family: MuhurtaActivityFamily) {
  const found = context.activities.find((a) => a.activityFamily === family);
  if (!found) throw new Error(`Activity family ${family} missing from result -- this itself is a test failure condition.`);
  return found;
}

// ============================================================
// MAPPING COMPLETENESS.
// ============================================================

check(
  'MAPPING COMPLETENESS: exactly all 13 canonical MuhurtaActivityFamily values have a mapping-table entry, no duplicates, no missing values',
  (() => {
    const result = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather() });
    const resultFamilies = result.activities.map((a) => a.activityFamily);
    return resultFamilies.length === 13 && new Set(resultFamilies).size === 13 && EXPECTED_CANONICAL_FAMILIES.every((f) => resultFamilies.includes(f));
  })()
);

check('CANONICAL_ACTIVITY_FAMILIES matches the independently hard-coded 13-value set exactly, in order', JSON.stringify(CANONICAL_ACTIVITY_FAMILIES) === JSON.stringify(EXPECTED_CANONICAL_FAMILIES));

// ============================================================
// FULL VECTOR.
// ============================================================

check('FULL VECTOR: every result has exactly 13 activities', deriveDailyPersonalFit({ lifeWeather: buildLifeWeather() }).activities.length === 13);

check(
  'FULL VECTOR: canonical order exactly matches MuhurtaActivityFamily/CANONICAL_ACTIVITY_FAMILIES',
  JSON.stringify(deriveDailyPersonalFit({ lifeWeather: buildLifeWeather() }).activities.map((a) => a.activityFamily)) === JSON.stringify(EXPECTED_CANONICAL_FAMILIES)
);

check('engineVersion is the stable DAILY_PERSONAL_FIT_V1 literal', deriveDailyPersonalFit({ lifeWeather: buildLifeWeather() }).engineVersion === DAILY_PERSONAL_FIT_ENGINE_VERSION && DAILY_PERSONAL_FIT_ENGINE_VERSION === 'DAILY_PERSONAL_FIT_V1');

// ============================================================
// MAPPING CONTENT -- independently hard-coded, not derived from production mapping.
// ============================================================

check(
  'MAPPING CONTENT: every activity family projects into exactly its own independently hard-coded theme set',
  (() => {
    const lifeWeather = buildLifeWeather();
    const result = deriveDailyPersonalFit({ lifeWeather });
    return EXPECTED_CANONICAL_FAMILIES.every((family) => {
      const actual = activityResult(result, family).relevantThemes.map((t) => t.theme);
      const expected = EXPECTED_MAPPING[family];
      return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
    });
  })()
);

// ============================================================
// BASELINE / RELEVANT / HIGHLY_RELEVANT.
// ============================================================

check(
  'BASELINE: every LifeWeather theme QUIET -> all 13 activities BASELINE',
  deriveDailyPersonalFit({ lifeWeather: buildLifeWeather() }).activities.every((a) => a.personalRelevance === 'BASELINE')
);

check(
  'RELEVANT: one mapped theme ACTIVE -> that activity family RELEVANT; a non-mapped, non-sharing activity family stays BASELINE',
  (() => {
    const result = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { FINANCE: 'ACTIVE' } }) });
    return activityResult(result, 'FINANCE').personalRelevance === 'RELEVANT' && activityResult(result, 'MEDITATION').personalRelevance === 'BASELINE';
  })()
);

check(
  'HIGHLY_RELEVANT: one mapped theme STRONGLY_ACTIVE -> that activity family HIGHLY_RELEVANT',
  deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { FINANCE: 'STRONGLY_ACTIVE' } }) }).activities.find((a) => a.activityFamily === 'FINANCE')?.personalRelevance === 'HIGHLY_RELEVANT'
);

// ============================================================
// MAX STATE, NOT COUNT -- merge-critical.
// ============================================================

check(
  'MAX STATE NOT COUNT: DEEP_WORK (mapped to FOCUS/CAREER/LEARNING/CREATIVITY) with all 4 ACTIVE -> RELEVANT, never HIGHLY_RELEVANT (count does not drive V1 relevance)',
  activityResult(
    deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { FOCUS: 'ACTIVE', CAREER: 'ACTIVE', LEARNING: 'ACTIVE', CREATIVITY: 'ACTIVE' } }) }),
    'DEEP_WORK'
  ).personalRelevance === 'RELEVANT'
);

check(
  'MAX STATE NOT COUNT: DEEP_WORK with FOCUS=QUIET, CAREER=ACTIVE, LEARNING=STRONGLY_ACTIVE, CREATIVITY=QUIET -> HIGHLY_RELEVANT (presence of one STRONGLY_ACTIVE theme elevates the whole activity)',
  activityResult(
    deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { FOCUS: 'QUIET', CAREER: 'ACTIVE', LEARNING: 'STRONGLY_ACTIVE', CREATIVITY: 'QUIET' } }) }),
    'DEEP_WORK'
  ).personalRelevance === 'HIGHLY_RELEVANT'
);

// ============================================================
// QUIET THEME RETENTION -- lossless mapping, merge-critical.
// ============================================================

check(
  'QUIET THEME RETENTION: DEEP_WORK with FOCUS=ACTIVE and the other 3 mapped themes QUIET -- relevantThemes still lists all 4 mapped themes with their exact (including QUIET) states, never dropped',
  (() => {
    const result = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { FOCUS: 'ACTIVE' } }) });
    const deepWork = activityResult(result, 'DEEP_WORK');
    const byTheme = new Map(deepWork.relevantThemes.map((t) => [t.theme, t.state]));
    return (
      deepWork.relevantThemes.length === 4 &&
      byTheme.get('FOCUS') === 'ACTIVE' &&
      byTheme.get('CAREER') === 'QUIET' &&
      byTheme.get('LEARNING') === 'QUIET' &&
      byTheme.get('CREATIVITY') === 'QUIET'
    );
  })()
);

// ============================================================
// SOCIAL / FINANCE ZERO NATAL STRENGTH -- merge-critical.
// ============================================================

check(
  'SOCIAL ZERO NATAL STRENGTH: SOCIAL.state=ACTIVE with natalStrength=0 -> SOCIAL activity RELEVANT, no natal-strength gating',
  activityResult(
    deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { SOCIAL: 'ACTIVE' }, natalStrengths: { SOCIAL: 0 } }) }),
    'SOCIAL'
  ).personalRelevance === 'RELEVANT'
);

check(
  'FINANCE ZERO NATAL STRENGTH: FINANCE.state=STRONGLY_ACTIVE with natalStrength=0 -> FINANCE activity HIGHLY_RELEVANT',
  activityResult(
    deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { FINANCE: 'STRONGLY_ACTIVE' }, natalStrengths: { FINANCE: 0 } }) }),
    'FINANCE'
  ).personalRelevance === 'HIGHLY_RELEVANT'
);

// ============================================================
// NATAL STRENGTH / DIRECTION IRRELEVANCE -- strong merge-critical guards.
// ============================================================

check(
  'NATAL STRENGTH IRRELEVANCE: two LifeWeather inputs identical except natalStrength values -> identical Daily Personal Fit results (same states)',
  (() => {
    const states: Partial<Record<PersonalTheme, LifeWeatherState>> = { FOCUS: 'ACTIVE', LEARNING: 'STRONGLY_ACTIVE', FINANCE: 'ACTIVE' };
    const a = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states, natalStrengths: { FOCUS: 0, LEARNING: 0.9, FINANCE: 0.5 } }) });
    const b = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states, natalStrengths: { FOCUS: 1.0, LEARNING: 0.1, FINANCE: 0.0 } }) });
    return JSON.stringify(a.activities) === JSON.stringify(b.activities);
  })()
);

check(
  'NATAL DIRECTION IRRELEVANCE: two LifeWeather inputs identical except natalDirection values -> identical Daily Personal Fit results (same states)',
  (() => {
    const states: Partial<Record<PersonalTheme, LifeWeatherState>> = { CAREER: 'ACTIVE', SPIRITUALITY: 'STRONGLY_ACTIVE' };
    const a = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states, natalDirections: { CAREER: 'SUPPORTIVE', SPIRITUALITY: 'CHALLENGING' } }) });
    const b = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states, natalDirections: { CAREER: 'CHALLENGING', SPIRITUALITY: 'NEUTRAL' } }) });
    return JSON.stringify(a.activities) === JSON.stringify(b.activities);
  })()
);

// ============================================================
// PERSONAL DIFFERENTIATION.
// ============================================================

check(
  'PERSONAL DIFFERENTIATION: same evaluationTime and mapping, different LifeWeather states -> different personalRelevance vectors',
  (() => {
    const personA = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { LEARNING: 'STRONGLY_ACTIVE' }, evaluationTime: EVAL_TIME }) });
    const personB = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { RELATIONSHIPS: 'STRONGLY_ACTIVE' }, evaluationTime: EVAL_TIME }) });
    return JSON.stringify(personA.activities.map((a) => a.personalRelevance)) !== JSON.stringify(personB.activities.map((a) => a.personalRelevance));
  })()
);

// ============================================================
// EXPLAINABILITY.
// ============================================================

check(
  'EXPLAINABILITY: DEEP_WORK with several mapped themes at different real states -- relevantThemes retains every mapped theme and its own exact state, no opaque numeric score required',
  (() => {
    const result = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { FOCUS: 'ACTIVE', CAREER: 'QUIET', LEARNING: 'STRONGLY_ACTIVE', CREATIVITY: 'ACTIVE' } }) });
    const deepWork = activityResult(result, 'DEEP_WORK');
    const byTheme = new Map(deepWork.relevantThemes.map((t) => [t.theme, t.state]));
    return byTheme.get('FOCUS') === 'ACTIVE' && byTheme.get('CAREER') === 'QUIET' && byTheme.get('LEARNING') === 'STRONGLY_ACTIVE' && byTheme.get('CREATIVITY') === 'ACTIVE' && deepWork.evidence.length > 0;
  })()
);

// ============================================================
// DETERMINISM / IMMUTABILITY.
// ============================================================

check(
  'DETERMINISM: repeated calls with structurally identical input produce deeply-equal output',
  (() => {
    const input: DailyPersonalFitInput = { lifeWeather: buildLifeWeather({ states: { FOCUS: 'ACTIVE', FINANCE: 'STRONGLY_ACTIVE' } }) };
    return JSON.stringify(deriveDailyPersonalFit(input)) === JSON.stringify(deriveDailyPersonalFit(input));
  })()
);

check(
  'INPUT IMMUTABILITY: input.lifeWeather is never mutated by deriveDailyPersonalFit',
  (() => {
    const lifeWeather = buildLifeWeather({ states: { FOCUS: 'ACTIVE', LEARNING: 'STRONGLY_ACTIVE' } });
    const clone = JSON.parse(JSON.stringify(lifeWeather));
    deriveDailyPersonalFit({ lifeWeather });
    return JSON.stringify(lifeWeather) === JSON.stringify(clone);
  })()
);

check(
  'no Date.now()/new Date() with no args/Math.random anywhere in the package source (comments stripped) -- evaluationTime is always read verbatim from the input',
  (() => {
    const files = ['constants', 'mapping', 'relevance', 'evidence', 'validation', 'engine', 'provenance', 'index'].map((name) =>
      stripComments(fs.readFileSync(`packages/daily-personal-fit/src/${name}.ts`, 'utf8'))
    );
    const code = files.join('\n');
    return !/Date\.now\(\)/.test(code) && !/new Date\(\)(?!\.)/.test(code) && !/Math\.random\(\)/.test(code);
  })()
);

// ============================================================
// NO RANKING.
// ============================================================

check(
  'NO RANKING: output order stays canonical even when a LATE-canonical-order family (WELLBEING) is HIGHLY_RELEVANT and an EARLY-canonical-order family (DEEP_WORK) is BASELINE',
  (() => {
    const result = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { WELLBEING: 'STRONGLY_ACTIVE' } }) });
    return JSON.stringify(result.activities.map((a) => a.activityFamily)) === JSON.stringify(EXPECTED_CANONICAL_FAMILIES) && activityResult(result, 'DEEP_WORK').personalRelevance === 'BASELINE' && activityResult(result, 'WELLBEING').personalRelevance === 'HIGHLY_RELEVANT';
  })()
);

// ============================================================
// EXCLUSION GUARDS -- Option B hard boundary.
// ============================================================

check(
  'EXCLUSION GUARDS: no ACTUAL CODE (comments stripped) references packages/panchang, evaluateMuhurta, evaluateActivityFit, packages/recommendation, packages/ashtakavarga, PanchangDay, Tithi/Nakshatra/Yoga/Karana, or Rahu/Yama/Gulika/Abhijit/Brahma',
  (() => {
    const files = ['constants', 'mapping', 'relevance', 'evidence', 'validation', 'engine', 'provenance', 'index'].map((name) =>
      stripComments(fs.readFileSync(`packages/daily-personal-fit/src/${name}.ts`, 'utf8'))
    );
    const code = files.join('\n');
    return !/panchang|evaluateMuhurta|evaluateActivityFit|recommendation|ashtakavarga|PanchangDay|\bTithi\b|\bNakshatra\b|\bYoga\b|\bKarana\b|Rahu|\bYama\b|Gulika|Abhijit|Brahma/i.test(code);
  })()
);

check(
  'EXCLUSION GUARDS: importing the MuhurtaActivityFamily TYPE from packages/muhurta is explicitly allowed and present (allowed taxonomy reuse, distinct from forbidden Muhurta calculation)',
  (() => {
    const constantsSrc = fs.readFileSync('packages/daily-personal-fit/src/constants.ts', 'utf8');
    return /import\s+type\s*\{\s*MuhurtaActivityFamily\s*\}\s*from\s*'\.\.\/\.\.\/muhurta\/src\/muhurtaEngine'/.test(constantsSrc);
  })()
);

check(
  'EXCLUSION GUARDS: every import in this package is a relative import within itself, or into packages/personal-intelligence or packages/muhurta (type-only) -- never packages/panchang, packages/recommendation, packages/ashtakavarga, apps/web, or Prisma',
  (() => {
    const files = ['constants', 'mapping', 'relevance', 'evidence', 'validation', 'engine', 'provenance', 'index'].map((name) => fs.readFileSync(`packages/daily-personal-fit/src/${name}.ts`, 'utf8'));
    const code = files.join('\n');
    const importLines = code.match(/from\s+'[^']+'/g) ?? [];
    return importLines.every((line) => /from\s+'(\.\.?\/|\.\.\/\.\.\/personal-intelligence\/|\.\.\/\.\.\/muhurta\/)/.test(line));
  })()
);

check(
  'this package never calls deriveLifeWeather, deriveThemeContext, calculateTransitActivation, calculateVimshottariDasha, getNatalChart, getPanchangForDate, evaluateMuhurta, or evaluateActivityFit (pure composition only)',
  (() => {
    const files = ['mapping', 'relevance', 'evidence', 'validation', 'engine'].map((name) => stripComments(fs.readFileSync(`packages/daily-personal-fit/src/${name}.ts`, 'utf8')));
    const code = files.join('\n');
    return !/deriveLifeWeather\(|deriveThemeContext\(|calculateTransitActivation\(|calculateVimshottariDasha\(|getNatalChart\(|getPanchangForDate\(|evaluateMuhurta\(|evaluateActivityFit\(/.test(code);
  })()
);

// ============================================================
// ZERO PERSONAL INTELLIGENCE CROSS-COUPLING REGRESSION.
// ============================================================

check(
  'ZERO COUPLING REGRESSION: packages/personal-intelligence still has no import from any other package (adding Daily Personal Fit contract types did not introduce a cross-package import)',
  (() => {
    const files = ['context', 'evidence', 'guidance', 'index', 'provenance', 'themes', 'types', 'validation'].map((name) => fs.readFileSync(`packages/personal-intelligence/src/${name}.ts`, 'utf8'));
    const code = files.join('\n');
    const importLines = code.match(/from\s+'[^']+'/g) ?? [];
    return importLines.every((line) => /from\s+'\.\/?/.test(line));
  })()
);

check(
  'packages/muhurta/src/muhurtaEngine.ts has no ACTUAL IMPORT of packages/daily-personal-fit (dependency direction preserved -- Muhurta is imported FROM, never imports FROM this new package)',
  !/import[^;]*from\s+['"][^'"]*daily-personal-fit[^'"]*['"]/.test(stripComments(fs.readFileSync('packages/muhurta/src/muhurtaEngine.ts', 'utf8')))
);

// ============================================================
// VALIDATION.
// ============================================================

function expectThrows(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof DailyPersonalFitValidationError;
  }
}

check('rejects a missing lifeWeather.engineVersion', expectThrows(() => deriveDailyPersonalFit({ lifeWeather: { ...buildLifeWeather(), engineVersion: '' } })));
check('rejects a malformed evaluationTime (non-ISO string)', expectThrows(() => deriveDailyPersonalFit({ lifeWeather: { ...buildLifeWeather(), evaluationTime: 'not-a-date' } })));
check('rejects an evaluationTime with no explicit zone designator', expectThrows(() => deriveDailyPersonalFit({ lifeWeather: { ...buildLifeWeather(), evaluationTime: '2026-09-09T12:00:00' } })));
check('rejects an impossible calendar evaluationTime (2026-02-30)', expectThrows(() => deriveDailyPersonalFit({ lifeWeather: { ...buildLifeWeather(), evaluationTime: '2026-02-30T00:00:00Z' } })));
check('rejects a non-leap-year Feb 29 evaluationTime (2026 is not a leap year)', expectThrows(() => deriveDailyPersonalFit({ lifeWeather: { ...buildLifeWeather(), evaluationTime: '2026-02-29T00:00:00Z' } })));
check('accepts a genuine leap-year Feb 29 evaluationTime (2024 is a leap year)', !expectThrows(() => deriveDailyPersonalFit({ lifeWeather: { ...buildLifeWeather(), evaluationTime: '2024-02-29T00:00:00Z' } })));

check('rejects lifeWeather.themes with fewer than 10 entries', expectThrows(() => deriveDailyPersonalFit({ lifeWeather: { ...buildLifeWeather(), themes: buildLifeWeather().themes.slice(0, 9) } })));
check(
  'rejects lifeWeather.themes with a duplicate theme',
  expectThrows(() => {
    const lifeWeather = buildLifeWeather();
    lifeWeather.themes[1] = { ...lifeWeather.themes[1], theme: lifeWeather.themes[0].theme };
    return deriveDailyPersonalFit({ lifeWeather });
  })
);
check(
  'rejects lifeWeather.themes with an invalid state',
  expectThrows(() => {
    const lifeWeather = buildLifeWeather();
    (lifeWeather.themes[0] as unknown as { state: string }).state = 'SOMETHING_ELSE';
    return deriveDailyPersonalFit({ lifeWeather });
  })
);
check(
  'rejects lifeWeather.themes with an out-of-range natalStrength',
  expectThrows(() => {
    const lifeWeather = buildLifeWeather();
    lifeWeather.themes[0] = { ...lifeWeather.themes[0], natalStrength: 1.5 };
    return deriveDailyPersonalFit({ lifeWeather });
  })
);
check(
  '"Quiet-only" LifeWeather (no current Dasha/Transit reinforcement anywhere) is a VALID input, never rejected -- produces an all-BASELINE result',
  !expectThrows(() => deriveDailyPersonalFit({ lifeWeather: buildLifeWeather() }))
);

// ============================================================
// EVIDENCE / PAYLOAD.
// ============================================================

check(
  'every activity carries exactly one small, DAILY_PERSONAL_FIT-sourced evidence entry',
  deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { FOCUS: 'ACTIVE' } }) }).activities.every((a) => a.evidence.length === 1 && a.evidence[0].source === 'DAILY_PERSONAL_FIT')
);

check(
  'PAYLOAD SIZE: a representative full 13-activity result serializes to well under 100KB (low single-digit KB expected)',
  (() => {
    const result = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { FOCUS: 'ACTIVE', LEARNING: 'STRONGLY_ACTIVE', FINANCE: 'ACTIVE', SOCIAL: 'STRONGLY_ACTIVE' } }) });
    const size = JSON.stringify(result).length;
    console.log(`    (approximate serialized size: ${size} characters / ~${Math.round(size / 1024)}KB)`);
    return size < 100_000;
  })()
);

check('result round-trips through JSON unchanged (structural equality preserved)', (() => {
  const result = deriveDailyPersonalFit({ lifeWeather: buildLifeWeather({ states: { FOCUS: 'ACTIVE' } }) });
  const roundTripped = JSON.parse(JSON.stringify(result));
  return JSON.stringify(roundTripped) === JSON.stringify(result);
})());

if (!allPassed) {
  console.error('\nSome Daily Personal Fit Engine checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL DAILY PERSONAL FIT ENGINE CHECKS PASSED');
}
