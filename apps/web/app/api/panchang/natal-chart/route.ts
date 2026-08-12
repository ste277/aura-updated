import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { localDateTimeToUTC } from '../../../../lib/timezone';
import { getNatalChart, getTaraBala } from '../../../../../../packages/vedic/src/natalChart';
import { getNakshatra } from '../../../../../../packages/vedic/src/panchangElements';

function formatUTCDateString(dateInput: Date | string): string {
  if (typeof dateInput === 'string') {
    return dateInput.split('T')[0];
  }
  if (dateInput instanceof Date) {
    const y = dateInput.getUTCFullYear();
    const m = String(dateInput.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateInput.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(dateInput).split('T')[0];
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  if (!user.birthDate || !user.birthTime || !user.birthTimezone) {
    return NextResponse.json({ error: 'No birth profile set.' }, { status: 404 });
  }

  // Extract explicit calendar date without timezone shift
  const birthDateStr = formatUTCDateString(user.birthDate);

  const birthMomentUTC = localDateTimeToUTC(birthDateStr, user.birthTime, user.birthTimezone);

  const chart = getNatalChart(birthMomentUTC);
  const natalNakshatra = getNakshatra(birthMomentUTC);
  const taraBala = getTaraBala(natalNakshatra.index, new Date());

  const moonPlacement = chart.find((g) => g.graha === 'Moon')!;

  return NextResponse.json({
    // Raw user inputs passed back for display
    birthDate: birthDateStr,
    birthTime: user.birthTime,
    birthCityName: user.birthCityName || user.cityName || 'Chennai',

    // Calculated natal parameters
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