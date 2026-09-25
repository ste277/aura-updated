/**
 * Daily Experience V1 PR E -- Missed Recovery on Home: pure + pipeline behavior
 * (real Agenda -> Composer -> live-MISSED overlay -> confirmed-fact overlay ->
 * Right Now -> reminder pipeline, the shared execution guard on the real
 * executor) plus structural wiring checks. Live-DB proof against the real
 * routes: missedRecoveryDb.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { createPlanExecutor, overlayExecutionFacts, agendaWithoutResolvedNext, type ExecutionOutcome } from '../apps/web/lib/homeCompletion';
import { applyConfirmedSuccessors, hideMovedTimelineItems } from '../apps/web/lib/homeMove';
import { missedRecoveryPlanId, isMissedPlanItem, overlayElapsedMissed, MISSED_RECOVERY_ACTIONS } from '../apps/web/lib/homeMissedRecovery';
import { selectVisibleStartingSoonReminder } from '../apps/web/lib/reminderConsistency';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import type { AuraReminder } from '../apps/web/lib/auraReminders';
import type { PlannedActivity } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const TZ = 'Asia/Kolkata';
const atDay = (d: number, hhmm: string, ms = 0) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2026, 7, d, h, m) - 330 * 60000 + ms); };
const at = (hhmm: string) => atDay(24, hhmm);
const plan = (id: string, title: string, start: Date, end: Date, status: PlannedActivity['status'] = 'UPCOMING'): PlannedActivity => ({ id, userId: 'u1', title, activityType: 'x', icon: null, status, plannedStartAt: start, plannedEndAt: end, durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000), windowType: 'NEUTRAL', windowLabel: null, matchLabel: null, score: null, recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: start, updatedAt: start }) as PlannedActivity;
const minuteOf = (now: Date) => Math.floor(((now.getTime() + 330 * 60000) % 86400000) / 60000);
const facts = (...e: [string, ExecutionOutcome][]) => new Map<string, ExecutionOutcome>(e);
const reminder = (planId: string): AuraReminder => ({ id: `PLAN:${planId}`, type: 'PLAN_STARTING_SOON', scheduledItemType: 'PLAN', scheduledItemId: planId, activityTitle: 'x', activityIcon: null, startAt: '2026-08-24T10:00:00.000Z', endAt: '2026-08-24T11:00:00.000Z', timezone: TZ, reminderAt: '2026-08-24T09:45:00.000Z', minutesUntilStart: 5, target: { type: 'PLAN', planId } }) as unknown as AuraReminder;
const idOf = (r: AuraReminder | null) => (r && r.target.type === 'PLAN' ? r.target.planId : null);

/** The Home projection exactly as HomeDashboard composes it (PR E adds the live-MISSED overlay before the confirmed facts). `builtAt` is when the agenda was fetched; `now` is the live clock. */
function home(plans: PlannedActivity[], now: Date, f: ReadonlyMap<string, ExecutionOutcome> = new Map(), successors: ReadonlyMap<string, PlannedActivity> = new Map(), builtAt: Date = now) {
  const agenda = buildDailyAgenda({ now: builtAt, localDate: '2026-08-24', timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const forHome = applyConfirmedSuccessors(agenda, successors, builtAt);
  const composed = buildHomeTimeline({ agenda: forHome, guidance: null, selectedActivities: {}, currentMinuteOfDay: minuteOf(now), timezone: TZ, localDate: '2026-08-24' });
  const timeline = hideMovedTimelineItems(overlayExecutionFacts(overlayElapsedMissed(composed, now), f));
  return { agenda: forHome, timeline, rightNow: selectRightNowState(timeline, now), recoverable: timeline.map((i) => missedRecoveryPlanId(i, now, f)).filter((x): x is string => x !== null) };
}
const item = (h: ReturnType<typeof home>, id: string) => h.timeline.find((i) => i.id === `plan:${id}`);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const moveBody = (fromId: string, toId: string, start: Date, end: Date) => ({ from: { id: fromId, status: 'MOVED' }, plan: { id: toId, status: 'UPCOMING', title: 'x', plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000) } });

async function main() {
  const now = at('12:00');
  const M = plan('m', 'Yoga', at('09:00'), at('10:00'));

  // ---------- 57. eligibility ----------
  check('57. an elapsed UPCOMING plan is recovery-eligible and reads MISSED', (() => { const h = home([M], now); return item(h, 'm')?.metadata?.agendaStatus === 'MISSED' && h.recoverable.join() === 'm'; })());
  const ineligible: [string, PlannedActivity][] = [
    ['ACTIVE (happening now)', plan('a', 'A', at('11:30'), at('12:30'))],
    ['IMMINENT (starts soon)', plan('i', 'I', at('12:10'), at('13:00'))],
    ['future UPCOMING', plan('f', 'F', at('15:00'), at('16:00'))],
    ['LOGGED (elapsed)', plan('l', 'L', at('09:00'), at('10:00'), 'LOGGED')],
    ['SKIPPED (elapsed)', plan('s', 'S', at('09:00'), at('10:00'), 'SKIPPED')],
    ['MOVED (elapsed predecessor)', plan('mv', 'MV', at('09:00'), at('10:00'), 'MOVED')],
  ];
  for (const [label, p] of ineligible) check(`57. ${label}: no Missed Recovery`, home([p], now).recoverable.length === 0);
  check('57/38. CANCELLED is not MISSED and not recoverable', (() => { const h = home([plan('c', 'C', at('09:00'), at('10:00'), 'CANCELLED')], now); return h.recoverable.length === 0 && item(h, 'c')?.metadata?.agendaStatus !== 'MISSED'; })());
  check('57/49. no missed plan -> nothing recoverable (no section, no empty state)', home([plan('f', 'F', at('15:00'), at('16:00'))], now).recoverable.length === 0);

  // ---------- 58/44. boundaries on absolute instants ----------
  const E = plan('e', 'Edge', at('09:00'), at('10:00'));
  check('58/44. now just BEFORE the end: not missed, not recoverable', home([E], atDay(24, '10:00', -1)).recoverable.length === 0);
  check('58/44. now EXACTLY at the end: not missed (the agenda contract is end < now)', home([E], at('10:00')).recoverable.length === 0);
  check('58/44. now just AFTER the end: missed and recoverable', home([E], atDay(24, '10:00', 1)).recoverable.join() === 'e');
  const X = plan('x', 'Late night', new Date(Date.UTC(2026, 7, 23, 17, 30)), new Date(Date.UTC(2026, 7, 23, 19, 0))); // 23:00 -> 00:30 IST (crosses midnight)
  const xItem = (n: Date) => { const ag = buildDailyAgenda({ now: n, localDate: '2026-08-24', timezone: TZ, plans: [X], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] }); return buildHomeTimeline({ agenda: ag, guidance: null, selectedActivities: {}, currentMinuteOfDay: minuteOf(n), timezone: TZ, localDate: '2026-08-24' }).find((i) => i.id === 'plan:x'); };
  const nowX = new Date(Date.UTC(2026, 7, 23, 19, 1));
  check('42/58. cross-midnight: starts yesterday, ends today, end elapsed, UPCOMING -> MISSED and recoverable (absolute instants)', (() => { const it = xItem(nowX); return !!it && missedRecoveryPlanId(it, nowX, new Map()) === 'x'; })());
  check('42/58. cross-midnight at now === end: NOT yet missed', (() => { const it = xItem(X.plannedEndAt); return !it || missedRecoveryPlanId(it, X.plannedEndAt, new Map()) === null; })());
  check('44. a mounted Home whose agenda was built BEFORE the end re-derives MISSED against the live clock: at 10:00 not missed, at 10:01 missed, no longer "current"', (() => { const built = at('09:30'); const before = home([E], at('10:00'), new Map(), new Map(), built); const after = home([E], atDay(24, '10:00', 60000), new Map(), new Map(), built); return before.recoverable.length === 0 && after.recoverable.join() === 'e' && item(after, 'e')!.metadata!.isCurrent === false && isMissedPlanItem(item(after, 'e')!, atDay(24, '10:00', 60000)); })());
  check('43. MISSED derivation is instant-based: the recovery helper never touches a timezone, minute-of-day or the legacy converter', !/timezone|minuteOf|getMinuteOfDay|localDateTimeToUTC/i.test(strip(read('../apps/web/lib/homeMissedRecovery.ts'))));

  // ---------- 59. actions use ONLY the existing endpoints ----------
  const calls: { url: string; method: string; body?: string }[] = [];
  const stub = (responder: (url: string) => Response | Promise<Response>): typeof fetch => (async (input: any, init?: any) => { calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body }); return responder(String(input)); }) as typeof fetch;
  const ok = (planId: string) => (url: string) => (url.endsWith('/log') ? json({ plan: { id: planId, status: 'LOGGED' } }) : url.endsWith('/skip') ? json({ plan: { id: planId, status: 'SKIPPED' } }) : json(moveBody(planId, 'm2', at('15:00'), at('16:00'))));
  const ex = createPlanExecutor(stub(ok('m')));
  check('59/7. MISSED Done -> exactly POST /api/plans/m/log (no other endpoint)', (await ex.complete('m')) === 'DONE' && calls.length === 1 && calls[0].url === '/api/plans/m/log' && calls[0].method === 'POST');
  calls.length = 0;
  check('59/10. MISSED Skip -> exactly POST /api/plans/m/skip', (await ex.skip('m')) === 'SKIPPED' && calls.length === 1 && calls[0].url === '/api/plans/m/skip' && calls[0].method === 'POST');
  calls.length = 0;
  const mv = await ex.move('m', at('15:00').toISOString());
  check('59/12. MISSED Move -> exactly POST /api/plans/m/move with only { newStartAt }', mv.status === 'MOVED' && calls.length === 1 && calls[0].url === '/api/plans/m/move' && calls[0].method === 'POST' && calls[0].body === JSON.stringify({ newStartAt: at('15:00').toISOString() }));
  check('6/59. the recovery action set is exactly Done, Skip, Move -- no Cancel', MISSED_RECOVERY_ACTIONS.join() === 'DONE,SKIP,MOVE');

  // ---------- 60/30/31/32/33. failures leave MISSED recoverable ----------
  const failing = async (label: string, responder: (u: string) => Response | Promise<Response>, kind: 'complete' | 'skip' | 'move') => {
    calls.length = 0;
    const e = createPlanExecutor(stub(responder));
    const run = () => (kind === 'move' ? e.move('m', at('15:00').toISOString()) : e[kind]('m'));
    const r: any = await run();
    const failed = kind === 'move' ? r.status !== 'MOVED' && r.status !== 'BUSY' : r === 'FAILED';
    // A failure records no confirmed fact, so the plan is still recoverable; the guard is released and a retry issues a fresh request.
    const stillRecoverable = home([M], now).recoverable.join() === 'm';
    const before = calls.length;
    await run();
    check(`60. ${label}: not confirmed, MISSED stays recoverable, guard released, retry issues a fresh request`, failed && stillRecoverable && !e.isBusy('m') && calls.length === before + 1);
  };
  for (const [name, kind] of [['Done', 'complete'], ['Skip', 'skip'], ['Move', 'move']] as const) {
    for (const code of [400, 401, 404, 409, 500]) await failing(`${name} HTTP ${code}`, () => json({ error: 'x' }, code), kind);
    await failing(`${name} network error`, () => { throw new Error('offline'); }, kind);
    await failing(`${name} malformed success (200, junk body)`, () => new Response('not json', { status: 200 }), kind);
  }
  check('31. Done: a 200 whose plan is not LOGGED is FAILED (validation not weakened for MISSED)', (await createPlanExecutor(stub(() => json({ plan: { id: 'm', status: 'UPCOMING' } }))).complete('m')) === 'FAILED');
  check('32. Skip: a 200 whose plan is not SKIPPED is FAILED', (await createPlanExecutor(stub(() => json({ plan: { id: 'm', status: 'LOGGED' } }))).skip('m')) === 'FAILED');
  const good = moveBody('m', 'm2', at('15:00'), at('16:00'));
  const badBodies = [{ ...good, plan: { ...good.plan, status: 'LOGGED' } }, moveBody('m', 'm', at('15:00'), at('16:00')), { ...good, from: { id: 'm', status: 'UPCOMING' } }];
  check('33. Move: successor not UPCOMING / successor === original / from not MOVED are all FAILED (no fabricated successor)', (await Promise.all(badBodies.map((b) => createPlanExecutor(stub(() => json(b))).move('m', at('15:00').toISOString())))).every((r) => r.status !== 'MOVED'));

  // ---------- 61/20. same-plan bursts issue ONE lifecycle request ----------
  const burst = async (label: string, first: (e: ReturnType<typeof createPlanExecutor>) => Promise<unknown>, second: (e: ReturnType<typeof createPlanExecutor>) => Promise<unknown>) => {
    calls.length = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const e = createPlanExecutor(stub(async (url) => { await gate; return ok('m')(url); }));
    const p1 = first(e);
    const p2 = second(e);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    check(`61/20. ${label}: at most one lifecycle request (the second is BUSY), guard released afterwards`, calls.length === 1 && JSON.stringify(r2).includes('BUSY') && !JSON.stringify(r1).includes('BUSY') && !e.isBusy('m'));
  };
  const nm = at('15:00').toISOString();
  await burst('Done + Skip', (e) => e.complete('m'), (e) => e.skip('m'));
  await burst('Done + Move', (e) => e.complete('m'), (e) => e.move('m', nm));
  await burst('Skip + Move', (e) => e.skip('m'), (e) => e.move('m', nm));
  await burst('Move + Move', (e) => e.move('m', nm), (e) => e.move('m', nm));
  await burst('Skip + Done', (e) => e.skip('m'), (e) => e.complete('m'));
  await burst('Move + Done', (e) => e.move('m', nm), (e) => e.complete('m'));

  // ---------- 62/24/25/26/22. Home projection: confirmed facts beat a STALE MISSED agenda ----------
  const stale = (f: ReadonlyMap<string, ExecutionOutcome>, successors: ReadonlyMap<string, PlannedActivity> = new Map()) => home([M], now, f, successors); // the stale agenda still says elapsed UPCOMING (MISSED)
  const dn = stale(facts(['m', 'COMPLETED']));
  check('62/24. stale agenda MISSED + confirmed Done -> Completed, no longer Missed, no recovery controls', item(dn, 'm')?.metadata?.agendaStatus === 'COMPLETED' && item(dn, 'm')?.metadata?.isCompleted === true && dn.recoverable.length === 0);
  const sk = stale(facts(['m', 'SKIPPED']));
  check('62/25. stale agenda MISSED + confirmed Skip -> Skipped, no recovery controls', item(sk, 'm')?.metadata?.agendaStatus === 'SKIPPED' && sk.recoverable.length === 0);
  const B = plan('m2', 'Yoga', at('15:00'), at('16:00'));
  const mvToday = stale(facts(['m', 'MOVED']), new Map([['m', B]]));
  check('62/26. stale agenda MISSED + confirmed Move (B today) -> A gone from the live Timeline, B at its new time and not missed, no recovery controls', !item(mvToday, 'm') && item(mvToday, 'm2')?.start === B.plannedStartAt.toISOString() && item(mvToday, 'm2')?.metadata?.agendaStatus !== 'MISSED' && mvToday.recoverable.length === 0);
  const Btomorrow = plan('m3', 'Yoga', atDay(25, '09:00'), atDay(25, '10:00'));
  const mvTomorrow = stale(facts(['m', 'MOVED']), new Map([['m', Btomorrow]]));
  check('26. a Move to TOMORROW does not inject B into today\'s Timeline; A is not recoverable', !item(mvTomorrow, 'm') && !item(mvTomorrow, 'm3') && mvTomorrow.recoverable.length === 0);
  check('23. a fresh agenda (already LOGGED / SKIPPED) plus the confirmed fact agrees: resolved either way', home([plan('m', 'Yoga', at('09:00'), at('10:00'), 'LOGGED')], now, facts(['m', 'COMPLETED'])).recoverable.length === 0 && home([plan('m', 'Yoga', at('09:00'), at('10:00'), 'SKIPPED')], now, facts(['m', 'SKIPPED'])).recoverable.length === 0);
  const M2 = plan('n', 'Read', at('10:30'), at('11:00'));
  check('50. resolving one missed plan leaves another independently recoverable', home([M, M2], now, facts(['m', 'COMPLETED'])).recoverable.join() === 'n');
  check('50. multiple MISSED plans are each recoverable, in existing chronological Timeline order, with no bulk/queue', home([M, M2], now).recoverable.join() === 'm,n');

  // ---------- 17. Right Now never becomes a missed queue ----------
  const rnMissedOnly = home([M], now).rightNow;
  check('17. MISSED alone is excluded from ACTIVE_PLAN / IMMINENT_PLAN', rnMissedOnly.kind !== 'ACTIVE_PLAN' && rnMissedOnly.kind !== 'IMMINENT_PLAN');
  const rnBoth = home([M, plan('a', 'Focus', at('11:30'), at('12:30'))], now).rightNow;
  check('17. a missed plan never displaces the current actionable plan in Right Now', rnBoth.kind === 'ACTIVE_PLAN' && rnBoth.item.id === 'plan:a');
  const rnLive = home([E], atDay(24, '10:00', 60000), new Map(), new Map(), at('09:30')).rightNow;
  check('17. a plan that elapsed while Home stayed mounted leaves ACTIVE_PLAN (no stale "happening now")', rnLive.kind !== 'ACTIVE_PLAN');

  // ---------- 27/29/28. reminders stay masked; partial-refresh combinations ----------
  check('27. after a confirmed Done / Skip / Move the stale reminder for the plan stays suppressed (plan-id masking; the reminder collection is untouched)', (['COMPLETED', 'SKIPPED', 'MOVED'] as const).every((o) => idOf(selectVisibleStartingSoonReminder([reminder('m')], facts(['m', o]))) === null) && idOf(selectVisibleStartingSoonReminder([reminder('m'), reminder('z')], facts(['m', 'SKIPPED']))) === 'z');
  check('29. agenda stale + reminders fresh: the fact dominates the stale MISSED', stale(facts(['m', 'COMPLETED'])).recoverable.length === 0);
  check('29. agenda fresh + reminders stale: the stale reminder for the resolved plan is masked, nothing recoverable', home([plan('m', 'Yoga', at('09:00'), at('10:00'), 'LOGGED')], now, facts(['m', 'COMPLETED'])).recoverable.length === 0 && idOf(selectVisibleStartingSoonReminder([reminder('m')], facts(['m', 'COMPLETED']))) === null);
  check('29. agenda stale + another Home source failed (no guidance): a confirmed Skip still wins', stale(facts(['m', 'SKIPPED'])).recoverable.length === 0);
  check('28. every-refresh-fails: the confirmed fact map alone keeps A resolved on the untouched stale agenda (never reverts to MISSED); Move keeps A hidden', (['COMPLETED', 'SKIPPED'] as const).every((o) => item(home([M], now, facts(['m', o])), 'm')?.metadata?.agendaStatus === o) && !item(home([M], now, facts(['m', 'MOVED']), new Map([['m', B]])), 'm'));
  check('22. the next-item filter also skips a resolved missed plan', (() => { const ag = buildDailyAgenda({ now, localDate: '2026-08-24', timezone: TZ, plans: [M], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] }); const r = agendaWithoutResolvedNext(ag, facts(['m', 'COMPLETED'])); return !!r && (r.nextItem === undefined || r.nextItem.id !== 'plan:m'); })());

  // ---------- structural: reuse, no persistence, no scope creep ----------
  const dash = strip(read('../apps/web/components/HomeDashboard.tsx'));
  const tl = strip(read('../apps/web/components/HomeTimeline.tsx'));
  const lib = strip(read('../apps/web/lib/homeMissedRecovery.ts'));
  const block = dash.slice(dash.indexOf('const renderMissedRecovery'), dash.indexOf('const spotlightExplanation'));
  check('6. Missed Recovery offers Done, Skip and Move -- and NO Cancel', /Mark "\$\{item\.title\}" done/.test(block) && /Skip "\$\{item\.title\}"/.test(block) && /Move "\$\{item\.title\}"/.test(block) && !/cancel/i.test(block));
  check('7/10/12/20. recovery calls the SAME shared handlers (one executor / one guard / one fact map): no second executor, no new request code', /handleCompleteRightNow\(planId, 'TIMELINE'\)/.test(block) && /handleSkipRightNow\(planId, 'TIMELINE'\)/.test(block) && /openMovePicker\(planId\)/.test(block) && !/fetch\(|createPlanExecutor|new Map|setExecutionFacts/.test(block) && (dash.match(/createPlanExecutor\(/g) ?? []).length === 1);
  check('12/15. exactly ONE Move picker exists, shared by Right Now and Missed Recovery; one default-selection call site (no forked picker/default)', /const renderMovePicker = /.test(dash) && (dash.match(/<form\b/g) ?? []).length === 1 && (dash.match(/renderMovePicker\(/g) ?? []).length === 2 && (dash.match(/defaultMoveSelection\(/g) ?? []).length === 1);
  check('14. timezone: recovery + dashboard never use the legacy total function; Move stays on the strict resolver via resolveMoveDestination', !/localDateTimeToUTC/.test(dash) && !/localDateTimeToUTC/.test(lib) && /resolveMoveDestination\(moveSelection, currentStartIso/.test(dash));
  check('3/4/78. MISSED is derived, not persisted: 39 migrations (incl. the F1 0039 migration), no missedAt anywhere in source, no MISSED status written by the plan domain', (() => { const dirs = fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d)); const dbSrc = strip(read('../apps/web/lib/db.ts')); const src = [dbSrc, lib, dash, strip(read('../apps/web/lib/planMove.ts'))].join('\n'); return dirs.length === 39 && !/missedAt|missed_at/i.test(src) && !/status\s*=\s*'MISSED'|SET status = 'MISSED'|'MISSED'\s*,\s*'?LOGGED/.test(dbSrc); })());
  check('16/18. the Timeline places recovery beneath the derived-MISSED row through a render slot, shows the calm "Missed" label, and owns no lifecycle logic', /recoverySlot\?: \(item: HomeTimelineItem\) => React\.ReactNode/.test(tl) && /agendaStatus === 'MISSED'\) return 'Missed'/.test(tl) && !/fetch\(|planExecutor|handleComplete|handleSkip/.test(tl));
  check('46. accessibility: labelled group, per-action labels naming the activity, Move trigger id for focus return; the Move form keeps labelled fields and Escape/Cancel', /role="group" aria-label=\{`What happened with "\$\{item\.title\}"\?`\}/.test(block) && /id=\{`home-move-trigger-\$\{planId\}`\}/.test(block) && /<FieldLabel htmlFor="home-move-day">Day<\/FieldLabel>/.test(dash) && /event\.key === 'Escape'/.test(dash));
  check('45/19. mobile: the three direct actions wrap (flexWrap) with 44px targets and no fixed widths; no overflow menu', /flexWrap: 'wrap'/.test(block) && (block.match(/minHeight: 44/g) ?? []).length === 3 && !/width:\s*\d/.test(block));
  check('47/48. focus: Done/Skip from the Timeline focus the resolved row (fallback: the Timeline region); Move keeps D3 behavior; row and region are programmatically focusable', /focusTimelineRow\(planId\)/.test(dash) && /data-timeline-item-id=\{item\.id\}\s+tabIndex=\{-1\}/.test(tl) && /data-home-timeline-region tabIndex=\{-1\}/.test(tl) && /home-move-trigger-\$\{moveTriggerPlanRef\.current\}/.test(dash));
  check('21. no optimistic lifecycle: in every handler the confirmed fact is written only after the FAILED/non-MOVED branch has returned', ['handleCompleteRightNow', 'handleSkipRightNow', 'handleMoveRightNow'].every((h) => { const s = dash.slice(dash.indexOf(`const ${h}`)); const body = s.slice(0, s.indexOf('\n  };')); const guard = h === 'handleMoveRightNow' ? "result.status !== 'MOVED'" : "result === 'FAILED'"; return body.indexOf(guard) > 0 && body.indexOf('setExecutionFacts') > body.indexOf(guard); }));
  check('51/52/53/54/55. no automatic recovery, recomposition, Timing Search, Constructor, Day Review or analytics in the recovery path', !/timingSearch|Constructor|recompos|DayReview|analytics|missedRate|streak|bulk/i.test(lib + block));
  check('81. no new plan route / lifecycle endpoint: the plan routes remain log, move, skip', fs.readdirSync(path.join(__dirname, '../apps/web/app/api/plans/[planId]')).filter((d) => d !== 'route.ts').sort().join() === 'log,move,skip');
  check('56. the recovery helper is small and pure: it imports only the agenda derivation and Home id helpers, no DB', /from '\.\/dailyAgenda'/.test(read('../apps/web/lib/homeMissedRecovery.ts')) && !/from '\.\/db'|from 'pg'/.test(read('../apps/web/lib/homeMissedRecovery.ts')));

  console.log(allPassed ? '\nALL MISSED RECOVERY CHECKS PASSED' : '\nSOME MISSED RECOVERY CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
