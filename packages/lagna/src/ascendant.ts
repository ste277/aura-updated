/**
 * Natal Ascendant / Lagna Foundation V1 -- tropical Ascendant longitude
 * via root-finding over the ecliptic/horizon altitude probe (rotation.ts).
 *
 * ASTRONOMICAL DEFINITION: the Ascendant is the point where the ecliptic
 * intersects the observer's eastern horizon. The ecliptic and the horizon
 * are both great circles (through the celestial sphere's center, ignoring
 * parallax -- standard for this purpose, exactly as astronomy-engine's own
 * geocentric-direction rotation matrices already assume), so they always
 * intersect at EXACTLY two antipodal points (the Ascendant and the
 * Descendant, which are therefore always exactly 180 degrees apart in
 * ecliptic longitude -- verified as an internal consistency check by this
 * package's own tests) for any observer latitude strictly between the
 * poles (see constants.ts's own MIN/MAX_VALID_LATITUDE doc comment).
 *
 * ALGORITHM: `makeEclipticHorizonProbe` gives altitude(lambda) for any
 * ecliptic longitude lambda. This function coarsely scans
 * ASCENDANT_SCAN_SAMPLES points across [0, 360) to bracket every sign
 * change (there should be exactly two), then refines each bracket via
 * bisection (ASCENDANT_BISECTION_ITERATIONS) to locate the precise
 * root. The RISING (Ascendant) root is disambiguated from the SETTING
 * (Descendant) root by azimuth: an object is rising if and only if it is
 * on the geometrically EASTERN side of the local horizon, i.e. azimuth
 * strictly between 0 (north) and 180 (south) passing through 90 (east) --
 * a general, hemisphere- and season-independent consequence of Earth's
 * west-to-east rotation, not a formula this package invented. This
 * disambiguation-by-azimuth approach has no quadrant ambiguity of the
 * kind that affects the classical closed-form tan(Ascendant) formula
 * (see README.md's own "Independent known-answer validation" section --
 * a real, commonly-reported pitfall of that formula, which this package
 * avoids entirely by construction).
 */
import * as Astronomy from 'astronomy-engine';
import { makeEclipticHorizonProbe } from './rotation';
import { ASCENDANT_SCAN_SAMPLES, ASCENDANT_BISECTION_ITERATIONS } from './constants';
import { normalize360 } from './sign';
import { NatalLagnaComputationError } from './types';

function isRisingCrossing(previousAltitude: number, currentAltitude: number): boolean {
  return (previousAltitude <= 0 && currentAltitude > 0) || (previousAltitude >= 0 && currentAltitude < 0);
}

/**
 * Locates the tropical (true ecliptic of date) Ascendant longitude, in
 * [0, 360), for a given instant + observer. Throws
 * NatalLagnaComputationError (never returns NaN) if the expected exactly-
 * two-crossings geometry is not found -- see this file's own module doc
 * comment for why that should only be reachable at exactly the poles,
 * which is already rejected as invalid input before this function is
 * ever called (engine.ts's own validation).
 */
export function findTropicalAscendantLongitude(time: Astronomy.AstroTime, observer: Astronomy.Observer): number {
  const probe = makeEclipticHorizonProbe(time, observer);
  const stepDegrees = 360 / ASCENDANT_SCAN_SAMPLES;

  const brackets: Array<{ lo: number; hi: number; loAltitude: number }> = [];
  let previousLambda = 0;
  let previousAltitude = probe(0).altitude;

  for (let i = 1; i <= ASCENDANT_SCAN_SAMPLES; i++) {
    const lambda = normalize360(i * stepDegrees);
    const altitude = probe(lambda).altitude;
    if (isRisingCrossing(previousAltitude, altitude)) {
      brackets.push({ lo: previousLambda, hi: previousLambda + stepDegrees, loAltitude: previousAltitude });
    }
    previousLambda += stepDegrees;
    previousAltitude = altitude;
  }

  const roots = brackets.map(({ lo, hi, loAltitude }) => {
    let low = lo;
    let high = hi;
    let lowAltitude = loAltitude;
    for (let iteration = 0; iteration < ASCENDANT_BISECTION_ITERATIONS; iteration++) {
      const mid = (low + high) / 2;
      const midAltitude = probe(normalize360(mid)).altitude;
      if (isRisingCrossing(lowAltitude, midAltitude)) {
        high = mid;
      } else {
        low = mid;
        lowAltitude = midAltitude;
      }
    }
    return normalize360((low + high) / 2);
  });

  if (roots.length !== 2) {
    throw new NatalLagnaComputationError(
      `Expected exactly 2 ecliptic/horizon crossings (Ascendant + Descendant), found ${roots.length}. This indicates a latitude/time singularity in the Ascendant geometry.`
    );
  }

  const ascending = roots.filter((lambda) => {
    const azimuth = probe(lambda).azimuth;
    return azimuth > 0 && azimuth < 180;
  });

  if (ascending.length !== 1) {
    throw new NatalLagnaComputationError(
      `Expected exactly one of the 2 ecliptic/horizon crossings to be on the rising (eastern, azimuth in (0,180)) side, found ${ascending.length}.`
    );
  }

  return ascending[0];
}
