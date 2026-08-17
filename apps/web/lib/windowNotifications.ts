import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { WindowSpan } from '../../../packages/panchang/src/windows';
import {
  computeWindowNotificationSpecs,
  NotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
} from './windowNotificationPlanner';

export { DEFAULT_NOTIFICATION_PREFS } from './windowNotificationPlanner';
export type { NotificationPrefs } from './windowNotificationPlanner';

const PREFS_KEY = 'window_notification_prefs';

export function loadNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(raw) };
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_NOTIFICATION_PREFS };
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/**
 * (Re)schedules today's remaining window alerts. Cancels previous pending
 * ones first so re-opens/pref-changes never double-notify. Native-only:
 * scheduled web notifications aren't reliable without a push service, so the
 * web build simply doesn't schedule (the in-app WindowShiftToast covers it).
 */
export async function syncWindowNotifications(
  windows: WindowSpan[],
  currentMinuteOfDay: number,
  prefs: NotificationPrefs
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') {
    const request = await LocalNotifications.requestPermissions();
    if (request.display !== 'granted') return;
  }

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }

  const specs = computeWindowNotificationSpecs(windows, currentMinuteOfDay, prefs);
  if (specs.length === 0) return;

  const now = Date.now();
  await LocalNotifications.schedule({
    notifications: specs.map((spec, i) => ({
      id: i + 1,
      title: spec.title,
      body: spec.body,
      schedule: { at: new Date(now + spec.minutesFromNow * 60_000) },
    })),
  });
}
