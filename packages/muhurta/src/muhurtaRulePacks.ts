/**
 * Muhurta Rule Packs: family-level base rules + intent-specific overrides,
 * merged into an "effective rule set" (a MuhurtaRulePack) that a generic
 * evaluator can consume -- replacing the pattern of adding a new
 * `if (intent === 'X') { ... }` branch to muhurtaEngine.ts every time a new
 * occasion is added.
 *
 * ## The Aura Muhurta methodology
 *
 * AURA_MUHURTA_METHODOLOGY_ID ('AURA_MUHURTA_V1') names the single ruleset
 * every rule pack in this file belongs to. It is a GENERAL-scope synthesis
 * (see MuhurtaRuleScope) assembled from the family-level RULES table already
 * in muhurtaEngine.ts plus, as of this PR, genuinely sourced intent-specific
 * data for Griha Pravesh -- see this module's provenance metadata on each
 * rule pack for exactly what was used. It does NOT claim to represent any
 * single regional or lineage-specific Jyotish tradition (Tamil, Kerala,
 * North Indian, or otherwise); "GENERAL" scope means "a mainstream synthesis
 * used across widely-available contemporary Vedic astrology reference
 * material," not "universal." Rule packs are never silently mixed across
 * methodology versions -- every pack's metadata.methodologyVersion records
 * which one it belongs to, and a future methodology (e.g. a specific
 * regional tradition) would get its own identifier rather than blending
 * into this one.
 *
 * ## Rule provenance
 *
 * Every populated rule pack (i.e. every pack that isn't honestly MISSING)
 * carries `metadata.sources`: MuhurtaRuleSource entries recording WHERE the
 * Tithi/Nakshatra data came from and how confident that provenance is
 * (`confidence`). This is deliberately NOT surfaced in MuhurtaReason objects
 * (brief section 8) -- reasons stay clean (NAKSHATRA_SUPPORTIVE / value)
 * and provenance instead rides on MuhurtaEvaluation.provenance
 * (methodology + rulePackId), for a future "how Aura calculated this" audit
 * view to look up separately. The engine never requires human-readable
 * source text during scoring -- provenance is metadata alongside the rule
 * data, not consumed by the scoring formula.
 *
 * ## What already exists vs. what's new here
 *
 * The pre-existing traditional rule data in this codebase is
 * muhurtaEngine.ts's `RULES` table (getFamilyRuleData()) -- Tithi/Nakshatra
 * preference lists keyed by the legacy MuhurtaActivityFamily (13 buckets),
 * plus GLOBAL, family-independent constants (FAVORABLE_YOGAS/
 * DIFFICULT_YOGAS/FAVORABLE_KARANAS, and the ABHIJIT/RAHU_KALAM/YAMA
 * solar-window rules) -- none of it carried citable provenance before this
 * PR (it predates this metadata model and is treated here as
 * 'CURATED_METHODOLOGY' / 'ESTABLISHED' confidence by inheritance, not
 * re-audited).
 *
 * As of this PR, INTENT_RULE_PACKS has ONE real entry: GRIHA_PRAVESH,
 * populated from multi-source web research (see its MuhurtaRuleSource
 * entries below for the specific references and what was cross-checked).
 * ENGAGEMENT was researched with equal rigor and deliberately NOT
 * populated -- every "engagement-specific" ruleset found either (a)
 * originated from a site that self-identifies as AI-generated content
 * (a domain literally branded "KundliGPT"), or (b) explicitly described
 * engagement as reusing marriage/Vivah's Nakshatra set "relaxed," which
 * is exactly the "don't assume Engagement rules can be reused from
 * Marriage" pattern this PR's brief warns against -- and Marriage itself
 * is out of scope and unaudited. No source cleared the bar for confident,
 * intent-specific, non-derivative Engagement data, so Engagement remains
 * PARTIAL and this is reported as a gap, not silently worked around.
 *
 * ## Family base reuse
 *
 * FAMILY_BASE_SOURCE below maps each newer MuhurtaFamily to the *legacy*
 * MuhurtaActivityFamily whose existing RULES entry is a legitimate,
 * documented proxy for it -- e.g. BUSINESS reuses NEW_BEGINNING's data
 * because activityDefinitions.ts's own 'new-beginning' notes already name
 * "BUSINESS_START... HOME/CONSTRUCTION_START" as narrower intents that
 * entry was standing in for. This is REUSABLE_BASE_RULE coverage, not
 * invented data -- see resolveMuhurtaRulePack()'s coverage classification.
 *
 * HOME has NO entry: no existing family's data was written for a
 * home/property-ceremony context, and the only structurally "close" legacy
 * family (ADMIN, "supports routine cleanup") would actively misrepresent a
 * Griha Pravesh ceremony's Panchanga needs if silently reused. Griha
 * Pravesh's coverage now comes from its own INTENT_RULE_PACKS entry
 * instead (IMPLEMENTED, not a borrowed family base).
 */

import { getFamilyRuleData, evaluatePanchangaNakshatraTithiReasons, evaluatePanchangaYogaKaranaReasons, evaluateSolarWindowReason, getPanchangaSnapshot, MuhurtaActivityFamily, MuhurtaEvaluation } from './muhurtaEngine';
import { deriveLegacyMuhurtaText } from './muhurtaReasonFormat';
import type { SolarWindowType } from '../../panchang/src/windows';
import type { MuhurtaClassification, MuhurtaFamily, MuhurtaIntent, MuhurtaReason } from './activityOntology';

/** The single methodology identifier every rule pack in this file belongs
 * to -- see this module's doc comment ("The Aura Muhurta methodology"). */
export const AURA_MUHURTA_METHODOLOGY_ID = 'AURA_MUHURTA_V1' as const;

export type RuleCoverageStatus = 'IMPLEMENTED' | 'REUSABLE_BASE_RULE' | 'MISSING';

