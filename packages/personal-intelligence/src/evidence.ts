/**
 * Personal Intelligence Contract V1 -- unified evidence model.
 *
 * The single generic envelope every future engine's evidence flows
 * through so a consumer can answer "why did Aura derive this?" without
 * needing to understand every engine's own native evidence shape.
 * Deliberately NOT a forced reuse of packages/bhrigu's own BhriguEvidence
 * (category: 'KARAKA' | 'RELATIONSHIP' | 'CHAIN', planets: PlanetId[],
 * facts: BhriguEvidenceFacts) -- that shape is specific to Bhrigu's own
 * sign-relationship domain and this contract must also represent
 * Vimshottari Dasha, transit, Ashtakavarga, Panchang, and Muhurta
 * evidence, none of which have "planets"/"facts" in Bhrigu's exact sense.
 * A future adapter (not written in this PR) can map a BhriguEvidence into
 * a PersonalEvidenceRef by copying ruleId/ruleVersion verbatim and
 * summarizing the rest -- see toPersonalEvidenceRef below and
 * test/personalIntelligenceContract.test.ts's own compatibility check.
 */

/** Which family of engine this evidence came from. */
export type PersonalEvidenceSource =
  | 'BHRIGU_NATAL'
  | 'PERSONAL_THEMES'
  | 'VIMSHOTTARI_DASHA'
  | 'TRANSIT_ACTIVATION'
  | 'ASHTAKAVARGA'
  | 'PANCHANG'
  | 'MUHURTA';

/**
 * The generic evidence reference used throughout every other contract in
 * this package (PersonalThemeSignal.reasons, PersonalReason.evidence,
 * LifePeriodContext.evidence, etc.). `data` is intentionally a bounded,
 * read-only, JSON-serializable bag rather than `unknown` on its own --
 * see isSerializableEvidenceData below for what "bounded" means here.
 * `summary` is a short, already-rendered explanation string, never
 * horoscope/prediction prose (see ../README.md's evidence-first
 * principle) -- it exists so a consumer that doesn't want to interpret
 * `data` itself still has something displayable.
 */
export interface PersonalEvidenceRef {
  source: PersonalEvidenceSource;
  ruleId: string;
  ruleVersion: string;
  summary?: string;
  data?: Readonly<Record<string, PersonalEvidenceDataValue>>;
}

/**
 * The bounded set of value types `PersonalEvidenceRef.data`/
 * `PersonalEvidence.facts` may hold -- deliberately excludes functions,
 * class instances, Map, Set, and Date (see ../README.md's "Immutability /
 * serializability" section): every value here round-trips through
 * `JSON.stringify`/`JSON.parse` unchanged, and none can carry a cyclic
 * reference. This is a plain recursive JSON-value type, not a new
 * validation dependency.
 */
export type PersonalEvidenceDataValue =
  | string
  | number
  | boolean
  | null
  | readonly PersonalEvidenceDataValue[]
  | { readonly [key: string]: PersonalEvidenceDataValue };

/**
 * A stricter, typed-facts variant of PersonalEvidenceRef, for a future
 * engine that wants its own facts shape enforced at the type level rather
 * than the bounded-but-untyped `data` bag above. `toPersonalEvidenceRef`
 * below adapts any PersonalEvidence into the generic PersonalEvidenceRef
 * shape every other contract in this package actually consumes.
 */
export interface PersonalEvidence<TFacts extends Record<string, PersonalEvidenceDataValue> = Record<string, PersonalEvidenceDataValue>> {
  source: PersonalEvidenceSource;
  ruleId: string;
  ruleVersion: string;
  facts: TFacts;
}

/**
 * Adapts a typed PersonalEvidence into the generic PersonalEvidenceRef
 * shape -- `facts` becomes `data` verbatim (already a bounded,
 * serializable value by TFacts' own constraint), and `summary` is left
 * undefined (this function renders no prose; a caller that wants a
 * summary supplies one itself, e.g. via a PersonalReason.message).
 */
export function toPersonalEvidenceRef<TFacts extends Record<string, PersonalEvidenceDataValue>>(
  evidence: PersonalEvidence<TFacts>
): PersonalEvidenceRef {
  return {
    source: evidence.source,
    ruleId: evidence.ruleId,
    ruleVersion: evidence.ruleVersion,
    data: evidence.facts,
  };
}
