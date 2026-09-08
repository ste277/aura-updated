/**
 * My Day Day-Boundary Refresh V1 -- the one pure decision behind the
 * visibilitychange/focus lifecycle wiring in page.tsx (brief: "natural
 * lifecycle refresh", explicitly NOT setInterval/polling). Given the
 * Timing Location date key My Day was last successfully loaded for, and
 * the current Timing Location date key, should an "app became visible
 * again" moment trigger a refetch?
 *
 * Never true before any successful load -- there is nothing stale yet,
 * and the existing mount/tab-switch-to-Home path already owns first load
 * (see page.tsx's own activeTab effect). Never true on a same-day return
 * -- that is the entire point of comparing date keys instead of
 * refetching on every focus event, which would just be polling in
 * disguise.
 */
export function shouldRefreshMyDayForDateChange(lastLoadedDateKey: string | null, currentDateKey: string): boolean {
  return lastLoadedDateKey !== null && lastLoadedDateKey !== currentDateKey;
}
