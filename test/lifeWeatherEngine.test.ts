/**
 * Life Weather Engine V1: regression suite for packages/life-weather/src --
 * a deterministic synthesis layer composing already-computed natal
 * Personal Themes, current Vimshottari life period, and current Transit
 * Activation context (Personal Intelligence CONTRACT_V2's own pair-level
 * shape) into a structured "which personal themes are currently active,
 * and which independent systems are reinforcing them" result. See
 * packages/life-weather/README.md for the full convention (Model D
 * transit projection, categorical Dasha projection, structural
 * QUIET/ACTIVE/STRONGLY_ACTIVE state, no numeric activation score) this
 * suite verifies against.
 *
 * "Independently hard-coded expectations" (per this PR's own brief, item
 * 39): every expected theme set below is a bare, hand-derived literal
 * from packages/personal-themes/src/mappings.ts's own THEME_MAPPING_RULES
 * table, never computed by calling this engine's own getThemesForPlanet.
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

import {
  deriveLifeWeather,
  getThemesForPlanet,
  deriveLifeWeatherState,
  LifeWeatherValidationError,
  LIFE_WEATHER_ENGINE_VERSION,
} from '../packages/life-weather/src/index';
import { PERSONAL_THEMES } from '../packages/personal-intelligence/src/themes';
import type { PersonalTheme, PersonalThemeSignal } from '../packages/personal-intelligence/src/types';
import type { PersonalThemeContext, LifePeriodContext, TransitActivationContext, PersonalTransitRelationship, LifeWeatherContext } from '../packages/personal-intelligence/src/context';
import type { LifeWeatherInput } from '../packages/life-weather/src/index';

// ============================================================
// Independently hard-coded planet -> theme expectations (see module doc
// comment above) -- copied by hand from THEME_MAPPING_RULES, NOT derived
// by calling this engine's own getThemesForPlanet.
// ============================================================

const JUPITER_THEMES: PersonalTheme[] = ['LEARNING', 'CAREER', 'SPIRITUALITY', 'EXPLORATION'];
const MERCURY_THEMES: PersonalTheme[] = ['SOCIAL', 'LEARNING', 'FOCUS', 'FINANCE'];
const MOON_THEMES: PersonalTheme[] = ['FOCUS', 'RELATIONSHIPS', 'WELLBEING'];
const SATURN_THEMES: PersonalTheme[] = ['FOCUS', 'CAREER', 'WELLBEING'];
const VENUS_THEMES: PersonalTheme[] = ['RELATIONSHIPS', 'CREATIVITY', 'WELLBEING'];

function themeSet(themes: PersonalTheme[]): Set<PersonalTheme> {
  return new Set(themes);
}

// ============================================================
// Fixture builders.
// ============================================================

const EVALUATION_TIME = '2026-09-09T12:00:00.000Z';

function buildNatalThemeContext(overrides: Partial<Record<PersonalTheme, number>> = {}): PersonalThemeContext {
  const signals: PersonalThemeSignal[] = PERSONAL_THEMES.map((theme) => {
    const strength = overrides[theme] ?? 0.3;
    const signal: PersonalThemeSignal = { theme, strength, direction: strength >= 0.35 ? 'SUPPORTIVE' : 'NEUTRAL', reasons: [] };
    return signal;
  });
  return { signals, evidence: [] };
}

function buildLifePeriod(majorLord?: string, subLord?: string): LifePeriodContext {
  return {
    system: 'VIMSHOTTARI_DASHA',
    majorPeriod: majorLord !== undefined ? { ruler: majorLord, startAt: '2020-01-01T00:00:00.000Z', endAt: '2036-01-01T00:00:00.000Z', level: 'MAHADASHA' } : undefined,
    subPeriod: subLord !== undefined ? { ruler: subLord, startAt: '2025-01-01T00:00:00.000Z', endAt: '2027-01-01T00:00:00.000Z', level: 'ANTARDASHA' } : undefined,
    themes: [],
    evidence: [],
  };
}

function buildTransitActivations(pairs: Array<{ transitingPlanet: string; natalPlanet: string; relationship: PersonalTransitRelationship; strength: number }>): TransitActivationContext {
  return { activations: pairs.map((p) => ({ ...p, evidence: [] })), evidence: [] };
}

function baseInput(overrides: Partial<LifeWeatherInput> = {}): LifeWeatherInput {
  return {
    natalThemes: buildNatalThemeContext(),
    lifePeriod: buildLifePeriod(),
    transitActivations: buildTransitActivations([]),
    evaluationTime: EVALUATION_TIME,
    ...overrides,
  };
}

function themeResult(result: LifeWeatherContext, theme: PersonalTheme) {
  const found = result.themes.find((t) => t.theme === theme);
  if (!found) throw new Error(`Theme ${theme} missing from result -- this itself is a test failure condition.`);
  return found;
}

// ============================================================
// ALL 10 THEMES -- always full, canonical order, never sparse.
// ============================================================

check('deriveLifeWeather always returns exactly 10 themes', deriveLifeWeather(baseInput()).themes.length === 10);

check(
  'deriveLifeWeather returns themes in PERSONAL_THEMES canonical order',
  JSON.stringify(deriveLifeWeather(baseInput()).themes.map((t) => t.theme)) === JSON.stringify(PERSONAL_THEMES)
);

check('engineVersion is the stable LIFE_WEATHER_V1 literal', deriveLifeWeather(baseInput()).engineVersion === LIFE_WEATHER_ENGINE_VERSION && LIFE_WEATHER_ENGINE_VERSION === 'LIFE_WEATHER_V1');

check('evaluationTime is echoed through unchanged', deriveLifeWeather(baseInput({ evaluationTime: EVALUATION_TIME })).evaluationTime === EVALUATION_TIME);

// ============================================================
// STRUCTURAL STATE MODEL -- never magnitude-dependent.
// ============================================================

check('deriveLifeWeatherState: no current contributors -> QUIET', deriveLifeWeatherState(false, false) === 'QUIET');
check('deriveLifeWeatherState: Dasha only -> ACTIVE', deriveLifeWeatherState(true, false) === 'ACTIVE');
check('deriveLifeWeatherState: Transit only -> ACTIVE', deriveLifeWeatherState(false, true) === 'ACTIVE');
check('deriveLifeWeatherState: Dasha + Transit -> STRONGLY_ACTIVE', deriveLifeWeatherState(true, true) === 'STRONGLY_ACTIVE');

check(
  'STATE (full engine): no current contributors anywhere -> every theme QUIET',
  deriveLifeWeather(baseInput()).themes.every((t) => t.state === 'QUIET' && t.reinforcementSources.length === 0)
);

check(
  'STATE (full engine): Mahadasha + Antardasha only (no transit) -> Jupiter/Mercury-mapped themes ACTIVE, never STRONGLY_ACTIVE',
  (() => {
    const result = deriveLifeWeather(baseInput({ lifePeriod: buildLifePeriod('Jupiter', 'Mercury') }));
    const learning = themeResult(result, 'LEARNING'); // both Jupiter and Mercury map here
    return learning.state === 'ACTIVE' && learning.reinforcementSources.length === 1 && learning.reinforcementSources[0] === 'DASHA';
  })()
);

check(
  'STATE (full engine): multiple Transits only, same theme -> ACTIVE, never upgraded by contributor COUNT',
  (() => {
    const result = deriveLifeWeather(
      baseInput({
        transitActivations: buildTransitActivations([
          { transitingPlanet: 'Jupiter', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 },
          { transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'TRINE', strength: 0.75 },
          { transitingPlanet: 'Rahu', natalPlanet: 'Moon', relationship: 'OPPOSITION', strength: 0.5 },
        ]),
      })
    );
    const focus = themeResult(result, 'FOCUS'); // Moon maps to FOCUS
    return focus.state === 'ACTIVE' && focus.contributors.filter((c) => c.source === 'TRANSIT').length === 3;
  })()
);

check(
  'STATE (full engine): Dasha + Transit reinforcing the SAME theme -> STRONGLY_ACTIVE, reinforcementSources = [DASHA, TRANSIT]',
  (() => {
    const result = deriveLifeWeather(
      baseInput({
        lifePeriod: buildLifePeriod('Jupiter', undefined),
        transitActivations: buildTransitActivations([{ transitingPlanet: 'Saturn', natalPlanet: 'Jupiter', relationship: 'SAME_SIGN', strength: 1.0 }]),
      })
    );
    const learning = themeResult(result, 'LEARNING'); // Jupiter's own theme, both as MD lord and as transit target
    return learning.state === 'STRONGLY_ACTIVE' && JSON.stringify(learning.reinforcementSources) === JSON.stringify(['DASHA', 'TRANSIT']);
  })()
);

// ============================================================
// ZERO NATAL STRENGTH CAN STILL BECOME ACTIVE -- merge-critical.
// ============================================================

check(
  'ZERO NATAL STRENGTH: SOCIAL and FINANCE (natalStrength 0, matching real Personal Themes V1 structural behavior) still reach ACTIVE from Mercury Antardasha, with natalStrength unchanged at 0',
  (() => {
    const result = deriveLifeWeather(
      baseInput({
        natalThemes: buildNatalThemeContext({ SOCIAL: 0, FINANCE: 0 }),
        lifePeriod: buildLifePeriod(undefined, 'Mercury'),
      })
    );
    const social = themeResult(result, 'SOCIAL');
    const finance = themeResult(result, 'FINANCE');
    return social.natalStrength === 0 && social.state === 'ACTIVE' && finance.natalStrength === 0 && finance.state === 'ACTIVE';
  })()
);

check(
  'ZERO NATAL STRENGTH: SOCIAL reaches STRONGLY_ACTIVE (Mercury Antardasha + a transit activating natal Mercury) while natalStrength stays exactly 0',
  (() => {
    const result = deriveLifeWeather(
      baseInput({
        natalThemes: buildNatalThemeContext({ SOCIAL: 0 }),
        lifePeriod: buildLifePeriod(undefined, 'Mercury'),
        transitActivations: buildTransitActivations([{ transitingPlanet: 'Jupiter', natalPlanet: 'Mercury', relationship: 'TRINE', strength: 0.75 }]),
      })
    );
    const social = themeResult(result, 'SOCIAL');
    return social.natalStrength === 0 && social.state === 'STRONGLY_ACTIVE';
  })()
);

// ============================================================
// NATAL BASELINE IMMUTABILITY.
// ============================================================

check(
  'NATAL BASELINE IMMUTABILITY: input.natalThemes is never mutated, and every output natalStrength equals the corresponding input signal.strength exactly, regardless of current contributor count',
  (() => {
    const natalThemes = buildNatalThemeContext({ LEARNING: 0.6, CAREER: 0.7, SOCIAL: 0, FINANCE: 0 });
    const clone = JSON.parse(JSON.stringify(natalThemes));
    const result = deriveLifeWeather(
      baseInput({
        natalThemes,
        lifePeriod: buildLifePeriod('Jupiter', 'Mercury'),
        transitActivations: buildTransitActivations([
          { transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 },
          { transitingPlanet: 'Venus', natalPlanet: 'Jupiter', relationship: 'TRINE', strength: 0.75 },
        ]),
      })
    );
    const inputUnchanged = JSON.stringify(natalThemes) === JSON.stringify(clone);
    const everyStrengthPreserved = PERSONAL_THEMES.every((theme) => {
      const inputSignal = natalThemes.signals.find((s) => s.theme === theme) as PersonalThemeSignal;
      return themeResult(result, theme).natalStrength === inputSignal.strength;
    });
    return inputUnchanged && everyStrengthPreserved;
  })()
);

// ============================================================
// DASHA CATEGORICAL CONTRIBUTION -- independently hard-coded expectations.
// ============================================================

check(
  'DASHA MAPPING: Jupiter Mahadasha produces a DASHA_MAHADASHA contributor on exactly Jupiter\'s own canonical themes (LEARNING, CAREER, SPIRITUALITY, EXPLORATION), and no others',
  (() => {
    const result = deriveLifeWeather(baseInput({ lifePeriod: buildLifePeriod('Jupiter', undefined) }));
    const jupiterSet = themeSet(JUPITER_THEMES);
    return result.themes.every((t) => {
      const hasMahadasha = t.contributors.some((c) => c.source === 'DASHA_MAHADASHA');
      return hasMahadasha === jupiterSet.has(t.theme);
    });
  })()
);

check(
  'DASHA MAPPING: Mercury Antardasha produces a DASHA_ANTARDASHA contributor on exactly Mercury\'s own canonical themes (SOCIAL, LEARNING, FOCUS, FINANCE), and no others',
  (() => {
    const result = deriveLifeWeather(baseInput({ lifePeriod: buildLifePeriod(undefined, 'Mercury') }));
    const mercurySet = themeSet(MERCURY_THEMES);
    return result.themes.every((t) => {
      const hasAntardasha = t.contributors.some((c) => c.source === 'DASHA_ANTARDASHA');
      return hasAntardasha === mercurySet.has(t.theme);
    });
  })()
);

check(
  'DASHA MAPPING: Dasha contributors carry NO numeric strength field at all -- categorical only',
  (() => {
    const result = deriveLifeWeather(baseInput({ lifePeriod: buildLifePeriod('Jupiter', 'Mercury') }));
    const dashaContributors = result.themes.flatMap((t) => t.contributors).filter((c) => c.source === 'DASHA_MAHADASHA' || c.source === 'DASHA_ANTARDASHA');
    return dashaContributors.length > 0 && dashaContributors.every((c) => !('strength' in c));
  })()
);

// ============================================================
// MAHADASHA == ANTARDASHA (same lord).
// ============================================================

check(
  'MD == AD: Mahadasha lord and Antardasha lord both Mercury -- each Mercury-mapped theme keeps TWO SEPARATE contributors (DASHA_MAHADASHA and DASHA_ANTARDASHA), never collapsed',
  (() => {
    const result = deriveLifeWeather(baseInput({ lifePeriod: buildLifePeriod('Mercury', 'Mercury') }));
    return MERCURY_THEMES.every((theme) => {
      const contributors = themeResult(result, theme).contributors;
      return contributors.some((c) => c.source === 'DASHA_MAHADASHA') && contributors.some((c) => c.source === 'DASHA_ANTARDASHA');
    });
  })()
);

check(
  'MD == AD: despite two separate Dasha contributors, this still counts as ONE current system -- reinforcementSources = [DASHA] (never DASHA twice), state = ACTIVE (never STRONGLY_ACTIVE) with no transit present',
  (() => {
    const result = deriveLifeWeather(baseInput({ lifePeriod: buildLifePeriod('Mercury', 'Mercury') }));
    const learning = themeResult(result, 'LEARNING');
    return learning.state === 'ACTIVE' && JSON.stringify(learning.reinforcementSources) === JSON.stringify(['DASHA']);
  })()
);

// ============================================================
// TRANSIT TARGET PROJECTION -- Model D, merge-critical.
// ============================================================

check(
  'TRANSIT TARGET PROJECTION: transiting Saturn -> natal Moon SAME_SIGN activates exactly Moon\'s own themes (FOCUS, RELATIONSHIPS, WELLBEING), independently hard-coded -- never Saturn\'s own themes',
  (() => {
    const result = deriveLifeWeather(baseInput({ transitActivations: buildTransitActivations([{ transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 }]) }));
    const moonSet = themeSet(MOON_THEMES);
    return result.themes.every((t) => {
      const hasTransit = t.contributors.some((c) => c.source === 'TRANSIT');
      return hasTransit === moonSet.has(t.theme);
    });
  })()
);

check(
  'TRANSIT TARGET PROJECTION: CAREER is one of Saturn\'s OWN themes but is NOT one of Moon\'s -- a Saturn -> Moon activation must NOT give CAREER a transit contributor (proves projection is target-mediated, not transiting-planet-mediated)',
  (() => {
    const result = deriveLifeWeather(baseInput({ transitActivations: buildTransitActivations([{ transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 }]) }));
    return !MOON_THEMES.includes('CAREER') && !themeResult(result, 'CAREER').contributors.some((c) => c.source === 'TRANSIT');
  })()
);

// ============================================================
// TRANSITING PLANET DOES NOT CONTROL THEMES.
// ============================================================

check(
  'TRANSITING PLANET IS NOT THE SOURCE OF MEANING: Jupiter->Mercury and Saturn->Mercury (different transiting planets, same natal target) both project into exactly Mercury\'s own theme set -- proving the product is target-mediated',
  (() => {
    const result = deriveLifeWeather(
      baseInput({
        transitActivations: buildTransitActivations([
          { transitingPlanet: 'Jupiter', natalPlanet: 'Mercury', relationship: 'OPPOSITION', strength: 0.5 },
          { transitingPlanet: 'Saturn', natalPlanet: 'Mercury', relationship: 'TRINE', strength: 0.75 },
        ]),
      })
    );
    const mercurySet = themeSet(MERCURY_THEMES);
    const projectionCorrect = result.themes.every((t) => {
      const transitCount = t.contributors.filter((c) => c.source === 'TRANSIT').length;
      return mercurySet.has(t.theme) ? transitCount === 2 : transitCount === 0;
    });
    // Their own relationship/strength/evidence remain distinct per contributor.
    const learning = themeResult(result, 'LEARNING');
    const jupiterContributor = learning.contributors.find((c) => c.source === 'TRANSIT' && 'transitingPlanet' in c && c.transitingPlanet === 'Jupiter');
    const saturnContributor = learning.contributors.find((c) => c.source === 'TRANSIT' && 'transitingPlanet' in c && c.transitingPlanet === 'Saturn');
    const distinctFields =
      jupiterContributor !== undefined &&
      saturnContributor !== undefined &&
      'relationship' in jupiterContributor &&
      'relationship' in saturnContributor &&
      jupiterContributor.relationship === 'OPPOSITION' &&
      saturnContributor.relationship === 'TRINE' &&
      'strength' in jupiterContributor &&
      'strength' in saturnContributor &&
      jupiterContributor.strength === 0.5 &&
      saturnContributor.strength === 0.75;
    return projectionCorrect && distinctFields;
  })()
);

// ============================================================
// DIFFERENT NATAL TARGETS -- same transiting planet, different projection.
// ============================================================

check(
  'DIFFERENT NATAL TARGETS: Saturn->Moon and Saturn->Mercury (same transiting planet, different natal targets) project into genuinely DIFFERENT theme sets -- RELATIONSHIPS/WELLBEING only from Moon, SOCIAL/FINANCE only from Mercury, FOCUS from both',
  (() => {
    const result = deriveLifeWeather(
      baseInput({
        transitActivations: buildTransitActivations([
          { transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 },
          { transitingPlanet: 'Saturn', natalPlanet: 'Mercury', relationship: 'TRINE', strength: 0.75 },
        ]),
      })
    );
    const relationshipsOnlyFromMoon = themeResult(result, 'RELATIONSHIPS').contributors.filter((c) => c.source === 'TRANSIT').length === 1;
    const socialOnlyFromMercury = themeResult(result, 'SOCIAL').contributors.filter((c) => c.source === 'TRANSIT').length === 1;
    const focusFromBoth = themeResult(result, 'FOCUS').contributors.filter((c) => c.source === 'TRANSIT').length === 2;
    return relationshipsOnlyFromMoon && socialOnlyFromMercury && focusFromBoth;
  })()
);

// ============================================================
// PERSONAL DIFFERENTIATION -- two people, same evaluation instant.
// ============================================================

check(
  'PERSONAL DIFFERENTIATION: two people evaluated at the SAME instant, with different Dasha/transit target structure, produce DIFFERENT contributors/states -- personalization comes from which natal planets are reinforced, not from the universal mapping table differing',
  (() => {
    const personA = deriveLifeWeather(
      baseInput({
        lifePeriod: buildLifePeriod('Jupiter', undefined),
        transitActivations: buildTransitActivations([{ transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 }]),
        evaluationTime: EVALUATION_TIME,
      })
    );
    const personB = deriveLifeWeather(
      baseInput({
        lifePeriod: buildLifePeriod('Saturn', undefined),
        transitActivations: buildTransitActivations([{ transitingPlanet: 'Jupiter', natalPlanet: 'Venus', relationship: 'TRINE', strength: 0.75 }]),
        evaluationTime: EVALUATION_TIME,
      })
    );
    const focusA = themeResult(personA, 'FOCUS').state; // Moon -> FOCUS active for A
    const focusB = themeResult(personB, 'FOCUS').state; // Saturn (MD) -> FOCUS active for B too, but via a different system
    const creativityA = themeResult(personA, 'CREATIVITY').state; // nothing maps to CREATIVITY for A
    const creativityB = themeResult(personB, 'CREATIVITY').state; // Venus (transit target) -> CREATIVITY active for B
    return creativityA === 'QUIET' && creativityB === 'ACTIVE' && (focusA !== focusB || JSON.stringify(themeResult(personA, 'FOCUS').contributors) !== JSON.stringify(themeResult(personB, 'FOCUS').contributors));
  })()
);

// ============================================================
// TIME DIFFERENTIATION -- same person, different evaluation instant.
// ============================================================

check(
  'TIME DIFFERENTIATION: same natal PersonalThemeContext, two point-in-time contexts (Dasha boundary + transit sign change) -- current contributors/state change, natalStrength stays identical',
  (() => {
    const natalThemes = buildNatalThemeContext({ LEARNING: 0.6, CAREER: 0.7 });
    const before = deriveLifeWeather({
      natalThemes,
      lifePeriod: buildLifePeriod('Jupiter', 'Mercury'),
      transitActivations: buildTransitActivations([{ transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 }]),
      evaluationTime: '2026-01-01T00:00:00.000Z',
    });
    const after = deriveLifeWeather({
      natalThemes,
      lifePeriod: buildLifePeriod('Saturn', 'Venus'),
      transitActivations: buildTransitActivations([{ transitingPlanet: 'Jupiter', natalPlanet: 'Mercury', relationship: 'OPPOSITION', strength: 0.5 }]),
      evaluationTime: '2027-06-01T00:00:00.000Z',
    });
    const stateChanged = JSON.stringify(before.themes.map((t) => t.state)) !== JSON.stringify(after.themes.map((t) => t.state));
    const natalStable = PERSONAL_THEMES.every((theme) => themeResult(before, theme).natalStrength === themeResult(after, theme).natalStrength);
    return stateChanged && natalStable && before.evaluationTime !== after.evaluationTime;
  })()
);

// ============================================================
// EXPLAINABILITY -- one theme, all four contributor kinds, separately inspectable.
// ============================================================

check(
  'EXPLAINABILITY: LEARNING receives NATAL + DASHA_MAHADASHA + DASHA_ANTARDASHA + TRANSIT contributors, each separately inspectable with its own distinct evidence -- no blended evidence, no single score hiding the sources',
  (() => {
    const result = deriveLifeWeather(
      baseInput({
        natalThemes: buildNatalThemeContext({ LEARNING: 0.6 }),
        lifePeriod: buildLifePeriod('Jupiter', 'Mercury'),
        transitActivations: buildTransitActivations([{ transitingPlanet: 'Venus', natalPlanet: 'Jupiter', relationship: 'TRINE', strength: 0.75 }]),
      })
    );
    const learning = themeResult(result, 'LEARNING');
    const sources = learning.contributors.map((c) => c.source);
    const hasAllFour = sources.includes('NATAL') && sources.includes('DASHA_MAHADASHA') && sources.includes('DASHA_ANTARDASHA') && sources.includes('TRANSIT');
    const evidenceDistinct = learning.contributors.every((c) => c.evidence.length > 0) && new Set(learning.contributors.map((c) => JSON.stringify(c.evidence))).size === learning.contributors.length;
    return hasAllFour && learning.contributors.length === 4 && evidenceDistinct;
  })()
);

// ============================================================
// NO DOUBLE COUNTING -- multiple current contributors never multiply natalStrength.
// ============================================================

check(
  'NO DOUBLE COUNTING: Mercury Antardasha + two distinct transit pairs targeting natal Mercury -- every Mercury-eligible theme carries all THREE current contributors, while natalStrength remains exactly unchanged',
  (() => {
    const natalThemes = buildNatalThemeContext({ FOCUS: 0.5 });
    const result = deriveLifeWeather({
      natalThemes,
      lifePeriod: buildLifePeriod(undefined, 'Mercury'),
      transitActivations: buildTransitActivations([
        { transitingPlanet: 'Jupiter', natalPlanet: 'Mercury', relationship: 'TRINE', strength: 0.75 },
        { transitingPlanet: 'Saturn', natalPlanet: 'Mercury', relationship: 'OPPOSITION', strength: 0.5 },
      ]),
      evaluationTime: EVALUATION_TIME,
    });
    const focus = themeResult(result, 'FOCUS');
    const originalFocusStrength = (natalThemes.signals.find((s) => s.theme === 'FOCUS') as PersonalThemeSignal).strength;
    return (
      focus.contributors.filter((c) => c.source === 'TRANSIT').length === 2 &&
      focus.contributors.some((c) => c.source === 'DASHA_ANTARDASHA') &&
      focus.contributors.length === 4 && // NATAL + AD + 2 TRANSIT
      focus.natalStrength === originalFocusStrength &&
      focus.natalStrength === 0.5
    );
  })()
);

// ============================================================
// TRANSIT STRENGTH PRESERVATION -- verbatim, no rescale.
// ============================================================

check(
  'TRANSIT STRENGTH PRESERVATION: a pair strength of 0.75 remains exactly 0.75 on the TRANSIT contributor -- no rescale, no normalization',
  (() => {
    const result = deriveLifeWeather(baseInput({ transitActivations: buildTransitActivations([{ transitingPlanet: 'Jupiter', natalPlanet: 'Moon', relationship: 'TRINE', strength: 0.75 }]) }));
    const contributor = themeResult(result, 'FOCUS').contributors.find((c) => c.source === 'TRANSIT');
    return contributor !== undefined && 'strength' in contributor && contributor.strength === 0.75;
  })()
);

// ============================================================
// DETERMINISM.
// ============================================================

check(
  'DETERMINISM: repeated calls with structurally identical input produce deeply-equal output',
  (() => {
    const input = baseInput({
      natalThemes: buildNatalThemeContext({ LEARNING: 0.6, CAREER: 0.7 }),
      lifePeriod: buildLifePeriod('Jupiter', 'Mercury'),
      transitActivations: buildTransitActivations([{ transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 }]),
    });
    const first = deriveLifeWeather(input);
    const second = deriveLifeWeather(input);
    return JSON.stringify(first) === JSON.stringify(second);
  })()
);

check(
  'no Date.now()/new Date() with no args/Math.random anywhere in the package source (comments stripped) -- evaluationTime is always caller-supplied',
  (() => {
    const files = ['constants', 'mapping', 'contributors', 'state', 'evidence', 'validation', 'engine', 'provenance', 'index'].map((name) =>
      stripComments(fs.readFileSync(`packages/life-weather/src/${name}.ts`, 'utf8'))
    );
    const code = files.join('\n');
    return !/Date\.now\(\)/.test(code) && !/new Date\(\)(?!\.)/.test(code) && !/Math\.random\(\)/.test(code);
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
    return e instanceof LifeWeatherValidationError;
  }
}

check('rejects a malformed evaluationTime (non-ISO string)', expectThrows(() => deriveLifeWeather(baseInput({ evaluationTime: 'not-a-date' }))));
check('rejects an evaluationTime with no explicit zone designator', expectThrows(() => deriveLifeWeather(baseInput({ evaluationTime: '2026-09-09T12:00:00' }))));
check('rejects an impossible calendar evaluationTime (2026-02-30, syntactically ISO-shaped but not real)', expectThrows(() => deriveLifeWeather(baseInput({ evaluationTime: '2026-02-30T00:00:00Z' }))));
check('rejects a non-leap-year Feb 29 evaluationTime (2026 is not a leap year)', expectThrows(() => deriveLifeWeather(baseInput({ evaluationTime: '2026-02-29T00:00:00Z' }))));
check('accepts a genuine leap-year Feb 29 evaluationTime (2024 is a leap year)', !expectThrows(() => deriveLifeWeather(baseInput({ evaluationTime: '2024-02-29T00:00:00Z' }))));

check(
  'rejects natalThemes with fewer than 10 signals',
  expectThrows(() => deriveLifeWeather(baseInput({ natalThemes: { signals: buildNatalThemeContext().signals.slice(0, 9), evidence: [] } })))
);
check(
  'rejects natalThemes with a duplicate theme',
  expectThrows(() => {
    const ctx = buildNatalThemeContext();
    ctx.signals[1] = { ...ctx.signals[1], theme: ctx.signals[0].theme };
    return deriveLifeWeather(baseInput({ natalThemes: ctx }));
  })
);
check(
  'rejects natalThemes with an out-of-range strength',
  expectThrows(() => {
    const ctx = buildNatalThemeContext();
    ctx.signals[0] = { ...ctx.signals[0], strength: 1.5 };
    return deriveLifeWeather(baseInput({ natalThemes: ctx }));
  })
);

check('rejects a lifePeriod with the wrong system literal', expectThrows(() => deriveLifeWeather(baseInput({ lifePeriod: { ...buildLifePeriod(), system: 'SOMETHING_ELSE' as 'VIMSHOTTARI_DASHA' } }))));
check(
  'rejects a lifePeriod majorPeriod.ruler that does not resolve through the canonical planet-to-theme mapping',
  expectThrows(() => deriveLifeWeather(baseInput({ lifePeriod: buildLifePeriod('NotAPlanet', undefined) })))
);

check(
  'rejects transitActivations containing a duplicate directed (transitingPlanet, natalPlanet) pair',
  expectThrows(() =>
    deriveLifeWeather(
      baseInput({
        transitActivations: buildTransitActivations([
          { transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 },
          { transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'TRINE', strength: 0.75 },
        ]),
      })
    )
  )
);
check(
  'rejects transitActivations with an invalid relationship (e.g. NONE, which should never appear in a real pair-level context)',
  expectThrows(() => deriveLifeWeather(baseInput({ transitActivations: buildTransitActivations([{ transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'NONE' as PersonalTransitRelationship, strength: 0 }]) })))
);
check(
  'rejects transitActivations whose natalPlanet does not resolve through the canonical mapping',
  expectThrows(() => deriveLifeWeather(baseInput({ transitActivations: buildTransitActivations([{ transitingPlanet: 'Saturn', natalPlanet: 'NotAPlanet', relationship: 'SAME_SIGN', strength: 1.0 }]) })))
);

// ============================================================
// EVIDENCE / PAYLOAD DISCIPLINE.
// ============================================================

check(
  'every contributor carries exactly one small, LIFE_WEATHER-sourced evidence entry -- never an empty evidence array, never a forwarded upstream evidence tree',
  (() => {
    const result = deriveLifeWeather(
      baseInput({
        lifePeriod: buildLifePeriod('Jupiter', 'Mercury'),
        transitActivations: buildTransitActivations([{ transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 }]),
      })
    );
    return result.themes.flatMap((t) => t.contributors).every((c) => c.evidence.length === 1 && c.evidence[0].source === 'LIFE_WEATHER');
  })()
);

check(
  'PAYLOAD SIZE: a representative full 10-theme result (Mahadasha + Antardasha + 2 transits) serializes to well under 100KB',
  (() => {
    const result = deriveLifeWeather(
      baseInput({
        natalThemes: buildNatalThemeContext({ LEARNING: 0.6, CAREER: 0.7, FOCUS: 0.5 }),
        lifePeriod: buildLifePeriod('Jupiter', 'Mercury'),
        transitActivations: buildTransitActivations([
          { transitingPlanet: 'Saturn', natalPlanet: 'Moon', relationship: 'SAME_SIGN', strength: 1.0 },
          { transitingPlanet: 'Venus', natalPlanet: 'Jupiter', relationship: 'TRINE', strength: 0.75 },
        ]),
      })
    );
    const size = JSON.stringify(result).length;
    console.log(`    (approximate serialized size: ${size} characters / ~${Math.round(size / 1024)}KB)`);
    return size < 100_000;
  })()
);

check('result round-trips through JSON unchanged (structural equality preserved)', (() => {
  const result = deriveLifeWeather(baseInput({ lifePeriod: buildLifePeriod('Jupiter', 'Mercury') }));
  const roundTripped = JSON.parse(JSON.stringify(result));
  return JSON.stringify(roundTripped) === JSON.stringify(result);
})());

// ============================================================
// SCOPE / DEPENDENCY BOUNDARY.
// ============================================================

check(
  'no ACTUAL CODE (comments stripped) references Ashtakavarga (BAV/SAV/bindu), Panchang, Muhurta, or any numeric activation/overall score field name',
  (() => {
    const files = ['constants', 'mapping', 'contributors', 'state', 'evidence', 'validation', 'engine', 'provenance', 'index'].map((name) =>
      stripComments(fs.readFileSync(`packages/life-weather/src/${name}.ts`, 'utf8'))
    );
    const code = files.join('\n');
    return !/ashtakavarga|\bBAV\b|\bSAV\b|\bbindu\b|panchang|muhurta|activationStrength|lifeWeatherScore|themeScore|overallScore|supportScore/i.test(code);
  })()
);

check(
  'no ACTUAL CODE (comments stripped) uses a favorable/unfavorable polarity vocabulary (GOOD/BAD/FAVORABLE/UNFAVORABLE/LUCKY/UNLUCKY/POSITIVE/NEGATIVE)',
  (() => {
    const files = ['constants', 'mapping', 'contributors', 'state', 'evidence', 'validation', 'engine', 'provenance', 'index'].map((name) =>
      stripComments(fs.readFileSync(`packages/life-weather/src/${name}.ts`, 'utf8'))
    );
    const code = files.join('\n');
    return !/\b(GOOD|BAD|FAVORABLE|UNFAVORABLE|LUCKY|UNLUCKY|POSITIVE|NEGATIVE)\b/.test(code);
  })()
);

check(
  'every import in this package is a relative import within itself, or into packages/personal-intelligence or packages/personal-themes -- never packages/vedic, packages/bhrigu, packages/vimshottari, packages/transit-activation, packages/ashtakavarga, apps/web, or Prisma',
  (() => {
    const files = ['constants', 'mapping', 'contributors', 'state', 'evidence', 'validation', 'engine', 'provenance', 'index'].map((name) => fs.readFileSync(`packages/life-weather/src/${name}.ts`, 'utf8'));
    const code = files.join('\n');
    const importLines = code.match(/from\s+'[^']+'/g) ?? [];
    return importLines.every((line) => /from\s+'(\.\.?\/|\.\.\/\.\.\/personal-intelligence\/|\.\.\/\.\.\/personal-themes\/)/.test(line));
  })()
);

check(
  'this package never calls getNatalChart, calculateVimshottariDasha, calculateTransitActivation, buildBhriguNatalGraph, deriveThemeContext, or any Ashtakavarga calculation function (pure composition only)',
  (() => {
    const files = ['contributors', 'state', 'evidence', 'validation', 'engine'].map((name) => stripComments(fs.readFileSync(`packages/life-weather/src/${name}.ts`, 'utf8')));
    const code = files.join('\n');
    return !/getNatalChart\(|calculateVimshottariDasha\(|calculateTransitActivation\(|buildBhriguNatalGraph\(|deriveThemeContext\(|calculateAshtakavarga\(/.test(code);
  })()
);

check('packages/personal-themes and packages/personal-intelligence source are untouched by this PR (no reference to life-weather package path)', !/packages\/life-weather/i.test(fs.readFileSync('packages/personal-themes/src/index.ts', 'utf8')) && !/packages\/life-weather/i.test(fs.readFileSync('packages/personal-intelligence/src/index.ts', 'utf8')));

if (!allPassed) {
  console.error('\nSome Life Weather Engine checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL LIFE WEATHER ENGINE CHECKS PASSED');
}
