import type { WindowSpan, SolarWindowType } from '../../../packages/panchang/src/windows';

export interface CountdownResult {
  label: 'ends in' | 'starts in';
  windowLabel: string;
  secondsRemaining: number;
}

/** Seconds remaining until `targetMinuteOfDay`, given the current second-of-day,
 * wrapping forward into tomorrow if the target has already passed today. */
function secondsUntil(currentSecondOfDay: number, targetMinuteOfDay: number): number {
  const targetSecondOfDay = targetMinuteOfDay * 60;
  const diff = targetSecondOfDay - currentSecondOfDay;
  return diff >= 0 ? diff : diff + 86400;
}

/**
 * If a real window (not NEUTRAL) is currently active, counts down to its end.
 * Otherwise, counts down to the start of the next upcoming window (today or,
 * if none remain today, the earliest one tomorrow).
 */
export function getCountdown(
  windows: WindowSpan[],
  currentSecondOfDay: number,
  activeType: SolarWindowType
): CountdownResult | null {
  if (activeType !== 'NEUTRAL') {
    const active = windows.find((w) => w.type === activeType);
    if (!active) return null;
    return {
      label: 'ends in',
      windowLabel: active.label,
      secondsRemaining: secondsUntil(currentSecondOfDay, active.endMinutes),
    };
  }

  if (windows.length === 0) return null;

  // Find the window whose start is soonest from now (wrapping through midnight).
  let soonest = windows[0];
  let soonestSeconds = secondsUntil(currentSecondOfDay, soonest.startMinutes);
  for (const w of windows.slice(1)) {
    const s = secondsUntil(currentSecondOfDay, w.startMinutes);
    if (s < soonestSeconds) {
      soonest = w;
      soonestSeconds = s;
    }
  }

  return { label: 'starts in', windowLabel: soonest.label, secondsRemaining: soonestSeconds };
}

/** Formats seconds as "Xh Ym Zs" / "Ym Zs" / "Zs", matching the mockup's style. */
export function formatCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
