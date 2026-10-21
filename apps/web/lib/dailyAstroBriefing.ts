/**
 * Personalized Daily Briefing V1 -- deterministic Chandra Gochar
 * composition layer (AURA DB1).
 *
 * See AURA_DAILY_BRIEFING_V1_FEASIBILITY_AUDIT.md and
 * AURA_DB0_GOCHAR_RULE_PROVENANCE.md (repo root) for the research this
 * module implements.
 *
 * SCOPE: calculation + interpretation contract ONLY. No Home/Insights UI,
 * no API route, no notifications, no scheduling integration -- those are
 * DB2+.
 *
 * REUSE, NOT REIMPLEMENTATION: every astronomical/astrological primitive
 * this module needs already exists and is called here UNMODIFIED --
 * calculateDailyTransits() (packages/vedic/src/transits.ts),
 * buildNatalContext()/getTaraBala() (packages/vedic/src/natalChart.ts),
 * localDateTimeToUTC()/resolveLocalDateTime()/isValidCalendarDateString()
 * (packages/panchang/src/localDate.ts, re-exported from ./timezone),
 * findNextTransition() (packages/vedic/src/panchangElements.ts).
 * packages/vedic/src/transits.ts is NEVER imported from or modified by
 * this file beyond pulling its exported calculateDailyTransits() and
 * TransitInsight type -- see "Interpretation layer" below for exactly
 * which of its OWN fields this module deliberately does not trust.
 *
 * INTERPRETATION LAYER: calculateDailyTransits()'s own `isBenefic`/
 * `insight` fields are intentionally NOT used here -- they come from
 * transits.ts's private, unversioned, uncited rule table (see DB0's own
 * provenance report). This module recomputes favorability and prose from
 * the SAME raw geometry (graha, houseFromMoon) using its own versioned,
 * documented GOCHAR_RULE_VERSION table instead. This is the one
 * deliberate, narrow duplication DB0 recommended (interpretation only,
 * never astronomy) specifically so transits.ts and its one current
 * consumer (BirthChartSection.tsx / GET /api/panchang/transits) are
 * left completely unmodified and unaffected by this feature.
 *
 * DETERMINISM: this module never reads the system clock. Every instant
 * it uses is derived from the caller-supplied `localDate` + `timezone`
 * (and the caller-supplied birth details) -- the same inputs always
 * produce the same AstroDailyBriefing, including for a past `localDate`
 * ("yesterday's briefing").
 *
 * REFERENCE INSTANT: Gochar is evaluated at LOCAL NOON of the requested
 * `localDate`, converted to UTC via the given `timezone`. This matches
 * the existing, already-accepted convention in
 * packages/panchang/src/panchangDay.ts's own getPanchangForDate() (see
 * that file's own comment: noon avoids sitting close to a
 * midnight/sunrise boundary where transitions cluster) -- this module
 * does not invent a new time-of-day convention, it reuses the one this
 * codebase already ships. Because a day is not astrologically uniform,
 * `nakshatraTransitionWithinLocalDay` is populated whenever the transiting
 * Moon's nakshatra will change before the LOCAL day ends, so a caller/UI
 * never silently presents a noon snapshot as true for the whole day.
 *
 * NO ARBITRARY SCORING: favorability is reported per-graha as a boolean
 * (traditionally favorable/not, per the versioned house table), and
 * section text is built by COUNTING how many of a theme's significator
 * grahas are favorable today, never a weighted numeric score -- the same
 * "count distinct reinforcing facts" philosophy packages/life-weather/src/
 * state.ts already established in this codebase (see DB0 §2/§4 for why
 * this precedent was chosen deliberately).
 */

