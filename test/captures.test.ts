/**
 * Quick Capture V1 PR A -- pure domain tests (no database).
 */
import { deriveCaptureState, validateCaptureTitle, isActiveCaptureState, MAX_CAPTURE_TITLE_LENGTH, type LinkedPlanStatus } from '../apps/web/lib/captures';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const T = new Date('2026-09-24T10:00:00Z');
const d = (status: 'OPEN' | 'DISMISSED', completedAt: Date | null, linkedPlanStatus: LinkedPlanStatus | null) => deriveCaptureState({ status, completedAt, linkedPlanStatus });

check('OPEN / no link -> OPEN', d('OPEN', null, null) === 'OPEN');
check('OPEN / CANCELLED link -> OPEN (available again)', d('OPEN', null, 'CANCELLED') === 'OPEN');
check('OPEN / UPCOMING link -> PLANNED', d('OPEN', null, 'UPCOMING') === 'PLANNED');
check('OPEN / LOGGED link, completedAt materialized -> COMPLETED', d('OPEN', T, 'LOGGED') === 'COMPLETED');
check('OPEN / LOGGED link, completedAt NOT yet materialized (transitional) -> COMPLETED', d('OPEN', null, 'LOGGED') === 'COMPLETED');
check('OPEN / completedAt, no link (direct completion, or plan hard-deleted) -> COMPLETED', d('OPEN', T, null) === 'COMPLETED');
check('OPEN / completedAt / CANCELLED link -> COMPLETED', d('OPEN', T, 'CANCELLED') === 'COMPLETED');
check('completedAt beats an UPCOMING link -> COMPLETED', d('OPEN', T, 'UPCOMING') === 'COMPLETED');
check('DISMISSED / no completion -> DISMISSED', d('DISMISSED', null, null) === 'DISMISSED');
check('DISMISSED / completedAt -> DISMISSED (dismissal controls visibility; completion retained)', d('DISMISSED', T, null) === 'DISMISSED');
check('DISMISSED / UPCOMING -> DISMISSED', d('DISMISSED', null, 'UPCOMING') === 'DISMISSED');

check('active list = OPEN + PLANNED only', isActiveCaptureState('OPEN') && isActiveCaptureState('PLANNED') && !isActiveCaptureState('COMPLETED') && !isActiveCaptureState('DISMISSED'));

const v = (x: unknown) => validateCaptureTitle(x);
check('title is trimmed', (() => { const r = v('  Call John  '); return r.ok && r.title === 'Call John'; })());
check('empty title rejected', !v('').ok);
check('whitespace-only title rejected', !v('   \n\t ').ok);
check('non-string titles rejected', !v(undefined).ok && !v(null).ok && !v(42).ok && !v({}).ok && !v(['a']).ok);
check('title at the cap is accepted', v('a'.repeat(MAX_CAPTURE_TITLE_LENGTH)).ok);
check('title over the cap is rejected', !v('a'.repeat(MAX_CAPTURE_TITLE_LENGTH + 1)).ok);
check('the cap is 200 (no repo convention beyond the Goal title limit of 200)', MAX_CAPTURE_TITLE_LENGTH === 200);
check('title is never parsed: natural-language date stays verbatim', (() => { const r = v('Book dentist appointment tomorrow'); return r.ok && r.title === 'Book dentist appointment tomorrow'; })());
check('title is never parsed: "Go for a run" stays verbatim', (() => { const r = v('Go for a run'); return r.ok && r.title === 'Go for a run'; })());

if (!allPassed) {
  console.error('SOME CAPTURE DOMAIN CHECKS FAILED');
  process.exit(1);
}
console.log('ALL CAPTURE DOMAIN CHECKS PASSED');
