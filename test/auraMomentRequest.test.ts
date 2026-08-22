import { buildAuraMomentCreateRequest, isValidMomentResponse } from '../apps/web/lib/auraMomentRequest';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const validGeneralBody = {
  scope: 'GENERAL',
  activityId: 'start-journey',
  startAt: '2026-10-18T04:42:00.000Z',
  endAt: '2026-10-18T05:42:00.000Z',
  ratingLabel: 'STRONG',
};

// ============================================================
// VALID REQUESTS
// ============================================================

const validResult = buildAuraMomentCreateRequest(validGeneralBody);
check('A valid GENERAL request is accepted', validResult.ok === true);
if (validResult.ok) {
  check('Parsed startAt/endAt are real Date objects', validResult.input.startAt instanceof Date && validResult.input.endAt instanceof Date);
  check('ratingLabel is carried through when recognized', validResult.input.ratingLabel === 'STRONG');
  check('savedPersonId is null for a non-SHARED scope even if never supplied', validResult.input.savedPersonId === null);
}

const validShared = buildAuraMomentCreateRequest({ ...validGeneralBody, scope: 'SHARED', ratingLabel: 'STRONG_SHARED_FIT', savedPersonId: 'person-123' });
check('A valid SHARED request with savedPersonId is accepted', validShared.ok === true && validShared.ok && validShared.input.savedPersonId === 'person-123');

const noRatingLabel = buildAuraMomentCreateRequest({ scope: 'GENERAL', activityId: 'start-journey', startAt: validGeneralBody.startAt, endAt: validGeneralBody.endAt });
check('ratingLabel is optional -- omitting it is accepted, resolves to null', noRatingLabel.ok === true && noRatingLabel.ok && noRatingLabel.input.ratingLabel === null);

// ============================================================
// SCOPE
// ============================================================

check('An invalid scope is rejected with 400', (() => {
  const r = buildAuraMomentCreateRequest({ ...validGeneralBody, scope: 'FOR_US' });
  return r.ok === false && r.status === 400;
})());
check('Missing scope is rejected', buildAuraMomentCreateRequest({ activityId: 'start-journey', startAt: validGeneralBody.startAt, endAt: validGeneralBody.endAt }).ok === false);

// ============================================================
// ACTIVITY (must reuse Muhurtham Finder's own eligibility, not a new list)
// ============================================================

check('An unsupported activityId is rejected', buildAuraMomentCreateRequest({ ...validGeneralBody, activityId: 'tea-break' }).ok === false);
check('A missing activityId is rejected', buildAuraMomentCreateRequest({ ...validGeneralBody, activityId: undefined }).ok === false);
check('An unknown activityId is rejected', buildAuraMomentCreateRequest({ ...validGeneralBody, activityId: 'not-a-real-activity' }).ok === false);

// ============================================================
// START/END
// ============================================================

check('A malformed startAt is rejected', buildAuraMomentCreateRequest({ ...validGeneralBody, startAt: 'not-a-date' }).ok === false);
check('A malformed endAt is rejected', buildAuraMomentCreateRequest({ ...validGeneralBody, endAt: 'not-a-date' }).ok === false);
check('endAt before startAt is rejected (negative duration)', buildAuraMomentCreateRequest({ ...validGeneralBody, startAt: '2026-10-18T10:00:00.000Z', endAt: '2026-10-18T09:00:00.000Z' }).ok === false);
check('A duration under 15 minutes is rejected', buildAuraMomentCreateRequest({ ...validGeneralBody, startAt: '2026-10-18T10:00:00.000Z', endAt: '2026-10-18T10:05:00.000Z' }).ok === false);
check('A duration over 360 minutes is rejected', buildAuraMomentCreateRequest({ ...validGeneralBody, startAt: '2026-10-18T10:00:00.000Z', endAt: '2026-10-18T17:00:00.000Z' }).ok === false);
check('A duration of exactly 15 minutes is accepted', buildAuraMomentCreateRequest({ ...validGeneralBody, startAt: '2026-10-18T10:00:00.000Z', endAt: '2026-10-18T10:15:00.000Z' }).ok === true);

// ============================================================
// RATING LABEL (closed vocabulary -- never arbitrary client text)
// ============================================================

check('An unrecognized ratingLabel string is rejected (not an open free-text field)', buildAuraMomentCreateRequest({ ...validGeneralBody, ratingLabel: '<script>alert(1)</script>' }).ok === false);
check('A ratingLabel from the wrong scope\'s vocabulary is still accepted (validated as a closed SET across all scopes, not scope-matched)', buildAuraMomentCreateRequest({ ...validGeneralBody, ratingLabel: 'MIXED_SHARED_FIT' }).ok === true);
check('A non-string ratingLabel is rejected', buildAuraMomentCreateRequest({ ...validGeneralBody, ratingLabel: 42 }).ok === false);

// ============================================================
// SAVED PERSON ID (required only for SHARED)
// ============================================================

check('SHARED scope without savedPersonId is rejected', buildAuraMomentCreateRequest({ ...validGeneralBody, scope: 'SHARED' }).ok === false);
check('SHARED scope with a blank savedPersonId is rejected', buildAuraMomentCreateRequest({ ...validGeneralBody, scope: 'SHARED', savedPersonId: '   ' }).ok === false);
check('PERSONAL scope never requires savedPersonId', buildAuraMomentCreateRequest({ ...validGeneralBody, scope: 'PERSONAL' }).ok === true);

// ============================================================
// RESPONSE VALUE VALIDATION (public endpoint's own gate)
// ============================================================

check('isValidMomentResponse accepts ACCEPTED', isValidMomentResponse('ACCEPTED') === true);
check('isValidMomentResponse accepts ANOTHER_TIME', isValidMomentResponse('ANOTHER_TIME') === true);
check('isValidMomentResponse rejects an arbitrary string', isValidMomentResponse('MAYBE_LATER') === false);
check('isValidMomentResponse rejects a non-string value', isValidMomentResponse(42) === false);
check('isValidMomentResponse rejects undefined', isValidMomentResponse(undefined) === false);
check('isValidMomentResponse rejects null', isValidMomentResponse(null) === false);

console.log(allPassed ? '\nALL AURA MOMENT REQUEST CHECKS PASSED' : '\nSOME AURA MOMENT REQUEST CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
