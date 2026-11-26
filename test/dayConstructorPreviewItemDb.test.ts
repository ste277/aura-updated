/**
 * Plan My Day -- single-item time editing backend. The new, narrow
 * `/api/day-constructor/preview-item` endpoint: re-signs ONE already-issued
 * preview item with a new start/end, after re-running the exact same CHECK
 * timing assessment full preview generation would have run. Requires
 * DATABASE_URL.
 */
import { upsertUserByEmail, updateUserLocation, updateBirthProfile, getUserById, beginTransaction, createPlannedActivity } from '../apps/web/lib/db';
import { createSessionToken, sign } from '../apps/web/lib/auth';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { parsePreviewResponseBody } from '../apps/web/lib/dayConstructorPreviewClient';
import { buildAcceptRequestBody } from '../apps/web/lib/acceptConstructedDay';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { signPreviewItem, verifyPreviewItem } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { POST as previewItemRoute } from '../apps/web/app/api/day-constructor/preview-item/route';
import { POST as acceptRoute } from '../apps/web/app/api/day-constructor/accept/route';
import { resolveTzOffsetMinutes } from '../apps/web/lib/timezone';
import { computeAssistantWindows } from '../packages/recommendation/src/dailyAssistant';
import { addCivilDays, fixtureAnchorMonday, realClockReferenceForFixture } from './lifecycleFixtureCalendar';

/*
 * AURA-CI-08 -- deterministic fixture.
 *
 * WHY. This suite used to pick the user's timezone from the wall clock (the first zone where it was 01:00-08:00 local), keep Chennai's coordinates,
 * build a REMAINING_TODAY window, and try a fixed list of replacement offsets from wherever the preview happened to place the item. At about
 * 11:55-12:49Z the chosen zone is Pacific/Kiritimati (UTC+14). At 12:20Z the preview placed the 60-minute item at 06:35Z, the window ended at
 * Kiritimati midnight (10:00Z), and every fixed offset clamped into 07:05-09:00Z -- all overlapping that Friday's genuine Yama Gandam
 * (07:53-09:19Z). The engine correctly returned FRICTION_WINDOW_BLOCKED for every candidate, so checks 1/8/9/9-inverse/3b failed with no defect.
 *
 * THE FIX. (a) The fixture timezone is pinned and consistent with the user's coordinates. (b) The target day is a future EXPLICIT_RANGE day anchored
 * with the lifecycleFixtureCalendar convention, so the run's time of day never shrinks or shifts the window. (c) Replacement times are not guessed:
 * one is derived from the day's own timing windows (clear of Rahu Kalam, Yama Gandam and Gulika Kalam), independently of the endpoint's response,
 * and the route must then return UPDATED for it. (d) A legitimate rejection is asserted too: a candidate wholly inside Rahu Kalam or Yama Gandam is refused.
 * Panchangam eligibility is never bypassed: the route still assesses every candidate itself.
 */
// Test-only repeatability-matrix hooks; never set in CI. Each zone is paired with a city inside it, so solar times match the clock.
const FIXTURE_ZONES: Record<string, { cityName: string; latitude: number; longitude: number }> = {
  'Asia/Kolkata': { cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707 },
  'America/New_York': { cityName: 'New York', latitude: 40.7128, longitude: -74.006 },
  'Europe/London': { cityName: 'London', latitude: 51.5074, longitude: -0.1278 },
  'Australia/Sydney': { cityName: 'Sydney', latitude: -33.8688, longitude: 151.2093 },
  'America/Los_Angeles': { cityName: 'Los Angeles', latitude: 34.0522, longitude: -118.2437 },
  'Pacific/Kiritimati': { cityName: 'Kiritimati', latitude: 1.87, longitude: -157.4 },
};
const TZ = process.env.PREVIEW_ITEM_FIXTURE_TIMEZONE ?? 'Asia/Kolkata';
const PLACE = FIXTURE_ZONES[TZ];
if (!PLACE) throw new Error(`PREVIEW_ITEM_FIXTURE_TIMEZONE must be one of ${Object.keys(FIXTURE_ZONES).join(', ')}`);
// Day offset from the anchor Monday (0 = Monday .. 6 = Sunday); default Tuesday, the lifecycleFixtureCalendar convention used by CI-07.
const DAY_OFFSET = Number(process.env.PREVIEW_ITEM_FIXTURE_DAY_OFFSET ?? '1');
if (!Number.isInteger(DAY_OFFSET) || DAY_OFFSET < 0 || DAY_OFFSET > 6) throw new Error('PREVIEW_ITEM_FIXTURE_DAY_OFFSET must be an integer 0..6');
const WINDOW_START_MINUTE = 6 * 60;
const WINDOW_END_MINUTE = 21 * 60;
const GRID_MINUTES = 15;

