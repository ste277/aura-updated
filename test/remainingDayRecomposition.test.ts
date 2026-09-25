/**
 * Remaining-Day Recomposition V1 PR F2 -- read-only proposal generation. The REAL Day Constructor orchestrator runs
 * against injected fakes for the I/O seams (plans, moments, timing search/CHECK, availability, durations), so the
 * KEEP / MOVE / UNRESOLVED policy, protection rules, coherence and determinism are proven without a DB.
 * Live-DB proof (real reads, read-only guarantee, real route boundary): remainingDayRecompositionDb.test.ts.
 */
import fs from 'fs';
import path from 'path';
import {
  recomposeRemainingDay, classifyPlansForRecomposition, compareTimingTiers, isStrictlyBetterTier, MAX_RECOMPOSITION_CANDIDATES,
  type RecompositionDeps, type RemainingDayRecompositionProposal,
} from '../apps/web/lib/remainingDayRecomposition';
import { isActivePlanBlocker } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleRemainingDayRecompositionRequest } from '../apps/web/lib/remainingDayRecompositionServer';
import type { PlannedActivity } from '../apps/web/lib/db';
import type { TimingCandidate, TimingCandidateLabel } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ---------- fixtures: today is 2026-09-16 (UTC), it is 10:00 ----------
const TZ = 'UTC';
const NOW = new Date('2026-09-16T10:00:00Z');
const at = (hhmm: string, day = '2026-09-16') => new Date(`${day}T${hhmm}:00Z`);
const hhmm = (d: Date) => d.toISOString().slice(11, 16);
type Mode = 'FIXED' | 'FLEXIBLE' | null;
let idN = 0;
function mkPlan(over: Partial<PlannedActivity> & { title: string; start: string; dur?: number; mode?: Mode; day?: string }): PlannedActivity {
  const dur = over.dur ?? 60;
  const start = at(over.start, over.day);
  return { id: over.id ?? `p${++idN}-${over.title.replace(/\W/g, '')}`, userId: 'u1', title: over.title, activityType: null, icon: null, status: over.status ?? 'UPCOMING', plannedStartAt: start, plannedEndAt: new Date(start.getTime() + dur * 60000), durationMinutes: dur, windowType: 'NEUTRAL', windowLabel: null, matchLabel: null, score: null, recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, activityId: null, schedulingMode: over.mode === undefined ? null : over.mode, createdAt: start, updatedAt: start } as PlannedActivity;
}
const LABEL: Record<string, TimingCandidateLabel> = { EXCELLENT: 'EXCELLENT', GOOD: 'GOOD', USABLE: 'USABLE', CAUTION: 'CAUTION' };
type Table = Record<string, Record<string, TimingCandidateLabel>>; // title -> start HH:MM -> label
interface Opts { table: Table; availability?: { configured: boolean; periods: { weekday: number; startTime: string; endTime: string }[] }; moments?: string[]; failSearch?: boolean; failCheck?: boolean; checkTable?: Table; unfiltered?: boolean; tz?: string; now?: Date; calls?: { search: number; load: number; bounds: { from: Date; to: Date }[] } }
function deps(plans: PlannedActivity[], o: Opts): RecompositionDeps {
  const calls = o.calls ?? { search: 0, load: 0, bounds: [] };
  const candidate = (start: Date, dur: number, label: TimingCandidateLabel): TimingCandidate => ({ start: start.toISOString(), end: new Date(start.getTime() + dur * 60000).toISOString(), score: 7, label, muhurtaScore: 0, reasons: [] } as unknown as TimingCandidate);
  return {
    loadPlansForDay: async (bounds) => { calls.load += 1; calls.bounds.push(bounds); return plans.map((p) => ({ ...p })); },
    loadPlanIdsWithActiveMoment: async (ids) => new Set((o.moments ?? []).filter((id) => ids.includes(id))),
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    loadAvailabilityConfiguration: async () => (o.availability ?? { configured: false, periods: [] }) as any,
    searchTiming: (request: any) => {
      calls.search += 1;
      if (o.failSearch) throw new Error('search exploded');
      const rows = o.table[request.taskTitle ?? ''] ?? {};
      const dur = request.durationMinutes as number;
      const excluded: { start: string; end: string }[] = request.excludedIntervals ?? [];
      const all = Object.entries(rows).map(([s, label]) => candidate(at(s), dur, label));
      const kept = o.unfiltered ? all : all.filter((c) => !excluded.some((e: any) => new Date(c.start).getTime() < new Date(e.end).getTime() && new Date(e.start).getTime() < new Date(c.end).getTime()));
      return { candidates: kept } as any;
    },
    checkTiming: (request) => {
      if (o.failCheck) throw new Error('check exploded');
      const label = (o.checkTable ?? o.table)[request.taskTitle ?? '']?.[hhmm(request.candidateStart)];
      if (!label) throw new Error(`no fake CHECK label for ${request.taskTitle} @ ${hhmm(request.candidateStart)}`);
      return candidate(request.candidateStart, request.durationMinutes, label);
    },
  };
}
const run = (plans: PlannedActivity[], o: Opts) => recomposeRemainingDay({ timezone: o.tz ?? TZ, now: o.now ?? NOW }, deps(plans, o));
async function propose(plans: PlannedActivity[], o: Opts): Promise<RemainingDayRecompositionProposal> {
  const r = await run(plans, o);
  if (r.status !== 'READY') throw new Error(`expected READY, got ${r.status}`);
  return r.proposal;
}
const dec = (p: RemainingDayRecompositionProposal, plan: PlannedActivity) => p.decisions.find((d) => d.planId === plan.id)!;
const overlap = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
const iso = (v: unknown) => JSON.stringify(v);

