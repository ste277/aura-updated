import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById, listPlannedActivities } from '../../../../lib/db';
import { getDatePartsInTimezone, getSecondOfDayInTimezone, resolveTzOffsetMinutes } from '../../../../lib/timezone';
import { getDailySolarWindows } from '../../../../../../packages/astronomy/src/solarWindows';

/**
 * AURA PA-3B: formats a Date's wall-clock fields AS SEEN IN `ianaTimezone`
 * (the real target-location zone, via Intl -- not the server process's own
 * `TZ`). Paired with `getDailySolarWindows`'s now-corrected UTC instants
 * (see that function's own PA-3B doc comment) so the visible local time in
 * the resulting `DTSTART;TZID=...`/`DTEND;TZID=...` lines below is still
 * correct -- previously both sides of this round-trip used server-local
 * `Date` getters/constructors and happened to cancel out only because they
 * used the identical (wrong) interpretation; fixing one side without this
 * would have broken the other.
 */
function formatLocalICSDate(d: Date, ianaTimezone: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const { year, month, day } = getDatePartsInTimezone(ianaTimezone, d);
  const secondOfDay = getSecondOfDayInTimezone(ianaTimezone, d);
  const hours = Math.floor(secondOfDay / 3600);
  const mins = Math.floor((secondOfDay % 3600) / 60);
  const secs = secondOfDay % 60;

  return `${year}${pad(month)}${pad(day)}T${pad(hours)}${pad(mins)}${pad(secs)}`;
}

function formatUTCICSDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeICSText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const user = await getUserById(session.userId);
  if (!user) {
    return new NextResponse('User not found', { status: 404 });
  }

  const now = new Date();
  const lat = user.latitude ?? 13.0827;
  const lng = user.longitude ?? 80.2707;
  const timezone = user.timezone || 'Asia/Kolkata';
  const tzOffsetMinutes = resolveTzOffsetMinutes(timezone, now);
  const localDate = getDatePartsInTimezone(timezone, now);
  const userLocalNoon = new Date(localDate.year, localDate.month - 1, localDate.day, 12, 0, 0);

  const windows = getDailySolarWindows(userLocalNoon, lat, lng, tzOffsetMinutes, timezone);
  const plans = await listPlannedActivities(session.userId);
  const upcomingPlans = plans.filter((plan) => {
    if (plan.status !== 'UPCOMING') return false;
    const start = new Date(plan.plannedStartAt).getTime();
    return Number.isFinite(start) && start >= now.getTime() - 60 * 60 * 1000;
  });

  const events = [
    { title: '✨ Brahma Muhurtham', start: windows.brahma.start, end: windows.brahma.end },
    { title: '☀️ Abhijit Muhurtham', start: windows.abhijit.start, end: windows.abhijit.end },
    { title: '⚠️ Rahu Kalam', start: windows.rahuKalam.start, end: windows.rahuKalam.end },
    { title: '🟣 Gulika Kalam', start: windows.gulika.start, end: windows.gulika.end },
    { title: '🟡 Yama Gandam', start: windows.yama.start, end: windows.yama.end },
  ];

  let icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AuraSchedule//Panchang Windows//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:AuraSchedule (${user.cityName ?? 'Local'})`,
    `X-WR-TIMEZONE:${timezone}`,
  ];

  for (const event of events) {
    const startStr = formatLocalICSDate(event.start, timezone);
    const endStr = formatLocalICSDate(event.end, timezone);
    const stampStr = formatLocalICSDate(now, timezone);

    icsContent.push(
      'BEGIN:VEVENT',
      `UID:${event.title.replace(/\s+/g, '_')}_${startStr}@auraschedule`,
      `DTSTAMP:${stampStr}`,
      `DTSTART;TZID=${timezone}:${startStr}`,
      `DTEND;TZID=${timezone}:${endStr}`,
      `SUMMARY:${escapeICSText(event.title)}`,
      `DESCRIPTION:${escapeICSText(`Solar timing window for ${user.cityName ?? 'your location'}`)}`,
      'END:VEVENT'
    );
  }

  for (const plan of upcomingPlans) {
    const startStr = formatUTCICSDate(new Date(plan.plannedStartAt));
    const endStr = formatUTCICSDate(new Date(plan.plannedEndAt));
    const stampStr = formatUTCICSDate(now);
    const windowText = plan.windowLabel || plan.windowType || 'Aura planned moment';
    const description = [
      `Aura planned activity in ${windowText}.`,
      plan.matchLabel ? `Match: ${plan.matchLabel}.` : '',
      plan.recommendation || '',
    ].filter(Boolean).join('\n');

    icsContent.push(
      'BEGIN:VEVENT',
      `UID:aura-plan-${plan.id}@auraschedule`,
      `DTSTAMP:${stampStr}`,
      `DTSTART:${startStr}`,
      `DTEND:${endStr}`,
      `SUMMARY:${escapeICSText(`✨ ${plan.title}`)}`,
      `DESCRIPTION:${escapeICSText(description)}`,
      'CATEGORIES:AuraSchedule,Planned Activity',
      'END:VEVENT'
    );
  }

  icsContent.push('END:VCALENDAR');

  return new NextResponse(icsContent.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="auraschedule-${user.cityName ?? 'location'}.ics"`,
    },
  });
}
