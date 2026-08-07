import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { updateBirthProfile } from '../../../../lib/db';
import { isValidCustomLocation } from '../../../../lib/cities';

export async function PATCH(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { birthDate, birthTime, birthCityName, birthLatitude, birthLongitude, birthTimezone } = await req.json();

  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return NextResponse.json({ error: 'birthDate must be YYYY-MM-DD.' }, { status: 400 });
  }
  if (!birthTime || !/^\d{2}:\d{2}$/.test(birthTime)) {
    return NextResponse.json({ error: 'birthTime must be HH:MM (24h).' }, { status: 400 });
  }
  if (!birthCityName) {
    return NextResponse.json({ error: 'birthCityName is required.' }, { status: 400 });
  }
  if (!isValidCustomLocation({ latitude: Number(birthLatitude), longitude: Number(birthLongitude), timezone: birthTimezone })) {
    return NextResponse.json({ error: 'Invalid birth location or timezone.' }, { status: 400 });
  }

  const user = await updateBirthProfile(session.userId, {
    birthDate,
    birthTime,
    birthCityName,
    birthLatitude: Number(birthLatitude),
    birthLongitude: Number(birthLongitude),
    birthTimezone,
  });

  return NextResponse.json(user);
}
