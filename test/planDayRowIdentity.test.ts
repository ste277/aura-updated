/**
 * Plan My Day Row Identity Reliability V1 -- pure + structural suite.
 * Rows created during SSR (`useState` initializer) must carry ids that are
 * identical on server and client; rows created by user actions after
 * hydration draw from a client-only counter. Same source-reading convention
 * as planDayWiring.test.ts (no component-rendering harness in this repo).
 */
import fs from 'fs';
import path from 'path';
import {
  INITIAL_INTENT_ROW_ID,
  createInitialIntentRow,
  createEmptyIntentRow,
  createIntentRowFromQuickPick,
  createIntentRowFromGoalActivity,
  buildGoalActivityLinksForAccept,
  buildRequestedIntentsForSubmission,
  type PlanDayIntentRow,
} from '../apps/web/lib/planDayEntry';
import { resolveGoalActivityHandoff, type GoalActivityHandoffDeps } from '../apps/web/lib/planDayBootstrap';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const allUnique = (ids: string[]) => new Set(ids).size === ids.length;

// ---- A. deterministic SSR-time identity ----
// Simulates "server render" then "client hydration" in one process, with the
// counter deliberately advanced in between (the real failure mode).
const ssrInitial = createInitialIntentRow();
createEmptyIntentRow();
createEmptyIntentRow();
const clientInitial = createInitialIntentRow();
check('A. initial blank row id is identical across "server" and "client" regardless of counter state', ssrInitial.id === clientInitial.id && ssrInitial.id === INITIAL_INTENT_ROW_ID);

const ga = (id: string, title = 'Review progress', activityId: string | null = null) => ({ id, title, activityId });
const ssrGoalRows = [ga('a'), ga('b'), ga('c')].map(createIntentRowFromGoalActivity);
createEmptyIntentRow();
createIntentRowFromQuickPick({ label: 'x' });
const clientGoalRows = [ga('a'), ga('b'), ga('c')].map(createIntentRowFromGoalActivity);
check('A. Goal-seeded row ids are identical across "server" and "client" regardless of counter state', JSON.stringify(ssrGoalRows.map((r) => r.id)) === JSON.stringify(clientGoalRows.map((r) => r.id)));
check('A. Goal-seeded id is derived from the GoalActivity id with an explicit namespace (never the bare domain id)', ssrGoalRows[0].id === 'plan-day-goal-a' && (ssrGoalRows[0].id as string) !== 'a');

// ---- B/G/H. Goal rows unique, identical titles/activityIds stay distinct ----
check('B. Goal-seeded rows are unique', allUnique(ssrGoalRows.map((r) => r.id)));
const same = [ga('a', 'Review progress', 'cat-1'), ga('b', 'Review progress', 'cat-1')].map(createIntentRowFromGoalActivity);
check('G/H. identical titles and identical activityIds still yield distinct row ids and distinct provenance', same[0].id !== same[1].id && same[0].goalActivityId === 'a' && same[1].goalActivityId === 'b');

// ---- D/E/F. user-created rows unique and never collide with SSR ids ----
const userRows = [createEmptyIntentRow(), createEmptyIntentRow(), createIntentRowFromQuickPick({ label: 'Walk', activityId: 'walk' }), createIntentRowFromQuickPick({ label: 'Walk', activityId: 'walk' })];
check('D/E. manually-created and quick-pick rows are unique (including identical quick picks)', allUnique(userRows.map((r) => r.id)));
check('E. quick-pick keeps activityId and blank defaults', userRows[2].activityId === 'walk' && userRows[2].title === 'Walk' && userRows[2].durationMinutes === null && userRows[2].timeMode === 'FLEXIBLE');
const mixed = [ssrGoalRows[0], createEmptyIntentRow(), ssrGoalRows[1], createIntentRowFromQuickPick({ label: 'Walk' }), createInitialIntentRow()];
check('F. Goal + typed + quick-pick + initial rows cannot collide', allUnique(mixed.map((r) => r.id)));
check('F. only Goal rows carry goalActivityId', mixed.map((r) => r.goalActivityId ?? null).join('|') === 'a||b||');

// ---- C. duplicate GoalActivity ids in the query ----
const deps: GoalActivityHandoffDeps = {
  getSessionToken: () => 't',
  verifySession: () => ({ userId: 'u' }),
  listGoalActivities: async () => [
    { id: 'a', title: 'A', activityId: null, status: 'SUGGESTED', plannedActivityId: null, linkedPlanStatus: null },
    { id: 'b', title: 'B', activityId: null, status: 'SUGGESTED', plannedActivityId: null, linkedPlanStatus: null },
  ],
};

