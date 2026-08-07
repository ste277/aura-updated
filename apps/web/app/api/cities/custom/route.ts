import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getCustomCitiesForUser, saveCustomCityForUser } from '../../../../lib/db'; // or lib/prisma-db

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

  const { cityName, latitude, longitude, timezone } = await req.json();

  if (!cityName || latitude == null || longitude == null || !timezone) {
    return NextResponse.json({ error: 'cityName, latitude, longitude, and timezone are required.' }, { status: 400 });
  }

  const saved = await saveCustomCityForUser(session.userId, {
    cityName,
    latitude: Number(latitude),
    longitude: Number(longitude),
    timezone,
  });

  return NextResponse.json(saved);
}