import { evaluateMuhurta } from '../packages/muhurta/src/muhurtaEngine';
import { deriveLegacyMuhurtaText, formatMuhurtaReason } from '../packages/muhurta/src/muhurtaReasonFormat';
import { evaluateActivityFit, evaluatePersonalMuhurtaFit } from '../packages/recommendation/src/auraFitEngine';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { findOptimalTaskTimes } from '../packages/recommendation/src/dailyAssistant';

const chennaiContext = {
  now: new Date(Date.UTC(2026, 6, 28, 4, 0, 0)),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// Dates picked (via a small offline search over getPanchangaSnapshot) so the
// nakshatra on that day is, respectively, in DEEP_WORK's preferred and avoid
// lists -- deterministic, not flaky.
const supportiveNakshatraDate = new Date('2026-07-29T06:45:00.000Z'); // Shravana
const unfavorableNakshatraDate = new Date('2026-08-09T06:45:00.000Z'); // Ardra

// --- 1. Supportive Nakshatra produces a structured SUPPORT reason ---
const supportiveEval = evaluateMuhurta({ taskTitle: 'Deep Work', date: supportiveNakshatraDate, windowType: 'NEUTRAL', family: 'DEEP_WORK' });
const nakshatraSupportReason = supportiveEval.reasons.find((reason) => reason.code === 'NAKSHATRA_SUPPORTIVE');
check('Supportive nakshatra produces a NAKSHATRA_SUPPORTIVE reason', Boolean(nakshatraSupportReason));
check('NAKSHATRA_SUPPORTIVE reason is structured (factor NAKSHATRA, polarity SUPPORT, positive impact)', nakshatraSupportReason?.factor === 'NAKSHATRA' && nakshatraSupportReason?.polarity === 'SUPPORT' && (nakshatraSupportReason?.impact ?? 0) > 0);
check('NAKSHATRA_SUPPORTIVE reason carries the nakshatra name as value', nakshatraSupportReason?.value === 'Shravana');

// --- 2. Unfavorable Nakshatra produces CAUTION/BLOCK as appropriate ---
const unfavorableEval = evaluateMuhurta({ taskTitle: 'Deep Work', date: unfavorableNakshatraDate, windowType: 'NEUTRAL', family: 'DEEP_WORK' });
const nakshatraCautionReason = unfavorableEval.reasons.find((reason) => reason.code === 'NAKSHATRA_UNFAVORABLE');
check('Unfavorable nakshatra produces a NAKSHATRA_UNFAVORABLE reason', Boolean(nakshatraCautionReason));
check('NAKSHATRA_UNFAVORABLE reason is structured (factor NAKSHATRA, polarity CAUTION, negative impact)', nakshatraCautionReason?.factor === 'NAKSHATRA' && nakshatraCautionReason?.polarity === 'CAUTION' && (nakshatraCautionReason?.impact ?? 0) < 0);
check('NAKSHATRA_UNFAVORABLE reason carries the nakshatra name as value', nakshatraCautionReason?.value === 'Ardra');

// --- 3. Solar-window reasons are structured ---
const abhijitEval = evaluateMuhurta({ taskTitle: 'Deep Work', date: supportiveNakshatraDate, windowType: 'ABHIJIT', family: 'DEEP_WORK' });
const abhijitReason = abhijitEval.reasons.find((reason) => reason.code === 'ABHIJIT_SUPPORT');
check('Abhijit window produces a structured ABHIJIT_SUPPORT reason', abhijitReason?.factor === 'SOLAR_WINDOW' && abhijitReason?.polarity === 'SUPPORT' && abhijitReason?.value === 'ABHIJIT');

const rahuEval = evaluateMuhurta({ taskTitle: 'Deep Work', date: supportiveNakshatraDate, windowType: 'RAHU_KALAM', family: 'DEEP_WORK' });
const rahuReason = rahuEval.reasons.find((reason) => reason.code === 'RAHU_CAUTION');
check('Rahu Kalam produces a structured RAHU_CAUTION reason', rahuReason?.factor === 'SOLAR_WINDOW' && rahuReason?.polarity === 'CAUTION' && rahuReason?.value === 'RAHU_KALAM' && (rahuReason?.impact ?? 0) < 0);

const brahmaEval = evaluateMuhurta({ taskTitle: 'Deep Work', date: supportiveNakshatraDate, windowType: 'BRAHMA', family: 'DEEP_WORK' });
const brahmaReason = brahmaEval.reasons.find((reason) => reason.code === 'BRAHMA_SUPPORT');
check('Brahma window (DEEP_WORK family) produces a structured BRAHMA_SUPPORT reason', brahmaReason?.factor === 'SOLAR_WINDOW' && brahmaReason?.polarity === 'SUPPORT');

// --- 4. Existing English supports/blockers are still produced correctly ---
check('supports/blockers are derivable from reasons via the formatter and match evaluateMuhurta output exactly', (() => {
  const derived = deriveLegacyMuhurtaText(unfavorableEval.reasons);
  return JSON.stringify(derived.supports) === JSON.stringify(unfavorableEval.supports)
    && JSON.stringify(derived.blockers) === JSON.stringify(unfavorableEval.blockers)
    && derived.summary === unfavorableEval.summary;
})());
check('Nakshatra caution blocker reads as the original English sentence', unfavorableEval.blockers.some((text) => text === 'Ardra is less supportive for this activity'));
check('formatMuhurtaReason reproduces the same text found in supports[]', nakshatraSupportReason !== undefined && supportiveEval.supports.includes(formatMuhurtaReason(nakshatraSupportReason)));
check('Rahu Kalam explains the blocker (legacy wording preserved)', rahuEval.blockers.some((item) => item.includes('Rahu Kalam')));

// --- 5. Aura Fit scores remain stable for representative activities ---
// Pinned against the pre-refactor scoring engine (verified identical before
// and after this PR via a throwaway probe script comparing every window).
const auraFitDate = new Date(Date.UTC(2026, 6, 28, 6, 45, 0));
const AURA_FIT_BASELINE: Record<string, Partial<Record<'ABHIJIT' | 'BRAHMA' | 'GULIKA' | 'NEUTRAL' | 'RAHU_KALAM' | 'YAMA', number>>> = {
  'start-journey': { ABHIJIT: 76, BRAHMA: 60, GULIKA: 61, NEUTRAL: 49, RAHU_KALAM: 26, YAMA: 26 },
  'deep-work': { ABHIJIT: 75, BRAHMA: 74, GULIKA: 62, NEUTRAL: 61, RAHU_KALAM: 30, YAMA: 30 },
  'tea-break': { ABHIJIT: 76, BRAHMA: 70, GULIKA: 72, NEUTRAL: 62, RAHU_KALAM: 51, YAMA: 51 },
};
for (const title of ['I need to start my road trip', 'Deep Work', 'Tea break']) {
  const activity = findActivityIntent(title);
  if (!activity) { check(`${title} resolves to a catalog activity`, false); continue; }
  const expected = AURA_FIT_BASELINE[activity.id];
  for (const windowType of Object.keys(expected) as Array<keyof typeof expected>) {
    const fit = evaluateActivityFit({ activity, date: auraFitDate, windowType });
    check(`Aura Fit score for ${activity.id} in ${windowType} is unchanged by the reason refactor (${fit.score} === ${expected[windowType]})`, fit.score === expected[windowType]);
  }
}

// evaluateActivityFit's new `reasons` field is additive and does not disturb the score.
const journeyActivity = findActivityIntent('I need to start my road trip')!;
const journeyFit = evaluateActivityFit({ activity: journeyActivity, date: auraFitDate, windowType: 'ABHIJIT' });
check('evaluateActivityFit exposes structured reasons alongside the unchanged score', journeyFit.reasons.length > 0 && journeyFit.score === 76);
check('evaluateActivityFit reasons include the activity-rule reason for a recommended window', journeyFit.reasons.some((reason) => reason.code === 'ACTIVITY_RULE_SUPPORT' && reason.value === 'ABHIJIT'));

// Personal Tara Bala reasons: structured, and the derived summary matches the original prose shape.
const personalFit = evaluatePersonalMuhurtaFit(journeyActivity, auraFitDate, { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini', moonElement: 'FIRE' });
check('Personal Muhurta fit produces PERSONAL_TARA_* structured reasons', (personalFit.reasons ?? []).some((reason) => reason.code === 'PERSONAL_TARA_SUPPORT' || reason.code === 'PERSONAL_TARA_CAUTION'));
check('Personal Muhurta fit summary is still built from joined reason text', typeof personalFit.summary === 'string' && personalFit.summary!.includes('Tara is'));

// --- 6. Free-text planner behaviour remains unchanged ---
// "organize my expense filing" matches no catalog alias, so it must still go
// through classifyMuhurtaActivity()'s regex fallback (ADMIN family) exactly
// as before this refactor.
check('Free-text task without a catalog match still classifies via the regex fallback', findActivityIntent('organize my expense filing') === undefined);
const freeTextEval = evaluateMuhurta({ taskTitle: 'organize my expense filing', date: supportiveNakshatraDate, windowType: 'GULIKA' });
check('Free-text (fallback) classification still resolves to ADMIN family', freeTextEval.family === 'ADMIN');
check('Free-text (fallback) evaluation still produces a structured reasons array', Array.isArray(freeTextEval.reasons));
check('Free-text (fallback) evaluation still produces legacy supports/blockers/summary fields', typeof freeTextEval.summary === 'string' && Array.isArray(freeTextEval.supports) && Array.isArray(freeTextEval.blockers));

const freeTextPlan = findOptimalTaskTimes('organize my expense filing', chennaiContext, 30, 'TODAY', undefined, undefined, 'ANYTIME');
check('Free-text planner still returns usable planning options after the reason refactor', (freeTextPlan.planningOptions ?? []).length >= 1);

console.log(allPassed ? '\nALL MUHURTA REASON CHECKS PASSED' : '\nSOME MUHURTA REASON CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
