/**
 * Remaining-Day Recomposition V1 PR F1 (trust-boundary correction) -- the REAL preview -> accept boundary.
 * A real authenticated preview (the production request handler with the real orchestrator, real timing search
 * and real DB reads) produces signed proposed items; the real accept route then receives what a browser would
 * send, with and without tampering. Requires DATABASE_URL (fresh, 39 migrations).
 */
import {
  upsertUserByEmail, updateBirthProfile, getUserById, createCapture, getCaptureWithLinkedPlanStatus, beginTransaction,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { parsePreviewResponseBody } from '../apps/web/lib/dayConstructorPreviewClient';
import { buildAcceptRequestBody } from '../apps/web/lib/acceptConstructedDay';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { signPreviewItem } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { sign } from '../apps/web/lib/auth';
import { POST as acceptRoute } from '../apps/web/app/api/day-constructor/accept/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const HOUR = 3600000; const MIN = 60000;
const fakeReq = (cookie: string | undefined, body: unknown): any => ({ cookies: { get: (n: string) => (cookie !== undefined && n === 'as_session' ? { value: cookie } : undefined) }, json: async () => body, headers: new Headers() });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
/** A zone whose local clock is currently early in its day, so REMAINING_TODAY has hours left whenever this runs. */
function earlyDayZone(now: Date): string {
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Auckland', 'Australia/Sydney', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Etc/GMT+12', 'Pacific/Pago_Pago']) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour >= 1 && hour <= 8) return tz;
  }
  return 'Etc/GMT+12';
}

