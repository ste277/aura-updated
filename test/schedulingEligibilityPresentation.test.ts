/**
 * HPG3-A3b -- regression suite for schedulingEligibilityPresentation.ts's
 * pure functions. No DOM, no React renderer, no DB -- same convention as
 * dayPlanAcceptancePresentation.test.ts/dayPlanPreviewPresentation.test.ts.
 */
import { isKnownSchedulingEligibilityCode, presentSchedulingEligibilityError, type SchedulingEligibilityPresentation } from '../apps/web/lib/schedulingEligibilityPresentation';
import type { SchedulingEligibilityErrorCode } from '../apps/web/lib/schedulingEligibilityError';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const ALL_CODES: SchedulingEligibilityErrorCode[] = ['GOAL_NOT_ACTIVE', 'CAPACITY_EXCEEDED', 'DAILY_CAPACITY_EXCEEDED', 'DAILY_ATTRIBUTION_UNRESOLVED', 'GOAL_ACTIVITY_NOT_AVAILABLE'];

// ============================================================
// isKnownSchedulingEligibilityCode -- never trusts an arbitrary value.
// ============================================================

check('1. every real code is recognized', ALL_CODES.every((code) => isKnownSchedulingEligibilityCode(code)));
check('2. an unrelated Move-only code (e.g. CONFLICT) is NOT recognized as a scheduling-eligibility code', !isKnownSchedulingEligibilityCode('CONFLICT'));
check('3. undefined is not recognized', !isKnownSchedulingEligibilityCode(undefined));
check('4. null is not recognized', !isKnownSchedulingEligibilityCode(null));
check('5. a non-string value is not recognized', !isKnownSchedulingEligibilityCode(42));
check('6. an empty string is not recognized', !isKnownSchedulingEligibilityCode(''));

// ============================================================
// presentSchedulingEligibilityError -- every code produces non-empty,
// non-technical copy; severity matches this ticket's own conflict/blocked
// split (sections 2/3/4 vs. the pre-A3a GOAL_NOT_ACTIVE/GOAL_ACTIVITY_NOT_AVAILABLE cases).
// ============================================================

check('7. every code produces a non-empty headline and detail, and echoes its own code back', ALL_CODES.every((code) => {
  const p: SchedulingEligibilityPresentation = presentSchedulingEligibilityError(code);
  return p.code === code && p.headline.length > 0 && p.detail.length > 0;
}));

check('8. the 3 genuine scheduling-conflict codes are severity "conflict"', (['CAPACITY_EXCEEDED', 'DAILY_CAPACITY_EXCEEDED', 'DAILY_ATTRIBUTION_UNRESOLVED'] as const).every((code) => presentSchedulingEligibilityError(code).severity === 'conflict'));
check('9. the 2 pre-A3a "blocked" codes are severity "blocked", never "conflict"', (['GOAL_NOT_ACTIVE', 'GOAL_ACTIVITY_NOT_AVAILABLE'] as const).every((code) => presentSchedulingEligibilityError(code).severity === 'blocked'));

check('10. DAILY_CAPACITY_EXCEEDED copy mentions "day", never implies a second session should just be created', (() => {
  const p = presentSchedulingEligibilityError('DAILY_CAPACITY_EXCEEDED');
  return /day/i.test(p.detail) && !/create (a )?(second|another|new) (session|plan)/i.test(p.detail);
})());

check('11. CAPACITY_EXCEEDED (weekly) copy mentions "week" and explicitly does NOT recommend trying a different time as the fix (this ticket\'s own section 3)', (() => {
  const p = presentSchedulingEligibilityError('CAPACITY_EXCEEDED');
  return /week/i.test(p.detail) && !/try a different time/i.test(p.detail) && !/pick(ing)? a different time will/i.test(p.detail);
})());

check('12. DAILY_ATTRIBUTION_UNRESOLVED copy explicitly says Aura cannot confirm/safely tell, and never claims to auto-retry or bypass (this ticket\'s own section 4)', (() => {
  const p = presentSchedulingEligibilityError('DAILY_ATTRIBUTION_UNRESOLVED');
  return /can.?t (safely )?confirm/i.test(p.detail) && !/retry/i.test(p.detail) && !/bypass/i.test(p.detail);
})());

check('13. GOAL_NOT_ACTIVE keeps the exact pre-A3b server message verbatim', presentSchedulingEligibilityError('GOAL_NOT_ACTIVE').detail === 'That goal is no longer active, so a new plan cannot be linked to it.');
check('14. GOAL_ACTIVITY_NOT_AVAILABLE keeps the exact pre-A3b server message verbatim', presentSchedulingEligibilityError('GOAL_ACTIVITY_NOT_AVAILABLE').detail === 'That goal activity is not available to link right now.');

check('15. no headline/detail leaks a raw code, a stack trace, or a DB-shaped term (never-leak-internals discipline, same as HPG3-A3a)', ALL_CODES.every((code) => {
  const p = presentSchedulingEligibilityError(code);
  const text = `${p.headline} ${p.detail}`;
  return !/CAPACITY_EXCEEDED|DAILY_CAPACITY_EXCEEDED|DAILY_ATTRIBUTION_UNRESOLVED|GOAL_NOT_ACTIVE|GOAL_ACTIVITY_NOT_AVAILABLE|SELECT |INSERT |UPDATE |stack|Error:/.test(text);
}));

if (!allPassed) {
  console.error('SOME SCHEDULING ELIGIBILITY PRESENTATION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL SCHEDULING ELIGIBILITY PRESENTATION CHECKS PASSED');