export interface MuhurtaRulePackCoverage {
  tithi: RuleCoverageStatus;
  nakshatra: RuleCoverageStatus;
  /** Global, family/intent-independent (FAVORABLE_YOGAS/DIFFICULT_YOGAS) --
   * always IMPLEMENTED for every activity today. This describes whether the
   * always-on GENERIC/SOFT Yoga scoring applies (it always does) -- a
   * SEPARATE axis from `yogaAuthoritative` below, which describes whether
   * THIS pack has its own genuinely event-specific, HARD-eligibility Yoga
   * avoid data. Do not confuse the two: only `yogaAuthoritative` may ever
   * gate a hard rejection. */
  yoga: RuleCoverageStatus;
  /** Global, family/intent-independent (FAVORABLE_KARANAS + Vishti check) --
   * always IMPLEMENTED for every activity today. Same "generic/soft, always
   * on" meaning as `yoga` above -- see `karanaAuthoritative` for the
   * separate hard-eligibility axis. */
  karana: RuleCoverageStatus;
  /** ABHIJIT support + RAHU_KALAM/YAMA caution are global baselines that
   * always apply -- always IMPLEMENTED. BRAHMA/GULIKA bonus windows are
   * family-conditional extras layered on top when the legacy family
   * qualifies; their absence does not downgrade this to MISSING. */
  windows: RuleCoverageStatus;
  /** Marriage Muhurtham Foundation V1: whether this pack has genuinely
   * event-specific (authoritative) Yoga avoid data of its own -- mirrors
   * tithi/nakshatra's IMPLEMENTED/REUSABLE_BASE_RULE/MISSING semantics
   * exactly. Only 'IMPLEMENTED' here may ever hard-reject a candidate (see
   * isAuthoritativeAvoidYoga) -- the same discipline as Tithi/Nakshatra's
   * own gate. MISSING for every pack except one with its own INTENT_RULE_PACKS
   * yoga override (Griha Pravesh has none -- see this module's doc comment:
   * "Only tithi/nakshatra are overridable here"). */
  yogaAuthoritative: RuleCoverageStatus;
  /** Same principle as yogaAuthoritative, for Karana (isAuthoritativeAvoidKarana). */
  karanaAuthoritative: RuleCoverageStatus;
  /** Marriage Muhurtham Foundation V1 (PR A): whether whole lunar/solar-month
   * or period-level exclusion (Chaturmas, Kharmas, Adhika Masa, ...) is
   * implemented. MISSING for every intent today -- no mechanism to express
   * this exists yet anywhere in the engine (that is PR B's job). An intent
   * whose own rule pack declares `requiresPeriodExclusion` cannot reach
   * SUPPORTED while this stays MISSING -- see computeMuhurtaSupportLevel(). */
  periodExclusion: RuleCoverageStatus;
  /** Same gating principle as periodExclusion, for planetary combustion
   * (Guru/Shukra Asta) -- also MISSING for every intent today, also PR B. */
  planetaryCombustion: RuleCoverageStatus;
}

/**
 * Where a rule pack's Tithi/Nakshatra data came from. Deliberately NOT
 * embedded in MuhurtaReason (brief section 8) -- lives on the rule pack /
 * evaluation only, for future audit/methodology UI.
 */
export type MuhurtaRuleSourceType = 'CLASSICAL_TEXT' | 'TRADITIONAL_REFERENCE' | 'CURATED_METHODOLOGY';
export type MuhurtaRuleConfidence = 'ESTABLISHED' | 'CURATED' | 'PROVISIONAL';
export type MuhurtaRuleScope = 'GENERAL' | 'REGIONAL';

export interface MuhurtaRuleSource {
  id: string;
  title: string;
  tradition?: string;
  sourceType: MuhurtaRuleSourceType;
  /** URL or textual citation. For TRADITIONAL_REFERENCE sources this is
   * typically the reference URL consulted -- NOT a claim that the source
   * itself cites a classical text (many don't; see each source's own
   * `notes`). */
  citation?: string;
  notes?: string;
}

export interface MuhurtaRulePackMetadata {
  methodologyVersion: typeof AURA_MUHURTA_METHODOLOGY_ID;
  sources: MuhurtaRuleSource[];
  confidence: MuhurtaRuleConfidence;
  scope: MuhurtaRuleScope;
  lastReviewed?: string;
  /** Short human-readable summary of provenance/reasoning -- unchanged
   * field from the previous PR, kept for the existing display/debug uses. */
  note: string;
}

/**
 * A factor's rule set, expressive enough for the four tiers a source MIGHT
 * distinguish (brief section 5) -- but `acceptable`/`block` are reserved
 * for future rule packs whose source material actually supports that
 * granularity. No rule pack in this codebase populates them yet (every
 * source found so far only supports a favorable/avoid distinction), and
 * the evaluator (evaluateMuhurtaWithRulePack below, and the shared
 * evaluatePanchangaNakshatraTithiReasons() helper) only consumes
 * favorable/avoid today -- see this module's doc comment. Do not populate
 * acceptable/block without also wiring evaluator support and tests; an
 * unpopulated tier is not silently inferred as anything.
 */
export interface MuhurtaFactorRuleSet<T> {
  favorable: T[];
  acceptable?: T[];
  avoid: T[];
  block?: T[];
}

