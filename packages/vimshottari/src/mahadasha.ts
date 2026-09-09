/**
 * Vimshottari Dasha Engine V1 -- birth balance and Mahadasha cycle
 * generation.
 */
import { nakshatraOffset, nakshatraLord, nakshatraName } from './nakshatra';
import { mahadashaDurationMs, toIsoInstant } from './duration';
import { generateAntardashas } from './antardasha';
import { VIMSHOTTARI_SEQUENCE, VIMSHOTTARI_YEARS, VIMSHOTTARI_MIN_COVERAGE_MS } from './constants';
import {
  buildNakshatraFromMoonEvidence,
  buildStartingLordEvidence,
  buildBirthBalanceEvidence,
  buildYearLengthEvidence,
  buildMahadashaDurationEvidence,
  buildIntervalBoundaryEvidence,
} from './evidence';
import type { VimshottariBirthNakshatra, VimshottariLord, VimshottariMahadashaPeriod } from './types';
import type { PersonalEvidenceRef } from '../../personal-intelligence/src/evidence';

export interface BirthBalanceResult {
  birthNakshatra: VimshottariBirthNakshatra;
  /** The TRUE start of the birth Mahadasha, in epoch ms -- precedes birthMomentMs by the already-elapsed portion of that Mahadasha, unless the Moon sits exactly at 0% into its Nakshatra. Never truncated to birthMomentMs itself. */
  mahaStartMs: number;
  evidence: PersonalEvidenceRef[];
}

/**
 * Determines the birth Nakshatra, its ruling (starting) lord, and the
 * TRUE start of that Mahadasha (which precedes birth by the already-
 * elapsed fraction of the Nakshatra) -- see README.md's "Birth
 * Mahadasha balance" section for the full derivation this implements
 * exactly.
 *
 * The one genuinely fractional value in this whole engine
 * (`rawElapsedMs`) is rounded to the nearest integer millisecond exactly
 * once, here -- every value derived from it afterward (this Mahadasha's
 * own end, every subsequent Mahadasha, every Antardasha) is then exact
 * integer arithmetic with no further rounding (duration.ts's own module
 * doc comment). `elapsedMs` is additionally clamped to at most
 * `fullMs - 1`: since `fractionElapsed` is mathematically in [0, 1)
 * (nakshatra.ts's own nakshatraOffset), `rawElapsedMs` is in [0, fullMs),
 * but rounding a value arbitrarily close to `fullMs` COULD round up to
 * exactly `fullMs` -- which would make `mahaStart = birthMoment - fullMs`
 * and `mahaEnd = birthMoment` exactly, putting birth AT the exclusive
 * end boundary instead of strictly inside [start, end). The clamp
 * guarantees birth always falls strictly within its own Mahadasha,
 * however close to the boundary the real Moon longitude is.
 */
export function calculateBirthBalance(moonLongitude: number, birthMomentMs: number): BirthBalanceResult {
  const { index, fractionElapsed, fractionRemaining } = nakshatraOffset(moonLongitude);
  const lord = nakshatraLord(index);
  const name = nakshatraName(index);

  const fullMs = mahadashaDurationMs(lord);
  const rawElapsedMs = fullMs * fractionElapsed;
  const elapsedMs = Math.min(Math.round(rawElapsedMs), fullMs - 1);
  const remainingMs = fullMs - elapsedMs;
  const mahaStartMs = birthMomentMs - elapsedMs;

  const birthNakshatra: VimshottariBirthNakshatra = {
    index,
    name,
    lord,
    moonLongitude,
    fractionElapsed,
    fractionRemaining,
  };

  const evidence: PersonalEvidenceRef[] = [
    buildNakshatraFromMoonEvidence({ moonLongitude, nakshatraIndex: index, nakshatraName: name }),
    buildStartingLordEvidence({ nakshatraIndex: index, nakshatraName: name, lord }),
    buildBirthBalanceEvidence({ lord, fractionElapsed, fractionRemaining, elapsedMs, remainingMs }),
    buildYearLengthEvidence(),
  ];

  return { birthNakshatra, mahaStartMs, evidence };
}

/**
 * Generates complete Mahadashas, starting from the birth Mahadasha's own
 * TRUE start (`mahaStartMs` -- never truncated to birth), for as long as
 * needed to cover at least VIMSHOTTARI_MIN_COVERAGE_MS (120 Vimshottari
 * years) of lookup AFTER `birthMomentMs`. Each Mahadasha already has its
 * own 9 Antardashas generated (antardasha.ts).
 *
 * IMPORTANT: this does NOT generate a fixed count of 9 Mahadashas. Nine
 * Mahadashas measured from the TRUE start only cover
 * `120 years - elapsedBirthBalance` AFTER birth, not a full 120 years --
 * e.g. if birth falls 15 years into a 20-year Venus Mahadasha, 9
 * Mahadashas from Venus's true start end only 105 years after birth, and
 * a query 110 years after birth would incorrectly find nothing even
 * though the Vimshottari sequence is cyclic and keeps going. The loop
 * below instead keeps generating (wrapping VIMSHOTTARI_SEQUENCE via
 * modulo indefinitely, re-visiting the starting lord and beyond as many
 * times as needed) until the generated timeline's own end reaches
 * `birthMomentMs + VIMSHOTTARI_MIN_COVERAGE_MS` -- so the result
 * typically contains MORE than 9 Mahadashas. The loop always emits at
 * least one Mahadasha (birth's own), and never truncates a Mahadasha to
 * the coverage horizon -- the final generated Mahadasha's own `end` may
 * (and, except in the exact-multiple edge case, will) fall strictly past
 * the horizon; see README.md's own "Coverage" section for the exact
 * invariant this establishes:
 *   result.mahadashas[0].start <= birthMomentMs
 *   result.mahadashas.at(-1).end >= birthMomentMs + 120 * VIMSHOTTARI_YEAR_MS
 *
 * Deterministic order: always iterates VIMSHOTTARI_SEQUENCE starting from
 * `startingLord`'s own position, wrapping around via `% length` -- never
 * sorted, never re-derived from Map/Set iteration order, and identical
 * for every wrap (no special-casing of a "repeated cycle" Mahadasha --
 * see antardasha.ts's own doc comment, which applies unchanged here).
 */
export function generateMahadashaCycle(startingLord: VimshottariLord, mahaStartMs: number, birthMomentMs: number): VimshottariMahadashaPeriod[] {
  const startIndex = VIMSHOTTARI_SEQUENCE.indexOf(startingLord);
  const coverageEndMs = birthMomentMs + VIMSHOTTARI_MIN_COVERAGE_MS;
  let cursor = mahaStartMs;
  const mahadashas: VimshottariMahadashaPeriod[] = [];

  for (let i = 0; cursor < coverageEndMs; i++) {
    const lord = VIMSHOTTARI_SEQUENCE[(startIndex + i) % VIMSHOTTARI_SEQUENCE.length];
    const durationMs = mahadashaDurationMs(lord);
    const start = cursor;
    const end = cursor + durationMs;
    const startIso = toIsoInstant(start);
    const endIso = toIsoInstant(end);

    mahadashas.push({
      level: 'MAHADASHA',
      lord,
      start: startIso,
      end: endIso,
      antardashas: generateAntardashas(lord, start, end),
      evidence: [
        buildMahadashaDurationEvidence({ lord, years: VIMSHOTTARI_YEARS[lord], durationMs }),
        buildIntervalBoundaryEvidence({ level: 'MAHADASHA', lord, start: startIso, end: endIso }),
      ],
    });

    cursor = end;
  }

  return mahadashas;
}
