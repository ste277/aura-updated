import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getAuraMomentByIdForOwner, getPlannedActivityForOwner, getUserById, markReminderSeen, ReminderScheduledItemType } from '../../../../lib/db';
import { parseJsonObject } from '../../../../lib/request';

/**
 * Notification Delivery Readiness V1 (brief section 5) -- marks ONE
 * reminder occurrence acknowledged. Authenticated only; never trusts the
 * client-supplied scheduledItemId/reminderAt blindly (brief: "Do not trust
 * arbitrary reminder IDs blindly") -- re-derives the CURRENT expected
 * reminderAt for that item server-side (startAt - the owner's own
 * reminderLeadMinutes, the exact same formula deriveAuraReminders() uses)
 * and requires an exact match before writing anything. This is
 * deliberately lighter than re-running the full deriveAuraReminders()
 * eligibility pipeline (dedup/successor/lifecycle rules) -- the only thing
 * at risk here is a harmless unused ReminderAttention row, not any data
 * exposure, so ownership + reminderAt-matches-the-deterministic-formula is
 * the right amount of verification for this specific write.
 */

const VALID_SCHEDULED_ITEM_TYPES = new Set<ReminderScheduledItemType>(['PLANNED_ACTIVITY', 'AURA_MOMENT']);

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const scheduledItemType = typeof body.scheduledItemType === 'string' ? body.scheduledItemType : '';
  if (!VALID_SCHEDULED_ITEM_TYPES.has(scheduledItemType as ReminderScheduledItemType)) {
    return NextResponse.json({ error: 'scheduledItemType must be PLANNED_ACTIVITY or AURA_MOMENT.' }, { status: 400 });
  }
  const scheduledItemId = typeof body.scheduledItemId === 'string' ? body.scheduledItemId.trim() : '';
  if (!scheduledItemId) return NextResponse.json({ error: 'scheduledItemId is required.' }, { status: 400 });

  const reminderAt = typeof body.reminderAt === 'string' ? new Date(body.reminderAt) : null;
  if (!reminderAt || Number.isNaN(reminderAt.getTime())) {
    return NextResponse.json({ error: 'reminderAt must be a valid ISO date-time.' }, { status: 400 });
  }

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  let expectedStartAt: Date | null = null;
  if (scheduledItemType === 'PLANNED_ACTIVITY') {
    const plan = await getPlannedActivityForOwner(session.userId, scheduledItemId);
    if (plan && plan.status === 'UPCOMING') expectedStartAt = new Date(plan.plannedStartAt);
  } else {
    const moment = await getAuraMomentByIdForOwner(session.userId, scheduledItemId);
    if (moment && moment.status === 'ACTIVE') expectedStartAt = new Date(moment.startAt);
  }

  if (!expectedStartAt) {
    return NextResponse.json({ error: 'No matching reminder for this owner.' }, { status: 404 });
  }

  const expectedReminderAt = new Date(expectedStartAt.getTime() - user.reminderLeadMinutes * 60_000);
  if (expectedReminderAt.getTime() !== reminderAt.getTime()) {
    return NextResponse.json({ error: 'reminderAt does not match the current reminder occurrence for this item.' }, { status: 409 });
  }

  await markReminderSeen(session.userId, scheduledItemType as ReminderScheduledItemType, scheduledItemId, reminderAt);

  return NextResponse.json({ ok: true });
}
