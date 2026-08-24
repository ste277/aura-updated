/**
 * Live-database test for ReminderAttention persistence (Notification
 * Delivery Readiness V1) -- requires a real, reachable DATABASE_URL. Run
 * locally with a real DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/reminderAttentionDb.test.ts
 *
 * Product Journey / E2E Hardening V1 (brief section 29) -- this file
 * previously used a single hardcoded scheduledItemId shared by BOTH the
 * PLANNED_ACTIVITY and AURA_MOMENT cross-type-isolation check further
 * below, reasoning that markReminderSeen's upsert made repeated runs safe.
 * That reasoning had a real gap: the count assertions below never filtered
 * by scheduledItemType, so a full prior run's AURA_MOMENT row (same
 * scheduledItemId, same reminderAt, different type) silently inflated
 * "exactly N rows" counts on every subsequent run -- reproduced live via
 * `DATABASE_URL=... npx ts-node test/reminderAttentionDb.test.ts` against
 * the shared dev database, which had accumulated rows from earlier runs.
 * Fixed at the root: a fresh, random per-run scheduledItemId (never
 * reused across runs, so no other run's rows can ever be in scope) rather
 * than tightening every filter to compensate for a shared identifier.
 */
import { randomUUID } from 'crypto';
import { listReminderAttentionForOwner, markReminderSeen, upsertUserByEmail } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const owner = await upsertUserByEmail({ email: 'test-reminder-attention-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  const scheduledItemId = `plan-attention-fixture-${randomUUID()}`;
  const reminderAt = new Date('2026-08-23T10:15:00.000Z');

  // ============================================================
  // MARK SEEN -- idempotent upsert
  // ============================================================
  const first = await markReminderSeen(owner.id, 'PLANNED_ACTIVITY', scheduledItemId, reminderAt);
  check('markReminderSeen persists a row with the right occurrence identity', first.userId === owner.id && first.scheduledItemType === 'PLANNED_ACTIVITY' && first.scheduledItemId === scheduledItemId);
  check('markReminderSeen persists the exact reminderAt submitted', first.reminderAt.getTime() === reminderAt.getTime());

  const second = await markReminderSeen(owner.id, 'PLANNED_ACTIVITY', scheduledItemId, reminderAt);
  check('Marking the SAME occurrence seen twice does not create a second row (upsert on the unique constraint)', second.id === first.id);

  const rows = await listReminderAttentionForOwner(owner.id, new Date('2026-08-23T00:00:00.000Z'), new Date('2026-08-24T00:00:00.000Z'));
  check('Exactly one ReminderAttention row exists for this occurrence after two mark-seen calls', rows.filter((r) => r.scheduledItemId === scheduledItemId && r.reminderAt.getTime() === reminderAt.getTime()).length === 1);

  // ============================================================
  // RESCHEDULING -- a DIFFERENT reminderAt for the SAME item is a separate
  // occurrence, not an update to the old row.
  // ============================================================
  const newReminderAt = new Date('2026-08-23T12:45:00.000Z');
  const rescheduled = await markReminderSeen(owner.id, 'PLANNED_ACTIVITY', scheduledItemId, newReminderAt);
  check('A new reminderAt for the SAME scheduledItemId creates a NEW row, not an update to the old one', rescheduled.id !== first.id);

  const rowsAfterReschedule = await listReminderAttentionForOwner(owner.id, new Date('2026-08-23T00:00:00.000Z'), new Date('2026-08-24T00:00:00.000Z'));
  check('Both the old and new occurrence rows exist (old one is a harmless historical record, not deleted)', rowsAfterReschedule.filter((r) => r.scheduledItemId === scheduledItemId).length === 2);

  // ============================================================
  // BOUNDED QUERY -- listReminderAttentionForOwner respects [from, to]
  // ============================================================
  const rowsOutOfWindow = await listReminderAttentionForOwner(owner.id, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-02T00:00:00.000Z'));
  check('A query window that excludes both occurrences returns none of them', !rowsOutOfWindow.some((r) => r.scheduledItemId === scheduledItemId));

  // ============================================================
  // CROSS-TYPE ISOLATION -- a Moment and a Plan with the same raw id are
  // different occurrences.
  // ============================================================
  const momentAttention = await markReminderSeen(owner.id, 'AURA_MOMENT', scheduledItemId, reminderAt);
  check('The same raw id, but scheduledItemType AURA_MOMENT, is a DIFFERENT row from the PLANNED_ACTIVITY one', momentAttention.id !== first.id);

  // ============================================================
  // PRIVACY -- ReminderAttention rows carry only internal references, no
  // birth/natal/person/token data (brief section 20/29).
  // ============================================================
  const serialized = JSON.stringify(rows);
  const forbidden = ['birthDate', 'birthTime', 'janmaRashi', 'nakshatra', 'sharedPersonDisplayName', 'senderDisplayName', 'publicToken', 'email'];
  check('ReminderAttention rows never contain any birth/natal/person/token field name', forbidden.every((needle) => !serialized.includes(needle)));

  console.log(allPassed ? '\nALL REMINDER ATTENTION DB CHECKS PASSED' : '\nSOME REMINDER ATTENTION DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
