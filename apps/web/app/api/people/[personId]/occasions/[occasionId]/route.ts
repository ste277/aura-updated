import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/session';
import { deletePersonOccasion, getPersonOccasionForOwner, PersonOccasionConflictError, updatePersonOccasion } from '../../../../../../lib/db';
import { parseJsonObject } from '../../../../../../lib/request';
import { parsePersonOccasionFields, validatePersonOccasion } from '../../../../../../lib/savedPersonRequest';
import { isMyPeopleEnabled } from '../../../../../../lib/myPeopleGate';
import { toOccasionResponse, userLocalToday } from '../../../../../../lib/myPeopleRoutes';

/**
 * AURA-MP-1 -- one special day: partial UPDATE + DELETE. 404 while My
 * People is switched off. Scoped by owner AND person: an occasion id that
 * belongs to another user, or to a different person, is a 404.
 */

// AURA-MP-1: the switch is read per request -- never prerender this route
// at build time (a build-time 404 would outlive turning the switch on).
export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 });

export async function PATCH(req: NextRequest, { params }: { params: { personId: string; occasionId: string } }) {
  if (!isMyPeopleEnabled()) return notFound();
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });
  const parsed = parsePersonOccasionFields(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const today = await userLocalToday(session.userId);
  if (!today) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const existing = await getPersonOccasionForOwner(session.userId, params.personId, params.occasionId);
  if (!existing || existing.month == null || existing.day == null) return NextResponse.json({ error: 'Special day not found.' }, { status: 404 });

  // Validate the MERGED result, so cross-field rules (29 Feb + year, label for OTHER) always hold.
  const merged = {
    kind: parsed.update.kind ?? existing.kind,
    label: parsed.update.label !== undefined ? parsed.update.label : existing.label,
    month: parsed.update.month ?? existing.month,
    day: parsed.update.day ?? existing.day,
    year: parsed.update.year !== undefined ? parsed.update.year : existing.year,
    remindDaysBefore: parsed.update.remindDaysBefore !== undefined ? parsed.update.remindDaysBefore : existing.remindDaysBefore,
  };
  const invalid = validatePersonOccasion(merged, today.year);
  if (invalid) return NextResponse.json({ error: invalid.error }, { status: invalid.status });

  try {
    const occasion = await updatePersonOccasion(session.userId, params.personId, params.occasionId, parsed.update);
    if (!occasion) return NextResponse.json({ error: 'Special day not found.' }, { status: 404 });
    return NextResponse.json(toOccasionResponse(occasion, today.date));
  } catch (err) {
    if (err instanceof PersonOccasionConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { personId: string; occasionId: string } }) {
  if (!isMyPeopleEnabled()) return notFound();
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const deleted = await deletePersonOccasion(session.userId, params.personId, params.occasionId);
  if (!deleted) return NextResponse.json({ error: 'Special day not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
