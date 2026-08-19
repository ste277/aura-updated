import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { updateUserLocation, saveCustomCityForUser } from '../../../../lib/db';
import { findCity, isValidCustomLocation } from '../../../../lib/cities';
import { parseJsonObject } from '../../../../lib/request';

export async function PATCH(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  // Path 1: a curated city was picked.
  if (typeof body.cityName === 'string' && !body.custom) {
    const city = findCity(body.cityName.trim());
    if (!city) {
      return NextResponse.json({ error: 'Unknown city.' }, { status: 400 });
    }
    const user = await updateUserLocation(session.userId, city);
    return NextResponse.json(user);
  }

  // Path 2: a fully custom location (anywhere not on the curated list).
  const source = body.custom && typeof body.custom === 'object' && !Array.isArray(body.custom)
    ? body.custom as Record<string, unknown>
    : body;
  const cityName = typeof source.cityName === 'string' ? source.cityName.trim() : '';
  const latitude = source.latitude;
  const longitude = source.longitude;
  const timezone = typeof source.timezone === 'string' ? source.timezone.trim() : '';
  if (!cityName || latitude == null || longitude == null || !timezone) {
    return NextResponse.json(
      { error: 'cityName, latitude, longitude, and timezone are required.' },
      { status: 400 }
    );
  }

  const numLat = Number(latitude);
  const numLng = Number(longitude);

  if (!isValidCustomLocation({ latitude: numLat, longitude: numLng, timezone })) {
    return NextResponse.json(
      { error: 'Invalid location. Check the coordinates and timezone name (e.g. "America/Chicago").' },
      { status: 400 }
    );
  }

  // 1. Save custom location to CustomCity table so it appears in the user's city list
  await saveCustomCityForUser(session.userId, {
    cityName,
    latitude: numLat,
    longitude: numLng,
    timezone,
  });

  // 2. Set as active location on the user profile
  const user = await updateUserLocation(session.userId, {
    cityName,
    latitude: numLat,
    longitude: numLng,
    timezone,
  });

  return NextResponse.json(user);
}
