/**
 * Good Right Now / Log Activity Failure State Correctness V1 -- the one
 * pure decision behind both handleLogActivity's own primary attempt and
 * the offline-queue replay loop (page.tsx): given an HTTP response status
 * (or the sentinel 'network-error' for a fetch call that never received a
 * response at all), what should happen to this specific log attempt?
 *
 * - 2xx is the only outcome that means the server actually persisted the
 *   row -- 'confirmed'.
 * - 'network-error' is the one genuinely ambiguous case (the server's
 *   real outcome is unknown -- it may have committed, may not have) --
 *   'retry', the sole legitimate justification for the offline queue.
 * - 5xx looks the same as 'network-error' to a naive check, but it is NOT
 *   ambiguous: the server was reachable and explicitly reported its own
 *   failure. Still 'retry' (a transient server issue may resolve), but
 *   deliberately NOT treated as "offline" -- callers must surface this as
 *   a real, visible failure, never a silent queue entry.
 * - 4xx is a definitive, permanent rejection (bad request, unauthenticated,
 *   unknown activity) -- retrying the identical request will fail
 *   identically forever. 'permanent-failure': never retried, never
 *   silently claimed as a success.
 */
export type HabitLogSyncOutcome = 'confirmed' | 'retry' | 'permanent-failure';

export function classifyHabitLogSyncOutcome(status: number | 'network-error'): HabitLogSyncOutcome {
  if (status === 'network-error') return 'retry';
  if (status >= 200 && status < 300) return 'confirmed';
  if (status >= 500) return 'retry';
  return 'permanent-failure';
}
