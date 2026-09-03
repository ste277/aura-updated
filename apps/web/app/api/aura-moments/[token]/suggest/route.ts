import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { createAuraMoment, getAuraMomentForOwner, getUserById } from '../../../../../lib/db';
import { buildPersonalMuhurtaContextForUser } from '../../../../../lib/natalContext';
import { getSavedPersonNatalContext } from '../../../../../lib/savedPersonNatalContext';
import { findAuraMomentAlternatives } from '../../../../../lib/auraMomentAlternatives';
import { isValidAlternativeIndex } from '../../../../../lib/auraMomentRequest';
import { buildMomentShareUrl, defaultExpiresAt, explanationSnapshotFor, generatePublicMomentToken } from '../../../../../lib/auraMoments';
import { parseJsonObject } from '../../../../../lib/request';
import { resolveTzOffsetMinutes } from '../../../../../lib/timezone';
import { DailyAssistantContext } from '../../../../../../../packages/recommendation/src/dailyAssistant';
import { getActivityDefinition } from '../../../../../../../packages/recommendation/src/activityDefinitions';
import { recordProductEvent } from '../../../../../lib/productEvents';

/**
 * "Suggest this" (brief section 13) -- owner-authenticated. Creates a BRAND
 * NEW AuraMoment rather than mutating the original: historical shares stay
 * immutable snapshots, and the new moment gets its own opaque token (brief
 * section 15: "Do NOT reuse the original public token") and a fresh expiry
 * derived from the NEW event time (section 18).
 *
 * The request body is just `{ index }` -- 0/1/2 into the alternatives list
 * (brief section 20: never trust a client-supplied date/activity/SavedPerson
 * id). This route re-runs the exact same deterministic search the
 * alternatives endpoint just showed the owner and picks candidates[index]
 * itself, so the actual new startAt/endAt/ratingLabel always come from a
 * fresh server-side computation, never from the request body.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body || !isValidAlternativeIndex(body.index)) {
    return NextResponse.json({ error: 'index must be a valid alternative index.' }, { status: 400 });
  }

  const original = await getAuraMomentForOwner(session.userId, params.token);
  if (!original) return NextResponse.json({ error: 'Moment not found.' }, { status: 404 });

  if (original.responseState !== 'ANOTHER_TIME' || !original.responsePreference) {
    return NextResponse.json({ error: 'This moment has no reschedule preference to act on yet.' }, { status: 400 });
  }

  const now = new Date();
  const ownerContext: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: buildPersonalMuhurtaContextForUser(user),
  };
  const savedPersonContext = original.savedPersonId ? (await getSavedPersonNatalContext(original.savedPersonId, session.userId)) ?? undefined : undefined;

  const outcome = findAuraMomentAlternatives({ auraMoment: original, ownerContext, savedPersonContext });
  if (outcome.status !== 'OK' || body.index >= outcome.candidates.length) {
    return NextResponse.json({ error: 'That alternative is no longer available -- please find alternatives again.' }, { status: 409 });
  }
  const candidate = outcome.candidates[body.index];

  const newMoment = await createAuraMoment({
    ownerUserId: session.userId,
    publicToken: generatePublicMomentToken(),
    // Everyday Moment Rescheduling V1 (brief section 13): the successor must
    // preserve the ORIGINAL scope, not force SHARED -- a GENERAL/PERSONAL
    // PLAN moment's successor stays GENERAL/PERSONAL. Previously hardcoded
    // to 'SHARED', which was harmless only because the route itself used to
    // gate out every non-SHARED moment before reaching here.
    scope: original.scope,
    // Section 13: the successor's source must match the original's --
    // a PLAN moment's successor stays PLAN, a MUHURTHAM moment's successor
    // stays MUHURTHAM. Never hardcode either.
    source: original.source,
    // Preserve the exact occasion -- never broadened to a generic family,
    // always the original's own canonical activity.
    activityId: original.activityId,
    activityTitle: original.activityTitle,
    activityIcon: original.activityIcon,
    startAt: new Date(candidate.startAt),
    endAt: new Date(candidate.endAt),
    timezone: original.timezone,
    // Event Location AuraMoment Persistence V1: preserve the original's
    // location snapshot too -- a successor to a moment that used a custom
    // Event Location must keep describing that same place, not silently
    // drop back to no location (brief section 33: "ensure locationName/
    // timezone are not discarded"). null on an ordinary-Timing-Location
    // original propagates as null, same as timezone above.
    locationName: original.locationName,
    savedPersonId: original.savedPersonId,
    sharedPersonDisplayName: original.sharedPersonDisplayName,
    senderDisplayName: original.senderDisplayName,
    ratingLabel: candidate.ratingLabel,
    // Section 14: generated fresh from the successor's own scope/activity,
    // never copied from the original (which may describe different timing).
    explanationSnapshot: explanationSnapshotFor(original.activityId, original.scope),
    expiresAt: defaultExpiresAt(new Date(candidate.endAt)),
    previousMomentId: original.id,
  });

  void recordProductEvent({
    eventName: 'AURA_MOMENT_ALTERNATIVE_CREATED',
    userId: session.userId,
    auraMomentId: newMoment.id,
    metadata: {
      scope: newMoment.scope,
      activityId: newMoment.activityId,
      source: newMoment.source,
      planningMode: getActivityDefinition(newMoment.activityId)?.experience.planningMode ?? 'EVERYDAY',
    },
  });

  return NextResponse.json({ id: newMoment.id, shareUrl: buildMomentShareUrl(req, newMoment.publicToken) }, { status: 201 });
}
