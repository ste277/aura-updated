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
    return new Date(year, month - 1, day, hours, mins, 0);
  };

  const sunrise = localMinutesToDate(ephemeris.sunriseMinutes);
  const sunset = localMinutesToDate(ephemeris.sunsetMinutes);
  const daylightMinutes = ephemeris.daylightMinutes;

  const eighthSegment = daylightMinutes / 8;
  const dayOfWeek = date.getDay(); // 0 = Sunday ... 6 = Saturday

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