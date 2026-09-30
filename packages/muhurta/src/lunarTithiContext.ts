/**
 * Lunar Intelligence V1 — L1: deterministic lunar-Tithi classification.
 *
 * DOMAIN FOUNDATION ONLY. This module describes STRUCTURAL lunar
 * classification — which of the five traditional Tithi families (Nanda/
 * Bhadra/Jaya/Rikta/Purna) a Tithi belongs to, and which Paksha-strength
 * band it falls in — and nothing else. It has NO opinion on whether any of
 * that is favorable, unfavorable, auspicious or inauspicious for anything:
 * no score, no modifier, no MuhurtaReason, no activity family/intent, no
 * action-phase semantics. See the Lunar Intelligence V1 current-main audit
 * for why this line is drawn here (the same "family" can be traditionally
 * favorable for one activity and unfavorable for another — see the
 * audit's Chaturthi/ADMIN-vs-Griha-Pravesh finding — so any scoring
 * decision belongs to a later, activity-aware rule-pack layer, not here).
 *
 * Nothing in this file is imported by any production consumer yet
 * (recommendation, Muhurta activity rules, Aura Fit, Day Constructor, Home,
 * Explore) — it exists standalone, ready for a later PR to wire in
 * deliberately.
 *
 * Reuses the canonical Tithi facts this codebase already computes
 * (TITHI_NAMES, packages/vedic/src/panchangElements.ts) rather than
 * duplicating the 30 Tithi names or performing any new astronomy — this
 * module is a pure, deterministic derivation from an already-computed
 * Tithi name, nothing more.
 */

import { TITHI_NAMES } from '../../vedic/src/panchangElements';

/**
 * The five traditional Tithi families (Nanda/Bhadra/Jaya/Rikta/Purna),
 * cycling every 5 ordinals within a Paksha:
 *   1, 6, 11  -> NANDA
 *   2, 7, 12  -> BHADRA
 *   3, 8, 13  -> JAYA
 *   4, 9, 14  -> RIKTA
 *   5, 10, 15 -> PURNA
 */
export type TithiFamily = 'NANDA' | 'BHADRA' | 'JAYA' | 'RIKTA' | 'PURNA';

/**
 * Traditional Paksha-strength banding of a Tithi's ordinal (1-15) within
 * its Paksha. Purely descriptive classification metadata — NEVER a
 * numerical score, and never consumed as one.
 */
export type PakshaBand = 'WEAK' | 'MEDIUM' | 'STRONG';

export interface LunarTithiContext {
  /** The canonical Tithi name this context was built from, e.g. "Shukla Chaturthi", "Purnima", "Amavasya". */
  tithiName: string;
  /** Canonical 1-30 index into TITHI_NAMES (1-indexed: TITHI_NAMES[tithiIndex - 1] === tithiName). */
  tithiIndex: number;
  /** 1-15 position within the Paksha (Shukla: tithiIndex; Krishna: tithiIndex - 15). */
  ordinal: number;
  paksha: 'Shukla' | 'Krishna';
  family: TithiFamily;
  pakshaBand: PakshaBand;
}

const FAMILY_BY_ORDINAL_MOD_5: Record<number, TithiFamily> = {
  1: 'NANDA',
  2: 'BHADRA',
  3: 'JAYA',
  4: 'RIKTA',
  0: 'PURNA', // ordinals 5, 10, 15 (ordinal % 5 === 0)
};

/**
 * Pure derivation of a Tithi's traditional family from its ordinal (1-15)
 * within its Paksha. Deliberately NOT a duplicated 30-item table -- the
 * mapping is exactly "ordinal mod 5", which is both the traditional rule
 * and the clearest implementation of it.
 *
 * Fails explicitly (throws) for any ordinal outside 1-15: an out-of-range
 * ordinal is a caller bug, never silently coerced/clamped/defaulted.
 */
export function familyForTithiOrdinal(ordinal: number): TithiFamily {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 15) {
    throw new Error(`familyForTithiOrdinal: ordinal must be an integer 1-15, got ${ordinal}.`);
  }
  return FAMILY_BY_ORDINAL_MOD_5[ordinal % 5];
}

/**
 * Pure derivation of the traditional Paksha-strength band for a Tithi
 * ordinal (1-15) within the given Paksha:
 *
 *   Shukla:  1-5 WEAK,   6-10 MEDIUM, 11-15 STRONG
 *   Krishna: 1-5 STRONG, 6-10 MEDIUM, 11-15 WEAK
 *
 * Fails explicitly for any ordinal outside 1-15 or any paksha other than
 * the two literal values -- never a silently-valid-looking default.
 */
export function pakshaBandForTithi(paksha: 'Shukla' | 'Krishna', ordinal: number): PakshaBand {
  if (paksha !== 'Shukla' && paksha !== 'Krishna') {
    throw new Error(`pakshaBandForTithi: paksha must be "Shukla" or "Krishna", got ${JSON.stringify(paksha)}.`);
  }
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 15) {
    throw new Error(`pakshaBandForTithi: ordinal must be an integer 1-15, got ${ordinal}.`);
  }
  const band: PakshaBand = ordinal <= 5 ? 'WEAK' : ordinal <= 10 ? 'MEDIUM' : 'STRONG';
  if (paksha === 'Shukla') return band;
  // Krishna mirrors Shukla's band assignment: WEAK<->STRONG swapped, MEDIUM unchanged.
  return band === 'WEAK' ? 'STRONG' : band === 'STRONG' ? 'WEAK' : 'MEDIUM';
}

/**
 * Builds the complete structural lunar context for a canonical Tithi name.
 *
 * `tithiName` must be exactly one of the 30 canonical TITHI_NAMES this
 * codebase already produces (e.g. the live output of
 * packages/vedic/src/panchangElements.ts's getTithi().name, or
 * packages/panchang/src/panchangDay.ts's panchanga.tithi.name) -- this
 * function performs no new astronomy and trusts the canonical source for
 * WHICH Tithi it is; it only classifies it.
 *
 * Paksha is derived from the canonical index (index <= 15 -> Shukla, else
 * Krishna), never by splitting the name string -- Purnima and Amavasya
 * carry no "Shukla "/"Krishna " prefix in TITHI_NAMES, so string-splitting
 * would silently mis-handle exactly those two names.
 *
 * An unrecognized `tithiName` (misspelling, empty string, a name from a
 * different naming convention) fails explicitly -- never index 0, never a
 * default family, never a fuzzy/partial match.
 */
export function buildLunarTithiContext(tithiName: string): LunarTithiContext {
  const zeroIndex = TITHI_NAMES.indexOf(tithiName);
  if (zeroIndex === -1) {
    throw new Error(`buildLunarTithiContext: "${tithiName}" is not a canonical Tithi name (see TITHI_NAMES).`);
  }
  const tithiIndex = zeroIndex + 1; // 1-30
  const paksha: 'Shukla' | 'Krishna' = tithiIndex <= 15 ? 'Shukla' : 'Krishna';
  const ordinal = paksha === 'Shukla' ? tithiIndex : tithiIndex - 15;
  return {
    tithiName,
    tithiIndex,
    ordinal,
    paksha,
    family: familyForTithiOrdinal(ordinal),
    pakshaBand: pakshaBandForTithi(paksha, ordinal),
  };
}