import { getTaraBala, buildNatalContext, type GrahaName, type TaraBala } from '../../../packages/vedic/src/natalChart';
import { calculateDailyTransits, type TransitInsight } from '../../../packages/vedic/src/transits';
import { findNextTransition, getNakshatra } from '../../../packages/vedic/src/panchangElements';
import { isValidCalendarDateString, resolveLocalDateTime } from '../../../packages/panchang/src/localDate';
import { localDateTimeToUTC, isValidIanaTimezone, addDaysToDateStr } from './timezone';

// ============================================================
// Rule version & Gochar house table (DB0-approved)
// ============================================================

/**
 * Versioned, cited interpretation convention. Bump this (never mutate the
 * table below in place for a past-dated briefing's sake) if the rule set
 * is ever revised -- every evidence entry carries this string so a stored
 * or reproduced briefing always shows which convention produced it.
 *
 * PROVENANCE (see AURA_DB0_GOCHAR_RULE_PROVENANCE.md §2 for the full
 * research): this is the standard Parashari "count houses from the natal
 * Moon" (Chandra Lagna) Gochar convention. The house-counting METHOD
 * itself is well-attested in classical Vedic astrology (Brihat Parashara
 * Hora Shastra has a dedicated transit treatment; Phaladeepika by
 * Mantreswara has a dedicated "Transit of Planets" chapter, Ch. 26 in the
 * V. Subrahmanya Sastri 1950 translation). The SPECIFIC per-graha house
 * numbers below are corroborated by convergent agreement across multiple
 * independent modern secondary sources, cross-checked during DB0 --
 * NOT independently verified verse-by-verse against either primary
 * Sanskrit text. Treat this table as a well-supported, commonly-cited
 * convention, not a universally-accepted or primary-source-certified one.
 *
 * KNOWN INTERPRETIVE DISAGREEMENTS (documented, not silently resolved):
 *  - Moon's own favorable houses: most sources agree on 1,3,6,7,10,11
 *    (used here), but at least one consulted source gives 1,4,5,9,10,11
 *    instead. This table follows the majority convention.
 *  - Mercury: the existing (unversioned) production table in
 *    packages/vedic/src/transits.ts additionally includes house 3.
 *    Cross-source research during DB0 found no corroboration for house 3
 *    on Mercury -- this table deliberately excludes it. This is the one
 *    intentional difference from transits.ts's own table; see this
 *    file's header comment for why that file is never modified to match.
 *
 * EXCLUDED FROM V1 (deliberately, not an oversight): Vedha (an
 * obstructing planet in a second house can cancel an otherwise-favorable
 * transit) is a real, further refinement in the tradition that this
 * table does not implement -- DB0 recommended deferring it to keep V1 the
 * "smallest defensible rule set," per the feasibility audit's own brief.
 */
export const GOCHAR_RULE_VERSION = 'GOCHAR_MOON_RELATIVE_PARASHARI_V1' as const;

/** DB0-approved favorable houses from the natal Moon, per graha. Mercury
 * excludes house 3 -- see GOCHAR_RULE_VERSION's own doc comment above for
 * exactly why this differs from packages/vedic/src/transits.ts's table.
 * Exported (read-only) so this exact table -- the one artifact DB0's
 * research and approval process was actually about -- is directly
 * unit-testable without going through a full astronomical computation. */
export const GOCHAR_FAVORABLE_HOUSES: Readonly<Record<GrahaName, readonly number[]>> = {
  Sun: [3, 6, 10, 11],
  Moon: [1, 3, 6, 7, 10, 11],
  Mars: [3, 6, 11],
  Mercury: [2, 4, 6, 8, 10, 11],
  Jupiter: [2, 5, 7, 9, 11],
  Venus: [1, 2, 3, 4, 5, 8, 9, 11, 12],
  Saturn: [3, 6, 11],
  Rahu: [3, 6, 11],
  Ketu: [3, 6, 11],
};

export function isGocharFavorable(graha: GrahaName, houseFromMoon: number): boolean {
  return GOCHAR_FAVORABLE_HOUSES[graha].includes(houseFromMoon);
}

