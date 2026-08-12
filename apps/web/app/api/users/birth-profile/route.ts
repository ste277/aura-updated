import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { updateBirthProfile, saveCustomCityForUser } from '../../../../lib/db';
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

  const latNum = Number(birthLatitude);
  const lngNum = Number(birthLongitude);

  if (!isValidCustomLocation({ latitude: latNum, longitude: lngNum, timezone: birthTimezone })) {
    return NextResponse.json({ error: 'Invalid birth location or timezone.' }, { status: 400 });
  }

  // Persist the custom birth location into CustomCity table so it stays in user's saved cities
  await saveCustomCityForUser(session.userId, {
    cityName: birthCityName,
    latitude: latNum,
    longitude: lngNum,
    timezone: birthTimezone,
  });

  const user = await updateBirthProfile(session.userId, {
    birthDate,
    birthTime,
    birthCityName,
    birthLatitude: latNum,
    birthLongitude: lngNum,
    birthTimezone,
  });

  return NextResponse.json({
    ...user,
    birthDate: birthDate, // Return exact YYYY-MM-DD string back in API response
  });
}