// ---- I/J/K/L/M. edit / remove / add / retry (mirrors PlanDayClient's updateRow/removeRow) ----
function updateRow(rows: PlanDayIntentRow[], id: string, patch: Partial<PlanDayIntentRow>) {
  return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}
const removeRow = (rows: PlanDayIntentRow[], id: string) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows);

let session: PlanDayIntentRow[] = [ga('a', 'One'), ga('b', 'Two')].map(createIntentRowFromGoalActivity);
const [idA, idB] = session.map((r) => r.id);
session = updateRow(session, idA, { title: 'Edited', activityId: undefined, durationMinutes: 60 });
check('I/J. edit preserves row id and goalActivityId', session[0].id === idA && session[0].goalActivityId === 'a' && session[0].title === 'Edited');
session = removeRow(session, idA);
check('K. removal leaves sibling identity/provenance untouched', session.length === 1 && session[0].id === idB && session[0].goalActivityId === 'b');
const added = createEmptyIntentRow();
session = [...session, added];
check('L. add-after-remove is unambiguous (new id differs from removed and surviving ids)', added.id !== idA && added.id !== idB && allUnique(session.map((r) => r.id)));
const beforeRetry = JSON.stringify(session);
buildRequestedIntentsForSubmission(session.map((r) => ({ ...r, title: r.title || 'x' })), 'TODAY' as never, '2026-01-01');
check('M. building a preview request (retry path) does not mutate or re-id rows', JSON.stringify(session) === beforeRetry);

// ---- Goal linkage cannot cross-link ----
const linkRows = [ga('a', 'Same'), ga('b', 'Same')].map(createIntentRowFromGoalActivity);
const links = buildGoalActivityLinksForAccept(linkRows, [{ intentId: linkRows[1].id }, { intentId: linkRows[0].id }]);
check('T. links map each proposed intent id to its own GoalActivity even with identical titles and reversed placement order', links.length === 2 && links.find((l) => l.intentId === 'plan-day-goal-a')?.goalActivityId === 'a' && links.find((l) => l.intentId === 'plan-day-goal-b')?.goalActivityId === 'b');

// ---- Structural (N/O/P/Q/R/S) ----
const entrySrc = stripComments(read('../apps/web/lib/planDayEntry.ts'));
const clientSrc = stripComments(read('../apps/web/app/plan-day/PlanDayClient.tsx'));
check('N. useState initializer for rows uses only deterministic factories (no counter-backed createEmptyIntentRow)', /useState<PlanDayIntentRow\[\]>\(\(\) =>[\s\S]{0,200}createInitialIntentRow\(\)/.test(clientSrc) && !/useState<PlanDayIntentRow\[\]>\(\(\) =>[\s\S]{0,200}createEmptyIntentRow/.test(clientSrc));
check('N. createIntentRowFromGoalActivity never touches the counter', !/createIntentRowFromGoalActivity[\s\S]{0,400}createEmptyIntentRow/.test(entrySrc));
check('N. no counter-backed factory is invoked inside a setRows updater', !/setRows\(\(current\) => \{[^}]*create(Empty|IntentRowFromQuickPick)/.test(clientSrc.replace(/\n/g, ' ')));
check('O/Q/R/S. preview/DayIntent/constructor/timing files untouched by this change (do not mention plan-day row ids)', ['../apps/web/lib/dayIntent.ts', '../apps/web/lib/dayConstructor.ts', '../apps/web/lib/dayConstructorOrchestrator.ts', '../packages/recommendation/src/timingSearch.ts', '../apps/web/lib/dayConstructorPreviewRequest.ts'].every((f) => !/plan-day-(row|goal)|goalActivityId/.test(read(f))));
check('P. goalActivityId still excluded from the preview request builder', !/goalActivityId/.test(entrySrc.slice(entrySrc.indexOf('export function buildRequestedIntentsForSubmission'), entrySrc.indexOf('export function buildGoalActivityLinksForAccept'))));

async function main() {
  const dup = await resolveGoalActivityHandoff(deps, 'g', 'a,b,a,a');
  check('C. duplicate GoalActivity ids in the URL yield one row per GoalActivity', dup.length === 2 && dup[0].id === 'a' && dup[1].id === 'b');
  const dupRows = dup.map(createIntentRowFromGoalActivity);
  check('C. duplicate-id handoff produces unique row ids', allUnique(dupRows.map((r) => r.id)));
  if (!allPassed) {
    console.error('SOME PLAN DAY ROW IDENTITY CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL PLAN DAY ROW IDENTITY CHECKS PASSED');
}
main();