export interface MuhurtaRulePack {
  /** Stable identifier for provenance/audit purposes (MuhurtaEvaluation.
   * provenance.rulePackId) -- e.g. 'GRIHA_PRAVESH_V1' for a dedicated pack,
   * '<LEGACY_FAMILY>_FAMILY_BASE' for a reused family base, or
   * '<FAMILY>_EMPTY' when no data exists. */
  id: string;
  family: MuhurtaFamily;
  intent: MuhurtaIntent;
  tithi: MuhurtaFactorRuleSet<RegExp>;
  nakshatra: MuhurtaFactorRuleSet<string>;
  /** Marriage Muhurtham Foundation V1: event-specific Yoga/Karana rule
   * sets, matched by exact name (Yoga/Karana names, unlike Tithi, have no
   * paksha prefix variation to pattern-match around -- see
   * packages/vedic/src/panchangElements.ts's YOGA_NAMES/KARANA_NAMES).
   * Empty {favorable: [], avoid: []} for every pack with no dedicated
   * override (i.e. everything except an INTENT_RULE_PACKS entry that
   * explicitly supplies one) -- see coverage.yogaAuthoritative/
   * karanaAuthoritative for whether this data is genuinely authoritative. */
  yoga: MuhurtaFactorRuleSet<string>;
  karana: MuhurtaFactorRuleSet<string>;
  coverage: MuhurtaRulePackCoverage;
  /** Marriage Muhurtham Foundation V1: true when this intent's own
   * traditional rule set requires whole lunar/solar-month or period-level
   * exclusion (Chaturmas, Kharmas, Adhika Masa, ...) to be a genuinely
   * defensible ceremonial result. computeMuhurtaSupportLevel() refuses
   * SUPPORTED for a CEREMONIAL intent that declares this true until
   * coverage.periodExclusion also reaches IMPLEMENTED (PR B). False for
   * every intent today except MARRIAGE -- Griha Pravesh was audited and
   * found to have no analogous requirement. */
  requiresPeriodExclusion: boolean;
  /** Same gating principle as requiresPeriodExclusion, for planetary
   * combustion (Guru/Shukra Asta) -- see coverage.planetaryCombustion. */
  requiresPlanetaryCombustion: boolean;
  /** The legacy family this pack's tithi/nakshatra data was sourced from, if
   * any (undefined when coverage is MISSING or the pack is intent-specific).
   * Exposed for audit/debugging, not consumed by scoring. */
  reusedFromLegacyFamily?: MuhurtaActivityFamily;
  /** SHORT phrase threaded into a NAKSHATRA_SUPPORTIVE reason's
   * `params.note` (e.g. "supports a smooth home entry") -- matching the
   * terse style of the legacy per-family RULES table's own `note` field
   * (e.g. "supports auspicious starts"). Deliberately separate from
   * metadata.note/sources, which carry longer audit/provenance prose: brief
   * section 8 is explicit that reasons must stay clean, never carrying
   * citation-length text. */
  reasonNote: string;
  metadata: MuhurtaRulePackMetadata;
}

export type MuhurtaSupportLevel = 'SUPPORTED' | 'PARTIAL' | 'NOT_YET_SUPPORTED';

/**
 * Which legacy MuhurtaActivityFamily's RULES entry each newer MuhurtaFamily
 * may reuse as its rule-pack base. See this module's doc comment for the
 * reasoning per family. Deliberately a Partial map -- HOME has no entry.
 */
const FAMILY_BASE_SOURCE: Partial<Record<MuhurtaFamily, MuhurtaActivityFamily>> = {
  WORK: 'FOCUSED_WORK',
  BUSINESS: 'NEW_BEGINNING',
  FINANCE: 'FINANCE',
  TRAVEL: 'JOURNEY_START',
  RELATIONSHIP: 'RELATIONSHIP',
  EDUCATION: 'LEARNING',
  HEALTH: 'WELLBEING',
  SOCIAL: 'SOCIAL',
  ROUTINE: 'ADMIN',
  // HOME: intentionally absent -- see module doc comment.
};

/**
 * Provenance for the pre-existing family-level RULES table (muhurtaEngine.ts)
 * -- this data predates the provenance model added in this PR and was not
 * re-audited against primary sources here; it is inherited as
 * CURATED_METHODOLOGY / ESTABLISHED (already in production, exercised by
 * every existing activity) rather than re-sourced.
 */
const LEGACY_FAMILY_BASE_SOURCE_RECORD: MuhurtaRuleSource = {
  id: 'aura-legacy-family-rules',
  title: 'Aura pre-existing per-family Tithi/Nakshatra rule table',
  sourceType: 'CURATED_METHODOLOGY',
  notes: 'Predates the rule-pack provenance model (this PR). Not re-audited against primary classical sources here; carried forward as the established baseline every existing activity already depends on.',
};

/**
 * Griha Pravesh (housewarming / home-entry ceremony) Tithi/Nakshatra data.
 *
 * Sourced from multi-source web research (August 2026) cross-referencing
 * independent contemporary Vedic-astrology reference material. Only
 * Tithis/Nakshatras corroborated across 2+ independently-authored sources
 * were kept; single-source or internally-contradicted values (e.g.
 * Shatabhisha, cited as both favorable and inauspicious across different
 * pages) were excluded rather than guessed at. No source consulted cited a
 * specific classical Sanskrit text by name for Griha Pravesh with a
 * verifiable direct quotation, so sourceType is TRADITIONAL_REFERENCE
 * (contemporary reference material reflecting the tradition), not
 * CLASSICAL_TEXT, and confidence is CURATED (multi-source corroborated),
 * not ESTABLISHED (no primary-text verification).
 *
 * Favorable Nakshatras (2+ sources): Rohini, Mrigashira, Uttara Phalguni,
 * Chitra, Anuradha, Uttara Ashadha, Revati.
 * Avoid Nakshatras (2+ sources, and a widely-cited general "avoid for
 * auspicious beginnings" category -- Ashlesha/Jyeshtha/Mula, the
 * Rahu/Ketu/Mars-ruled junction nakshatras): Ashlesha, Jyeshtha, Mula.
 * Favorable Tithis (2+ sources): Dvitiya, Tritiya, Panchami, Dashami,
 * Ekadashi, Trayodashi.
 * Avoid Tithis (2+ sources -- the Rikta tithis 4/9/14 plus Ashtami and
 * Amavasya): Amavasya, Chaturthi, Ashtami, Navami, Chaturdashi.
 *
 * Deliberately excluded (single-source or contradicted, not confident
 * enough to encode): Hasta, Pushya, Swati, Shravana, Dhanishta, Uttara
 * Bhadrapada, Shatabhisha (nakshatra); Saptami (favorable tithi, 1 source);
 * Bharani, Krittika, Ardra, Magha (avoid nakshatra, 1 source each);
 * Dvadashi/6th-tithi restrictions (1 source, and internally inconsistent
 * with itself).
 */
