/**
 * Constructor scheduling correctness -- overlapping plan blockers (pure).
 *
 * The REAL orchestrator and the REAL constructDay run; only the database
 * loaders and the timing search are injected. Proves:
 *   - the blocker load range is the civil day AND the construction window
 *     (`resolveBlockerLoadBounds`), loaded exactly once
 *   - a returned plan that started before the day and overlaps the window
 *     blocks exactly the overlapping portion; a timing candidate inside it
 *     is rejected, never proposed
 *   - lifecycle semantics are unchanged (UPCOMING/LOGGED block;
 *     CANCELLED/SKIPPED/MOVED do not)
 *   - DST-length civil days are bounded by the existing authoritative
 *     timezone logic (no 24-hour arithmetic)
 */
import { orchestrateConstructDay, resolveBlockerLoadBounds, type ConstructDayRequest, type DayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { localDayBoundsUTC } from '../apps/web/lib/myDayOrchestrator';
import type { PlanBlockerCandidate } from '../apps/web/lib/planBlockerLifecycle';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const iso = (s: string) => new Date(s);
const HOUR = 3600000;

(async () => {
  // ---------------- resolveBlockerLoadBounds ----------------
  const day = { from: iso('2026-10-07T00:00:00Z'), to: iso('2026-10-08T00:00:00Z') };
  const same = (a: { from: Date; to: Date }, f: string, t: string) => a.from.toISOString() === iso(f).toISOString() && a.to.toISOString() === iso(t).toISOString();
  check('a window inside the day: the range is the day itself', same(resolveBlockerLoadBounds(day, { start: iso('2026-10-07T09:00:00Z'), end: iso('2026-10-07T17:00:00Z') }), '2026-10-07T00:00:00Z', '2026-10-08T00:00:00Z'));
  check('a window exactly equal to the day: the day', same(resolveBlockerLoadBounds(day, { start: day.from, end: day.to }), '2026-10-07T00:00:00Z', '2026-10-08T00:00:00Z'));
  check('a window reaching past the END of the day extends the range end', same(resolveBlockerLoadBounds(day, { start: iso('2026-10-07T22:00:00Z'), end: iso('2026-10-08T03:00:00Z') }), '2026-10-07T00:00:00Z', '2026-10-08T03:00:00Z'));
  check('a window starting BEFORE the day extends the range start', same(resolveBlockerLoadBounds(day, { start: iso('2026-10-06T22:00:00Z'), end: iso('2026-10-07T03:00:00Z') }), '2026-10-06T22:00:00Z', '2026-10-08T00:00:00Z'));
  check('a window spanning both ends extends both', same(resolveBlockerLoadBounds(day, { start: iso('2026-10-06T22:00:00Z'), end: iso('2026-10-08T03:00:00Z') }), '2026-10-06T22:00:00Z', '2026-10-08T03:00:00Z'));
  check('the inputs are never mutated', (() => { const d = { from: new Date(day.from), to: new Date(day.to) }; resolveBlockerLoadBounds(d, { start: iso('2026-10-06T22:00:00Z'), end: iso('2026-10-08T03:00:00Z') }); return d.from.getTime() === day.from.getTime() && d.to.getTime() === day.to.getTime(); })());

  // ---------------- the orchestrator with a returned overlapping plan ----------------
  const cand = (s: string, e: string) => ({ start: s, end: e, score: 5, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: '2026-10-07' } }) as any;
  const fakeDeps = (plans: PlanBlockerCandidate[], boundsLog: Array<{ from: Date; to: Date }>): DayConstructorOrchestratorDeps => ({
    loadBlockingPlans: async (bounds) => {
      boundsLog.push(bounds);
      return plans;
    },
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    // Engine stand-in offering three fixed candidates; whether each is placeable is decided by the REAL constructDay against the blockers.
    searchTiming: () => {
      const all = [cand('2026-10-07T10:30:00Z', '2026-10-07T11:30:00Z'), cand('2026-10-07T12:00:00Z', '2026-10-07T13:00:00Z'), cand('2026-10-07T14:00:00Z', '2026-10-07T15:00:00Z')];
      return { candidates: all };
    },
    loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
  });
  const req = (extra: Partial<ConstructDayRequest> = {}): ConstructDayRequest => ({
    targetDate: '2026-10-07',
    timezone: 'UTC',
    constructionWindowSource: 'EXPLICIT_RANGE',
    now: iso('2026-10-07T09:00:00Z'),
    explicitStart: iso('2026-10-07T09:00:00Z'),
    explicitEnd: iso('2026-10-07T17:00:00Z'),
    intents: [{ id: 'a', title: 'A', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60, originalOrder: 0 }],
    ...extra,
  });
  const overnight = (status: any): PlanBlockerCandidate => ({ start: iso('2026-10-06T20:00:00Z'), end: iso('2026-10-07T12:00:00Z'), status });
  const run = async (plans: PlanBlockerCandidate[], extra: Partial<ConstructDayRequest> = {}) => {
    const log: Array<{ from: Date; to: Date }> = [];
    const r: any = await orchestrateConstructDay(req(extra), fakeDeps(plans, log));
    return { r, log };
  };
  {
    const { r, log } = await run([overnight('UPCOMING')]);
    const d = r.preview.constructedDay;
    check('an overlapping plan that STARTED the previous day blocks exactly the overlapping portion (09:00-12:00 = 180 of 480)', d.requestedCapacity.blockedMinutes === 180 && d.requestedCapacity.constructionWindowMinutes === 480);
    check('a timing candidate inside it (10:30) is rejected, never proposed; the first clear candidate (12:00) is', d.proposedItems.length === 1 && d.proposedItems[0].start.toISOString() === '2026-10-07T12:00:00.000Z');
    check('the blocker load happens exactly once, over the day bounds for an ordinary window', log.length === 1 && log[0].from.toISOString() === '2026-10-07T00:00:00.000Z' && log[0].to.toISOString() === '2026-10-08T00:00:00.000Z');
  }
  {
    const { log } = await run([], { explicitStart: iso('2026-10-07T22:00:00Z'), explicitEnd: iso('2026-10-08T03:00:00Z') });
    check('a window crossing midnight loads blockers over day + window (the range reaches the window end), still ONE load', log.length === 1 && log[0].from.toISOString() === '2026-10-07T00:00:00.000Z' && log[0].to.toISOString() === '2026-10-08T03:00:00.000Z');
  }
  for (const [status, blocks] of [['UPCOMING', true], ['LOGGED', true], ['CANCELLED', false], ['SKIPPED', false], ['MOVED', false]] as const) {
    const { r } = await run([overnight(status)]);
    check(`lifecycle unchanged: an overlapping ${status} plan ${blocks ? 'blocks' : 'does not block'}`, r.preview.constructedDay.requestedCapacity.blockedMinutes === (blocks ? 180 : 0));
  }
  {
    const { r } = await run([{ start: iso('2026-10-06T20:00:00Z'), end: iso('2026-10-07T10:00:00Z'), status: 'UPCOMING' }, { start: iso('2026-10-07T10:00:00Z'), end: iso('2026-10-07T12:00:00Z'), status: 'UPCOMING' }]);
    check('adjacent plans touching at a boundary merge: 180 blocked minutes, no phantom gap', r.preview.constructedDay.requestedCapacity.blockedMinutes === 180);
  }
  {
    const { r } = await run([{ start: iso('2026-10-07T14:00:00Z'), end: iso('2026-10-07T14:00:00Z'), status: 'UPCOMING' }]);
    check('a zero-length plan blocks nothing', r.preview.constructedDay.requestedCapacity.blockedMinutes === 0);
  }
  {
    const { r } = await run([{ start: iso('2026-10-06T20:00:00Z'), end: iso('2026-10-07T09:00:00Z'), status: 'UPCOMING' }]);
    check('a plan ending exactly at the window start does not touch the window (half-open)', r.preview.constructedDay.requestedCapacity.blockedMinutes === 0);
    const r2 = await run([{ start: iso('2026-10-07T17:00:00Z'), end: iso('2026-10-07T20:00:00Z'), status: 'UPCOMING' }]);
    check('a plan starting exactly at the window end does not touch the window (half-open)', r2.r.preview.constructedDay.requestedCapacity.blockedMinutes === 0);
  }

  // ---------------- DST-length civil days from the existing timezone authority ----------------
  const hours = (date: string, tz: string) => { const b = localDayBoundsUTC(date, tz); return (b.to.getTime() - b.from.getTime()) / HOUR; };
  check('New York spring forward (2027-03-14) is a 23-hour civil day', hours('2027-03-14', 'America/New_York') === 23);
  check('New York fall back (2026-11-01) is a 25-hour civil day', hours('2026-11-01', 'America/New_York') === 25);
  check('an ordinary day (Asia/Kolkata) is 24 hours', hours('2026-10-07', 'Asia/Kolkata') === 24);
  check('the day bounds do not depend on the process timezone (they are pure functions of the civil date and the user timezone)', localDayBoundsUTC('2026-10-07', 'Asia/Kolkata').from.toISOString() === '2026-10-06T18:30:00.000Z' && localDayBoundsUTC('2026-10-07', 'Asia/Kolkata').to.toISOString() === '2026-10-07T18:30:00.000Z');

  if (!allPassed) {
    console.error('SOME BLOCKER OVERLAP CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL BLOCKER OVERLAP CHECKS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
