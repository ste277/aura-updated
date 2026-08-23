import { buildMomentPushPayload, buildPlanPushPayload } from '../apps/web/lib/pushPayload';
import type { AuraReminder } from '../apps/web/lib/auraReminders';
import type { AuraMoment } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function fakePlanReminder(overrides: Partial<AuraReminder> = {}): AuraReminder {
  return {
    id: 'PLANNED_ACTIVITY:plan-1',
    type: 'PLAN_APPROACHING',
    scheduledItemType: 'PLANNED_ACTIVITY',
    scheduledItemId: 'plan-1',
    activityTitle: 'Deep Work',
    activityIcon: '🧠',
    startAt: '2026-08-23T10:30:00.000Z',
    endAt: '2026-08-23T11:30:00.000Z',
    timezone: 'Asia/Kolkata',
    reminderAt: '2026-08-23T10:15:00.000Z',
    minutesUntilStart: 15,
    target: { type: 'PLAN', planId: 'plan-1' },
    ...overrides,
  };
}

function fakeMomentReminder(overrides: Partial<AuraReminder> = {}): AuraReminder {
  return {
    id: 'AURA_MOMENT:moment-1',
    type: 'MOMENT_APPROACHING',
    scheduledItemType: 'AURA_MOMENT',
    scheduledItemId: 'moment-1',
    activityTitle: 'Date Night',
    activityIcon: '❤️',
    startAt: '2026-08-23T10:30:00.000Z',
    endAt: '2026-08-23T11:30:00.000Z',
    timezone: 'Asia/Kolkata',
    reminderAt: '2026-08-23T10:15:00.000Z',
    minutesUntilStart: 15,
    target: { type: 'MOMENT', momentToken: 'tok-1' },
    ...overrides,
  };
}

function fakeMoment(overrides: Partial<AuraMoment> = {}): AuraMoment {
  return {
    id: 'moment-1', ownerUserId: 'owner-1', publicToken: 'tok-1', scope: 'SHARED', source: 'MUHURTHAM',
    activityId: 'date-night', activityTitle: 'Date Night', activityIcon: '❤️',
    startAt: new Date('2026-08-23T10:30:00.000Z'), endAt: new Date('2026-08-23T11:30:00.000Z'),
    timezone: 'Asia/Kolkata', savedPersonId: 'person-1', sharedPersonDisplayName: 'Anna', senderDisplayName: 'Stephen',
    ratingLabel: 'STRONG_SHARED_FIT', explanationSnapshot: 'x', status: 'ACTIVE', responseState: null,
    responsePreference: null, respondedAt: null, previousMomentId: null, plannedActivityId: null,
    ownerSeenResponseAt: null, firstOpenedAt: null, createdAt: new Date(), expiresAt: null,
    ...overrides,
  };
}

// ============================================================
// PLAN copy (brief section 13) -- restrained, generic (no catalog link
// exists for PlannedActivity to personalize further).
// ============================================================

{
  const payload = buildPlanPushPayload(fakePlanReminder());
  check('PLAN title includes icon, activity title, and lead minutes', payload.title === '🧠 Deep Work starts in 15 min');
  check('PLAN body is the restrained generic copy', payload.body === 'Your planned activity is coming up.');
  check('PLAN payload target matches the reminder\'s own target', payload.target.type === 'PLAN' && (payload.target as { planId: string }).planId === 'plan-1');
}

{
  const payload = buildPlanPushPayload(fakePlanReminder({ activityIcon: null }));
  check('PLAN falls back to a generic bell icon when the activity has none', payload.title.startsWith('🔔'));
}

// ============================================================
// MOMENT copy (brief section 14) -- response-aware.
// ============================================================

{
  const payload = buildMomentPushPayload(fakeMomentReminder({ momentResponseState: 'ACCEPTED' }), fakeMoment({ responseState: 'ACCEPTED' }));
  check('An ACCEPTED shared Moment gets "You\'re both in." -- never claims confirmation otherwise', payload.body === "You're both in.");
}

{
  const payload = buildMomentPushPayload(fakeMomentReminder({ momentResponseState: null }), fakeMoment({ responseState: null }));
  check('A waiting-response shared Moment gets "Your shared moment is coming up." (no false confirmation)', payload.body === 'Your shared moment is coming up.');
}

{
  const payload = buildMomentPushPayload(
    fakeMomentReminder({ momentResponseState: null, activityTitle: 'Meditation', activityIcon: '✨' }),
    fakeMoment({ scope: 'PERSONAL', savedPersonId: null, sharedPersonDisplayName: null, activityId: 'tea-break', responseState: null })
  );
  check('A GENERAL/PERSONAL Moment gets the generic "Your Aura Moment is coming up." (no participant assumed)', payload.body === 'Your Aura Moment is coming up.');
}

// ============================================================
// Muhurtham/ceremonial copy (brief section 15) -- restrained, never dumps
// Tithi/Nakshatra/Tara Bala/score/reasoning.
// ============================================================

{
  const payload = buildMomentPushPayload(
    fakeMomentReminder({ activityTitle: 'Griha Pravesh', activityIcon: '🏡', momentResponseState: 'ACCEPTED' }),
    fakeMoment({ activityId: 'griha-pravesh', activityTitle: 'Griha Pravesh', responseState: 'ACCEPTED' })
  );
  check(
    'A CEREMONIAL occasion (Griha Pravesh) gets the restrained Muhurtham copy, NOT the ACCEPTED "You\'re both in." (ceremonial check wins)',
    payload.body === 'Your selected Muhurtham is coming up.'
  );
  check('Ceremonial copy never mentions Tithi/Nakshatra/Tara/score/reasoning', !/tithi|nakshatra|tara|score|reason/i.test(payload.body));
}

// ============================================================
// Privacy (brief section 12/33/43) -- the payload NEVER carries sensitive
// fields, regardless of what's on the underlying rows.
// ============================================================

{
  const richMoment = fakeMoment({
    savedPersonId: 'saved-person-internal-id-should-never-appear',
    sharedPersonDisplayName: 'Anna',
    senderDisplayName: 'Stephen',
    ownerUserId: 'owner-internal-id-should-never-appear',
    publicToken: 'public-token-should-never-appear',
  });
  const payload = buildMomentPushPayload(fakeMomentReminder(), richMoment);
  const serialized = JSON.stringify(payload);
  const forbidden = [
    'saved-person-internal-id-should-never-appear',
    'owner-internal-id-should-never-appear',
    'public-token-should-never-appear',
    'Anna', // participant display name -- brief's own examples never name the participant
    'Stephen',
    'birthDate', 'birthTime', 'birthTimezone', 'janmaRashi', 'nakshatra', 'tara',
  ];
  check('The push payload never contains any birth/natal/person/token field or value', forbidden.every((needle) => !serialized.includes(needle)));
  check('The push payload has exactly the expected safe keys, nothing extra', Object.keys(payload).sort().join(',') === ['title', 'body', 'target', 'scheduledItemType', 'scheduledItemId', 'reminderAt'].sort().join(','));
}

if (!allPassed) {
  console.error('\nSome push payload checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL PUSH PAYLOAD CHECKS PASSED');
}
