import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, SESSION_UNAVAILABLE, sessionUnavailableResponse } from '../../../../lib/session';
import {
  getUserById,
  listAllDailyReflectionsForExport,
  listAllHabitLogsForExport,
  listAllPlannedActivitiesForExport,
  listAllSavedPeopleForExport,
  toPeopleExportPayload,
} from '../../../../lib/db';

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const [user, habitLogs, plannedActivities, dailyReflections, people] = await Promise.all([
    getUserById(session.userId),
    listAllHabitLogsForExport(session.userId),
    listAllPlannedActivitiesForExport(session.userId),
    listAllDailyReflectionsForExport(session.userId),
    // AURA-MP-1: the user's people, with chart details (when present), My
    // People fields, private notes and special days. Owner-scoped; exported
    // whether or not My People is switched on (it is the user's own data).
    // Derived natal context is never stored, so never exported.
    listAllSavedPeopleForExport(session.userId),
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
    // R1: ownerUserId omitted at every level (person and nested special day).
    people: toPeopleExportPayload(people),
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="myauramoment-export-${exportedAt.slice(0, 10)}.json"`,
    },
  });
}
