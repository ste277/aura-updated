import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { updateUserLocation } from '../../../../lib/db';
import { findCity, isValidCustomLocation } from '../../../../lib/cities';

export async function PATCH(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await req.json();

  // Path 1: a curated city was picked.
  if (body.cityName && !body.custom) {
    const city = findCity(body.cityName);
    if (!city) {
      return NextResponse.json({ error: 'Unknown city.' }, { status: 400 });
    }
    const user = await updateUserLocation(session.userId, city);
    return NextResponse.json(user);
  }

  // Path 2: a fully custom location (anywhere not on the curated list).
  const { cityName, latitude, longitude, timezone } = body.custom ?? body;
  if (!cityName || latitude == null || longitude == null || !timezone) {
    return NextResponse.json({ error: 'cityName, latitude, longitude, and timezone are required.' }, { status: 400 });
  }
  if (!isValidCustomLocation({ latitude: Number(latitude), longitude: Number(longitude), timezone })) {
    return NextResponse.json(
      { error: 'Invalid location. Check the coordinates and timezone name (e.g. "America/Chicago").' },
      { status: 400 }
    );
  }

  const user = await updateUserLocation(session.userId, {
    cityName,
    latitude: Number(latitude),
    longitude: Number(longitude),
    timezone,
  });
  return NextResponse.json(user);
}