async function main() {
  // ---------- 41/44. tier order is the Constructor's own ----------
  check('31. the strict tier order is read back from the Constructor (BEST < GOOD < WORKABLE < CAUTION < unknown) -- no invented score', compareTimingTiers('BEST', 'GOOD') === -1 && compareTimingTiers('GOOD', 'WORKABLE') === -1 && compareTimingTiers('WORKABLE', 'CAUTION') === -1 && compareTimingTiers('CAUTION', null) === -1 && compareTimingTiers('GOOD', 'GOOD') === 0 && compareTimingTiers(null, undefined) === 0 && compareTimingTiers('CAUTION', 'BEST') === 1);
  check('30/31. strictly better means a different, better tier: same tier is NOT better; unknown is never better than a real tier', isStrictlyBetterTier('BEST', 'GOOD') && !isStrictlyBetterTier('GOOD', 'GOOD') && !isStrictlyBetterTier('WORKABLE', 'GOOD') && !isStrictlyBetterTier(null, 'CAUTION') && isStrictlyBetterTier('CAUTION', null));

  // ---------- 62. protection (pure classification + service) ----------
  {
    const fixedFuture = mkPlan({ title: 'Zork fixed', start: '14:00', mode: 'FIXED' });
    const nullFuture = mkPlan({ title: 'Zork null', start: '15:00', mode: null });
    const activeFlex = mkPlan({ title: 'Zork active', start: '09:30', mode: 'FLEXIBLE' }); // 09:30-10:30, now is 10:00
    const missedFlex = mkPlan({ title: 'Zork missed', start: '07:00', mode: 'FLEXIBLE' });
    const logged = mkPlan({ title: 'Zork logged', start: '16:00', mode: 'FLEXIBLE', status: 'LOGGED' });
    const skipped = mkPlan({ title: 'Zork skipped', start: '16:00', mode: 'FLEXIBLE', status: 'SKIPPED' });
    const moved = mkPlan({ title: 'Zork moved', start: '17:00', mode: 'FLEXIBLE', status: 'MOVED' });
    const momentFlex = mkPlan({ title: 'Zork moment', start: '18:00', mode: 'FLEXIBLE' });
    const crossMidnight = mkPlan({ title: 'Zork late', start: '23:30', dur: 60, mode: 'FLEXIBLE' });
    const unknownMode = { ...mkPlan({ title: 'Zork weird', start: '19:00' }), schedulingMode: 'flexible' } as unknown as PlannedActivity;
    const inconsistent = { ...mkPlan({ title: 'Zork bad duration', start: '20:00', mode: 'FLEXIBLE' }), durationMinutes: 45 } as PlannedActivity;
    const ok = mkPlan({ title: 'Zork ok', start: '21:00', mode: 'FLEXIBLE' });
    const all = [fixedFuture, nullFuture, activeFlex, missedFlex, logged, skipped, moved, momentFlex, crossMidnight, unknownMode, inconsistent, ok];
    const bounds = { from: at('00:00'), to: at('00:00', '2026-09-17') };
    const c = classifyPlansForRecomposition(all, NOW, bounds, new Set([momentFlex.id]));
    const reasonOf = (p: PlannedActivity) => c.protectedPlans.find((x) => x.planId === p.id)?.reason;
    check('7/62. FIXED future is protected (SCHEDULING_MODE_NOT_FLEXIBLE)', reasonOf(fixedFuture) === 'SCHEDULING_MODE_NOT_FLEXIBLE');
    check('7/62/9. NULL/unknown scheduling mode is protected -- and an unrecognised value ("flexible") is not treated as FLEXIBLE', reasonOf(nullFuture) === 'SCHEDULING_MODE_NOT_FLEXIBLE' && reasonOf(unknownMode) === 'SCHEDULING_MODE_NOT_FLEXIBLE');
    check('7/11/62. an ACTIVE flexible plan is protected (never moved mid-activity)', reasonOf(activeFlex) === 'ACTIVE');
    check('7/10/62. a derived-MISSED flexible plan is protected (Missed Recovery owns it)', reasonOf(missedFlex) === 'MISSED');
    check('12/62. LOGGED / SKIPPED / MOVED history is never a candidate and is not listed', [logged, skipped, moved].every((p) => !c.candidates.some((x) => x.id === p.id) && reasonOf(p) === undefined));
    check('7/62. an active-AuraMoment-linked flexible plan is protected (HAS_ACTIVE_MOMENT)', reasonOf(momentFlex) === 'HAS_ACTIVE_MOMENT');
    check('7/61. a plan that crosses today\'s end is outside scope and protected (OUTSIDE_TODAY)', reasonOf(crossMidnight) === 'OUTSIDE_TODAY');
    check('7. a plan whose end-start disagrees with its duration fails closed (INCONSISTENT_DURATION)', reasonOf(inconsistent) === 'INCONSISTENT_DURATION');
    check('8/63. a future, UPCOMING, explicit-FLEXIBLE plan with no other protection is the ONLY reconsiderable plan', c.candidates.map((p) => p.id).join() === ok.id);
    const many = Array.from({ length: MAX_RECOMPOSITION_CANDIDATES + 3 }, (_, i) => mkPlan({ title: `Zork many ${i}`, start: `${String(11 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, dur: 30, mode: 'FLEXIBLE' }));
    const capped = classifyPlansForRecomposition(many, NOW, bounds, new Set());
    check('40. the candidate set is bounded (12); the rest stay protected (OVER_CANDIDATE_LIMIT)', capped.candidates.length === MAX_RECOMPOSITION_CANDIDATES && capped.protectedPlans.filter((p) => p.reason === 'OVER_CANDIDATE_LIMIT').length === 3);
    // service: protected plans stay BLOCKERS, and are never decided on
    const flex = mkPlan({ title: 'Zork flex', start: '13:00', mode: 'FLEXIBLE' });
    const table: Table = { 'Zork flex': { '13:00': 'GOOD', '14:00': 'EXCELLENT', '18:00': 'EXCELLENT' } };
    const p = await propose([fixedFuture, momentFlex, flex], { table, moments: [momentFlex.id] });
    const d = dec(p, flex);
    check('13/15/62. protected plans remain blockers: the flexible plan never lands on the FIXED 14:00-15:00 or the moment-linked 18:00 slot even though the search offered them (unfiltered candidates)', (await propose([fixedFuture, momentFlex, flex], { table, moments: [momentFlex.id], unfiltered: true })).decisions.every((x) => x.decision !== 'MOVE' || (!overlap(x.to, slotOf(fixedFuture)) && !overlap(x.to, slotOf(momentFlex)))) && d.decision !== undefined);
    check('26/62. decisions cover ONLY reconsidered plans; protected ones are reported with reasons, never decided', p.decisions.every((x) => x.planId === flex.id) && p.protectedPlans.some((x) => x.planId === fixedFuture.id) && p.protectedPlans.some((x) => x.planId === momentFlex.id && x.reason === 'HAS_ACTIVE_MOMENT'));
  }
  function slotOf(p: PlannedActivity) { return { start: new Date(p.plannedStartAt), end: new Date(p.plannedEndAt) }; }

  // ---------- 64. self-block ----------
  {
    const a = mkPlan({ title: 'Zork self', start: '14:00', mode: 'FLEXIBLE' });
    const p = await propose([a], { table: { 'Zork self': { '14:00': 'GOOD' } } }); // the ONLY candidate the search offers is its own slot
    const d = dec(p, a);
    check('13/14/64. self-block release: a flexible plan\'s own slot does not block its own search (its own slot is placeable, so it is KEEP with SAME_SLOT evidence, not stuck)', d.decision === 'KEEP' && d.evidence.alternative.kind === 'SAME_SLOT');
    const p2 = await propose([a], { table: { 'Zork self': { '14:00': 'GOOD', '15:00': 'EXCELLENT' } } });
    check('14/64. and it can hypothetically MOVE out of its own slot (15:00 is strictly better)', dec(p2, a).decision === 'MOVE');
  }

  // ---------- 65/66/67/34. the minimal-disruption rule ----------
  {
    const a = mkPlan({ title: 'Zork tier', start: '14:00', mode: 'FLEXIBLE' });
    const same = dec(await propose([a], { table: { 'Zork tier': { '14:00': 'GOOD', '11:00': 'GOOD' } } }), a);
    check('29/32/65. SAME tier alternative (even EARLIER) -> KEEP: the Constructor\'s earliest-start tie-break is overridden', same.decision === 'KEEP' && same.evidence.alternative.kind === 'SLOT' && (same.evidence.alternative as any).tier === 'GOOD' && same.evidence.currentTier === 'GOOD');
    const worse = dec(await propose([a], { table: { 'Zork tier': { '14:00': 'GOOD', '11:00': 'USABLE' } } }), a);
    check('33/66. WORSE alternative -> KEEP: when the search also offers the current slot the Constructor itself prefers the better tier (SAME_SLOT evidence)', worse.decision === 'KEEP' && (worse.evidence as any).alternative.kind === 'SAME_SLOT');
    const worseOnly = dec(await propose([a], { table: { 'Zork tier': { '11:00': 'USABLE' } }, checkTable: { 'Zork tier': { '14:00': 'GOOD' } } }), a);
    check('33/66. WORSE alternative when the search does NOT offer the current slot: the Constructor proposes it, the policy still says KEEP (evidence records the WORKABLE alternative)', worseOnly.decision === 'KEEP' && (worseOnly.evidence as any).alternative.kind === 'SLOT' && (worseOnly.evidence as any).alternative.tier === 'WORKABLE');
    const sameOnly = dec(await propose([a], { table: { 'Zork tier': { '11:00': 'GOOD' } }, checkTable: { 'Zork tier': { '14:00': 'GOOD' } } }), a);
    check('29/32/65. SAME tier earlier alternative when the search does NOT offer the current slot -> still KEEP', sameOnly.decision === 'KEEP' && (sameOnly.evidence as any).alternative.kind === 'SLOT' && (sameOnly.evidence as any).alternative.tier === 'GOOD');
    const betterOnly = dec(await propose([a], { table: { 'Zork tier': { '11:00': 'EXCELLENT' } }, checkTable: { 'Zork tier': { '14:00': 'GOOD' } } }), a);
    check('30/67. STRICTLY BETTER alternative when the search does not offer the current slot -> MOVE (the current tier comes from the CHECK)', betterOnly.decision === 'MOVE' && betterOnly.reason === 'BETTER_TIMING_TIER');
    const better = dec(await propose([a], { table: { 'Zork tier': { '14:00': 'GOOD', '11:00': 'EXCELLENT' } } }), a);
    check('30/67. STRICTLY BETTER alternative -> MOVE with old/new slot and tier evidence', better.decision === 'MOVE' && better.reason === 'BETTER_TIMING_TIER' && hhmm(better.current.start) === '14:00' && hhmm(better.to.start) === '11:00' && hhmm(better.to.end) === '12:00' && better.durationMinutes === 60 && better.evidence.currentTier === 'GOOD' && better.evidence.proposedTier === 'BEST');
    const none = dec(await propose([a], { table: { 'Zork tier': { '14:00': 'GOOD' } } }), a);
    check('34. the current slot is best and nothing better exists -> KEEP (the common result)', none.decision === 'KEEP');
    const earlierEqual = dec(await propose([a], { table: { 'Zork tier': { '14:00': 'CAUTION', '11:00': 'CAUTION', '12:00': 'CAUTION' } } }), a);
    check('30/32. a lower candidateOrder / earlier start of the same tier never causes a move', earlierEqual.decision === 'KEEP');
    check('20. the current tier comes from the timing CHECK, not from "it is the current slot": a CAUTION current slot is CAUTION and any real better tier moves it', (await propose([a], { table: { 'Zork tier': { '14:00': 'CAUTION', '11:00': 'USABLE' } } })).decisions[0].decision === 'MOVE');
  }

  // ---------- 68/69/35/21. invalid current slot ----------
  {
    const a = mkPlan({ title: 'Zork invalid', start: '14:00', mode: 'FLEXIBLE' });
    const overlapping = mkPlan({ title: 'Zork blocker', start: '14:30', mode: 'FIXED' }); // created without a collision check (POST /api/plans has none)
    const moved = dec(await propose([a, overlapping], { table: { 'Zork invalid': { '14:00': 'GOOD', '16:00': 'USABLE' } } }), a);
    check('21/35/68. a current slot that overlaps a protected commitment is invalid: MOVE with reason CURRENT_SLOT_INVALID even to a WORSE tier', moved.decision === 'MOVE' && moved.reason === 'CURRENT_SLOT_INVALID' && hhmm(moved.to.start) === '16:00' && moved.evidence.currentSlotInvalid === 'BLOCKED_OR_UNAVAILABLE' && moved.evidence.currentTier === 'GOOD' && moved.evidence.proposedTier === 'WORKABLE');
    const stuck = await propose([a, overlapping], { table: { 'Zork invalid': { '14:00': 'GOOD' } } });
    const s = dec(stuck, a);
    check('24/69. invalid current slot and NO alternative -> UNRESOLVED: nothing is deleted, deferred or moved; the plan keeps its slot in the proposal', s.decision === 'UNRESOLVED' && s.reason === 'CURRENT_SLOT_INVALID_NO_ALTERNATIVE' && stuck.proposedState.find((x) => x.planId === a.id)!.slot.start.getTime() === at('14:00').getTime() && stuck.summary.state === 'NO_CHANGES' && stuck.summary.unresolvedCount === 1);
    const gap = mkPlan({ title: 'Zork gap', start: '12:30', mode: 'FLEXIBLE' });
    const availability = { configured: true, periods: [{ weekday: 3, startTime: '10:00', endTime: '12:00' }, { weekday: 3, startTime: '14:00', endTime: '18:00' }] };
    const gapDecision = dec(await propose([gap], { table: { 'Zork gap': { '12:30': 'GOOD', '15:00': 'USABLE' } }, availability }), gap);
    check('21/75. a slot inside a configured availability GAP is invalid (availability reused exactly) and moves into a usable window', gapDecision.decision === 'MOVE' && gapDecision.reason === 'CURRENT_SLOT_INVALID' && hhmm((gapDecision as any).to.start) === '15:00');
  }

  // ---------- 70/71/72/73/74. multi-plan coherence ----------
  {
    const A = mkPlan({ title: 'Zork A', start: '14:00', mode: 'FLEXIBLE' });
    const B = mkPlan({ title: 'Zork B', start: '16:00', mode: 'FLEXIBLE' });
    const ab = await propose([A, B], { table: { 'Zork A': { '14:00': 'GOOD', '11:00': 'GOOD' }, 'Zork B': { '16:00': 'USABLE', '14:00': 'EXCELLENT' } } });
    const dA = dec(ab, A); const dB = dec(ab, B);
    check('37/38/71. POST-HOC CONFLICT REGRESSION: the Constructor first moves A (same tier, earlier) and gives B A\'s old slot; the policy must NOT end with A KEEP + B in A\'s slot', dA.decision === 'KEEP' && !(dB.decision === 'MOVE' && overlap(dB.to, slotOf(A))) && ab.proposedState.every((x, i) => ab.proposedState.every((y, j) => i === j || !overlap(x.slot, y.slot))));
    check('38/71. ...and B, whose only better slot is now taken, is KEEP in its own slot (not left in a stale placement)', dB.decision === 'KEEP' && (dB.evidence as any).alternative.kind === 'SAME_SLOT');
    const ab2 = await propose([A, B], { table: { 'Zork A': { '14:00': 'GOOD', '11:00': 'GOOD' }, 'Zork B': { '16:00': 'USABLE', '14:00': 'EXCELLENT', '12:00': 'EXCELLENT' } } });
    const dB2 = dec(ab2, B);
    check('39/71. with another better slot available, A stays KEEP and B moves THERE (coherent, no overlap)', dec(ab2, A).decision === 'KEEP' && dB2.decision === 'MOVE' && hhmm(dB2.to.start) === '12:00' && ab2.summary.state === 'CHANGES_PROPOSED');
    const imp = await propose([A, B], { table: { 'Zork A': { '14:00': 'USABLE', '11:00': 'EXCELLENT' }, 'Zork B': { '16:00': 'USABLE', '14:00': 'EXCELLENT' } } });
    const iA = dec(imp, A); const iB = dec(imp, B);
    check('72. MULTI-PLAN IMPROVEMENT: moving A frees 14:00 for B -> A->11:00 and B->14:00, both strict improvements, coherent, no degradation', iA.decision === 'MOVE' && hhmm(iA.to.start) === '11:00' && iB.decision === 'MOVE' && hhmm(iB.to.start) === '14:00' && !overlap(iA.to, iB.to));
    check('72/41. the coherent proposal is deterministic (identical on a second run)', iso(imp) === iso(await propose([A, B], { table: { 'Zork A': { '14:00': 'USABLE', '11:00': 'EXCELLENT' }, 'Zork B': { '16:00': 'USABLE', '14:00': 'EXCELLENT' } } })));
    const C = mkPlan({ title: 'Zork C', start: '17:00', mode: 'FLEXIBLE' });
    const km = await propose([A, C], { table: { 'Zork A': { '14:00': 'GOOD', '11:00': 'GOOD' }, 'Zork C': { '17:00': 'USABLE', '12:00': 'EXCELLENT' } } });
    check('70. A should KEEP and C should MOVE: both decisions correct and the final proposal has no overlap', dec(km, A).decision === 'KEEP' && dec(km, C).decision === 'MOVE' && km.proposedState.every((x, i) => km.proposedState.every((y, j) => i === j || !overlap(x.slot, y.slot))));
    const allKeep = await propose([A, B, C], { table: { 'Zork A': { '14:00': 'GOOD', '11:00': 'USABLE' }, 'Zork B': { '16:00': 'GOOD', '12:00': 'GOOD' }, 'Zork C': { '17:00': 'EXCELLENT' } } });
    check('43/44/73. ALL KEEP: several flexible plans, all valid, no tier improvement -> every decision KEEP and the summary is NO_CHANGES', allKeep.decisions.length === 3 && allKeep.decisions.every((d) => d.decision === 'KEEP') && allKeep.summary.state === 'NO_CHANGES' && allKeep.summary.moveCount === 0);
    const F = mkPlan({ title: 'Zork F', start: '15:00', mode: 'FIXED' });
    const pf = await propose([A, F, C], { table: { 'Zork A': { '14:00': 'GOOD', '15:00': 'EXCELLENT', '12:00': 'EXCELLENT' }, 'Zork C': { '17:00': 'USABLE', '15:30': 'EXCELLENT', '13:00': 'EXCELLENT' } }, unfiltered: true });
    check('74. PROTECTED + FLEXIBLE: a FIXED plan between two flexible plans stays a blocker; no MOVE overlaps it even when the search offers slots on top of it', pf.decisions.every((d) => d.decision !== 'MOVE' || !overlap(d.to, slotOf(F))));
  }

  // ---------- 75. availability ----------
  {
    const a = mkPlan({ title: 'Zork avail', start: '14:00', mode: 'FLEXIBLE' });
    const t: Table = { 'Zork avail': { '14:00': 'GOOD', '11:00': 'EXCELLENT' } };
    check('75. UNCONFIGURED today: the remaining day is usable (existing semantics)', (await propose([a], { table: t })).decisions[0].decision === 'MOVE');
    check('75. CONFIGURED with windows: only slots inside the windows are usable', (await propose([a], { table: t, availability: { configured: true, periods: [{ weekday: 3, startTime: '13:00', endTime: '18:00' }] } })).decisions[0].decision === 'KEEP');
    const empty = await run([a], { table: t, availability: { configured: true, periods: [] } });
    check('75. CONFIGURED-EMPTY is NOT usable: NO_USABLE_CAPACITY, no proposal (it never becomes the whole day)', empty.status === 'NO_USABLE_CAPACITY');
    check('75. UNCONFIGURED != CONFIGURED_EMPTY (two different outcomes for the same plans)', (await run([a], { table: t })).status === 'READY' && empty.status !== 'READY');
  }

  // ---------- 77. timing failures follow the orchestrator's semantics: no invented fallback ----------
  {
    const a = mkPlan({ title: 'Zork fail', start: '14:00', mode: 'FLEXIBLE' });
    const t: Table = { 'Zork fail': { '14:00': 'GOOD', '11:00': 'EXCELLENT' } };
    const s = await run([a], { table: t, failSearch: true });
    const c = await run([a], { table: t, failCheck: true });
    check('77. a timing SEARCH failure yields TIMING_FAILED (never reinterpreted as "no candidates"/KEEP)', s.status === 'TIMING_FAILED');
    check('77. a timing CHECK failure on the current slot yields TIMING_FAILED (no fallback tier is invented)', c.status === 'TIMING_FAILED');
  }

  // ---------- 61/59/60. today only, timezone, clock ----------
  {
    const calls = { search: 0, load: 0, bounds: [] as { from: Date; to: Date }[] };
    const a = mkPlan({ title: 'Zork tz', start: '14:00', mode: 'FLEXIBLE' });
    await run([a], { table: { 'Zork tz': { '14:00': 'GOOD' } }, tz: 'Asia/Kolkata', now: new Date('2026-09-16T20:00:00Z'), calls }); // 01:30 IST on the 17th
    check('59/61. "today" is the user\'s LOCAL date: 20:00Z is already the 17th in Asia/Kolkata, so the day bounds are 2026-09-16T18:30Z -> 2026-09-17T18:30Z (one read of the plans, one day only)', calls.load === 1 && calls.bounds[0].from.toISOString() === '2026-09-16T18:30:00.000Z' && calls.bounds[0].to.toISOString() === '2026-09-17T18:30:00.000Z');
    check('61. a missing timezone / invalid now fail closed', (await recomposeRemainingDay({ timezone: '', now: NOW }, deps([], { table: {} }))).status === 'TIMEZONE_MISSING' && (await recomposeRemainingDay({ timezone: TZ, now: new Date('nope') }, deps([], { table: {} }))).status === 'INVALID_REQUEST');
    const none = await propose([], { table: {} });
    check('44. no plans at all: an empty NO_CHANGES proposal (and no placement run)', none.decisions.length === 0 && none.summary.state === 'NO_CHANGES' && none.summary.placementRuns === 0);
  }

  // ---------- 78. determinism under input order ----------
  {
    const P = [mkPlan({ title: 'Zork o1', start: '12:00', mode: 'FLEXIBLE' }), mkPlan({ title: 'Zork o2', start: '14:00', mode: 'FLEXIBLE' }), mkPlan({ title: 'Zork o3', start: '16:00', mode: 'FLEXIBLE' }), mkPlan({ title: 'Zork o4', start: '18:00', mode: 'FIXED' })];
    const table: Table = { 'Zork o1': { '12:00': 'USABLE', '11:00': 'EXCELLENT' }, 'Zork o2': { '14:00': 'GOOD', '13:00': 'GOOD' }, 'Zork o3': { '16:00': 'USABLE', '12:00': 'EXCELLENT', '17:00': 'GOOD' } };
    const base = iso(await propose(P, { table }));
    const orders = [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]];
    let same = true;
    for (const o of orders) if (iso(await propose(o.map((i) => P[i]), { table })) !== base) same = false;
    check('41/78. the same plans loaded in a different order produce the IDENTICAL proposal (decisions, order, evidence)', same);
  }

  // ---------- property test: invariants over seeded random days ----------
  {
    let seed = 20260916;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const labels: TimingCandidateLabel[] = ['EXCELLENT', 'GOOD', 'USABLE', 'CAUTION'];
    const starts = ['10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00'];
    let bad = 0; let scenarios = 0; let withMoves = 0;
    for (let n = 0; n < 150; n++) {
      const count = 1 + Math.floor(rnd() * 4);
      const plans: PlannedActivity[] = []; const table: Table = {};
      const used = new Set<string>();
      for (let i = 0; i < count; i++) {
        const s = starts[Math.floor(rnd() * starts.length)];
        if (used.has(s)) continue; used.add(s);
        const mode: Mode = rnd() < 0.7 ? 'FLEXIBLE' : rnd() < 0.5 ? 'FIXED' : null;
        const plan = mkPlan({ title: `Zork rand${n}-${i}`, start: s, dur: rnd() < 0.5 ? 60 : 30, mode });
        plans.push(plan);
        const row: Record<string, TimingCandidateLabel> = { [s]: labels[Math.floor(rnd() * 4)] };
        for (let k = 0; k < 3; k++) row[starts[Math.floor(rnd() * starts.length)]] = labels[Math.floor(rnd() * 4)];
        table[plan.title] = row;
      }
      const r = await run(plans, { table });
      scenarios += 1;
      if (r.status !== 'READY') { bad += 1; continue; }
      const p = r.proposal;
      const candidates = plans.filter((x) => x.schedulingMode === 'FLEXIBLE' && new Date(x.plannedStartAt) > NOW);
      const ok1 = p.decisions.length === Math.min(candidates.length, MAX_RECOMPOSITION_CANDIDATES) && new Set(p.decisions.map((d) => d.planId)).size === p.decisions.length; // one decision per reconsidered plan
      const ok2 = p.summary.placementRuns <= Math.max(1, p.decisions.length); // bounded
      const blockers = plans.filter((x) => !candidates.some((c) => c.id === x.id)).filter((x) => isActivePlanBlocker({ start: new Date(x.plannedStartAt), end: new Date(x.plannedEndAt), status: x.status }, NOW));
      let ok3 = true;
      for (const d of p.decisions) if (d.decision === 'MOVE') {
        if (blockers.some((b) => overlap(d.to, slotOf(b)))) ok3 = false; // never on a protected commitment
        if (p.decisions.some((o) => o.planId !== d.planId && o.decision === 'MOVE' && overlap(d.to, o.to))) ok3 = false; // never on another move
        if (p.decisions.some((o) => o.planId !== d.planId && o.decision !== 'MOVE' && overlap(d.to, o.current))) ok3 = false; // never on a kept/unresolved plan
        if (!(d.reason === 'CURRENT_SLOT_INVALID' || isStrictlyBetterTier(d.evidence.proposedTier, d.evidence.currentTier))) ok3 = false; // never worse without invalidity
        if (d.to.start.getTime() <= NOW.getTime()) ok3 = false; // never into the past
      }
      const ok4 = iso(p) === iso((await run([...plans].reverse(), { table }) as any).proposal); // order independent
      if (!(ok1 && ok2 && ok3 && ok4)) bad += 1;
      if (p.summary.moveCount > 0) withMoves += 1;
    }
    check(`37/40/43/78. PROPERTY (${scenarios} seeded random days, ${withMoves} with moves): one decision per plan; placement runs <= plans; no MOVE overlaps a protected blocker, another MOVE or a KEPT/UNRESOLVED plan; every MOVE is a strict tier improvement or fixes an invalid slot; nothing moves into the past; input-order independent`, bad === 0 && scenarios === 150 && withMoves > 10);
  }

  // ---------- route boundary: read-only, server-derived, authenticated ----------
  {
    const seen: any = { recomposeArgs: null, nowCalls: 0 };
    const handler = (session: { userId: string } | null, user: any) => handleRemainingDayRecompositionRequest({
      getSession: () => session, getUser: async () => user, now: () => { seen.nowCalls += 1; return NOW; }, createDeps: () => deps([], { table: {} }),
      recompose: async (input, d) => { seen.recomposeArgs = input; return recomposeRemainingDay(input, d); },
    });
    check('53/54. unauthenticated -> 401 and nothing is computed', (await handler(null, null)).httpStatus === 401 && seen.recomposeArgs === null);
    check('54. an unknown user -> 404', (await handler({ userId: 'x' }, null)).httpStatus === 404);
    const ok = await handler({ userId: 'u1' }, { id: 'u1', timezone: 'Asia/Kolkata' });
    check('53/59/60. the service receives the STORED user timezone and the server clock (read once); the request body is never an input', ok.httpStatus === 200 && seen.recomposeArgs.timezone === 'Asia/Kolkata' && seen.recomposeArgs.now === NOW && seen.nowCalls === 1 && !/req\.json|parseJsonObject|await req/.test(strip(read('apps/web/app/api/day/recompose/route.ts'))));
    const boom = await handleRemainingDayRecompositionRequest({ getSession: () => ({ userId: 'u1' }), getUser: async () => ({ timezone: 'UTC' }) as any, now: () => NOW, createDeps: () => deps([], { table: {} }), recompose: async () => { throw new Error('internal detail'); } });
    check('52. an unexpected internal failure is a generic 500 that leaks nothing', boom.httpStatus === 500 && !JSON.stringify(boom.body).includes('internal detail'));
  }

  // ---------- structural: architecture, read-only, scope ----------
  const svc = strip(read('apps/web/lib/remainingDayRecomposition.ts'));
  const srv = strip(read('apps/web/lib/remainingDayRecompositionServer.ts'));
  const routeSrc = strip(read('apps/web/app/api/day/recompose/route.ts'));
  check('4/28/29. the pure Constructor is untouched and never mentions recomposition; the only Constructor-side edit is exporting the existing timing-label adapter', !/recompos/i.test(read('apps/web/lib/dayConstructor.ts')) && !/recompos/i.test(read('apps/web/lib/dayCapacity.ts')) && !/recompos/i.test(read('apps/web/lib/availabilityContext.ts')));
  check('3/14. the blocker release is an explicit id set at the loading boundary; isActivePlanBlocker is imported only by tests, never re-implemented or weakened here', /rows\.filter\(\(row\) => !excluded\.has\(row\.id\)\)/.test(svc) && !/isActivePlanBlocker/.test(svc));
  check('8/9/17/49. F1 semantics: only the authoritative helper decides FLEXIBLE (no truthiness / non-null test), hypothetical intents are FLEXIBLE with intentId = PlannedActivity.id, and FIXED plans are never turned into Constructor FIXED intents to include them', /hasFlexibleScheduling\(plan\)/.test(svc) && !/schedulingMode\s*(&&|\?|!=|!==)/.test(svc) && /id: plan\.id/.test(svc) && /intentFor\(plan, index, 'FLEXIBLE'\)/.test(svc) && (svc.match(/intentFor\([^)]*'FIXED'\)/g) ?? []).length === 1 && /candidates\.entries\(\)/.test(svc));
  check('56/91. READ-ONLY: no write, Move, transaction, lineage or source-link code in the service, the server wiring or the route', ![svc, srv, routeSrc].some((s) => /movePlannedActivity|INSERT\s|UPDATE\s|DELETE\s|beginTransaction|createPlannedActivity|linkCapture|linkGoalActivity|rescheduledFromPlanId|cancelPlannedActivity|skipPlannedActivity|logPlannedActivity/.test(s)));
  check('40. the placement loop is bounded by the number of reconsidered plans: each pass pins at most ONE plan and a pass that pins none ends the loop', /for \(;;\)/.test(svc) && (svc.match(/pinned\.set\(/g) ?? []).length === 1 && /if \(!toPin\) \{ finalPlacements = placements; break; \}/.test(svc));
  check('55. no acceptance tokens / integrity material is added to the proposal (F3 owns write acceptance)', !/acceptanceToken|PreviewIntegrity|sign\(/.test(svc + srv));
  check('87/88/91. no migration, dependency or Home wiring: 39 migrations, no Home/Timeline/Daily Agenda file mentions recomposition', fs.readdirSync(path.join(root, 'apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d)).length === 39 && ['apps/web/components/HomeDashboard.tsx', 'apps/web/components/HomeTimeline.tsx', 'apps/web/lib/dailyAgenda.ts', 'apps/web/lib/homeTimelineComposer.ts', 'apps/web/lib/homeCompletion.ts'].every((f) => !/recompos/i.test(read(f))) && !/remainingDayRecomposition/.test(read('apps/web/lib/planMove.ts')));
  check('90. limitations are documented in the module (greedy Constructor, no persisted importance/deadline, today only, open-time discrepancy)', /stays greedy/.test(read('apps/web/lib/remainingDayRecomposition.ts')) && /Importance\/deadline are not persisted/.test(read('apps/web/lib/remainingDayRecomposition.ts')) && /Today only/.test(read('apps/web/lib/remainingDayRecomposition.ts')) && /open-time discrepancy/.test(read('apps/web/lib/remainingDayRecomposition.ts')));

  console.log(allPassed ? '\nALL REMAINING-DAY RECOMPOSITION CHECKS PASSED' : '\nSOME REMAINING-DAY RECOMPOSITION CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
