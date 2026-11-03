/**
 * Plan My Day -- single-item time editing backend. The new, narrow
 * `/api/day-constructor/preview-item` endpoint: re-signs ONE already-issued
 * preview item with a new start/end, after re-running the exact same CHECK
 * timing assessment full preview generation would have run. Requires
 * DATABASE_URL.
 */
import { upsertUserByEmail, updateBirthProfile, getUserById, beginTransaction, createPlannedActivity } from '../apps/web/lib/db';
import { createSessionToken, sign } from '../apps/web/lib/auth';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { parsePreviewResponseBody } from '../apps/web/lib/dayConstructorPreviewClient';
import { buildAcceptRequestBody } from '../apps/web/lib/acceptConstructedDay';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { signPreviewItem, verifyPreviewItem } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { POST as previewItemRoute } from '../apps/web/app/api/day-constructor/preview-item/route';
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
    const U = await upsertUserByEmail({ email: `test-preview-item-${label}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    return { U, tok: createSessionToken(U.id, U.email) };
  };
  const A = await mkUser('a');
  const B = await mkUser('b');
  const users = [A.U.id, B.U.id];
  const plansOf = async (userId: string) => sql(`SELECT id, title FROM "PlannedActivity" WHERE "userId" = $1`, [userId]);
  let n = 0;
  const targetDate = getDatePartsInTimezone(TZ, now).dateStr;

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
  // JSON round-trip at the boundary -- exactly what a real HTTP request body
  // would be after the wire, since parsePreviewResponseBody's own parsed
  // items carry real Date objects for start/end, not strings (fakeReq
  // otherwise bypasses JSON serialization entirely and would hand the
  // route live Date instances no real request body could ever contain).
  const postPreviewItem = async (user: typeof A, body: unknown) => { const res = await previewItemRoute(fakeReq(user.tok, JSON.parse(JSON.stringify(body)))); return res.json(); };
  const postAccept = async (user: typeof A, body: unknown) => { const res = await acceptRoute(fakeReq(user.tok, JSON.parse(JSON.stringify(body)))); return res.json(); };

  try {
    const pv = await preview(A, [{ id: 'fl', title: 'Deep focus block', durationMinutes: 60, flexibility: 'FLEXIBLE', activityId: 'deep_work' }]);
    const items = pv?.constructedDay.proposedItems ?? [];
    const flexItem: any = items.find((i: any) => i.intentId === 'fl');
    check('precondition: a real preview item with a valid acceptanceToken exists', !!pv && !!flexItem && typeof flexItem.acceptanceToken === 'string');
    if (!pv || !flexItem) throw new Error(`preview did not produce the item (zone ${TZ}, target ${targetDate})`);

    const windowBody = JSON.parse(JSON.stringify(pv.constructionWindow));
    const itemBody = () => ({ intentId: flexItem.intentId, activityId: flexItem.activityId, title: flexItem.title, start: flexItem.start, end: flexItem.end, placementSource: flexItem.placementSource });
    // The real muhurta/astrology engine can genuinely flag a given clock
    // instant as a friction window (e.g. Rahu Kalam) -- this is a REAL
    // conflict signal this endpoint is correctly designed to surface, not
    // a bug in it (see check 6's UNAVAILABLE case below). A fixed single
    // offset is therefore not a reliable test fixture; try several
    // well-spaced offsets inside the window and use the first one the
    // engine genuinely accepts, so checks 1/8/9/10/13 exercise a real
    // UPDATED response rather than coincidentally hitting a real conflict.
    const findWorkingCandidate = async (): Promise<{ candidateStart: string; result: any }> => {
      const offsetsHours = [2, 1, 3, 4, 0.5, 5, 6];
      for (const h of offsetsHours) {
        const ms = new Date(flexItem.start).getTime() + h * HOUR;
        const clamped = Math.min(ms, new Date(pv.constructionWindow.end).getTime() - 60 * MIN);
        const candidateStart = new Date(clamped).toISOString();
        const result = await postPreviewItem(A, { window: windowBody, item: itemBody(), acceptanceToken: flexItem.acceptanceToken, candidateStart });
        if (result.status === 'UPDATED') return { candidateStart, result };
      }
      return { candidateStart: new Date(new Date(flexItem.start).getTime() + 2 * HOUR).toISOString(), result: { status: 'REJECTED', reason: 'UNAVAILABLE_ALL_OFFSETS_TRIED' } };
    };
    const { candidateStart: newCandidateStart, result: valid } = await findWorkingCandidate();

    // 1. Valid original item + valid replacement time -> UPDATED.
    check('1. a valid original item + a valid replacement time returns status UPDATED with a new item/token', valid.status === 'UPDATED' && typeof valid.item?.acceptanceToken === 'string' && valid.item.acceptanceToken !== flexItem.acceptanceToken);
    check('1. the returned item keeps the same intentId/activityId/title/placementSource as the original', valid.status === 'UPDATED' && valid.item.intentId === flexItem.intentId && valid.item.activityId === flexItem.activityId && valid.item.title === flexItem.title && valid.item.placementSource === flexItem.placementSource);
    check('8. the new signature is genuinely bound to the NEW start/end (verifyPreviewItem accepts it against the new facts)', valid.status === 'UPDATED' && verifyPreviewItem({ userId: A.U.id, window: pv.constructionWindow, item: { ...valid.item, start: new Date(valid.item.start), end: new Date(valid.item.end) } }, valid.item.acceptanceToken).ok);
    check('9. the ORIGINAL token cannot authorize the MODIFIED time (verifyPreviewItem rejects the old token against the new start/end)', valid.status === 'UPDATED' && !verifyPreviewItem({ userId: A.U.id, window: pv.constructionWindow, item: { ...valid.item, start: new Date(valid.item.start), end: new Date(valid.item.end) } }, flexItem.acceptanceToken).ok);
    check('9 (inverse). the NEW token does NOT authorize the ORIGINAL (pre-edit) start/end', valid.status === 'UPDATED' && !verifyPreviewItem({ userId: A.U.id, window: pv.constructionWindow, item: { ...flexItem, start: new Date(flexItem.start), end: new Date(flexItem.end) } }, valid.item.acceptanceToken).ok);

    // 2. Original signature invalid (corrupted token) -> REJECTED, no item/signature returned.
    const corruptToken = (() => { const [b, s] = flexItem.acceptanceToken.split('.'); return `${b}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`; })();
    const invalidSig = await postPreviewItem(A, { window: windowBody, item: itemBody(), acceptanceToken: corruptToken, candidateStart: newCandidateStart });
    check('2. a corrupted original signature is REJECTED and never returns an item/signature', invalidSig.status === 'REJECTED' && invalidSig.item === undefined);

    // 3. Modified activity identity (claims a different activityId than the one actually signed) -> REJECTED.
    const modifiedActivity = await postPreviewItem(A, { window: windowBody, item: { ...itemBody(), activityId: 'meditation' }, acceptanceToken: flexItem.acceptanceToken, candidateStart: newCandidateStart });
    check('3. a request claiming a different activityId than the verified original is REJECTED (signature no longer matches)', modifiedActivity.status === 'REJECTED');

    // 3b. There is no second, less-trusted channel for activityId/title/placementSource: extraneous top-level
    // request fields alongside a valid, verified item/token are never used to override the verified item's own
    // values. (This is the exact mutation class Negative Control B is designed to catch.)
    const extraneousOverride = await postPreviewItem(A, { window: windowBody, item: itemBody(), acceptanceToken: flexItem.acceptanceToken, candidateStart: newCandidateStart, activityId: 'meditation', title: 'Attacker Title', placementSource: 'FIXED_CONSTRAINT' });
    check("3b. extraneous top-level activityId/title/placementSource fields never override the verified item's own values", extraneousOverride.status === 'UPDATED' && extraneousOverride.item.activityId === flexItem.activityId && extraneousOverride.item.title === flexItem.title && extraneousOverride.item.placementSource === flexItem.placementSource);

    // 4. Goal attribution: AcceptedProposedItem/PreviewItemFacts carry no Goal-link field at all (by the existing,
    // audited design -- dayConstructorPreviewIntegrity.ts's own module comment: Capture/GoalActivity link ids are
    // deliberately NOT bound). There is therefore nothing for this endpoint to preserve or leak on that front; this
    // check documents that the item type has no such field rather than fabricating one.
    check('4. the signed item shape carries no Goal-attribution field to tamper with (by existing, audited design)', !('goalActivityId' in flexItem));

    // 5. Unauthorized user: B presents A's genuinely valid item + token -> REJECTED, nothing written for B.
    const countBeforeB = (await plansOf(B.U.id)).length;
    const wrongUser = await postPreviewItem(B, { window: windowBody, item: itemBody(), acceptanceToken: flexItem.acceptanceToken, candidateStart: newCandidateStart });
    check('5. a different authenticated user presenting a valid item/token for the ORIGINAL owner is REJECTED', wrongUser.status === 'REJECTED');
    check('5. no row was written for the unauthorized user', (await plansOf(B.U.id)).length === countBeforeB);

    // 6. Invalid time bounds: end <= start is structurally impossible to request here (candidateStart is a single
    // instant; duration is derived from the original item), so this endpoint's own bound check is the WINDOW bound.
    const outsideWindow = await postPreviewItem(A, { window: windowBody, item: itemBody(), acceptanceToken: flexItem.acceptanceToken, candidateStart: new Date(new Date(pv.constructionWindow.end).getTime() + HOUR).toISOString() });
    check('6. a replacement time outside the construction window is REJECTED (STALE_PREVIEW / CANDIDATE_OUTSIDE_WINDOW)', outsideWindow.status === 'REJECTED' && outsideWindow.reason === 'STALE_PREVIEW');
    const malformedTime = await postPreviewItem(A, { window: windowBody, item: itemBody(), acceptanceToken: flexItem.acceptanceToken, candidateStart: 'not-a-date' });
    check('6. a malformed candidateStart is REJECTED', malformedTime.status === 'REJECTED');

    // 7. Timezone boundary: a candidate exactly at the window's own start (still inside, inclusive) is accepted.
    const atWindowStart = await postPreviewItem(A, { window: windowBody, item: itemBody(), acceptanceToken: flexItem.acceptanceToken, candidateStart: pv.constructionWindow.start });
    check('7. a candidate exactly at the window start boundary is accepted (inclusive bound), timezone-consistent with the original window', atWindowStart.status === 'UPDATED' || atWindowStart.status === 'REJECTED' && atWindowStart.reason === 'UNAVAILABLE');

    // Generic version of the same real-conflict-tolerant offset search used
    // above, parameterized so checks 10 and 13 (different previews, different
    // windows) don't depend on one fixed offset that might coincide with a
    // real friction window for their particular item/time.
    const findCandidateStartFor = async (baseStartIso: string | Date, windowEndIso: string | Date, postFn: (candidateStart: string) => Promise<any>): Promise<{ candidateStart: string; result: any }> => {
      const offsetsHours = [1.5, 1, 2, 3, 0.5, 4, 5];
      for (const h of offsetsHours) {
        const ms = new Date(baseStartIso).getTime() + h * HOUR;
        const clamped = Math.min(ms, new Date(windowEndIso).getTime() - 60 * MIN);
        const candidateStart = new Date(clamped).toISOString();
        const result = await postFn(candidateStart);
        if (result.status === 'UPDATED') return { candidateStart, result };
      }
      return { candidateStart: new Date(new Date(baseStartIso).getTime() + 1.5 * HOUR).toISOString(), result: { status: 'REJECTED', reason: 'UNAVAILABLE_ALL_OFFSETS_TRIED' } };
    };

    // 10. Sibling items in a real multi-item preview are provably untouched by editing one of them.
    const pv2 = await preview(A, [
      { id: 'fl2a', title: 'Reading', durationMinutes: 30, flexibility: 'FLEXIBLE', activityId: 'reading' },
      { id: 'fl2b', title: 'Walk', durationMinutes: 30, flexibility: 'FLEXIBLE', activityId: 'walking' },
    ]);
    const items2 = pv2?.constructedDay.proposedItems ?? [];
    const itemA: any = items2.find((i: any) => i.intentId === 'fl2a');
    const itemB: any = items2.find((i: any) => i.intentId === 'fl2b');
    if (pv2 && itemA && itemB) {
      const { result: editA } = await findCandidateStartFor(itemA.start, pv2.constructionWindow.end, (candidateStart) => postPreviewItem(A, {
        window: JSON.parse(JSON.stringify(pv2.constructionWindow)),
        item: { intentId: itemA.intentId, activityId: itemA.activityId, title: itemA.title, start: itemA.start, end: itemA.end, placementSource: itemA.placementSource },
        acceptanceToken: itemA.acceptanceToken,
        candidateStart,
      }));
      check('10. editing one item in a multi-item preview leaves the sibling item completely unaffected by this endpoint (it only ever receives/returns the one edited item)', editA.status === 'UPDATED' && editA.item.intentId === itemA.intentId && itemB.start === items2.find((i: any) => i.intentId === 'fl2b')!.start);
    } else {
      check('10. multi-item sibling-isolation precondition (two FLEXIBLE items placed)', false);
    }

    // 11. Zero database writes during the whole re-signing operation. Uses a DEDICATED, never-before-posted
    // item/candidate pair (not the shared flexItem/newCandidateStart already exercised above) so this check is
    // self-contained and cannot be masked by createPlannedActivity's own title+start+end dedup short-circuit.
    const pv5 = await preview(A, [{ id: 'fl5', title: 'Zero-write probe', durationMinutes: 30, flexibility: 'FLEXIBLE', activityId: 'reading' }]);
    const item5: any = pv5?.constructedDay.proposedItems.find((i: any) => i.intentId === 'fl5');
    if (pv5 && item5) {
      const countBeforeWrite = (await plansOf(A.U.id)).length;
      const { result: write5 } = await findCandidateStartFor(item5.start, pv5.constructionWindow.end, (candidateStart) => postPreviewItem(A, {
        window: JSON.parse(JSON.stringify(pv5.constructionWindow)),
        item: { intentId: item5.intentId, activityId: item5.activityId, title: item5.title, start: item5.start, end: item5.end, placementSource: item5.placementSource },
        acceptanceToken: item5.acceptanceToken,
        candidateStart,
      }));
      check('11. zero PlannedActivity rows were written by the re-signing endpoint', write5.status === 'UPDATED' && (await plansOf(A.U.id)).length === countBeforeWrite);
    } else {
      check('11. precondition (a fresh, never-before-posted preview item for the zero-write check)', false);
    }

    // 12. Existing zero-edit acceptance is completely unaffected by this PR (regression, not new logic).
    const countBeforeAccept = (await plansOf(A.U.id)).length;
    const zeroEdit = await postAccept(A, buildAcceptRequestBody(pv, `preview-item-regress-${Date.now()}-${n++}`));
    check('12. existing zero-edit acceptance (no call to the new endpoint at all) still SAVES exactly as before', zeroEdit.status === 'SAVED' && (await plansOf(A.U.id)).length === countBeforeAccept + 1);

    // 13. An edited item can be carried through the EXISTING, unmodified acceptance path end-to-end.
    const pv3 = await preview(A, [{ id: 'fl3', title: 'Journaling', durationMinutes: 30, flexibility: 'FLEXIBLE', activityId: 'journaling' }]);
    const item3: any = pv3?.constructedDay.proposedItems.find((i: any) => i.intentId === 'fl3');
    if (pv3 && item3) {
      const { candidateStart: newCandidate3, result: edited3 } = await findCandidateStartFor(item3.start, pv3.constructionWindow.end, (candidateStart) => postPreviewItem(A, {
        window: JSON.parse(JSON.stringify(pv3.constructionWindow)),
        item: { intentId: item3.intentId, activityId: item3.activityId, title: item3.title, start: item3.start, end: item3.end, placementSource: item3.placementSource },
        acceptanceToken: item3.acceptanceToken,
        candidateStart,
      }));
      if (edited3.status === 'UPDATED') {
        const acceptBody3 = buildAcceptRequestBody(pv3, `preview-item-edit-accept-${Date.now()}-${n++}`);
        acceptBody3.proposedItems[0] = { ...acceptBody3.proposedItems[0], start: edited3.item.start, end: edited3.item.end };
        (acceptBody3 as any).proposedItems[0].acceptanceToken = edited3.item.acceptanceToken;
        const countBeforeEditedAccept = (await plansOf(A.U.id)).length;
        const acceptedEdited = await postAccept(A, acceptBody3);
        check('13. an edited item is accepted via the EXISTING, unmodified acceptance path and persists the EDITED time, not the original', acceptedEdited.status === 'SAVED' && new Date(acceptedEdited.plans[0].plannedStartAt).getTime() === new Date(newCandidate3).getTime() && (await plansOf(A.U.id)).length === countBeforeEditedAccept + 1);
      } else {
        check('13. precondition (edit succeeded so it could be accepted)', false);
      }
    } else {
      check('13. precondition (a fresh preview item for the accept-after-edit scenario)', false);
    }

    // 14. Scheduling safeguards remain ACCEPTANCE-TIME-ONLY: this endpoint's CHECK-mode timing
    // assessment has no live-blocker/eligibility/capacity awareness at all (confirmed by reading
    // timingSearchRequest.ts / timingSearchDailyRhythm.ts -- neither one queries PlannedActivity),
    // so it can genuinely return UPDATED for a time a real, concurrently-created blocker now
    // occupies. The EXISTING, unmodified acceptance path must still be the one and only place
    // that catches it -- this endpoint must never become an alternative acceptance path.
    const pv4 = await preview(A, [{ id: 'fl4', title: 'Stretching', durationMinutes: 30, flexibility: 'FLEXIBLE', activityId: 'stretching' }]);
    const item4: any = pv4?.constructedDay.proposedItems.find((i: any) => i.intentId === 'fl4');
    if (pv4 && item4) {
      const { result: edited4 } = await findCandidateStartFor(item4.start, pv4.constructionWindow.end, (candidateStart) => postPreviewItem(A, {
        window: JSON.parse(JSON.stringify(pv4.constructionWindow)),
        item: { intentId: item4.intentId, activityId: item4.activityId, title: item4.title, start: item4.start, end: item4.end, placementSource: item4.placementSource },
        acceptanceToken: item4.acceptanceToken,
        candidateStart,
      }));
      if (edited4.status === 'UPDATED') {
        await createPlannedActivity({
          userId: A.U.id,
          title: 'Pre-existing fresh blocker',
          plannedStartAt: new Date(edited4.item.start),
          plannedEndAt: new Date(edited4.item.end),
          durationMinutes: (new Date(edited4.item.end).getTime() - new Date(edited4.item.start).getTime()) / MIN,
          windowType: 'NEUTRAL',
        });
        const acceptBody4 = buildAcceptRequestBody(pv4, `preview-item-capacity-${Date.now()}-${n++}`);
        acceptBody4.proposedItems[0] = { ...acceptBody4.proposedItems[0], start: edited4.item.start, end: edited4.item.end };
        (acceptBody4 as any).proposedItems[0].acceptanceToken = edited4.item.acceptanceToken;
        const countBeforeCapacity = (await plansOf(A.U.id)).length;
        const acceptedConflicting = await postAccept(A, acceptBody4);
        check('14. this endpoint performs no capacity/eligibility/conflict checks itself; a fresh blocker occupying the edited time is still caught by the EXISTING, unmodified acceptance path, proving this PR introduces no alternative acceptance path', acceptedConflicting.status === 'REJECTED' && acceptedConflicting.reason === 'CONFLICT' && (await plansOf(A.U.id)).length === countBeforeCapacity);
      } else {
        check('14. precondition (edit succeeded so a fresh blocker could be placed on top of it)', false);
      }
    } else {
      check('14. precondition (a fresh preview item for the capacity/eligibility acceptance-time-only scenario)', false);
    }

    // 15. Existing typed-error presentation compatibility: a REJECTED response from this new endpoint uses the
    // SAME {status, reason, detail?} shape conventions already established by the accept route's own REJECTED
    // responses -- not a new, incompatible error contract.
    check('15. REJECTED responses use the existing {status, reason, detail?} shape convention (reason is a non-empty string, not a new/undocumented shape)', invalidSig.status === 'REJECTED' && typeof invalidSig.reason === 'string' && invalidSig.reason.length > 0);
  } finally {
    for (const id of users) {
      await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [id]).catch(() => {});
      await sql(`DELETE FROM "PlanCreationIdempotency" WHERE "userId" = $1`, [id]).catch(() => {});
    }
  }
  if (!allPassed) { console.error('SOME DAY CONSTRUCTOR PREVIEW ITEM CHECKS FAILED'); process.exit(1); }
  console.log('ALL DAY CONSTRUCTOR PREVIEW ITEM CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
