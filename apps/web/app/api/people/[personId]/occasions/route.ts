import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, SESSION_UNAVAILABLE, sessionUnavailableResponse } from '../../../../../lib/session';
import {
  createPersonOccasion,
  getSavedPersonForOwner,
  listPersonOccasions,
  PersonOccasionConflictError,
  PersonOccasionInvalidError,
  PersonOccasionLimitError,
} from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { buildPersonOccasionInput } from '../../../../../lib/savedPersonRequest';
import { isMyPeopleServerEnabled } from '../../../../../lib/myPeopleGate';
import { toOccasionResponse, userLocalToday } from '../../../../../lib/myPeopleRoutes';

/**
 * AURA-MP-1 -- a person's special days: LIST + CREATE. 404 while My People
 * is disabled on the SERVER (rows stay in the database). Owner-scoped:
 * another user's person behaves exactly like a missing one (404).
 * R1 F4: the per-person limit is enforced inside the create transaction.
 */

// AURA-MP-1: the switch is read per request -- never prerender this route
// at build time (a build-time 404 would outlive turning the switch on).
export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: { personId: string } }) {
  if (!isMyPeopleServerEnabled()) return notFound();
  const session = await getSessionFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const person = await getSavedPersonForOwner(session.userId, params.personId);
  if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  const today = await userLocalToday(session.userId);
  if (!today) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const occasions = await listPersonOccasions(session.userId, person.id);
  return NextResponse.json(occasions.map((o) => toOccasionResponse(o, today.date)));
}

export async function POST(req: NextRequest, { params }: { params: { personId: string } }) {
  if (!isMyPeopleServerEnabled()) return notFound();
  const session = await getSessionFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const today = await userLocalToday(session.userId);
  if (!today) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const validated = buildPersonOccasionInput(body, today.year);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  try {
    const occasion = await createPersonOccasion(session.userId, params.personId, validated.input);
    if (!occasion) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
    return NextResponse.json(toOccasionResponse(occasion, today.date), { status: 201 });
  } catch (err) {
    if (err instanceof PersonOccasionLimitError || err instanceof PersonOccasionConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof PersonOccasionInvalidError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[people] special day create failed');
    return NextResponse.json({ error: 'Could not save this special day.' }, { status: 500 });
  }
}