async function main() {
  const now = new Date();
  const TZ = earlyDayZone(now);
  const mkUser = async (label: string) => {
    const U = await upsertUserByEmail({ email: `test-preview-integrity-${label}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    return { U, tok: createSessionToken(U.id, U.email) };
  };
  const A = await mkUser('a');
  const B = await mkUser('b');
  const users = [A.U.id, B.U.id];
  const plansOf = async (userId: string) => sql(`SELECT id, title, "schedulingMode", status FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY "plannedStartAt"`, [userId]);
  let n = 0;
  const targetDate = getDatePartsInTimezone(TZ, now).dateStr;
  const fixedStart = new Date(Math.ceil((now.getTime() + 2 * HOUR) / (15 * MIN)) * 15 * MIN);

  /** The production preview boundary, as the browser reaches it. */
  const preview = async (user: typeof A, intents: unknown[]) => {
    const result = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId: user.U.id }),
      getUser: (id) => getUserById(id),
      getBody: async () => ({ targetDate, intents }),
      now: () => new Date(),
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
    });
    const parsed = parsePreviewResponseBody(JSON.parse(JSON.stringify(result.body)), result.httpStatus);
    return parsed.status === 'READY' ? parsed.preview : null;
  };
  /** What a browser sends: the real client body builder, JSON round-tripped. */
  const acceptBody = (pv: NonNullable<Awaited<ReturnType<typeof preview>>>, extra: { captureLinks?: unknown[] } = {}) => JSON.parse(JSON.stringify({ ...buildAcceptRequestBody(pv, `integrity-${Date.now()}-${n++}`), ...extra }));
  const post = async (user: typeof A, body: unknown) => { const res = await acceptRoute(fakeReq(user.tok, body)); return res.json(); };

  try {
    const cap = await createCapture(A.U.id, 'Capture under integrity test');
    const pv = await preview(A, [
      { id: 'fx', title: 'Board meeting', durationMinutes: 30, flexibility: 'FIXED', fixedStart: fixedStart.toISOString() },
      { id: 'fl', title: 'Deep focus block', durationMinutes: 60, flexibility: 'FLEXIBLE', activityId: 'deep_work' },
    ]);
    const items = pv?.constructedDay.proposedItems ?? [];
    const fixedItem = items.find((i) => i.intentId === 'fx');
    const flexItem = items.find((i) => i.intentId === 'fl');
    check('precondition: the real preview places BOTH a FIXED_CONSTRAINT item and a SELECTED_CANDIDATE item, each carrying a server-signed acceptanceToken', !!pv && fixedItem?.placementSource === 'FIXED_CONSTRAINT' && flexItem?.placementSource === 'SELECTED_CANDIDATE' && items.every((i) => typeof (i as any).acceptanceToken === 'string' && (i as any).acceptanceToken.length > 20));
    if (!pv || !fixedItem || !flexItem) throw new Error(`preview did not produce both items (zone ${TZ}, target ${targetDate})`);
    const base = acceptBody(pv);
    const only = (intentId: string, edit: (item: any) => void, window: (w: any) => void = () => {}) => { const b = JSON.parse(JSON.stringify(base)); b.proposedItems = b.proposedItems.filter((i: any) => i.intentId === intentId); edit(b.proposedItems[0]); window(b.constructionWindow); b.clientRequestId = `integrity-t-${Date.now()}-${n++}`; return b; };
    const rejectedWith = (r: any, detail: string) => r.status === 'REJECTED' && r.reason === 'INVALID_REQUEST' && (r.diagnostics ?? []).some((d: any) => d.detail === detail);
    const countBefore = (await plansOf(A.U.id)).length;

    // ---- forgeries: nothing may be written ----
    const forgedUp = await post(A, only('fx', (i) => { i.placementSource = 'SELECTED_CANDIDATE'; }));
    check('22/30. FORGED FIXED -> FLEXIBLE: a genuinely FIXED proposal resubmitted with placementSource SELECTED_CANDIDATE (original token kept) is REJECTED', rejectedWith(forgedUp, 'PREVIEW_TOKEN_MISMATCH'));
    const forgedDown = await post(A, only('fl', (i) => { i.placementSource = 'FIXED_CONSTRAINT'; }));
    check('23/31. FORGED FLEXIBLE -> FIXED: a genuinely FLEXIBLE proposal resubmitted as FIXED_CONSTRAINT is REJECTED -- the timing-check bypass is closed', rejectedWith(forgedDown, 'PREVIEW_TOKEN_MISMATCH'));
    const tamperCases: [string, any][] = [
      ['24/32. start', only('fl', (i) => { i.start = new Date(new Date(i.start).getTime() + 15 * MIN).toISOString(); i.end = new Date(new Date(i.end).getTime() + 15 * MIN).toISOString(); })],
      ['25/33. end (duration 60 -> 30)', only('fl', (i) => { i.end = new Date(new Date(i.start).getTime() + 30 * MIN).toISOString(); })],
      ['26/34. intent id', only('fl', (i) => { i.intentId = 'fl-other'; })],
      ['16. title', only('fl', (i) => { i.title = 'Something else entirely'; })],
      ['16. activity id', only('fl', (i) => { i.activityId = 'meditation'; })],
      ['7. construction window end', only('fl', () => {}, (w) => { w.end = new Date(new Date(w.end).getTime() + HOUR).toISOString(); })],
      ['7. construction window source', only('fl', () => {}, (w) => { w.source = 'EXPLICIT_RANGE'; })],
    ];
    for (const [label, body] of tamperCases) {
      const r = await post(A, body);
      check(`${label}: tampering is REJECTED (INVALID_REQUEST / PREVIEW_TOKEN_MISMATCH)`, rejectedWith(r, 'PREVIEW_TOKEN_MISMATCH'));
    }
    const mutated = only('fl', (i) => { const [b, s] = i.acceptanceToken.split('.'); i.acceptanceToken = `${b}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`; });
    check('28/36. a mutated token is REJECTED (PREVIEW_TOKEN_INVALID)', rejectedWith(await post(A, mutated), 'PREVIEW_TOKEN_INVALID'));
    check('29/37. a MISSING token is REJECTED (PREVIEW_TOKEN_MISSING) -- no fallback to trusting placementSource', rejectedWith(await post(A, only('fl', (i) => { delete i.acceptanceToken; })), 'PREVIEW_TOKEN_MISSING'));
    const v2 = only('fl', (i) => { i.acceptanceToken = sign({ k: 'dc-preview-item', v: 2, f: [] }); });
    check('30/38. an unknown token version is REJECTED even when correctly signed', rejectedWith(await post(A, v2), 'PREVIEW_TOKEN_INVALID'));
    check('27/35. WRONG USER: user B submits user A\'s valid, untouched proposal and token -> REJECTED', rejectedWith(await post(B, base), 'PREVIEW_TOKEN_MISMATCH') && (await plansOf(B.U.id)).length === 0);
    check('27/35. WRONG USER (forged token): a token signed for A\'s facts but presented by B is rejected too', (await post(B, only('fl', () => {}))).status === 'REJECTED');
    const swapped = JSON.parse(JSON.stringify(base));
    const tokens = swapped.proposedItems.map((i: any) => i.acceptanceToken);
    swapped.proposedItems[0].acceptanceToken = tokens[1]; swapped.proposedItems[1].acceptanceToken = tokens[0];
    check('14/31. swapping tokens between two items of one preview is REJECTED for both', (await post(A, swapped)).status === 'REJECTED');
    const multi = JSON.parse(JSON.stringify(base));
    multi.clientRequestId = `integrity-m-${Date.now()}-${n++}`;
    multi.proposedItems.find((i: any) => i.intentId === 'fl').placementSource = 'FIXED_CONSTRAINT';
    const multiResult = await post(A, multi);
    check('31/39. MULTI-ITEM: tampering one item rejects the whole request -- nothing partial is persisted (the valid sibling is NOT created)', rejectedWith(multiResult, 'PREVIEW_TOKEN_MISMATCH') && (await plansOf(A.U.id)).length === countBefore);
    check('30. every forgery above wrote nothing: no PlannedActivity was inserted for user A', (await plansOf(A.U.id)).length === countBefore);
    const capForged = only('fx', (i) => { i.placementSource = 'SELECTED_CANDIDATE'; });
    capForged.captureLinks = [{ intentId: 'fx', captureId: cap.id }];
    const capResult = await post(A, capForged);
    const capRow = (await getCaptureWithLinkedPlanStatus(A.U.id, cap.id))!;
    check('30. a rejected forgery carrying a Capture link mutates no source link', capResult.status === 'REJECTED' && capRow.plannedActivityId === null);

    // ---- legitimate flows through the real routes ----
    const legit = await post(A, acceptBody(pv));
    const modeOf = (title: string) => legit.plans?.find((p: any) => p.title === title)?.schedulingMode;
    check('20. LEGITIMATE FIXED (real preview -> signed -> real accept): SAVED and persisted FIXED', legit.status === 'SAVED' && modeOf('Board meeting') === 'FIXED');
    check('21. LEGITIMATE FLEXIBLE (real preview -> signed -> real accept): SAVED and persisted FLEXIBLE', modeOf('Deep focus block') === 'FLEXIBLE');
    const rows = await plansOf(A.U.id);
    check('20/21. exactly the two reviewed plans exist with the verified modes', rows.length === countBefore + 2 && rows.filter((r) => r.title === 'Board meeting' && r.schedulingMode === 'FIXED').length === 1 && rows.filter((r) => r.title === 'Deep focus block' && r.schedulingMode === 'FLEXIBLE').length === 1);

    // ---- replay ----
    const freshPv = await preview(A, [{ id: 'rp', title: 'Replay target', durationMinutes: 30, flexibility: 'FIXED', fixedStart: new Date(fixedStart.getTime() + 3 * HOUR).toISOString() }]);
    if (!freshPv) throw new Error('replay preview failed');
    const replayOne = acceptBody(freshPv);
    const first = await post(A, replayOne);
    const identical = await post(A, replayOne);
    const forgedReplay = JSON.parse(JSON.stringify(replayOne)); forgedReplay.proposedItems[0].placementSource = 'SELECTED_CANDIDATE';
    const forgedReplayResult = await post(A, forgedReplay);
    const replayRows = (await plansOf(A.U.id)).filter((r) => r.title === 'Replay target');
    check('33/41. an identical replay returns the ORIGINAL plan (ALREADY_ACCEPTED, one row); a replay with altered authoritative facts is rejected by the integrity gate BEFORE idempotency and never rewrites the persisted mode', first.status === 'SAVED' && identical.status === 'ALREADY_ACCEPTED' && identical.plans[0].id === first.plans[0].id && rejectedWith(forgedReplayResult, 'PREVIEW_TOKEN_MISMATCH') && replayRows.length === 1 && replayRows[0].schedulingMode === 'FIXED');

    // ---- F1 injection protection is preserved ----
    const injectPv = await preview(A, [{ id: 'inj', title: 'Injection target', durationMinutes: 30, flexibility: 'FIXED', fixedStart: new Date(fixedStart.getTime() + 5 * HOUR).toISOString() }]);
    const injectBody = acceptBody(injectPv!);
    injectBody.proposedItems[0].schedulingMode = 'FLEXIBLE'; injectBody.schedulingMode = 'FLEXIBLE';
    const injected = await post(A, injectBody);
    check('34/42. a body schedulingMode is still inert even alongside a valid token: the verified FIXED placement persists FIXED', injected.status === 'SAVED' && injected.plans[0].schedulingMode === 'FIXED');

    // signPreviewItem is a server helper: a token minted for other facts cannot authorize these ones
    const stolen = signPreviewItem({ userId: A.U.id, window: pv.constructionWindow, item: { ...flexItem, placementSource: 'FIXED_CONSTRAINT' } });
    const stolenBody = only('fl', (i) => { i.acceptanceToken = stolen; });
    check('9/10. a validly signed token for DIFFERENT facts (a FIXED-marked twin) cannot authorize the FLEXIBLE item', rejectedWith(await post(A, stolenBody), 'PREVIEW_TOKEN_MISMATCH'));
  } finally {
    for (const id of users) {
      await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [id]).catch(() => {});
      await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [id]).catch(() => {});
      await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [id]).catch(() => {});
      await sql(`DELETE FROM "Capture" WHERE "userId" = $1`, [id]).catch(() => {});
      await sql(`DELETE FROM "PlanCreationIdempotency" WHERE "userId" = $1`, [id]).catch(() => {});
    }
  }
  if (!allPassed) { console.error('SOME PREVIEW INTEGRITY DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL PREVIEW INTEGRITY DB CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
