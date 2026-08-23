import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import {
  getUserById,
  listAuraMomentsForReminders,
  listMomentIdsWithSuccessorForOwner,
  listPlannedActivitiesForReminders,
  listRecentRespondedAuraMomentsForOwner,
} from '../../../lib/db';
import { summarizeAuraUpdates } from '../../../lib/auraUpdates';
import { deriveAuraReminders, MAX_REMINDER_LEAD_MINUTES, REMINDER_GRACE_PERIOD_MINUTES } from '../../../lib/auraReminders';

/**
 * Authenticated only -- returns the current user's own actionable/recent
 * moment updates AND approaching reminders, both derived on the fly (brief
 * section 3: no generic notifications table). Extended additively for Aura
 * Reminders V1 (brief section 26): existing `unreadCount`/`updates` are
 * untouched in shape and meaning, `upcoming` is new. This is ordinary
 * database retrieval (brief section 17/46): no Panchang/Muhurta/natal/
 * Shared Fit/Timing Search computation happens anywhere in this path.
 */

/** The DB query's own cap -- deliberately higher than
 * auraUpdates.ts's API_UPDATE_DISPLAY_LIMIT so unreadCount stays accurate
 * even when more responses exist than the display list shows. */
const RECENT_MOMENT_QUERY_LIMIT = 50;

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const now = new Date();
  // Bounded query window (brief section 25) -- only records that could
  // plausibly produce an ACTIVE reminder right now, never full history.
  const from = new Date(now.getTime() - REMINDER_GRACE_PERIOD_MINUTES * 60_000);
  const to = new Date(now.getTime() + MAX_REMINDER_LEAD_MINUTES * 60_000);

  const [moments, momentIdsWithSuccessor, plansForReminders, momentsForReminders] = await Promise.all([
    listRecentRespondedAuraMomentsForOwner(session.userId, RECENT_MOMENT_QUERY_LIMIT),
    listMomentIdsWithSuccessorForOwner(session.userId),
    listPlannedActivitiesForReminders(session.userId, from, to),
    listAuraMomentsForReminders(session.userId, from, to),
  ]);

  const summary = summarizeAuraUpdates(moments, momentIdsWithSuccessor);

  const upcoming = user.remindersEnabled
    ? deriveAuraReminders({
        now,
        leadMinutes: user.reminderLeadMinutes,
        ownerTimezone: user.timezone,
        plans: plansForReminders,
        moments: momentsForReminders,
        momentIdsWithSuccessor,
      })
    : [];

  // Bell badge (brief section 18/19): an active reminder counts toward the
  // badge for as long as its window stays active -- reminders are treated
  // as CONTEXTUAL ("something is starting soon right now"), not a
  // dismissible notification, so there is no separate persisted seen state
  // to subtract here (brief section 19 explicitly allows this simpler
  // reading: "consider treating active reminders as contextual rather than
  // permanently unread"). Existing coordination-update unread counting is
  // completely unchanged.
  return NextResponse.json({
    unreadCount: summary.unreadCount + upcoming.length,
    updates: summary.updates,
    upcoming,
  });
}
