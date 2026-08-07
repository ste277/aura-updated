/**
 * Dynamic panchang window partitioners.
 * Pure functions on top of packages/astronomy's SolarResult — no I/O, no DB.
 */

import type { SolarResult } from '../../astronomy/src/ephemeris';

export type SolarWindowType =
  | 'BRAHMA'
  | 'ABHIJIT'
  | 'RAHU_KALAM'
  | 'GULIKA'
  | 'YAMA'
  | 'NEUTRAL';

export interface WindowSpan {
  type: SolarWindowType;
  label: string;
  startMinutes: number; // local clock, 0-1439
  endMinutes: number; // local clock, 0-1439
}

/** 0 = Sunday ... 6 = Saturday, matching JS Date#getDay(). */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Each weekday has a fixed 1/8th-daytime-segment index (0-7) for Rahu Kalam,
// Gulika Kalam, and Yama Gandam. These are the traditional segment assignments.
// Segment 0 = first 1/8th of daylight after sunrise, segment 7 = last 1/8th before sunset.
const RAHU_KALAM_SEGMENT: Record<WeekdayIndex, number> = {
  0: 7, // Sunday
  1: 1, // Monday
  2: 6, // Tuesday
  3: 4, // Wednesday
  4: 5, // Thursday
  5: 3, // Friday
  6: 2, // Saturday
};

const GULIKA_KALAM_SEGMENT: Record<WeekdayIndex, number> = {
  0: 6,
  1: 5,
  2: 4,
  3: 3,
  4: 2,
  5: 1,
  6: 0,
};

const YAMA_GANDAM_SEGMENT: Record<WeekdayIndex, number> = {
  0: 4,
  1: 3,
  2: 2,
  3: 1,
  4: 0,
  5: 6,
  6: 5,
};

function segmentSpan(
  sunrise: number,
  daylight: number,
  segmentIndex: number
): { start: number; end: number } {
  const eighth = daylight / 8;
  const start = sunrise + eighth * segmentIndex;
  const end = start + eighth;
  return { start, end };
}

/**
 * Computes all five panchang windows for a given day's solar ephemeris.
 * `weekday` must be the local weekday (0=Sun..6=Sat) of the date the
 * ephemeris was computed for.
 */
export function computePanchangWindows(
  solar: SolarResult,
  weekday: WeekdayIndex
): WindowSpan[] {
  const { sunriseMinutes, sunsetMinutes, solarNoonMinutes, daylightMinutes } = solar;

  const abhijit: WindowSpan = {
    type: 'ABHIJIT',
    label: 'Abhijit Muhurtham',
    startMinutes: solarNoonMinutes - 24,
    endMinutes: solarNoonMinutes + 24,
  };

  const brahma: WindowSpan = {
    type: 'BRAHMA',
    label: 'Brahma Muhurtham',
    startMinutes: sunriseMinutes - 96,
    endMinutes: sunriseMinutes - 48,
  };

  const rahuSeg = segmentSpan(sunriseMinutes, daylightMinutes, RAHU_KALAM_SEGMENT[weekday]);
  const rahuKalam: WindowSpan = {
    type: 'RAHU_KALAM',
    label: 'Rahu Kalam',
    startMinutes: rahuSeg.start,
    endMinutes: rahuSeg.end,
  };

  const gulikaSeg = segmentSpan(sunriseMinutes, daylightMinutes, GULIKA_KALAM_SEGMENT[weekday]);
  const gulikaKalam: WindowSpan = {
    type: 'GULIKA',
    label: 'Gulika Kalam',
    startMinutes: gulikaSeg.start,
    endMinutes: gulikaSeg.end,
  };

  const yamaSeg = segmentSpan(sunriseMinutes, daylightMinutes, YAMA_GANDAM_SEGMENT[weekday]);
  const yamaGandam: WindowSpan = {
    type: 'YAMA',
    label: 'Yama Gandam',
    startMinutes: yamaSeg.start,
    endMinutes: yamaSeg.end,
  };

  return [brahma, abhijit, rahuKalam, gulikaKalam, yamaGandam].map((w) => ({
    ...w,
    startMinutes: Math.round(((w.startMinutes % 1440) + 1440) % 1440),
    endMinutes: Math.round(((w.endMinutes % 1440) + 1440) % 1440),
  }));
}

/**
 * Given the current minute-of-day, returns which window is active right now,
 * or 'NEUTRAL' if none of the five windows apply. This is the lookup the
 * dial's tap-to-cards interaction uses.
 */
export function getActiveWindow(
  windows: WindowSpan[],
  currentMinuteOfDay: number
): SolarWindowType {
  for (const w of windows) {
    if (w.startMinutes <= w.endMinutes) {
      if (currentMinuteOfDay >= w.startMinutes && currentMinuteOfDay <= w.endMinutes) {
        return w.type;
      }
    } else {
      // window wraps past midnight (e.g. Brahma Muhurtham before an early sunrise)
      if (currentMinuteOfDay >= w.startMinutes || currentMinuteOfDay <= w.endMinutes) {
        return w.type;
      }
    }
  }
  return 'NEUTRAL';
}
