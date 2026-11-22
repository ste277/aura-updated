// AURA-HPG-FIX-01 (V1-03) -- a user-entered activity title must survive
// Find a Time / Check a Time / Compare "Use this time" instead of being
// replaced by the engine's inferred activity-profile label ("Focused work").
//
// Staging repro (HPG5-V1): Check a Time "HPG5 missed test A" saved as
// "Focused work"; reschedule assessment for "HPG5 evening run" displayed
// "Workout". Root cause: planPayloadFromCandidate() always used
// candidate.metadata.activityType as the plan title.
import * as fs from 'fs';
import * as path from 'path';
import { planPayloadFromCandidate, resolveCandidatePlanTitle, findCandidateKey } from '../apps/web/lib/planFormatting';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const inferred: TimingCandidate = {
  start: '2026-11-21T13:01:00.000Z',
  end: '2026-11-21T13:16:00.000Z',
  score: 8.3,
  label: 'VERY_GOOD',
  muhurtaScore: 4,
  auraFitScore: 83,
  reasons: [{ code: 'NAKSHATRA_SUPPORTIVE', factor: 'NAKSHATRA', polarity: 'SUPPORT', impact: 8, value: 'Revati', params: { note: 'supports sustained focus' } }],
  metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'Focused work', dateLabel: 'Sat, Nov 21' },
};

// 1. The user's typed title is preserved.
const typed = planPayloadFromCandidate(inferred, 15, undefined, undefined, 'HPG5 missed test A');
check('typed title is the saved plan title (not the inferred "Focused work")', typed.title === 'HPG5 missed test A');
check('typed title is trimmed', planPayloadFromCandidate(inferred, 15, undefined, undefined, '  Evening run  ').title === 'Evening run');
check('Google Calendar link carries the typed title', (typed.googleCalendarUrl ?? '').includes(encodeURIComponent('HPG5 missed test A').replace(/%20/g, '+')) || (typed.googleCalendarUrl ?? '').includes('HPG5'));

// 2. Intentional default retained only when no title is supplied.
check('no title argument -> inferred label (unchanged legacy behaviour)', planPayloadFromCandidate(inferred, 15).title === 'Focused work');
check('blank title -> inferred label', planPayloadFromCandidate(inferred, 15, undefined, undefined, '').title === 'Focused work');
check('whitespace-only title -> inferred label', planPayloadFromCandidate(inferred, 15, undefined, undefined, '   ').title === 'Focused work');
check('null title -> inferred label', planPayloadFromCandidate(inferred, 15, undefined, undefined, null).title === 'Focused work');

// 3. Classification-derived fields are unchanged by a custom title.
const legacy = planPayloadFromCandidate(inferred, 15);
check('icon still follows the inferred classification', typed.icon === legacy.icon);
check('accent still follows the inferred classification', typed.accent === legacy.accent);
check('candidate key (dedupe identity) is unaffected by the typed title', typed.id === legacy.id && findCandidateKey(inferred) === findCandidateKey({ ...inferred }));
check('start/end/score/window unchanged', typed.plannedStartAt === legacy.plannedStartAt && typed.plannedEndAt === legacy.plannedEndAt && typed.score === legacy.score && typed.window === legacy.window);

// 4. Display helper.
check('resolveCandidatePlanTitle prefers the typed title', resolveCandidatePlanTitle(inferred, 'HPG5 evening run') === 'HPG5 evening run');
check('resolveCandidatePlanTitle falls back to the inferred label', resolveCandidatePlanTitle(inferred, '') === 'Focused work' && resolveCandidatePlanTitle(inferred) === 'Focused work');

// 5. Wiring: every user-facing save path and result card in Plan with Aura
// passes the user's own title (source-level guard so a future edit can't
// silently drop it again).
const viewSource = fs.readFileSync(path.join(__dirname, '../apps/web/components/PlanWithAuraView.tsx'), 'utf8');
check('Find a Time save passes taskTitle', viewSource.includes('planPayloadFromCandidate(candidate, durationMinutes, undefined, undefined, taskTitle)'));
check('Check a Time save passes checkTaskTitle', viewSource.includes('planPayloadFromCandidate(candidate, checkDurationMinutes, undefined, undefined, checkTaskTitle)'));
check('Check a Time "better nearby" save passes checkTaskTitle', viewSource.includes('planPayloadFromCandidate(checkResult.betterNearby!, checkDurationMinutes, undefined, undefined, checkTaskTitle)'));
check('Compare save passes compareTaskTitle', viewSource.includes('planPayloadFromCandidate(compareResult.candidates[0], compareDurationMinutes, undefined, undefined, compareTaskTitle)'));
check('no result card renders the raw inferred activityType as its title', !/activityTitle=\{[^}]*metadata\.activityType\}/.test(viewSource));
check('no Plan with Aura save path omits the user title', !/planPayloadFromCandidate\([^)]*Minutes\)\s*,/.test(viewSource));

if (!allPassed) {
  console.error('\nhpgFix01TitlePersistence: FAILED');
  process.exit(1);
}
console.log('\nhpgFix01TitlePersistence: all checks passed');
