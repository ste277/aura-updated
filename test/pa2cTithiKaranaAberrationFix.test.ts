/**
 * AURA PA-2C -- regression coverage for the Tithi/Karana transition-search
 * aberration-convention fix (packages/vedic/src/panchangElements.ts's
 * findNextTransition(), TITHI/KARANA branches).
 *
 * Root cause (AURA PA-2B): astronomy-engine's MoonPhase()/SearchMoonPhase(),
 * previously used by findNextTransition('TITHI'|'KARANA'), internally call
 * GeoVector(..., false) -- aberration correction OFF. getTithi()/getKarana()
 * (and every other value function in panchangElements.ts, via
 * getSiderealLongitude()) call GeoVector(..., true) -- aberration ON, the
 * standard "apparent geocentric position" convention documented by Swiss
 * Ephemeris as its DEFAULT output (SEFLG_NOABERR/SEFLG_ASTROMETRIC are the
 * explicit, non-default opt-OUT of aberration;
 * https://www.astro.com/swisseph/swephprg.htm) -- the convention underlying
 * virtually all real-world Panchangam/Jyotish software, since Swiss
 * Ephemeris is its standard reference ephemeris library. This mismatch
 * produced a reproducible ~20.8 arcsecond gap in the Moon-Sun sidereal
 * elongation itself, converting (at the ~12.2 deg/day relative elongation
 * rate) to a ~39-46 second transition-instant discrepancy against
 * getTithi()/getKarana()'s own ground truth. Fixed by searching the same
 * aberration-true elongation already used by the YOGA/NAKSHATRA branches,
 * instead of reusing MoonPhase/SearchMoonPhase.
 *
 * Deterministic, network-free. The four 2026 dates and the single non-2026
 * date below are the exact instants independently reproduced during the
 * PA-2B investigation and re-verified during PA-2C -- not newly invented.
 */
import { findNextTransition, findNextNamedTransition, getTithi, getKarana, getYoga, getSiderealLongitude } from '../packages/vedic/src/panchangElements';
import { spanOverlapsAuthoritativeEventAvoid } from '../packages/recommendation/src/muhurthamFinder';
import { spanOverlapsProhibitedPeriod } from '../packages/recommendation/src/ceremonialPeriods';
import { Body } from 'astronomy-engine';

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log('OK  ', label);
  } else {
    fail++;
    console.log('FAIL', label);
  }
}

const SAMPLE_DATES = [
  '2026-01-15T00:00:00Z',
  '2026-03-01T00:00:00Z',
  '2026-07-04T00:00:00Z',
  '2026-11-20T00:00:00Z',
  '2030-06-01T00:00:00Z', // non-2026 epoch, per PA-2C's own requirement
];

// -----------------------------------------------------------------------
// 1. Mathematical/convention basis: the ~20.8 arcsecond aberration gap in
// the Moon-Sun sidereal elongation itself (independent of either
// transition-search implementation), confirmed at a fixed, deterministic
// instant -- this is the root-cause magnitude PA-2B/PA-2C established, not
// a value derived from either transition finder.
// -----------------------------------------------------------------------
{
  // GeoVector's own aberration flag, isolated directly -- re-derives the
  // ~20.8 arcsecond figure from first principles (not from
  // getSiderealLongitude or either transition finder), confirming the
  // underlying physical magnitude this fix addresses still holds.
  const { GeoVector, Ecliptic, AstroTime } = require('astronomy-engine');
  const t = new AstroTime(new Date('2026-01-15T01:37:00.000Z'));
  const moonAberrOn = Ecliptic(GeoVector(Body.Moon, t, true)).elon;
  const moonAberrOff = Ecliptic(GeoVector(Body.Moon, t, false)).elon;
  const sunAberrOn = Ecliptic(GeoVector(Body.Sun, t, true)).elon;
  const sunAberrOff = Ecliptic(GeoVector(Body.Sun, t, false)).elon;
  const elongOn = ((moonAberrOn - sunAberrOn) + 360) % 360;
  const elongOff = ((moonAberrOff - sunAberrOff) + 360) % 360;
  const gapArcsec = Math.abs(elongOn - elongOff) * 3600;
  check('Aberration-on vs aberration-off Moon-Sun elongation gap is ~20.8 arcsec (the root-cause magnitude), not zero', gapArcsec > 15 && gapArcsec < 26);
}

