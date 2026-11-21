/**
 * AURA-READY-03-F1 -- the onboarding "next useful window" recommendation.
 *
 * Onboarding previously showed `energyInsight.nextShift` -- the next window
 * of ANY type -- under "Your next useful window... a suitable period for
 * focused activity", so a new user could be told Rahu Kalam was suitable.
 *
 * This helper only ever recommends a window that the existing Panchang
 * policy treats as favourable, and never invents one:
 *   - favourable = a computed window that is NOT
 *     isInauspiciousCommencementWindow() (the same split
 *     evaluatePanchangOverlap() uses for `favorableWindows`), i.e. ABHIJIT
 *     or BRAHMA today. Gaps between windows (NEUTRAL) and 'UNAVAILABLE' are
 *     never presented as favourable.
 *   - the recommended span is the part of that window where
 *     evaluatePanchangOverlap() reports NO commencement caution, so an
 *     Abhijit that overlaps Rahu Kalam / Yamaganda / Gulika (inauspicious
 *     precedence) is trimmed to its caution-free part, or skipped entirely
 *     when it has none.
 *   - only the rest of TODAY is evaluated (the card says "Today"); no
 *     wrap-around to tomorrow's windows using today's times.
 * No Panchang calculation, window, score or ranking weight is changed.
 */
import {
  evaluatePanchangOverlap,
  isInauspiciousCommencementWindow,
  type WindowSpan,
} from '../../../packages/panchang/src/windows';
import { formatMinuteOfDay, formatMinutesUntil, formatWindowName } from './scoreEngine';

export interface OnboardingCautionNow {
  windowName: string;
  endTime: string;
}

export type OnboardingWindowRecommendation =
  | {
      kind: 'FAVOURABLE';
      windowType: WindowSpan['type'];
      windowName: string;
      startMinute: number;
      endMinute: number;
      startTime: string;
      endTime: string;
      /** True when the caution-free part has already begun. */
      activeNow: boolean;
      /** "In 1h 5m" or "Now". */
      startsIn: string;
      cautionNow?: OnboardingCautionNow;
    }
  | {
      kind: 'NONE_TODAY';
      cautionNow?: OnboardingCautionNow;
    };

function hasCaution(windows: WindowSpan[], minute: number): boolean {
  return evaluatePanchangOverlap(windows, minute).commencementCaution;
}

export function computeOnboardingRecommendation(
  windows: WindowSpan[],
  currentMinuteOfDay: number
): OnboardingWindowRecommendation {
  const now = Math.floor(currentMinuteOfDay);
  const current = evaluatePanchangOverlap(windows, now).primaryCautionWindow;
  const cautionNow: OnboardingCautionNow | undefined = current
    ? { windowName: formatWindowName(current.type), endTime: formatMinuteOfDay(current.endMinutes) }
    : undefined;

  const favourable = windows
    .filter((w) => w.type !== 'NEUTRAL' && w.type !== 'UNAVAILABLE' && !isInauspiciousCommencementWindow(w.type))
    // Same-day spans only: a span that wraps midnight can't be stated as "Today, from X to Y".
    .filter((w) => w.startMinutes < w.endMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  for (const w of favourable) {
    if (w.endMinutes <= now) continue;
    let start = -1;
    for (let m = Math.max(w.startMinutes, now); m < w.endMinutes; m++) {
      if (!hasCaution(windows, m)) { start = m; break; }
    }
    if (start < 0) continue;
    let end = start + 1;
    while (end < w.endMinutes && !hasCaution(windows, end)) end++;
    const activeNow = start <= now;
    return {
      kind: 'FAVOURABLE',
      windowType: w.type,
      windowName: formatWindowName(w.type),
      startMinute: start,
      endMinute: end,
      startTime: formatMinuteOfDay(start),
      endTime: formatMinuteOfDay(end),
      activeNow,
      startsIn: activeNow ? 'Now' : `In ${formatMinutesUntil(start - now)}`,
      cautionNow,
    };
  }
  return { kind: 'NONE_TODAY', cautionNow };
}
