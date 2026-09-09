/**
 * Natal Ascendant / Lagna Foundation V1 -- constants.
 *
 * Repository audit (see ../README.md's "Repository audit" section and this
 * PR's own implementation report for the full trace): no Ascendant/Lagna
 * calculation exists anywhere in this repository prior to this package.
 * packages/vedic/src/natalChart.ts's own module doc comment explicitly
 * states it does NOT compute the Ascendant/Lagna ("needs sidereal-time +
 * latitude-dependent spherical trig -- meaningfully more machinery"), and
 * packages/recommendation/src/muhurthamFinder.ts's own doc comment
 * confirms `UserChartContext.lagnaSign` (personalizedTasks.ts) "is
 * declared but never populated with a real value or read by any scoring
 * path" and that Ashtakavarga/Lagna-based Muhurta are NOT_IMPLEMENTED
 * anywhere. This package is the first real Ascendant producer.
 */

/**
 * The 30-degree span of one zodiac sign (Rashi) -- 360/12, matching
 * packages/vedic/src/natalChart.ts's own `rashiIndex = floor(longitude/30)`
 * convention exactly (0 = Mesha/Aries .. 11 = Meena/Pisces).
 */
export const RASHI_SPAN_DEGREES = 30;

export const RASHI_COUNT = 12;

/**
 * The 12 Rashi (zodiac sign) names, Mesha(Aries)..Meena(Pisces), 0-indexed
 * -- byte-identical in order and spelling to packages/vedic/src/
 * natalChart.ts's own (private, unexported) RASHI_NAMES array. That array
 * cannot be imported (it is not exported, and packages/vedic is protected
 * scope for this PR -- see README.md's "Sign convention" section), so
 * this is a deliberate, minimal, purely-static re-declaration of display
 * names only -- NOT a second astronomical calculation. This mirrors the
 * exact same situation already handled once in this repository:
 * packages/vedic/src/lunarCalendar.ts's own module doc comment ("Not
 * imported from there (that module's RASHI_NAMES is private...) -- kept
 * as a small local constant") and packages/bhrigu/src/types.ts's own
 * `ZodiacSign` doc comment, both independently reaching the same
 * conclusion for the same reason.
 */
export const RASHI_NAMES = [
  'Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya',
  'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena',
] as const;

/**
 * Root-finding precision for locating the Ascendant's exact ecliptic
 * longitude (see ascendant.ts). 60 bisection iterations over an initial
 * bracket of at most one coarse-scan step (360/ASCENDANT_SCAN_SAMPLES
 * degrees) converges to far better than double-precision-meaningful
 * angular resolution (2^-60 of a ~0.5 degree bracket is ~1e-19 degrees) --
 * this is deliberately far more than the ~1e-4 degree agreement observed
 * against independent validation (see README.md's "Independent
 * known-answer validation" section), not a claim of that much real
 * physical precision.
 */
export const ASCENDANT_SCAN_SAMPLES = 1440; // one root-bracketing sample every 0.25 degrees of ecliptic longitude
export const ASCENDANT_BISECTION_ITERATIONS = 60;

/**
 * Valid geographic latitude domain: strictly `(-90, 90)`, i.e. the poles
 * themselves (+/-90 exactly) are rejected -- see README.md's "Polar /
 * high-latitude behavior" section for why: at exactly +/-90 the horizontal
 * coordinate frame itself is singular (azimuth/"north" is not a
 * well-defined direction at a pole), which is a genuine definitional
 * edge case, not merely a numerical-precision inconvenience. Every
 * latitude strictly between the poles has a well-defined Ascendant (the
 * ecliptic and horizon are two distinct great circles through the
 * observer's celestial sphere, which always intersect at exactly two
 * antipodal points) -- verified up to 89.9 degrees during this PR's own
 * validation pass with no numerical degradation.
 */
export const MAX_VALID_LATITUDE = 90;
export const MIN_VALID_LATITUDE = -90;

/**
 * Valid geographic longitude domain: `[-180, 180]`, east-positive --
 * matching astronomy-engine's own `Observer.longitude` documented
 * convention exactly ("degrees east of the prime meridian... negative
 * for observers west... should be kept in the range -180 to +180 to
 * minimize floating point errors"). This package does NOT normalize an
 * arbitrary out-of-range longitude (e.g. 436 or -284) into this range --
 * see README.md's "Longitude convention" section for the explicit
 * rationale (avoiding a second, independently-invented wraparound
 * convention when the input contract can simply require the caller to
 * supply an already-canonical value, exactly as astronomy-engine itself
 * recommends).
 */
export const MAX_VALID_LONGITUDE = 180;
export const MIN_VALID_LONGITUDE = -180;
