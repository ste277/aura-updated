import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { createAuraMoment, getPlannedActivityForOwner, getSavedPersonForOwner, getUserById, listAuraMomentsForOwner, listMomentIdsWithSuccessorForOwner } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { buildAuraMomentCreateRequest } from '../../../lib/auraMomentRequest';
import { buildMomentShareUrl, defaultExpiresAt, explanationSnapshotFor, generatePublicMomentToken } from '../../../lib/auraMoments';
import { formatDisplayName } from '../../../lib/displayName';
import { FULL_ACTIVITY_CATALOG } from '../../../../../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../../../../../packages/recommendation/src/activityDefinitions';
import { recordProductEvent } from '../../../lib/productEvents';

/**
 * Aura Moment Sharing V1 -- CREATE + LIST, both authenticated.
 *
 * POST accepts only a reference to an already-computed Muhurtham result the
 * owner selected (scope/activityId/startAt/endAt/ratingLabel, plus
 * savedPersonId for SHARED) -- never raw birth/natal context, never a
 * client-supplied title/icon/sender name (all resolved server-side; see
 * auraMomentRequest.ts's own doc comment for why). It does not re-run
 * Muhurtham Finder or any astrology computation: it snapshots exactly what
 * the client already found.
 *
 * Event Location AuraMoment Persistence V1: the one exception to "never
 * client-supplied timezone" is the optional `eventLocation: {cityName,
 * timezone}` snapshot -- validated in auraMomentRequest.ts, sourced by the
 * client ONLY from PR #55's resultEventLocation (never live picker state,
 * never coordinates). Present -> persists that snapshot's own timezone/name.
 * Absent -> unchanged prior behavior (the owner's own user.timezone, no
 * locationName).
 */

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const validated = buildAuraMomentCreateRequest(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });
  const { input } = validated;

  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === input.activityId);
  if (!activity) return NextResponse.json({ error: 'Unknown activity.' }, { status: 400 });

  let sharedPersonDisplayName: string | null = null;
  let savedPersonId: string | null = null;
  if (input.scope === 'SHARED') {
    // Ownership enforced here, at the route -- getSavedPersonForOwner()
    // never returns another user's row (brief section 5/1).
    const person = await getSavedPersonForOwner(session.userId, input.savedPersonId!);
    if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
    sharedPersonDisplayName = person.name;
    savedPersonId = person.id;
  }

  // Aura Reminders V1 dedup linkage (brief section 7) -- re-verify
  // ownership server-side (never trust a client-supplied id where it can be
  // resolved and checked, same discipline as savedPersonId above).
  let plannedActivityId: string | null = null;
  if (input.plannedActivityId) {
    const plan = await getPlannedActivityForOwner(session.userId, input.plannedActivityId);
    if (!plan) return NextResponse.json({ error: 'Planned activity not found.' }, { status: 404 });
    plannedActivityId = plan.id;
  }

  const moment = await createAuraMoment({
    ownerUserId: session.userId,
    publicToken: generatePublicMomentToken(),
    scope: input.scope,
    source: input.source,
    activityId: activity.id,
    activityTitle: activity.title,
    activityIcon: activity.icon,
    startAt: input.startAt,
    endAt: input.endAt,
    // Event Location AuraMoment Persistence V1 (brief section 9, the
    // central correctness rule): a validated Event Location snapshot's
    // timezone wins; otherwise the owner's own Timing Location, exactly
    // preserving prior behavior for every request that omits eventLocation.
    timezone: input.eventLocationTimezone ?? user.timezone,
    locationName: input.eventLocationName,
    savedPersonId,
    sharedPersonDisplayName,
    senderDisplayName: formatDisplayName(user.email),
    ratingLabel: input.ratingLabel,
    explanationSnapshot: explanationSnapshotFor(activity.id, input.scope),
    expiresAt: defaultExpiresAt(input.endAt),
    plannedActivityId,
  });

  void recordProductEvent({
    eventName: 'AURA_MOMENT_CREATED',
    userId: session.userId,
    auraMomentId: moment.id,
    metadata: {
      scope: moment.scope,
      activityId: moment.activityId,
      source: moment.source,
      planningMode: getActivityDefinition(activity)?.experience.planningMode ?? 'EVERYDAY',
    },
  });

  return NextResponse.json({ id: moment.id, shareUrl: buildMomentShareUrl(req, moment.publicToken) }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const [moments, momentIdsWithSuccessor] = await Promise.all([
    listAuraMomentsForOwner(session.userId),
    listMomentIdsWithSuccessorForOwner(session.userId),
  ]);
  // The owner's own private view -- fine to include publicToken/shareUrl
  // (they already have it, it's literally what they shared) and id. Never
  // includes natal/birth data since AuraMoment never stores any in the
  // first place -- there is nothing here to accidentally leak. planningMode
  // is derived (never stored) the same way PublicAuraMoment's own field is,
  // so the owner's own list can pick everyday vs. ceremonial copy too
  // (Everyday Moment Rescheduling V1). hasSuccessor mirrors the same signal
  // GET /api/aura-updates already derives (lib/auraUpdates.ts) -- without it
  // an already-rescheduled "another time" moment kept offering "Find
  // another time" again with no way for the UI to know it was resolved.
  return NextResponse.json(
    moments.map((m) => ({
      ...m,
      shareUrl: buildMomentShareUrl(req, m.publicToken),
      planningMode: getActivityDefinition(m.activityId)?.experience.planningMode ?? 'EVERYDAY',
      hasSuccessor: momentIdsWithSuccessor.has(m.id),
    }))
  );
}
