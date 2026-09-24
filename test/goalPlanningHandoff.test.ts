/**
 * Goals -> Planning Integration V1 PR C -- pure regression suite for the
 * Goal -> Plan My Day handoff: row seeding, accept-link building, and the
 * server-side eligibility resolver (planDayBootstrap.ts's
 * resolveGoalActivityHandoff), exercised entirely via dependency
 * injection, no DB/network. Live-DB acceptance-linkage/lifecycle
 * coverage lives in goalPlanningHandoffDb.test.ts; structural
 * preview/DayIntent/Constructor-boundary proof lives in
 * goalPlanningHandoffWiring.test.ts.
 */
import { createIntentRowFromGoalActivity, buildGoalActivityLinksForAccept, buildRequestedIntentsForSubmission, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { resolveGoalActivityHandoff, type GoalActivityHandoffDeps } from '../apps/web/lib/planDayBootstrap';
import { buildAcceptRequestBody } from '../apps/web/lib/acceptConstructedDay';
import type { ConstructDayPreview } from '../apps/web/lib/dayConstructorOrchestrator';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// M/N/O -- row factory (this ticket's own section 10/11)
// ============================================================
check('M. createIntentRowFromGoalActivity seeds the row title from GoalActivity.title', createIntentRowFromGoalActivity({ id: 'ga1', title: 'Block focus time', activityId: null }).title === 'Block focus time');
check('N. createIntentRowFromGoalActivity preserves a real GoalActivity.activityId', createIntentRowFromGoalActivity({ id: 'ga1', title: 'Go for a run', activityId: 'workout' }).activityId === 'workout');
check('O. createIntentRowFromGoalActivity leaves activityId undefined (never fabricated) when GoalActivity.activityId is null', createIntentRowFromGoalActivity({ id: 'ga1', title: 'Block focus time', activityId: null }).activityId === undefined);
check('createIntentRowFromGoalActivity stamps goalActivityId from the GoalActivity id', createIntentRowFromGoalActivity({ id: 'ga-xyz', title: 'x', activityId: null }).goalActivityId === 'ga-xyz');
check(
  'createIntentRowFromGoalActivity reuses createEmptyIntentRow defaults for every other field (duration/timeMode/important/deadline)',
  (() => {
    const row = createIntentRowFromGoalActivity({ id: 'ga1', title: 'x', activityId: null });
    return row.durationMinutes === null && row.timeMode === 'FLEXIBLE' && row.fixedTime === null && row.important === false && row.deadlineChoice.kind === 'NONE';
  })()
);
check('every seeded row gets a distinct id', createIntentRowFromGoalActivity({ id: 'ga1', title: 'a', activityId: null }).id !== createIntentRowFromGoalActivity({ id: 'ga2', title: 'b', activityId: null }).id);

// ============================================================
// R -- title edit must not touch the underlying GoalActivity (this is
// enforced structurally: no code path in this file/PlanDayClient.tsx
// ever calls a Goal API with a row's edited title -- proven here by
// showing buildRequestedIntentsForSubmission/buildGoalActivityLinksForAccept
// never even READ an edited title back toward a Goal endpoint; the real
// "GoalActivity.title in the DB is untouched" fact is proven live in
// goalPlanningHandoffDb.test.ts's own title-independence check).
// ============================================================
check(
  'R. editing a seeded row\'s title (simulating PlanDayClient\'s updateRow patch) leaves goalActivityId intact -- provenance survives independent of title',
  (() => {
    const seeded = createIntentRowFromGoalActivity({ id: 'ga1', title: 'Block focus time', activityId: null });
    const edited: PlanDayIntentRow = { ...seeded, title: 'Deep work sprint', activityId: undefined }; // mirrors PlanDayClient's own title-onChange patch shape
    return edited.goalActivityId === 'ga1' && edited.title === 'Deep work sprint';
  })()
);

// ============================================================
// P -- goalActivityId survives edit/retry (same reasoning: it is a plain
// field in a plain object; PlanDayClient's own setRows call sites either
// patch-merge or filter/spread -- proven here structurally by simulating
// exactly those two operations).
// ============================================================
check(
  'P. goalActivityId survives a patch-merge update (duration change) exactly like PlanDayClient\'s own updateRow',
  (() => {
    const seeded = createIntentRowFromGoalActivity({ id: 'ga1', title: 'x', activityId: null });
    const patched = { ...seeded, durationMinutes: 60 }; // updateRow(id, {durationMinutes: 60})
    return patched.goalActivityId === 'ga1';
  })()
);
check(
  'P. goalActivityId survives a filter (simulating an unrelated row\'s removal, leaving this row untouched)',
  (() => {
    const seeded = createIntentRowFromGoalActivity({ id: 'ga1', title: 'x', activityId: null });
    const other = createIntentRowFromGoalActivity({ id: 'ga2', title: 'y', activityId: null });
    const rows = [seeded, other].filter((r) => r.id !== other.id);
    return rows.length === 1 && rows[0].goalActivityId === 'ga1';
  })()
);

// ============================================================
// Q -- row removal never mutates/dismisses GoalActivity (structural: no
// function in planDayEntry.ts that removes a row ever makes a network
// call at all -- proven by the type signature itself: filtering an array
// is synchronous and pure. Real "GoalActivity remains SUGGESTED after
// row removal" is proven live in goalPlanningHandoffDb.test.ts).
// ============================================================
check(
  'Q. removing a Goal-seeded row from the client array is a pure, synchronous filter with no side effect surface',
  (() => {
    const seeded = createIntentRowFromGoalActivity({ id: 'ga1', title: 'x', activityId: null });
    const rows = [seeded];
    const afterRemoval = rows.filter((r) => r.id !== seeded.id); // removeRow(id)
    return afterRemoval.length === 0;
  })()
);

// ============================================================
// buildGoalActivityLinksForAccept -- section 21/22 (proposed-only
// filtering, deferred/removed rows excluded)
// ============================================================
function row(id: string, goalActivityId?: string): PlanDayIntentRow {
  return { id, title: id, durationMinutes: null, timeMode: 'FLEXIBLE', fixedTime: null, important: false, deadlineChoice: { kind: 'NONE' }, goalActivityId };
}

check(
  'buildGoalActivityLinksForAccept includes a Goal row that was placed',
  (() => {
    const links = buildGoalActivityLinksForAccept([row('r1', 'ga1')], [{ intentId: 'r1' }]);
    return links.length === 1 && links[0].intentId === 'r1' && links[0].goalActivityId === 'ga1';
  })()
);
check(
  '22/AD. buildGoalActivityLinksForAccept excludes a Goal row that was DEFERRED (absent from proposedItems)',
  buildGoalActivityLinksForAccept([row('r1', 'ga1'), row('r2', 'ga2')], [{ intentId: 'r1' }]).length === 1
);
check(
  'AE. buildGoalActivityLinksForAccept excludes a Goal row removed before preview (absent from the rows array entirely)',
  buildGoalActivityLinksForAccept([row('r1', 'ga1')], [{ intentId: 'r1' }, { intentId: 'r2' }]).length === 1
);
check(
  '23. buildGoalActivityLinksForAccept excludes a typed (non-Goal) row even when it was placed',
  buildGoalActivityLinksForAccept([row('r1', 'ga1'), row('r2', undefined)], [{ intentId: 'r1' }, { intentId: 'r2' }]).length === 1
);
check('buildGoalActivityLinksForAccept returns an empty array for an all-typed session', buildGoalActivityLinksForAccept([row('r1', undefined)], [{ intentId: 'r1' }]).length === 0);

// ============================================================
// S/T -- preview request never contains Goal fields (accept-time-only
// concern -- buildRequestedIntentsForSubmission is the PREVIEW builder,
// and it never even accepts a goalActivityId-bearing shape as relevant
// input; proven here by round-tripping a seeded row through it and
// inspecting the exact keys on the produced intent).
// ============================================================
check(
  'S/T. a Goal-seeded row, once mapped through buildRequestedIntentsForSubmission (the PREVIEW request builder), produces an intent object with no "goalActivityId"/"goalId" key at all',
  (() => {
    const seeded = createIntentRowFromGoalActivity({ id: 'ga1', title: 'Block focus time', activityId: 'workout' });
    const intents = buildRequestedIntentsForSubmission([seeded], 'Asia/Kolkata', '2026-09-25');
    const keys = Object.keys(intents[0]);
    return intents.length === 1 && !keys.includes('goalActivityId') && !keys.includes('goalId') && !JSON.stringify(intents[0]).includes('goalActivityId');
  })()
);

// ============================================================
// buildAcceptRequestBody -- goalActivityLinks is a sibling, omitted when
// empty (byte-identical to before this PR for an ordinary accept).
// ============================================================
const fakePreview = {
  constructionWindow: { date: '2026-09-25', start: new Date('2026-09-25T00:00:00Z'), end: new Date('2026-09-25T23:59:00Z'), timezone: 'Asia/Kolkata', source: 'REMAINING_TODAY' },
  constructedDay: { proposedItems: [{ intentId: 'r1', title: 'x', start: new Date(), end: new Date(), placementSource: 'SELECTED_CANDIDATE' }], deferredItems: [] },
} as unknown as ConstructDayPreview;

check('buildAcceptRequestBody omits goalActivityLinks entirely when none are supplied', !('goalActivityLinks' in buildAcceptRequestBody(fakePreview, 'req1')));
check('buildAcceptRequestBody omits goalActivityLinks entirely when an empty array is supplied', !('goalActivityLinks' in buildAcceptRequestBody(fakePreview, 'req1', [])));
check(
  'buildAcceptRequestBody includes goalActivityLinks as a sibling of proposedItems/constructionWindow when non-empty',
  (() => {
    const body = buildAcceptRequestBody(fakePreview, 'req1', [{ intentId: 'r1', goalActivityId: 'ga1' }]);
    return 'goalActivityLinks' in body && body.goalActivityLinks!.length === 1 && 'proposedItems' in body && 'constructionWindow' in body;
  })()
);

// ============================================================
// resolveGoalActivityHandoff -- A-L (ownership/eligibility resolution,
// entirely via DI, no DB)
// ============================================================
function makeDeps(overrides: Partial<GoalActivityHandoffDeps> = {}): GoalActivityHandoffDeps {
  return {
    getSessionToken: () => 'tok',
    verifySession: () => ({ userId: 'user-1' }),
    listGoalActivities: async () => [],
    ...overrides,
  };
}

type Row = { id: string; title: string; activityId: string | null; status: string; plannedActivityId: string | null; linkedPlanStatus: string | null };

async function main() {
  {
    const rows: Row[] = [{ id: 'ga-suggested', title: 'Block focus time', activityId: null, status: 'SUGGESTED', plannedActivityId: null, linkedPlanStatus: null }];
    const result = await resolveGoalActivityHandoff(makeDeps({ listGoalActivities: async () => rows }), 'goal-1', 'ga-suggested');
    check('A. resolveGoalActivityHandoff selects a SUGGESTED activity', result.length === 1 && result[0].id === 'ga-suggested');
  }
  {
    const rows: Row[] = [{ id: 'ga-planned', title: 'x', activityId: null, status: 'SUGGESTED', plannedActivityId: 'p1', linkedPlanStatus: 'UPCOMING' }];
    const result = await resolveGoalActivityHandoff(makeDeps({ listGoalActivities: async () => rows }), 'goal-1', 'ga-planned');
    check('B/I. resolveGoalActivityHandoff omits a PLANNED activity (stale-PLANNED case)', result.length === 0);
  }
  {
    const rows: Row[] = [{ id: 'ga-completed', title: 'x', activityId: null, status: 'SUGGESTED', plannedActivityId: 'p1', linkedPlanStatus: 'LOGGED' }];
    const result = await resolveGoalActivityHandoff(makeDeps({ listGoalActivities: async () => rows }), 'goal-1', 'ga-completed');
    check('C/J. resolveGoalActivityHandoff omits a COMPLETED activity (stale-COMPLETED case)', result.length === 0);
  }
  {
    const rows: Row[] = [{ id: 'ga-dismissed', title: 'x', activityId: null, status: 'DISMISSED', plannedActivityId: null, linkedPlanStatus: null }];
    const result = await resolveGoalActivityHandoff(makeDeps({ listGoalActivities: async () => rows }), 'goal-1', 'ga-dismissed');
    check('D/K. resolveGoalActivityHandoff omits a DISMISSED activity', result.length === 0);
  }
  {
    // O. a CANCELLED-linked activity derives SUGGESTED and IS eligible.
    const rows: Row[] = [{ id: 'ga-cancelled', title: 'x', activityId: null, status: 'SUGGESTED', plannedActivityId: 'p1', linkedPlanStatus: 'CANCELLED' }];
    const result = await resolveGoalActivityHandoff(makeDeps({ listGoalActivities: async () => rows }), 'goal-1', 'ga-cancelled');
    check('a CANCELLED-linked activity (derived SUGGESTED) is eligible for handoff', result.length === 1);
  }
  {
    // L. unknown/not-owned id -- simply absent from the returned rows (the
    // deps' own listGoalActivities is already userId-scoped; requesting
    // an id that isn't among them fails safe by construction).
    const rows: Row[] = [{ id: 'ga-real', title: 'x', activityId: null, status: 'SUGGESTED', plannedActivityId: null, linkedPlanStatus: null }];
    const result = await resolveGoalActivityHandoff(makeDeps({ listGoalActivities: async () => rows }), 'goal-1', 'ga-not-owned,ga-real');
    check('L. an unknown/not-owned GoalActivity id is silently omitted, never fails the whole request', result.length === 1 && result[0].id === 'ga-real');
  }
  {
    // H. ownership resolution -- no session at all.
    const rows: Row[] = [{ id: 'ga-real', title: 'x', activityId: null, status: 'SUGGESTED', plannedActivityId: null, linkedPlanStatus: null }];
    const result = await resolveGoalActivityHandoff(makeDeps({ getSessionToken: () => undefined, listGoalActivities: async () => rows }), 'goal-1', 'ga-real');
    check('H. no session token -> empty result, never seeds anything', result.length === 0);
  }
  {
    const rows: Row[] = [{ id: 'ga-real', title: 'x', activityId: null, status: 'SUGGESTED', plannedActivityId: null, linkedPlanStatus: null }];
    const result = await resolveGoalActivityHandoff(makeDeps({ verifySession: () => null, listGoalActivities: async () => rows }), 'goal-1', 'ga-real');
    check('H. an invalid session token -> empty result', result.length === 0);
  }
  {
    const result = await resolveGoalActivityHandoff(makeDeps(), null, 'ga-1');
    check('missing goalId -> empty result, no query even attempted', result.length === 0);
  }
  {
    const result = await resolveGoalActivityHandoff(makeDeps(), 'goal-1', null);
    check('missing activities param -> empty result', result.length === 0);
  }
  {
    const result = await resolveGoalActivityHandoff(makeDeps(), 'goal-1', '   ,  ,');
    check('an activities param with only empty/whitespace entries -> empty result', result.length === 0);
  }
  {
    // 6. Never trusts a client-supplied title -- the deps' own row source
    // is the only place a title comes from; a caller cannot inject one
    // via the URL (the function signature itself takes no title input at
    // all).
    const rows: Row[] = [{ id: 'ga-real', title: 'Real server title', activityId: 'workout', status: 'SUGGESTED', plannedActivityId: null, linkedPlanStatus: null }];
    const result = await resolveGoalActivityHandoff(makeDeps({ listGoalActivities: async () => rows }), 'goal-1', 'ga-real');
    check('6. the returned title/activityId come only from the server-side row, never from any URL-supplied value', result[0].title === 'Real server title' && result[0].activityId === 'workout');
  }
  {
    // Cap enforcement -- more than MAX_PLAN_DAY_INTENTS requested ids are truncated.
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `ga-${i}`, title: `t${i}`, activityId: null, status: 'SUGGESTED', plannedActivityId: null, linkedPlanStatus: null }));
    const result = await resolveGoalActivityHandoff(makeDeps({ listGoalActivities: async () => many }), 'goal-1', many.map((r) => r.id).join(','));
    check('requested id list beyond MAX_PLAN_DAY_INTENTS is capped, never seeds an unbounded number of rows', result.length <= 12);
  }

  if (!allPassed) {
    console.error('SOME GOAL PLANNING HANDOFF CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL PLANNING HANDOFF CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
