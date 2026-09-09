/**
 * Transit Activation Engine V1 -- constants.
 *
 * Repository audit (see ../README.md's "Repository audit" section and
 * this PR's own implementation report for the full trace): no Transit
 * Activation engine exists anywhere in this repository prior to this
 * package. The only pre-existing "transit" code is
 * packages/vedic/src/transits.ts's own `calculateDailyTransits` -- a
 * DIFFERENT, house-from-Moon-based, interpretive-copy-generating
 * heuristic (isBenefic + hardcoded prose), not a deterministic
 * sign-relationship activation detector. This package does not import
 * or extend that file; it reuses only `getNatalChart()` itself (the
 * actual position calculator that file also calls), exactly as
 * documented in README.md's "Canonical sources" section.
 */
import type { GrahaName } from '../../vedic/src/natalChart';

/**
 * The canonical 9-graha planet set -- identical order to
 * packages/vedic/src/natalChart.ts's own getNatalChart() return order,
 * and to packages/bhrigu's own SUPPORTED_PLANETS. Rahu/Ketu ARE
 * included in V1 (unlike packages/ashtakavarga, which excludes them per
 * its OWN locked classical rule table) -- see README.md's "Rahu/Ketu"
 * section: the canonical transit source (getNatalChart) already
 * computes Rahu/Ketu positions using the exact same sidereal convention
 * as the other 7 grahas, so there is no technical reason to exclude
 * them, and Transit Activation is a structurally different model from
 * Ashtakavarga's own classical 8-contributor table (this package does
 * not consume or depend on packages/ashtakavarga at all).
 */
export const TRANSIT_ACTIVATION_PLANETS: readonly GrahaName[] = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Rahu', 'Ketu'];

export const TRANSIT_ACTIVATION_PLANET_COUNT = TRANSIT_ACTIVATION_PLANETS.length; // 9

/** Every directed (transiting, natal) pair is evaluated, including self-pairs (e.g. transiting Saturn -> natal Saturn, a real "return" event) -- see relationships.ts's own doc comment. */
export const TRANSIT_ACTIVATION_PAIR_COUNT = TRANSIT_ACTIVATION_PLANET_COUNT * TRANSIT_ACTIVATION_PLANET_COUNT; // 81
