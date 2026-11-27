import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { deleteSavedPerson, getSavedPersonForOwner, listPersonOccasions, updateSavedPerson } from '../../../../lib/db';
import { natalContextForSavedPerson } from '../../../../lib/savedPersonNatalContext';
import { parseJsonObject } from '../../../../lib/request';
import { buildSavedPersonUpdate } from '../../../../lib/savedPersonRequest';
import { isMyPeopleEnabled } from '../../../../lib/myPeopleGate';
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

export async function GET(req: NextRequest, { params }: { params: { personId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const person = await getSavedPersonForOwner(session.userId, params.personId);
  if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });

  const enabled = isMyPeopleEnabled();
  const natalContext = natalContextForSavedPerson(person);
  if (!enabled) return NextResponse.json({ ...toSavedPersonResponse(person, false), natalContext });

  const today = await userLocalToday(session.userId);
  const occasions = await listPersonOccasions(session.userId, person.id);
  return NextResponse.json({
    ...toSavedPersonResponse(person, true),
    natalContext,
    occasions: today ? occasions.map((o) => toOccasionResponse(o, today.date)) : [],
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { personId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const enabled = isMyPeopleEnabled();
  const validated = buildSavedPersonUpdate(body, { myPeopleEnabled: enabled });
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  try {
    const person = await updateSavedPerson(session.userId, params.personId, validated.update);
    return NextResponse.json(toSavedPersonResponse(person, enabled));
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'Person not found.') return NextResponse.json({ error: message }, { status: 404 });
    console.error('[people] update failed', { personId: params.personId });
    return NextResponse.json({ error: 'Could not update this person.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { personId: string } }) {
  const session = getSessionFromRequest(req);
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
