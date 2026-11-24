/**
 * AURA-REM-01 -- whether reminders can actually reach a device while Aura is
 * closed. Configuration alone (VAPID keys present) is not enough: the
 * scheduler must also have reached the dispatch endpoint recently. Without
 * this, the settings screen could say "Enabled" on a deployment whose
 * scheduler runs once a day (or never), which is what PV-F03 found.
 */

export type BackgroundDeliveryStatus = 'AVAILABLE' | 'NOT_CONFIGURED' | 'SCHEDULER_INACTIVE';

/** A dispatch run must have happened within this window. Comfortably above
 * a 1-5 minute scheduler cadence; a once-a-day cron never satisfies it. */
export const DISPATCH_HEARTBEAT_MAX_AGE_MINUTES = 15;

export function classifyBackgroundDelivery(input: {
  pushConfigured: boolean;
  heartbeat: { lastRunAt: Date | string; lastRunConfigured: boolean } | null;
  now: Date;
}): BackgroundDeliveryStatus {
  if (!input.pushConfigured) return 'NOT_CONFIGURED';
  if (!input.heartbeat || !input.heartbeat.lastRunConfigured) return 'SCHEDULER_INACTIVE';
  const ageMs = input.now.getTime() - new Date(input.heartbeat.lastRunAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > DISPATCH_HEARTBEAT_MAX_AGE_MINUTES * 60_000) return 'SCHEDULER_INACTIVE';
  return 'AVAILABLE';
}
