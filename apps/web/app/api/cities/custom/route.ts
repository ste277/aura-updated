import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getCustomCitiesForUser, saveCustomCityForUser } from '../../../../lib/db';
import { isValidCustomLocation } from '../../../../lib/cities';
import { parseJsonObject } from '../../../../lib/request';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const cities = await getCustomCitiesForUser(session.userId);
  return NextResponse.json(cities);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const cityName = typeof body.cityName === 'string' ? body.cityName.trim() : '';
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : '';

  if (!cityName || !timezone || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: 'cityName, latitude, longitude, and timezone are required.' }, { status: 400 });
  }
  if (!isValidCustomLocation({ latitude, longitude, timezone })) {
    return NextResponse.json({ error: 'Invalid location. Check the coordinates and timezone name.' }, { status: 400 });
  }

  const saved = await saveCustomCityForUser(session.userId, {
    cityName,
    latitude,
    longitude,
    timezone,
  });

  return NextResponse.json(saved);
}
