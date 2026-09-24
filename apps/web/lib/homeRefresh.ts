/**
 * Daily Experience V1 PR B (refresh-failure correction) -- the ONLY
 * synchronization Home runs after a CONFIRMED plan completion.
 *
 * The completion itself is already durable (POST /api/plans/[id]/log
 * committed). Everything here is secondary reconciliation and must NEVER
 * turn a transient failure into a lost session or a lost Home:
 *  - each read is independent; a failed/non-OK/unparseable response leaves
 *    that slice of state at its last-known-good value;
 *  - it never touches the authenticated user;
 *  - only a definitive 401 on one of the reads escalates, and it escalates
 *    by re-running the application's own authoritative session check
 *    (`reauthenticate`, i.e. loadUserDataAndLogs) -- it does not decide
 *    "logged out" itself.
 * (The Plan tab's broader loadUserDataAndLogs treats ANY exception as
 * "no user"; that global contract is tracked separately.)
 */
export interface HomeRefreshDeps {
  fetchImpl: typeof fetch;
  applyLogs: (json: unknown) => void;
  applyHabits: (json: unknown) => void;
  applyPlans: (json: unknown) => void;
  refreshMyDay: () => Promise<void>;
  refreshGuidance: () => Promise<void>;
  /** Reminder projection source. Reconciliation only: Home's confirmed-completion filter stays authoritative even if this returns stale data. */
  refreshAuraUpdates: () => Promise<void>;
  reauthenticate: () => Promise<void>;
}

export async function refreshAfterHomeCompletion(deps: HomeRefreshDeps): Promise<{ unauthorized: boolean }> {
  let unauthorized = false;
  const pull = async (url: string, apply: (json: unknown) => void) => {
    try {
      const res = await deps.fetchImpl(url);
      if (res.status === 401) {
        unauthorized = true;
        return;
      }
      if (!res.ok) return;
      apply(await res.json());
    } catch {
      // last-known-good state stays
    }
  };
  const safely = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch {
      // last-known-good state stays
    }
  };
  await Promise.all([
    pull('/api/habit-logs', deps.applyLogs),
    pull('/api/habits', deps.applyHabits),
    pull('/api/plans', deps.applyPlans),
    safely(deps.refreshMyDay),
    safely(deps.refreshGuidance),
    safely(deps.refreshAuraUpdates),
  ]);
  if (unauthorized) await safely(deps.reauthenticate);
  return { unauthorized };
}