// Local to this module, matching the established repo-wide pattern of
// each consumer keeping its own small Rashi-name table rather than a
// shared export (packages/vedic/src/natalChart.ts's own RASHI_NAMES is
// NOT exported; apps/web/components/BirthChartSection.tsx and
// SouthIndianChart.tsx both already keep their own local copies for the
// same reason) -- this file follows that same precedent rather than
// exporting a new shared constant from the untouched vedic package.
const RASHI_NAMES = [
  'Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya',
  'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena',
] as const;

// ============================================================
// Significator groupings (naisargika karakas) for section composition
// ============================================================

/**
 * Standard natural significators (naisargika karakas) -- a DIFFERENT,
 * separately well-established classical convention from the Gochar house
 * table above (near-universal across Vedic astrology texts, not a
 * specifically-researched-for-DB0 claim), used only to decide WHICH
 * grahas' Gochar results are relevant to each section. Mercury
 * legitimately appears in both CAREER and FINANCE (trade/communication
 * spans both) -- intentional, not a bug.
 */
const CAREER_KARAKAS: readonly GrahaName[] = ['Sun', 'Saturn', 'Mercury'];
const FINANCE_KARAKAS: readonly GrahaName[] = ['Jupiter', 'Venus', 'Mercury'];

/** Classical Vara (weekday-lord) ordering, used only as a neutral,
 * documented tie-break for picking ONE planet to headline Focus/Be
 * Mindful when several are equally notable -- never a weighting score. */
const GRAHA_PRIORITY_ORDER: readonly GrahaName[] = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu'];

// ============================================================
// Public types
// ============================================================

export type GocharEvidenceCategory = 'DAILY_THEME' | 'CAREER' | 'FINANCE' | 'FOCUS' | 'MINDFUL' | 'TARA_BALA' | 'CHANDRA_BALA';

/** One interpretive claim, traceable back to the calculation that
 * produced it. Astronomical facts (graha/transitRashi/houseFromNatalMoon)
 * are kept distinct from the interpretation (isFavorable/summary), which
 * is explicitly versioned. */
export interface GocharEvidenceRef {
  graha: GrahaName;
  transitRashiName: string;
  houseFromNatalMoon: number;
  isFavorable: boolean;
  category: GocharEvidenceCategory;
  ruleVersion: typeof GOCHAR_RULE_VERSION;
  summary: string;
}

export interface ChandraBala {
  transitRashiName: string;
  houseFromNatalMoon: number;
  favorable: boolean;
  ruleVersion: typeof GOCHAR_RULE_VERSION;
}

export interface AstroDailyBriefing {
  /** "YYYY-MM-DD" -- the local calendar day this briefing describes. */
  localDate: string;
  /** IANA timezone `localDate` was resolved in. */
  timezone: string;
  /** The exact UTC instant Gochar was evaluated at (local noon of
   * localDate in timezone) -- see this module's header comment. */
  referenceInstantUTC: string;

  natalMoonSign: string;
  natalNakshatra: string;

  dailyTheme: string;
  career: string;
  finance: string;
  focus: string;
  beMindful: string;

  taraBala: TaraBala;
  chandraBala: ChandraBala;

  /** Every graha's raw Gochar evidence, DAILY_THEME-categorized, plus the
   * section-specific entries referenced by career/finance/focus/beMindful. */
  evidence: GocharEvidenceRef[];

  ruleVersion: typeof GOCHAR_RULE_VERSION;

  /** Non-null exactly when the transiting Moon's nakshatra will change
   * before local midnight ends `localDate` -- so a caller never presents
   * this noon snapshot as uniformly true for the whole day. */
  nakshatraTransitionWithinLocalDay: { fromNakshatra: string; toNakshatra: string; transitionAtUTC: string } | null;
}

