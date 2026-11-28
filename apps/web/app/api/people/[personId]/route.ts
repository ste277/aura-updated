import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, SESSION_UNAVAILABLE, sessionUnavailableResponse } from '../../../../lib/session';
import { deleteSavedPerson, getSavedPersonForOwner, listPersonOccasions, updateSavedPerson } from '../../../../lib/db';
import { natalContextForSavedPerson } from '../../../../lib/savedPersonNatalContext';
import { parseJsonObject } from '../../../../lib/request';
import { buildSavedPersonUpdate } from '../../../../lib/savedPersonRequest';
import { isMyPeopleServerEnabled, MY_PEOPLE_CAPABILITY_HEADER, myPeopleCapabilityHeaderValue } from '../../../../lib/myPeopleGate';
import { toSavedPersonResponse } from '../../../../lib/savedPersonView';
import { toOccasionResponse, userLocalToday } from '../../../../lib/myPeopleRoutes';

/**
 * SavedPerson / My People -- DETAIL + UPDATE + DELETE, all ownership-scoped
 * via getSavedPersonForOwner()/updateSavedPerson()/deleteSavedPerson() (brief
 * section 3) -- a request for another user's personId behaves identically
 * to a request for a nonexistent one (404), never leaking which is true.
 *
 * AURA-MP-1:
 *   - PATCH is PARTIAL in both switch states: an absent key leaves that
 *     field unchanged, so chart details are never touched unless sent, and
 *     the legacy People screen can never wipe My People data;
 *   - DELETE is one transaction with every reference clean-up (db.ts);
 *   - natalContext is null for a person without chart details.
 */

// AURA-MP-1: the My People switch is read per request -- never prerender.
export const dynamic = 'force-dynamic';

const withCapability = (res: NextResponse, enabled: boolean) => {
  res.headers.set(MY_PEOPLE_CAPABILITY_HEADER, myPeopleCapabilityHeaderValue(enabled));
  return res;
};

export async function GET(req: NextRequest, { params }: { params: { personId: string } }) {
  const session = await getSessionFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const person = await getSavedPersonForOwner(session.userId, params.personId);
  if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });

  const enabled = isMyPeopleServerEnabled();
  const natalContext = natalContextForSavedPerson(person);
  if (!enabled) return withCapability(NextResponse.json({ ...toSavedPersonResponse(person, false), natalContext }), false);

  const today = await userLocalToday(session.userId);
  const occasions = await listPersonOccasions(session.userId, person.id);
  return withCapability(NextResponse.json({
    ...toSavedPersonResponse(person, true),
    natalContext,
    occasions: today ? occasions.map((o) => toOccasionResponse(o, today.date)) : [],
  }), true);
}

export async function PATCH(req: NextRequest, { params }: { params: { personId: string } }) {
  const session = await getSessionFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const enabled = isMyPeopleServerEnabled();
  // R1 F1: the current relationship lets a legacy edit resubmit an unchanged
  // My People type while My People is disabled.
  const current = await getSavedPersonForOwner(session.userId, params.personId);
  if (!current) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  const validated = buildSavedPersonUpdate(body, { myPeopleEnabled: enabled, currentRelationshipType: current.relationshipType });
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  try {
    const person = await updateSavedPerson(session.userId, params.personId, validated.update);
    return withCapability(NextResponse.json(toSavedPersonResponse(person, enabled)), enabled);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'Person not found.') return NextResponse.json({ error: message }, { status: 404 });
    console.error('[people] update failed', { personId: params.personId });
    return NextResponse.json({ error: 'Could not update this person.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { personId: string } }) {
  const session = await getSessionFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    await deleteSavedPerson(session.userId, params.personId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'Person not found.') return NextResponse.json({ error: message }, { status: 404 });
    console.error('[people] delete failed', { personId: params.personId });
    return NextResponse.json({ error: 'Could not remove this person. Nothing was changed.' }, { status: 500 });
  }
}