/** The instant at `minute` past local midnight of civil `date` in `tz` (iterated so DST days resolve correctly). */
function localInstant(date: string, minute: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d) + minute * 60000;
  let t = wall;
  for (let i = 0; i < 3; i += 1) t = wall - resolveTzOffsetMinutes(tz, new Date(t)) * 60000;
  return new Date(t);
}

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
async function main() {
  const mkUser = async (label: string) => {
    const existing = await upsertUserByEmail({ email: `test-preview-item-${label}@example.com`, cityName: PLACE.cityName, latitude: PLACE.latitude, longitude: PLACE.longitude, timezone: TZ });
    // upsertUserByEmail returns an EXISTING row unchanged, so on a reused database the stored location could be another run's; pin it explicitly.
    const U = await updateUserLocation(existing.id, { cityName: PLACE.cityName, latitude: PLACE.latitude, longitude: PLACE.longitude, timezone: TZ });
    await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: PLACE.cityName, birthLatitude: PLACE.latitude, birthLongitude: PLACE.longitude, birthTimezone: TZ });
    return { U, tok: createSessionToken(U.id, U.email) };
  };
  const A = await mkUser('a');
  const B = await mkUser('b');
  const users = [A.U.id, B.U.id];
  const plansOf = async (userId: string) => sql(`SELECT id, title FROM "PlannedActivity" WHERE "userId" = $1`, [userId]);
  let n = 0;
  // The ONE wall-clock read: it only places the fixture day in the future (lifecycleFixtureCalendar); no assertion depends on the time of day.
  const targetDate = addCivilDays(fixtureAnchorMonday(realClockReferenceForFixture(), TZ), DAY_OFFSET);
  const explicitStart = localInstant(targetDate, WINDOW_START_MINUTE, TZ).toISOString();
  const explicitEnd = localInstant(targetDate, WINDOW_END_MINUTE, TZ).toISOString();
  if (getDatePartsInTimezone(TZ, new Date(explicitStart)).dateStr !== targetDate) throw new Error(`fixture window does not start on ${targetDate} in ${TZ}`);

  // The target day's own Panchangam timing windows, from the same engine function the route's CHECK assessment uses (computeAssistantWindows),
  // as absolute instants. Rahu Kalam and Yama Gandam are the engine's friction windows; Gulika Kalam is additionally an inauspicious
  // COMMENCEMENT window for start-sensitive activities (Inauspicious Period Precedence Fix V1). A replacement clear of all three is the
  // fixture's "valid replacement window"; a start wholly inside Rahu Kalam / Yama Gandam is its "legitimate rejection".
  type Slot = { start: Date; end: Date };
  const dayWindows = (() => {
    const noon = localInstant(targetDate, 12 * 60, TZ);
    const spans = computeAssistantWindows({ now: noon, latitude: PLACE.latitude, longitude: PLACE.longitude, timezone: TZ, tzOffsetMinutes: resolveTzOffsetMinutes(TZ, noon) } as any);
    return spans.map((s: any) => ({ type: s.type as string, start: localInstant(targetDate, s.startMinutes, TZ), end: localInstant(targetDate, s.endMinutes, TZ) }));
  })();
  const INAUSPICIOUS = new Set(['RAHU_KALAM', 'YAMA', 'GULIKA']);
  const overlaps = (t: number, durationMs: number, s: Slot) => t < s.end.getTime() && t + durationMs > s.start.getTime();
  // First grid start inside the construction window that differs from the item's own start, avoids `busy`, and overlaps none of the day's
  // inauspicious windows. Derived from the timing windows alone -- never from the endpoint's own response. No fallback: if the fixture day had
  // no such slot the suite fails loudly instead of guessing.
  const eligibleReplacement = (item: any, window: { start: Date | string; end: Date | string }, busy: Slot[] = []): string => {
    const durationMs = new Date(item.end).getTime() - new Date(item.start).getTime();
    const windowStart = new Date(window.start).getTime();
    const windowEnd = new Date(window.end).getTime();
    for (let t = windowStart; t + durationMs <= windowEnd; t += GRID_MINUTES * MIN) {
      if (t === new Date(item.start).getTime()) continue;
      if (busy.some((b) => overlaps(t, durationMs, b))) continue;
      if (dayWindows.some((w) => INAUSPICIOUS.has(w.type) && overlaps(t, durationMs, w))) continue;
      return new Date(t).toISOString();
    }
    throw new Error(`no replacement slot clear of Rahu Kalam / Yama Gandam / Gulika Kalam for ${item.intentId} on ${targetDate} (${TZ})`);
  };
  // A start wholly inside the day's Rahu Kalam or Yama Gandam and inside the construction window.
  const frictionCandidate = (item: any, window: { start: Date | string; end: Date | string }): { start: string; type: string } => {
    const durationMs = new Date(item.end).getTime() - new Date(item.start).getTime();
    for (const w of dayWindows.filter((x) => x.type === 'RAHU_KALAM' || x.type === 'YAMA')) {
      if (w.end.getTime() - w.start.getTime() < durationMs) continue;
      if (w.start.getTime() >= new Date(window.start).getTime() && w.start.getTime() + durationMs <= new Date(window.end).getTime()) return { start: w.start.toISOString(), type: w.type };
    }
    throw new Error(`no Rahu Kalam / Yama Gandam span long enough for ${item.intentId} inside the window on ${targetDate} (${TZ})`);
  };

  const preview = async (user: typeof A, intents: unknown[]) => {
    const result = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId: user.U.id }),
      getUser: (id) => getUserById(id),
      getBody: async () => ({ targetDate, constructionWindowSource: 'EXPLICIT_RANGE', explicitStart, explicitEnd, intents }),
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
    // The real muhurta engine genuinely refuses instants in inauspicious windows -- a REAL conflict this endpoint must surface (check 6b). The
    // replacement time is therefore chosen from the day's timing windows (eligibleReplacement), and the route is then required to return UPDATED
    // for exactly that time -- one request, no retry loop, no fallback.
    const newCandidateStart = eligibleReplacement(flexItem, pv.constructionWindow);
    const valid = await postPreviewItem(A, { window: windowBody, item: itemBody(), acceptanceToken: flexItem.acceptanceToken, candidateStart: newCandidateStart });

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

    // 6b. Legitimate Panchangam rejection: a candidate wholly inside the day's Rahu Kalam or Yama Gandam is refused as UNAVAILABLE /
    // FRICTION_WINDOW_BLOCKED, and nothing is signed. Asserted on the "Deep focus block" item: the engine blocks friction windows by task
    // significance (scoreCandidate), and low-significance tasks such as Reading/Walk are legitimately NOT blocked there, so they are not used here.
    const friction = frictionCandidate(flexItem, pv.constructionWindow);
    const inFriction = await postPreviewItem(A, { window: windowBody, item: itemBody(), acceptanceToken: flexItem.acceptanceToken, candidateStart: friction.start });
    check(`6b. a replacement time wholly inside ${friction.type} is REJECTED as UNAVAILABLE / FRICTION_WINDOW_BLOCKED and never returns an item/signature`, inFriction.status === 'REJECTED' && inFriction.reason === 'UNAVAILABLE' && inFriction.detail === 'FRICTION_WINDOW_BLOCKED' && inFriction.item === undefined);

    // Checks 10/11/13/14 choose their replacement time the same way (eligibleReplacement) and then require the route to return UPDATED for it.
    // `busy` (optional): plans this user ALREADY has. This endpoint is blocker-unaware by design (see check 14), so an edited time it returns
    // UPDATED for can still overlap a plan an earlier check saved; a check that then expects acceptance to SAVE must not pick such a time, or
    // the acceptance path correctly rejects it as a CONFLICT (AURA-CI-01).
    const editTo = async (pvX: any, itemX: any, busy?: Slot[]): Promise<{ candidateStart: string; result: any }> => {
      const candidateStart = eligibleReplacement(itemX, pvX.constructionWindow, busy);
      const result = await postPreviewItem(A, {
        window: JSON.parse(JSON.stringify(pvX.constructionWindow)),
        item: { intentId: itemX.intentId, activityId: itemX.activityId, title: itemX.title, start: itemX.start, end: itemX.end, placementSource: itemX.placementSource },
        acceptanceToken: itemX.acceptanceToken,
        candidateStart,
      });
      return { candidateStart, result };
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
      const { result: editA } = await editTo(pv2, itemA);
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
      const { result: write5 } = await editTo(pv5, item5);
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
      // Check 12 has just SAVED a plan for A; the edited time must not land on it.
      const busy3 = (await sql(`SELECT "plannedStartAt" AS start, "plannedEndAt" AS end FROM "PlannedActivity" WHERE "userId" = $1`, [A.U.id])).map((r: any) => ({ start: new Date(r.start), end: new Date(r.end) }));
      const { candidateStart: newCandidate3, result: edited3 } = await editTo(pv3, item3, busy3);
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
      const { result: edited4 } = await editTo(pv4, item4);
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
