import { computeSolarEphemeris } from './ephemeris';
import { getDatePartsInTimezone, localDateTimeToUTC, resolveTzOffsetMinutes } from '../../panchang/src/localDate';

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
 * `TZ=Asia/Calcutta`). At the time of this fix `tzOffsetMinutes` was an
 * external parameter feeding only the astronomical ephemeris calculation
 * below (computeSolarEphemeris's own contract, not touched by this fix);
 * see the later AURA PA-3B-R4 comment below for why it stopped being a
 * parameter at all.
 *
 * AURA PA-3B-R2: `ianaTimezone` is now a REQUIRED parameter (no default).
 * The only production caller (apps/web/app/api/calendar/feed/route.ts)
 * already supplies it explicitly alongside a consistent `tzOffsetMinutes`
 * for the same target location, so removing the previous
 * `'Asia/Kolkata'` default is a no-op for every current caller -- but a
 * default here was a latent footgun: a future caller could pass a
 * non-India `tzOffsetMinutes` while omitting `ianaTimezone`, silently
 * getting Kolkata-interpreted calendar-day components combined with a
 * mismatched ephemeris offset. Requiring the argument makes that mismatch
 * a compile-time error instead of a silent runtime one.
 *
 * AURA PA-3B-R4 (TZ-F1-01): `tzOffsetMinutes` is no longer a parameter at
 * all. The route handler used to sample it at HTTP *request* time
 * (`resolveTzOffsetMinutes(timezone, now)`) while this function's `date`
 * argument anchors a different instant (the target day's local noon) --
 * on a DST-transition day those two instants can straddle the transition,
 * so the offset fed to computeSolarEphemeris() was wrong by exactly the
 * DST delta for every one of the 7 returned events. Tracing
 * `tzOffsetMinutes`'s only use (computeSolarEphemeris's internal
 * `toLocalMinutes`) showed it exists purely to re-express already-computed
 * UTC-minute astronomical quantities as "minutes since local civil
 * midnight" -- a quantity this function immediately re-pairs with
 * `ianaTimezone` anyway (via `localMinutesToDate` below) to build the
 * actual returned `Date`s. So the offset was always informationally
 * redundant with `ianaTimezone`: there is no case where the *correct*
 * value of `tzOffsetMinutes` for this target day differs from what
 * `ianaTimezone` itself implies.
 *
 * The one real question (ticket's own: "do not assume one offset
 * represents every event on a DST-transition day") is WHICH instant to
 * resolve that offset at, since sunrise, sunset, Brahma Muhurtham, Abhijit
 * Muhurtham, and the three eighth-of-daylight windows (Rahu Kalam / Gulika
 * / Yama) are all genuinely different instants. This derives the offset at
 * the target day's own local noon (`localDateTimeToUTC(dateStr, '12:00',
 * ianaTimezone)`) -- chosen, and independently verified in
 * test/pa3bSolarWindowsTimezoneFix.test.ts across all 4 mandated DST
 * transition dates (America/New_York spring-forward/fall-back,
 * Australia/Adelaide spring-forward/fall-back), to equal the offset at the
 * actual sunrise, sunset, Brahma-start, and solar-noon instants on every
 * one of those dates: real DST transitions occur in the small hours
 * (01:00-03:00 local) and every one of the 7 solar-window events falls
 * between pre-dawn and dusk, so a transition can only separate "request
 * time" from "the target day" (TZ-F1-01's actual defect) -- never separate
 * the events of a single target day from one another. This is checked, not
 * assumed: if a future change to the event set or supported latitudes ever
 * violated it, the dedicated equality assertions in that test file would
 * fail.
 *
 * This is not a novel pattern: `resolveTzOffsetMinutes(timezone,
 * localDateTimeToUTC(dateStr, '12:00', timezone))` is the EXACT convention
 * packages/panchang/src/panchangDay.ts (the primary Panchangam production
 * path, see its own "DST-correct offset for this specific calendar date"
 * comment) and packages/recommendation/src/ceremonialPeriods.ts's
 * `sunriseInstantFor` already use for this identical purpose. This fix
 * brings getDailySolarWindows() into line with that already-reviewed,
 * already-trusted convention rather than inventing a new one.
 */
export function getDailySolarWindows(
  date: Date,
  latitude: number,
  longitude: number,
  ianaTimezone: string
): DailySolarWindows {
  const { year, month, day, weekday: dayOfWeek } = getDatePartsInTimezone(ianaTimezone, date);
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const tzOffsetMinutes = resolveTzOffsetMinutes(ianaTimezone, localDateTimeToUTC(dateStr, '12:00', ianaTimezone));

  const ephemeris = computeSolarEphemeris({
    year,
    month,
    day,
    latitude,
    longitude,
    tzOffsetMinutes,
  });

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