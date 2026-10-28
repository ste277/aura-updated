/**
 * AURA DB3 -- deterministic deferred-promise race tests for
 * InsightsDailyBriefingSection.tsx's fetch effect, mirroring the EXACT
 * control-flow shape of the real component's single `useEffect` (same
 * per-invocation `let cancelled = false;` closure, same dependency array
 * [userId, timezone, selectedDate, retryKey], same sequential
 * briefing-then-reflection fetch for the YESTERDAY case) using deferred
 * promises for precise control over resolution order -- the same
 * technique test/dailyBriefingCardLifecycle.test.ts (DB2's own
 * independent review) already established and proved sound for this
 * exact closure pattern. Paired with the structural regex checks in
 * test/insightsDailyBriefingStructural.test.ts binding this shape to the
 * real source.
 */

// Forces module scope (no shared top-level `let allPassed`/`check`
// collision with any other script-scope test file compiled together by
// the root tsconfig) -- this file otherwise has no real import of its
// own, same fix DB2's own dailyBriefingViewState.test.ts needed.
export {};

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
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

/** Faithful mirror of InsightsDailyBriefingSection's own effect. `fetchImpl`
 * is the test's own deferred-promise-returning stand-in for `fetch(url)`,
 * receiving the URL so a test can distinguish the briefing call from the
 * yesterday-only reflection call. */
class SectionSimulator {
  state: FetchState = { status: 'loading' };
  reflection: { outputLevel: string } | null = null;
  userId: string | undefined;
  timezone: string;
  selectedDate: 'TODAY' | 'YESTERDAY';
  retryKey = 0;
  private currentCancelled: { value: boolean } | null = null;
  private fetchImpl: (url: string) => Promise<any>;

  constructor(fetchImpl: (url: string) => Promise<any>, userId: string | undefined, timezone: string, selectedDate: 'TODAY' | 'YESTERDAY') {
    this.fetchImpl = fetchImpl;
    this.userId = userId;
    this.timezone = timezone;
    this.selectedDate = selectedDate;
    this.runEffect();
  }

  private async runEffect() {
    const myCancelled = { value: false }; // FRESH every invocation -- mirrors `let cancelled = false;` declared inside the real effect body
    this.currentCancelled = myCancelled;
    this.state = { status: 'loading' };
    this.reflection = null;

    const url = this.selectedDate === 'YESTERDAY' ? `/api/daily-briefing/today?date=yesterday-for-${this.userId}` : '/api/daily-briefing/today';
    const data = await this.fetchImpl(url).catch(() => null);
    if (myCancelled.value) return;

    if (!data || typeof data.status !== 'string') { this.state = { status: 'error' }; return; }
    if (data.status === 'OK' && data.briefing) {
      this.state = { status: 'ok', briefing: data.briefing };
      if (this.selectedDate === 'YESTERDAY') {
        const refData = await this.fetchImpl(`/api/daily-assistant/reflection?date=${data.briefing.localDate}`).catch(() => null);
        if (myCancelled.value) return;
        if (refData && typeof refData.outputLevel === 'string') this.reflection = { outputLevel: refData.outputLevel };
      }
      return;
    }
    if (data.status === 'UNAVAILABLE') { this.state = { status: 'unavailable' }; return; }
    this.state = { status: 'error' };
  }

  /** Simulates React re-running the effect because a dependency changed:
   * cleanup of the PREVIOUS invocation's own flag, then a fresh invocation. */
  rederive(next: Partial<Pick<SectionSimulator, 'userId' | 'timezone' | 'selectedDate' | 'retryKey'>>) {
    if (this.currentCancelled) this.currentCancelled.value = true;
    Object.assign(this, next);
    this.runEffect();
  }

  unmount() {
    if (this.currentCancelled) this.currentCancelled.value = true;
  }
}