const GRIHA_PRAVESH_SOURCES: MuhurtaRuleSource[] = [
  {
    id: 'griha-pravesh-web-aggregate-1',
    title: 'Griha Pravesh Muhurat -- Tithi/Nakshatra aggregate reference',
    sourceType: 'TRADITIONAL_REFERENCE',
    citation: 'https://magicdecor.in/blog/auspicious-days-for-griha-pravesh-muhurat-2025-a-guide-to-welcoming-prosperity-into-your-new-home/ (and cross-referenced contemporary Panchang guidance)',
    notes: 'Favorable tithis Dvitiya/Tritiya/Panchami/Saptami/Dashami/Ekadashi/Trayodashi; avoid Amavasya/Ashtami/Navami. Favorable nakshatras Rohini/Mrigashira/Uttara Phalguni/Hasta, plus Revati/Uttara Ashadha/Chitra/Anuradha.',
  },
  {
    id: 'griha-pravesh-web-aggregate-2',
    title: 'Griha Pravesh Muhurat -- DrikPanchang-style aggregate reference',
    sourceType: 'TRADITIONAL_REFERENCE',
    citation: 'Contemporary Panchang-engine-style Griha Pravesh guidance (Hindu Panchang tithi/nakshatra/vaar methodology)',
    notes: 'Favorable tithis Dvitiya/Tritiya/Panchami/Dashami/Ekadashi/Trayodashi; avoid Amavasya + Rikta tithis (Chaturthi/Navami/Chaturdashi). Favorable nakshatras Rohini/Mrigashira/Chitra/Anuradha/Revati + the three Uttara nakshatras.',
  },
  {
    id: 'griha-pravesh-avoid-nakshatra-rationale',
    title: 'Griha Pravesh avoid-nakshatra rationale (Bharani/Krittika/Ashlesha)',
    sourceType: 'TRADITIONAL_REFERENCE',
    citation: 'https://www.housegyan.com/blog/which-nakshatras-are-best-for-griha-pravesh (aggregate) and related contemporary guidance',
    notes: 'States Bharani and Krittika are avoided for all auspicious works (Yama/Agni-ruled) and Ashlesha creates "serpent energy"; separately names Jyeshtha/Mula/Ardra/Magha/Shatabhisha as causing instability -- only Ashlesha/Jyeshtha/Mula were corroborated by a second source (sarastrology detailed list, below) and kept.',
  },
  {
    id: 'griha-pravesh-detailed-list',
    title: 'Grah Parvesh Muhurta -- detailed Tithi/Nakshatra list',
    sourceType: 'TRADITIONAL_REFERENCE',
    citation: 'http://sarastrology.blogspot.com/2019/11/muhurta-for-grah-parvesh.html',
    notes: 'Avoid Shukla paksha 1/4/9/14 and Krishna Pratipada/Chaturthi/Ashtami/Navami/Dwadashi/Chaturdashi; general muhurta guidance avoids 4th/6th/8th/12th/14th and full/new moon. Favorable nakshatras: Rohini, Mrigashira, Pushya, Uttara Phalguni, Hasta, Chitra, Swati, Anuradha, Uttara Ashadha, Shravana, Dhanishta, Shatabhisha, Uttara Bhadrapada, Revati. Does not cite a named classical text.',
  },
];

/**
 * Marriage (Vivaha) Muhurtham Tithi/Nakshatra/Yoga/Karana data.
 *
 * Sourced from the Marriage Muhurtham architecture audit's external
 * research (DrikPanchang -- treated as the most textually rigorous source
 * consulted, citing classical works by name for several rules -- plus
 * corroborating traditional-reference material), NOT copied or derived from
 * Griha Pravesh's own data (brief section 9: Marriage requires its own rule
 * pack, never a relaxed reuse of another ceremony's lists).
 *
 * Favorable Tithis (Rikta-avoid core, strongly attested): Dwitiya, Tritiya,
 * Panchami, Saptami, Ekadashi, Trayodashi.
 * Avoid Tithis (the three Rikta Tithis -- specifically and universally
 * prohibited for marriage across every source consulted, not merely the
 * generic "avoided in general" association): Chaturthi, Navami, Chaturdashi.
 * Favorable Nakshatras (verified against DrikPanchang's dedicated marriage-
 * Nakshatra page, exactly 11): Rohini, Mrigashira, Magha, Uttara Phalguni,
 * Hasta, Swati, Anuradha, Mula, Uttara Ashadha, Uttara Bhadrapada, Revati.
 * Avoid Nakshatras: deliberately EMPTY -- no source consulted named a
 * whole-Nakshatra avoid list for Marriage specifically (only pada-level
 * exceptions within three of the 11 FAVORABLE Nakshatras -- first pada
 * Magha, first pada Mula, last pada Revati -- which this PR does NOT
 * implement; pada-aware eligibility is explicitly deferred). See this
 * module's own doc comment on favorable-vs-exclusive semantics: an unlisted
 * Nakshatra is NEUTRAL, never implicitly avoided.
 * Avoid Yogas (DrikPanchang's dedicated "Prohibited Yoga for Marriage"
 * page, a binary 9-item blocklist -- the remaining 18 are treated as
 * auspicious, not finely ranked): Vishkambha, Atiganda, Shula, Ganda,
 * Vyaghapata, Vajra, Vyatipata, Parigha, Vaidhriti. (Spelled to match this
 * codebase's own YOGA_NAMES exactly -- packages/vedic/src/
 * panchangElements.ts spells the 13th Yoga "Vyaghapata".)
 * Avoid Karanas (universally attested, no disagreement found): Vishti
 * (Bhadra), Shakuni, Chatushpada, Naga. (Spelled to match this codebase's
 * KARANA_NAMES -- "Naga", not "Nagava".)
 *
 * requiresPeriodExclusion / requiresPlanetaryCombustion: TRUE. The audit
 * found whole lunar/solar-month exclusion (Chaturmas, Kharmas, Adhika Masa)
 * and Guru/Shukra Asta (Jupiter/Venus planetary combustion) among the most
 * strongly and consistently attested Marriage-specific rules -- several
 * sourced to classical texts (Muhurta Chintamani, Dharmasindhu) by name,
 * with no disagreement across sources. Neither mechanism exists anywhere in
 * this engine yet (PR B's job) -- until it does, this pack cannot honestly
 * claim SUPPORTED for a ceremonial result (see computeMuhurtaSupportLevel).
 */
