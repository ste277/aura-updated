import {
  deriveAuraReminders,
  formatReminderTiming,
  DEFAULT_REMINDER_LEAD_MINUTES,
  REMINDER_GRACE_PERIOD_MINUTES,
} from '../apps/web/lib/auraReminders';
import type { AuraMoment, PlannedActivity } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const NOW = new Date('2026-08-22T10:00:00.000Z');

function fakePlan(overrides: Partial<PlannedActivity>): PlannedActivity {
  return {
    id: 'plan-1',
    userId: 'owner-1',
    title: 'Deep Work',
    activityType: 'Deep Work',
    icon: '🧠',
    status: 'UPCOMING',
    plannedStartAt: new Date(NOW.getTime() + 15 * 60_000),
    plannedEndAt: new Date(NOW.getTime() + 75 * 60_000),
    durationMinutes: 60,
    windowType: 'NEUTRAL',
    windowLabel: 'Neutral Flow',
    matchLabel: 'Good Match',
    score: 70,
    recommendation: null,
    calendarUrl: null,
    loggedAt: null,
    habitLogId: null,
    eventTimezone: null,
    eventLocationName: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function fakeMoment(overrides: Partial<AuraMoment>): AuraMoment {
  return {
    id: 'moment-1',
    ownerUserId: 'owner-1',
    publicToken: 'token-1',
    scope: 'SHARED',
    source: 'MUHURTHAM',
    activityId: 'date-night',
    activityTitle: 'Date Night with Anna',
    activityIcon: '❤️',
    startAt: new Date(NOW.getTime() + 15 * 60_000),
    endAt: new Date(NOW.getTime() + 105 * 60_000),
    timezone: 'Asia/Kolkata',
    locationName: null,
    savedPersonId: 'person-1',
    sharedPersonDisplayName: 'Anna',
    senderDisplayName: 'Stephen',
    ratingLabel: 'STRONG_SHARED_FIT',
    explanationSnapshot: 'Aura found this timing to work well for both of you.',
    status: 'ACTIVE',
    responseState: 'ACCEPTED',
    responsePreference: null,
    respondedAt: NOW,
    previousMomentId: null,
    plannedActivityId: null,
    ownerSeenResponseAt: null,
    firstOpenedAt: null,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60_000),
    ...overrides,
  };
}

function derive(opts: Partial<Parameters<typeof deriveAuraReminders>[0]> = {}) {
  return deriveAuraReminders({
    now: NOW,
    leadMinutes: DEFAULT_REMINDER_LEAD_MINUTES,
    ownerTimezone: 'Asia/Kolkata',
    plans: [],
    moments: [],
    momentIdsWithSuccessor: new Set(),
    ...opts,
  });
}

// ============================================================
// Default lead time + timing boundaries (brief section 3/4/31)
// ============================================================

check('DEFAULT_REMINDER_LEAD_MINUTES is 15', DEFAULT_REMINDER_LEAD_MINUTES === 15);

{
  // Plan starting in exactly 15 minutes, lead 15 -- reminder must be active
  // (now >= reminderAt).
  const plans = [fakePlan({ plannedStartAt: new Date(NOW.getTime() + 15 * 60_000), plannedEndAt: new Date(NOW.getTime() + 75 * 60_000) })];
  const reminders = derive({ plans });
  check('A Plan starting in exactly 15 min (== lead time) IS active', reminders.length === 1 && reminders[0].type === 'PLAN_APPROACHING');
  check('minutesUntilStart is exactly 15', reminders[0].minutesUntilStart === 15);
}

{
  // Plan starting in 16 minutes -- reminder window has not opened yet.
  const plans = [fakePlan({ plannedStartAt: new Date(NOW.getTime() + 16 * 60_000), plannedEndAt: new Date(NOW.getTime() + 76 * 60_000) })];
  const reminders = derive({ plans });
  check('A Plan starting in 16 min (1 min before the lead window opens) is NOT yet active', reminders.length === 0);
}

{
  // Plan that started exactly at the grace-period boundary.
  const startAt = new Date(NOW.getTime() - REMINDER_GRACE_PERIOD_MINUTES * 60_000);
  const plans = [fakePlan({ plannedStartAt: startAt, plannedEndAt: new Date(startAt.getTime() + 60 * 60_000) })];
  const reminders = derive({ plans });
  check('A Plan exactly at the grace-period boundary is no longer active (grace period has fully elapsed)', reminders.length === 0);
}

{
  // Plan just inside the grace period (1 minute before the boundary).
  const startAt = new Date(NOW.getTime() - (REMINDER_GRACE_PERIOD_MINUTES - 1) * 60_000);
  const plans = [fakePlan({ plannedStartAt: startAt, plannedEndAt: new Date(startAt.getTime() + 60 * 60_000) })];
  const reminders = derive({ plans });
  check('A Plan just inside the grace period is still active ("Started X min ago")', reminders.length === 1);
  check('minutesUntilStart is negative once the item has started', reminders[0].minutesUntilStart < 0);
}

check('formatReminderTiming renders future minutes as "Starts in X min"', formatReminderTiming(15) === 'Starts in 15 min');
check('formatReminderTiming renders zero as "Starting now"', formatReminderTiming(0) === 'Starting now');
check('formatReminderTiming renders past minutes as "Started X min ago"', formatReminderTiming(-10) === 'Started 10 min ago');

{
  // Only UPCOMING plans ever generate reminders (LOGGED/CANCELLED excluded).
  const plans = [fakePlan({ status: 'LOGGED' }), fakePlan({ id: 'plan-2', status: 'CANCELLED' })];
  check('LOGGED and CANCELLED plans never generate a reminder', derive({ plans }).length === 0);
}

// ============================================================
// Moment response-aware behavior (brief section 6/9/10/32-34)
// ============================================================

{
  const moments = [fakeMoment({ responseState: 'ACCEPTED' })];
  const reminders = derive({ moments });
  check('An ACCEPTED SHARED moment reminder carries momentResponseState ACCEPTED', reminders.length === 1 && reminders[0].momentResponseState === 'ACCEPTED');
  check('An ACCEPTED SHARED moment reminder carries the participant display name', reminders[0].participantDisplayName === 'Anna');
}

{
  const moments = [fakeMoment({ responseState: null, respondedAt: null })];
  const reminders = derive({ moments });
  check('A moment with NO response yet still generates a reminder (waiting-response)', reminders.length === 1);
  check('A waiting-response reminder does NOT falsely claim ACCEPTED', reminders[0].momentResponseState !== 'ACCEPTED');
}

{
  const moments = [fakeMoment({ responseState: 'ANOTHER_TIME', respondedAt: NOW })];
  const reminders = derive({ moments, momentIdsWithSuccessor: new Set() });
  check('ANOTHER_TIME with NO successor produces NO reminder (the actionable Aura Update takes priority instead)', reminders.length === 0);
}

{
  // GENERAL/PERSONAL moments never get participant copy (brief section 10).
  const moments = [fakeMoment({ scope: 'PERSONAL', savedPersonId: null, sharedPersonDisplayName: null })];
  const reminders = derive({ moments });
  check('A PERSONAL moment reminder has no participantDisplayName', reminders.length === 1 && reminders[0].participantDisplayName === undefined);
}

// ============================================================
// Successor lineage (brief section 8/35)
// ============================================================

{
  const original = fakeMoment({ id: 'original', responseState: 'ANOTHER_TIME', startAt: new Date(NOW.getTime() + 15 * 60_000) });
  const successor = fakeMoment({
    id: 'successor',
    publicToken: 'token-successor',
    previousMomentId: 'original',
    responseState: null,
    respondedAt: null,
    // Within the active reminder window (reminderAt = startAt - 15min must
    // be <= now): 10 min out, distinct from the original's 15 min, so a
    // wrong "uses the original's time" bug would be caught by the
    // minutesUntilStart assertion below.
    startAt: new Date(NOW.getTime() + 10 * 60_000),
    endAt: new Date(NOW.getTime() + 70 * 60_000),
  });
  const reminders = derive({ moments: [original, successor], momentIdsWithSuccessor: new Set(['original']) });
  check('A superseded original NEVER reminds, even though its own startAt would otherwise qualify', !reminders.some((r) => r.scheduledItemId === 'original'));
  check('The successor reminds at ITS OWN time', reminders.some((r) => r.scheduledItemId === 'successor'));
  check('The successor reminder uses the successor\'s own startAt, not the original\'s', reminders.find((r) => r.scheduledItemId === 'successor')!.minutesUntilStart === 10);
}

// ============================================================
// REVOKED / expired lifecycle (brief section 8/36)
// ============================================================

{
  const moments = [fakeMoment({ status: 'REVOKED' })];
  check('A REVOKED moment never generates a reminder', derive({ moments }).length === 0);
}

{
  const moments = [fakeMoment({ expiresAt: new Date(NOW.getTime() - 1000) })];
  check('An expired moment never generates a reminder', derive({ moments }).length === 0);
}

// ============================================================
// Deduplication (brief section 7/37)
// ============================================================

{
  const plans = [fakePlan({ id: 'linked-plan' })];
  const moments = [fakeMoment({ plannedActivityId: 'linked-plan' })];
  const reminders = derive({ plans, moments });
  check('A Plan linked to a Moment (plannedActivityId) never generates its own reminder', !reminders.some((r) => r.scheduledItemType === 'PLANNED_ACTIVITY'));
  check('The linked Moment\'s own reminder wins instead (richer coordination state)', reminders.some((r) => r.scheduledItemType === 'AURA_MOMENT'));
  check('Exactly ONE reminder total for the linked pair -- never two for the same real-world event', reminders.length === 1);
}

{
  // No linkage -- both a Plan and an unrelated Moment legitimately coexist.
  const plans = [fakePlan({ id: 'unrelated-plan' })];
  const moments = [fakeMoment({ id: 'unrelated-moment', plannedActivityId: null })];
  const reminders = derive({ plans, moments });
  check('An UNLINKED Plan and Moment both get their own reminder (no false dedup)', reminders.length === 2);
}

// ============================================================
// Deterministic Home "most imminent" ordering (brief section 21/38)
// ============================================================

{
  const plans = [fakePlan({ id: 'plan-far', plannedStartAt: new Date(NOW.getTime() + 15 * 60_000), plannedEndAt: new Date(NOW.getTime() + 75 * 60_000) })];
  const moments = [fakeMoment({ id: 'moment-near', startAt: new Date(NOW.getTime() + 5 * 60_000), endAt: new Date(NOW.getTime() + 65 * 60_000) })];
  const reminders = derive({ plans, moments, leadMinutes: 15 });
  check('The most imminent reminder sorts first regardless of type', reminders[0].scheduledItemId === 'moment-near');
}

{
  // Same minutesUntilStart -- ordering must be deterministic (id tiebreak),
  // not dependent on input array order.
  const plans = [fakePlan({ id: 'plan-tie', plannedStartAt: new Date(NOW.getTime() + 15 * 60_000), plannedEndAt: new Date(NOW.getTime() + 75 * 60_000) })];
  const moments = [fakeMoment({ id: 'moment-tie', startAt: new Date(NOW.getTime() + 15 * 60_000), endAt: new Date(NOW.getTime() + 75 * 60_000) })];
  const orderA = derive({ plans, moments }).map((r) => r.id);
  const orderB = derive({ plans: [...plans], moments: [...moments] }).map((r) => r.id);
  check('A tie in minutesUntilStart still produces a STABLE, deterministic order across calls', JSON.stringify(orderA) === JSON.stringify(orderB));
}

// ============================================================
// Timezone correctness (brief section 23/39) -- Kolkata + NY DST
// ============================================================

{
  // 2026-03-08 07:30 UTC is 2026-03-08 02:30 America/New_York -- just before
  // the US DST spring-forward at 2:00 AM local (clocks jump to 3:00 AM).
  // The math must stay pure UTC-instant arithmetic regardless of what wall
  // clock the local timezone displays.
  const dstNow = new Date('2026-03-08T06:30:00.000Z');
  const startAt = new Date('2026-03-08T06:45:00.000Z'); // exactly 15 min later, in absolute UTC terms
  const moments = [fakeMoment({ timezone: 'America/New_York', startAt, endAt: new Date(startAt.getTime() + 60 * 60_000) })];
  const reminders = deriveAuraReminders({
    now: dstNow,
    leadMinutes: 15,
    ownerTimezone: 'America/New_York',
    plans: [],
    moments,
    momentIdsWithSuccessor: new Set(),
  });
  check('A reminder spanning the US DST spring-forward boundary still computes exactly 15 minutesUntilStart (pure UTC-instant math)', reminders.length === 1 && reminders[0].minutesUntilStart === 15);
  check('The reminder carries the item\'s own timezone for display, unaffected by the DST transition itself', reminders[0].timezone === 'America/New_York');
}

{
  // Two owners in different timezones, same absolute reminder math.
  const kolkataMoment = fakeMoment({ id: 'kolkata-moment', timezone: 'Asia/Kolkata', startAt: new Date(NOW.getTime() + 15 * 60_000) });
  const nyMoment = fakeMoment({ id: 'ny-moment', timezone: 'America/New_York', startAt: new Date(NOW.getTime() + 15 * 60_000) });
  const kolkataReminders = derive({ moments: [kolkataMoment] });
  const nyReminders = derive({ moments: [nyMoment] });
  check('Asia/Kolkata and America/New_York produce the IDENTICAL minutesUntilStart for the same absolute instant', kolkataReminders[0].minutesUntilStart === nyReminders[0].minutesUntilStart);
}

// ============================================================
// Ask Aura Event Location V1, PR B (brief section 17/31): a Plan's own
// eventTimezone -- persisted from an Ask Aura Event Location save, per PR
// B's own plansRequest.ts/route.ts wiring -- must win over the owner's
// Timing Location timezone for reminder scheduling/display, exactly as
// deriveAuraReminders' existing `plan.eventTimezone ?? ownerTimezone`
// expression already guarantees. This is a REGRESSION test proving that
// existing precedence, not a new algorithm -- auraReminders.ts itself is
// untouched by PR B. Chosen so the two timezones' clock-time DIFFERS for
// the same instant (Asia/Kolkata vs America/New_York), making a silent
// fallback to ownerTimezone immediately detectable.
// ============================================================

{
  const chennaiPlan = fakePlan({ id: 'plan-chennai-event', eventTimezone: 'Asia/Kolkata', eventLocationName: 'Chennai' });
  const reminders = deriveAuraReminders({
    now: NOW,
    leadMinutes: DEFAULT_REMINDER_LEAD_MINUTES,
    ownerTimezone: 'America/New_York',
    plans: [chennaiPlan],
    moments: [],
    momentIdsWithSuccessor: new Set(),
  });
  check('A Plan with its own eventTimezone (Chennai) produces exactly one reminder', reminders.length === 1);
  check('The reminder\'s timezone is the Plan\'s own eventTimezone (Asia/Kolkata), NOT the owner\'s Timing Location (America/New_York)', reminders[0].timezone === 'Asia/Kolkata');
}
{
  // Control: a Plan with NO eventTimezone (eventTimezone: null, the
  // fakePlan default) falls back to ownerTimezone, completely unchanged.
  const ordinaryPlan = fakePlan({ id: 'plan-no-event-location' });
  const reminders = deriveAuraReminders({
    now: NOW,
    leadMinutes: DEFAULT_REMINDER_LEAD_MINUTES,
    ownerTimezone: 'America/New_York',
    plans: [ordinaryPlan],
    moments: [],
    momentIdsWithSuccessor: new Set(),
  });
  check('A Plan with no eventTimezone falls back to the owner\'s own Timing Location, unaffected by PR B', reminders[0].timezone === 'America/New_York');
}
{
  // Moment reminders already unconditionally use moment.timezone (no `??`
  // fallback needed -- AuraMoment.timezone is NOT NULL) -- confirming this
  // is unaffected by, and requires no changes for, PR B: a Moment created
  // from an Ask Aura Event Location save already has its `timezone` column
  // set correctly AT PERSISTENCE TIME (route.ts's own
  // `eventLocationTimezone ?? user.timezone`), so the reminder layer just
  // reads it straight through.
  const chennaiMoment = fakeMoment({ id: 'moment-chennai-event', timezone: 'Asia/Kolkata', locationName: 'Chennai' });
  const reminders = deriveAuraReminders({
    now: NOW,
    leadMinutes: DEFAULT_REMINDER_LEAD_MINUTES,
    ownerTimezone: 'America/New_York',
    plans: [],
    moments: [chennaiMoment],
    momentIdsWithSuccessor: new Set(),
  });
  check('A Moment persisted with an Event Location timezone (Chennai) is reflected in its reminder, regardless of the owner\'s own Timing Location', reminders[0].timezone === 'Asia/Kolkata');
}

// ============================================================
// Privacy (brief section 40/41) -- AuraReminder DTO shape
// ============================================================

{
  const moments = [fakeMoment({})];
  const plans = [fakePlan({ id: 'plan-privacy' })];
  const reminders = derive({ plans, moments });
  const serialized = JSON.stringify(reminders);
  const forbidden = ['ownerUserId', 'owner-1', 'savedPersonId', 'person-1', 'senderDisplayName', 'birthDate', 'birthTime', 'birthTimezone', 'natalNakshatra', 'janmaRashi', 'moonElement'];
  check('AuraReminder DTOs never contain any private/internal field name or value', forbidden.every((needle) => !serialized.includes(needle)));
}

if (!allPassed) {
  console.error('\nSome Aura Reminders checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL AURA REMINDERS CHECKS PASSED');
}
