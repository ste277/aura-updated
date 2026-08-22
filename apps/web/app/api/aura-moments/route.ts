import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { createAuraMoment, getSavedPersonForOwner, getUserById, listAuraMomentsForOwner } from '../../../lib/db';
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
 * client-supplied title/icon/timezone/sender name (all resolved server-side;
 * see auraMomentRequest.ts's own doc comment for why). It does not re-run
 * Muhurtham Finder or any astrology computation: it snapshots exactly what
 * the client already found.
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
    timezone: user.timezone,
    savedPersonId,
    sharedPersonDisplayName,
    senderDisplayName: formatDisplayName(user.email),
    ratingLabel: input.ratingLabel,
    explanationSnapshot: explanationSnapshotFor(activity.id, input.scope),
    expiresAt: defaultExpiresAt(input.endAt),
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

  const moments = await listAuraMomentsForOwner(session.userId);
  // The owner's own private view -- fine to include publicToken/shareUrl
  // (they already have it, it's literally what they shared) and id. Never
  // includes natal/birth data since AuraMoment never stores any in the
  // first place -- there is nothing here to accidentally leak.
  return NextResponse.json(
    moments.map((m) => ({ ...m, shareUrl: buildMomentShareUrl(req, m.publicToken) }))
  );
}
