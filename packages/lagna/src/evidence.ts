/**
 * Natal Ascendant / Lagna Foundation V1 -- structured evidence builders.
 *
 * Every calculated fact this engine derives gets its own
 * NatalLagnaEvidenceRef, source: 'NATAL_LAGNA'. Stable rule ids only
 * (provenance.ts) -- never generated at runtime, never timestamped.
 */
import {
  NATAL_LAGNA_RULE_VERSION,
  NATAL_LAGNA_LOCAL_SIDEREAL_TIME_V1,
  NATAL_LAGNA_TROPICAL_ASCENDANT_V1,
  NATAL_LAGNA_LAHIRI_CONVERSION_V1,
  NATAL_LAGNA_RASHI_V1,
} from './provenance';
import type { NatalLagnaEvidenceRef } from './types';

export function buildLocalSiderealTimeEvidence(params: { localSiderealTimeDegrees: number; latitude: number; longitude: number }): NatalLagnaEvidenceRef {
  return {
    source: 'NATAL_LAGNA',
    ruleId: NATAL_LAGNA_LOCAL_SIDEREAL_TIME_V1,
    ruleVersion: NATAL_LAGNA_RULE_VERSION,
    summary: `Local sidereal time at (${params.latitude.toFixed(4)}, ${params.longitude.toFixed(4)}) is ${params.localSiderealTimeDegrees.toFixed(4)} degrees, derived from astronomy-engine's own Greenwich Apparent Sidereal Time plus east-positive observer longitude.`,
    data: { localSiderealTimeDegrees: params.localSiderealTimeDegrees, latitude: params.latitude, longitude: params.longitude },
  };
}

export function buildTropicalAscendantEvidence(params: { tropicalLongitude: number }): NatalLagnaEvidenceRef {
  return {
    source: 'NATAL_LAGNA',
    ruleId: NATAL_LAGNA_TROPICAL_ASCENDANT_V1,
    ruleVersion: NATAL_LAGNA_RULE_VERSION,
    summary: `Tropical (true ecliptic of date) Ascendant longitude is ${params.tropicalLongitude.toFixed(4)} degrees, located as the rising (eastern-horizon) ecliptic/horizon intersection.`,
    data: { tropicalLongitude: params.tropicalLongitude },
  };
}

export function buildLahiriConversionEvidence(params: { tropicalLongitude: number; ayanamsaDegrees: number; siderealLongitude: number }): NatalLagnaEvidenceRef {
  return {
    source: 'NATAL_LAGNA',
    ruleId: NATAL_LAGNA_LAHIRI_CONVERSION_V1,
    ruleVersion: NATAL_LAGNA_RULE_VERSION,
    summary: `Lahiri sidereal Ascendant = tropical (${params.tropicalLongitude.toFixed(4)}deg) - ayanamsa (${params.ayanamsaDegrees.toFixed(4)}deg) = ${params.siderealLongitude.toFixed(4)}deg, using packages/vedic's own lahiriAyanamsa().`,
    data: { tropicalLongitude: params.tropicalLongitude, ayanamsaDegrees: params.ayanamsaDegrees, siderealLongitude: params.siderealLongitude },
  };
}

export function buildRashiEvidence(params: { siderealLongitude: number; rashiIndex: number; rashiName: string; degreeInRashi: number }): NatalLagnaEvidenceRef {
  return {
    source: 'NATAL_LAGNA',
    ruleId: NATAL_LAGNA_RASHI_V1,
    ruleVersion: NATAL_LAGNA_RULE_VERSION,
    summary: `Sidereal Ascendant at ${params.siderealLongitude.toFixed(4)}deg falls in ${params.rashiName} (Rashi ${params.rashiIndex}), ${params.degreeInRashi.toFixed(4)}deg into the sign.`,
    data: { siderealLongitude: params.siderealLongitude, rashiIndex: params.rashiIndex, rashiName: params.rashiName, degreeInRashi: params.degreeInRashi },
  };
}
