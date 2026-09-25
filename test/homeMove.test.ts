/**
 * Daily Experience V1 PR D3 -- Home Move: pure + pipeline behavior (real
 * Agenda -> Composer -> overlay -> Right Now -> reminder pipeline, the shared
 * execution guard on the real executor) plus structural wiring checks.
 * Live-DB proof against the real routes: homeMoveDb.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { createPlanExecutor, moveablePlanId, skippablePlanId, completablePlanId, overlayExecutionFacts, agendaWithoutResolvedNext, planIdFromTimelineItem, type ExecutionOutcome } from '../apps/web/lib/homeCompletion';
import { defaultMoveSelection, DEFAULT_MOVE_SEARCH_STEPS, resolveMoveDestination, moveDayDate, parseMoveResponse, moveFailureMessage, moveDestinationMessage, applyConfirmedSuccessors, hideMovedTimelineItems, formatMoveTime } from '../apps/web/lib/homeMove';
import { refreshAfterHomeCompletion, type HomeRefreshDeps } from '../apps/web/lib/homeRefresh';
import { selectVisibleStartingSoonReminder } from '../apps/web/lib/reminderConsistency';
import { deriveNextMeaningfulThing } from '../apps/web/lib/nextMeaningfulThing';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import type { AuraReminder } from '../apps/web/lib/auraReminders';
import type { PlannedActivity } from '../apps/web/lib/db';
import type { DailyGuidanceContext } from '../packages/personal-intelligence/src/context';
import type { SelectedActivityMetadata } from '../apps/web/lib/dailyGuidanceTypes';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const TZ = 'Asia/Kolkata';
const atDay = (d: number, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2026, 7, d, h, m) - 330 * 60000); };
const at = (hhmm: string) => atDay(24, hhmm);
const plan = (id: string, title: string, start: Date, end: Date, status: PlannedActivity['status'] = 'UPCOMING'): PlannedActivity => ({ id, userId: 'u1', title, activityType: 'x', icon: null, status, plannedStartAt: start, plannedEndAt: end, durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000), windowType: 'NEUTRAL', windowLabel: null, matchLabel: null, score: null, recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: start, updatedAt: start }) as PlannedActivity;
const oppG = (): { g: DailyGuidanceContext; sel: Record<string, SelectedActivityMetadata> } => ({ g: { engineVersion: 't', selectionPolicyVersion: 't', evaluationTime: '', evidence: [], recommendations: [{ rank: 1, activityFamily: 'SELF', personalRelevance: 'RELEVANT', relevantThemes: [], timing: { start: at('10:00').toISOString(), end: at('13:00').toISOString(), score: 8, label: 'EXCELLENT', windowRank: 1 }, selectionReason: 'X', evidence: [] }] } as unknown as DailyGuidanceContext, sel: { SELF: { activityId: 'meditation', title: 'Meditation', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 's1' } as SelectedActivityMetadata } });
const minuteOf = (now: Date) => Math.floor(((now.getTime() + 330 * 60000) % 86400000) / 60000);
const facts = (...e: [string, ExecutionOutcome][]) => new Map<string, ExecutionOutcome>(e);
const reminder = (planId: string, t: string, mins: number): AuraReminder => ({ id: `PLAN:${planId}`, type: 'PLAN_STARTING_SOON', scheduledItemType: 'PLAN', scheduledItemId: planId, activityTitle: t, activityIcon: null, startAt: '2026-08-24T10:00:00.000Z', endAt: '2026-08-24T11:00:00.000Z', timezone: TZ, reminderAt: '2026-08-24T09:45:00.000Z', minutesUntilStart: mins, target: { type: 'PLAN', planId } }) as unknown as AuraReminder;
const idOf = (r: AuraReminder | null) => (r && r.target.type === 'PLAN' ? r.target.planId : null);
const title = (s: ReturnType<typeof selectRightNowState>) => (s.kind === 'CONTEXT_OPEN' ? null : s.item.title);
/** The Home projection exactly as HomeDashboard composes it. */
function home(plans: PlannedActivity[], now: Date, f: ReadonlyMap<string, ExecutionOutcome> = new Map(), successors: ReadonlyMap<string, PlannedActivity> = new Map(), opts: { opp?: boolean; upcoming?: readonly AuraReminder[]; agendaPlans?: PlannedActivity[] } = {}) {
  const agenda = buildDailyAgenda({ now, localDate: '2026-08-24', timezone: TZ, plans: opts.agendaPlans ?? plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const forHome = applyConfirmedSuccessors(agenda, successors, now);
  const o = opts.opp ? oppG() : null;
  const timeline = hideMovedTimelineItems(overlayExecutionFacts(buildHomeTimeline({ agenda: forHome, guidance: o?.g ?? null, selectedActivities: o?.sel ?? {}, currentMinuteOfDay: minuteOf(now), timezone: TZ, localDate: '2026-08-24' }), f));
  const rightNow = selectRightNowState(timeline, now);
  const visible = selectVisibleStartingSoonReminder(opts.upcoming, f);
  const next = deriveNextMeaningfulThing({ topMomentUpdate: null, startingSoonReminder: visible, agenda: agendaWithoutResolvedNext(forHome, f) });
  return { agenda: forHome, timeline, rightNow, visible, next };
}
const moveBody = (fromId: string, toId: string, start: Date, end: Date, extra: Record<string, unknown> = {}) => ({ from: { id: fromId, status: 'MOVED' }, plan: { id: toId, status: 'UPCOMING', title: 'Call John', plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000), ...extra } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function main() {
  // ---------- 4/5. eligibility (Done/Skip semantics preserved) ----------
  const A = plan('a', 'Call John', at('10:30'), at('11:30'));
  const active = home([A], at('11:00'));
  check('4/5. ACTIVE_PLAN: Done, Skip and Move are all offered for the plan', active.rightNow.kind === 'ACTIVE_PLAN' && completablePlanId(active.rightNow) === 'a' && skippablePlanId(active.rightNow) === 'a' && moveablePlanId(active.rightNow) === 'a');
  const imminent = home([plan('i', 'Starts soon', at('11:10'), at('12:00'))], at('11:00'));
  check('4/5. IMMINENT_PLAN: Done and Move offered; Skip still absent (Skip rule not broadened)', imminent.rightNow.kind === 'IMMINENT_PLAN' && completablePlanId(imminent.rightNow) === 'i' && moveablePlanId(imminent.rightNow) === 'i' && skippablePlanId(imminent.rightNow) === null);
  const opp = home([], at('11:00'), new Map(), new Map(), { opp: true });
  check('4/35. Opportunity and context/open: no Move', opp.rightNow.kind === 'OPPORTUNITY' && moveablePlanId(opp.rightNow) === null && moveablePlanId({ kind: 'CONTEXT_OPEN' }) === null);
  const missed = home([plan('m', 'Missed', at('08:00'), at('09:00'))], at('11:00'));
  check('4/43. a MISSED plan gets no Home action in D3 (it is not Right Now)', missed.agenda.items[0].status === 'MISSED' && moveablePlanId(missed.rightNow) === null);
  const resolved = ['LOGGED', 'SKIPPED', 'MOVED', 'CANCELLED'].map((s) => home([plan('r', 'Resolved', at('10:30'), at('11:30'), s as any)], at('11:00')).rightNow);
  check('4. LOGGED / SKIPPED / MOVED / CANCELLED plans: no Move', resolved.every((s) => moveablePlanId(s) === null));

  // ---------- 7/8/9/36/37. destination: Today/Tomorrow, minute precision, canonical timezone path ----------
  const now = at('11:00');
  check('7. Today and Tomorrow map to the Home-timezone calendar dates (canonical timezone utilities)', moveDayDate('TODAY', now, TZ) === '2026-08-24' && moveDayDate('TOMORROW', now, TZ) === '2026-08-25');
  const d1 = resolveMoveDestination({ day: 'TODAY', time: '15:30' }, A.plannedStartAt.toISOString(), now, TZ);
  check('36. Today 15:30 in Asia/Kolkata serializes to the exact absolute instant 10:00Z', d1.ok && d1.newStartAt === '2026-08-24T10:00:00.000Z');
  const d2 = resolveMoveDestination({ day: 'TOMORROW', time: '09:15' }, A.plannedStartAt.toISOString(), now, TZ);
  check('36. Tomorrow 09:15 in Asia/Kolkata serializes to 03:45Z the next UTC day', d2.ok && d2.newStartAt === '2026-08-25T03:45:00.000Z');
  const la = resolveMoveDestination({ day: 'TOMORROW', time: '09:00' }, '2026-07-01T00:00:00.000Z', new Date('2026-07-10T19:00:00Z'), 'America/Los_Angeles');
  check('36/37. a non-Kolkata Home timezone (America/Los_Angeles, PDT) converts correctly: Tomorrow 09:00 = 16:00Z', la.ok && la.newStartAt === '2026-07-11T16:00:00.000Z');
  const dstStart = resolveMoveDestination({ day: 'TOMORROW', time: '09:00' }, '2026-03-01T00:00:00.000Z', new Date('2026-03-07T20:00:00Z'), 'America/New_York');
  const dstEnd = resolveMoveDestination({ day: 'TOMORROW', time: '09:00' }, '2026-10-01T00:00:00.000Z', new Date('2026-10-31T20:00:00Z'), 'America/New_York');
  check('37. across DST the canonical conversion applies the right offset: NY 2026-03-08 09:00 = 13:00Z (EDT), 2026-11-01 09:00 = 14:00Z (EST)', dstStart.ok && dstStart.newStartAt === '2026-03-08T13:00:00.000Z' && dstEnd.ok && dstEnd.newStartAt === '2026-11-01T14:00:00.000Z');
  check('8/12. minute precision only; invalid or empty time is rejected before any request', !resolveMoveDestination({ day: 'TODAY', time: '' }, A.plannedStartAt.toISOString(), now, TZ).ok && !resolveMoveDestination({ day: 'TODAY', time: '25:00' }, A.plannedStartAt.toISOString(), now, TZ).ok && !resolveMoveDestination({ day: 'TODAY', time: '10:61' }, A.plannedStartAt.toISOString(), now, TZ).ok && (resolveMoveDestination({ day: 'TODAY', time: '10:61' }, A.plannedStartAt.toISOString(), now, TZ) as any).reason === 'INVALID');
  const past = resolveMoveDestination({ day: 'TODAY', time: '10:59' }, A.plannedStartAt.toISOString(), now, TZ);
  const nowExact = resolveMoveDestination({ day: 'TODAY', time: '11:00' }, A.plannedStartAt.toISOString(), now, TZ);
  const same = resolveMoveDestination({ day: 'TODAY', time: '10:30' }, atDay(24, '11:30').toISOString(), atDay(24, '09:00'), TZ);
  check('12. past and exactly-now are rejected (PAST); the current start is rejected (SAME)', !past.ok && (past as any).reason === 'PAST' && !nowExact.ok && (nowExact as any).reason === 'PAST' && !resolveMoveDestination({ day: 'TODAY', time: '11:30' }, at('11:30').toISOString(), at('11:00'), TZ).ok && (resolveMoveDestination({ day: 'TODAY', time: '11:30' }, at('11:30').toISOString(), at('11:00'), TZ) as any).reason === 'SAME' && same.ok !== undefined);
  check('12/38. a destination that only TOUCHES another plan is not rejected client-side (conflicts are the server\'s decision; resolve takes no plan list)', resolveMoveDestination({ day: 'TODAY', time: '12:00' }, A.plannedStartAt.toISOString(), now, TZ).ok === true && resolveMoveDestination.length === 4);
  check('12. user-facing copy exists for each local rejection', ['INVALID', 'PAST', 'SAME'].every((r) => moveDestinationMessage(r as any).length > 0));
  const dflt = defaultMoveSelection(at('11:07'), TZ);
  check('9. the default is a non-committed sensible time: next quarter hour at least 30 min ahead (11:07 -> 11:45), Today', dflt !== null && dflt.day === 'TODAY' && dflt.time === '11:45');
  const lateDefault = defaultMoveSelection(at('23:50'), TZ);
  check('9. late in the day the default rolls to Tomorrow (23:50 -> 00:30 tomorrow), never a past time', lateDefault !== null && lateDefault.day === 'TOMORROW' && lateDefault.time === '00:30');
  check('9. the default never resolves to a past instant', dflt !== null && (() => { const r = resolveMoveDestination(dflt, A.plannedStartAt.toISOString(), at('11:07'), TZ); return r.ok && Date.parse(r.newStartAt) > at('11:07').getTime(); })());
  check('11. the confirm label is "Move to <time>" in the Home timezone', formatMoveTime('2026-08-24T10:00:00.000Z', TZ) === '3:30 PM');

  // ---------- DST-correct wall time -> instant (final-review blocker correction) ----------
  const wallOf = (tz: string, iso: string) => { const p: Record<string, string> = {}; for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))) p[x.type] = x.value; return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
  const cur0 = '2026-01-01T00:00:00.000Z';
  const pick = (tz: string, now: string, day: 'TODAY' | 'TOMORROW', time: string) => resolveMoveDestination({ day, time }, cur0, new Date(now), tz);
  const dstCase = (label: string, tz: string, now: string, day: 'TODAY' | 'TOMORROW', time: string, expectedUtc: string, expectedDate: string, expectedLabel: string) => {
    const r = pick(tz, now, day, time);
    const back = r.ok ? wallOf(tz, r.newStartAt) : null;
    check(`10-13/17/18. ${label}: ${tz} ${expectedDate} ${time} -> ${expectedUtc}; round trip is exactly ${expectedDate} ${time}; the confirm label reads "Move to ${expectedLabel}"`, r.ok && r.newStartAt === expectedUtc && back!.date === expectedDate && back!.time === time && formatMoveTime(r.newStartAt, tz) === expectedLabel);
  };
  dstCase('LA spring-forward (the reported blocker; Tomorrow)', 'America/Los_Angeles', '2026-03-08T03:00:00Z', 'TOMORROW', '09:00', '2026-03-08T16:00:00.000Z', '2026-03-08', '9:00 AM');
  dstCase('NY spring-forward 05:00 (Tomorrow)', 'America/New_York', '2026-03-08T01:00:00Z', 'TOMORROW', '05:00', '2026-03-08T09:00:00.000Z', '2026-03-08', '5:00 AM');
  dstCase('NY spring-forward 09:00 (Tomorrow)', 'America/New_York', '2026-03-08T01:00:00Z', 'TOMORROW', '09:00', '2026-03-08T13:00:00.000Z', '2026-03-08', '9:00 AM');
  dstCase('LA fall-back 09:00 (Tomorrow)', 'America/Los_Angeles', '2026-11-01T03:00:00Z', 'TOMORROW', '09:00', '2026-11-01T17:00:00.000Z', '2026-11-01', '9:00 AM');
  dstCase('LA fall-back 05:00 (Tomorrow)', 'America/Los_Angeles', '2026-11-01T03:00:00Z', 'TOMORROW', '05:00', '2026-11-01T13:00:00.000Z', '2026-11-01', '5:00 AM');
  dstCase('NY fall-back 05:00 (Tomorrow)', 'America/New_York', '2026-11-01T01:00:00Z', 'TOMORROW', '05:00', '2026-11-01T10:00:00.000Z', '2026-11-01', '5:00 AM');
  dstCase('NY fall-back 09:00 (Tomorrow)', 'America/New_York', '2026-11-01T01:00:00Z', 'TOMORROW', '09:00', '2026-11-01T14:00:00.000Z', '2026-11-01', '9:00 AM');
  dstCase('20. LA spring-forward day, Today 15:00 (the transition day is TODAY, chosen later the same day)', 'America/Los_Angeles', '2026-03-08T18:00:00Z', 'TODAY', '15:00', '2026-03-08T22:00:00.000Z', '2026-03-08', '3:00 PM');
  dstCase('20. NY fall-back day, Today 15:00', 'America/New_York', '2026-11-01T12:00:00Z', 'TODAY', '15:00', '2026-11-01T20:00:00.000Z', '2026-11-01', '3:00 PM');
  dstCase('London spring-forward 09:00 (Tomorrow, BST)', 'Europe/London', '2026-03-28T20:00:00Z', 'TOMORROW', '09:00', '2026-03-29T08:00:00.000Z', '2026-03-29', '9:00 AM');
  dstCase('Sydney spring-forward 09:00 (Tomorrow, AEDT)', 'Australia/Sydney', '2026-10-03T05:00:00Z', 'TOMORROW', '09:00', '2026-10-03T22:00:00.000Z', '2026-10-04', '9:00 AM');
  dstCase('Kolkata control 09:00 (no DST) on the same dates', 'Asia/Kolkata', '2026-03-07T12:00:00Z', 'TOMORROW', '09:00', '2026-03-08T03:30:00.000Z', '2026-03-08', '9:00 AM');
  const gap = pick('America/New_York', '2026-03-08T01:00:00Z', 'TOMORROW', '02:30');
  const overlap = pick('America/New_York', '2026-11-01T01:00:00Z', 'TOMORROW', '01:30');
  check('7/15/16. a wall time that does not exist (NY 2026-03-08 02:30) is REFUSED as NONEXISTENT with truthful copy, never silently sent as 03:30', !gap.ok && (gap as any).reason === 'NONEXISTENT' && /doesn't exist because the clocks change\. Choose another time\./.test(moveDestinationMessage('NONEXISTENT')));
  check('8/15/16. a wall time that occurs twice (NY 2026-11-01 01:30) is REFUSED as AMBIGUOUS with truthful copy, no invisible earlier/later choice', !overlap.ok && (overlap as any).reason === 'AMBIGUOUS' && /occurs twice because the clocks change\. Choose another time\./.test(moveDestinationMessage('AMBIGUOUS')));
  check('16. no auto-correction anywhere in the sweep: no wall time on a transition day ever resolves to a DIFFERENT wall time (every accepted destination round-trips to exactly what was selected)', (() => { let n = 0; for (const tz of ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney']) for (const [nowIso, day] of [['2026-03-08T00:00:00Z', 'TOMORROW'], ['2026-11-01T00:00:00Z', 'TOMORROW'], ['2026-03-28T20:00:00Z', 'TOMORROW'], ['2026-10-24T20:00:00Z', 'TOMORROW'], ['2026-04-04T05:00:00Z', 'TOMORROW'], ['2026-10-03T05:00:00Z', 'TOMORROW']] as const) for (let m = 0; m < 1440; m += 15) { const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; const r = pick(tz, nowIso, day, time); if (r.ok) { n++; if (wallOf(tz, r.newStartAt).time !== time) return false; } } return n > 0; })());
  const dfAmb = defaultMoveSelection(new Date('2026-11-01T04:40:00Z'), 'America/New_York');
  const dfOrdinary = defaultMoveSelection(new Date('2026-11-01T09:07:00Z'), 'America/New_York');
  check('21. the default never lands on a repeated wall time: NY fall-back night (now 00:40 EDT) skips the ambiguous 01:xx hour to the next unique time (02:00 EST); an ordinary time is unchanged', dfAmb !== null && dfOrdinary !== null && dfAmb.day === 'TODAY' && dfAmb.time === '02:00' && dfOrdinary.day === 'TODAY' && dfOrdinary.time === '04:45' && resolveMoveDestination(dfAmb, cur0, new Date('2026-11-01T04:40:00Z'), 'America/New_York').ok);
  check('21. the default is always a wall time that resolves (checked across a transition-day sweep, every 15 minutes)', (() => { for (const [tz, start] of [['America/New_York', '2026-03-08T00:00:00Z'], ['America/New_York', '2026-11-01T00:00:00Z'], ['America/Los_Angeles', '2026-11-01T05:00:00Z'], ['Europe/London', '2026-10-25T00:00:00Z'], ['Australia/Sydney', '2026-04-04T13:00:00Z']] as const) for (let k = 0; k < 96; k++) { const now = new Date(Date.parse(start) + k * 15 * 60000); const sel = defaultMoveSelection(now, tz); if (sel === null) return false; const r = resolveMoveDestination(sel, cur0, now, tz); if (!r.ok) return false; } return true; })());

  // ---------- default search: never pre-fill a repeated/missing wall time (Troll 2-hour shift, Lord Howe 30-minute shift) ----------
  const TROLL = 'Antarctica/Troll';
  const trollNow = new Date('2026-10-24T22:30:00.000Z');
  const trollDefault = defaultMoveSelection(trollNow, TROLL);
  check('15/19. Antarctica/Troll (a 2-hour DST shift repeats a wall-time span lasting 4 real hours): the default that used to be the ambiguous 01:00 now skips the whole interval and lands on the first UNIQUE time, 03:00', trollDefault !== null && trollDefault.day === 'TODAY' && trollDefault.time === '03:00' && resolveMoveDestination(trollDefault, cur0, trollNow, TROLL).ok === true);
  const trollAmbiguousRun = (() => { let run = 0; let max = 0; for (let k = 0; k < 96; k++) { const t = new Date(Date.parse('2026-10-24T20:00:00Z') + k * 15 * 60000); const d = new Intl.DateTimeFormat('en-CA', { timeZone: TROLL, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t); const w = new Intl.DateTimeFormat('en-GB', { timeZone: TROLL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t); if (resolveMoveDestination({ day: d === '2026-10-24' ? 'TODAY' : 'TOMORROW', time: w }, cur0, new Date('2026-10-24T20:00:00Z'), TROLL).ok === false) { run++; max = Math.max(max, run); } else run = 0; } return max; })();
  check('17. the old 16-step bound was one step short for Troll (16 consecutive ambiguous quarter-hours); the bound is now 24 steps and is a search limit, not an assumption that DST changes are short', trollAmbiguousRun >= 16 && DEFAULT_MOVE_SEARCH_STEPS === 24 && DEFAULT_MOVE_SEARCH_STEPS * 15 >= trollAmbiguousRun * 15 + 60);
  check('18. search exhaustion returns NO default (null) instead of the last/ambiguous candidate: Troll with a 3-step bound', defaultMoveSelection(trollNow, TROLL, 3) === null && defaultMoveSelection(trollNow, TROLL, 0) === null);
  const lhNow = new Date('2026-04-04T14:40:00Z');
  const lhDefault = defaultMoveSelection(lhNow, 'Australia/Lord_Howe');
  check('20. Lord Howe (30-minute shift): the default on the fall-back night is a UNIQUE wall time', lhDefault !== null && resolveMoveDestination(lhDefault, cur0, lhNow, 'Australia/Lord_Howe').ok === true);
  const nySpringDefault = defaultMoveSelection(new Date('2026-03-08T06:45:00Z'), 'America/New_York');
  check('21. a default search that crosses the spring-forward gap goes 01:45 EST -> 03:15 EDT and never proposes a nonexistent 02:xx wall time', nySpringDefault !== null && nySpringDefault.time === '03:15' && resolveMoveDestination(nySpringDefault, cur0, new Date('2026-03-08T06:45:00Z'), 'America/New_York').ok === true);
  const sydOverlap = defaultMoveSelection(new Date('2026-04-04T14:35:00Z'), 'Australia/Sydney');
  const nyOverlap = defaultMoveSelection(new Date('2026-11-01T04:40:00Z'), 'America/New_York');
  check('22. defaults that would land in a fall-back overlap skip every ambiguous candidate to the first unique time (Sydney 02:15 AEDT -> 03:00 AEST; New York 01:15 EDT -> 02:00 EST)', sydOverlap !== null && sydOverlap.time === '03:00' && nyOverlap !== null && nyOverlap.time === '02:00');
  const sweepZones: Array<[string, string]> = [['America/New_York', '2026-03-08T00:00:00Z'], ['America/New_York', '2026-11-01T00:00:00Z'], ['Europe/London', '2026-10-25T00:00:00Z'], ['Australia/Sydney', '2026-04-04T13:00:00Z'], ['Australia/Sydney', '2026-10-03T13:00:00Z'], ['Australia/Lord_Howe', '2026-04-04T13:00:00Z'], ['Australia/Lord_Howe', '2026-10-03T13:00:00Z'], [TROLL, '2026-03-28T20:00:00Z'], [TROLL, '2026-10-24T20:00:00Z'], ['Asia/Kolkata', '2026-03-08T00:00:00Z']];
  check('23. default sweep across transition days incl. Troll and Lord Howe (every 15 min): every default is UNIQUE (0 nonexistent / 0 ambiguous / 0 invalid), and none is missing', (() => { let n = 0; for (const [tz, start] of sweepZones) for (let k = 0; k < 96; k++) { const now = new Date(Date.parse(start) + k * 15 * 60000); const sel = defaultMoveSelection(now, tz); if (sel === null || !resolveMoveDestination(sel, cur0, now, tz).ok) return false; n++; } return n === sweepZones.length * 96; })());

  // ---------- 3/10/18. request + response validation ----------
  const calls: Array<{ url: string; init: any }> = [];
  const rec = (impl: () => Response | Promise<Response>) => (async (url: any, init: any) => { calls.push({ url: String(url), init }); return impl(); }) as unknown as typeof fetch;
  const B = plan('b', 'Call John', at('15:30'), at('16:30'));
  const ok = await createPlanExecutor(rec(() => json(moveBody('a', 'b', at('15:30'), at('16:30'))))).move('a', at('15:30').toISOString());
  check('3/10. Move is POST /api/plans/<id>/move with a JSON body of ONLY { newStartAt } (no other endpoint, no timestamps of the plan)', calls.length === 1 && calls[0].url === '/api/plans/a/move' && calls[0].init.method === 'POST' && calls[0].init.headers['Content-Type'] === 'application/json' && JSON.stringify(JSON.parse(calls[0].init.body)) === JSON.stringify({ newStartAt: at('15:30').toISOString() }));
  check('18. success requires from.status MOVED + a NEW UPCOMING successor; the successor is returned hydrated (real Dates)', ok.status === 'MOVED' && (ok as any).successor.id === 'b' && (ok as any).successor.plannedStartAt instanceof Date);
  const bad: Array<[string, () => Response | Promise<Response>]> = [
    ['200 with from not MOVED', () => json({ from: { id: 'a', status: 'UPCOMING' }, plan: moveBody('a', 'b', at('15:30'), at('16:30')).plan })],
    ['200 with successor not UPCOMING', () => json(moveBody('a', 'b', at('15:30'), at('16:30'), { status: 'MOVED' }))],
    ['200 where the successor IS the original', () => json(moveBody('a', 'a', at('15:30'), at('16:30')))],
    ['200 with a different original id', () => json(moveBody('zzz', 'b', at('15:30'), at('16:30')))],
    ['200 with missing successor', () => json({ from: { id: 'a', status: 'MOVED' } })],
    ['200 with unusable times', () => json(moveBody('a', 'b', at('15:30'), at('16:30'), { plannedStartAt: 'nope' }))],
    ['200 with a non-JSON body', () => new Response('nope', { status: 200 })],
    ['200 empty object', () => json({})],
  ];
  for (const [label, impl] of bad) check(`18. malformed success (${label}) is FAILED, never a confirmed move`, (await createPlanExecutor(rec(impl)).move('a', at('15:30').toISOString())).status === 'FAILED');
  const codes: Array<[string, number, string]> = [['CONFLICT', 409, 'CONFLICT'], ['HAS_LINKED_MOMENT', 409, 'HAS_LINKED_MOMENT'], ['INVALID_STATE', 409, 'INVALID_STATE'], ['ALREADY_MOVED', 409, 'ALREADY_MOVED'], ['INVALID_DESTINATION', 400, 'INVALID_DESTINATION']];
  for (const [code, status, expected] of codes) check(`13/14/15. server ${status} ${code} keeps its identity for truthful feedback`, (await createPlanExecutor(rec(() => json({ error: 'x', code }, status))).move('a', at('15:30').toISOString())).status === expected);
  check('27. a 401 on the Move POST is FAILED (no confirmed fact, no session side effect), like Done/Skip', (await createPlanExecutor(rec(() => json({ error: 'Not authenticated.' }, 401))).move('a', at('15:30').toISOString())).status === 'FAILED');
  check('45. 404, 500, an unknown 4xx code and a network error are all FAILED', (await createPlanExecutor(rec(() => json({ code: 'NOT_FOUND' }, 404))).move('a', 'x')).status === 'FAILED' && (await createPlanExecutor(rec(() => json({}, 500))).move('a', 'x')).status === 'FAILED' && (await createPlanExecutor(rec(() => json({ code: 'WEIRD' }, 409))).move('a', 'x')).status === 'FAILED' && (await createPlanExecutor(rec(() => Promise.reject(new TypeError('x')))).move('a', 'x')).status === 'FAILED');
  check('13/14/15. every failure code has concise, actionable copy', ['CONFLICT', 'HAS_LINKED_MOMENT', 'INVALID_STATE', 'ALREADY_MOVED', 'INVALID_DESTINATION', 'FAILED'].every((c) => moveFailureMessage(c as any).length > 0) && /conflicts with another plan\. Choose another time\./.test(moveFailureMessage('CONFLICT')) && /shared/i.test(moveFailureMessage('HAS_LINKED_MOMENT')));
  check('parseMoveResponse is pure: a 2xx with the right shape parses, an error status never parses as success', parseMoveResponse('a', true, moveBody('a', 'b', at('15:30'), at('16:30'))).status === 'MOVED' && parseMoveResponse('a', false, moveBody('a', 'b', at('15:30'), at('16:30'))).status === 'FAILED');

  // ---------- 16/17. one shared guard for Done, Skip and Move ----------
  const gate: { release: () => void } = { release: () => {} };
  const slowCalls: string[] = [];
  const slow = (async (url: any) => { slowCalls.push(String(url)); await new Promise<void>((res) => { gate.release = res; }); const u = String(url); return json(u.endsWith('/move') ? moveBody('a', 'b', at('15:30'), at('16:30')) : u.endsWith('/skip') ? { plan: { status: 'SKIPPED' } } : { plan: { status: 'LOGGED' } }); }) as unknown as typeof fetch;
  type Act = 'move' | 'complete' | 'skip';
  async function burst(first: Act, second: Act) {
    slowCalls.length = 0;
    const ex = createPlanExecutor(slow);
    const run = (a: Act) => (a === 'move' ? ex.move('a', at('15:30').toISOString()) : a === 'complete' ? ex.complete('a') : ex.skip('a'));
    const p1 = run(first); const busy = ex.isBusy('a'); const p2 = run(second); const p3 = run(second);
    await Promise.resolve(); gate.release();
    const results = await Promise.all([p1, p2, p3]);
    return { calls: [...slowCalls], busy, results: results.map((r) => (typeof r === 'string' ? r : (r as any).status)) };
  }
  const mm = await burst('move', 'move'); const md = await burst('move', 'complete'); const ms = await burst('move', 'skip'); const dm = await burst('complete', 'move'); const sm = await burst('skip', 'move');
  check('16/17. Move + Move (rapid): exactly one POST; the extras are BUSY', mm.calls.length === 1 && mm.calls[0] === '/api/plans/a/move' && mm.results[0] === 'MOVED' && mm.results[1] === 'BUSY' && mm.results[2] === 'BUSY');
  check('16/17. Move then Done: only the Move request begins for that plan', md.calls.length === 1 && md.calls[0] === '/api/plans/a/move' && md.results[1] === 'BUSY');
  check('16/17. Move then Skip: only the Move request begins for that plan', ms.calls.length === 1 && ms.calls[0] === '/api/plans/a/move' && ms.results[1] === 'BUSY');
  check('16/17. Done then Move and Skip then Move: only the first action begins (one authority, not independent guards)', dm.calls.length === 1 && dm.calls[0] === '/api/plans/a/log' && dm.results[1] === 'BUSY' && sm.calls.length === 1 && sm.calls[0] === '/api/plans/a/skip' && sm.results[1] === 'BUSY');
  const retryEx = createPlanExecutor((async () => json({}, 500)) as unknown as typeof fetch);
  const f1 = await retryEx.move('a', 'x'); const busyAfter = retryEx.isBusy('a');
  check('16. the guard is released after a failed Move so a deliberate retry is possible', f1.status === 'FAILED' && busyAfter === false);

  // ---------- 19-24. confirmed Move projection ----------
  const rA = reminder('a', 'Call John', -20), rB = reminder('b', 'Second', 25);
  const activeAt = at('11:00');
  const bLater = plan('b', 'Call John', at('13:00'), at('14:00'));
  const moved = home([A], activeAt, facts(['a', 'MOVED']), new Map([['a', bLater]]), { upcoming: [rA, rB] });
  check('21. Move confirmed: A is no longer ACTIVE_PLAN or IMMINENT_PLAN (no stale A) and no Move/Skip/Done is offered for it', !['ACTIVE_PLAN', 'IMMINENT_PLAN'].includes(moved.rightNow.kind) || (moved.rightNow as any).item.id !== 'plan:a');
  check('22. the live Timeline hides the MOVED original and shows the successor at its NEW time, exactly once', !moved.timeline.some((i) => i.id === 'plan:a') && moved.timeline.filter((i) => i.id === 'plan:b').length === 1 && moved.timeline.find((i) => i.id === 'plan:b')!.start === at('13:00').toISOString());
  check('22. A remains in the underlying agenda as MOVED history (hidden only in the live presentation)', moved.agenda.items.find((i) => i.id === 'plan:a')!.status === 'MOVED');
  check('24. the stale reminder for A (by target.planId) is masked immediately; the unrelated reminder stays; the authoritative list is untouched', idOf(moved.visible) === 'b');
  const soon = home([A], activeAt, facts(['a', 'MOVED']), new Map([['a', plan('b', 'Call John', at('11:20'), at('12:20'))]]));
  check('21. when B is imminent by its new time it becomes Right Now (IMMINENT_PLAN, with Move but not Skip)', soon.rightNow.kind === 'IMMINENT_PLAN' && (soon.rightNow as any).item.id === 'plan:b' && moveablePlanId(soon.rightNow) === 'b' && skippablePlanId(soon.rightNow) === null);
  const twoActive = home([A, plan('c', 'Other active', at('10:45'), at('12:00'))], activeAt, facts(['a', 'MOVED']), new Map([['a', bLater]]));
  check('21. next committed plan wins when A moves away (existing hierarchy, no special ranking)', title(twoActive.rightNow) === 'Other active');
  const withOpp = home([A], activeAt, facts(['a', 'MOVED']), new Map([['a', bLater]]), { opp: true });
  check('21. Opportunity/context fallback follows the existing hierarchy', withOpp.rightNow.kind === 'OPPORTUNITY' && home([A], activeAt, facts(['a', 'MOVED']), new Map([['a', bLater]])).rightNow.kind === 'CONTEXT_OPEN');
  const tomorrowB = plan('b', 'Call John', atDay(25, '09:00'), atDay(25, '10:00'));
  const toTomorrow = home([A], activeAt, facts(['a', 'MOVED']), new Map([['a', tomorrowB]]));
  check('7/22. a move to Tomorrow removes A from today and does not put B on today\'s list', !toTomorrow.timeline.some((i) => i.id === 'plan:a' || i.id === 'plan:b') && toTomorrow.rightNow.kind === 'CONTEXT_OPEN');
  check('23. "Coming up"/next item uses B, never the old-time A', (() => { const h = home([A, plan('n', 'Later', at('16:00'), at('17:00'))], at('11:00'), facts(['a', 'MOVED']), new Map([['a', bLater]])); return h.agenda.nextItem?.id !== 'plan:a' && h.agenda.nextItem?.id === 'plan:b'; })());
  const mid = plan('mid', 'Late event', at('23:30'), atDay(25, '00:30'));
  const midActive = home([mid], at('23:45'));
  const midMoved = home([mid], at('23:45'), facts(['mid', 'MOVED']), new Map([['mid', plan('mid2', 'Late event', atDay(25, '10:00'), atDay(25, '11:00'))]]));
  check('35. an active cross-midnight plan is ACTIVE_PLAN (movable, by absolute instants) and disappears once moved', midActive.rightNow.kind === 'ACTIVE_PLAN' && moveablePlanId(midActive.rightNow) === 'mid' && !['ACTIVE_PLAN', 'IMMINENT_PLAN'].includes(midMoved.rightNow.kind));

  // ---------- 25/26/47/48. refresh failure, partial refresh, stale data ----------
  const failAll: HomeRefreshDeps = { fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, applyLogs: () => {}, applyHabits: () => {}, applyPlans: () => {}, refreshMyDay: async () => { throw new Error('down'); }, refreshGuidance: async () => { throw new Error('down'); }, refreshAuraUpdates: async () => { throw new Error('down'); }, reauthenticate: async () => { state.user = null; } };
  const state = { user: { id: 'u1' } as { id: string } | null };
  await refreshAfterHomeCompletion(failAll);
  const afterFail = home([A, plan('c', 'Other active', at('10:45'), at('12:00'))], activeAt, facts(['a', 'MOVED']), new Map([['a', bLater]]), { upcoming: [rA, rB] });
  check('25/48. Move confirmed, then EVERY reconciliation read fails: Home stays authenticated, A is resolved and hidden, B is on the list at its new time, no A reminder, Right Now advanced, no "Move failed"', state.user?.id === 'u1' && !afterFail.timeline.some((i) => i.id === 'plan:a') && afterFail.timeline.some((i) => i.id === 'plan:b') && idOf(afterFail.visible) === 'b' && title(afterFail.rightNow) === 'Other active');
  const stale = home([A], activeAt, facts(['a', 'MOVED']), new Map([['a', bLater]]), { upcoming: [rA], agendaPlans: [A] });
  check('47. stale refresh (agenda still says A UPCOMING/CURRENT, reminder list still has A, nothing else refreshed): A resolved, B current at the new time, no stale A reminder, no A Right Now', stale.agenda.items.find((i) => i.id === 'plan:a')!.status === 'MOVED' && stale.timeline.some((i) => i.id === 'plan:b') && stale.visible === null && !(stale.rightNow.kind !== 'CONTEXT_OPEN' && (stale.rightNow as any).item.id === 'plan:a'));
  const authoritative = home([plan('a', 'Call John', at('10:30'), at('11:30'), 'MOVED'), bLater], activeAt, facts(['a', 'MOVED']), new Map([['a', bLater]]), { upcoming: [rA, rB], agendaPlans: [plan('a', 'Call John', at('10:30'), at('11:30'), 'MOVED'), bLater] });
  check('26. partial refresh: once the authoritative agenda already contains B and a MOVED A there is no duplicate B and no mixed state (A never Right Now)', authoritative.timeline.filter((i) => i.id === 'plan:b').length === 1 && !authoritative.timeline.some((i) => i.id === 'plan:a') && idOf(authoritative.visible) === 'b');
  const half = home([A], activeAt, facts(['a', 'MOVED']), new Map([['a', bLater]]), { upcoming: [rA, rB], agendaPlans: [plan('a', 'Call John', at('10:30'), at('11:30'), 'MOVED'), bLater] });
  check('26. partial refresh (agenda updated, reminders still stale): the confirmed fact still masks A\'s reminder', half.visible !== null && idOf(half.visible) === 'b');
  const refresh401: HomeRefreshDeps = { ...failAll, fetchImpl: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch, reauthenticate: async () => {} };
  const r401 = await refreshAfterHomeCompletion(refresh401);
  const after401 = home([A], activeAt, facts(['a', 'MOVED']), new Map([['a', bLater]]));
  check('28. Move succeeded, then a refresh returns 401: the confirmed Move stands (A still resolved, B still shown); the 401 only asks for the authoritative session check', r401.unauthorized === true && after401.timeline.some((i) => i.id === 'plan:b') && !after401.timeline.some((i) => i.id === 'plan:a'));

  // ---------- 13/49/50. failures keep A actionable ----------
  const conflictView = home([A], activeAt);
  check('13/49. after a CONFLICT nothing is confirmed: A stays ACTIVE with Done, Skip and Move, and there is no B', conflictView.rightNow.kind === 'ACTIVE_PLAN' && moveablePlanId(conflictView.rightNow) === 'a' && !conflictView.timeline.some((i) => i.id === 'plan:b'));
  check('50. ALREADY_MOVED never fabricates a successor: with no confirmed fact Home shows exactly what the server data shows (A hides only once the authoritative MOVED arrives)', (() => { const authA = home([plan('a', 'Call John', at('10:30'), at('11:30'), 'MOVED'), bLater], activeAt); return !authA.timeline.some((i) => i.id === 'plan:a') && authA.timeline.filter((i) => i.id === 'plan:b').length === 1; })());

  // ---------- structural ----------
  const dash = strip(read('../apps/web/components/HomeDashboard.tsx'));
  const helper = strip(read('../apps/web/lib/homeMove.ts'));
  const exec = strip(read('../apps/web/lib/homeCompletion.ts'));
  check('4/5. Move renders only under moveablePlanIdNow (ACTIVE or IMMINENT), with an activity-specific accessible name and a real disabled state', /moveablePlanIdNow && \(\s*<TextButton/.test(dash) && /ariaLabel=\{`Move "\$\{spotlightItem\.title\}"`\}/.test(dash) && /disabled=\{movingPlanIds\.has\(moveablePlanIdNow\) \|\| completingPlanIds\.has\(moveablePlanIdNow\) \|\| skippingPlanIds\.has\(moveablePlanIdNow\)( \|\| recompositionAccepting)?\}/.test(dash));
  check('5. Done and Skip semantics are preserved: same gating and endpoints; Skip is still gated on skippablePlanIdNow only', /skippablePlanIdNow && \(\s*<TextButton/.test(dash) && /completablePlanIdNow && \(\s*<SecondaryButton/.test(dash) && /run\(planId, 'log', 'LOGGED', 'DONE'\)/.test(exec) && /run\(planId, 'skip', 'SKIPPED', 'SKIPPED'\)/.test(exec));
  check('16. one guard: the Move executor entry uses the SAME inFlight set (no second guard) and the handler checks isBusy synchronously first', (exec.match(/const inFlight = new Set/g) ?? []).length === 1 && /move: async[\s\S]{0,300}inFlight\.has\(planId\)[\s\S]{0,120}inFlight\.add\(planId\)/.test(exec) && /handleMoveRightNow = async[\s\S]{0,120}planExecutor\.current\.isBusy\(planId\)\) return;/.test(dash));
  check('6/8/33. the picker is an accessible form: labelled Day select and time input (htmlFor/id pairs), type="time" step=60 (no seconds), a submit button, a Cancel button, a form label naming the activity', /<FieldLabel htmlFor="home-move-day">Day<\/FieldLabel>/.test(dash) && /id="home-move-day"/.test(dash) && /<FieldLabel htmlFor="home-move-time">Start time<\/FieldLabel>/.test(dash) && /id="home-move-time" type="time" step=\{60\}/.test(dash) && /<PrimaryButton type="submit"/.test(dash) && /aria-label=\{`Move "\$\{title\}" to another time`\}/.test(dash) && !/duration.*<TextInput|type="number"/.test(dash.slice(dash.indexOf('home-move-day'), dash.indexOf('home-move-day') + 1500)));
  check('7. only Today and Tomorrow are offered (no week calendar, no arbitrary date entry)', /<option value="TODAY">Today<\/option>\s*<option value="TOMORROW">Tomorrow<\/option>/.test(dash) && !/type="date"/.test(dash));
  check('30/31. Cancel and Escape close the picker with NO request and return focus to the Move trigger', /const closeMovePicker = \(\) => \{\s*setMovePickerFor\(null\);\s*setMoveError\(null\);\s*focusMoveTrigger\(\);\s*\};/.test(dash) && /event\.key === 'Escape'[\s\S]{0,80}closeMovePicker\(\)/.test(dash) && !/planExecutor/.test(dash.slice(dash.indexOf('const closeMovePicker'), dash.indexOf('const handleMoveRightNow'))));
  check('32. Enter/confirm is a single form submit routed to the guarded handler', /onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*void handleMoveRightNow\(planId, currentStartIso\);/.test(dash) && (dash.match(/handleMoveRightNow\(/g) ?? []).length === 1);
  check('12. local validation runs before any request and only reports local problems', /resolveMoveDestination\(moveSelection, currentStartIso, new Date\(\), effectiveTimezone\);\s*if \(!destination\.ok\) \{[\s\S]{0,120}return;\s*\}/.test(dash));
  const handler = dash.slice(dash.indexOf('const handleMoveRightNow'), dash.indexOf('const spotlightExplanation'));
  check('15/16. a refused destination (invalid/past/same/NONEXISTENT/AMBIGUOUS) returns BEFORE any request and never touches the Day/Start-time selection', (() => { const i = handler.indexOf('if (!destination.ok)'); const j = handler.indexOf('planExecutor.current.move('); const guardBlock = handler.slice(i, handler.indexOf('return;', i) + 7); return i > 0 && j > i && !/setMoveSelection/.test(guardBlock); })());
  check('19. Home passes its EXPLICIT timezone (effectiveTimezone) into every conversion; no browser-local Date parsing in the Move path', /resolveMoveDestination\(moveSelection, currentStartIso, new Date\(\), effectiveTimezone\)/.test(handler) && /defaultMoveSelection\(new Date\(\), effectiveTimezone\)/.test(dash) && !/new Date\(`|Date\.parse\(moveSelection|getTimezoneOffset|toLocaleTimeString\(\)/.test(handler + helper));
  check('18/20. no optimistic Move: the MOVED fact and successor are written only after the non-MOVED branch has returned; the picker stays open (with the chosen time) on every failure', /if \(result\.status !== 'MOVED'\) \{[\s\S]*?return;\s*\}\s*const successor = result\.successor;\s*setExecutionFacts\(\(current\) => new Map\(current\)\.set\(planId, 'MOVED'\)\);\s*setConfirmedSuccessors/.test(handler) && !/setMovePickerFor\(null\)/.test(handler.slice(0, handler.indexOf("const successor = result.successor")) ));
  check('20. success order: fact -> successor -> close picker -> focus -> best-effort refresh in its own try/catch', /setExecutionFacts[\s\S]{0,200}setConfirmedSuccessors[\s\S]{0,200}setMovePickerFor\(null\)[\s\S]{0,700}try \{\s*await onPlanCompleted\?\.\(\);\s*\} catch \{/.test(handler));
  check('15. INVALID_STATE / ALREADY_MOVED reconcile from authoritative data (the existing refresh) and confirm nothing', /result\.status === 'INVALID_STATE' \|\| result\.status === 'ALREADY_MOVED'\) \{\s*try \{\s*await onPlanCompleted/.test(handler));
  check('29. after success focus goes to the successor row when it is on today\'s list, else the stable Right Now region (no keyboard-raising input focus)', /successorFocus\.current!\.request\(successor\.id/.test(handler) && /data-timeline-item-id="plan:\$\{successorId\}"[\s\S]{0,400}data-home-right-now-label/.test(dash) && /data-timeline-item-id=\{item\.id\}\s+tabIndex=\{-1\}/.test(strip(read('../apps/web/components/HomeTimeline.tsx'))));
  check('9. opening the picker only sets a default (no request, no submit)', /const openMovePicker = \(planId: string\) => \{[\s\S]{0,300}\};/.test(dash) && !/planExecutor/.test(dash.slice(dash.indexOf('const openMovePicker'), dash.indexOf('const closeMovePicker'))));
  check('10/33. exact time only: no Timing Search, Constructor, recommendation engine or duration editing anywhere in the Home Move code', !/timingSearch|runTimingSearch|orchestrateConstructDay|constructDay|recommend|durationMinutes:|setDuration/i.test(helper) && !/timingSearch|orchestrateConstructDay|constructDay/i.test(handler));
  check('36/37. timezone conversion goes through the canonical STRICT resolver (resolveLocalDateTime/getDatePartsInTimezone/addDaysToDateStr) and no new timezone math exists', /from '\.\/timezone'/.test(helper) && /resolveLocalDateTime\(moveDayDate/.test(helper) && !/Intl\.DateTimeFormat|getTimezoneOffset|toLocaleString\('en-US', \{ timeZone/.test(helper.replace(/toLocaleTimeString\('en-US', \{ timeZone: timezone/g, '')) && !/localDateTimeToUTC/.test(helper));
  check('39/40. Home Move knows nothing about sources, Captures, Goals, HabitLogs or timestamps of plans', !/capture|goalActivity|habit|linkCapture|completedAt|loggedAt|skippedAt/i.test(helper + handler));
  check('3. no new API route and no other write path: the only endpoint referenced is /api/plans/<id>/move; no DELETE + create, no POST /api/plans', /\/api\/plans\/\$\{encodeURIComponent\(planId\)\}\/move/.test(exec) && !/api\/plans['"`]/.test(helper) && !fs.existsSync(path.join(__dirname, '../apps/web/app/api/home')));
  check('42. the Plan-tab reschedule workflow is untouched (D3 is Home only)', /fetch\(`\/api\/plans\/\$\{replacedPlanId\}`, \{ method: 'DELETE' \}\)/.test(strip(read('../apps/web/components/PlanWithAuraView.tsx'))));
  check('43/62. MISSED exposure, new lifecycle state, schema and migrations are absent: 39 migrations (incl. the F1 0039 migration), ExecutionOutcome adds only the confirmed MOVED fact', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((f) => /^\d{4}_/.test(f)).length === 39 && /export type ExecutionOutcome = 'COMPLETED' \| 'SKIPPED' \| 'MOVED';/.test(exec));
  check('22. presentation choice: the live Timeline hides MOVED rows via one helper; the read model (agenda, DB) keeps them', /hideMovedTimelineItems\(overlayExecutionFacts\(overlayElapsedMissed\(composedTimeline, new Date\(\)\), executionFacts\)\)/.test(dash));
  check('18. the picker then starts empty (time ""), which the strict resolver rejects as INVALID, so the user must choose a valid time and nothing is pre-filled or submitted', /defaultMoveSelection\(new Date\(\), effectiveTimezone\) \?\? \{ day: 'TODAY', time: '' \}/.test(dash) && (() => { const r = resolveMoveDestination({ day: 'TODAY', time: '' }, cur0, trollNow, TROLL); return !r.ok && r.reason === 'INVALID'; })());
  check('16. the default is pre-filled ONLY when the strict resolver says OK: the search tests resolveLocalDateTime(...).status === "OK" and returns null otherwise', /resolveLocalDateTime\(date, time, timezone\)\.status === 'OK'\) return/.test(helper) && /return null;\s*\}/.test(helper));
  check('24/26. submission still runs strict resolution independently of any default, and the legacy total function is never used by Home Move', /resolveMoveDestination\(moveSelection, currentStartIso, new Date\(\), effectiveTimezone\)/.test(handler) && !/localDateTimeToUTC/.test(helper) && !/localDateTimeToUTC/.test(dash));

  if (!allPassed) { console.error('SOME HOME MOVE CHECKS FAILED'); process.exit(1); }
  console.log('ALL HOME MOVE CHECKS PASSED');
}
main();
