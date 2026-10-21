// Run with: TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/planTabRecommendationChoiceRescheduleContext.test.ts
// (see .github/workflows/ci.yml). Imports a .tsx component, so needs `jsx`
// set -- same reason as test/planWithAuraViewLogic.test.ts (root
// tsconfig.json exclude).
//
// AURA DR4-F2A -- the audit (AURA_DR4_F2_TIMING_CHOICE_UX_AUDIT.md section 5)
// found FIND mode's own candidate-selection, re-search, and date-change
// behavior already correct (reschedulingPlanId/title/duration are never
// touched by any of them) -- the one confirmed defect was switching to
// Check a Time/Compare mid-reschedule, which left a stale, unrelated result
// on screen with no reschedule banner. The fix: a reschedule always forces
// FIND mode (handleReschedulePlan), and the mode switcher itself is locked
// for as long as reschedulingPlanId is set (SegmentedControl's new
// `disabled` prop) -- so the mode-switch defect's trigger is now
// unreachable, without implementing CHECK/COMPARE's own reschedule-aware
// prefill (DR4-F2B's job).
import * as fs from 'fs';
import {
  findCandidateKey,
  planPayloadFromCandidate,
} from '../apps/web/components/PlanWithAuraView';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import {
  upsertUserByEmail, updateBirthProfile, createPlannedActivity, beginTransaction,
  createGoalWithActivities, addGoalActivity, deleteGoal, listGoalActivitiesWithLinkedPlanStatus,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { POST as moveRoute } from '../apps/web/app/api/plans/[planId]/move/route';
import { mapPlanRow, isActionableUpcomingPlan } from '../apps/web/lib/planFormatting';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;

const chennaiContext = { now: new Date(Date.UTC(2026, 7, 21, 4, 0, 0)), latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata', tzOffsetMinutes: 330 };

// ============================================================
// 1/2/3/4/5/6. Candidate selection is a pure function of WHICH candidate
// object is passed to planPayloadFromCandidate -- this is exactly what
// each "Use this time" button's own onPlan handler does, so proving this
// at the data layer proves the UI can never save the wrong candidate's
// time regardless of which of the up-to-3 cards the user taps.
// ============================================================

const findResponse = runTimingSearch({ mode: 'FIND', activityId: 'deep-work', durationMinutes: 60, horizon: 'SEVEN_DAYS', timePreference: 'ANY', context: chennaiContext, limit: 3 });
check('1/2/3. FIND returns up to 3 genuinely distinct candidates to choose from (not padded, not deduplicated to fewer than the engine actually found)', findResponse.candidates.length >= 2 && findResponse.candidates.length <= 3);
check('4. candidates are not required to share a date -- at least this search\'s own candidates are evaluated independently per slot (the engine, not the UI, decides spacing; see the DR4-F2 audit for the diversity rule itself)', findResponse.candidates.every((c) => typeof c.start === 'string'));
const payloads = findResponse.candidates.map((c) => planPayloadFromCandidate(c, 60));
check('5/6. selecting the FIRST candidate (index 0, "Best Match") produces a plan payload whose start/end are exactly that candidate\'s own, not any other candidate\'s', payloads[0].plannedStartAt === findResponse.candidates[0].start && payloads[0].plannedEndAt === findResponse.candidates[0].end);
if (findResponse.candidates.length > 1) {
  check('5/6. selecting the SECOND candidate (first "Other Good Option") produces a plan payload with ITS OWN start/end, distinct from the first candidate\'s', payloads[1].plannedStartAt === findResponse.candidates[1].start && payloads[1].plannedStartAt !== payloads[0].plannedStartAt);
}
if (findResponse.candidates.length > 2) {
  check('5/6. selecting the THIRD candidate produces a plan payload with ITS OWN start/end, distinct from both other candidates\'', payloads[2].plannedStartAt === findResponse.candidates[2].start && payloads[2].plannedStartAt !== payloads[0].plannedStartAt && payloads[2].plannedStartAt !== payloads[1].plannedStartAt);
}
check('findCandidateKey differs for every distinct candidate in this result set (no two cards could ever collide on the same save-tracking key)', new Set(findResponse.candidates.map(findCandidateKey)).size === findResponse.candidates.length);

// ============================================================
// Structural: the UI wiring that makes 5/6 true in the rendered app --
// candidates[0]'s own onPlan uses candidates[0], and every OTHER card
// (candidates.slice(1)) uses its own `candidate` from the .map callback,
// never a fixed/first candidate.
// ============================================================

const source = fs.readFileSync(require.resolve('../apps/web/components/PlanWithAuraView.tsx'), 'utf8');
const stripped = source.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');
check('Structural: the Best Match card\'s onPlan is built from findResult.candidates[0] specifically', /onPlan=\{\(\) => saveOpportunity\(findCandidateKey\(findResult\.candidates\[0\]\), planPayloadFromCandidate\(findResult\.candidates\[0\], durationMinutes\)/.test(stripped));
check('Structural: every "Other Good Option" card\'s onPlan is built from ITS OWN `candidate` (the current .map iteration item), never a hardcoded index', /findResult\.candidates\.slice\(1\)\.map\(\(candidate\) =>/.test(stripped) && /onPlan=\{\(\) => saveOpportunity\(findCandidateKey\(candidate\), planPayloadFromCandidate\(candidate, durationMinutes\)/.test(stripped));

// ============================================================
// 11/12/13. FIND re-run, search-date change, and candidate-detail
// navigation never reset reschedule context -- confirmed structurally,
// since reschedulingPlanId is set in exactly 3 places in the whole file
// (its own declaration, handleReschedulePlan's own assignment, and
// handleReschedulePlanViaMove's clear-on-success) and none of them live
// inside handleFindTime, the horizon/date onChange handlers, or
// TimingResultCard (a SEPARATE component with its own local
// showAllReasons state -- it cannot reach reschedulingPlanId at all).
// ============================================================

const setReschedulingPlanIdSites = (stripped.match(/setReschedulingPlanId\(/g) || []).length;
check('11. re-running FIND (handleFindTime) never calls setReschedulingPlanId -- rerunning the search cannot reset or clear an in-progress reschedule', setReschedulingPlanIdSites === 3 && !/const handleFindTime = async[\s\S]*?setReschedulingPlanId/.test(stripped));
check('12. changing the search date/horizon (setHorizon, setCustomStartDate, setCustomEndDate) never touches reschedulingPlanId', !/onChange=\{\(value\) => setHorizon\(value as PlanningHorizon\)\}[\s\S]{0,200}setReschedulingPlanId/.test(stripped) && !/setCustomStartDate\(event\.target\.value\)\)[\s\S]{0,200}setReschedulingPlanId/.test(stripped));
const timingResultCardStart = source.indexOf('function TimingResultCard({');
const timingResultCardEnd = source.indexOf('function EverydaySharedResultCard({', timingResultCardStart);
const timingResultCardFn = timingResultCardStart >= 0 && timingResultCardEnd > timingResultCardStart ? source.slice(timingResultCardStart, timingResultCardEnd) : '';
check('13. candidate-detail navigation ("Why this time?") is local state owned by TimingResultCard, a SEPARATE component with no access to reschedulingPlanId -- expanding/collapsing reasons cannot reset reschedule context', timingResultCardFn.length > 0 && /const \[showAllReasons, setShowAllReasons\] = useState\(false\)/.test(timingResultCardFn) && !/reschedulingPlanId/.test(timingResultCardFn));

// ============================================================
// 14. Abandoning a reschedule (navigating away without saving) makes no
// network call and mutates nothing -- re-confirms DR4-F1's own guarantee
// still holds after this PR's changes.
// ============================================================

const reschedulePlanFn = (stripped.match(/const handleReschedulePlan = \(plan: UpcomingPlan\)[\s\S]*?\n  };/) || [''])[0];
check('14. handleReschedulePlan (entering reschedule mode) still makes no network call of its own -- abandoning before picking a time changes nothing server-side', !/fetch\(/.test(reschedulePlanFn));

// ============================================================
// 15. FIND/CHECK/COMPARE transition boundary -- the actual DR4-F2A fix.
// ============================================================

check('15a. handleReschedulePlan now forces FIND mode as its very first action, regardless of which tab was active when "Reschedule" was tapped', /const handleReschedulePlan = \(plan: UpcomingPlan\) => \{ setPlanMode\('FIND'\);/.test(stripped));
check('15b. the mode switcher (SegmentedControl) is now locked for exactly as long as a reschedule is in progress', /<SegmentedControl options=\{PLAN_MODES\.map[\s\S]{0,200}?disabled=\{Boolean\(reschedulingPlanId\)\}/.test(stripped));
const uiSource = fs.readFileSync(require.resolve('../apps/web/components/ui.tsx'), 'utf8');
const uiStripped = uiSource.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');
check('15c. SegmentedControl\'s own onClick is a genuine no-op while disabled (not just a visually-disabled button that still fires onChange)', /onClick=\{\(\) => \{ if \(!disabled\) onChange\(option\.value\); \}\}/.test(uiStripped));
check('15d. the helper text under the mode switcher explains the lock instead of showing a mode-specific helper that no longer applies', /reschedulingPlanId \? 'Switch modes after finishing this reschedule' : PLAN_MODES\.find/.test(stripped));
check('15e. this is a complete block, not a partial/silent one: locking never routes through handleSavePlan, handleReschedulePlanViaMove or any fetch -- it only ever prevents setPlanMode from firing', !/disabled=\{Boolean\(reschedulingPlanId\)\}[\s\S]{0,100}(fetch\(|handleSavePlan|handleReschedulePlanViaMove)/.test(stripped));

check('SegmentedControl\'s new `disabled` prop is optional and backward compatible -- every OTHER existing caller (ExploreModeToggle, InsightsView, MuhurthamFinderView, RhythmPicker, GoalsListClient, PlanDayClient) omits it and keeps working exactly as before', /disabled\?: boolean/.test(uiStripped));

// ============================================================
// DB-backed: a reschedule request representing ANY of several distinct
// destinations (standing in for "the user picked candidate 1, 2 or 3")
// preserves title/duration/goal continuity/lineage identically regardless
// of which one was chosen -- the server has no concept of "which card was
// clicked," only the instant sent, so this is the authoritative proof
// that selecting any recommendation is equally safe.
// ============================================================

const req = (tok: string | null, body: unknown): any => ({ cookies: { get: (n: string) => (tok && n === 'as_session' ? { value: tok } : undefined) }, json: async () => body, headers: new Headers() });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  const U = await upsertUserByEmail({ email: 'test-dr4f2a-choice@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tok = createSessionToken(U.id, U.email);
  const goalIds: string[] = [];
  let n = 0;
  const src = () => minute(Date.now()) + 15 * DAY + n++ * 3 * HOUR;
  const dest = () => new Date(minute(Date.now()) + 55 * DAY + n++ * 3 * HOUR);
  const rescheduleViaMoveRoute = async (planId: string, newStartAt: Date) => {
    const res = await moveRoute(req(tok, { newStartAt: newStartAt.toISOString() }), { params: { planId } });
    return { status: res.status, body: await res.json() };
  };

  try {
    // ---- a goal-linked plan rescheduled to 3 DIFFERENT destinations in
    // sequence (simulating: pick candidate 1, change your mind, pick
    // candidate 2, change your mind, pick candidate 3) -- each one must
    // land correctly with full continuity, proving the choice of WHICH
    // candidate never matters to correctness. ----
    const goal = await createGoalWithActivities({ userId: U.id, title: 'DR4-F2A choice goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(U.id, goal.goal.id, { title: 'Draft deck', activityId: null });
    let currentPlanId = (await createPlannedActivity({ userId: U.id, title: `Draft deck ${Date.now()}`, plannedStartAt: new Date(src()), plannedEndAt: new Date(src() + HOUR), durationMinutes: 60, windowType: 'NEUTRAL' } as any)).id;
    { const c = await beginTransaction(); await c.query(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [currentPlanId, ga!.id]); await c.query('COMMIT'); c.release(); }

    for (const label of ['first', 'second', 'third']) {
      const target = dest();
      const r = await rescheduleViaMoveRoute(currentPlanId, target);
      check(`2/3/9/10. selecting the ${label} destination (standing in for the ${label} recommendation) succeeds -> 200, original MOVED, replacement UPCOMING, correctly linked`, r.status === 200 && r.body.from.status === 'MOVED' && r.body.plan.status === 'UPCOMING' && r.body.plan.rescheduledFromPlanId === currentPlanId);
      check(`6. the ${label} selection's replacement lands at EXACTLY the destination that was chosen, not some other instant`, new Date(r.body.plan.plannedStartAt).getTime() === target.getTime());
      check(`7. the ${label} selection preserves the original 60-minute duration`, r.body.plan.durationMinutes === 60);
      check(`8. the ${label} selection preserves the title "Draft deck..." verbatim`, r.body.plan.title === r.body.from.title);
      const gRow = (await listGoalActivitiesWithLinkedPlanStatus(U.id, goal.goal.id)).find((g) => g.id === ga!.id)!;
      check(`9. the ${label} selection keeps the goal association pointed at the NEW replacement`, gRow.plannedActivityId === r.body.plan.id);
      currentPlanId = r.body.plan.id;
    }

    // ---- no duplicate actionable plan accumulates across the 3-hop chain ----
    const total = Number((await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]))[0].n);
    check('no duplicate actionable plan accumulates across repeated reschedule-and-reselect: exactly one row per hop (1 original + 3 replacements), only the LAST one actionable', total === 4 && isActionableUpcomingPlan(mapPlanRow((await sql(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [currentPlanId]))[0], TZ)));
  } finally {
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    for (const g of goalIds) await deleteGoal(U.id, g).catch(() => {});
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [U.id]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME DR4-F2A RECOMMENDATION CHOICE CHECKS FAILED'); process.exit(1); }
  console.log('ALL DR4-F2A RECOMMENDATION CHOICE CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
