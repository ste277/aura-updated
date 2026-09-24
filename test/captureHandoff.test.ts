/**
 * Quick Capture V1 PR B -- pure tests: Capture row factory/identity/
 * provenance, link building, the ids-only handoff resolver, the accept
 * envelope body, and presentation helpers. No database.
 */
import {
  createIntentRowFromCapture,
  createIntentRowFromGoalActivity,
  createEmptyIntentRow,
  createInitialIntentRow,
  createIntentRowFromQuickPick,
  buildCaptureLinksForAccept,
  buildGoalActivityLinksForAccept,
  buildRequestedIntentsForSubmission,
  type PlanDayIntentRow,
} from '../apps/web/lib/planDayEntry';
import { resolveCaptureHandoff, type CaptureHandoffDeps } from '../apps/web/lib/planDayBootstrap';
import { buildAcceptRequestBody } from '../apps/web/lib/acceptConstructedDay';
import { buildCapturePlanHref, isCaptureActionable, presentCaptureStateLabel } from '../apps/web/lib/capturesPresentation';
import type { ConstructDayPreview } from '../apps/web/lib/dayConstructorOrchestrator';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const allUnique = (ids: string[]) => new Set(ids).size === ids.length;

// A/B factory + deterministic identity
const a = createIntentRowFromCapture({ id: 'cap-a', title: 'Call John' });
createEmptyIntentRow();
createEmptyIntentRow();
const a2 = createIntentRowFromCapture({ id: 'cap-a', title: 'Call John' });
check('A. createIntentRowFromCapture seeds title only, with the default planning fields', a.title === 'Call John' && a.durationMinutes === null && a.timeMode === 'FLEXIBLE' && a.fixedTime === null && a.important === false && a.deadlineChoice.kind === 'NONE');
check('A. no activityId is inferred or stored', a.activityId === undefined);
check('B. row id is the deterministic plan-day-capture-<id> (identical across "server"/"client" whatever the counter did)', a.id === 'plan-day-capture-cap-a' && a2.id === a.id);
check('B. the row id is not the bare Capture id', (a.id as string) !== 'cap-a');
check('B/E. Capture provenance is set and Goal provenance is absent', a.captureId === 'cap-a' && a.goalActivityId === undefined);

// F/G identical titles / identical would-be activity
const same = [createIntentRowFromCapture({ id: 'c1', title: 'Go for a run' }), createIntentRowFromCapture({ id: 'c2', title: 'Go for a run' })];
check('F/G. identical titles yield distinct ids and distinct provenance', same[0].id !== same[1].id && same[0].captureId !== same[1].captureId);

// uniqueness against every other source
const mix = [createInitialIntentRow(), createIntentRowFromGoalActivity({ id: 'c1', title: 'x', activityId: null }), createIntentRowFromCapture({ id: 'c1', title: 'x' }), createEmptyIntentRow(), createIntentRowFromQuickPick({ label: 'Walk' })];
check('a Capture row never collides with initial/goal/interactive/quick-pick ids (even for the same underlying id)', allUnique(mix.map((r) => r.id)));

// C/D edits and removal
const edited: PlanDayIntentRow = { ...a, title: 'Edited', durationMinutes: 60, important: true };
check('C. captureId survives planning edits', edited.captureId === 'cap-a' && edited.id === a.id);
const rows = [a, createIntentRowFromCapture({ id: 'cap-b', title: 'B' })];
const afterRemove = rows.filter((r) => r.id !== a.id);
check('D. removing a seeded row removes only the session row (sibling identity intact, no source mutation API exists here)', afterRemove.length === 1 && afterRemove[0].captureId === 'cap-b');

// H preview boundary
const req = buildRequestedIntentsForSubmission([edited], 'Asia/Kolkata', '2026-10-01');
check('H. captureId never enters the preview request intents', !Object.values(req[0]).includes('cap-a') && !JSON.stringify(req).includes('captureId') && !('captureId' in req[0]) && req[0].id === a.id);

