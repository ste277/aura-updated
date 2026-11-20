/**
 * AURA-HPG5-V2-I2 (R1-04) -- pure checks for presentProposedPlanOverlap /
 * formatPlanOverlapTime: both sides of a conflict, in the user's timezone.
 *
 *   npx ts-node test/hpg5I2ConflictPresentation.test.ts
 */
import { presentProposedPlanOverlap, presentPlanOverlap, formatPlanOverlapTime } from '../apps/web/lib/schedulingEligibilityPresentation';

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';
const proposed = { title: 'Workout', plannedStartAt: '2026-11-19T14:37:00.000Z', plannedEndAt: '2026-11-19T15:37:00.000Z' }; // 8:07-9:07 PM IST
const conflict = { title: 'Important meeting', plannedStartAt: '2026-11-19T15:00:00.000Z', plannedEndAt: '2026-11-19T15:30:00.000Z' }; // 8:30-9:00 PM IST

const p = presentProposedPlanOverlap(proposed, conflict, IST);
check('headline', p.headline === 'This time overlaps with another plan');
check('proposed line: title, date, start–end in IST', p.proposedLine === 'You’re trying to schedule Workout for Thu, Nov 19, 8:07 PM – 9:07 PM.');
check('conflict line: title, date, start–end in IST, nothing saved', p.conflictLine === 'It overlaps with “Important meeting” at Thu, Nov 19, 8:30 PM – 9:00 PM. Nothing was saved.');
check('detail = both lines', p.detail === `${p.proposedLine} ${p.conflictLine}`);
check('button text carries the exact proposed start time', p.saveAnywayText === 'Save anyway at 8:07 PM');
check('accessible name: proposed date/time, activity, conflicting plan', p.saveAnywayLabel === 'Save anyway at Thu, Nov 19, 8:07 PM – 9:07 PM: Workout, overlapping Important meeting');

const ny = presentProposedPlanOverlap(proposed, conflict, NY);
check('same instants rendered in America/New_York (9:37 AM EST)', ny.proposedLine === 'You’re trying to schedule Workout for Thu, Nov 19, 9:37 AM – 10:37 AM.' && ny.saveAnywayText === 'Save anyway at 9:37 AM');

// DST: 2027-03-14 spring-forward -- 01:30 EST and 03:30 EDT are 1 real hour apart
const dst = presentProposedPlanOverlap({ title: 'Run', plannedStartAt: '2027-03-14T06:30:00.000Z', plannedEndAt: '2027-03-14T07:30:00.000Z' }, null, NY);
check('DST day: 06:30Z–07:30Z shows 1:30 AM – 3:30 AM (clock jumps)', dst.proposedLine === 'You’re trying to schedule Run for Sun, Mar 14, 1:30 AM – 3:30 AM.');

// cross-midnight
const late = formatPlanOverlapTime({ plannedStartAt: '2026-11-19T18:00:00.000Z', plannedEndAt: '2026-11-19T19:30:00.000Z' }, IST); // 11:30 PM - 1:00 AM
check('cross-midnight range names the end date', late === 'Thu, Nov 19, 11:30 PM – Fri, Nov 20, 1:00 AM');
check('same-day range keeps the short form', formatPlanOverlapTime(conflict, IST) === 'Thu, Nov 19, 8:30 PM – 9:00 PM');

// no conflict details (plan vanished between check and describe)
const g = presentProposedPlanOverlap(proposed, null, IST);
check('no conflict details: still names the proposed time, generic existing line', g.proposedLine.includes('8:07 PM – 9:07 PM') && g.conflictLine === 'It overlaps with another plan on your schedule. Nothing was saved.' && g.saveAnywayLabel.endsWith('overlapping another plan'));

// I1 presenter unchanged (backward compatibility for any existing caller)
check('I1 presentPlanOverlap output unchanged', presentPlanOverlap(conflict, IST).saveAnywayLabel === 'Save anyway, overlapping Important meeting' && presentPlanOverlap(conflict, IST).detail === 'It overlaps “Important meeting” (Thu, Nov 19, 8:30 PM – 9:00 PM). Nothing was saved.');

console.log(`\n${count} checks`);
if (!allPassed) {
  console.log('SOME CHECKS FAILED');
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
