import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { getTithi, getNakshatra, getYoga, getKarana, findNextTransition } from '../../../../../../packages/vedic/src/panchangElements';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const now = new Date();

  const tithi = getTithi(now);
  const nakshatra = getNakshatra(now);
  const yoga = getYoga(now);
  const karana = getKarana(now);

  const tithiEndsAt = findNextTransition(now, 'TITHI');
  const nakshatraEndsAt = findNextTransition(now, 'NAKSHATRA');
  const yogaEndsAt = findNextNamedTransition(now, (d) => getYoga(d).name, 36);
  const karanaEndsAt = findNextNamedTransition(now, (d) => getKarana(d).name, 15);
  const paksha = tithi.index <= 15 ? 'Shukla' : 'Krishna';

  return NextResponse.json({
    tithi: { paksha, name: tithi.name, endsAt: tithiEndsAt },
    nakshatra: { name: nakshatra.name, endsAt: nakshatraEndsAt },
    yoga: { name: yoga.name, endsAt: yogaEndsAt },
    karana: { name: karana.name, endsAt: karanaEndsAt },
  });
}

function findNextNamedTransition(
  start: Date,
  getName: (date: Date) => string,
  searchHours: number
): Date | null {
  const initialName = getName(start);
  const stepMs = 15 * 60 * 1000;
  const endMs = start.getTime() + searchHours * 60 * 60 * 1000;

  let low = start.getTime();
  for (let high = low + stepMs; high <= endMs; high += stepMs) {
    if (getName(new Date(high)) === initialName) {
      low = high;
      continue;
    }

    for (let i = 0; i < 20; i++) {
      const mid = Math.floor((low + high) / 2);
      if (getName(new Date(mid)) === initialName) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return new Date(high);
  }

  return null;
}
