/**
 * Vimshottari Dasha Engine V1 -- Antardasha generation.
 *
 * Within a Mahadasha, the 9 Antardashas follow the same VIMSHOTTARI_SEQUENCE,
 * starting with the Mahadasha's own lord (e.g. Jupiter Mahadasha:
 * Jupiter/Jupiter, Jupiter/Saturn, Jupiter/Mercury, Jupiter/Ketu,
 * Jupiter/Venus, Jupiter/Sun, Jupiter/Moon, Jupiter/Mars, Jupiter/Rahu).
 * Generated from the Mahadasha's own TRUE start (mahaStartMs), never from
 * birth -- this is what makes the birth-Antardasha lookup correct by
 * construction (engine.ts's own findAntardashaAt just searches this
 * already-correct sequence for whatever instant it's given; no special
 * "which Antardasha was active at birth" case exists anywhere, because
 * generating from the true Mahadasha start already produces the right
 * answer for every instant within the Mahadasha, birth included).
 */
import { VIMSHOTTARI_SEQUENCE } from './constants';
import { antardashaDurationMs, toIsoInstant } from './duration';
import { buildAntardashaDurationEvidence, buildIntervalBoundaryEvidence } from './evidence';
import type { VimshottariLord, VimshottariPeriod } from './types';

/**
 * The 9 Antardashas for one Mahadasha, exactly partitioning
 * [mahaStartMs, mahaEndMs) -- see duration.ts's own module doc comment
 * for why every individual duration is already an exact integer with no
 * floating-point rounding. The final Antardasha's own `end` is still
 * explicitly forced to `mahaEndMs` (rather than trusting
 * `cursor + duration` for that last step) as a redundant, documented
 * invariant -- belt-and-suspenders against any future change to the
 * duration formula that might reintroduce drift.
 */
export function generateAntardashas(mahadashaLord: VimshottariLord, mahaStartMs: number, mahaEndMs: number): VimshottariPeriod[] {
  const startIndex = VIMSHOTTARI_SEQUENCE.indexOf(mahadashaLord);
  const lastIndex = VIMSHOTTARI_SEQUENCE.length - 1;
  let cursor = mahaStartMs;
  const periods: VimshottariPeriod[] = [];

  for (let i = 0; i <= lastIndex; i++) {
    const lord = VIMSHOTTARI_SEQUENCE[(startIndex + i) % VIMSHOTTARI_SEQUENCE.length];
    const durationMs = antardashaDurationMs(mahadashaLord, lord);
    const start = cursor;
    const end = i === lastIndex ? mahaEndMs : cursor + durationMs;
    const startIso = toIsoInstant(start);
    const endIso = toIsoInstant(end);

    periods.push({
      level: 'ANTARDASHA',
      lord,
      parentLord: mahadashaLord,
      start: startIso,
      end: endIso,
      evidence: [
        buildAntardashaDurationEvidence({ mahadashaLord, antardashaLord: lord, durationMs: end - start }),
        buildIntervalBoundaryEvidence({ level: 'ANTARDASHA', lord, start: startIso, end: endIso }),
      ],
    });

    cursor = end;
  }

  return periods;
}
