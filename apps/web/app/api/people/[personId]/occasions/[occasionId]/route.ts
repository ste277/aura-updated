import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/session';
import { deletePersonOccasion, PersonOccasionConflictError, PersonOccasionInvalidError, updatePersonOccasion } from '../../../../../../lib/db';
import { parseJsonObject } from '../../../../../../lib/request';
import { parsePersonOccasionFields, validatePersonOccasion } from '../../../../../../lib/savedPersonRequest';
import { isMyPeopleServerEnabled } from '../../../../../../lib/myPeopleGate';
import { toOccasionResponse, userLocalToday } from '../../../../../../lib/myPeopleRoutes';

/**
 * AURA-MP-1 -- one special day: partial UPDATE + DELETE. 404 while My
 * People is disabled on the SERVER. Scoped by owner AND person: an occasion
 * id that belongs to another user, or to a different person, is a 404.
 * R1 F4: the update is ONE locked read-merge-validate-write (db.ts), so
 * concurrent partial updates can never persist a contradictory date.
 */

// AURA-MP-1: the switch is read per request -- never prerender this route
// at build time (a build-time 404 would outlive turning the switch on).
export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 });

export async function PATCH(req: NextRequest, { params }: { params: { personId: string; occasionId: string } }) {
  if (!isMyPeopleServerEnabled()) return notFound();
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });
  const parsed = parsePersonOccasionFields(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const today = await userLocalToday(session.userId);
  if (!today) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const occasion = await updatePersonOccasion(session.userId, params.personId, params.occasionId, parsed.update, (merged) => validatePersonOccasion(merged, today.year)?.error ?? null);
    if (!occasion) return NextResponse.json({ error: 'Special day not found.' }, { status: 404 });
    return NextResponse.json(toOccasionResponse(occasion, today.date));
  } catch (err) {
    if (err instanceof PersonOccasionInvalidError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof PersonOccasionConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('[people] special day update failed');
    return NextResponse.json({ error: 'Could not update this special day.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { personId: string; occasionId: string } }) {
  if (!isMyPeopleServerEnabled()) return notFound();
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const deleted = await deletePersonOccasion(session.userId, params.personId, params.occasionId);
  if (!deleted) return NextResponse.json({ error: 'Special day not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
