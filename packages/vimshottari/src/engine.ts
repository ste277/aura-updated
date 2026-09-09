/**
 * Vimshottari Dasha Engine V1 -- public engine.
 *
 * The intended public entry points (see index.ts). Consumes an
 * already-known sidereal natal Moon longitude -- never calls
 * getNatalChart() or any ephemeris itself, never accepts a raw birth
 * date/location beyond the instant already resolved to UTC. See
 * ../README.md's "Architecture" section.
 */
import { calculateBirthBalance, generateMahadashaCycle } from './mahadasha';
import { dedupeEvidenceRefs } from './evidence';
import { fromIsoInstant } from './duration';
import { VIMSHOTTARI_ENGINE_VERSION } from './provenance';
import { VimshottariValidationError } from './types';
import type { VimshottariDashaInput, VimshottariDashaResult, VimshottariMahadashaPeriod, VimshottariPeriod } from './types';
import type { GrahaPosition } from '../../vedic/src/natalChart';
import type { LifePeriodContext, LifePeriodSegment } from '../../personal-intelligence/src/context';

function assertFiniteDate(date: Date, label: string): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new VimshottariValidationError(`${label} must be a valid, finite Date, got: ${String(date)}`);
  }
}

function assertFiniteLongitude(longitude: number, label: string): void {
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
    throw new VimshottariValidationError(`${label} must be a finite number, got: ${longitude}`);
  }
}

/**
 * The core public entry point. Given a birth moment (UTC) and an
 * already-known sidereal Moon longitude, deterministically calculates
 * Vimshottari Mahadasha/Antardasha periods starting from the birth
 * Mahadasha's own true start and continuing for at least
 * VIMSHOTTARI_MIN_COVERAGE_MS (120 Vimshottari years) AFTER the birth
 * moment -- see mahadasha.ts's own generateMahadashaCycle doc comment
 * for why this is a coverage guarantee, not a fixed count of 9
 * Mahadashas (the birth Mahadasha's own true start typically precedes
 * birth, so 9 Mahadashas from that true start alone would NOT reach 120
 * years past birth; the Vimshottari sequence is cyclic and this engine
 * generates as many wraps as needed).
 *
 * Rejects: a non-finite/invalid `birthMomentUTC`, a non-finite
 * `moonLongitude`. Never calls `new Date()`/`Date.now()` -- the caller
 * supplies the instant, and every subsequent boundary is derived from it
 * via pure arithmetic (mahadasha.ts, antardasha.ts, duration.ts).
 */
export function calculateVimshottariDasha(input: VimshottariDashaInput): VimshottariDashaResult {
  assertFiniteDate(input.birthMomentUTC, 'birthMomentUTC');
  assertFiniteLongitude(input.moonLongitude, 'moonLongitude');

  const birthMomentMs = input.birthMomentUTC.getTime();
  const { birthNakshatra, mahaStartMs, evidence: birthEvidence } = calculateBirthBalance(input.moonLongitude, birthMomentMs);
  const mahadashas = generateMahadashaCycle(birthNakshatra.lord, mahaStartMs, birthMomentMs);

  const evidence = dedupeEvidenceRefs([
    ...birthEvidence,
    ...mahadashas.flatMap((mahadasha) => [...mahadasha.evidence, ...mahadasha.antardashas.flatMap((antardasha) => antardasha.evidence)]),
  ]);

  return {
    engineVersion: VIMSHOTTARI_ENGINE_VERSION,
    birthNakshatra,
    mahadashas,
    evidence,
  };
}

/**
 * Convenience adapter for a caller that already has a full natal chart
 * (packages/vedic's own GrahaPosition[], e.g. from getNatalChart()) --
 * extracts the Moon's own sidereal longitude and delegates to
 * calculateVimshottariDasha above. This package is NOT responsible for
 * calculating the natal chart itself -- it never calls getNatalChart()
 * internally, only accepts an already-computed one here.
 *
 * Rejects a `positions` array that does not contain EXACTLY one Moon
 * entry (missing, or duplicated) -- a malformed/incompatible natal
 * chart should fail clearly here rather than silently using the wrong
 * (or an arbitrary) Moon longitude.
 */
