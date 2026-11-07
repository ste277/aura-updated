import { computeSolarEphemeris } from './ephemeris';
import { getDatePartsInTimezone, localDateTimeToUTC } from '../../panchang/src/localDate';

export interface SolarWindow {
  start: Date;
  end: Date;
}

export interface DailySolarWindows {
  sunrise: Date;
  sunset: Date;
  brahma: SolarWindow;
  abhijit: SolarWindow;
  rahuKalam: SolarWindow;
  gulika: SolarWindow;
  yama: SolarWindow;
}

/**
 * AURA PA-3B: `date`'s calendar day and every returned `Date`'s UTC instant
 * are both resolved in `ianaTimezone` -- the target location's real IANA
 * zone, not the server process's own `TZ` -- via the same
 * `getDatePartsInTimezone`/`localDateTimeToUTC` utilities the primary
 * Panchangam path (packages/panchang/src/panchangDay.ts,
 * packages/recommendation/src/ceremonialPeriods.ts) already uses as their
 * single source of truth for this exact conversion. Previously this
 * function built every returned `Date` via `new Date(year, month-1, day,
 * hours, mins, 0)`, which is interpreted in the server's own local
 * timezone -- the same (date, location) could therefore resolve to a
 * genuinely different absolute UTC instant depending on process `TZ` (a
 * confirmed ~330-minute discrepancy for New Delhi under `TZ=UTC` vs.
 * `TZ=Asia/Calcutta`). `tzOffsetMinutes` is unchanged and still feeds only
 * the astronomical ephemeris calculation below (computeSolarEphemeris's
 * own contract, not touched by this fix).
 */
export function getDailySolarWindows(
  date: Date,
  latitude: number,
  longitude: number,
  tzOffsetMinutes: number = 330,
  ianaTimezone: string = 'Asia/Kolkata'
): DailySolarWindows {
  const { year, month, day, weekday: dayOfWeek } = getDatePartsInTimezone(ianaTimezone, date);

  const ephemeris = computeSolarEphemeris({
    year,
    month,
    day,
    latitude,
    longitude,
    tzOffsetMinutes,
  });

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Helper: convert total local minutes from midnight (for this calendar
  // day, in ianaTimezone) into the correct absolute UTC instant -- see the
  // function-level doc comment above.
  const localMinutesToDate = (totalMinutes: number) => {
    const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hours = Math.floor(wrapped / 60);
    const mins = wrapped % 60;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    return localDateTimeToUTC(dateStr, timeStr, ianaTimezone);
  };

  const sunrise = localMinutesToDate(ephemeris.sunriseMinutes);
  const sunset = localMinutesToDate(ephemeris.sunsetMinutes);
  const daylightMinutes = ephemeris.daylightMinutes;

  const eighthSegment = daylightMinutes / 8;

  // Fixed 0-based segment offsets (0 = 1st segment, 7 = 8th segment)
  const rahuOffsets = [7, 1, 6, 4, 5, 3, 2];   // Sun(7), Mon(1), Tue(6), Wed(4), Thu(5), Fri(3), Sat(2)
  const gulikaOffsets = [6, 5, 4, 3, 2, 1, 0]; // Sun(6), Mon(5), Tue(4), Wed(3), Thu(2), Fri(1), Sat(0)
  const yamaOffsets = [4, 3, 2, 1, 0, 5, 6];   // Sun(4), Mon(3), Tue(2), Wed(1), Thu(0), Fri(5), Sat(6)

  const getEighthWindow = (offsetIndex: number) => {
    const startMins = ephemeris.sunriseMinutes + offsetIndex * eighthSegment;
    const endMins = startMins + eighthSegment;
    return {
      start: localMinutesToDate(startMins),
      end: localMinutesToDate(endMins),
    };
  };

  // Brahma Muhurtham: 96 mins to 48 mins before sunrise
  const brahmaStart = localMinutesToDate(ephemeris.sunriseMinutes - 96);
  const brahmaEnd = localMinutesToDate(ephemeris.sunriseMinutes - 48);

  // Abhijit Muhurtham: 8th Muhurta out of 15 equal daytime divisions centered around Solar Noon
  const abhijitHalfWindow = daylightMinutes / 30; // 15 Muhurtas total -> 1 Muhurta = daylight / 15 -> half = daylight / 30
  const abhijitStart = localMinutesToDate(ephemeris.solarNoonMinutes - abhijitHalfWindow);
  const abhijitEnd = localMinutesToDate(ephemeris.solarNoonMinutes + abhijitHalfWindow);

  return {
    sunrise,
    sunset,
    brahma: { start: brahmaStart, end: brahmaEnd },
    abhijit: { start: abhijitStart, end: abhijitEnd },
    rahuKalam: getEighthWindow(rahuOffsets[dayOfWeek]),
    gulika: getEighthWindow(gulikaOffsets[dayOfWeek]),
    yama: getEighthWindow(yamaOffsets[dayOfWeek]),
  };
}