import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { localDateTimeToUTC } from '../../../../lib/timezone';
import { getNatalChart, getTaraBala } from '../../../../../../packages/vedic/src/natalChart';
import { getNakshatra } from '../../../../../../packages/vedic/src/panchangElements';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  if (!user.birthDate || !user.birthTime || !user.birthTimezone) {
    return NextResponse.json({ error: 'No birth profile set.' }, { status: 404 });
  }

  const birthDateStr = user.birthDate.toISOString().slice(0, 10);
  const birthMomentUTC = localDateTimeToUTC(birthDateStr, user.birthTime, user.birthTimezone);

  const chart = getNatalChart(birthMomentUTC);
  const natalNakshatra = getNakshatra(birthMomentUTC);
  const taraBala = getTaraBala(natalNakshatra.index, new Date());

  const moonPlacement = chart.find((g) => g.graha === 'Moon')!;

  return NextResponse.json({
    janmaRashi: moonPlacement.rashiName,
    janmaNakshatra: natalNakshatra.name,
    chart: chart.map((g) => ({
      graha: g.graha,
      rashiName: g.rashiName,
      degreeInRashi: Math.round(g.degreeInRashi * 100) / 100,
    })),
    taraBala,
  });
}
