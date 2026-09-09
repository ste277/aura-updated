/**
 * Natal Ascendant / Lagna Foundation V1 -- public engine.
 *
 * Consumes a birth moment (UTC) + geographic coordinates only -- never a
 * raw birth timezone/city name (those are product-input concerns, not
 * mathematical inputs; see README.md's "Timezone independence" section),
 * and never reads Prisma/DB state (see README.md's "Real birth-profile
 * compatibility" section).
 */
import * as Astronomy from 'astronomy-engine';
import { lahiriAyanamsa } from '../../vedic/src/panchangElements';
import { findTropicalAscendantLongitude } from './ascendant';
import { normalize360, toRashiPlacement } from './sign';
import { assertValidBirthMoment, assertValidLatitude, assertValidLongitude } from './validation';
import { buildLocalSiderealTimeEvidence, buildTropicalAscendantEvidence, buildLahiriConversionEvidence, buildRashiEvidence } from './evidence';
import { NATAL_LAGNA_ENGINE_VERSION } from './provenance';
import type { NatalAscendant, NatalAscendantInput } from './types';

/**
 * The core public entry point. Given a birth moment (UTC) and geographic
 * coordinates, deterministically calculates the tropical and Lahiri
 * sidereal Ascendant -- see ascendant.ts's own doc comment for the exact
 * calculation chain (astronomy-engine rotation composition + root-
 * finding, never a hand-rolled sidereal-time/obliquity formula).
 *
 * Rejects: a non-finite/invalid `birthMomentUTC`, a non-finite or
 * out-of-range `latitude`/`longitude` (see validation.ts). Never calls
 * `new Date()`/`Date.now()` -- the caller supplies the instant.
 */
export function calculateNatalAscendant(birthMomentUTC: Date, latitude: number, longitude: number): NatalAscendant {
  assertValidBirthMoment(birthMomentUTC);
  assertValidLatitude(latitude);
  assertValidLongitude(longitude);

  const time = Astronomy.MakeTime(birthMomentUTC);
  const observer = new Astronomy.Observer(latitude, longitude, 0);

  const tropicalLongitude = findTropicalAscendantLongitude(time, observer);
  const ayanamsaDegrees = lahiriAyanamsa(birthMomentUTC);
  const siderealLongitude = normalize360(tropicalLongitude - ayanamsaDegrees);
  const { rashiIndex, rashiName, degreeInRashi } = toRashiPlacement(siderealLongitude);

  // Local sidereal time is NOT an intermediate this package's own
  // rotation-based algorithm needs (it is implicitly encoded inside
  // astronomy-engine's own Rotation_EQD_HOR) -- it is computed here
  // purely for evidence/transparency, exactly as astronomy-engine's own
  // SiderealTime() (Greenwich Apparent Sidereal Time) plus east-positive
  // observer longitude, matching this repo's own established convention
  // (see README.md's "Local sidereal time" section).
  const localSiderealTimeDegrees = normalize360(Astronomy.SiderealTime(time) * 15 + longitude);

  const evidence = [
    buildLocalSiderealTimeEvidence({ localSiderealTimeDegrees, latitude, longitude }),
    buildTropicalAscendantEvidence({ tropicalLongitude }),
    buildLahiriConversionEvidence({ tropicalLongitude, ayanamsaDegrees, siderealLongitude }),
    buildRashiEvidence({ siderealLongitude, rashiIndex, rashiName, degreeInRashi }),
  ];

  return {
    engineVersion: NATAL_LAGNA_ENGINE_VERSION,
    tropicalLongitude,
    siderealLongitude,
    rashiIndex,
    rashiName,
    degreeInRashi,
    ayanamsaDegrees,
    evidence,
  };
}

/** Convenience overload taking a single structured input object -- identical semantics to calculateNatalAscendant(birthMomentUTC, latitude, longitude). */
export function calculateNatalAscendantFromInput(input: NatalAscendantInput): NatalAscendant {
  return calculateNatalAscendant(input.birthMomentUTC, input.latitude, input.longitude);
}