const MARRIAGE_SOURCES: MuhurtaRuleSource[] = [
  {
    id: 'marriage-drikpanchang-date-selection',
    title: 'Choosing an Auspicious Marriage Date',
    sourceType: 'TRADITIONAL_REFERENCE',
    citation: 'https://www.drikpanchang.com/shubh-dates/info/choosing-auspicious-marriage-date.html',
    notes: 'Rikta Tithis (Chaturthi/Navami/Chaturdashi) specifically prohibited for marriage; favorable core Dwitiya/Tritiya/Panchami/Saptami/Ekadashi/Trayodashi. Also this PR\'s source for the requiresPeriodExclusion/requiresPlanetaryCombustion flags (month/Asta guidance itself is NOT implemented here -- PR B) and for de-prioritizing Vara below Tithi/Nakshatra/Yoga/Karana (not encoded as hard eligibility in this PR -- brief section 16).',
  },
  {
    id: 'marriage-drikpanchang-nakshatra',
    title: 'Auspicious Nakshatra for Marriage',
    sourceType: 'TRADITIONAL_REFERENCE',
    citation: 'https://www.drikpanchang.com/panchang/nakshatra/auspicious-marriage-nakshatra.html',
    notes: 'Names exactly 11 favorable Nakshatras, citing Jyotirnibandha for pada-level exceptions (first pada Magha/Mula, last pada Revati -- NOT implemented in this PR). No whole-Nakshatra avoid list was sourced for Marriage.',
  },
  {
    id: 'marriage-drikpanchang-yoga',
    title: 'Prohibited Yoga for Marriage',
    sourceType: 'TRADITIONAL_REFERENCE',
    citation: 'https://www.drikpanchang.com/panchang/yoga/prohibited-marriage-yoga.html',
    notes: 'Names exactly 9 prohibited Yogas as a binary blocklist; the remaining 18 are treated as auspicious, not finely tiered.',
  },
  {
    id: 'marriage-karana-vishti',
    title: 'Karana exclusions for Marriage (Vishti/Bhadra and others)',
    sourceType: 'TRADITIONAL_REFERENCE',
    citation: 'https://www.sri-jyotisa.com/blog/why-vishti-karana-is-avoided/ (Vishti/Bhadra, sourced to Muhurat Chintamani/Muhurat Martand) cross-referenced with DrikPanchang\'s Karana guidance for Shakuni/Chatushpada/Naga',
    notes: 'Vishti (Bhadra) universally cited as inauspicious for marriage, no disagreement found across sources; Shakuni/Chatushpada/Naga are the remaining 3 of 11 Karanas commonly listed alongside it.',
  },
];

/**
 * Intent-specific overrides, layered on top of the family base. GRIHA_PRAVESH
 * and (as of Marriage Muhurtham Foundation V1) MARRIAGE are the real entries
 * (see GRIHA_PRAVESH_SOURCES/MARRIAGE_SOURCES above and this module's doc
 * comment for why ENGAGEMENT was researched but NOT populated). yoga/karana
 * overrides are optional -- Griha Pravesh has none (its own Yoga/Karana
 * coverage stays at the generic/global level only); Marriage supplies both.
 */
