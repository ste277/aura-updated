import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { calculateDailyTransits } from '../../../../../../packages/vedic/src/transits';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const user = await getUserById(session.userId);
  if (!user || !user.birthDate || !user.birthTime) {
    return NextResponse.json({ error: 'Birth profile incomplete.' }, { status: 400 });
  }

  const birthDateTime = new Date(`${user.birthDate.toISOString().slice(0, 10)}T${user.birthTime}:00Z`);

  const transits = calculateDailyTransits(
    birthDateTime,
    user.birthLatitude ?? 13.0827,
    user.birthLongitude ?? 80.2707,
    new Date(),
    user.latitude,
    user.longitude
  );

  return NextResponse.json(transits);
}