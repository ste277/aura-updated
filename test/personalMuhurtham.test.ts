import { findMuhurthams, findPersonalMuhurthams } from '../packages/recommendation/src/muhurthamFinder';
import { getTaraBala } from '../packages/vedic/src/natalChart';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const baseContext: DailyAssistantContext = {
  now: new Date('2026-08-21T04:00:00.000Z'),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

// A user whose natal nakshatra is Ashwini (index 1) -- used throughout.
const ashwiniPersonalContext = { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini' };

// ============================================================
// GENERAL: unaffected by personalContext, regardless of presence
// ============================================================

const generalNoPersonal = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-30' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 30,
  context: baseContext,
});
const generalWithPersonalInContext = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-30' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 30,
  context: { ...baseContext, personalContext: ashwiniPersonalContext },
});
check('GENERAL (findMuhurthams) produces byte-identical results whether or not context.personalContext happens to be present', JSON.stringify(generalNoPersonal.dates) === JSON.stringify(generalWithPersonalInContext.dates));
check('GENERAL returns a non-empty result (sanity)', generalNoPersonal.dates.length > 0);

// ============================================================
// PROFILE: incomplete vs complete
// ============================================================

const incompleteProfile = findPersonalMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-05' },
  context: baseContext, // no personalContext at all
});
check('PERSONAL with no personalContext returns a typed PERSONAL_PROFILE_INCOMPLETE state, not a silent GENERAL fallback', incompleteProfile.status === 'PERSONAL_PROFILE_INCOMPLETE');
check('PERSONAL_PROFILE_INCOMPLETE names the minimum required fields (birthDate/birthTime/birthTimezone only -- not lat/lng/Lagna/Navamsha)', incompleteProfile.status === 'PERSONAL_PROFILE_INCOMPLETE' && JSON.stringify(incompleteProfile.requiredFields) === JSON.stringify(['birthDate', 'birthTime', 'birthTimezone']));

const incompleteNakshatraOnly = findPersonalMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-05' },
  context: { ...baseContext, personalContext: { natalNakshatraIndex: undefined as unknown as number } },
});
check('PERSONAL with a personalContext object that lacks natalNakshatraIndex is still treated as incomplete', incompleteNakshatraOnly.status === 'PERSONAL_PROFILE_INCOMPLETE');

const completeProfile = findPersonalMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-30' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 30,
  context: { ...baseContext, personalContext: ashwiniPersonalContext },
});
check('PERSONAL with a complete profile returns status OK', completeProfile.status === 'OK');
check('PERSONAL scope field is always "PERSONAL"', completeProfile.scope === 'PERSONAL');

// ============================================================
// PERSONAL: structured evaluation, generalScore/personalScore/combinedScore
// ============================================================

if (completeProfile.status === 'OK') {
  check('Every PERSONAL date has generalScore/personalScore/combinedScore on the 0-10 scale', completeProfile.dates.every((d) =>
    d.generalScore >= 0 && d.generalScore <= 10 && d.personalScore >= 0 && d.personalScore <= 10 && d.combinedScore >= 0 && d.combinedScore <= 10
  ));
  check('combinedScore is the same value as bestWindow.score (the actual ranking key)', completeProfile.dates.every((d) => d.combinedScore === d.bestWindow.score));
  check('Every PERSONAL date carries a structured taraBala factor', completeProfile.dates.every((d) => Boolean(d.personalFactors.taraBala)));
  check('Every taraBala factor\'s tara name matches getTaraBala() called directly for that date (reused, not re-derived)', completeProfile.dates.every((d) => {
    const expected = getTaraBala(1, new Date(d.bestWindow.start));
    return d.personalFactors.taraBala?.tara === expected.name && d.personalFactors.taraBala?.status === (expected.favorable ? 'SUPPORT' : 'CAUTION');
  }));
  check('Provenance separates AURA_MUHURTA_V1 from AURA_PERSONAL_FIT_V1 (brief section 16 -- never merged)', completeProfile.provenance.muhurtaMethodology === 'AURA_MUHURTA_V1' && completeProfile.provenance.personalMethodology === 'AURA_PERSONAL_FIT_V1');
  check('Reasons include personal (Tara/element) reasons alongside general Panchanga reasons for at least one date', completeProfile.dates.some((d) => d.reasons.some((r) => r.factor === 'PERSONAL')));
}

