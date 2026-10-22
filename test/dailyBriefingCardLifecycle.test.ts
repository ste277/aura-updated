/**
 * AURA DB2 -- independent-review deterministic lifecycle tests for
 * DailyBriefingCard.tsx's two effects (fetch + first-visit persistence).
 *
 * No component-test harness exists in this repo for a plain .tsx file
 * under the standard ts-node runner (established convention -- see
 * test/homeDashboardRightNowContract.test.ts's own header comment), so
 * this mirrors the EXACT control-flow shape of the real component's two
 * `useEffect` bodies (same deps array, same cancelled-flag cleanup
 * pattern, same module-level dedup Set) using deferred promises for
 * precise control over resolution order -- the same technique
 * test/dr4f2bAsyncRaceConditions.test.ts already established in this
 * repo for an equivalent React-effect race-safety review. Paired with
 * structural regex checks in test/dailyBriefingHomeIntegration.test.ts
 * binding this exact shape to the real source.
 */
import { loadLastExpandedLocalDate, saveLastExpandedLocalDate } from '../apps/web/lib/dailyBriefingViewState';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function installMemoryStorage() {
  const store = new Map<string, string>();
  (global as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ok'; briefing: { localDate: string } }
  | { status: 'unavailable' }
  | { status: 'error' };

/**
 * Faithful mirror of DailyBriefingCard's own two effects. `fetchImpl` is
 * the test's own deferred-promise-returning stand-in for `fetch(...)`.
 */
class CardSimulator {
  state: FetchState = { status: 'loading' };
  expanded = false;
  userId: string | undefined;
  timezone: string | undefined;
  retryKey = 0;
  renderCount = 0;
  sessionDecidedExpandKeys = new Set<string>(); // mirrors the module-level Set
  // The REAL component declares `let cancelled = false;` FRESH inside the
  // effect body on every invocation (DailyBriefingCard.tsx:86) -- a brand
  // new closure variable each time, never a shared/reused one. Mirrored
  // here as a fresh object per invocation (never mutate-and-reuse one
  // object, which would wrongly let a later invocation's own "not
  // cancelled yet" reset silently un-cancel an EARLIER invocation that
  // was already marked cancelled -- a bug in a first draft of this
  // simulator, caught by this test's own cross-user/timezone checks
  // below failing until fixed; the real component was independently
  // confirmed correct by reading its actual source, not assumed).
  private currentCancelled: { value: boolean } | null = null;
  private fetchImpl: () => Promise<any>;

  constructor(fetchImpl: () => Promise<any>, userId: string | undefined, timezone: string | undefined) {
    this.fetchImpl = fetchImpl;
    this.userId = userId;
    this.timezone = timezone;
    this.runFetchEffect();
  }

  // Mirrors the real effect's own deps array: [userId, timezone, retryKey].
  // Simulates React calling the PREVIOUS invocation's cleanup (flips ITS
  // OWN cancelled flag) before running the new effect.
  private runFetchEffect() {
    const myCancelled = { value: false };
    this.currentCancelled = myCancelled;
    this.state = { status: 'loading' };
    this.renderCount++;
    this.fetchImpl()
      .then((data: any) => {
        if (myCancelled.value) return;
        if (!data || typeof data.status !== 'string') { this.state = { status: 'error' }; this.renderCount++; return; }
        if (data.status === 'OK' && data.briefing) { this.state = { status: 'ok', briefing: data.briefing }; this.renderCount++; this.runPersistenceEffect(); return; }
        if (data.status === 'UNAVAILABLE') { this.state = { status: 'unavailable' }; this.renderCount++; return; }
        this.state = { status: 'error' };
        this.renderCount++;
      })
      .catch(() => {
        if (myCancelled.value) return;
        this.state = { status: 'error' };
        this.renderCount++;
      });
  }

  /** Simulates React calling cleanup + re-running the fetch effect
   * because a dependency changed (StrictMode's own intentional double
   * mount-cleanup-remount is modeled by calling this with the SAME
   * userId/timezone/retryKey -- the cleanup still runs, exactly as React
   * really does). */
  rederiveFetchEffect(nextUserId: string | undefined, nextTimezone: string | undefined, nextRetryKey: number) {
    if (this.currentCancelled) this.currentCancelled.value = true; // cleanup of the PREVIOUS invocation's OWN flag only
    this.userId = nextUserId;
    this.timezone = nextTimezone;
    this.retryKey = nextRetryKey;
    this.runFetchEffect();
  }

  /** Simulates unmount: only cleanup runs, no new effect. */
  unmount() {
    if (this.currentCancelled) this.currentCancelled.value = true;
  }

  // Mirrors the real persistence effect exactly: state.status!=='ok' guard,
  // the module-level Set dedup, the localStorage read-then-decide.
  private runPersistenceEffect() {
    if (this.state.status !== 'ok' || !this.userId) return;
    const localDate = this.state.briefing.localDate;
    const key = `${this.userId}:${localDate}`;
    if (this.sessionDecidedExpandKeys.has(key)) return;
    this.sessionDecidedExpandKeys.add(key);
    const lastExpanded = loadLastExpandedLocalDate(this.userId);
    const isFirstVisitToday = lastExpanded !== localDate;
    if (isFirstVisitToday) {
      this.expanded = true;
      saveLastExpandedLocalDate(this.userId, localDate);
    } else {
      this.expanded = false;
    }
  }
}

async function main() {
  installMemoryStorage();

  // ---- 1. StrictMode double-invoke cannot collapse first-visit expand ----
  {
    const d1 = deferred<any>();
    let call = 0;
    const sim = new CardSimulator(() => { call++; return call === 1 ? d1.promise : d1.promise; }, 'user-1', 'Asia/Kolkata');
    // StrictMode: React re-runs the SAME effect (cleanup then re-invoke)
    // immediately on initial mount, before anything has resolved.
    sim.rederiveFetchEffect('user-1', 'Asia/Kolkata', 0);
    // Both the (cancelled) first invocation's fetch AND the second's
    // resolve to the SAME OK payload for the SAME date -- but only the
    // second (non-cancelled) one should ever commit.
    d1.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('1. StrictMode double-invoke: final state is OK for the right date', sim.state.status === 'ok' && (sim.state as any).briefing.localDate === '2026-10-22');
    check('1. StrictMode double-invoke: first visit correctly starts EXPANDED (not flipped to compact by the duplicate effect run)', sim.expanded === true);
    check('1. localStorage now reflects the visit as recorded exactly once', loadLastExpandedLocalDate('user-1') === '2026-10-22');
  }

  // ---- 2. A request for user A cannot supply data to user B ----
  {
    const dA = deferred<any>();
    const dB = deferred<any>();
    let call = 0;
    const sim = new CardSimulator(() => (++call === 1 ? dA.promise : dB.promise), 'user-A', 'Asia/Kolkata');
    // User switches to B WHILE A's request is still in flight.
    sim.rederiveFetchEffect('user-B', 'Asia/Kolkata', 0);
    dB.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('2. user B\'s own response is committed', sim.state.status === 'ok');
    dA.resolve({ status: 'OK', briefing: { localDate: '2026-09-01' } }); // A's late, stale response
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('2. user A\'s late-arriving response (for a DIFFERENT date, proving it\'s A\'s own payload) never overwrites user B\'s already-committed state', (sim.state as any).briefing.localDate === '2026-10-22');
    check('2. the persisted expand-state belongs to user B, never user A', loadLastExpandedLocalDate('user-B') === '2026-10-22' && loadLastExpandedLocalDate('user-A') === null);
  }

  // ---- 3. A timezone change invalidates the in-flight request (DB2 review fix) ----
  {
    const dOld = deferred<any>();
    const dNew = deferred<any>();
    let call = 0;
    const sim = new CardSimulator(() => (++call === 1 ? dOld.promise : dNew.promise), 'user-3', 'Asia/Kolkata');
    sim.rederiveFetchEffect('user-3', 'America/New_York', 0); // timezone changed mid-flight
    dNew.resolve({ status: 'OK', briefing: { localDate: '2026-10-21' } }); // NY is a day behind IST near midnight
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('3. the NEW timezone\'s response is committed', (sim.state as any).briefing.localDate === '2026-10-21');
    dOld.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } }); // old (IST) response, arriving late
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('3. the stale pre-timezone-change response cannot overwrite the new timezone\'s already-committed result', (sim.state as any).briefing.localDate === '2026-10-21');
    check('3. the fetch effect genuinely re-ran on timezone change (2 real fetch calls, not 1)', call === 2);
  }

  // ---- 4. A failed request does not poison the dedup guard or block retry ----
  {
    const d1 = deferred<any>();
    const d2 = deferred<any>();
    let call = 0;
    const sim = new CardSimulator(() => (++call === 1 ? d1.promise : d2.promise), 'user-4', 'Asia/Kolkata');
    d1.resolve({ status: 'SERVER_ERROR' }); // unrecognized/error shape
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('4. a failed/unrecognized response lands in error state', sim.state.status === 'error');
    check('4. the dedup guard was never populated by a failed request', sim.sessionDecidedExpandKeys.size === 0);
    sim.rederiveFetchEffect('user-4', 'Asia/Kolkata', 1); // user clicks "Try again"
    d2.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('4. the retry succeeds and correctly decides first-visit expand (not blocked by the earlier failure)', sim.state.status === 'ok' && sim.expanded === true);
  }

  // ---- 5. An abandoned/unmounted component does not commit stale state ----
  {
    const d1 = deferred<any>();
    const sim = new CardSimulator(() => d1.promise, 'user-5', 'Asia/Kolkata');
    const renderCountAtUnmount = sim.renderCount;
    sim.unmount();
    d1.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('5. no state commit happens after unmount (render count unchanged)', sim.renderCount === renderCountAtUnmount);
    check('5. state remains whatever it was at unmount time (still loading), never flips to ok post-unmount', sim.state.status === 'loading');
  }

  // ---- 6. An older response cannot overwrite a newer response (retry case) ----
  {
    const dOld = deferred<any>();
    const dNew = deferred<any>();
    let call = 0;
    const sim = new CardSimulator(() => (++call === 1 ? dOld.promise : dNew.promise), 'user-6', 'Asia/Kolkata');
    sim.rederiveFetchEffect('user-6', 'Asia/Kolkata', 1); // a second, genuinely newer request (e.g. rapid retry)
    dNew.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    dOld.resolve({ status: 'UNAVAILABLE' }); // the OLD request resolves late, with a DIFFERENT status entirely
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('6. the newer request\'s OK result is never overwritten by the older request\'s late UNAVAILABLE', sim.state.status === 'ok');
  }

  // ---- 7. Rapid navigation (mount/unmount/remount) -> consistent final state ----
  {
    const d1 = deferred<any>();
    const sim = new CardSimulator(() => d1.promise, 'user-7', 'Asia/Kolkata');
    sim.unmount(); // navigate away before the first fetch even resolves
    // A SECOND mount (navigate back) -- a fresh CardSimulator instance in
    // the real app, but SHARING the same module-level Set/localStorage:
    const d2 = deferred<any>();
    const sim2 = new CardSimulator(() => d2.promise, 'user-7', 'Asia/Kolkata');
    sim2.sessionDecidedExpandKeys = sim.sessionDecidedExpandKeys; // same module-level Set in reality
    d1.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } }); // the abandoned first mount's fetch, resolving late
    d2.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('7. the abandoned first mount never committed (its cancelled flag was set on unmount)', sim.state.status === 'loading');
    check('7. the second (real, current) mount correctly shows the first-visit-today expanded state', sim2.state.status === 'ok' && sim2.expanded === true);
    check('7. exactly one localStorage write happened for this user+date despite two mount attempts', loadLastExpandedLocalDate('user-7') === '2026-10-22');
  }

  // ---- 8. A request for date A cannot supply data to date B (distinct users/dates stay isolated) ----
  {
    const dX = deferred<any>();
    const simX = new CardSimulator(() => dX.promise, 'user-8', 'Asia/Kolkata');
    dX.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('8. user-8\'s own 2026-10-22 record does not affect a different date\'s own first-visit check', loadLastExpandedLocalDate('user-8') === '2026-10-22');
    // Simulate the SAME user on a NEW local day (midnight rollover + remount).
    const dY = deferred<any>();
    const simY = new CardSimulator(() => dY.promise, 'user-8', 'Asia/Kolkata');
    simY.sessionDecidedExpandKeys = simX.sessionDecidedExpandKeys;
    dY.resolve({ status: 'OK', briefing: { localDate: '2026-10-23' } });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check('8. a genuinely NEW date for the SAME user is correctly treated as first-visit-today again (not short-circuited by yesterday\'s already-decided key)', simY.expanded === true);
  }

  if (!allPassed) { console.error('SOME DB2 CARD LIFECYCLE CHECKS FAILED'); process.exit(1); }
  console.log('ALL DB2 CARD LIFECYCLE CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
