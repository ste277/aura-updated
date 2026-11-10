import type { WindowSpan, SolarWindowType } from '../../../packages/panchang/src/windows';
import { isInauspiciousCommencementWindow } from '../../../packages/panchang/src/windows';
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
  // PA-3C-C1B-01: a legitimate solar no-event condition is not a window
  // transition worth alerting on -- same conservative default as NEUTRAL.
  UNAVAILABLE: false,
};

export const LEAD_MINUTES = 10;

export interface WindowNotificationSpec {
  title: string;
  body: string;
  /** Minutes from "now" until the notification should fire (always > 0). */
  minutesFromNow: number;
}

// PANCH-FOLLOWUP-335: GULIKA was previously (incorrectly) listed here as
// favorable, contradicting the canonical isInauspiciousCommencementWindow
// policy (packages/panchang/src/windows.ts), which treats GULIKA the same
// as RAHU_KALAM/YAMA for commencement purposes. Only BRAHMA/ABHIJIT are
// genuinely favorable commencement windows.
const FAVORABLE: SolarWindowType[] = ['BRAHMA', 'ABHIJIT'];

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
    // Safety net (PANCH-FOLLOWUP-335): FAVORABLE must never again contain a
    // window the canonical Panchangam policy treats as inauspicious for
    // commencement. NEUTRAL/UNAVAILABLE are meta-states outside that
    // dichotomy, so this check is scoped to the three real solar-caution
    // types by isInauspiciousCommencementWindow itself (RAHU_KALAM/YAMA/
    // GULIKA) and never fires for them today — it only guards against a
    // future regression re-adding one of those three to FAVORABLE.
    if (favorable && isInauspiciousCommencementWindow(w.type)) {
      throw new Error(
        `windowNotificationPlanner: ${w.type} is both FAVORABLE and inauspicious-for-commencement — this must never happen (PANCH-FOLLOWUP-335).`
      );
    }
    const isGulika = w.type === 'GULIKA';
    specs.push({
      title: favorable || isGulika ? `${w.label} in ${LEAD_MINUTES} minutes` : `${w.label} ahead`,
      body: favorable
        ? `Favorable window ${formatMinutes(w.startMinutes)}–${formatMinutes(w.endMinutes)}. Line up your key task.`
        : isGulika
          ? `Gulika Kalam ${formatMinutes(w.startMinutes)}–${formatMinutes(w.endMinutes)}. Avoid starting important activities; consider continuing existing work.`
          : `${formatMinutes(w.startMinutes)}–${formatMinutes(w.endMinutes)}. Wrap up before it starts; avoid new beginnings.`,
      minutesFromNow,
    });
  }

  return specs.sort((a, b) => a.minutesFromNow - b.minutesFromNow);
}
