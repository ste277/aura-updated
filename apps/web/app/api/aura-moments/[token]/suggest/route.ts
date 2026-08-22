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

  if (original.scope !== 'SHARED' || !original.savedPersonId) {
    return NextResponse.json({ error: 'Alternatives are only available for Shared Muhurtham moments.' }, { status: 400 });
  }
  if (original.responseState !== 'ANOTHER_TIME' || !original.responsePreference) {
    return NextResponse.json({ error: 'This moment has no reschedule preference to act on yet.' }, { status: 400 });
  }

  const ownerPersonalContext = buildPersonalMuhurtaContextForUser(user);
  if (!ownerPersonalContext) return NextResponse.json({ error: 'Complete your birth profile first.' }, { status: 400 });
  const savedPersonContext = await getSavedPersonNatalContext(original.savedPersonId, session.userId);
  if (!savedPersonContext) return NextResponse.json({ error: "This person's profile is incomplete." }, { status: 400 });

  const now = new Date();
  const ownerContext: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: ownerPersonalContext,
  };

  const outcome = findAuraMomentAlternatives({ auraMoment: original, ownerContext, savedPersonContext });
  if (outcome.status !== 'OK' || body.index >= outcome.candidates.length) {
    return NextResponse.json({ error: 'That alternative is no longer available -- please find alternatives again.' }, { status: 409 });
  }
  const candidate = outcome.candidates[body.index];

  const newMoment = await createAuraMoment({
    ownerUserId: session.userId,
    publicToken: generatePublicMomentToken(),
    scope: 'SHARED',
    // A suggested alternative always came through this reschedule flow --
    // itself only ever reachable via findAuraMomentAlternatives(), which
    // (Product Structure V2) only resolves for Muhurtham-eligible
    // activities. Preserving original.source anyway (rather than hardcoding
    // MUHURTHAM) keeps this correct if that constraint ever loosens.
    source: original.source,
    // Preserve the exact occasion (brief section 10) -- never broadened to
    // a generic family, always the original's own canonical activity.
    activityId: original.activityId,
    activityTitle: original.activityTitle,
    activityIcon: original.activityIcon,
    startAt: new Date(candidate.startAt),
    endAt: new Date(candidate.endAt),
    timezone: original.timezone,
    savedPersonId: original.savedPersonId,
    sharedPersonDisplayName: original.sharedPersonDisplayName,
    senderDisplayName: original.senderDisplayName,
    ratingLabel: candidate.ratingLabel,
    explanationSnapshot: explanationSnapshotFor(original.activityId, 'SHARED'),
    expiresAt: defaultExpiresAt(new Date(candidate.endAt)),
    previousMomentId: original.id,
  });

  void recordProductEvent({
    eventName: 'AURA_MOMENT_ALTERNATIVE_CREATED',
    userId: session.userId,
    auraMomentId: newMoment.id,
    metadata: { scope: 'SHARED', activityId: newMoment.activityId },
  });

  return NextResponse.json({ id: newMoment.id, shareUrl: buildMomentShareUrl(req, newMoment.publicToken) }, { status: 201 });
}
