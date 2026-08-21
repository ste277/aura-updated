// Run with: TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/planWithAuraViewLogic.test.ts
// (see .github/workflows/ci.yml). This file imports a .tsx component, so it
// needs `jsx` set and apps/web's node_modules (react) on the resolution
// path -- neither is true of the plain-Node root tsconfig.json, so this
// file is deliberately excluded from `tsc -p tsconfig.json`'s batch check
// (root tsconfig.json's `exclude`) even though it still lives in test/ like
// every other script here. ts-node itself still fully type-checks it (no
// transpileOnly) whenever it actually runs, so nothing here goes unchecked.
import {
  findCandidateKey,
  planPayloadFromCandidate,
  resolveActivitySelection,
  RESULT_LABEL_TEXT,
  toTimingPreference,
} from '../apps/web/components/PlanWithAuraView';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';
import { formatMuhurtaReason } from '../packages/muhurta/src/muhurtaReasonFormat';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennaiContext = {
  now: new Date(Date.UTC(2026, 7, 21, 4, 0, 0)),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

// ============================================================
// activityId vs taskTitle resolution (section 8)
// ============================================================

check('A known catalog activity (exact title match) resolves to activityId, not taskTitle', JSON.stringify(resolveActivitySelection('Deep Work')) === JSON.stringify({ activityId: 'deep-work' }));
check('A known catalog activity is matched case-insensitively', JSON.stringify(resolveActivitySelection('deep work')) === JSON.stringify({ activityId: 'deep-work' }));
check('A known catalog activity chip title ("Tea Break") resolves to its activityId', JSON.stringify(resolveActivitySelection('Tea Break')) === JSON.stringify({ activityId: 'tea-break' }));
check('Free text with no catalog match sends taskTitle, not activityId', JSON.stringify(resolveActivitySelection('organize my sock drawer')) === JSON.stringify({ taskTitle: 'organize my sock drawer' }));
check('Free text is trimmed before comparison/sending', JSON.stringify(resolveActivitySelection('  Deep Work  ')) === JSON.stringify({ activityId: 'deep-work' }));

// ============================================================
// Time preference mapping
// ============================================================

check('ANYTIME maps to ANY for the Timing Search API', toTimingPreference('ANYTIME') === 'ANY');
check('MORNING/AFTERNOON/EVENING/NIGHT pass through unchanged', toTimingPreference('MORNING') === 'MORNING' && toTimingPreference('AFTERNOON') === 'AFTERNOON' && toTimingPreference('EVENING') === 'EVENING' && toTimingPreference('NIGHT') === 'NIGHT');
check('WORK_HOURS (unreachable via this UI) falls back to ANY rather than being sent verbatim', toTimingPreference('WORK_HOURS') === 'ANY');

// ============================================================
// Result label mapping (section 11) -- must be exactly the engine's own
// TimingCandidateLabel values mapped to friendly copy, no second classifier.
// ============================================================

check('RESULT_LABEL_TEXT covers every TimingCandidateLabel with the brief\'s exact copy', RESULT_LABEL_TEXT.EXCELLENT === 'Excellent fit'
  && RESULT_LABEL_TEXT.VERY_GOOD === 'Very good'
  && RESULT_LABEL_TEXT.GOOD === 'Good'
  && RESULT_LABEL_TEXT.USABLE === 'Usable'
  && RESULT_LABEL_TEXT.CAUTION === 'Caution');

// ============================================================
// findCandidateKey / planPayloadFromCandidate (the "Use this time" save path)
// ============================================================

const sampleCandidateA: TimingCandidate = {
  start: '2026-08-22T13:30:00.000Z',
  end: '2026-08-22T15:30:00.000Z',
  score: 8.2,
  label: 'VERY_GOOD',
  muhurtaScore: 4,
  auraFitScore: 82,
  reasons: [
    { code: 'NAKSHATRA_SUPPORTIVE', factor: 'NAKSHATRA', polarity: 'SUPPORT', impact: 8, value: 'Rohini', params: { note: 'supports ease and connection' } },
    { code: 'TITHI_SUPPORTIVE', factor: 'TITHI', polarity: 'SUPPORT', impact: 5, value: 'Shukla Panchami' },
  ],
  metadata: { windowType: 'ABHIJIT', windowLabel: 'Abhijit Muhurta', activityType: 'Dating', dateLabel: 'Sat, Aug 22' },
};
const sampleCandidateB: TimingCandidate = { ...sampleCandidateA, start: '2026-08-21T13:30:00.000Z', end: '2026-08-21T15:30:00.000Z', metadata: { ...sampleCandidateA.metadata, dateLabel: 'Fri, Aug 21' } };

check('findCandidateKey differs for two distinct candidates', findCandidateKey(sampleCandidateA) !== findCandidateKey(sampleCandidateB));
check('findCandidateKey is stable for the same candidate', findCandidateKey(sampleCandidateA) === findCandidateKey({ ...sampleCandidateA }));

const planPayload = planPayloadFromCandidate(sampleCandidateA, 120);
check('planPayloadFromCandidate carries the activity title as the plan title', planPayload.title === 'Dating');
check('planPayloadFromCandidate carries the candidate\'s exact start/end instants', planPayload.plannedStartAt === sampleCandidateA.start && planPayload.plannedEndAt === sampleCandidateA.end);
check('planPayloadFromCandidate carries the candidate\'s windowLabel verbatim (so windowTypeFromLabel still resolves it)', planPayload.window === 'Abhijit Muhurta');
check('planPayloadFromCandidate\'s note uses the friendly RESULT_LABEL_TEXT, not the raw engine label', planPayload.note === 'Very good');
check('planPayloadFromCandidate rescales the 0-10 score back to the existing /100 plan-list convention', planPayload.score === 82);
check('planPayloadFromCandidate\'s details are built from the existing English formatter, not new prose', planPayload.details === sampleCandidateA.reasons.map((r) => formatMuhurtaReason(r)).join(' '));
check('planPayloadFromCandidate always produces a googleCalendarUrl', typeof planPayload.googleCalendarUrl === 'string' && planPayload.googleCalendarUrl!.includes('calendar.google.com'));

// ============================================================
// FIND renders multiple candidates / COMPARE ranks correctly --
// exercised through the real engine (runTimingSearch), which is exactly
// what the component calls via onTimingSearch. Manual browser verification
// (see PR completion report) additionally confirmed the rendered cards;
// this pins the data contract those cards are built from.
// ============================================================

const findResponse = runTimingSearch({
  mode: 'FIND',
  activityId: 'dating',
  durationMinutes: 120,
  horizon: 'SEVEN_DAYS',
  timePreference: 'EVENING',
  context: chennaiContext,
  limit: 3,
});
check('FIND returns multiple ranked candidates for the component to render as BEST MATCH + OTHER GOOD OPTIONS', findResponse.candidates.length > 1);
check('FIND candidates are pre-sorted descending, matching the component\'s "candidates[0] is best" assumption', findResponse.candidates.every((c, i) => i === 0 || findResponse.candidates[i - 1].score >= c.score));

const compareResponse = runTimingSearch({
  mode: 'COMPARE',
  activityId: 'dating',
  durationMinutes: 120,
  candidateStarts: ['2026-08-21T13:30:00.000Z', '2026-08-22T13:30:00.000Z'],
  context: chennaiContext,
});
check('COMPARE ranks the two supplied options so candidates[0] is the "Recommended" card and candidates[1] is "Compared With"', compareResponse.candidates.length === 2 && compareResponse.candidates[0].score >= compareResponse.candidates[1].score);

// CHECK's betterNearby: present only when a genuinely better option exists nearby.
const checkWithBetter = runTimingSearch({
  mode: 'CHECK',
  activityId: 'important-meeting-placeholder-does-not-exist',
  taskTitle: 'Important meeting',
  durationMinutes: 60,
  candidateStart: '2026-08-27T04:30:00.000Z',
  context: chennaiContext,
});
check('CHECK response always carries a requestedCandidate matching the exact requested instant (component renders it unconditionally)', checkWithBetter.requestedCandidate?.start === new Date('2026-08-27T04:30:00.000Z').toISOString());

const checkNoNearbySearch = runTimingSearch({
  mode: 'CHECK',
  taskTitle: 'Important meeting',
  durationMinutes: 60,
  candidateStart: '2026-08-27T04:30:00.000Z',
  checkNearbyWindowMinutes: 0,
  context: chennaiContext,
});
check('CHECK with checkNearbyWindowMinutes: 0 never returns betterNearby (component must not render the "Better Nearby" section)', checkNoNearbySearch.betterNearby === undefined);

console.log(allPassed ? '\nALL PLAN-WITH-AURA-VIEW LOGIC CHECKS PASSED' : '\nSOME PLAN-WITH-AURA-VIEW LOGIC CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