export function calculateVimshottariFromNatalChart(birthMomentUTC: Date, positions: GrahaPosition[]): VimshottariDashaResult {
  const moonPositions = positions.filter((position) => position.graha === 'Moon');
  if (moonPositions.length !== 1) {
    throw new VimshottariValidationError(`Expected exactly one Moon position in the supplied natal chart, got ${moonPositions.length}`);
  }
  return calculateVimshottariDasha({ birthMomentUTC, moonLongitude: moonPositions[0].siderealLongitude });
}

/** The Mahadasha active at `instant`, using [start, end) semantics -- `undefined` if `instant` falls outside the generated 9-Mahadasha cycle entirely. */
export function findMahadashaAt(result: VimshottariDashaResult, instant: Date): VimshottariMahadashaPeriod | undefined {
  assertFiniteDate(instant, 'instant');
  const instantMs = instant.getTime();
  return result.mahadashas.find((mahadasha) => instantMs >= fromIsoInstant(mahadasha.start) && instantMs < fromIsoInstant(mahadasha.end));
}

/** The Antardasha active at `instant` (within whichever Mahadasha is active then), using [start, end) semantics -- `undefined` if no Mahadasha is active at `instant`. */
export function findAntardashaAt(result: VimshottariDashaResult, instant: Date): VimshottariPeriod | undefined {
  const mahadasha = findMahadashaAt(result, instant);
  if (!mahadasha) return undefined;
  const instantMs = instant.getTime();
  return mahadasha.antardashas.find((antardasha) => instantMs >= fromIsoInstant(antardasha.start) && instantMs < fromIsoInstant(antardasha.end));
}

/** Combined convenience lookup -- see findMahadashaAt/findAntardashaAt above. */
export function getVimshottariPeriodAt(result: VimshottariDashaResult, instant: Date): { mahadasha?: VimshottariMahadashaPeriod; antardasha?: VimshottariPeriod } {
  const mahadasha = findMahadashaAt(result, instant);
  const antardasha = mahadasha ? findAntardashaAt(result, instant) : undefined;
  return { mahadasha, antardasha };
}

function toLifePeriodSegment(period: VimshottariPeriod): LifePeriodSegment {
  return { ruler: period.lord, startAt: period.start, endAt: period.end, level: period.level };
}

/**
 * Adapts this engine's own result into packages/personal-intelligence's
 * existing, merged `LifePeriodContext` -- no contract change was needed
 * (see this PR's own implementation report "Personal Intelligence
 * integration" section): `LifePeriodContext` is already a POINT-IN-TIME
 * snapshot (`majorPeriod`/`subPeriod`, singular, not a full history),
 * which is exactly what "the Mahadasha/Antardasha active at `at`" is.
 *
 * `themes` is left as `[]` -- Personal Themes scoring is explicitly out
 * of scope for this PR (see README.md's "Product interpretation"
 * section); this adapter does not mutate or call into
 * packages/personal-themes at all.
 */
export function toLifePeriodContext(result: VimshottariDashaResult, at: Date): LifePeriodContext {
  assertFiniteDate(at, 'at');
  const { mahadasha, antardasha } = getVimshottariPeriodAt(result, at);

  return {
    system: 'VIMSHOTTARI_DASHA',
    majorPeriod: mahadasha ? toLifePeriodSegment(mahadasha) : undefined,
    subPeriod: antardasha ? toLifePeriodSegment(antardasha) : undefined,
    themes: [],
    evidence: dedupeEvidenceRefs([...(mahadasha?.evidence ?? []), ...(antardasha?.evidence ?? [])]),
  };
}
