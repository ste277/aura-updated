import { computeSolarEphemeris } from '../../packages/astronomy/src/ephemeris';
import { computePanchangWindows } from '../../packages/panchang/src/windows';
import { getDatePartsInTimezone, resolveTzOffsetMinutes } from '../../apps/web/lib/timezone';

/**
 * Product Journey / E2E Hardening V1 -- Good Right Now's active window
 * (activeWindowName) is computed CLIENT-SIDE from the real browser clock
 * (packages/astronomy/src/ephemeris.ts + computePanchangWindows), NOT
 * server-driven, so apps/web/lib/testTimeOverride.ts's `x-e2e-now` header
 * has no effect on it. Deterministic coverage of a SPECIFIC window (e.g.
 * "find a moment that's reliably NEUTRAL today") needs Playwright's own
 * `page.clock` to freeze the browser clock instead.
 *
 * This computes TODAY's real neutral gap (reusing the app's own
 * computeSolarEphemeris/computePanchangWindows, never a second astronomy
 * implementation) so the test never hardcodes a date/time that would go
 * stale or land in a different window on a different real-world day.
 */
export function findNeutralInstant(now: Date, latitude: number, longitude: number, timezone: string): Date {
  const parts = getDatePartsInTimezone(timezone, now);
  const tzOffsetMinutes = resolveTzOffsetMinutes(timezone, now);
  const solar = computeSolarEphemeris({ year: parts.year, month: parts.month, day: parts.day, latitude, longitude, tzOffsetMinutes });
  const windows = computePanchangWindows(solar, parts.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6);

  const covered = new Array(1440).fill(false);
  for (const w of windows) {
    const start = w.startMinute ?? 0;
    const end = w.endMinute ?? 0;
    for (let m = start; m < end; m++) if (m >= 0 && m < 1440) covered[m] = true;
  }

  let bestStart = 0;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let m = 0; m < 1440; m++) {
    if (!covered[m]) {
      if (curStart === -1) curStart = m;
      curLen++;
    } else {
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
      curStart = -1;
      curLen = 0;
    }
  }
  if (curLen > bestLen) {
    bestLen = curLen;
    bestStart = curStart;
  }
  if (bestLen === 0) throw new Error('No neutral gap found in today\'s Panchang windows -- cannot pick a deterministic NEUTRAL test instant.');

  const midpointMinute = bestStart + Math.floor(bestLen / 2);
  const hh = Math.floor(midpointMinute / 60);
  const mm = midpointMinute % 60;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hh, mm) - tzOffsetMinutes * 60_000);
}

/**
 * A moment shortly BEFORE today's Rahu Kalam window starts, so the Home
 * hero's own "next shift" (Next Best Moment's candidate) is that caution
 * window -- used to prove a caution/low-quality candidate is never
 * presented as "Next Best Moment" (brief section 18) without touching any
 * scoring/astrology.
 */
export function findInstantBeforeRahuKalam(now: Date, latitude: number, longitude: number, timezone: string): Date {
  const parts = getDatePartsInTimezone(timezone, now);
  const tzOffsetMinutes = resolveTzOffsetMinutes(timezone, now);
  const solar = computeSolarEphemeris({ year: parts.year, month: parts.month, day: parts.day, latitude, longitude, tzOffsetMinutes });
  const windows = computePanchangWindows(solar, parts.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6);
  const rahu = windows.find((w) => w.type === 'RAHU_KALAM');
  if (!rahu || rahu.startMinute === undefined) throw new Error('No Rahu Kalam window found for today.');

  const targetMinute = rahu.startMinute - 20;
  const hh = Math.floor(targetMinute / 60);
  const mm = targetMinute % 60;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hh, mm) - tzOffsetMinutes * 60_000);
}

/**
 * Home Recommendation Hierarchy V1 -- the midpoint of today's Rahu Kalam
 * window itself (activeWindowName === 'RAHU_KALAM'), as opposed to
 * findInstantBeforeRahuKalam's "20 minutes before it starts". Needed to
 * exercise Good Right Now / Aura Suggests's own caution-window branches,
 * which only activate while a caution window is the CURRENT one, not the
 * upcoming one.
 */
export function findInstantDuringRahuKalam(now: Date, latitude: number, longitude: number, timezone: string): Date {
  const parts = getDatePartsInTimezone(timezone, now);
  const tzOffsetMinutes = resolveTzOffsetMinutes(timezone, now);
  const solar = computeSolarEphemeris({ year: parts.year, month: parts.month, day: parts.day, latitude, longitude, tzOffsetMinutes });
  const windows = computePanchangWindows(solar, parts.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6);
  const rahu = windows.find((w) => w.type === 'RAHU_KALAM');
  if (!rahu || rahu.startMinute === undefined || rahu.endMinute === undefined) throw new Error('No Rahu Kalam window found for today.');

  const targetMinute = Math.floor((rahu.startMinute + rahu.endMinute) / 2);
  const hh = Math.floor(targetMinute / 60);
  const mm = targetMinute % 60;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hh, mm) - tzOffsetMinutes * 60_000);
}
