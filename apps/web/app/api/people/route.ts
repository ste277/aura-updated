import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { createSavedPersonWithinLimit, listSavedPeople, SavedPersonLimitError } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { buildSavedPersonCreateInput } from '../../../lib/savedPersonRequest';
import { recordProductEvent } from '../../../lib/productEvents';
import { isMyPeopleServerEnabled, MY_PEOPLE_CAPABILITY_HEADER, myPeopleCapabilityHeaderValue } from '../../../lib/myPeopleGate';
import { toSavedPersonListItem, toSavedPersonResponse } from '../../../lib/savedPersonView';
import { nextOccasionByPerson, userLocalToday } from '../../../lib/myPeopleRoutes';

/**
 * SavedPerson / My People -- LIST + CREATE. Every call is scoped to the
 * authenticated session's userId; db.ts never accepts or exposes another
 * user's rows (brief section 3).
 *
 * AURA-MP-1 (R1): every decision uses the AUTHORITATIVE server flag
 * (isMyPeopleServerEnabled, AURA_MY_PEOPLE_ENABLED); the public flag never
 * reaches here. The response carries `x-aura-my-people: enabled|disabled` so
 * the client only presents My People when the server confirms it.
 *   - Disabled: exactly the legacy contract (chart details required to create;
 *     legacy list fields + hasChartDetails).
 *   - Enabled: only the name is required; the list is the design 4.1 item
 *     (no notes, no detailed birth fields) with each person's next special day.
 */

// AURA-MP-1: the My People switch is read per request -- never prerender.
export const dynamic = 'force-dynamic';

const withCapability = (res: NextResponse, enabled: boolean) => {
  res.headers.set(MY_PEOPLE_CAPABILITY_HEADER, myPeopleCapabilityHeaderValue(enabled));
  return res;
};

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const enabled = isMyPeopleServerEnabled();
  const people = await listSavedPeople(session.userId);
  if (!enabled) return withCapability(NextResponse.json(people.map((p) => toSavedPersonResponse(p, false))), false);

  const today = await userLocalToday(session.userId);
  const nextByPerson = today ? await nextOccasionByPerson(session.userId, people, today.date) : new Map();
  const rows = people.map((p) => {
    const next = nextByPerson.get(p.id);
    return toSavedPersonListItem(p, next ? { id: next.occasionId, kind: next.kind, label: next.label, date: next.date, daysUntil: next.daysUntil } : null);
  });
  // Soonest special day first, then name (design 4.1).
  rows.sort((a, b) => {
    const da = a.nextOccasion?.daysUntil ?? Number.POSITIVE_INFINITY;
    const db = b.nextOccasion?.daysUntil ?? Number.POSITIVE_INFINITY;
    return da - db || a.name.localeCompare(b.name);
  });
  return withCapability(NextResponse.json(rows), true);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const enabled = isMyPeopleServerEnabled();
  const validated = buildSavedPersonCreateInput(body, { myPeopleEnabled: enabled });
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  let person;
  try {
    // R1 F4: the count and the insert are one transaction under the owner's lock.
    person = await createSavedPersonWithinLimit(session.userId, validated.input);
  } catch (err) {
    if (err instanceof SavedPersonLimitError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('[people] create failed');
    return NextResponse.json({ error: 'Could not save this person.' }, { status: 500 });
  }

  void recordProductEvent({
    eventName: 'SAVED_PERSON_CREATED',
    userId: session.userId,
    metadata: { relationshipType: person.relationshipType },
  });

  return withCapability(NextResponse.json(toSavedPersonResponse(person, enabled), { status: 201 }), enabled);
}
