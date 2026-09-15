/**
 * Pure extraction of page.tsx's own "Current window timing calculations for
 * TimelineView Banner" useMemo (AURA HOME IA V2 FOLLOW-UP FIXES, Finding
 * C) -- byte-for-byte the same minute arithmetic, moved into a plain,
 * directly-testable .ts module rather than left inline inside a component
 * body, since this repo has no component-test harness for page.tsx.
 *
 * This answers "how long until the next meaningful timing change" -- NOT
 * "how long until this window's underlying block ends." Those are different
 * questions: when we're in a Neutral gap, the gap itself may run until
 * midnight, but if a real window (Gulika, Rahu Kalam, etc.) starts sooner,
 * that's the moment the user's experience actually changes, so that's what
 * drives the countdown.
 *
 * Root cause fixed here (Finding C): `startTime` used to be the literal
 * string 'Current' whenever there is no active named window (a Neutral
 * gap) -- a non-time sentinel that HomeDashboard.tsx then concatenated
 * straight into "{startTime} - {endTime}", producing labels like
 * "Current - 4:31 AM" that read as "it is currently 4:31 AM" when the
 * actual local time was evening. `startTime: null` now lets the caller
 * choose an honest sentence shape instead. `boundaryIsTomorrow` is new:
 * `endTime` can be a boundary that wrapped past midnight (tomorrow's
 * clock), which must be said explicitly rather than left for the reader to
 * infer from a bare clock time.
 *
 * Timezone note: `currentMinuteOfDay` must already be the minute-of-day in
 * the user's own configured timezone (page.tsx derives it via
 * `useCurrentMinuteOfDay(user.timezone)`) -- this function does no
 * timezone conversion of its own and never reads server-local time.
 */

export interface CurrentWindowSource {
  type?: string;
  windowType?: string;
  name?: string;
  startMinutes?: number;
  startMinute?: number;
  endMinutes?: number;
  endMinute?: number;
}

export interface CurrentWindowStatus {
  name: string;
  /** null while in a Neutral gap (no active named window right now). */
  startTime: string | null;
  endTime: string;
  /** True when `endTime` is tomorrow's clock, not today's. */
  boundaryIsTomorrow: boolean;
  timeRemaining: string;
}

function parseMinute(val: unknown): number | null {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string' && val.includes(':')) {
    const [h, m] = val.split(':').map(Number);
    if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
  }
  return null;
}

export function formatMinuteOfDay(minute: number): string {
  const totalMins = ((Math.floor(minute) % 1440) + 1440) % 1440;
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const period = hrs >= 12 ? 'PM' : 'AM';
  const formattedHr = hrs % 12 === 0 ? 12 : hrs % 12;
  return `${formattedHr}:${String(mins).padStart(2, '0')} ${period}`;
}

export function computeCurrentWindowStatus(activeType: string, windows: CurrentWindowSource[], currentMinuteOfDay: number): CurrentWindowStatus {
  const activeTypeClean = activeType ? String(activeType).replace('_', ' ').toUpperCase() : 'NEUTRAL';

  const activeWin = windows.find((w) => {
    const rawType = String(w.type || w.windowType || w.name || '').replace('_', ' ').toUpperCase();
    return rawType === activeTypeClean;
  });

  // Windows sorted chronologically by start minute, so we can find the
  // soonest upcoming boundary regardless of which order they were computed in.
  const sortedByStart = [...windows]
    .map((w) => ({ w, start: parseMinute(w.startMinutes ?? w.startMinute) ?? 0 }))
    .sort((a, b) => a.start - b.start);

  let startMin: number | null;
  let nextBoundaryMin: number;
  let boundaryIsTomorrow = false;

  if (activeWin) {
    // Currently inside a real (named) window: the boundary is simply its own end.
    startMin = parseMinute(activeWin.startMinutes ?? activeWin.startMinute);
    nextBoundaryMin = parseMinute(activeWin.endMinutes ?? activeWin.endMinute) ?? currentMinuteOfDay;
  } else {
    // Currently in a Neutral gap: the boundary is the start of whichever
    // named window begins soonest -- today if one remains, otherwise the
    // earliest one tomorrow (wrapping past midnight).
    startMin = null;
    const upcomingToday = sortedByStart.find(({ start }) => start > currentMinuteOfDay);
    const soonest = upcomingToday ?? sortedByStart[0];
    let boundary = soonest ? soonest.start : currentMinuteOfDay;
    if (boundary <= currentMinuteOfDay) {
      boundary += 1440; // wraps to tomorrow
      boundaryIsTomorrow = true;
    }
    nextBoundaryMin = boundary;
  }

  const endTimeStr = formatMinuteOfDay(nextBoundaryMin);

  let diff = nextBoundaryMin - currentMinuteOfDay;
  if (diff < 0) diff += 1440;
  const remHrs = Math.floor(diff / 60);
  const remMins = diff % 60;
  const timeRemainingStr = remHrs > 0 ? `${remHrs}h ${remMins}m` : `${remMins}m`;

  return {
    name: activeType.replace('_', ' '),
    startTime: startMin === null ? null : formatMinuteOfDay(startMin),
    endTime: endTimeStr,
    boundaryIsTomorrow,
    timeRemaining: timeRemainingStr,
  };
}
