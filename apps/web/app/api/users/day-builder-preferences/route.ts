import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById, getSavedPersonForOwner, updateUserDayBuilderPrefs } from '../../../../lib/db';
import { parseJsonObject } from '../../../../lib/request';
import { INTENTION_GROUPS, DailyIntentionGroupId } from '../../../../lib/dailyIntentions';
import { USER_PRIORITY_GROUPS, UserPriorityGroup } from '../../../../lib/dayBuilder';

/**
 * Intentional Day Builder V1 (brief section 6/35), extended by
 * Personalization Foundation V1 -- the minimal preference surface:
 * enabled/disabled, muted groups, explicit priorities (max 3), an
 * optional "make more time for" person list, and whether the one-time
 * priorities prompt has been dismissed. Every field is optional in the
 * request and defaults to the user's CURRENT stored value when omitted --
 * so an old caller sending only {dayBuilderEnabled, dayBuilderMutedGroups}
 * (the existing You -> Day Builder toggle) can never accidentally wipe
 * priorities it doesn't know about.
 */

const VALID_GROUP_IDS = new Set<string>(INTENTION_GROUPS.map((g) => g.id));
const VALID_PRIORITY_GROUP_IDS = new Set<string>(USER_PRIORITY_GROUPS.map((g) => g.id));
const MAX_PRIORITIES = 3;
const MAX_PRIORITY_PEOPLE = 10;

export async function PATCH(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const dayBuilderEnabled = body.dayBuilderEnabled !== undefined ? body.dayBuilderEnabled : user.dayBuilderEnabled;
  if (typeof dayBuilderEnabled !== 'boolean') {
    return NextResponse.json({ error: 'dayBuilderEnabled must be a boolean.' }, { status: 400 });
  }

  const rawMuted = body.dayBuilderMutedGroups;
  if (rawMuted !== undefined && !Array.isArray(rawMuted)) {
    return NextResponse.json({ error: 'dayBuilderMutedGroups must be an array of group ids.' }, { status: 400 });
  }
  let mutedGroups: DailyIntentionGroupId[] = user.dayBuilderMutedGroups as DailyIntentionGroupId[];
  if (Array.isArray(rawMuted)) {
    mutedGroups = [];
    for (const value of rawMuted) {
      if (typeof value !== 'string' || !VALID_GROUP_IDS.has(value)) {
        return NextResponse.json({ error: `dayBuilderMutedGroups contains an unknown group id: "${String(value)}"` }, { status: 400 });
      }
      mutedGroups.push(value as DailyIntentionGroupId);
    }
  }

  // Personalization Foundation V1 (brief section 2) -- approximately 1-3
  // priorities; an empty array is explicitly a fully valid, permanent state.
  const rawPriorities = body.dayBuilderPriorities;
  if (rawPriorities !== undefined && !Array.isArray(rawPriorities)) {
    return NextResponse.json({ error: 'dayBuilderPriorities must be an array of priority group ids.' }, { status: 400 });
  }
  let priorities: UserPriorityGroup[] = user.dayBuilderPriorities as UserPriorityGroup[];
  if (Array.isArray(rawPriorities)) {
    if (rawPriorities.length > MAX_PRIORITIES) {
      return NextResponse.json({ error: `dayBuilderPriorities accepts at most ${MAX_PRIORITIES} entries.` }, { status: 400 });
    }
    priorities = [];
    for (const value of rawPriorities) {
      if (typeof value !== 'string' || !VALID_PRIORITY_GROUP_IDS.has(value)) {
        return NextResponse.json({ error: `dayBuilderPriorities contains an unknown priority id: "${String(value)}"` }, { status: 400 });
      }
      priorities.push(value as UserPriorityGroup);
    }
  }

  // "Make more time for" (brief section 4) -- optional, existing SavedPeople
  // only. Ownership verified here, same discipline as every other
  // savedPersonId-accepting route (never trust a client-supplied id where
  // it can be resolved and checked).
  const rawPriorityPersonIds = body.dayBuilderPriorityPersonIds;
  if (rawPriorityPersonIds !== undefined && !Array.isArray(rawPriorityPersonIds)) {
    return NextResponse.json({ error: 'dayBuilderPriorityPersonIds must be an array of SavedPerson ids.' }, { status: 400 });
  }
  let priorityPersonIds: string[] = user.dayBuilderPriorityPersonIds;
  if (Array.isArray(rawPriorityPersonIds)) {
    if (rawPriorityPersonIds.length > MAX_PRIORITY_PEOPLE) {
      return NextResponse.json({ error: `dayBuilderPriorityPersonIds accepts at most ${MAX_PRIORITY_PEOPLE} entries.` }, { status: 400 });
    }
    priorityPersonIds = [];
    for (const value of rawPriorityPersonIds) {
      if (typeof value !== 'string' || !value.trim()) {
        return NextResponse.json({ error: 'dayBuilderPriorityPersonIds must contain non-empty string ids.' }, { status: 400 });
      }
      const person = await getSavedPersonForOwner(session.userId, value.trim());
      if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
      priorityPersonIds.push(person.id);
    }
  }

  const dayBuilderPrioritiesPromptDismissed =
    body.dayBuilderPrioritiesPromptDismissed !== undefined ? body.dayBuilderPrioritiesPromptDismissed : user.dayBuilderPrioritiesPromptDismissed;
  if (typeof dayBuilderPrioritiesPromptDismissed !== 'boolean') {
    return NextResponse.json({ error: 'dayBuilderPrioritiesPromptDismissed must be a boolean.' }, { status: 400 });
  }

  const updated = await updateUserDayBuilderPrefs(session.userId, {
    dayBuilderEnabled,
    dayBuilderMutedGroups: Array.from(new Set(mutedGroups)),
    dayBuilderPriorities: Array.from(new Set(priorities)),
    dayBuilderPriorityPersonIds: Array.from(new Set(priorityPersonIds)),
    dayBuilderPrioritiesPromptDismissed,
  });

  return NextResponse.json({
    dayBuilderEnabled: updated.dayBuilderEnabled,
    dayBuilderMutedGroups: updated.dayBuilderMutedGroups,
    dayBuilderPriorities: updated.dayBuilderPriorities,
    dayBuilderPriorityPersonIds: updated.dayBuilderPriorityPersonIds,
    dayBuilderPrioritiesPromptDismissed: updated.dayBuilderPrioritiesPromptDismissed,
  });
}