// I/J/K/L links
const typed: PlanDayIntentRow = { ...createEmptyIntentRow(), title: 'typed' };
const goalRow = createIntentRowFromGoalActivity({ id: 'ga1', title: 'goal', activityId: null });
const capRows = [createIntentRowFromCapture({ id: 'c1', title: 'one' }), createIntentRowFromCapture({ id: 'c2', title: 'two' })];
const proposed = [{ intentId: capRows[1].id }, { intentId: capRows[0].id }, { intentId: typed.id }, { intentId: goalRow.id }];
const links = buildCaptureLinksForAccept([...capRows, typed, goalRow], proposed);
check('I. captureLinks map each placed intent id to its own Capture (order/title independent)', links.length === 2 && links.find((l) => l.intentId === capRows[0].id)?.captureId === 'c1' && links.find((l) => l.intentId === capRows[1].id)?.captureId === 'c2');
check('K. typed rows and Goal rows are never in captureLinks', !links.some((l) => l.intentId === typed.id || l.intentId === goalRow.id));
check('J. a deferred (unplaced) Capture row is excluded', buildCaptureLinksForAccept(capRows, [{ intentId: capRows[0].id }]).length === 1);
check('J. a removed row (not in rows) is excluded', buildCaptureLinksForAccept([capRows[0]], [{ intentId: capRows[0].id }, { intentId: capRows[1].id }]).length === 1);
const gLinks = buildGoalActivityLinksForAccept([...capRows, typed, goalRow], proposed);
check('L. Goal rows still produce goalActivityLinks, and Capture rows never do', gLinks.length === 1 && gLinks[0].goalActivityId === 'ga1');

// E exclusivity
const both: PlanDayIntentRow = { ...capRows[0], goalActivityId: 'ga9' };
check('E. a row carrying BOTH provenances produces NEITHER link (goalActivityId XOR captureId)', buildCaptureLinksForAccept([both], [{ intentId: both.id }]).length === 0 && buildGoalActivityLinksForAccept([both], [{ intentId: both.id }]).length === 0);

// accept body envelope
const preview = { constructionWindow: { date: '2026-10-01', start: new Date(), end: new Date(), timezone: 'UTC', source: 'EXPLICIT_RANGE' }, constructedDay: { proposedItems: [{ intentId: 'x', title: 't', start: new Date(), end: new Date(), placementSource: 'SELECTED_CANDIDATE' }] } } as unknown as ConstructDayPreview;
const body = buildAcceptRequestBody(preview, 'req-1', undefined, [{ intentId: 'x', captureId: 'c1' }]) as unknown as Record<string, unknown>;
check('accept body carries captureLinks as a SIBLING (never inside proposedItems)', Array.isArray(body.captureLinks) && !JSON.stringify(body.proposedItems).includes('captureId') && !('goalActivityLinks' in body));
check('accept body omits captureLinks entirely when there are none (byte-identical to before)', !('captureLinks' in (buildAcceptRequestBody(preview, 'req-1') as unknown as Record<string, unknown>)) && !('captureLinks' in (buildAcceptRequestBody(preview, 'req-1', undefined, []) as unknown as Record<string, unknown>)));

// presentation
check('N. the Plan with Aura URL carries ids only', buildCapturePlanHref(['a', 'b']) === '/plan-day?captures=a%2Cb' && !/title|activity|duration|deadline/i.test(buildCapturePlanHref(['a'])));
check('only OPEN is actionable; PLANNED gets a truthful "Planned" label', isCaptureActionable('OPEN') && !isCaptureActionable('PLANNED') && !isCaptureActionable('COMPLETED') && presentCaptureStateLabel('PLANNED') === 'Planned' && presentCaptureStateLabel('OPEN') === null);