export type AstroDailyBriefingUnavailableReason = 'INCOMPLETE_BIRTH_PROFILE' | 'INVALID_BIRTH_PROFILE';
export type AstroDailyBriefingInvalidInputReason = 'INVALID_LOCAL_DATE' | 'INVALID_TIMEZONE' | 'NONEXISTENT_LOCAL_TIME';
export interface AstroDailyBriefingCalculationFailure {
  status: 'CALCULATION_FAILED';
  reason: string;
}

/** Typed result -- never throws for a routine missing/invalid-input case;
 * a future API/UI switches on `status`. Guidance text is populated ONLY
 * on `status: 'OK'` -- there is no code path that fabricates a briefing
 * from incomplete or invalid input. */
export type AstroDailyBriefingResult =
  | { status: 'OK'; briefing: AstroDailyBriefing }
  | { status: 'UNAVAILABLE'; reason: AstroDailyBriefingUnavailableReason }
  | { status: 'INVALID_INPUT'; reason: AstroDailyBriefingInvalidInputReason }
  | AstroDailyBriefingCalculationFailure;

export interface AstroDailyBriefingInput {
  birthDate: string | null | undefined; // "YYYY-MM-DD"
  birthTime: string | null | undefined; // "HH:MM", 24h
  birthTimezone: string | null | undefined; // IANA
  birthLatitude?: number | null;
  birthLongitude?: number | null;
  /** The local calendar day to generate the briefing for -- "today" or
   * any past date ("yesterday's briefing"), resolved via `timezone`. */
  localDate: string;
  /** The VIEWER's current timezone (distinct from birthTimezone, which is
   * fixed historical data) -- used only to resolve `localDate` to an
   * instant and to evaluate the day-boundary check. */
  timezone: string;
  currentLatitude?: number | null;
  currentLongitude?: number | null;
}

// Same HH:MM validation the birth-profile save route itself already
// enforces (apps/web/app/api/users/birth-profile/route.ts) -- reused here
// as a defensive re-check, not a new policy.
const BIRTH_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// ============================================================
// Public entry point
// ============================================================

