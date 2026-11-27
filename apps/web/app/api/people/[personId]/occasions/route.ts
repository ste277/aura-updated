import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import {
  countPersonOccasions,
  createPersonOccasion,
  getSavedPersonForOwner,
  listPersonOccasions,
  PERSON_OCCASION_LIMIT_PER_PERSON,
  PersonOccasionConflictError,
} from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { buildPersonOccasionInput } from '../../../../../lib/savedPersonRequest';
import { isMyPeopleEnabled } from '../../../../../lib/myPeopleGate';
import { toOccasionResponse, userLocalToday } from '../../../../../lib/myPeopleRoutes';

/**
 * AURA-MP-1 -- a person's special days: LIST + CREATE. 404 while My People
 * is switched off (rows stay in the database). Owner-scoped: another user's
 * person behaves exactly like a missing one (404).
 */

// AURA-MP-1: the switch is read per request -- never prerender this route
// at build time (a build-time 404 would outlive turning the switch on).
export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: { personId: string } }) {
  if (!isMyPeopleEnabled()) return notFound();
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const person = await getSavedPersonForOwner(session.userId, params.personId);
  if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  const today = await userLocalToday(session.userId);
  if (!today) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const occasions = await listPersonOccasions(session.userId, person.id);
  return NextResponse.json(occasions.map((o) => toOccasionResponse(o, today.date)));
}

export async function POST(req: NextRequest, { params }: { params: { personId: string } }) {
  if (!isMyPeopleEnabled()) return notFound();
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const today = await userLocalToday(session.userId);
  if (!today) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const validated = buildPersonOccasionInput(body, today.year);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  const person = await getSavedPersonForOwner(session.userId, params.personId);
  if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  if ((await countPersonOccasions(session.userId, person.id)) >= PERSON_OCCASION_LIMIT_PER_PERSON) {
    return NextResponse.json({ error: `Up to ${PERSON_OCCASION_LIMIT_PER_PERSON} special days per person.` }, { status: 409 });
  }

  try {
    const occasion = await createPersonOccasion(session.userId, person.id, validated.input);
    if (!occasion) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
    return NextResponse.json(toOccasionResponse(occasion, today.date), { status: 201 });
  } catch (err) {
    if (err instanceof PersonOccasionConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
