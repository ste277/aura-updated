import { attachReminderSeenState, reminderOccurrenceKey } from '../apps/web/lib/reminderAttention';
import type { AuraReminder } from '../apps/web/lib/auraReminders';
import { summarizeAuraUpdates } from '../apps/web/lib/auraUpdates';
import type { AuraMoment } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function fakeReminder(overrides: Partial<AuraReminder>): AuraReminder {
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

function attentionRow(scheduledItemType: 'PLANNED_ACTIVITY' | 'AURA_MOMENT', scheduledItemId: string, reminderAtIso: string) {
  return { scheduledItemType, scheduledItemId, reminderAt: new Date(reminderAtIso) };
}

// ============================================================
// Occurrence identity (brief section 3) -- keyed by type + id + reminderAt,
// not a bare boolean.
// ============================================================

check(
  'reminderOccurrenceKey differs when reminderAt differs (a rescheduled item is a DIFFERENT occurrence)',
  reminderOccurrenceKey('PLANNED_ACTIVITY', 'plan-1', '2026-08-23T10:15:00.000Z') !== reminderOccurrenceKey('PLANNED_ACTIVITY', 'plan-1', '2026-08-23T12:45:00.000Z')
);
check(
  'reminderOccurrenceKey is identical for the same type+id+reminderAt',
  reminderOccurrenceKey('PLANNED_ACTIVITY', 'plan-1', '2026-08-23T10:15:00.000Z') === reminderOccurrenceKey('PLANNED_ACTIVITY', 'plan-1', '2026-08-23T10:15:00.000Z')
);
check(
  'reminderOccurrenceKey differs between a Plan and a Moment sharing the same raw id',
  reminderOccurrenceKey('PLANNED_ACTIVITY', 'shared-id', '2026-08-23T10:15:00.000Z') !== reminderOccurrenceKey('AURA_MOMENT', 'shared-id', '2026-08-23T10:15:00.000Z')
);

// ============================================================
// Brief section 2's worked example: relevant vs unread are independent.
// ============================================================

{
  // At 3:15, before anyone opens it: relevant (it's in the reminders list
  // at all) AND unread.
  const [result] = attachReminderSeenState([fakeReminder({})], []);
  check('A reminder with no matching attention row is unread', result.unread === true);
}

{
  // User opens the reminder at 3:18 -> a ReminderAttention row now exists
  // for this EXACT occurrence.
  const seen = [attentionRow('PLANNED_ACTIVITY', 'plan-1', '2026-08-23T10:15:00.000Z')];
  const [result] = attachReminderSeenState([fakeReminder({})], seen);
  check('relevant = true (still present in the list) AND unread = false, once a matching attention row exists', result.unread === false);
}

// ============================================================
// Rescheduling (brief section 3/16/26): old occurrence's seen row does
// NOT suppress the new occurrence.
// ============================================================

{
  // Old occurrence (3:30 start, 3:15 reminder) was seen. Plan moves to
  // 5:00 PM -> new reminderAt 4:45 PM. Same scheduledItemId (same Plan row).
  const oldSeenRow = attentionRow('PLANNED_ACTIVITY', 'plan-1', '2026-08-23T10:15:00.000Z'); // old 3:15 PM IST-ish UTC stand-in
  const movedReminder = fakeReminder({
    startAt: '2026-08-23T13:00:00.000Z',
    reminderAt: '2026-08-23T12:45:00.000Z',
    minutesUntilStart: 15,
  });
  const [result] = attachReminderSeenState([movedReminder], [oldSeenRow]);
  check('A rescheduled Plan\'s NEW occurrence is unread again, even though the OLD occurrence for the same item was seen', result.unread === true);
}

// ============================================================
// Two reminders, one seen one unseen (brief section 24).
// ============================================================

{
  const reminderA = fakeReminder({ id: 'PLANNED_ACTIVITY:plan-a', scheduledItemId: 'plan-a', reminderAt: '2026-08-23T10:15:00.000Z' });
  const reminderB = fakeReminder({
    id: 'AURA_MOMENT:moment-b',
    type: 'MOMENT_APPROACHING',
    scheduledItemType: 'AURA_MOMENT',
    scheduledItemId: 'moment-b',
    reminderAt: '2026-08-23T10:20:00.000Z',
    target: { type: 'MOMENT', momentToken: 'tok' },
  });
  const seenRows = [attentionRow('PLANNED_ACTIVITY', 'plan-a', '2026-08-23T10:15:00.000Z')];
  const results = attachReminderSeenState([reminderA, reminderB], seenRows);
  const unseenCount = results.filter((r) => r.unread).length;
  check('Two reminders, one seen -> exactly one counts as unseen', unseenCount === 1);
  check('Both reminders remain present in the Upcoming list regardless of seen state (brief section 9)', results.length === 2);
}

// ============================================================
// Bell = unread social updates + unseen reminders (brief section 7/25) --
// exercised via the SAME formula GET /api/aura-updates uses.
// ============================================================

function fakeMoment(overrides: Partial<AuraMoment>): AuraMoment {
  return {
    id: 'moment-1', ownerUserId: 'owner-1', publicToken: 'token-1', scope: 'SHARED', source: 'MUHURTHAM',
    activityId: 'date-night', activityTitle: 'Date Night', activityIcon: '❤️',
    startAt: new Date('2026-08-23T13:00:00.000Z'), endAt: new Date('2026-08-23T14:00:00.000Z'),
    timezone: 'Asia/Kolkata', savedPersonId: 'p1', sharedPersonDisplayName: 'Anna', senderDisplayName: 'Stephen',
    ratingLabel: 'STRONG_SHARED_FIT', explanationSnapshot: 'x', status: 'ACTIVE', responseState: 'ACCEPTED',
    responsePreference: null, respondedAt: new Date('2026-08-23T09:00:00.000Z'), previousMomentId: null,
    plannedActivityId: null, ownerSeenResponseAt: null, firstOpenedAt: null, createdAt: new Date(), expiresAt: null,
    ...overrides,
  };
}

{
  // Section 25: one unread Moment response + one unseen active reminder -> Bell = 2.
  const summary = summarizeAuraUpdates([fakeMoment({})], new Set());
  const [reminder] = attachReminderSeenState([fakeReminder({})], []);
  const bellCount = summary.unreadCount + [reminder].filter((r) => r.unread).length;
  check('One unread social update + one unseen reminder -> Bell = 2', bellCount === 2);

  // Open reminder -> Bell = 1.
  const [seenReminder] = attachReminderSeenState([fakeReminder({})], [attentionRow('PLANNED_ACTIVITY', 'plan-1', '2026-08-23T10:15:00.000Z')]);
  const bellAfterOpeningReminder = summary.unreadCount + [seenReminder].filter((r) => r.unread).length;
  check('After opening the reminder -> Bell = 1 (only the social update remains)', bellAfterOpeningReminder === 1);

  // Open response too (ownerSeenResponseAt now after respondedAt) -> Bell = 0.
  const summaryAfterViewingResponse = summarizeAuraUpdates(
    [fakeMoment({ ownerSeenResponseAt: new Date('2026-08-23T12:00:00.000Z') })],
    new Set()
  );
  const bellAfterBoth = summaryAfterViewingResponse.unreadCount + [seenReminder].filter((r) => r.unread).length;
  check('After opening BOTH the reminder and the response -> Bell = 0', bellAfterBoth === 0);
}

if (!allPassed) {
  console.error('\nSome reminder attention checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL REMINDER ATTENTION CHECKS PASSED');
}
