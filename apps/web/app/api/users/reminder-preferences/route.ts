import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById, updateUserReminderPrefs } from '../../../../lib/db';
import { parseJsonObject } from '../../../../lib/request';

/**
 * Aura Reminders V1 (brief section 14/15) -- the minimal reminder
 * preference surface: enabled/disabled only. Lead time is not exposed here
 * (stays at the default 15 minutes set by migration 0021) -- brief section
 * 14 explicitly allows this: "don't necessarily expose every value in UI...
 * at minimum support reminders enabled/disabled + default lead time = 15
 * min." A richer lead-time picker is documented as future work, not built
 * here (section 15's own reduced-scope option).
 */
export async function PATCH(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body || typeof body.remindersEnabled !== 'boolean') {
    return NextResponse.json({ error: 'remindersEnabled (boolean) is required.' }, { status: 400 });
  }

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const updated = await updateUserReminderPrefs(session.userId, {
    remindersEnabled: body.remindersEnabled,
    reminderLeadMinutes: user.reminderLeadMinutes,
  });

  return NextResponse.json(updated);
}
