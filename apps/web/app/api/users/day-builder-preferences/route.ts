import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById, updateUserDayBuilderPrefs } from '../../../../lib/db';
import { parseJsonObject } from '../../../../lib/request';
import { INTENTION_GROUPS, DailyIntentionGroupId } from '../../../../lib/dailyIntentions';

/**
 * Intentional Day Builder V1 (brief section 6/35) -- the minimal preference
 * surface: enabled/disabled, plus which real taxonomy groups are muted from
 * proactive suggestions. Same restrained shape as
 * /api/users/reminder-preferences -- no per-activity config, no
 * weighting/ranking knobs (future personalization is explicitly out of
 * scope, brief section 7).
 */

const VALID_GROUP_IDS = new Set<string>(INTENTION_GROUPS.map((g) => g.id));

export async function PATCH(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body || typeof body.dayBuilderEnabled !== 'boolean') {
    return NextResponse.json({ error: 'dayBuilderEnabled (boolean) is required.' }, { status: 400 });
  }

  const rawMuted = body.dayBuilderMutedGroups;
  if (rawMuted !== undefined && !Array.isArray(rawMuted)) {
    return NextResponse.json({ error: 'dayBuilderMutedGroups must be an array of group ids.' }, { status: 400 });
  }
  const mutedGroups: DailyIntentionGroupId[] = [];
  if (Array.isArray(rawMuted)) {
    for (const value of rawMuted) {
      if (typeof value !== 'string' || !VALID_GROUP_IDS.has(value)) {
        return NextResponse.json({ error: `dayBuilderMutedGroups contains an unknown group id: "${String(value)}"` }, { status: 400 });
      }
      mutedGroups.push(value as DailyIntentionGroupId);
    }
  }

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const updated = await updateUserDayBuilderPrefs(session.userId, {
    dayBuilderEnabled: body.dayBuilderEnabled,
    dayBuilderMutedGroups: Array.from(new Set(mutedGroups)),
  });

  return NextResponse.json({ dayBuilderEnabled: updated.dayBuilderEnabled, dayBuilderMutedGroups: updated.dayBuilderMutedGroups });
}