async function tick(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

async function main() {
  // ---- 1. Today request resolves AFTER switching to Yesterday ----
  {
    const dToday = deferred<any>();
    const dYesterday = deferred<any>();
    const sim = new SectionSimulator((url) => (url.includes('date=') ? dYesterday.promise : dToday.promise), 'u1', 'Asia/Kolkata', 'TODAY');
    sim.rederive({ selectedDate: 'YESTERDAY' });
    dYesterday.resolve({ status: 'OK', briefing: { localDate: '2026-10-21' } });
    await tick();
    check('1. yesterday\'s response is committed', (sim.state as any).briefing?.localDate === '2026-10-21');
    dToday.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } }); // today's late, stale response
    await tick();
    check('1. today\'s late-arriving (pre-switch) response cannot overwrite the already-selected Yesterday result', (sim.state as any).briefing?.localDate === '2026-10-21');
  }

  // ---- 2. Yesterday request resolves AFTER switching back to Today ----
  {
    const dYesterday = deferred<any>();
    const dToday = deferred<any>();
    let call = 0;
    const sim = new SectionSimulator(() => (++call === 1 ? dYesterday.promise : dToday.promise), 'u2', 'Asia/Kolkata', 'YESTERDAY');
    sim.rederive({ selectedDate: 'TODAY' });
    dToday.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await tick();
    check('2. today\'s response is committed', (sim.state as any).briefing?.localDate === '2026-10-22');
    dYesterday.resolve({ status: 'OK', briefing: { localDate: '2026-10-21' } }); // yesterday's late, stale response
    await tick();
    check('2. yesterday\'s late-arriving (pre-switch-back) response cannot overwrite the already-selected Today result', (sim.state as any).briefing?.localDate === '2026-10-22');
  }

  // ---- 3. User changes during request ----
  {
    const dA = deferred<any>();
    const dB = deferred<any>();
    let call = 0;
    const sim = new SectionSimulator(() => (++call === 1 ? dA.promise : dB.promise), 'userA', 'Asia/Kolkata', 'TODAY');
    sim.rederive({ userId: 'userB' });
    dB.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await tick();
    dA.resolve({ status: 'OK', briefing: { localDate: '2099-01-01' } }); // userA's late response, a wildly different date proving it's A's own stale payload
    await tick();
    check('3. userA\'s late-arriving response can never land after switching to userB', (sim.state as any).briefing?.localDate === '2026-10-22');
  }

  // ---- 4. Timezone changes during request ----
  {
    const dOld = deferred<any>();
    const dNew = deferred<any>();
    let call = 0;
    const sim = new SectionSimulator(() => (++call === 1 ? dOld.promise : dNew.promise), 'u4', 'Asia/Kolkata', 'TODAY');
    sim.rederive({ timezone: 'America/New_York' });
    dNew.resolve({ status: 'OK', briefing: { localDate: '2026-10-21' } });
    await tick();
    dOld.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await tick();
    check('4. a timezone change invalidates the in-flight request -- the pre-change response cannot overwrite the new timezone\'s result', (sim.state as any).briefing?.localDate === '2026-10-21');
  }

  // ---- 5. Component unmounts ----
  {
    const d1 = deferred<any>();
    const sim = new SectionSimulator(() => d1.promise, 'u5', 'Asia/Kolkata', 'TODAY');
    sim.unmount();
    d1.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await tick();
    check('5. no state commit happens after unmount', sim.state.status === 'loading');
  }

  // ---- 6. Retry starts before an older response resolves ----
  {
    const d1 = deferred<any>();
    const d2 = deferred<any>();
    let call = 0;
    const sim = new SectionSimulator(() => (++call === 1 ? d1.promise : d2.promise), 'u6', 'Asia/Kolkata', 'TODAY');
    sim.rederive({ retryKey: 1 }); // user clicks "Try again" before the first request even settled
    d2.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await tick();
    d1.resolve({ status: 'ERROR_SHOULD_NOT_LAND' } as any);
    await tick();
    check('6. the retry\'s own result wins; the original (now-cancelled) request\'s late settlement never lands', sim.state.status === 'ok');
  }

  // ---- 7. Older errors cannot overwrite newer successful results ----
  {
    const dOld = deferred<any>();
    const dNew = deferred<any>();
    let call = 0;
    const sim = new SectionSimulator(() => (++call === 1 ? dOld.promise : dNew.promise), 'u7', 'Asia/Kolkata', 'TODAY');
    sim.rederive({ selectedDate: 'YESTERDAY' }); // a genuinely newer request
    dNew.resolve({ status: 'OK', briefing: { localDate: '2026-10-21' } });
    await tick();
    check('7. the newer request\'s OK result is committed', sim.state.status === 'ok');
    dOld.resolve({ status: 'SERVER_ERROR' }); // the OLDER request's error, arriving late
    await tick();
    check('7. the older request\'s late ERROR can never overwrite the newer, already-committed OK result', sim.state.status === 'ok' && (sim.state as any).briefing.localDate === '2026-10-21');
  }

  // ---- 8. Yesterday's reflection fetch is itself guarded by the SAME cancellation (a date switch mid-reflection-fetch) ----
  {
    const dBriefing = deferred<any>();
    const dReflection = deferred<any>();
    const dTodayBriefing = deferred<any>();
    let call = 0;
    const sim = new SectionSimulator((url) => {
      call++;
      if (call === 1) return dBriefing.promise; // yesterday's briefing
      if (call === 2) return dReflection.promise; // yesterday's reflection (fired only after briefing resolves)
      return dTodayBriefing.promise; // the switch-back-to-today briefing
    }, 'u8', 'Asia/Kolkata', 'YESTERDAY');
    dBriefing.resolve({ status: 'OK', briefing: { localDate: '2026-10-21' } });
    await tick();
    // User switches back to Today WHILE the reflection fetch (triggered by
    // yesterday's briefing resolving) is still in flight.
    sim.rederive({ selectedDate: 'TODAY' });
    dTodayBriefing.resolve({ status: 'OK', briefing: { localDate: '2026-10-22' } });
    await tick();
    check('8. switching to Today while yesterday\'s reflection fetch is still in flight correctly shows today\'s briefing', (sim.state as any).briefing?.localDate === '2026-10-22');
    dReflection.resolve({ outputLevel: 'PEAK_FLOW' }); // the abandoned reflection fetch, resolving late
    await tick();
    check('8. the abandoned reflection fetch never attaches its result to the (now Today) state -- reflection stays null', sim.reflection === null);
  }

  if (!allPassed) { console.error('SOME DB3 INSIGHTS RACE CONDITION CHECKS FAILED'); process.exit(1); }
  console.log('ALL DB3 INSIGHTS RACE CONDITION CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