export function generateAstroDailyBriefing(input: AstroDailyBriefingInput): AstroDailyBriefingResult {
  if (!isValidCalendarDateString(input.localDate)) {
    return { status: 'INVALID_INPUT', reason: 'INVALID_LOCAL_DATE' };
  }
  if (!isValidIanaTimezone(input.timezone)) {
    return { status: 'INVALID_INPUT', reason: 'INVALID_TIMEZONE' };
  }

  const referenceResolution = resolveLocalDateTime(input.localDate, '12:00', input.timezone);
  // Local noon is never inside a DST spring-forward gap in any real IANA
  // zone transition this codebase has observed, but resolveLocalDateTime
  // is total/exhaustive, so handle it rather than assume. AMBIGUOUS (a
  // fall-back overlap at noon) deterministically picks the EARLIER
  // instant, documented here rather than left as an implicit default.
  const referenceInstantUTC =
    referenceResolution.status === 'OK'
      ? referenceResolution.instant
      : referenceResolution.status === 'AMBIGUOUS'
        ? referenceResolution.earlier
        : null;
  if (!referenceInstantUTC) {
    return { status: 'INVALID_INPUT', reason: 'NONEXISTENT_LOCAL_TIME' };
  }

  const { birthDate, birthTime, birthTimezone } = input;
  if (!birthDate || !birthTime || !birthTimezone) {
    return { status: 'UNAVAILABLE', reason: 'INCOMPLETE_BIRTH_PROFILE' };
  }
  if (!isValidCalendarDateString(birthDate) || !BIRTH_TIME_PATTERN.test(birthTime) || !isValidIanaTimezone(birthTimezone)) {
    return { status: 'UNAVAILABLE', reason: 'INVALID_BIRTH_PROFILE' };
  }

  let birthMomentUTC: Date;
  let natalContext: ReturnType<typeof buildNatalContext>;
  let transits: TransitInsight[];
  try {
    birthMomentUTC = localDateTimeToUTC(birthDate, birthTime, birthTimezone);
    natalContext = buildNatalContext(birthMomentUTC);
    transits = calculateDailyTransits(
      birthMomentUTC,
      input.birthLatitude ?? 13.0827,
      input.birthLongitude ?? 80.2707,
      referenceInstantUTC,
      input.currentLatitude ?? 13.0827,
      input.currentLongitude ?? 80.2707
    );
  } catch (err) {
    return { status: 'CALCULATION_FAILED', reason: err instanceof Error ? err.message : 'Unknown calculation error.' };
  }

  if (transits.length !== 9) {
    // calculateDailyTransits() always returns exactly the 9 classical
    // grahas by construction (see transits.ts/natalChart.ts) -- anything
    // else means incomplete transit evidence, which this module refuses
    // to build partial/misleading guidance from.
    return { status: 'CALCULATION_FAILED', reason: `Expected 9 graha transits, received ${transits.length}.` };
  }

  const taraBala = getTaraBala(natalContext.natalNakshatraIndex, referenceInstantUTC);

  // Recompute favorability + evidence from the RAW geometry only --
  // deliberately never reads transits[i].isBenefic/.insight. See this
  // file's header comment.
  const reinterpreted = transits.map((t) => {
    const graha = t.graha as GrahaName;
    const isFavorable = isGocharFavorable(graha, t.houseFromMoon);
    return {
      graha,
      transitRashiName: RASHI_NAMES[t.transitRashi],
      houseFromNatalMoon: t.houseFromMoon,
      isFavorable,
    };
  });

  const byGraha = new Map(reinterpreted.map((r) => [r.graha, r]));
  const moon = byGraha.get('Moon')!; // Moon is always present -- length===9 already checked above

  const chandraBala: ChandraBala = {
    transitRashiName: moon.transitRashiName,
    houseFromNatalMoon: moon.houseFromNatalMoon,
    favorable: moon.isFavorable,
    ruleVersion: GOCHAR_RULE_VERSION,
  };

  const evidence: GocharEvidenceRef[] = [];
  const addEvidence = (graha: GrahaName, category: GocharEvidenceCategory, summary: string): GocharEvidenceRef => {
    const r = byGraha.get(graha)!;
    const ref: GocharEvidenceRef = {
      graha,
      transitRashiName: r.transitRashiName,
      houseFromNatalMoon: r.houseFromNatalMoon,
      isFavorable: r.isFavorable,
      category,
      ruleVersion: GOCHAR_RULE_VERSION,
      summary,
    };
    evidence.push(ref);
    return ref;
  };

  // ---- Daily Theme: count, never a single verdict for "the whole day" ----
  const favorableCount = reinterpreted.filter((r) => r.isFavorable).length;
  const dailyTheme = composeDailyTheme(favorableCount, reinterpreted.length, taraBala);
  reinterpreted.forEach((r) => addEvidence(r.graha, 'DAILY_THEME', gocharSentence(r.graha, r.houseFromNatalMoon, r.isFavorable)));

  // ---- Career / Finance: count-based, per significator group ----
  const career = composeThemeSection('career', CAREER_KARAKAS, byGraha, addEvidence);
  const finance = composeThemeSection('finance', FINANCE_KARAKAS, byGraha, addEvidence);

  // ---- Focus: the single most notable favorable transit today ----
  const focusGraha = pickNotable(reinterpreted, true);
  const focus = focusGraha
    ? composeFocusText(focusGraha, addEvidence)
    : "No graha is in a strongly favorable house from your natal Moon today -- a good day to maintain steady routines rather than push for new wins.";

  // ---- Be Mindful: the single most notable unfavorable transit, if any ----
  const mindfulGraha = pickNotable(reinterpreted, false);
  const beMindful = mindfulGraha
    ? composeMindfulText(mindfulGraha, addEvidence)
    : 'No significant cautions are highlighted by today\'s transits from your natal Moon.';

  // Tara Bala / Chandra Bala evidence entries
  evidence.push({
    graha: 'Moon',
    transitRashiName: chandraBala.transitRashiName,
    houseFromNatalMoon: chandraBala.houseFromNatalMoon,
    isFavorable: chandraBala.favorable,
    category: 'CHANDRA_BALA',
    ruleVersion: GOCHAR_RULE_VERSION,
    summary: `Chandra Bala: the transiting Moon is in House ${chandraBala.houseFromNatalMoon} from your natal Moon (${chandraBala.favorable ? 'traditionally favorable' : 'calls for extra care'}).`,
  });
  evidence.push({
    graha: 'Moon',
    transitRashiName: chandraBala.transitRashiName,
    houseFromNatalMoon: chandraBala.houseFromNatalMoon,
    isFavorable: taraBala.favorable,
    category: 'TARA_BALA',
    ruleVersion: GOCHAR_RULE_VERSION,
    summary: `Tara Bala: today falls on your ${taraBala.name} Tara from ${taraBala.natalNakshatraName} (${taraBala.favorable ? 'favorable' : 'use extra caution'}).`,
  });

  // ---- Within-local-day nakshatra transition check ----
  const nextDayStartUTC = localDateTimeToUTC(addDaysToDateStr(input.localDate, 1), '00:00', input.timezone);
  const nextNakshatraTransition = findNextTransition(referenceInstantUTC, 'NAKSHATRA');
  const nakshatraTransitionWithinLocalDay =
    nextNakshatraTransition < nextDayStartUTC
      ? {
          fromNakshatra: getNakshatra(referenceInstantUTC).name,
          toNakshatra: getNakshatra(new Date(nextNakshatraTransition.getTime() + 1000)).name,
          transitionAtUTC: nextNakshatraTransition.toISOString(),
        }
      : null;

  const briefing: AstroDailyBriefing = {
    localDate: input.localDate,
    timezone: input.timezone,
    referenceInstantUTC: referenceInstantUTC.toISOString(),
    natalMoonSign: natalContext.janmaRashi,
    natalNakshatra: natalContext.janmaNakshatra,
    dailyTheme,
    career,
    finance,
    focus,
    beMindful,
    taraBala,
    chandraBala,
    evidence,
    ruleVersion: GOCHAR_RULE_VERSION,
    nakshatraTransitionWithinLocalDay,
  };

  return { status: 'OK', briefing };
}

