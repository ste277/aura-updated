import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { getDailySolarWindows } from '../../../../../../packages/astronomy/src/solarWindows';

/** Formats a Date object into local YYYYMMDDTHHMMSS format without conversion */
function formatLocalICSDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  const secs = pad(d.getSeconds());

  return `${year}${month}${day}T${hours}${mins}${secs}`;
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
  const tzOffsetMinutes = 330; // IST (+5:30)

  const windows = getDailySolarWindows(now, lat, lng, tzOffsetMinutes);

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
    'X-WR-TIMEZONE:Asia/Kolkata',
  ];

  for (const event of events) {
    const startStr = formatLocalICSDate(event.start);
    const endStr = formatLocalICSDate(event.end);
    const stampStr = formatLocalICSDate(now);

    icsContent.push(
      'BEGIN:VEVENT',
      `UID:${event.title.replace(/\s+/g, '_')}_${startStr}@auraschedule`,
      `DTSTAMP:${stampStr}`,
      `DTSTART;TZID=Asia/Kolkata:${startStr}`,
      `DTEND;TZID=Asia/Kolkata:${endStr}`,
      `SUMMARY:${event.title}`,
      `DESCRIPTION:Solar timing window for ${user.cityName ?? 'your location'}`,
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