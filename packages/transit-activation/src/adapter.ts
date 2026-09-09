/**
 * Transit Activation Engine V1 -- real-position adapter, and the
 * Personal Intelligence transit contract adapter.
 *
 * REAL-POSITION ADAPTER: this file bridges from real Aura natal/transit
 * GrahaPosition[] results to the pure engine. This package is NOT
 * responsible for calculating any natal chart or transit position itself
 * -- it never calls getNatalChart() internally, only accepts
 * already-computed GrahaPosition[] results here.
 *
 * CANONICAL TRANSIT-POSITION SOURCE (Phase 0 audit, see README.md's
 * "Canonical sources" section for the full trace): packages/vedic/src/
 * natalChart.ts's own `getNatalChart(instant): GrahaPosition[]` is
 * ALREADY the canonical way to obtain sidereal planetary positions for
 * an ARBITRARY instant, not only a birth moment -- confirmed directly
 * from existing production code: packages/vedic/src/transits.ts's own
 * `calculateDailyTransits` already calls `getNatalChart(currentDate)` to
 * obtain "transit" positions for exactly this reason. This package
 * reuses `getNatalChart` itself for both the natal instant and the
 * evaluation instant; it does NOT import or extend transits.ts's own
 * `calculateDailyTransits` (a different, interpretive, house-from-Moon
 * heuristic with hardcoded favorable/cautionary prose -- see
 * constants.ts's own module doc comment for why that file is
 * deliberately not reused).
 *
 * PERSONAL INTELLIGENCE ADAPTER -- RESTORED IN V1 (PR #101), FORMERLY
 * DEFERRED (PR #100): packages/personal-intelligence's own
 * `TransitActivation` contract was, at PR #100 merge time, a lossy,
 * grouped-by-transiting-planet shape with no typed field for the
 * activated natal planet's own identity or the relationship category --
 * see README.md's own "Personal Intelligence adapter" section for the
 * full PR #100 history. PR #101's own architecture audit evolved that
 * contract (now CONTRACT_V2, packages/personal-intelligence/src/provenance.ts)
 * into a lossless, PAIR-LEVEL shape (`transitingPlanet`, `natalPlanet`,
 * `relationship`, `strength` all first-class, one record per directed
 * pair, never grouped, never aggregated) -- exactly this engine's own
 * natural grain. `toTransitActivationContext` below is therefore a
 * purely mechanical 1:1 mapping: `result.activations.length ===
 * context.activations.length` always holds, no `Math.max`/sum/average,
 * no grouping, and no theme projection (that is Life Weather's own job,
 * packages/life-weather -- this adapter never imports
 * packages/personal-themes or projects any PersonalTheme).
 */
import { TRANSIT_ACTIVATION_PLANETS } from './constants';
import { calculateTransitActivation } from './engine';
import { TransitActivationValidationError } from './types';
import type { TransitActivationInput, TransitActivationPlanet, TransitActivationResult, TransitActivationEvidenceRef, TransitRelationship, ZodiacSign } from './types';
import type { GrahaPosition } from '../../vedic/src/natalChart';
import type { TransitActivation, TransitActivationContext, PersonalTransitRelationship } from '../../personal-intelligence/src/context';
import type { PersonalEvidenceRef, PersonalEvidenceDataValue } from '../../personal-intelligence/src/evidence';

/** Extracts each of the 9 canonical planets' own sidereal `rashiIndex` from a real GrahaPosition[] -- rejects a chart missing any required planet, or containing a duplicate of one (never silently takes first/last). */
function extractSigns(positions: GrahaPosition[], label: string): Record<TransitActivationPlanet, ZodiacSign> {
  const signs = {} as Record<TransitActivationPlanet, ZodiacSign>;

  for (const planet of TRANSIT_ACTIVATION_PLANETS) {
    const matches = positions.filter((p) => p.graha === planet);
    if (matches.length !== 1) {
      throw new TransitActivationValidationError(`Expected exactly one ${planet} position in the supplied ${label} chart, got ${matches.length}.`);
    }
    signs[planet] = matches[0].rashiIndex;
  }

  return signs;
}

/**
 * Convenience adapter for a caller that already has a real natal chart
 * and a real transit chart (both packages/vedic's own GrahaPosition[],
 * e.g. `getNatalChart(birthMomentUTC)` and `getNatalChart(evaluationInstant)`)
 * plus the explicit evaluation instant used to compute the transit
 * chart -- extracts both charts' own `rashiIndex` values and delegates
 * to calculateTransitActivation above. Both sources already use this
 * repository's own Lahiri sidereal convention; this function applies no
 * ayanamsa of its own and performs no astronomy.
 */
