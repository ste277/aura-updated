import { computeSolarEphemeris } from './ephemeris';

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

export function getDailySolarWindows(
  date: Date,
  latitude: number,
  longitude: number,
  tzOffsetMinutes: number = 330
): DailySolarWindows {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const ephemeris = computeSolarEphemeris({
    year,
    month,
    day,
    latitude,
    longitude,
    tzOffsetMinutes,
  });

  // Helper: Convert total local minutes from midnight into a clean Date object matching local time
  const localMinutesToDate = (totalMinutes: number) => {
    const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hours = Math.floor(wrapped / 60);
    const mins = wrapped % 60;
    // Construct local Date using local time components directly
    return new Date(year, month - 1, day, hours, mins, 0);
  };

  const sunrise = localMinutesToDate(ephemeris.sunriseMinutes);
  const sunset = localMinutesToDate(ephemeris.sunsetMinutes);
  const daylightMinutes = ephemeris.daylightMinutes;

  const eighthSegment = daylightMinutes / 8;
  const dayOfWeek = date.getDay();

  const rahuOffsets = [7, 1, 6, 4, 5, 2, 3];
  const gulikaOffsets = [6, 5, 4, 3, 2, 1, 0];
  const yamaOffsets = [4, 3, 2, 1, 0, 6, 5];

  const getEighthWindow = (offsetIndex: number) => {
    const startMins = ephemeris.sunriseMinutes + offsetIndex * eighthSegment;
    const endMins = startMins + eighthSegment;
    return {
      start: localMinutesToDate(startMins),
      end: localMinutesToDate(endMins),
    };
  };

  const brahmaStart = localMinutesToDate(ephemeris.sunriseMinutes - 96);
  const brahmaEnd = localMinutesToDate(ephemeris.sunriseMinutes - 48);

  const abhijitStart = localMinutesToDate(ephemeris.solarNoonMinutes - 24);
  const abhijitEnd = localMinutesToDate(ephemeris.solarNoonMinutes + 24);

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