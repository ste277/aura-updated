/**
 * AURA-ANDROID-REL-04 -- sign-out that never reports success it did not get.
 *
 * The session cookie (`as_session`) is httpOnly, so only the server's
 * POST /api/auth/logout response can remove it. Before this change the Home
 * page cleared its signed-in state even when that request failed, and threw
 * (leaving the user signed in with no message) when the device was offline.
 * In the first case the UI showed "signed out" while the cookie stayed valid,
 * so the next app launch or reload was signed in again.
 *
 * The offline activity-log queue (localStorage `offline_habit_queue`) is not
 * tied to an account: its entries replay with whatever session is current. If
 * it were left behind on sign-out, the next account to sign in on the device
 * would receive the previous user's activity logs. It is therefore cleared on
 * a confirmed sign-out, after asking first when it still holds entries.
 *
 * Pure apart from the injected dependencies, so it is testable without a DOM.
 */
export const OFFLINE_HABIT_QUEUE_KEY = 'offline_habit_queue';

export type SignOutOutcome = 'signed-out' | 'cancelled' | 'failed';

export interface SignOutDeps {
  fetch: (url: string, init: { method: string }) => Promise<{ ok: boolean }>;
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null;
  confirm: (message: string) => boolean;
}

export const SIGN_OUT_FAILED_MESSAGE = "Couldn't sign out. Check your connection and try again.";

export function unsyncedQueueCount(storage: SignOutDeps['storage']): number {
  try {
    const raw = storage?.getItem(OFFLINE_HABIT_QUEUE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function unsyncedQueueWarning(count: number): string {
  const what = count === 1 ? '1 activity log that has not synced yet' : `${count} activity logs that have not synced yet`;
  return `You have ${what}. Signing out will remove ${count === 1 ? 'it' : 'them'} from this device. Sign out anyway?`;
}

export async function performSignOut(deps: SignOutDeps): Promise<SignOutOutcome> {
  const pending = unsyncedQueueCount(deps.storage);
  if (pending > 0 && !deps.confirm(unsyncedQueueWarning(pending))) return 'cancelled';

  try {
    const res = await deps.fetch('/api/auth/logout', { method: 'POST' });
    if (!res.ok) return 'failed';
  } catch {
    return 'failed';
  }

  try {
    deps.storage?.removeItem(OFFLINE_HABIT_QUEUE_KEY);
  } catch {
    // Storage unavailable: nothing was queued there either.
  }
  return 'signed-out';
}
