/**
 * Ashtakavarga Engine V1 -- raw Sarvashtakavarga (SAV).
 *
 * Raw SAV is the sign-by-sign sum of the seven BAV tables. Lagna is NOT
 * added as an eighth BAV target here -- Lagna already participated as a
 * CONTRIBUTOR inside each of the seven BAV tables (bhinna.ts); adding a
 * separate "Lagna BAV" to the SAV sum would double-count it and would
 * not match the classical definition (see README.md's "Raw
 * Sarvashtakavarga" section).
 *
 * This is RAW SAV only -- no Trikona Shodhana, Ekadhipatya Shodhana, or
 * Shodhya Pinda reduction is applied (see README.md's "Raw vs reduced"
 * section; those are explicitly out of scope for V1).
 */
import { ASHTAKAVARGA_TARGETS, ZODIAC_SIGN_COUNT } from './constants';
import { dedupeEvidenceRefs, buildSavSignSumEvidence, buildSavTotalEvidence } from './evidence';
import type { BhinnaAshtakavarga, Sarvashtakavarga, AshtakavargaEvidenceRef, ZodiacSign } from './types';

/** `bhinnaByTarget` must contain all 7 targets (ASHTAKAVARGA_TARGETS) -- see engine.ts, which always supplies exactly that set. */
export function calculateSarvashtakavarga(bhinnaByTarget: Record<string, BhinnaAshtakavarga>): Sarvashtakavarga {
  const signs = [];
  const evidence: AshtakavargaEvidenceRef[] = [];

  for (let sign: ZodiacSign = 0; sign < ZODIAC_SIGN_COUNT; sign++) {
    const total = ASHTAKAVARGA_TARGETS.reduce((sum, target) => sum + bhinnaByTarget[target].signs[sign].total, 0);
    signs.push({ sign, total });
    evidence.push(buildSavSignSumEvidence({ sign, total }));
  }

  const total = signs.reduce((sum, s) => sum + s.total, 0);
  evidence.push(buildSavTotalEvidence({ total }));

  return { signs, total, evidence: dedupeEvidenceRefs(evidence) };
}
