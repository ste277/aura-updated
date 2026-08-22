import { NextRequest, NextResponse } from 'next/server';
import { AuraMomentAlternativePreference, respondToAuraMoment } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { isValidAlternativePreference, isValidMomentResponse } from '../../../../../lib/auraMomentRequest';
import { resolvePublicAuraMoment } from '../../../../../lib/auraMoments';
import { recordProductEvent } from '../../../../../lib/productEvents';

/**
 * PUBLIC endpoint (brief section 10) -- no authentication, resolved
 * entirely by the opaque publicToken in the URL. Anyone holding the link
 * can respond; see brief section 11 ("bearer-access... document this
 * explicitly") -- this is the intentional, documented trust model for a V1
 * share link, not an oversight. Mitigations actually in place: the token
 * itself is 192 bits of entropy (unguessable), only two response values are
 * ever accepted, and the response can never change what's PUBLICLY visible
 * beyond responseState (no comments/chat, no way to alter the moment's own
 * content). No new rate-limiting infrastructure is introduced for this PR
 * (none already exists in this codebase to reuse -- see the completion
 * report for this documented as a known limitation).
 *
 * Aura Moment Rescheduling (brief section 19) extends this with ONE more
 * optional field: `preference`, a closed four-value enum, accepted ONLY
 * alongside response === 'ANOTHER_TIME'. The public API remains
 * intentionally powerless beyond that -- no dates, activity ids, SavedPerson
 * ids, search options, or free text are ever accepted here.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const body = await parseJsonObject(req);
  if (!body || !isValidMomentResponse(body.response)) {
    return NextResponse.json({ error: 'response must be ACCEPTED or ANOTHER_TIME.' }, { status: 400 });
  }

  let preference: AuraMomentAlternativePreference | null = null;
  if (body.response === 'ANOTHER_TIME') {
    if (!isValidAlternativePreference(body.preference)) {
      return NextResponse.json({ error: 'preference must be EARLIER, LATER, DIFFERENT_DAY, or NO_PREFERENCE.' }, { status: 400 });
    }
    preference = body.preference;
  }

  const before = await resolvePublicAuraMoment(params.token);
  if (before.status === 'NOT_FOUND') {
    return NextResponse.json({ error: 'This Aura Moment could not be found.' }, { status: 404 });
  }
  if (before.status === 'REVOKED' || before.status === 'EXPIRED') {
    return NextResponse.json({ error: 'This Aura Moment is no longer available.' }, { status: 410 });
  }

  const updated = await respondToAuraMoment(params.token, body.response, preference);

  const after = await resolvePublicAuraMoment(params.token);
  if (after.status !== 'OK') {
    // Only reachable via a genuine race (revoked/expired between the two
    // resolves above) -- same "no longer available" response either way.
    return NextResponse.json({ error: 'This Aura Moment is no longer available.' }, { status: 410 });
  }

  // Recorded server-side, off the raw AuraMoment row (which has scope/id) --
  // never off the public DTO in `after`, which deliberately strips id.
  if (updated) {
    void recordProductEvent({
      eventName: body.response === 'ACCEPTED' ? 'AURA_MOMENT_ACCEPTED' : 'AURA_MOMENT_ANOTHER_TIME',
      auraMomentId: updated.id,
      metadata:
        body.response === 'ACCEPTED'
          ? { scope: updated.scope }
          : { scope: updated.scope, preference: preference! },
    });
  }

  return NextResponse.json(after.moment);
}
