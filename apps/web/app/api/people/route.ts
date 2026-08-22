import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { createSavedPerson, listSavedPeople } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { buildSavedPersonInput } from '../../../lib/savedPersonRequest';
import { recordProductEvent } from '../../../lib/productEvents';

/**
 * SavedPerson CRUD -- LIST + CREATE. Every call is scoped to the
 * authenticated session's userId; db.ts's listSavedPeople()/
 * createSavedPerson() never accept or expose another user's rows (brief
 * section 3).
 */

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const people = await listSavedPeople(session.userId);
  return NextResponse.json(people);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const validated = buildSavedPersonInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  const person = await createSavedPerson(session.userId, validated.input);

  void recordProductEvent({
    eventName: 'SAVED_PERSON_CREATED',
    userId: session.userId,
    metadata: { relationshipType: person.relationshipType },
  });

  return NextResponse.json(person, { status: 201 });
}