// handoff resolver
type Row = { id: string; title: string; status: string; completedAt: Date | null; linkedPlanStatus: string | null };
const T = new Date('2026-09-24T10:00:00Z');
const dbRows: Record<string, Row[]> = {
  u1: [
    { id: 'open2', title: 'Open 2', status: 'OPEN', completedAt: null, linkedPlanStatus: null },
    { id: 'planned', title: 'Planned', status: 'OPEN', completedAt: null, linkedPlanStatus: 'UPCOMING' },
    { id: 'open1', title: 'Open 1', status: 'OPEN', completedAt: null, linkedPlanStatus: null },
    { id: 'cancelled', title: 'Replan', status: 'OPEN', completedAt: null, linkedPlanStatus: 'CANCELLED' },
    { id: 'done', title: 'Done', status: 'OPEN', completedAt: T, linkedPlanStatus: null },
    { id: 'dismissed', title: 'Dismissed', status: 'DISMISSED', completedAt: null, linkedPlanStatus: null },
  ],
  u2: [{ id: 'theirs', title: 'Theirs', status: 'OPEN', completedAt: null, linkedPlanStatus: null }],
};
const deps = (userId: string | null, seen: string[] = []): CaptureHandoffDeps => ({
  getSessionToken: () => (userId ? 'tok' : undefined),
  verifySession: () => (userId ? { userId } : null),
  listCaptures: async (uid) => {
    seen.push(uid);
    return dbRows[uid] ?? [];
  },
});
async function main() {
  const ids = async (param: string | null, userId: string | null = 'u1') => (await resolveCaptureHandoff(deps(userId), param)).map((c) => c.id);
  check('O. OPEN captures seed (and a CANCELLED-link capture derives OPEN, so it seeds too)', (await ids('open1,open2,cancelled')).sort().join() === 'cancelled,open1,open2');
  check('P/Q/R. PLANNED, COMPLETED and DISMISSED captures are omitted', (await ids('planned,done,dismissed')).length === 0);
  check('S. missing ids are omitted', (await ids('nope,open1')).join() === 'open1');
  check("N. another user's ids are ignored (the DB read is scoped to the session user)", (await ids('theirs')).length === 0 && (await ids('theirs', 'u2')).join() === 'theirs');
  const seen: string[] = [];
  await resolveCaptureHandoff(deps('u1', seen), 'open1');
  check('N. the resolver reads with the SESSION user id, never a URL-supplied one', seen.join() === 'u1');
  check('T. duplicate ids are deduplicated by the resolver itself', (await ids('open1,open2,open1,open1')).length === 2);
  check('U. output order is the authoritative list order (newest first), not URL order', (await ids('open1,open2')).join() === 'open2,open1' && (await ids('open2,open1')).join() === 'open2,open1');
  check('unauthenticated / malformed / empty params seed nothing', (await ids('open1', null)).length === 0 && (await ids(null)).length === 0 && (await ids('')).length === 0 && (await ids(' , ,')).length === 0);
  check('M. the resolver returns ids and titles only (no activity ids, durations, provenance)', Object.keys((await resolveCaptureHandoff(deps('u1'), 'open1'))[0]).sort().join() === 'id,title');
  const seeded = (await resolveCaptureHandoff(deps('u1'), 'open1,open2')).map(createIntentRowFromCapture);
  const again = (await resolveCaptureHandoff(deps('u1'), 'open1,open2')).map(createIntentRowFromCapture);
  check('V. SSR-safe: two independent resolutions give identical row ids', JSON.stringify(seeded.map((r) => r.id)) === JSON.stringify(again.map((r) => r.id)));
  check('cap: more than 12 requested ids are bounded', (await resolveCaptureHandoff({ ...deps('u1'), listCaptures: async () => Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, title: 't', status: 'OPEN', completedAt: null, linkedPlanStatus: null })) }, Array.from({ length: 20 }, (_, i) => `c${i}`).join(','))).length <= 12);

  if (!allPassed) {
    console.error('SOME CAPTURE HANDOFF CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL CAPTURE HANDOFF CHECKS PASSED');
}
main();
