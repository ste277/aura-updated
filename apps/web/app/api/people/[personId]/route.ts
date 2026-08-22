import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { deleteSavedPerson, getSavedPersonForOwner, updateSavedPerson } from '../../../../lib/db';
import { getSavedPersonNatalContext } from '../../../../lib/savedPersonNatalContext';
import { parseJsonObject } from '../../../../lib/request';
import { buildSavedPersonInput } from '../../../../lib/savedPersonRequest';

/**
 * SavedPerson CRUD -- DETAIL + UPDATE + DELETE, all ownership-scoped via
 * getSavedPersonForOwner()/updateSavedPerson()/deleteSavedPerson() (brief
 * section 3) -- a request for another user's personId behaves identically
 * to a request for a nonexistent one (404), never leaking which is true.
 */

export async function GET(req: NextRequest, { params }: { params: { personId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const person = await getSavedPersonForOwner(session.userId, params.personId);
  if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });

  const natalContext = await getSavedPersonNatalContext(params.personId, session.userId);
  return NextResponse.json({ ...person, natalContext });
}

export async function PATCH(req: NextRequest, { params }: { params: { personId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const validated = buildSavedPersonInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  try {
    const person = await updateSavedPerson(session.userId, params.personId, validated.input);
    return NextResponse.json(person);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not update person.' }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { personId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    await deleteSavedPerson(session.userId, params.personId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not delete person.' }, { status: 404 });
  }
}
