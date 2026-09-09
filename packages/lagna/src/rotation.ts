/**
 * Natal Ascendant / Lagna Foundation V1 -- ecliptic-to-horizontal
 * geometry, built entirely from astronomy-engine's own rotation-matrix
 * primitives.
 *
 * CRITICAL CONVENTION AUDIT (see README.md's own section of the same
 * name for the full trace): astronomy-engine exposes `Rotation_ECL_HOR`,
 * but its own doc comment identifies "ECL" as "ecliptic system, using
 * equator at J2000 epoch" -- a FIXED-epoch (J2000 mean) ecliptic frame,
 * NOT ecliptic-of-date. That is the wrong frame for this package: every
 * other natal-astrology quantity in this repository (packages/vedic/src/
 * natalChart.ts's own GrahaPosition.siderealLongitude, via its own
 * `Astronomy.Ecliptic(vector)` call) is computed in the TRUE ecliptic OF
 * DATE (astronomy-engine's own "ECT" frame -- its `Ecliptic()` function's
 * own doc comment says verbatim: "Converts a J2000 mean equator (EQJ)
 * vector to a TRUE ECLIPTIC OF DATE (ETC) vector"). Using the fixed-epoch
 * ECL/HOR rotation instead would silently introduce a multi-arcminute
 * precession-sized error AND would make this package's tropical Ascendant
 * inconsistent with the rest of this repository's own tropical-longitude
 * convention for every other body.
 *
 * astronomy-engine does not expose a single `Rotation_ECT_HOR` function
 * directly, but it exposes both halves of the same composition it uses
 * internally for other frame pairs: `Rotation_ECT_EQD` (true ecliptic of
 * date -> equator of date) and `Rotation_EQD_HOR` (equator of date ->
 * horizontal, observer-dependent). `CombineRotation` composes them into
 * exactly the ECT -> HOR rotation this package needs -- built entirely
 * from astronomy-engine's own tested rotation primitives, with NO
 * hand-rolled sidereal-time formula, obliquity model, or coordinate-
 * rotation trigonometry of this package's own. This satisfies this PR's
 * own brief: "Use the most reliable available astronomy-engine primitive
 * ... Do not hand-roll sidereal-time or coordinate rotations when an
 * established library function already provides the same quantity
 * reliably."
 *
 * The resulting horizontal Cartesian frame (per Rotation_ECT_EQD's own
 * sibling Rotation_ECL_HOR doc comment, which documents the shared HOR
 * convention used throughout astronomy-engine): x = north, y = west,
 * z = zenith (straight up). Azimuth returned by HorizonFromVector is
 * "measured in degrees clockwise from north: east = +90" -- i.e. the
 * conventional navigation/astrology azimuth convention, not the
 * right-hand-rule convention astronomy-engine's own SphereFromVector uses
 * for other purposes (see HorizonFromVector's own doc comment for this
 * explicit distinction).
 */
import * as Astronomy from 'astronomy-engine';

export interface HorizontalPoint {
  /** Degrees above (positive) or below (negative) the horizon, in [-90, 90]. */
  altitude: number;
  /** Degrees clockwise from north (east = 90, south = 180, west = 270), in [0, 360). */
  azimuth: number;
}

/**
 * Builds the true-ecliptic-of-date -> horizontal rotation for a given
 * instant + observer, and returns a function that evaluates the
 * altitude/azimuth of the point on the ecliptic (latitude 0) at a given
 * ecliptic longitude `lambdaDegrees` -- used by ascendant.ts's own
 * root-finder to locate where this curve crosses the horizon.
 */
export function makeEclipticHorizonProbe(time: Astronomy.AstroTime, observer: Astronomy.Observer): (lambdaDegrees: number) => HorizontalPoint {
  const rotation = Astronomy.CombineRotation(Astronomy.Rotation_ECT_EQD(time), Astronomy.Rotation_EQD_HOR(time, observer));

  return (lambdaDegrees: number): HorizontalPoint => {
    const radians = (lambdaDegrees * Math.PI) / 180;
    // A unit vector on the ecliptic plane (ecliptic latitude 0) at longitude
    // `lambdaDegrees` -- the AU-scale distance is arbitrary (direction only
    // matters for HorizonFromVector's altitude/azimuth output).
    const eclipticVector = new Astronomy.Vector(Math.cos(radians), Math.sin(radians), 0, time);
    const horizontalVector = Astronomy.RotateVector(rotation, eclipticVector);
    // astronomy-engine's own .d.ts types `refraction` as `string`, but its
    // own doc comment for HorizonFromVector documents `null` as a valid,
    // intentional value ("no atmospheric refraction correction is
    // performed") -- a looseness in the published type declaration, not
    // in the library's actual runtime behavior. Refraction is irrelevant
    // here regardless (we are computing a geometric ecliptic-longitude
    // crossing, not an observed apparent position of a real body), so
    // `null` (no correction) is also the astronomically correct choice.
    const spherical = Astronomy.HorizonFromVector(horizontalVector, null as unknown as string);
    return { altitude: spherical.lat, azimuth: spherical.lon };
  };
}