// ============================================================
// Composition helpers (pure, deterministic, no LLM, no fabricated claims)
// ============================================================

function gocharSentence(graha: GrahaName, house: number, isFavorable: boolean): string {
  return isFavorable
    ? `${graha} is transiting House ${house} from your natal Moon, traditionally a supportive placement.`
    : `${graha} is transiting House ${house} from your natal Moon, traditionally calling for more care.`;
}

function composeDailyTheme(favorableCount: number, total: number, taraBala: TaraBala): string {
  const unfavorableCount = total - favorableCount;
  // Deliberately never collapses to a single good/bad verdict -- states
  // both counts so the nuance of a mixed day is preserved (ticket
  // section 4: "do not treat one favourable planetary transit as proof
  // that the entire day is favourable", "when signals conflict, preserve
  // that nuance").
  const balance =
    favorableCount === total
      ? `All ${total} transiting grahas are in traditionally favorable houses from your natal Moon today.`
      : unfavorableCount === total
        ? `None of today's ${total} transiting grahas are in traditionally favorable houses from your natal Moon -- a day for patience over new initiatives.`
        : `${favorableCount} of ${total} transiting grahas are in traditionally favorable houses from your natal Moon today, while ${unfavorableCount} call for more care.`;
  const tara = `It also falls on your ${taraBala.name} Tara (${taraBala.favorable ? 'personally favorable' : 'personally use extra caution'}) relative to your birth nakshatra.`;
  return `${balance} ${tara}`;
}