const INTENT_RULE_PACKS: Partial<Record<MuhurtaIntent, { tithi: MuhurtaFactorRuleSet<RegExp>; nakshatra: MuhurtaFactorRuleSet<string>; yoga?: MuhurtaFactorRuleSet<string>; karana?: MuhurtaFactorRuleSet<string>; requiresPeriodExclusion?: boolean; requiresPlanetaryCombustion?: boolean; sources: MuhurtaRuleSource[]; confidence: MuhurtaRuleConfidence; scope: MuhurtaRuleScope; lastReviewed: string; reasonNote: string; note: string }>> = {
  GRIHA_PRAVESH: {
    tithi: {
      favorable: [/Dvitiya/, /Tritiya/, /Panchami/, /Dashami/, /Ekadashi/, /Trayodashi/],
      avoid: [/^Amavasya$/, /Chaturthi/, /Ashtami/, /Navami/, /Chaturdashi/],
    },
    nakshatra: {
      favorable: ['Rohini', 'Mrigashira', 'Uttara Phalguni', 'Chitra', 'Anuradha', 'Uttara Ashadha', 'Revati'],
      avoid: ['Ashlesha', 'Jyeshtha', 'Mula'],
    },
    sources: GRIHA_PRAVESH_SOURCES,
    confidence: 'CURATED',
    scope: 'GENERAL',
    lastReviewed: '2026-08-22',
    reasonNote: 'supports a smooth home entry',
    note: 'Genuine intent-specific Tithi/Nakshatra data for Griha Pravesh, corroborated across multiple independent contemporary Vedic-astrology reference sources (see GRIHA_PRAVESH_SOURCES) -- not a family base reuse.',
  },
  // ENGAGEMENT: deliberately absent. See this module's doc comment for the
  // research trail and why no source cleared the confidence bar.
  MARRIAGE: {
    tithi: {
      favorable: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Ekadashi/, /Trayodashi/],
      avoid: [/Chaturthi/, /Navami/, /Chaturdashi/],
    },
    nakshatra: {
      favorable: ['Rohini', 'Mrigashira', 'Magha', 'Uttara Phalguni', 'Hasta', 'Swati', 'Anuradha', 'Mula', 'Uttara Ashadha', 'Uttara Bhadrapada', 'Revati'],
      avoid: [],
    },
    yoga: {
      favorable: [],
      avoid: ['Vishkambha', 'Atiganda', 'Shula', 'Ganda', 'Vyaghapata', 'Vajra', 'Vyatipata', 'Parigha', 'Vaidhriti'],
    },
    karana: {
      favorable: [],
      avoid: ['Vishti', 'Shakuni', 'Chatushpada', 'Naga'],
    },
    requiresPeriodExclusion: true,
    requiresPlanetaryCombustion: true,
    sources: MARRIAGE_SOURCES,
    confidence: 'CURATED',
    scope: 'GENERAL',
    lastReviewed: '2026-09-03',
    reasonNote: 'supports an auspicious union',
    note: 'Genuine intent-specific Tithi/Nakshatra/Yoga/Karana data for Marriage, sourced independently from Griha Pravesh (see MARRIAGE_SOURCES) -- not a relaxed reuse of another ceremony\'s lists. Deliberately still gated out of SUPPORTED (see requiresPeriodExclusion/requiresPlanetaryCombustion and computeMuhurtaSupportLevel) until whole-month/period exclusion and planetary-combustion eligibility exist (PR B) -- Tithi/Nakshatra/Yoga/Karana coverage alone is not, per the audit, sufficient evidence for a defensible Marriage Muhurtham result.',
  },
};

function emptyRulePack(family: MuhurtaFamily, intent: MuhurtaIntent, note: string): MuhurtaRulePack {
  return {
    id: `${family}_EMPTY`,
    family,
    intent,
    tithi: { favorable: [], avoid: [] },
    nakshatra: { favorable: [], avoid: [] },
    yoga: { favorable: [], avoid: [] },
    karana: { favorable: [], avoid: [] },
    coverage: { tithi: 'MISSING', nakshatra: 'MISSING', yoga: 'IMPLEMENTED', karana: 'IMPLEMENTED', windows: 'IMPLEMENTED', yogaAuthoritative: 'MISSING', karanaAuthoritative: 'MISSING', periodExclusion: 'MISSING', planetaryCombustion: 'MISSING' },
    requiresPeriodExclusion: false,
    requiresPlanetaryCombustion: false,
    reasonNote: '',
    metadata: { methodologyVersion: AURA_MUHURTA_METHODOLOGY_ID, sources: [], confidence: 'PROVISIONAL', scope: 'GENERAL', note },
  };
}

/**
 * Resolves the effective rule pack for a classification: intent-specific
 * override (if one exists in INTENT_RULE_PACKS) wins; otherwise falls back
 * to the family base (FAMILY_BASE_SOURCE); otherwise an honestly-empty pack.
 * This is the ONLY place that decides "where does this activity's
 * Tithi/Nakshatra data come from" -- callers never branch on intent
 * themselves (brief section 4).
 */
export function resolveMuhurtaRulePack(classification: MuhurtaClassification): MuhurtaRulePack {
  const intentOverride = INTENT_RULE_PACKS[classification.intent];
  if (intentOverride) {
    return {
      id: `${classification.intent}_V1`,
      family: classification.family,
      intent: classification.intent,
      tithi: intentOverride.tithi,
      nakshatra: intentOverride.nakshatra,
      yoga: intentOverride.yoga ?? { favorable: [], avoid: [] },
      karana: intentOverride.karana ?? { favorable: [], avoid: [] },
      requiresPeriodExclusion: intentOverride.requiresPeriodExclusion ?? false,
      requiresPlanetaryCombustion: intentOverride.requiresPlanetaryCombustion ?? false,
      coverage: {
        tithi: 'IMPLEMENTED',
        nakshatra: 'IMPLEMENTED',
        yoga: 'IMPLEMENTED',
        karana: 'IMPLEMENTED',
        windows: 'IMPLEMENTED',
        yogaAuthoritative: intentOverride.yoga ? 'IMPLEMENTED' : 'MISSING',
        karanaAuthoritative: intentOverride.karana ? 'IMPLEMENTED' : 'MISSING',
        // Marriage Muhurtham Foundation V1 (PR A): no intent has either of
        // these implemented yet -- see MuhurtaRulePackCoverage's own doc
        // comment. PR B's job.
        periodExclusion: 'MISSING',
        planetaryCombustion: 'MISSING',
      },
      reasonNote: intentOverride.reasonNote,
      metadata: { methodologyVersion: AURA_MUHURTA_METHODOLOGY_ID, sources: intentOverride.sources, confidence: intentOverride.confidence, scope: intentOverride.scope, lastReviewed: intentOverride.lastReviewed, note: intentOverride.note },
    };
  }

  const legacyFamily = FAMILY_BASE_SOURCE[classification.family];
  if (!legacyFamily) {
    return emptyRulePack(classification.family, classification.intent, `No traditional rule data (family or intent level) is present in this codebase for ${classification.family}/${classification.intent} yet.`);
  }

  const legacyRules = getFamilyRuleData(legacyFamily);
  return {
    id: `${legacyFamily}_FAMILY_BASE`,
    family: classification.family,
    intent: classification.intent,
    tithi: { favorable: legacyRules.preferredTithiPatterns, avoid: legacyRules.avoidTithiPatterns },
    nakshatra: { favorable: legacyRules.preferredNakshatras, avoid: legacyRules.avoidNakshatras },
    yoga: { favorable: [], avoid: [] },
    karana: { favorable: [], avoid: [] },
    requiresPeriodExclusion: false,
    requiresPlanetaryCombustion: false,
    reasonNote: legacyRules.note,
    coverage: { tithi: 'REUSABLE_BASE_RULE', nakshatra: 'REUSABLE_BASE_RULE', yoga: 'IMPLEMENTED', karana: 'IMPLEMENTED', windows: 'IMPLEMENTED', yogaAuthoritative: 'MISSING', karanaAuthoritative: 'MISSING', periodExclusion: 'MISSING', planetaryCombustion: 'MISSING' },
    reusedFromLegacyFamily: legacyFamily,
    metadata: { methodologyVersion: AURA_MUHURTA_METHODOLOGY_ID, sources: [LEGACY_FAMILY_BASE_SOURCE_RECORD], confidence: 'ESTABLISHED', scope: 'GENERAL', note: `Reuses ${legacyFamily}'s existing rule data (${legacyRules.note}) as a family-level base -- no ${classification.intent}-specific Tithi/Nakshatra data exists yet.` },
  };
}

