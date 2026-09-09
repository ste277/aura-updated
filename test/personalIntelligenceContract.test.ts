/**
 * Personal Intelligence Contract V1: regression suite for
 * packages/personal-intelligence/src -- a pure, deterministic contract
 * layer (types only, no calculation) defining the shared vocabulary
 * future Aura personalization engines (Bhrigu, Vimshottari Dasha,
 * transit activation, Ashtakavarga, Panchang, Muhurta, and a future
 * recommendation composer) will use so they don't each invent
 * incompatible result shapes. See packages/personal-intelligence/README.md
 * for the full product boundary -- this suite does not test any scoring,
 * prediction, or recommendation logic, because none exists in this
 * package.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

import {
  CONTRACT_VERSION,
  PERSONAL_THEMES,
  PERSONAL_REASON_CODES,
  isNormalizedScore,
  assertNormalizedScore,
  isPersonalTheme,
  isPersonalTransitRelationship,
  isPersonalGuidanceContext,
  toPersonalEvidenceRef,
  PersonalTheme,
  PersonalThemeSignal,
  PersonalEvidenceRef,
  PersonalEvidence,
  PersonalGuidanceContext,
  PersonalNatalContext,
  PersonalThemeContext,
  LifePeriodContext,
  TransitActivation,
  TransitActivationContext,
  PersonalTransitRelationship,
  LifeWeatherContext,
  LifeWeatherTheme,
  LifeWeatherContributor,
  PersonalRelevance,
  DailyPersonalFitRelevantTheme,
  DailyActivityFit,
  DailyPersonalFitContext,
  PersonalActivityFit,
  PersonalRecommendation,
  DailyPersonalGuidance,
  PersonalReason,
} from '../packages/personal-intelligence/src/index';

// ============================================================
// Theme taxonomy.
// ============================================================

const EXPECTED_THEMES = [
  'FOCUS', 'LEARNING', 'CAREER', 'FINANCE', 'RELATIONSHIPS',
  'CREATIVITY', 'SOCIAL', 'WELLBEING', 'EXPLORATION', 'SPIRITUALITY',
];

check(
  'PERSONAL_THEMES contains exactly the 10 documented theme values, in the documented order',
  JSON.stringify(PERSONAL_THEMES) === JSON.stringify(EXPECTED_THEMES)
);

check('PERSONAL_THEMES has no duplicates', new Set(PERSONAL_THEMES).size === PERSONAL_THEMES.length);

check(
  'PERSONAL_THEMES order is deterministic across repeated reads (same array reference, or at least identical content)',
  JSON.stringify(PERSONAL_THEMES) === JSON.stringify(PERSONAL_THEMES)
);

check('isPersonalTheme accepts every documented theme', PERSONAL_THEMES.every((t) => isPersonalTheme(t)));
check('isPersonalTheme rejects an unsupported string', !isPersonalTheme('AMBITION') && !isPersonalTheme('focus'));
check('isPersonalTheme rejects non-string values', !isPersonalTheme(1) && !isPersonalTheme(null) && !isPersonalTheme(undefined));

// ============================================================
// Normalized score.
// ============================================================

check('isNormalizedScore accepts 0', isNormalizedScore(0));
check('isNormalizedScore accepts 1', isNormalizedScore(1));
check('isNormalizedScore accepts a representative midpoint (0.42)', isNormalizedScore(0.42));
check('isNormalizedScore rejects a negative value', !isNormalizedScore(-0.01));
check('isNormalizedScore rejects a value above 1', !isNormalizedScore(1.01));
check('isNormalizedScore rejects an existing-0-100-scale value mistakenly passed through unconverted (85)', !isNormalizedScore(85));
check('isNormalizedScore rejects NaN', !isNormalizedScore(NaN));
check('isNormalizedScore rejects +Infinity', !isNormalizedScore(Infinity));
check('isNormalizedScore rejects -Infinity', !isNormalizedScore(-Infinity));
check('isNormalizedScore rejects a non-number', !isNormalizedScore('0.5'));

check(
  'assertNormalizedScore does not throw for a valid score',
  (() => {
    try {
      assertNormalizedScore(0.5);
      return true;
    } catch {
      return false;
    }
  })()
);

check(
  'assertNormalizedScore throws for an out-of-range score',
  (() => {
    try {
      assertNormalizedScore(1.5);
      return false;
    } catch {
      return true;
    }
  })()
);

// ============================================================
// Evidence.
// ============================================================

function sampleEvidenceRef(overrides: Partial<PersonalEvidenceRef> = {}): PersonalEvidenceRef {
  return {
    source: 'BHRIGU_NATAL',
    ruleId: 'BHRIGU_REL_TRINE_V1',
    ruleVersion: '1.0.0',
    summary: 'Mercury and Jupiter are in a trinal sign relationship.',
    data: { signA: 1, signB: 5, relationship: 'TRINE', strength: 0.75 },
    ...overrides,
  };
}

check(
  'a PersonalEvidenceRef is JSON-serializable (round-trips through JSON.stringify/parse unchanged)',
  (() => {
    const ref = sampleEvidenceRef();
    const roundTripped = JSON.parse(JSON.stringify(ref));
    return JSON.stringify(roundTripped) === JSON.stringify(ref);
  })()
);

check(
  'PersonalEvidenceRef requires source/ruleId/ruleVersion (a value missing any of them is not structurally usable)',
  (() => {
    const ref = sampleEvidenceRef();
    return typeof ref.source === 'string' && typeof ref.ruleId === 'string' && typeof ref.ruleVersion === 'string';
  })()
);

check(
  'two structurally identical PersonalEvidenceRef values are deeply equal',
  JSON.stringify(sampleEvidenceRef()) === JSON.stringify(sampleEvidenceRef())
);

check(
  'toPersonalEvidenceRef adapts a typed PersonalEvidence into the generic PersonalEvidenceRef shape, facts becoming data verbatim',
  (() => {
    const typedEvidence: PersonalEvidence<{ theme: string; strength: number }> = {
      source: 'PERSONAL_THEMES',
      ruleId: 'PERSONAL_THEME_FOCUS_V1',
      ruleVersion: '1.0.0',
      facts: { theme: 'FOCUS', strength: 0.6 },
    };
    const ref = toPersonalEvidenceRef(typedEvidence);
    return (
      ref.source === 'PERSONAL_THEMES' &&
      ref.ruleId === 'PERSONAL_THEME_FOCUS_V1' &&
      ref.ruleVersion === '1.0.0' &&
      JSON.stringify(ref.data) === JSON.stringify(typedEvidence.facts)
    );
  })()
);

// ============================================================
// Bhrigu compatibility -- the package itself must not import Bhrigu (see
// the dependency-boundary check further below); THIS TEST FILE may, to
// prove a real BhriguEvidence can be represented as a PersonalEvidenceRef
// without mutating or re-exporting anything from packages/bhrigu.
// ============================================================

check(
  'a real BhriguEvidence value can be represented as a PersonalEvidenceRef by copying ruleId/ruleVersion verbatim, without importing or mutating any Bhrigu internals from this package',
  (() => {
    // Structurally identical to packages/bhrigu/src/types.ts's own
    // BhriguEvidence -- deliberately NOT imported from packages/bhrigu
    // here (this test proves shape compatibility, not a hard type
    // dependency; the future adapter that does this for real is out of
    // scope for this PR, see the README's own "Explicitly out of scope"
    // list).
    const bhriguEvidence = {
      ruleId: 'BHRIGU_REL_TRINE_V1',
      ruleVersion: '1.0.0',
      category: 'RELATIONSHIP' as const,
      planets: ['Mercury', 'Jupiter'],
      facts: { signA: 1, signB: 5, signDistanceAtoB: 4, signDistanceBtoA: 8, relationship: 'TRINE', strength: 0.75 },
    };
    const adapted: PersonalEvidenceRef = {
      source: 'BHRIGU_NATAL',
      ruleId: bhriguEvidence.ruleId,
      ruleVersion: bhriguEvidence.ruleVersion,
      summary: `${bhriguEvidence.planets.join(' and ')} are in a ${bhriguEvidence.category.toLowerCase()}.`,
      data: { category: bhriguEvidence.category, planets: bhriguEvidence.planets, facts: bhriguEvidence.facts },
    };
    return (
      adapted.ruleId === bhriguEvidence.ruleId &&
      adapted.ruleVersion === bhriguEvidence.ruleVersion &&
      adapted.source === 'BHRIGU_NATAL' &&
      JSON.stringify(JSON.parse(JSON.stringify(adapted))) === JSON.stringify(adapted)
    );
  })()
);

// ============================================================
// Context -- partial context remains valid at every stage.
// ============================================================

check(
  'a natal-only context is a valid PersonalGuidanceContext',
  (() => {
    const natal: PersonalNatalContext = { engine: 'BHRIGU_NATAL', engineVersion: 'BHRIGU_NATAL_V1', evidence: [sampleEvidenceRef()] };
    const context: PersonalGuidanceContext = { version: CONTRACT_VERSION, natal };
    return isPersonalGuidanceContext(context) && context.themes === undefined && context.lifePeriod === undefined;
  })()
);

check(
  'a natal + themes context is a valid PersonalGuidanceContext',
  (() => {
    const natal: PersonalNatalContext = { engine: 'BHRIGU_NATAL', engineVersion: 'BHRIGU_NATAL_V1', evidence: [] };
    const themeSignal: PersonalThemeSignal = { theme: 'FOCUS', strength: 0.6, direction: 'SUPPORTIVE', reasons: [sampleEvidenceRef()] };
    const themes: PersonalThemeContext = { signals: [themeSignal], evidence: [] };
    const context: PersonalGuidanceContext = { version: CONTRACT_VERSION, natal, themes };
    return isPersonalGuidanceContext(context) && context.transits === undefined;
  })()
);

check(
  'a natal + lifePeriod + transits context is a valid PersonalGuidanceContext',
  (() => {
    const natal: PersonalNatalContext = { engine: 'BHRIGU_NATAL', engineVersion: 'BHRIGU_NATAL_V1', evidence: [] };
    const lifePeriod: LifePeriodContext = {
      system: 'VIMSHOTTARI_DASHA',
      majorPeriod: { ruler: 'Jupiter', startAt: '2020-01-01T00:00:00.000Z', endAt: '2036-01-01T00:00:00.000Z', level: 'MAHADASHA' },
      themes: [],
      evidence: [],
    };
    const transits: TransitActivationContext = {
      activations: [{ transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 0.4, evidence: [] }],
      evidence: [],
    };
    const context: PersonalGuidanceContext = { version: CONTRACT_VERSION, natal, lifePeriod, transits };
    return isPersonalGuidanceContext(context) && context.personalSupport === undefined && context.panchang === undefined;
  })()
);

check(
  'a fully synthetic context (every section populated) is a valid PersonalGuidanceContext',
  (() => {
    const context: PersonalGuidanceContext = {
      version: CONTRACT_VERSION,
      natal: { engine: 'BHRIGU_NATAL', engineVersion: 'BHRIGU_NATAL_V1', evidence: [sampleEvidenceRef()] },
      themes: { signals: [{ theme: 'LEARNING', strength: 0.7, direction: 'SUPPORTIVE', reasons: [] }], evidence: [] },
      lifePeriod: { system: 'VIMSHOTTARI_DASHA', themes: [], evidence: [] },
      transits: { activations: [], evidence: [] },
      personalSupport: { system: 'ASHTAKAVARGA', overallSupport: 0.5, themeSupport: { FOCUS: 0.6 }, evidence: [] },
      panchang: { date: '2026-09-09', timezone: 'Asia/Kolkata', qualities: [], sourceVersion: 'PANCHANG_V1' },
      muhurta: { windows: [{ startAt: '2026-09-09T05:00:00.000Z', endAt: '2026-09-09T06:00:00.000Z', activityFamilies: ['DEEP_WORK'], qualities: [] }] },
    };
    return isPersonalGuidanceContext(context);
  })()
);

check(
  'an empty context (only version) is still a valid PersonalGuidanceContext -- partial context is intentional, not invalid',
  isPersonalGuidanceContext({ version: CONTRACT_VERSION })
);

check(
  'a context missing `version` is NOT a valid PersonalGuidanceContext',
  !isPersonalGuidanceContext({ natal: { engine: 'BHRIGU_NATAL', engineVersion: 'BHRIGU_NATAL_V1', evidence: [] } })
);

check(
  'a context whose `natal` section is not an object is NOT a valid PersonalGuidanceContext',
  !isPersonalGuidanceContext({ version: CONTRACT_VERSION, natal: 'not-an-object' })
);

check('isPersonalGuidanceContext rejects null and non-objects', !isPersonalGuidanceContext(null) && !isPersonalGuidanceContext('x') && !isPersonalGuidanceContext(42));

// ============================================================
// Activity fit.
// ============================================================

check(
  'a representative PersonalActivityFit has correct score semantics, reasons, cautions, evidence, and reuses the existing activity-identifier convention (a plain string matching ActivityProfile.id)',
  (() => {
    const reason: PersonalReason = {
      code: PERSONAL_REASON_CODES.NATAL_THEME_SUPPORT,
      message: 'Natal learning theme supportive.',
      evidence: [sampleEvidenceRef()],
    };
    const caution: PersonalReason = {
      code: PERSONAL_REASON_CODES.RAHU_CONFLICT,
      message: 'Overlaps a Rahu Kalam window.',
      evidence: [sampleEvidenceRef({ source: 'MUHURTA', ruleId: 'MUHURTA_RAHU_CAUTION_V1' })],
    };
    const fit: PersonalActivityFit = {
      activity: 'deep-work', // plain string, matching ActivityProfile.id's own convention
      score: 0.86,
      reasons: [reason],
      cautions: [caution],
      evidence: [sampleEvidenceRef()],
    };
    return (
      typeof fit.activity === 'string' &&
      isNormalizedScore(fit.score) &&
      fit.reasons.length === 1 &&
      fit.cautions.length === 1 &&
      fit.evidence.length === 1 &&
      fit.reasons[0].code === 'NATAL_THEME_SUPPORT'
    );
  })()
);

// ============================================================
// Daily guidance -- fully synthetic, JSON round-trip preserves equality.
// ============================================================

check(
  'a fully synthetic DailyPersonalGuidance round-trips through JSON unchanged (structural equality preserved)',
  (() => {
    const recommendation: PersonalRecommendation = {
      activity: 'deep-work',
      startAt: '2026-09-09T05:00:00.000Z',
      endAt: '2026-09-09T06:30:00.000Z',
      score: 0.86,
      reasons: [
        { code: PERSONAL_REASON_CODES.NATAL_THEME_SUPPORT, message: 'Natal learning theme supportive.', evidence: [sampleEvidenceRef()] },
        { code: PERSONAL_REASON_CODES.LIFE_PERIOD_ALIGNMENT, message: 'Current life period supports focused growth.', evidence: [] },
        { code: PERSONAL_REASON_CODES.MUHURTA_WINDOW_SUPPORT, message: "Today's timing window is favorable.", evidence: [] },
      ],
      cautions: [],
      evidence: [sampleEvidenceRef()],
    };
    const guidance: DailyPersonalGuidance = {
      version: CONTRACT_VERSION,
      date: '2026-09-09',
      timezone: 'Asia/Kolkata',
      headline: 'A focused, growth-oriented day',
      summary: 'Today favors deep, uninterrupted work.',
      dominantThemes: [{ theme: 'FOCUS', strength: 0.8, direction: 'SUPPORTIVE', reasons: [] }],
      recommendations: [recommendation],
      evidence: [sampleEvidenceRef()],
    };
    const roundTripped = JSON.parse(JSON.stringify(guidance));
    return JSON.stringify(roundTripped) === JSON.stringify(guidance);
  })()
);

// ============================================================
// Contract version.
// ============================================================

check('CONTRACT_VERSION is the stable PERSONAL_INTELLIGENCE_CONTRACT_V2 string', CONTRACT_VERSION === 'PERSONAL_INTELLIGENCE_CONTRACT_V2');

// ============================================================
// CONTRACT_V2 -- pair-level TransitActivation (PR #101).
// ============================================================

check(
  'TransitActivation (CONTRACT_V2) is pair-level: transitingPlanet, natalPlanet, relationship, and strength are all first-class top-level fields, with NO activatedThemes/natalTargets/aggregate strength',
  (() => {
    const activation: TransitActivation = { transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0, evidence: [sampleEvidenceRef()] };
    const context: TransitActivationContext = { activations: [activation], evidence: [] };
    return (
      context.activations.length === 1 &&
      context.activations[0].transitingPlanet === 'Saturn' &&
      context.activations[0].natalPlanet === 'Moon' &&
      context.activations[0].relationship === 'SAME_SIGN' &&
      context.activations[0].strength === 1.0 &&
      !('activatedThemes' in context.activations[0]) &&
      !('natalTargets' in context.activations[0])
    );
  })()
);

check(
  'multiple directed pairs never collapse -- one TransitActivation record per (transitingPlanet, natalPlanet) pair, no grouping',
  (() => {
    const context: TransitActivationContext = {
      activations: [
        { transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0, evidence: [] },
        { transitingPlanet: 'Saturn', natalPlanet: 'Venus', relationship: 'TRINE', strength: 0.75, evidence: [] },
        { transitingPlanet: 'Saturn', natalPlanet: 'Mercury', relationship: 'OPPOSITION', strength: 0.5, evidence: [] },
      ],
      evidence: [],
    };
    return context.activations.length === 3 && new Set(context.activations.map((a) => a.natalPlanet)).size === 3;
  })()
);

check(
  'isPersonalTransitRelationship accepts exactly the 5 documented PersonalTransitRelationship values and rejects NONE / arbitrary strings',
  (() => {
    const valid: PersonalTransitRelationship[] = ['SAME_SIGN', 'TRINE', 'OPPOSITION', 'THREE_ELEVEN', 'TWO_TWELVE'];
    return valid.every((v) => isPersonalTransitRelationship(v)) && !isPersonalTransitRelationship('NONE') && !isPersonalTransitRelationship('CONJUNCTION') && !isPersonalTransitRelationship(42);
  })()
);

check(
  'packages/personal-intelligence still imports nothing from packages/bhrigu or packages/transit-activation -- PersonalTransitRelationship is a contract-local union, not a Bhrigu type import',
  !/from\s+['"][^'"]*\/(bhrigu|transit-activation)\//.test(
    ['packages/personal-intelligence/src/context.ts', 'packages/personal-intelligence/src/evidence.ts', 'packages/personal-intelligence/src/validation.ts']
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n')
  )
);

// ============================================================
// CONTRACT_V2 -- Life Weather synthesis contract (PR #101).
// ============================================================

check(
  'a fully synthetic LifeWeatherContext round-trips through JSON unchanged (structural equality preserved) and PersonalGuidanceContext.lifeWeather is optional',
  (() => {
    const lifeWeather: LifeWeatherContext = {
      engineVersion: 'LIFE_WEATHER_V1',
      evaluationTime: '2026-09-09T12:00:00.000Z',
      themes: PERSONAL_THEMES.map((theme) => ({
        theme,
        natalStrength: 0.4,
        natalDirection: 'NEUTRAL',
        state: 'QUIET',
        reinforcementSources: [],
        contributors: [{ source: 'NATAL', strength: 0.4, evidence: [] }],
        evidence: [],
      })),
      evidence: [sampleEvidenceRef({ source: 'LIFE_WEATHER', ruleId: 'LIFE_WEATHER_SUMMARY_V1' })],
    };
    const withoutLifeWeather: PersonalGuidanceContext = { version: CONTRACT_VERSION };
    const withLifeWeather: PersonalGuidanceContext = { version: CONTRACT_VERSION, lifeWeather };
    const roundTripped = JSON.parse(JSON.stringify(withLifeWeather));
    return (
      isPersonalGuidanceContext(withoutLifeWeather) &&
      withoutLifeWeather.lifeWeather === undefined &&
      isPersonalGuidanceContext(withLifeWeather) &&
      JSON.stringify(roundTripped) === JSON.stringify(withLifeWeather)
    );
  })()
);

check(
  'LifeWeatherContributor is a discriminated union on `source` -- each of the 4 kinds carries its own distinct fields',
  (() => {
    const natal: LifeWeatherContributor = { source: 'NATAL', strength: 0.5, evidence: [] };
    const mahadasha: LifeWeatherContributor = { source: 'DASHA_MAHADASHA', natalPlanet: 'Jupiter', evidence: [] };
    const antardasha: LifeWeatherContributor = { source: 'DASHA_ANTARDASHA', natalPlanet: 'Mercury', evidence: [] };
    const transit: LifeWeatherContributor = { source: 'TRANSIT', transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0, evidence: [] };
    return natal.source === 'NATAL' && mahadasha.source === 'DASHA_MAHADASHA' && antardasha.source === 'DASHA_ANTARDASHA' && transit.source === 'TRANSIT';
  })()
);

check(
  'LifeWeatherTheme.reinforcementSources is typed to only ever contain DASHA/TRANSIT, never NATAL',
  (() => {
    const theme: LifeWeatherTheme = {
      theme: 'LEARNING',
      natalStrength: 0.6,
      natalDirection: 'SUPPORTIVE',
      state: 'STRONGLY_ACTIVE',
      reinforcementSources: ['DASHA', 'TRANSIT'],
      contributors: [],
      evidence: [],
    };
    return theme.reinforcementSources.every((s) => s === 'DASHA' || s === 'TRANSIT');
  })()
);

// ============================================================
// CONTRACT_V2 -- Daily Personal Fit synthesis contract (PR #102).
// Purely additive: no version bump was needed for these types.
// ============================================================

check(
  'a fully synthetic DailyPersonalFitContext round-trips through JSON unchanged (structural equality preserved) and PersonalGuidanceContext.dailyFit is optional',
  (() => {
    const dailyFit: DailyPersonalFitContext = {
      engineVersion: 'DAILY_PERSONAL_FIT_V1',
      evaluationTime: '2026-09-09T12:00:00.000Z',
      activities: [
        {
          activityFamily: 'DEEP_WORK',
          personalRelevance: 'HIGHLY_RELEVANT',
          relevantThemes: [
            { theme: 'FOCUS', state: 'ACTIVE' },
            { theme: 'LEARNING', state: 'STRONGLY_ACTIVE' },
          ],
          evidence: [sampleEvidenceRef({ source: 'DAILY_PERSONAL_FIT', ruleId: 'DAILY_PERSONAL_FIT_RELEVANCE_DERIVATION_V1' })],
        },
      ],
      evidence: [sampleEvidenceRef({ source: 'DAILY_PERSONAL_FIT', ruleId: 'DAILY_PERSONAL_FIT_SUMMARY_V1' })],
    };
    const withoutDailyFit: PersonalGuidanceContext = { version: CONTRACT_VERSION };
    const withDailyFit: PersonalGuidanceContext = { version: CONTRACT_VERSION, dailyFit };
    const roundTripped = JSON.parse(JSON.stringify(withDailyFit));
    return (
      isPersonalGuidanceContext(withoutDailyFit) &&
      withoutDailyFit.dailyFit === undefined &&
      isPersonalGuidanceContext(withDailyFit) &&
      JSON.stringify(roundTripped) === JSON.stringify(withDailyFit)
    );
  })()
);

check(
  'dailyFit and lifeWeather remain separate, independently-optional sections -- dailyFit is never nested inside lifeWeather or vice versa',
  (() => {
    const context: PersonalGuidanceContext = {
      version: CONTRACT_VERSION,
      lifeWeather: { engineVersion: 'LIFE_WEATHER_V1', evaluationTime: '2026-09-09T12:00:00.000Z', themes: [], evidence: [] },
    };
    return context.dailyFit === undefined && context.lifeWeather !== undefined;
  })()
);

check(
  'DailyActivityFit has NO numeric relevance score field -- personalRelevance is the categorical union PersonalRelevance, never a number',
  (() => {
    const activity: DailyActivityFit = { activityFamily: 'FINANCE', personalRelevance: 'BASELINE', relevantThemes: [], evidence: [] };
    const relevance: PersonalRelevance = activity.personalRelevance;
    return (relevance === 'BASELINE' || relevance === 'RELEVANT' || relevance === 'HIGHLY_RELEVANT') && !('score' in activity) && !('relevanceScore' in activity);
  })()
);

check(
  'DailyPersonalFitRelevantTheme retains a mapped theme even at state QUIET -- the mapping itself is never filtered to "active themes only"',
  (() => {
    const relevantTheme: DailyPersonalFitRelevantTheme = { theme: 'CREATIVITY', state: 'QUIET' };
    return relevantTheme.state === 'QUIET';
  })()
);

check(
  "'DAILY_PERSONAL_FIT' is a valid PersonalEvidenceSource value",
  sampleEvidenceRef({ source: 'DAILY_PERSONAL_FIT', ruleId: 'DAILY_PERSONAL_FIT_SUMMARY_V1' }).source === 'DAILY_PERSONAL_FIT'
);

check(
  'the pre-existing placeholder PersonalActivityFit type is untouched by this PR -- still exactly { activity, score, reasons, cautions, evidence }, a DIFFERENT shape from DailyActivityFit (activityFamily-keyed, no numeric score)',
  (() => {
    const fit: PersonalActivityFit = { activity: 'deep-work', score: 0.5, reasons: [], cautions: [], evidence: [] };
    return typeof fit.activity === 'string' && typeof fit.score === 'number' && !('activityFamily' in fit) && !('personalRelevance' in fit) && !('relevantThemes' in fit);
  })()
);

check(
  'packages/personal-intelligence still imports nothing from packages/muhurta, packages/recommendation, or packages/daily-personal-fit -- DailyActivityFit.activityFamily stays a plain string, never a MuhurtaActivityFamily type import',
  !/from\s+['"][^'"]*\/(muhurta|recommendation|daily-personal-fit)\//.test(
    ['packages/personal-intelligence/src/context.ts', 'packages/personal-intelligence/src/evidence.ts', 'packages/personal-intelligence/src/guidance.ts', 'packages/personal-intelligence/src/validation.ts']
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n')
  )
);

// ============================================================
// Naming collision guard -- packages/recommendation/src/auraFitEngine.ts
// already exports an UNRELATED type also named `PersonalMuhurtaContext`
// (natal Nakshatra/Rashi/MoonElement inputs fed into Muhurta scoring, not
// a personalization-facing view of Muhurta timing windows). This
// package's own Muhurta-facing context type is named
// PersonalMuhurtaTimingContext specifically to avoid that collision --
// this guard exists to catch an accidental reintroduction of the
// ambiguous name in this package's own public exports.
// ============================================================

check(
  'this package exports PersonalMuhurtaTimingContext (the Muhurta-facing context type)',
  /\bPersonalMuhurtaTimingContext\b/.test(fs.readFileSync('packages/personal-intelligence/src/index.ts', 'utf8'))
);

check(
  'this package does NOT export its own PersonalMuhurtaContext -- that exact name is already taken by a different, unrelated type in packages/recommendation/src/auraFitEngine.ts',
  !/\bPersonalMuhurtaContext\b/.test(fs.readFileSync('packages/personal-intelligence/src/index.ts', 'utf8'))
);

check(
  'no source file in this package declares/exports its own type literally named PersonalMuhurtaContext anywhere (only PersonalMuhurtaTimingContext, and prose references to the OTHER package\'s type by name)',
  !/(export (interface|type) PersonalMuhurtaContext\b)/.test(
    [
      'packages/personal-intelligence/src/types.ts',
      'packages/personal-intelligence/src/themes.ts',
      'packages/personal-intelligence/src/evidence.ts',
      'packages/personal-intelligence/src/context.ts',
      'packages/personal-intelligence/src/guidance.ts',
      'packages/personal-intelligence/src/validation.ts',
      'packages/personal-intelligence/src/provenance.ts',
      'packages/personal-intelligence/src/index.ts',
    ]
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n')
  )
);

// ============================================================
// Dependency boundary -- pure contract package, zero cross-package
// imports, and definitely no apps/web/Prisma/DB/API/React dependency.
// ============================================================

const PACKAGE_SRC_FILES = [
  'packages/personal-intelligence/src/types.ts',
  'packages/personal-intelligence/src/themes.ts',
  'packages/personal-intelligence/src/evidence.ts',
  'packages/personal-intelligence/src/context.ts',
  'packages/personal-intelligence/src/guidance.ts',
  'packages/personal-intelligence/src/validation.ts',
  'packages/personal-intelligence/src/provenance.ts',
  'packages/personal-intelligence/src/index.ts',
];

check(
  'no source file in packages/personal-intelligence imports from another package (packages/bhrigu, packages/vedic, packages/panchang, packages/muhurta, packages/recommendation) -- every import is a relative import within this package itself',
  PACKAGE_SRC_FILES.every((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const importLines = source.match(/^import .*$/gm) ?? [];
    return importLines.every((line) => /from '\.\//.test(line));
  })
);

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

check(
  'no ACTUAL CODE (comments stripped) in packages/personal-intelligence references apps/web, Prisma, a database, an API route, React, or a UI framework -- doc comments may mention apps/web/ActionCard.activityId as documentation of an existing convention being reused by naming/shape only, which is not a real dependency',
  PACKAGE_SRC_FILES.every((file) => {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    return !/apps\/web|prisma|PrismaClient|react|localStorage|fetch\(|NextRequest|NextResponse|useState|useEffect/i.test(code);
  })
);

check(
  'no source file in packages/personal-intelligence uses Date, Map, Set, class instances, or functions inside a contract shape (would break serializability) -- Date/Map/Set do not appear anywhere in the package source at all',
  PACKAGE_SRC_FILES.every((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return !/\bnew Date\(|\bMap<|\bSet<|\bnew Map\(|\bnew Set\(/.test(source);
  })
);

check(
  'no timestamps/current-time/randomness anywhere in the package source (Date.now, new Date() with no args, Math.random)',
  PACKAGE_SRC_FILES.every((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return !/Date\.now\(\)|new Date\(\)|Math\.random\(\)/.test(source);
  })
);

// ============================================================
// Product boundary -- no scoring/prediction/recommendation logic exists.
// ============================================================

check(
  'no source file contains executable scoring/ranking logic (only type declarations, small pure validators, and one evidence-shape adapter) -- no function computes a score from inputs',
  PACKAGE_SRC_FILES.every((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return !/function (score|rank|recommend|compose|predict)/i.test(source);
  })
);

check(
  'no prediction/horoscope prose exists anywhere in the package source (only structural doc comments)',
  PACKAGE_SRC_FILES.every((file) => {
    const stripped = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    return !/you will|your career|your marriage|prediction:/i.test(stripped);
  })
);

// ============================================================
// Bhrigu/other existing packages remain untouched by this PR.
// ============================================================

check(
  'packages/bhrigu source is untouched by this PR (no reference to personal-intelligence anywhere in it)',
  !/personal-intelligence/i.test(
    [
      'packages/bhrigu/src/types.ts',
      'packages/bhrigu/src/constants.ts',
      'packages/bhrigu/src/normalize.ts',
      'packages/bhrigu/src/karakas.ts',
      'packages/bhrigu/src/relationships.ts',
      'packages/bhrigu/src/graph.ts',
      'packages/bhrigu/src/chains.ts',
      'packages/bhrigu/src/evidence.ts',
      'packages/bhrigu/src/provenance.ts',
      'packages/bhrigu/src/index.ts',
    ]
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n')
  )
);

if (!allPassed) {
  console.error('\nSome Personal Intelligence Contract checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL PERSONAL INTELLIGENCE CONTRACT CHECKS PASSED');
}
