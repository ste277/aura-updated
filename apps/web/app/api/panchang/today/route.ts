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

  const tithiEndsAt = findNextTransition(now, (d) => getTithi(d).name);
  const nakshatraEndsAt = findNextTransition(now, (d) => getNakshatra(d).name);
  const yogaEndsAt = findNextTransition(now, (d) => getYoga(d).name);
  const karanaEndsAt = findNextTransition(now, (d) => getKarana(d).name, 15); // karanas are ~6h, shorter search window

  return NextResponse.json({
    tithi: { paksha: tithi.paksha, name: tithi.name, endsAt: tithiEndsAt },
    nakshatra: { name: nakshatra.name, endsAt: nakshatraEndsAt },
    yoga: { name: yoga.name, endsAt: yogaEndsAt },
    karana: { name: karana.name, endsAt: karanaEndsAt },
  });
}
