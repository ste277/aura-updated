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
  endMinutes: number;   // local clock, 0-1439
  // Aliases added for backwards-compatibility with page.tsx UI mappers
  startMinute?: number;
  endMinute?: number;
}

/** 0 = Sunday ... 6 = Saturday, matching JS Date#getDay(). */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// 0-indexed segment offsets (0 = 1st segment, 7 = 8th segment):
// Sun: 8th (7), Mon: 2nd (1), Tue: 7th (6), Wed: 5th (4), Thu: 6th (5), Fri: 4th (3), Sat: 3rd (2)
const RAHU_KALAM_SEGMENT: Record<WeekdayIndex, number> = {
  0: 7, // Sunday (8th segment)
  1: 1, // Monday (2nd segment)
  2: 6, // Tuesday (7th segment)
  3: 4, // Wednesday (5th segment)
  4: 5, // Thursday (6th segment)
  5: 3, // Friday (4th segment)
  6: 2, // Saturday (3rd segment)
};

const GULIKA_KALAM_SEGMENT: Record<WeekdayIndex, number> = {
  0: 6, // Sunday (7th segment)
  1: 5, // Monday (6th segment)
  2: 4, // Tuesday (5th segment)
  3: 3, // Wednesday (4th segment)
  4: 2, // Thursday (3rd segment)
  5: 1, // Friday (2nd segment)
  6: 0, // Saturday (1st segment)
};

const YAMA_GANDAM_SEGMENT: Record<WeekdayIndex, number> = {
  0: 4, // Sunday (5th segment)
  1: 3, // Monday (4th segment)
  2: 2, // Tuesday (3rd segment)
  3: 1, // Wednesday (2nd segment)
  4: 0, // Thursday (1st segment)
  5: 5, // Friday (6th segment)
  6: 6, // Saturday (7th segment)
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
 * Inauspicious Period Precedence Fix V1: windows that must override an
 * otherwise-positive commencement for timing-sensitive/significant
 * activities. Deliberately distinct from dailyAssistant.ts's isFriction()
 * (RAHU_KALAM/YAMA only), which governs EVERYDAY scoring/ranking and must
 * keep excluding Gulika -- an everyday activity during Gulika stays
 * rankable/usable, never hard-blocked. This is the narrower,
 * commencement-safety-specific concept: for a significant beginning, Rahu
 * Kalam, Yamaganda, AND Gulika all count as inauspicious, regardless of
 * what an overlapping Abhijit/Brahma window sharing the same span would
 * otherwise suggest.
 */
export function isInauspiciousCommencementWindow(type: SolarWindowType): boolean {
  return type === 'RAHU_KALAM' || type === 'YAMA' || type === 'GULIKA';
}

/**
 * True if [aStart, aEnd) and [bStart, bEnd) intersect at all, on any shared
 * linear numeric axis -- minute-of-day (dailyAssistant.ts's commencement-
 * safety check) or epoch milliseconds via Date.parse (muhurthamFinder.ts's
 * ISO-instant one). The one canonical interval-overlap primitive: kept here
 * (rather than duplicated per caller, each with its own unit) so the actual
 * overlap math -- `aStart < bEnd && bStart < aEnd` -- exists exactly once.
 */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Computes all five panchang windows for a given day's solar ephemeris.
 */
export function computePanchangWindows(
  solar: SolarResult,
  weekday: WeekdayIndex
): WindowSpan[] {
  const { sunriseMinutes, solarNoonMinutes, daylightMinutes } = solar;

  // Drik Panchang calculates Abhijit as the 8th Muhurta out of 15 equal day divisions
  const muhurtaLength = daylightMinutes / 15;
  const abhijitHalf = muhurtaLength / 2;

  const abhijit: WindowSpan = {
    type: 'ABHIJIT',
    label: 'Abhijit Muhurtham',
    startMinutes: solarNoonMinutes - abhijitHalf,
    endMinutes: solarNoonMinutes + abhijitHalf,
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

  return [brahma, abhijit, rahuKalam, gulikaKalam, yamaGandam].map((w) => {
    const sMin = Math.round(((w.startMinutes % 1440) + 1440) % 1440);
    const eMin = Math.round(((w.endMinutes % 1440) + 1440) % 1440);
    return {
      ...w,
      startMinutes: sMin,
      endMinutes: eMin,
      startMinute: sMin,
      endMinute: eMin,
    };
  });
}

/**
 * Given current minute-of-day, returns active window or 'NEUTRAL'.
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
      if (currentMinuteOfDay >= w.startMinutes || currentMinuteOfDay <= w.endMinutes) {
        return w.type;
      }
    }
  }
  return 'NEUTRAL';
}