export function calculateTransitActivationFromPositions(natalPositions: GrahaPosition[], transitPositions: GrahaPosition[], evaluationTimeUTC: Date): TransitActivationResult {
  if (!(evaluationTimeUTC instanceof Date) || !Number.isFinite(evaluationTimeUTC.getTime())) {
    throw new TransitActivationValidationError(`evaluationTimeUTC must be a valid, finite Date, got: ${String(evaluationTimeUTC)}.`);
  }

  const natalSigns = extractSigns(natalPositions, 'natal');
  const transitSigns = extractSigns(transitPositions, 'transit');
  const input: TransitActivationInput = { natalSigns, transitSigns, evaluationTime: evaluationTimeUTC.toISOString() };
  return calculateTransitActivation(input);
}

/**
 * Narrows this engine's own `TransitRelationship` (a direct alias of
 * Bhrigu's `BhriguRelationshipType`, which includes `'NONE'`) into
 * Personal Intelligence's contract-local `PersonalTransitRelationship`
 * (which deliberately excludes `'NONE'` -- see that type's own doc
 * comment). Throws rather than silently mapping a NONE pair: the public
 * engine's own `TransitActivationResult.activations` is ALREADY filtered
 * to exclude NONE (engine.ts), so this should be unreachable for any
 * real result -- this function fails loudly instead of producing a
 * contract value the type system says cannot exist, rather than silently
 * coercing it.
 */
function toPersonalTransitRelationship(relationship: TransitRelationship): PersonalTransitRelationship {
  if (relationship === 'NONE') {
    throw new TransitActivationValidationError('Cannot map a NONE relationship into the Personal Intelligence contract -- this indicates the supplied TransitActivationResult was not produced by this package\'s own calculateTransitActivation (which already excludes NONE pairs from its public activations array).');
  }
  return relationship;
}

/**
 * Copies this engine's own local evidence shape into Personal
 * Intelligence's `PersonalEvidenceRef` -- both shapes already carry the
 * identical `source`/`ruleId`/`ruleVersion`/`summary`/`data` fields (see
 * types.ts's own TransitActivationEvidenceRef doc comment: "shape-compatible
 * in spirit... so a future adapter could translate it without a
 * structural mismatch"); only `data`'s own value type differs
 * (`Record<string, unknown>` here vs. the contract's bounded
 * `PersonalEvidenceDataValue`). Safe here specifically because every
 * evidence builder in this package's own evidence.ts constructs `data`
 * from plain string/number literals only (verified by this package's own
 * "no ACTUAL CODE references... an LLM" and payload-size tests) -- never
 * a function, class instance, Map, Set, or Date.
 */
function toPersonalEvidenceRef(ref: TransitActivationEvidenceRef): PersonalEvidenceRef {
  return {
    source: ref.source,
    ruleId: ref.ruleId,
    ruleVersion: ref.ruleVersion,
    summary: ref.summary,
    data: ref.data as Readonly<Record<string, PersonalEvidenceDataValue>> | undefined,
  };
}

/**
 * Maps this engine's own result into Personal Intelligence's
 * CONTRACT_V2 `TransitActivationContext` -- a purely mechanical,
 * lossless, 1:1 pair-level mapping (see this file's own module doc
 * comment). `result.activations.length === context.activations.length`
 * always holds: no grouping by transiting planet, no aggregation of any
 * kind (`Math.max`/sum/average), and no theme projection -- every
 * directed pair this engine detected becomes exactly one contract
 * `TransitActivation` record, with `transitingPlanet`/`natalPlanet`/
 * `relationship`/`strength` all preserved as first-class typed fields, so
 * no downstream consumer ever needs to parse `evidence.data` to recover
 * activation identity.
 */
export function toTransitActivationContext(result: TransitActivationResult): TransitActivationContext {
  const activations: TransitActivation[] = result.activations.map((pair) => ({
    transitingPlanet: pair.transitingPlanet,
    natalPlanet: pair.natalPlanet,
    relationship: toPersonalTransitRelationship(pair.relationship),
    strength: pair.strength,
    evidence: pair.evidence.map(toPersonalEvidenceRef),
  }));

  return {
    activations,
    evidence: result.evidence.map(toPersonalEvidenceRef),
  };
}
