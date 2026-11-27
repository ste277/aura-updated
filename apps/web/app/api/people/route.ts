import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { countSavedPeople, createSavedPerson, listSavedPeople, SAVED_PERSON_LIMIT_PER_OWNER } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { buildSavedPersonCreateInput } from '../../../lib/savedPersonRequest';
import { recordProductEvent } from '../../../lib/productEvents';
import { isMyPeopleEnabled } from '../../../lib/myPeopleGate';
import { toSavedPersonResponse } from '../../../lib/savedPersonView';
import { nextOccasionByPerson, userLocalToday } from '../../../lib/myPeopleRoutes';

/**
 * SavedPerson / My People -- LIST + CREATE. Every call is scoped to the
 * authenticated session's userId; db.ts's listSavedPeople()/
 * createSavedPerson() never accept or expose another user's rows (brief
 * section 3).
 *
 * AURA-MP-1: with My People OFF this is exactly the legacy contract (chart
 * details required to create; legacy response fields + hasChartDetails).
 * With it ON only the name is required, and the list adds each person's
 * next special day (design 4.1).
 */

// AURA-MP-1: the My People switch is read per request -- never prerender.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const enabled = isMyPeopleEnabled();
  const people = await listSavedPeople(session.userId);
  if (!enabled) return NextResponse.json(people.map((p) => toSavedPersonResponse(p, false)));

  const today = await userLocalToday(session.userId);
  const nextByPerson = today ? await nextOccasionByPerson(session.userId, people, today.date) : new Map();
  const rows = people.map((p) => {
    const next = nextByPerson.get(p.id);
    return {
      ...toSavedPersonResponse(p, true),
      nextOccasion: next ? { id: next.occasionId, kind: next.kind, label: next.label, date: next.date, daysUntil: next.daysUntil } : null,
    };
  });
  // Soonest special day first, then name (design 4.1).
  rows.sort((a, b) => {
    const da = a.nextOccasion?.daysUntil ?? Number.POSITIVE_INFINITY;
    const db = b.nextOccasion?.daysUntil ?? Number.POSITIVE_INFINITY;
    return da - db || a.name.localeCompare(b.name);
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const enabled = isMyPeopleEnabled();
  const validated = buildSavedPersonCreateInput(body, { myPeopleEnabled: enabled });
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  if ((await countSavedPeople(session.userId)) >= SAVED_PERSON_LIMIT_PER_OWNER) {
    return NextResponse.json({ error: `You can save up to ${SAVED_PERSON_LIMIT_PER_OWNER} people.` }, { status: 409 });
  }

  const person = await createSavedPerson(session.userId, validated.input);

  void recordProductEvent({
    eventName: 'SAVED_PERSON_CREATED',
    userId: session.userId,
    metadata: { relationshipType: person.relationshipType },
  });

  return NextResponse.json(toSavedPersonResponse(person, enabled), { status: 201 });
}