/**
 * Support-level determination (brief section 6): driven by rule-pack
 * coverage, NOT merely evaluationDepth.
 *
 * DEEP activities need BOTH Tithi and Nakshatra coverage present (either
 * intent-specific or an approved family base -- REUSABLE_BASE_RULE is an
 * acceptable bar there, consistent with how start-journey/financial-decision
 * have always worked), plus the always-global Yoga/Karana/window evaluation.
 *
 * CEREMONIAL activities (Engagement, Griha Pravesh) need STRONGER evidence:
 * genuinely dedicated (IMPLEMENTED, i.e. from an intent-specific override)
 * Tithi AND Nakshatra coverage. A reused family base or missing data both
 * fall short of the "sufficient Panchanga evidence" bar for a ceremonial
 * result (brief section 8) -- reaching only REUSABLE_BASE_RULE (Engagement,
 * still true after this PR) or MISSING both land at PARTIAL. Populating
 * only ONE of Tithi/Nakshatra intent-specifically is not enough either --
 * both core factors must be resolved with no gap.
 *
 * Marriage Muhurtham Foundation V1 (PR A) adds a further CEREMONIAL-only
 * gate: an intent whose own rule pack declares requiresPeriodExclusion or
 * requiresPlanetaryCombustion (Marriage does; Griha Pravesh does not) also
 * needs the corresponding coverage.periodExclusion/planetaryCombustion to
 * reach IMPLEMENTED before it can be SUPPORTED -- both are MISSING for
 * every intent today (PR B's job), so Marriage resolves to PARTIAL despite
 * having genuinely dedicated Tithi/Nakshatra/Yoga/Karana data, and stays
 * excluded from SUPPORTED_MUHURTHAM_ACTIVITY_IDS / Muhurtham Finder --
 * this is the canonical mechanism keeping it gated, not a UI-level check.
 */
export function computeMuhurtaSupportLevel(classification: MuhurtaClassification, pack: MuhurtaRulePack): MuhurtaSupportLevel {
  const tithiOk = pack.coverage.tithi !== 'MISSING';
  const nakshatraOk = pack.coverage.nakshatra !== 'MISSING';
  const bothDedicated = pack.coverage.tithi === 'IMPLEMENTED' && pack.coverage.nakshatra === 'IMPLEMENTED';

  if (classification.evaluationDepth === 'CEREMONIAL') {
    if (!bothDedicated) return 'PARTIAL';
    if (pack.requiresPeriodExclusion && pack.coverage.periodExclusion !== 'IMPLEMENTED') return 'PARTIAL';
    if (pack.requiresPlanetaryCombustion && pack.coverage.planetaryCombustion !== 'IMPLEMENTED') return 'PARTIAL';
    return 'SUPPORTED';
  }
  return tithiOk && nakshatraOk ? 'SUPPORTED' : 'NOT_YET_SUPPORTED';
}

/**
 * True only when the resolved rule pack's Nakshatra data is genuinely
 * intent-specific (coverage.nakshatra === 'IMPLEMENTED', i.e. an
 * INTENT_RULE_PACKS override -- not a REUSABLE_BASE_RULE family-base proxy,
 * and not MISSING) AND `nakshatraName` is in that pack's own `avoid` list.
 * This is the single authority Muhurtham Finder's event-specific interval
 * eligibility check (packages/recommendation/src/muhurthamFinder.ts) derives
 * from, rather than duplicating this distinction itself: REUSABLE_BASE_RULE
 * data is a legitimate SOFT scoring signal (NAKSHATRA_UNFAVORABLE, via
 * evaluateMuhurtaWithRulePack below) but was never genuinely sourced FOR
 * this specific occasion, so it must never hard-reject a candidate on its
 * own -- only a pack's own dedicated data may do that.
 */
export function isAuthoritativeAvoidNakshatra(pack: MuhurtaRulePack, nakshatraName: string): boolean {
  return pack.coverage.nakshatra === 'IMPLEMENTED' && pack.nakshatra.avoid.includes(nakshatraName);
}

/** Same authority rule as isAuthoritativeAvoidNakshatra() above, for Tithi
 * (RegExp-pattern matched, consistent with how the rest of this module
 * matches Tithi values against a rule pack's favorable/avoid tiers). */