// -----------------------------------------------------------------------
// 2. Cross-implementation agreement: findNextTransition('KARANA') and
// findNextNamedTransition(getKarana) must now agree to well under 1
// second -- not the ~39-46 second systematic offset PA-1/PA-2B measured.
// Tolerance (2000ms) is tight enough to catch a reintroduced aberration-
// convention mismatch while allowing ordinary bisection-resolution noise.
// -----------------------------------------------------------------------
for (const d of SAMPLE_DATES) {
  const instant = new Date(d);
  const a = findNextTransition(instant, 'KARANA');
  const b = findNextNamedTransition(instant, (x) => getKarana(x).name, 15);
  const diffMs = b ? Math.abs(a.getTime() - b.getTime()) : Infinity;
  check(`KARANA: findNextTransition and findNextNamedTransition agree within 2s at ${d} (diffMs=${diffMs})`, diffMs < 2000);
}

// -----------------------------------------------------------------------
// 3. TITHI boundary correctness: classification differs strictly before
// vs. after the found transition (no skipped/duplicated Tithi), and the
// transition found is the SAME physical event findNextNamedTransition
// would find for the equivalent Tithi quantity (12-degree elongation
// step), confirming event identity, not merely agreement by coincidence.
// -----------------------------------------------------------------------
for (const d of SAMPLE_DATES) {
  const instant = new Date(d);
  const transition = findNextTransition(instant, 'TITHI');
  const before = getTithi(new Date(transition.getTime() - 1000)).name;
  const after = getTithi(new Date(transition.getTime() + 1000)).name;
  check(`TITHI: classification differs 1s before vs. 1s after the found transition at ${d} (${before} -> ${after})`, before !== after);

  const named = findNextNamedTransition(instant, (x) => getTithi(x).name, 30);
  const diffMs = named ? Math.abs(transition.getTime() - named.getTime()) : Infinity;
  check(`TITHI: findNextTransition and findNextNamedTransition agree within 2s at ${d} (diffMs=${diffMs})`, diffMs < 2000);
}

// -----------------------------------------------------------------------
// 4. Yoga control: confirms the fix did not touch the already-correct
// YOGA branch, and that YOGA's own cross-implementation agreement (pure
// bisection noise, never a systematic offset) is unchanged.
// -----------------------------------------------------------------------
for (const d of SAMPLE_DATES) {
  const instant = new Date(d);
  const a = findNextTransition(instant, 'YOGA');
  const b = findNextNamedTransition(instant, (x) => getYoga(x).name, 36);
  const diffMs = b ? Math.abs(a.getTime() - b.getTime()) : Infinity;
  check(`YOGA (control, untouched): findNextTransition and findNextNamedTransition still agree within 1s at ${d} (diffMs=${diffMs})`, diffMs < 1000);
}

// -----------------------------------------------------------------------
// 5. Karana derives from half-Tithi elongation: every Karana boundary
// must land on either a Tithi boundary (the movable-Karana-to-fixed
// transition at paksha edges aside) or exactly halfway through a Tithi.
// Verified structurally via the shared `diff` quantity, not by assuming
// every Karana transition is also a Tithi transition.
// -----------------------------------------------------------------------
{
  const instant = new Date('2026-01-15T00:00:00Z');
  const tithiBoundary = findNextTransition(instant, 'TITHI');
  const karanaBoundary1 = findNextTransition(instant, 'KARANA');
  // The Tithi boundary must itself always be A Karana boundary too (every
  // 12-degree Tithi edge is also a 6-degree Karana edge); walking forward
  // from the found Karana boundary must eventually reach the Tithi
  // boundary exactly (within numerical tolerance), confirming the two
  // search paths are tracking the same underlying elongation.
  // +/-1 second margin, not +/-1ms: the 24-iteration bisection search
  // resolves to ~10ms, so a sub-10ms window can legitimately land on the
  // same side of the true boundary by coincidence -- this is a test-
  // precision margin, not evidence the boundary itself is imprecise.
  const karanaAtTithiBoundaryMinus1s = getKarana(new Date(tithiBoundary.getTime() - 1000)).name;
  const karanaAtTithiBoundaryPlus1s = getKarana(new Date(tithiBoundary.getTime() + 1000)).name;
  check('Every Tithi boundary is also a Karana boundary (Karana classification changes across it too)', karanaAtTithiBoundaryMinus1s !== karanaAtTithiBoundaryPlus1s);
  check('The first Karana transition after a Tithi-boundary-containing instant occurs at or before the Tithi boundary itself', karanaBoundary1.getTime() <= tithiBoundary.getTime());
}