// ============================================================
// Tara Bala affects the personal evaluation (SUPPORT and CAUTION both observed)
// ============================================================

if (completeProfile.status === 'OK') {
  const supportDates = completeProfile.dates.filter((d) => d.personalFactors.taraBala?.status === 'SUPPORT');
  const cautionDates = completeProfile.dates.filter((d) => d.personalFactors.taraBala?.status === 'CAUTION');
  check('Across a 30-day range, both SUPPORT and CAUTION Tara Bala states are observed (Tara genuinely varies by date)', supportDates.length > 0 && cautionDates.length > 0);
  check('A SUPPORT Tara Bala date scores personalScore=7.6 (favorable baseline, 76/10) for start-journey', supportDates.every((d) => d.personalScore === 7.6));
  check('A CAUTION Tara Bala date scores personalScore=4.0 (unfavorable baseline, 48/10, minus the high-importance penalty since start-journey requiresFreshStart) or 4.8 without it', cautionDates.every((d) => d.personalScore === 4.0 || d.personalScore === 4.8));
}

// ============================================================
// General hard block cannot be overridden by personal support, and
// personal caution cannot create a block that general didn't already have.
// ============================================================

if (completeProfile.status === 'OK') {
  check('No PERSONAL best/alternate window ever carries a FRICTION_WINDOW_BLOCKED conflict (hard blocks are personalContext-independent)', completeProfile.dates.every((d) => {
    const allWindows = [d.bestWindow, ...d.alternateWindows];
    return allWindows.every((w) => !w.conflicts?.some((c) => c.type === 'FRICTION_WINDOW_BLOCKED'));
  }));
}

// ============================================================
// PERSONALIZATION MUST RE-RANK -- regression fixture with a real, observed
// re-ranking between GENERAL and PERSONAL for the same activity/range/user.
// ============================================================

if (completeProfile.status === 'OK') {
  const generalOrderTop5 = [...generalNoPersonal.dates].sort((a, b) => b.score - a.score).slice(0, 5).map((d) => d.date);
  const personalOrderTop5 = [...completeProfile.dates].sort((a, b) => b.combinedScore - a.combinedScore).slice(0, 5).map((d) => d.date);
  check('PERSONAL re-ranks relative to GENERAL for the same activity/range/natal nakshatra (genuine re-ranking, not just a label change)', JSON.stringify(generalOrderTop5) !== JSON.stringify(personalOrderTop5));

  // Locked-in fixture: for start-journey, Sep 2026, Chennai, natal nakshatra
  // Ashwini (index 1), 2026-09-07 (Tara=Vadha/CAUTION) ranks BELOW
  // 2026-09-17 (Tara=Mitra/SUPPORT) in PERSONAL despite 09-07 having a
  // higher GENERAL score -- observed directly via probing, locked in here
  // as a regression fixture.
  const sep07 = completeProfile.dates.find((d) => d.date === '2026-09-07');
  const sep17 = completeProfile.dates.find((d) => d.date === '2026-09-17');
  const sep07General = generalNoPersonal.dates.find((d) => d.date === '2026-09-07');
  const sep17General = generalNoPersonal.dates.find((d) => d.date === '2026-09-17');
  check('Regression fixture: 2026-09-07 generally outscores 2026-09-17', Boolean(sep07General && sep17General && sep07General.score > sep17General.score));
  check('Regression fixture: PERSONAL flips this -- 2026-09-17 (Tara SUPPORT) outranks 2026-09-07 (Tara CAUTION) once personalized', Boolean(sep07 && sep17 && sep17.combinedScore > sep07.combinedScore));
}

console.log(allPassed ? '\nALL PERSONAL MUHURTHAM CHECKS PASSED' : '\nSOME PERSONAL MUHURTHAM CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