export function isAuthoritativeAvoidTithi(pack: MuhurtaRulePack, tithiName: string): boolean {
  return pack.coverage.tithi === 'IMPLEMENTED' && pack.tithi.avoid.some((pattern) => pattern.test(tithiName));
}

/** Marriage Muhurtham Foundation V1: same authority rule as
 * isAuthoritativeAvoidNakshatra/isAuthoritativeAvoidTithi above, for Yoga
 * -- gated on coverage.yogaAuthoritative (a SEPARATE axis from
 * coverage.yoga, which describes the always-on generic/soft Yoga scoring
 * every activity already gets; see MuhurtaRulePackCoverage's own doc
 * comment). Exact-name matched, consistent with how Yoga values are
 * represented (packages/vedic/src/panchangElements.ts's YOGA_NAMES). */
export function isAuthoritativeAvoidYoga(pack: MuhurtaRulePack, yogaName: string): boolean {
  return pack.coverage.yogaAuthoritative === 'IMPLEMENTED' && pack.yoga.avoid.includes(yogaName);
}

/** Same authority rule as isAuthoritativeAvoidYoga above, for Karana --
 * gated on coverage.karanaAuthoritative (separate from the always-on
 * coverage.karana global scoring). */
export function isAuthoritativeAvoidKarana(pack: MuhurtaRulePack, karanaName: string): boolean {
  return pack.coverage.karanaAuthoritative === 'IMPLEMENTED' && pack.karana.avoid.includes(karanaName);
}

/**
 * Generic rule-pack-driven Muhurta evaluator -- the "evaluate rules
 * generically" counterpart to muhurtaEngine.ts's legacy, per-family
 * evaluateMuhurta(). Reuses the exact same yoga/karana/window helper
 * functions (no duplicated scoring logic); only the Tithi/Nakshatra source
 * differs (the resolved rule pack instead of RULES[family]).
 *
 * Used by evaluateActivityFit() (auraFitEngine.ts) whenever the resolved
 * rule pack has genuinely BETTER or DIFFERENT data than the legacy
 * family-keyed path could offer -- i.e. whenever coverage is NOT simply
 * "both REUSABLE_BASE_RULE" (the case where the legacy path is equally
 * correct and already trusted/tested, so it's left untouched). Today that's
 * Griha Pravesh (IMPLEMENTED, dedicated data as of this PR) and, before
 * dedicated data existed, would also have covered a MISSING-coverage
 * family. See that file's own doc comment for the exact gate and why this
 * is zero-regression-risk for every other activity.
 *
 * Only the favorable/avoid tiers of the resolved rule pack's tithi/nakshatra
 * are consumed (acceptable/block are reserved, unpopulated by any pack
 * today -- see MuhurtaFactorRuleSet's doc comment).
 */
export function evaluateMuhurtaWithRulePack(params: {
  classification: MuhurtaClassification;
  date: Date;
  windowType: SolarWindowType;
}): MuhurtaEvaluation {
  const pack = resolveMuhurtaRulePack(params.classification);
  const legacyFamilyForWindowBonus = FAMILY_BASE_SOURCE[params.classification.family];
  const panchanga = getPanchangaSnapshot(params.date);

  const reasons: MuhurtaReason[] = [
    ...evaluatePanchangaNakshatraTithiReasons(panchanga, {
      preferredNakshatras: pack.nakshatra.favorable,
      avoidNakshatras: pack.nakshatra.avoid,
      preferredTithiPatterns: pack.tithi.favorable,
      avoidTithiPatterns: pack.tithi.avoid,
      note: pack.reasonNote,
    }),
    ...evaluatePanchangaYogaKaranaReasons(panchanga),
  ];

  const windowReason = evaluateSolarWindowReason(params.windowType, legacyFamilyForWindowBonus);
  if (windowReason) reasons.push(windowReason);

  const modifier = reasons.reduce((total, reason) => total + (reason.impact ?? 0), 0);
  const legacy = deriveLegacyMuhurtaText(reasons);

  return {
    family: legacyFamilyForWindowBonus ?? 'FOCUSED_WORK',
    panchanga,
    modifier,
    reasons,
    blockers: legacy.blockers,
    supports: legacy.supports,
    summary: legacy.summary,
    provenance: { methodology: AURA_MUHURTA_METHODOLOGY_ID, rulePackId: pack.id },
  };
}

/**
 * Narrow, intentionally-scoped Panchang value normalization (brief section
 * 9) -- NOT a full enum migration. Nakshatra display names in this codebase
 * are already consistently spelled (all 27 come from one fixed name list in
 * panchangElements.ts), so this fixes no CURRENT bug; it exists so a future
 * REGIONAL-scope rule pack (a different source using different
 * transliteration/spacing, e.g. "Moola" vs "Mula") can match reliably
 * against the same live Panchanga value without every rule pack author
 * needing to guess this codebase's exact display spelling. Case- and
 * whitespace-insensitive; does not change what's displayed to users (display
 * strings are untouched -- this is purely an internal matching key).
 */
export function normalizeNakshatraId(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, '_');
}

/**
 * Same narrow purpose as normalizeNakshatraId(), for Tithi display strings
 * ("Shukla Dvitiya" -> "SHUKLA_DVITIYA", "Amavasya" -> "AMAVASYA"). Existing
 * rule data (both the legacy RULES table and this file's rule packs)
 * matches Tithi via paksha-agnostic RegExp patterns rather than exact IDs,
 * which already handles the Shukla/Krishna prefix robustly -- this function
 * is not used by that matching path and exists for the same future-regional
 * reason as normalizeNakshatraId(), for a rule pack author who wants
 * exact-ID rather than pattern matching.
 */
export function normalizeTithiId(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, '_');
}
