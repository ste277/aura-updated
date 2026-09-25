/**
 * Daily Experience V1 PR E -- ownership of the "focus the Move successor" request.
 *
 * After a confirmed Move, successor B may not be in the DOM yet (it is rendered by the state updates
 * just made), so Home waits briefly for B's row. That wait must never outlive its purpose:
 *
 *  - ONE active request per Home. A newer request supersedes (cancels + invalidates) the older one.
 *  - Every delayed callback re-checks its own token, so a callback that was already queued when it was
 *    superseded / invalidated / unmounted is a no-op and touches nothing (not just `clearTimeout`).
 *  - Any intentional USER action after the Move was SUBMITTED (during the network wait or the retry wait)
 *    means the user has moved on: see `epoch()`. A later, intentional USER action (a focus change, a pointer press, a key press) invalidates the
 *    request: stale automatic focus must never override the user's newer choice. The request is ENDED
 *    before the controller performs its own focus, so the focusin that focus raises finds nothing to
 *    invalidate (no self-invalidation, no extra guard state).
 *  - The wait is bounded (MAX_ATTEMPTS at INTERVAL_MS). Success focuses B once and ends the request.
 *    Exhaustion focuses the stable fallback ONLY if the request is still current.
 *  - `cancel()` (Home unmount) ends the active request; the controller stays reusable (StrictMode
 *    re-runs effects).
 *
 * Plain, injectable and component-owned (one per Home instance): no module-global state, no DOM access
 * except through the injected functions, so it is fully testable with fake timers and a fake DOM.
 */

import { getDatePartsInTimezone } from './timezone';

/** 9 attempts: one immediate, then 8 retries 60ms apart -- at most ~480ms of waiting. */
export const SUCCESSOR_FOCUS_MAX_ATTEMPTS = 9;
export const SUCCESSOR_FOCUS_INTERVAL_MS = 60;

export interface SuccessorFocusDeps<T> {
  schedule: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  /** The successor's Timeline row, or null while it is not rendered. */
  findRow: (successorId: string) => T | null;
  focus: (element: T) => void;
  /** Focuses the stable fallback target (Right Now region). Called at most once, only for a still-current request. */
  focusFallback: () => void;
}

export interface SuccessorFocusController {
  /** A monotonically increasing count of user-intent events. Capture it when the Move is SUBMITTED and pass it as `since` on success: a user action during the network wait means the user has moved on, so no focus request starts at all. */
  epoch: () => number;
  /** Starts (superseding any previous request). `expectRow: false` (B will not be on today's list) goes straight to the fallback, still token-guarded. `since`: see `epoch()` -- if user intent happened after it, this is a no-op. */
  request: (successorId: string, options?: { expectRow?: boolean; since?: number }) => void;
  /** Report a user-driven focus / pointer / key event: invalidates the pending request. */
  noteUserIntent: () => void;
  /** Ends the active request (unmount). Reusable afterwards. */
  cancel: () => void;
  /** Introspection for tests/diagnostics only. */
  isPending: () => boolean;
}

export function createSuccessorFocusController<T>(deps: SuccessorFocusDeps<T>): SuccessorFocusController {
  let generation = 0;
  let intentEpoch = 0;
  let active: { token: number; timer: unknown } | null = null;

  const end = () => {
    if (active && active.timer !== null) deps.clear(active.timer);
    active = null;
  };
  const isCurrent = (token: number) => active !== null && active.token === token;

  const attempt = (token: number, n: number, successorId: string, expectRow: boolean) => {
    if (!isCurrent(token)) return;
    active!.timer = deps.schedule(() => {
      // Token check FIRST: an already-queued callback of a superseded/invalidated/unmounted request does nothing.
      if (!isCurrent(token)) return;
      active!.timer = null;
      const row = expectRow ? deps.findRow(successorId) : null;
      if (row) {
        end();
        deps.focus(row);
        return;
      }
      if (expectRow && n + 1 < SUCCESSOR_FOCUS_MAX_ATTEMPTS) {
        attempt(token, n + 1, successorId, expectRow);
        return;
      }
      end();
      deps.focusFallback();
    }, n === 0 ? 0 : SUCCESSOR_FOCUS_INTERVAL_MS);
  };

  return {
    epoch: () => intentEpoch,
    request: (successorId, options) => {
      end();
      if (options?.since !== undefined && options.since !== intentEpoch) return;
      const token = ++generation;
      active = { token, timer: null };
      attempt(token, 0, successorId, options?.expectRow !== false);
    },
    noteUserIntent: () => {
      intentEpoch++;
      end();
    },
    // Unmount: ends the active request AND counts as user-moved-on, so a Move whose response arrives AFTER unmount never starts one.
    cancel: () => {
      intentEpoch++;
      end();
    },
    isPending: () => active !== null,
  };
}

/**
 * Will the confirmed successor appear on the agenda Home is showing? Same rule as applyConfirmedSuccessors
 * (homeMove.ts): only when its local date equals the agenda's. A Move to tomorrow never renders a Today row,
 * so there is nothing to wait for. With no agenda yet, keep the default (wait, bounded).
 */
export function successorOnAgendaDay(plannedStartAt: Date | string, agenda: { localDate: string; timezone: string } | null | undefined): boolean {
  if (!agenda) return true;
  return getDatePartsInTimezone(agenda.timezone, new Date(plannedStartAt)).dateStr === agenda.localDate;
}
