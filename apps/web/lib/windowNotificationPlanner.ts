import type { WindowSpan, SolarWindowType } from '../../../packages/panchang/src/windows';
import { formatMinutes } from '../../../packages/astronomy/src/ephemeris';

// Pure planning logic for window alerts — no Capacitor/browser imports, so
// the math-core test job (root deps only) can unit-test it directly.

/** Which window types alert. Persisted per device by lib/windowNotifications. */
export type NotificationPrefs = Record<SolarWindowType, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  BRAHMA: false, // pre-dawn — opt-in, nobody wants a 4:20 AM buzz by default
  ABHIJIT: true,
  RAHU_KALAM: true,
  GULIKA: false,
  YAMA: false,
  NEUTRAL: false,
};

export const LEAD_MINUTES = 10;

export interface WindowNotificationSpec {
  title: string;
  body: string;
  /** Minutes from "now" until the notification should fire (always > 0). */
  minutesFromNow: number;
}

const FAVORABLE: SolarWindowType[] = ['BRAHMA', 'ABHIJIT', 'GULIKA'];

/**
 * Which notifications should be scheduled for the rest of today.
 * `currentMinuteOfDay` must be in the user's timezone — the same clock the
 * windows themselves are computed in.
 */
export function computeWindowNotificationSpecs(
  windows: WindowSpan[],
  currentMinuteOfDay: number,
  prefs: NotificationPrefs
): WindowNotificationSpec[] {
  const specs: WindowNotificationSpec[] = [];

  for (const w of windows) {
    if (!prefs[w.type]) continue;

    const fireAt = w.startMinutes - LEAD_MINUTES;
    const minutesFromNow = fireAt - currentMinuteOfDay;
    // Only future windows today; windows wrapping past midnight (Brahma before
    // an early sunrise) are skipped rather than mis-scheduled.
    if (minutesFromNow <= 0 || w.startMinutes < currentMinuteOfDay) continue;

    const favorable = FAVORABLE.includes(w.type);
    specs.push({
      title: favorable ? `${w.label} in ${LEAD_MINUTES} minutes` : `${w.label} ahead`,
      body: favorable
        ? `Favorable window ${formatMinutes(w.startMinutes)}–${formatMinutes(w.endMinutes)}. Line up your key task.`
        : `${formatMinutes(w.startMinutes)}–${formatMinutes(w.endMinutes)}. Wrap up before it starts; avoid new beginnings.`,
      minutesFromNow,
    });
  }

  return specs.sort((a, b) => a.minutesFromNow - b.minutesFromNow);
}