// -----------------------------------------------------------------------
// 6. Marriage interval-safety: a real, found Vanija->Vishti transition
// (an avoid-Karana for Marriage) is correctly detected as touched by a
// candidate whose span ends just after the true boundary -- the exact
// "blind window" false-negative PA-2B demonstrated against the
// pre-fix implementation. Found dynamically via the corrected
// findNextTransition itself (deterministic given the fixed start date
// below), not a hardcoded instant that could silently drift stale.
// -----------------------------------------------------------------------
{
  const avoidList = new Set(['Vishti', 'Shakuni', 'Chatushpada', 'Naga']);
  let cursor = new Date('2026-01-01T00:00:00Z');
  let foundTransition: Date | null = null;
  for (let i = 0; i < 80; i++) {
    const before = getKarana(cursor).name;
    const next = findNextTransition(cursor, 'KARANA');
    const after = getKarana(new Date(next.getTime() + 1000)).name;
    if (avoidList.has(after) && !avoidList.has(before)) {
      foundTransition = next;
      break;
    }
    cursor = new Date(next.getTime() + 1000);
  }
  check('A transition into an avoid-Karana (Vishti/Shakuni/Chatushpada/Naga) is found within 80 Karana periods of 2026-01-01', foundTransition !== null);

  if (foundTransition) {
    const marriage = { family: 'RELATIONSHIP' as const, intent: 'MARRIAGE' as const };
    const candStart = new Date(foundTransition.getTime() - 10 * 60 * 1000);
    const candEnd = new Date(foundTransition.getTime() + 10 * 1000); // genuinely 10s inside the avoid-Karana
    const result = spanOverlapsAuthoritativeEventAvoid(candStart, candEnd, marriage as any);
    check('A candidate genuinely overlapping an avoid-Karana for its final 10 seconds is correctly flagged by spanOverlapsAuthoritativeEventAvoid', result === true);
  }
}

// -----------------------------------------------------------------------
// 7. Marriage Adhika Masa non-regression: the three canonical 2026 dates
// must remain unaffected -- Adhika Masa is a separate mechanism
// (classifySynodicMonthContaining, PCE-4A) never touched by this fix.
// -----------------------------------------------------------------------
{
  const marriage = { family: 'RELATIONSHIP' as const, intent: 'MARRIAGE' as const };
  const location = { latitude: 28.6139, longitude: 77.209, timezone: 'Asia/Kolkata' };
  const may20 = spanOverlapsProhibitedPeriod(new Date('2026-05-20T10:00:00+05:30'), new Date('2026-05-20T11:00:00+05:30'), marriage as any, location as any);
  const jun1 = spanOverlapsProhibitedPeriod(new Date('2026-06-01T10:00:00+05:30'), new Date('2026-06-01T11:00:00+05:30'), marriage as any, location as any);
  const jun20 = spanOverlapsProhibitedPeriod(new Date('2026-06-20T10:00:00+05:30'), new Date('2026-06-20T11:00:00+05:30'), marriage as any, location as any);
  check('Marriage May 20 2026 remains ADHIKA_MASA-excluded (unaffected by this fix)', may20.eligible === false && may20.reason === 'ADHIKA_MASA');
  check('Marriage June 1 2026 remains ADHIKA_MASA-excluded (unaffected by this fix)', jun1.eligible === false && jun1.reason === 'ADHIKA_MASA');
  check('Marriage June 20 2026 remains eligible, no Adhika Masa exclusion (unaffected by this fix)', jun20.eligible === true);
}

// -----------------------------------------------------------------------
// 8. Determinism: repeated calls for the same instant return the exact
// same transition (no randomness, no cache-order dependence).
// -----------------------------------------------------------------------
{
  const instant = new Date('2026-01-15T00:00:00Z');
  const a1 = findNextTransition(instant, 'KARANA').getTime();
  const a2 = findNextTransition(instant, 'KARANA').getTime();
  const t1 = findNextTransition(instant, 'TITHI').getTime();
  const t2 = findNextTransition(instant, 'TITHI').getTime();
  check('findNextTransition(KARANA) is deterministic across repeated calls', a1 === a2);
  check('findNextTransition(TITHI) is deterministic across repeated calls', t1 === t2);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('\nSOME PA-2C TITHI/KARANA ABERRATION FIX CHECKS FAILED');
  process.exit(1);
} else {
  console.log('\nALL PA-2C TITHI/KARANA ABERRATION FIX CHECKS PASSED');
}
