import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import {
  getUserById,
  listAllDailyReflectionsForExport,
  listAllHabitLogsForExport,
  listAllPlannedActivitiesForExport,
} from '../../../../lib/db';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const [user, habitLogs, plannedActivities, dailyReflections] = await Promise.all([
    getUserById(session.userId),
    listAllHabitLogsForExport(session.userId),
    listAllPlannedActivitiesForExport(session.userId),
    listAllDailyReflectionsForExport(session.userId),
  ]);

  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const exportedAt = new Date().toISOString();
  const payload = {
    exportedAt,
    profile: {
      id: user.id,
      email: user.email,
      cityName: user.cityName,
      latitude: user.latitude,
      longitude: user.longitude,
      timezone: user.timezone,
      birthDate: user.birthDate,
      birthTime: user.birthTime,
      birthCityName: user.birthCityName,
      birthLatitude: user.birthLatitude,
      birthLongitude: user.birthLongitude,
      birthTimezone: user.birthTimezone,
      createdAt: user.createdAt,
    },
    habitLogs,
    plannedActivities,
    dailyReflections,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="myauramoment-export-${exportedAt.slice(0, 10)}.json"`,
    },
  });
}