function composeThemeSection(
  label: 'career' | 'finance',
  significators: readonly GrahaName[],
  byGraha: Map<GrahaName, { graha: GrahaName; transitRashiName: string; houseFromNatalMoon: number; isFavorable: boolean }>,
  addEvidence: (graha: GrahaName, category: GocharEvidenceCategory, summary: string) => GocharEvidenceRef
): string {
  const category: GocharEvidenceCategory = label === 'career' ? 'CAREER' : 'FINANCE';
  const rows = significators.map((g) => byGraha.get(g)!);
  const favorable = rows.filter((r) => r.isFavorable);
  const unfavorable = rows.filter((r) => !r.isFavorable);

  const noun = label === 'career' ? 'work and career matters' : 'financial matters';

  favorable.forEach((r) => addEvidence(r.graha, category, `${r.graha} (${label} significator) favors House ${r.houseFromNatalMoon} from your natal Moon.`));
  unfavorable.forEach((r) => addEvidence(r.graha, category, `${r.graha} (${label} significator) is in House ${r.houseFromNatalMoon} from your natal Moon, traditionally less supportive.`));

  if (favorable.length === rows.length) {
    return `All of today's traditional significators for ${noun} (${rows.map((r) => r.graha).join(', ')}) are favorably placed from your natal Moon -- a supportive backdrop, though outcomes still depend on your own actions.`;
  }
  if (unfavorable.length === rows.length) {
    return `Today's traditional significators for ${noun} (${rows.map((r) => r.graha).join(', ')}) are not favorably placed from your natal Moon -- a day to move carefully rather than take new risks in this area.`;
  }
  return `Mixed signals for ${noun}: ${favorable.map((r) => r.graha).join(', ')} ${favorable.length === 1 ? 'is' : 'are'} favorably placed from your natal Moon, while ${unfavorable.map((r) => r.graha).join(', ')} ${unfavorable.length === 1 ? 'is' : 'are'} not -- worth weighing both before committing to anything major.`;
}

function pickNotable(
  reinterpreted: { graha: GrahaName; transitRashiName: string; houseFromNatalMoon: number; isFavorable: boolean }[],
  wantFavorable: boolean
): { graha: GrahaName; transitRashiName: string; houseFromNatalMoon: number; isFavorable: boolean } | null {
  const candidates = reinterpreted.filter((r) => r.isFavorable === wantFavorable);
  if (candidates.length === 0) return null;
  for (const graha of GRAHA_PRIORITY_ORDER) {
    const match = candidates.find((c) => c.graha === graha);
    if (match) return match;
  }
  return candidates[0];
}

function composeFocusText(
  r: { graha: GrahaName; transitRashiName: string; houseFromNatalMoon: number; isFavorable: boolean },
  addEvidence: (graha: GrahaName, category: GocharEvidenceCategory, summary: string) => GocharEvidenceRef
): string {
  addEvidence(r.graha, 'FOCUS', `${r.graha} is favorably placed in House ${r.houseFromNatalMoon} from your natal Moon, the most notable supportive transit today.`);
  return `${r.graha}'s favorable placement (House ${r.houseFromNatalMoon} from your natal Moon) is today's most notable supportive transit -- a good area to direct deliberate attention.`;
}

function composeMindfulText(
  r: { graha: GrahaName; transitRashiName: string; houseFromNatalMoon: number; isFavorable: boolean },
  addEvidence: (graha: GrahaName, category: GocharEvidenceCategory, summary: string) => GocharEvidenceRef
): string {
  addEvidence(r.graha, 'MINDFUL', `${r.graha} is in House ${r.houseFromNatalMoon} from your natal Moon, traditionally the day's most notable caution.`);
  return `${r.graha}'s placement (House ${r.houseFromNatalMoon} from your natal Moon) is today's most notable traditional caution -- worth a touch more care, not a reason for alarm.`;
}
