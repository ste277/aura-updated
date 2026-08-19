import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { updateBirthProfile, saveCustomCityForUser } from '../../../../lib/db';
import { isValidCustomLocation } from '../../../../lib/cities';
import { parseJsonObject } from '../../../../lib/request';

export async function PATCH(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const birthDate = typeof body.birthDate === 'string' ? body.birthDate.trim() : '';
  const birthTime = typeof body.birthTime === 'string' ? body.birthTime.trim() : '';
  const birthCityName = typeof body.birthCityName === 'string' ? body.birthCityName.trim() : '';
  const birthTimezone = typeof body.birthTimezone === 'string' ? body.birthTimezone.trim() : '';
  const birthLatitude = body.birthLatitude;
  const birthLongitude = body.birthLongitude;

  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return NextResponse.json({ error: 'birthDate must be YYYY-MM-DD.' }, { status: 400 });
  }
  if (!birthTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(birthTime)) {
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
    birthDate,
  });
}
