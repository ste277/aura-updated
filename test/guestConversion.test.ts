/**
 * Recipient Conversion V1 -- pure-function tests for the guest search
 * validator (lib/guestTimingSearchRequest.ts) and the signed guest-state
 * token (lib/guestState.ts). No DB, no server -- see the completion report
 * for the live end-to-end browser + API walkthrough this doesn't repeat.
 */
import { buildGuestTimingSearchRequest } from '../apps/web/lib/guestTimingSearchRequest';
import { createGuestStateToken, verifyGuestStateToken, hashGuestConversionToken } from '../apps/web/lib/guestState';
import { sign } from '../apps/web/lib/auth';
import { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const context: DailyAssistantContext = {
  now: new Date('2026-08-23T10:00:00.000Z'),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

// ============================================================
// buildGuestTimingSearchRequest
// ============================================================
{
  const r = buildGuestTimingSearchRequest({ activityId: 'date-night', horizon: 'WEEKEND', durationMinutes: 90 }, context);
  check('A real EVERYDAY activity is accepted', r.ok);
  if (r.ok) {
    check('mode is always FIND', r.request.mode === 'FIND');
    check('limit is fixed at 3', r.request.limit === 3);
    check('context has no personalContext (GENERAL only)', r.request.context.personalContext === undefined);
  }
}
{
  const r = buildGuestTimingSearchRequest({ activityId: 'griha-pravesh', horizon: 'WEEKEND', durationMinutes: 90 }, context);
  check('A CEREMONIAL (Muhurtham-only) activity is rejected in guest V1', !r.ok);
}
{
  const r = buildGuestTimingSearchRequest({ horizon: 'WEEKEND', durationMinutes: 90 }, context);
  check('Missing activityId is rejected (no free-text fallback for guests)', !r.ok);
}
{
  const r = buildGuestTimingSearchRequest({ activityId: 'date-night', horizon: 'NOW', durationMinutes: 90 }, context);
  check('"NOW" horizon is rejected -- not in the guest-facing subset', !r.ok);
}
{
  const r = buildGuestTimingSearchRequest({ activityId: 'date-night', horizon: 'CUSTOM', durationMinutes: 90 }, context);
  check('"CUSTOM" horizon is rejected -- guests never get an open date range', !r.ok);
}
{
  const r = buildGuestTimingSearchRequest({ activityId: 'date-night', horizon: 'WEEKEND', durationMinutes: 10 }, context);
  check('durationMinutes below the guest minimum is rejected', !r.ok);
}
{
  const r = buildGuestTimingSearchRequest({ activityId: 'date-night', horizon: 'WEEKEND', durationMinutes: 500 }, context);
  check('durationMinutes above the guest maximum is rejected', !r.ok);
}
{
  const r = buildGuestTimingSearchRequest({ activityId: 'date-night', horizon: 'TODAY', durationMinutes: 60, limit: 50 }, context);
  check('A client-supplied limit is ignored -- always exactly 3', r.ok && r.request.limit === 3);
}

// ============================================================
// Guest state token (lib/guestState.ts)
// ============================================================
{
  const token = createGuestStateToken({
    activityId: 'date-night',
    horizon: 'WEEKEND',
    timePreference: 'EVENING',
    durationMinutes: 90,
    cityName: 'Chennai',
    candidateStart: '2026-08-29T11:30:00.000Z',
    candidateEnd: '2026-08-29T13:00:00.000Z',
    source: 'AURA_MOMENT',
  });
  const restored = verifyGuestStateToken(token);
  check('A freshly-minted token round-trips', restored?.activityId === 'date-night' && restored?.cityName === 'Chennai');

  const serialized = JSON.stringify(restored);
  const forbidden = ['ownerUserId', 'senderDisplayName', 'savedPersonId', 'birthDate', 'birthTime', 'birthTimezone', 'email', 'publicToken'];
  check('Privacy (brief section 19): no forbidden fields in the restored payload', forbidden.every((needle) => !serialized.toLowerCase().includes(needle.toLowerCase())));

  const tampered = token.slice(0, -2) + 'xx';
  check('A tampered token is rejected', verifyGuestStateToken(tampered) === null);

  check('Garbage input is rejected, not thrown', verifyGuestStateToken('not-a-real-token') === null);
}
{
  // brief section 25: expired guest state must fail closed, not throw.
  const expiredToken = sign({
    activityId: 'date-night',
    horizon: 'WEEKEND',
    timePreference: 'ANY',
    durationMinutes: 60,
    cityName: 'Chennai',
    candidateStart: '2020-01-01T00:00:00.000Z',
    candidateEnd: '2020-01-01T01:00:00.000Z',
    source: 'DIRECT',
    exp: Date.now() - 1000,
  });
  check('An expired guest-state token is rejected', verifyGuestStateToken(expiredToken) === null);
}

// ============================================================
// Recipient Conversion V1 Hardening -- hashGuestConversionToken
// (brief section 10/11)
// ============================================================
{
  const token = createGuestStateToken({
    activityId: 'date-night', horizon: 'WEEKEND', timePreference: 'EVENING', durationMinutes: 90,
    cityName: 'Chennai', candidateStart: '2026-08-29T11:30:00.000Z', candidateEnd: '2026-08-29T13:00:00.000Z', source: 'AURA_MOMENT',
  });
  check('Hashing the same token twice is stable', hashGuestConversionToken(token) === hashGuestConversionToken(token));

  const otherToken = createGuestStateToken({
    activityId: 'coffee-tea', horizon: 'TODAY', timePreference: 'ANY', durationMinutes: 45,
    cityName: 'Chennai', candidateStart: '2026-08-29T11:30:00.000Z', candidateEnd: '2026-08-29T12:15:00.000Z', source: 'DIRECT',
  });
  check('Two distinct tokens hash to distinct values', hashGuestConversionToken(token) !== hashGuestConversionToken(otherToken));
  check('The hash never contains the raw token substring (not just re-encoded)', !hashGuestConversionToken(token).includes(token.slice(0, 20)));
}

if (!allPassed) {
  console.error('\nSome guest conversion checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL GUEST CONVERSION CHECKS PASSED');
}
