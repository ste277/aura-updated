/**
 * Remaining-Day Recomposition V1 PR F4 -- Home recomposition experience: parsers, the state machine, the store's
 * async races (generation guards, late accept, lost response), the atomic multi-move projection, the presentational
 * card, and structural wiring/trust-boundary checks. F2/F3 own the scheduling and the mutation (their own suites).
 */
import fs from 'fs';
import path from 'path';
import {
  createRecompositionStore,
  initialRecompositionState,
  keepSummary,
  parseAcceptResponse,
  parseRecomposeResponse,
  presentMove,
  recompositionReducer,
  shouldOfferRecomposition,
  sourcesObservedMoved,
  unresolvedText,
  withConfirmedMoves,
  withMovedSources,
  type ConfirmedMove,
  type RecompositionState,
  type RecompositionStoreDeps,
  type RecompositionView,
} from '../apps/web/lib/homeRecomposition';
import { applyConfirmedSuccessors, hideMovedTimelineItems } from '../apps/web/lib/homeMove';
import { overlayExecutionFacts, type ExecutionOutcome } from '../apps/web/lib/homeCompletion';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import type { PlannedActivity } from '../apps/web/lib/db';

/**
 * HOW TO RUN: the card is a .tsx component, so (like homeDashboardGoodRightNow.test.ts) this needs the JSX config:
 *   npx ts-node -P tsconfig.test-jsx.json test/homeRecomposition.test.ts
 * React is loaded through the web app's own node_modules (the root project has none), by a runtime require so the
 * root tsc project never has to compile the .tsx file.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const React = require('../apps/web/node_modules/react');
const { renderToStaticMarkup } = require('../apps/web/node_modules/react-dom/server');
const { RecompositionCard } = require('../apps/web/components/RecompositionCard');

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const TZ = 'Asia/Kolkata';
const atDay = (d: number, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2026, 7, d, h, m) - 330 * 60000); };
const at = (hhmm: string) => atDay(24, hhmm);
const NOW = at('09:00');

// ---- fixtures ---------------------------------------------------------------------------------------------------

const slot = (from: string, to: string) => ({ start: at(from).toISOString(), end: at(to).toISOString() });
const keepD = (id: string, title: string, from: string, to: string) => ({ decision: 'KEEP', planId: id, title, current: slot(from, to), reason: 'NO_STRICT_IMPROVEMENT', evidence: { currentTier: 'BEST', alternative: { kind: 'NONE' } } });
const moveD = (id: string, title: string, from: string, to: string, nf: string, nt: string) => ({ decision: 'MOVE', planId: id, title, current: slot(from, to), to: slot(nf, nt), durationMinutes: 60, reason: 'BETTER_TIMING_TIER', evidence: { currentTier: 'CAUTION', proposedTier: 'BEST', currentSlotInvalid: undefined } });
const unresD = (id: string, title: string, from: string, to: string) => ({ decision: 'UNRESOLVED', planId: id, title, current: slot(from, to), reason: 'CURRENT_SLOT_INVALID_NO_ALTERNATIVE', evidence: { currentTier: null, currentSlotInvalid: 'BLOCKED_OR_UNAVAILABLE' } });
const ready = (state: string, decisions: unknown[], token?: string) => ({ status: 'READY', proposal: { generatedAt: NOW.toISOString(), targetDate: '2026-08-24', timezone: TZ, decisions, protectedPlans: [{ planId: 'p', title: 'x', reason: 'SCHEDULING_MODE_NOT_FLEXIBLE' }], summary: { state, moveCount: 0, keepCount: 0, unresolvedCount: 0, placementRuns: 3 } }, ...(token ? { proposalToken: token } : {}) });
const changes3 = () => ready('CHANGES_PROPOSED', [moveD('A', 'Finish presentation', '10:00', '11:00', '14:00', '15:00'), moveD('B', 'Call the bank', '11:00', '12:00', '15:00', '16:00'), moveD('C', 'Review notes', '12:00', '13:00', '16:00', '17:00'), keepD('K1', 'Lunch', '13:00', '14:00'), keepD('K2', 'Walk', '17:00', '18:00')], 'signed.token.1');

const plan = (id: string, title: string, start: Date, end: Date, status: PlannedActivity['status'] = 'UPCOMING'): PlannedActivity => ({ id, userId: 'u1', title, activityType: 'x', icon: null, status, plannedStartAt: start, plannedEndAt: end, durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000), windowType: 'NEUTRAL', windowLabel: null, matchLabel: null, score: null, recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: start, updatedAt: start }) as PlannedActivity;
const wirePlan = (id: string, title: string, from: string, to: string, source: string) => ({ ...plan(id, title, at(from), at(to)), rescheduledFromPlanId: source, plannedStartAt: at(from).toISOString(), plannedEndAt: at(to).toISOString() });
const acceptedBody = (status: 'ACCEPTED' | 'ALREADY_ACCEPTED' = 'ACCEPTED') => ({
  status,
  targetDate: '2026-08-24',
  moves: [
    { sourcePlanId: 'A', successorPlanId: 'A2', from: slot('10:00', '11:00'), to: slot('14:00', '15:00'), successor: wirePlan('A2', 'Finish presentation', '14:00', '15:00', 'A') },
    { sourcePlanId: 'B', successorPlanId: 'B2', from: slot('11:00', '12:00'), to: slot('15:00', '16:00'), successor: wirePlan('B2', 'Call the bank', '15:00', '16:00', 'B') },
    { sourcePlanId: 'C', successorPlanId: 'C2', from: slot('12:00', '13:00'), to: slot('16:00', '17:00'), successor: wirePlan('C2', 'Review notes', '16:00', '17:00', 'C') },
  ],
});

// ---- fake transport ---------------------------------------------------------------------------------------------

interface Call { url: string; init?: RequestInit }
type Reply = { ok: boolean; status?: number; body: unknown } | 'THROW' | 'DEFER';
function makeHarness(script: { recompose?: Reply[]; accept?: Reply[]; observe?: boolean[] }) {
  const calls: Call[] = [];
  const deferred: Array<(r: { ok: boolean; body: unknown } | 'THROW') => void> = [];
  const projected: ConfirmedMove[][] = [];
  const events: string[] = [];
  let reconciles = 0;
  const queues = { recompose: [...(script.recompose ?? [])], accept: [...(script.accept ?? [])] };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const reply = queues[url.endsWith('/accept') ? 'accept' : 'recompose'].shift();
    if (!reply) throw new Error('unscripted request ' + url);
    const settle = (r: { ok: boolean; body: unknown } | 'THROW') => {
      if (r === 'THROW') throw new TypeError('network');
      return { ok: r.ok, json: async () => r.body } as unknown as Response;
    };
    if (reply === 'DEFER') return new Promise<Response>((resolve, reject) => deferred.push((r) => { try { resolve(settle(r)); } catch (e) { reject(e); } }));
    return settle(reply === 'THROW' ? 'THROW' : reply);
  }) as unknown as typeof fetch;
  const observe = [...(script.observe ?? [])];
  const deps: RecompositionStoreDeps = {
    fetchImpl,
    applyConfirmedMoves: (moves) => { projected.push(moves); events.push('project'); },
    reconcile: async () => { reconciles += 1; events.push('reconcile'); },
    observeMovedSources: async () => { events.push('observe'); return observe.shift() ?? false; },
  };
  const store = createRecompositionStore(deps);
  const states: RecompositionState[] = [];
  store.subscribe((s) => { states.push(s); events.push('state:' + s.phase + (s.phase === 'IDLE' && s.updated ? '+updated' : '')); });
  return { store, calls, deferred, projected, events, states, reconciles: () => reconciles };
}
const okRes = (body: unknown) => ({ ok: true, body });
const errRes = (body: unknown) => ({ ok: false, body });

async function main() {
  // ============================ parsing (F2) ============================
  const p = (body: unknown, ok = true) => parseRecomposeResponse(ok, body);
  const viewOf = (o: ReturnType<typeof parseRecomposeResponse>) => (o.kind === 'VIEW' ? o.view : null);

  const proposal = viewOf(p({ ...changes3() }));
  check('47/48. CHANGES_PROPOSED parses to 3 moves, 2 keeps and the signed token (only presentable fields kept)', proposal?.kind === 'CHANGES_PROPOSED' && proposal.moves.length === 3 && proposal.keepCount === 2 && proposal.proposalToken === 'signed.token.1' && proposal.unresolved.length === 0);
  check('5. no evidence/tier/protected-plan/scheduling field survives parsing', !/evidence|Tier|BEST|CAUTION|protected|reason|SCHEDULING/i.test(JSON.stringify(proposal)));
  check('47. NO_CHANGES parses (no token needed)', viewOf(p(ready('NO_CHANGES', [keepD('K', 'Lunch', '13:00', '14:00')])))?.kind === 'NO_CHANGES');
  const needs = viewOf(p(ready('NEEDS_ATTENTION', [unresD('U', 'Dentist', '10:00', '11:00'), keepD('K', 'Lunch', '13:00', '14:00')])));
  check('47. NEEDS_ATTENTION parses with its unresolved rows and no token', needs?.kind === 'NEEDS_ATTENTION' && needs.unresolved.length === 1 && needs.keepCount === 1 && !JSON.stringify(needs).includes('proposalToken'));
  check('47. NO_USABLE_CAPACITY parses to its own view', viewOf(p({ status: 'NO_USABLE_CAPACITY' }))?.kind === 'NO_USABLE_CAPACITY');
  check('47. TIMING_FAILED is a retryable failure outcome, not a view', p({ status: 'TIMING_FAILED', reason: 'x' }).kind === 'TIMING_FAILED');
  const bad: Array<[string, unknown, boolean?]> = [
    ['non-2xx', changes3(), false],
    ['null body', null],
    ['string body', 'x'],
    ['array body', []],
    ['unknown status', { status: 'MAYBE' }],
    ['TIMEZONE_MISSING', { status: 'TIMEZONE_MISSING' }],
    ['INVALID_REQUEST', { status: 'INVALID_REQUEST', reason: 'x' }],
    ['READY without proposal', { status: 'READY' }],
    ['unknown summary state', ready('WEIRD', [])],
    ['decisions not an array', { ...ready('NO_CHANGES', []), proposal: { summary: { state: 'NO_CHANGES' }, decisions: 'x' } }],
    ['unknown decision kind', ready('NO_CHANGES', [{ decision: 'TELEPORT', planId: 'x', title: 't', current: slot('10:00', '11:00') }])],
    ['MOVE without destination', ready('CHANGES_PROPOSED', [{ ...moveD('A', 'a', '10:00', '11:00', '14:00', '15:00'), to: undefined }], 'tok')],
    ['MOVE with unparseable time', ready('CHANGES_PROPOSED', [{ ...moveD('A', 'a', '10:00', '11:00', '14:00', '15:00'), to: { start: 'soon', end: 'later' } }], 'tok')],
    ['CHANGES_PROPOSED without token', ready('CHANGES_PROPOSED', [moveD('A', 'a', '10:00', '11:00', '14:00', '15:00')])],
    ['CHANGES_PROPOSED without a MOVE', ready('CHANGES_PROPOSED', [keepD('K', 'k', '10:00', '11:00')], 'tok')],
    ['NO_CHANGES that contains a MOVE', ready('NO_CHANGES', [moveD('A', 'a', '10:00', '11:00', '14:00', '15:00')])],
    ['NEEDS_ATTENTION without unresolved', ready('NEEDS_ATTENTION', [keepD('K', 'k', '10:00', '11:00')])],
    ['duplicate plan ids', ready('CHANGES_PROPOSED', [moveD('A', 'a', '10:00', '11:00', '14:00', '15:00'), keepD('A', 'a', '10:00', '11:00')], 'tok')],
    ['empty token', ready('CHANGES_PROPOSED', [moveD('A', 'a', '10:00', '11:00', '14:00', '15:00')], '')],
  ];
  // an empty-string token is dropped by the fixture helper, which is exactly "no token"
  check('5. every malformed/unknown/inconsistent F2 response fails closed to ERROR: ' + bad.map(([n]) => n).join(', '), bad.every(([, body, ok]) => p(body, ok ?? true).kind === 'ERROR'));

  // ============================ parsing (F3) ============================
  const expected = ['A', 'B', 'C'];
  const acc = parseAcceptResponse(true, acceptedBody(), expected);
  check('19. ACCEPTED parses every source -> successor mapping; successor times become Dates', acc.kind === 'COMMITTED' && !acc.alreadyAccepted && acc.moves.length === 3 && acc.moves[0].successor.plannedStartAt instanceof Date && acc.moves.map((m) => m.successor.id).join() === 'A2,B2,C2');
  check('21. ALREADY_ACCEPTED parses as a committed result', (() => { const r = parseAcceptResponse(true, acceptedBody('ALREADY_ACCEPTED'), expected); return r.kind === 'COMMITTED' && r.alreadyAccepted && r.moves.length === 3; })());
  check('24-26. STALE / INVALID_TOKEN / SAVE_FAILED parse from their non-2xx bodies', parseAcceptResponse(false, { status: 'STALE', reason: 'CONFLICT' }, expected).kind === 'STALE' && parseAcceptResponse(false, { status: 'INVALID_TOKEN' }, expected).kind === 'INVALID_TOKEN' && parseAcceptResponse(false, { status: 'SAVE_FAILED' }, expected).kind === 'SAVE_FAILED');
  const unknownBodies: Array<[string, boolean, unknown]> = [
    ['401', false, { error: 'Not authenticated.' }],
    ['html 500', false, null],
    ['unparseable 200', true, null],
    ['200 without moves', true, { status: 'ACCEPTED', moves: [] }],
    ['200 with unknown status', true, { status: 'DONE', moves: acceptedBody().moves }],
    ['ACCEPTED on a non-2xx', false, acceptedBody()],
    ['STALE on a 200', true, { status: 'STALE' }],
    ['successor not UPCOMING', true, { ...acceptedBody(), moves: [{ ...acceptedBody().moves[0], successor: { ...acceptedBody().moves[0].successor, status: 'LOGGED' } }, acceptedBody().moves[1], acceptedBody().moves[2]] }],
    ['successor id mismatch', true, { ...acceptedBody(), moves: [{ ...acceptedBody().moves[0], successorPlanId: 'ZZ' }, acceptedBody().moves[1], acceptedBody().moves[2]] }],
    ['successor equals source', true, { ...acceptedBody(), moves: [{ ...acceptedBody().moves[0], successorPlanId: 'A', successor: { ...acceptedBody().moves[0].successor, id: 'A' } }, acceptedBody().moves[1], acceptedBody().moves[2]] }],
    ['unparseable successor time', true, { ...acceptedBody(), moves: [{ ...acceptedBody().moves[0], successor: { ...acceptedBody().moves[0].successor, plannedStartAt: 'x' } }, acceptedBody().moves[1], acceptedBody().moves[2]] }],
    ['duplicate source', true, { ...acceptedBody(), moves: [acceptedBody().moves[0], acceptedBody().moves[0], acceptedBody().moves[2]] }],
    ['mapping does not match the proposal', true, { ...acceptedBody(), moves: acceptedBody().moves.slice(0, 2) }],
  ];
  check('27. anything without a trustworthy answer is UNKNOWN (never a failure claim): ' + unknownBodies.map(([n]) => n).join(', '), unknownBodies.every(([, ok, body]) => parseAcceptResponse(ok, body, expected).kind === 'UNKNOWN'));

  // ============================ reducer ============================
  const view3 = proposal as RecompositionView;
  const R = recompositionReducer;
  let s: RecompositionState = initialRecompositionState;
  check('44. initial state is IDLE (nothing offered, generation 0)', s.phase === 'IDLE' && !s.updated && s.generation === 0);
  s = R(s, { type: 'REQUEST_STARTED' });
  check('44. IDLE -> LOADING bumps the generation', s.phase === 'LOADING' && s.generation === 1);
  const loading = s;
  check('44. LOADING -> PROPOSAL on a current VIEW outcome', (() => { const n = R(loading, { type: 'REQUEST_RESOLVED', generation: 1, outcome: { kind: 'VIEW', view: view3 } }); return n.phase === 'PROPOSAL' && n.notice === null; })());
  check('44. LOADING -> ERROR (TIMING_FAILED / GENERIC) on failure outcomes', (() => { const a = R(loading, { type: 'REQUEST_RESOLVED', generation: 1, outcome: { kind: 'TIMING_FAILED' } }); const b = R(loading, { type: 'REQUEST_RESOLVED', generation: 1, outcome: { kind: 'ERROR' } }); return a.phase === 'ERROR' && a.error === 'TIMING_FAILED' && b.phase === 'ERROR' && b.error === 'GENERIC'; })());
  check('44. a response for an old generation never applies', R(loading, { type: 'REQUEST_RESOLVED', generation: 0, outcome: { kind: 'VIEW', view: view3 } }) === loading);
  check('44. a response outside LOADING never applies', (() => { const idleNow = R(loading, { type: 'DISMISS' }); return R(idleNow, { type: 'REQUEST_RESOLVED', generation: idleNow.generation, outcome: { kind: 'VIEW', view: view3 } }) === idleNow; })());
  const proposalState = R(loading, { type: 'REQUEST_RESOLVED', generation: 1, outcome: { kind: 'VIEW', view: view3 } });
  const accepting = R(proposalState, { type: 'ACCEPT_STARTED' });
  check('44. PROPOSAL -> ACCEPTING (same generation), only for CHANGES_PROPOSED', accepting.phase === 'ACCEPTING' && accepting.generation === proposalState.generation && (() => { const nc = R(loading, { type: 'REQUEST_RESOLVED', generation: 1, outcome: { kind: 'VIEW', view: { kind: 'NO_CHANGES', keepCount: 1 } } }); return R(nc, { type: 'ACCEPT_STARTED' }) === nc; })());
  const g = accepting.generation;
  check('44. ACCEPTING -> reconciling flag', (() => { const n = R(accepting, { type: 'ACCEPT_RECONCILING', generation: g }); return n.phase === 'ACCEPTING' && n.reconciling; })());
  check('44. ACCEPTING -> IDLE(updated) on success', (() => { const n = R(accepting, { type: 'ACCEPT_SUCCEEDED', generation: g }); return n.phase === 'IDLE' && n.updated; })());
  check('44. ACCEPTING -> PROPOSAL(SAVE_FAILED) keeps the same view for retry', (() => { const n = R(accepting, { type: 'ACCEPT_SAVE_FAILED', generation: g }); return n.phase === 'PROPOSAL' && n.notice === 'SAVE_FAILED' && n.view === view3; })());
  check('44. ACCEPTING -> PROPOSAL(UNCONFIRMED) keeps the same view for retry', (() => { const n = R(accepting, { type: 'ACCEPT_UNCONFIRMED', generation: g }); return n.phase === 'PROPOSAL' && n.notice === 'UNCONFIRMED' && n.view === view3; })());
  check('44. ACCEPTING -> STALE and ERROR(INVALID_TOKEN): the token/proposal is dropped from state', (() => { const a = R(accepting, { type: 'ACCEPT_STALE', generation: g }); const b = R(accepting, { type: 'ACCEPT_INVALID', generation: g }); return a.phase === 'STALE' && !('view' in a) && b.phase === 'ERROR' && b.error === 'INVALID_TOKEN' && !('view' in b); })());
  check('44. accept results for a superseded generation never apply', (['ACCEPT_SUCCEEDED', 'ACCEPT_SAVE_FAILED', 'ACCEPT_UNCONFIRMED', 'ACCEPT_STALE', 'ACCEPT_INVALID', 'ACCEPT_RECONCILING'] as const).every((type) => R(accepting, { type, generation: g - 1 }) === accepting));
  check('44. DISMISS: any non-accepting state -> IDLE with a bumped generation; ignored while ACCEPTING', (() => { const d = R(proposalState, { type: 'DISMISS' }); return d.phase === 'IDLE' && !d.updated && d.generation === proposalState.generation + 1 && R(accepting, { type: 'DISMISS' }) === accepting; })());
  check('44. INVALIDATE: bumps generation and closes any open proposal; also detaches an accepting UI', (() => { const i = R(proposalState, { type: 'INVALIDATE' }); const j = R(accepting, { type: 'INVALIDATE' }); return i.phase === 'IDLE' && i.generation === proposalState.generation + 1 && j.phase === 'IDLE' && j.generation === accepting.generation + 1; })());
  check('44. INVALIDATE on an idle, quiet state is a no-op (no needless generation churn)', R(initialRecompositionState, { type: 'INVALIDATE' }) === initialRecompositionState);
  check('44. RESET always returns to IDLE with a newer generation', (() => { const r = R(accepting, { type: 'RESET' }); return r.phase === 'IDLE' && r.generation === accepting.generation + 1; })());
  check('30. a re-run from PROPOSAL/STALE/ERROR supersedes (LOADING, newer generation); an accepting state is never displaced', R(proposalState, { type: 'REQUEST_STARTED' }).generation === proposalState.generation + 1 && R(accepting, { type: 'REQUEST_STARTED' }) === accepting);
  check('28. COMMITTED_ELSEWHERE closes anything older and reports the update', (() => { const n = R(loading, { type: 'COMMITTED_ELSEWHERE' }); return n.phase === 'IDLE' && n.updated && n.generation === loading.generation + 1; })());

  // ============================ store: request / generation races ============================
  {
    const h = makeHarness({ recompose: [okRes(changes3())] });
    await h.store.request();
    const st = h.store.getState();
    check('2. F2 is invoked via POST /api/day/recompose with NO body', h.calls.length === 1 && h.calls[0].url === '/api/day/recompose' && h.calls[0].init?.method === 'POST' && h.calls[0].init?.body === undefined);
    check('10/47. a CHANGES_PROPOSED response opens the PROPOSAL state', st.phase === 'PROPOSAL' && st.view.kind === 'CHANGES_PROPOSED');
  }
  {
    // 45: A starts, B starts (re-run), B completes, A completes
    const h = makeHarness({ recompose: ['DEFER', 'DEFER'] });
    const a = h.store.request();
    h.store.dismiss(); // user closes A's loading card...
    const b = h.store.request(); // ...and asks again
    check('45. two requests are now in flight', h.deferred.length === 2 && h.store.getState().phase === 'LOADING');
    h.deferred[1](okRes(ready('NO_CHANGES', [keepD('K', 'Lunch', '13:00', '14:00')]))); // B completes first
    await tick();
    h.deferred[0](okRes(changes3())); // A (obsolete) completes last
    await Promise.all([a, b]);
    const st = h.store.getState();
    check('45. B stays authoritative and the late A response is discarded', st.phase === 'PROPOSAL' && st.view.kind === 'NO_CHANGES');
  }
  {
    // 46: dismiss race
    const h = makeHarness({ recompose: ['DEFER'] });
    const pending = h.store.request();
    h.store.dismiss();
    h.deferred[0](okRes(changes3()));
    await pending;
    check('46. a response arriving after dismiss never reopens the proposal', h.store.getState().phase === 'IDLE' && !(h.store.getState() as { updated?: boolean }).updated);
    const h2 = makeHarness({ recompose: ['DEFER'] });
    const pending2 = h2.store.request();
    h2.store.invalidate();
    h2.deferred[0](okRes(changes3()));
    await pending2;
    check('46. ...nor after an invalidation (a successful Done/Skip/Move/Recovery)', h2.store.getState().phase === 'IDLE');
    const h3 = makeHarness({ recompose: ['DEFER'] });
    const pending3 = h3.store.request();
    h3.store.reset();
    h3.deferred[0](okRes(changes3()));
    await pending3;
    check('35. ...nor after a reset (day rollover / navigation)', h3.store.getState().phase === 'IDLE');
  }
  {
    const h = makeHarness({ recompose: ['DEFER'] });
    const first = h.store.request();
    const second = h.store.request(); // synchronous double tap
    check('57. two synchronous requests produce ONE F2 call', h.calls.length === 1);
    h.deferred[0](okRes(ready('NO_CHANGES', [])));
    await Promise.all([first, second]);
  }
  {
    const h = makeHarness({ recompose: [okRes({ status: 'TIMING_FAILED', reason: 'x' }), THROWS(), okRes({ status: 'NO_USABLE_CAPACITY' })] });
    await h.store.request();
    const a = h.store.getState();
    await h.store.request();
    const b = h.store.getState();
    await h.store.request();
    const c = h.store.getState();
    check('14/47. TIMING_FAILED -> ERROR(TIMING_FAILED); a thrown request -> ERROR(GENERIC); both are re-runnable from the error state', a.phase === 'ERROR' && a.error === 'TIMING_FAILED' && b.phase === 'ERROR' && b.error === 'GENERIC' && c.phase === 'PROPOSAL' && c.view.kind === 'NO_USABLE_CAPACITY');
  }
  function THROWS(): Reply { return 'THROW'; }

  // ============================ store: accept ============================
  const openProposal = async (script: { accept?: Reply[]; observe?: boolean[] }) => {
    const h = makeHarness({ recompose: [okRes(changes3())], ...script });
    await h.store.request();
    return h;
  };
  {
    const h = await openProposal({ accept: [okRes(acceptedBody())] });
    await h.store.accept();
    const body = h.calls[1]?.init?.body as string;
    check('17/49. the accept request body is EXACTLY { proposalToken } to /api/day/recompose/accept', h.calls[1].url === '/api/day/recompose/accept' && h.calls[1].init?.method === 'POST' && body === JSON.stringify({ proposalToken: 'signed.token.1' }) && Object.keys(JSON.parse(body)).join() === 'proposalToken');
    check('19/50. ACCEPTED projects the whole batch in ONE applyConfirmedMoves call (3 moves) and ends at IDLE(updated)', h.projected.length === 1 && h.projected[0].length === 3 && h.store.getState().phase === 'IDLE' && (h.store.getState() as { updated?: boolean }).updated === true);
    check('19/23. projection happens before the state change in the same tick, then Home reconciles once', h.events.join('>') === 'state:LOADING>state:PROPOSAL>state:ACCEPTING>project>state:IDLE+updated>reconcile' && h.reconciles() === 1);
  }
  {
    const h = await openProposal({ accept: [okRes(acceptedBody('ALREADY_ACCEPTED'))] });
    await h.store.accept();
    check('21/51. ALREADY_ACCEPTED is treated exactly like ACCEPTED (projected, updated, reconciled, no error)', h.projected.length === 1 && h.projected[0].length === 3 && (h.store.getState() as { updated?: boolean }).updated === true && h.reconciles() === 1);
  }
  {
    const h = await openProposal({ accept: ['DEFER'] });
    const first = h.store.accept();
    const second = h.store.accept(); // synchronous double click on Accept
    check('18/57. two synchronous Accept clicks produce ONE accept request; the store reports accepting', h.calls.filter((c) => c.url.endsWith('/accept')).length === 1 && h.store.isAccepting() && h.store.getState().phase === 'ACCEPTING');
    check('18. while ACCEPTING, dismiss and a new request are ignored', (() => { h.store.dismiss(); void h.store.request(); return h.store.getState().phase === 'ACCEPTING' && h.calls.length === 2; })());
    h.deferred[0](okRes(acceptedBody()));
    await Promise.all([first, second]);
    check('18. the guard releases after settlement', !h.store.isAccepting());
  }
  {
    const h = await openProposal({ accept: [errRes({ status: 'STALE', reason: 'CONFLICT' })] });
    await h.store.accept();
    const st = h.store.getState();
    check('24/52. STALE: proposal/token discarded, Home refreshed, nothing projected', st.phase === 'STALE' && !('view' in st) && h.reconciles() === 1 && h.projected.length === 0);
    await h.store.accept();
    check('24/52. the old token cannot be resubmitted from the UI (no accept possible from STALE)', h.calls.filter((c) => c.url.endsWith('/accept')).length === 1);
  }
  {
    const h = makeHarness({ recompose: [okRes(changes3()), okRes(ready('NO_CHANGES', []))], accept: [errRes({ status: 'STALE' })] });
    await h.store.request();
    await h.store.accept();
    await h.store.request(); // "Check again"
    check('24. Check again runs a fresh F2 request', h.calls.filter((c) => c.url === '/api/day/recompose').length === 2 && h.store.getState().phase === 'PROPOSAL');
  }
  {
    const h = await openProposal({ accept: [errRes({ status: 'INVALID_TOKEN' })] });
    await h.store.accept();
    const st = h.store.getState();
    check('25. INVALID_TOKEN: proposal discarded, Home refreshed, error state (no token vocabulary in state)', st.phase === 'ERROR' && st.error === 'INVALID_TOKEN' && h.reconciles() === 1 && h.projected.length === 0);
  }
  {
    const h = await openProposal({ accept: [errRes({ status: 'SAVE_FAILED' }), okRes(acceptedBody())] });
    await h.store.accept();
    const st = h.store.getState();
    check('26/53. SAVE_FAILED: no projection, proposal kept for retry with the failure notice', st.phase === 'PROPOSAL' && st.notice === 'SAVE_FAILED' && h.projected.length === 0);
    await h.store.accept();
    check('53. the retry re-sends the SAME token and succeeds', h.calls.filter((c) => c.url.endsWith('/accept')).length === 2 && h.calls[1].init?.body === h.calls[2].init?.body && h.projected.length === 1 && (h.store.getState() as { updated?: boolean }).updated === true);
  }

  // ---- 27/54 lost response ----
  {
    // The server committed; only the response was lost. A fresh read shows every source MOVED.
    const h = await openProposal({ accept: ['THROW'], observe: [true] });
    await h.store.accept();
    const st = h.store.getState();
    check('54. lost response + commit observed after refresh: converges to success (no failure claim, refresh performed first)', st.phase === 'IDLE' && (st as { updated?: boolean }).updated === true && h.events.slice(-3).join('>') === 'reconcile>observe>state:IDLE+updated');
    check('54. ...and nothing was projected from an answer that never arrived (the refresh is the truth)', h.projected.length === 0);
  }
  {
    // Not observable: the same token stays retryable and never says "nothing was changed".
    const h = await openProposal({ accept: ['THROW', okRes(acceptedBody('ALREADY_ACCEPTED'))], observe: [false] });
    await h.store.accept();
    const st = h.store.getState();
    check('54. lost response + commit NOT observable: back to PROPOSAL with the UNCONFIRMED notice (not SAVE_FAILED), refresh attempted', st.phase === 'PROPOSAL' && st.notice === 'UNCONFIRMED' && h.reconciles() === 1);
    await h.store.accept();
    check('54. the SAME token is safely retried and the idempotent ALREADY_ACCEPTED converges to success', h.calls[2].init?.body === h.calls[1].init?.body && h.projected.length === 1 && (h.store.getState() as { updated?: boolean }).updated === true);
  }
  {
    const h = await openProposal({ accept: ['THROW'] });
    await h.store.accept(); // observe defaults to false; a throwing observation is also "not observed"
    check('27. an unreadable follow-up read is "not observed", never a failure claim', h.store.getState().phase === 'PROPOSAL' && (h.store.getState() as { notice?: string }).notice === 'UNCONFIRMED');
    const h2 = await openProposal({ accept: [okRes({ status: 'ACCEPTED', moves: [] })], observe: [true] });
    await h2.store.accept();
    check('27. a 200 whose mapping is unusable is treated as UNKNOWN and reconciled (not projected, not called a failure)', h2.projected.length === 0 && (h2.store.getState() as { updated?: boolean }).updated === true);
  }
  {
    // While the refresh after a transport error is pending, the UI is ACCEPTING(reconciling): still blocked, still honest.
    let releaseRefresh: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const rec = makeHarness({ recompose: [okRes(changes3())], accept: ['THROW'] });
    void rec;
    const store = createRecompositionStore({
      fetchImpl: (async (url: string) => { if (url.endsWith('/accept')) throw new TypeError('network'); return { ok: true, json: async () => changes3() } as unknown as Response; }) as unknown as typeof fetch,
      applyConfirmedMoves: () => {},
      reconcile: () => gate,
      observeMovedSources: async () => true,
    });
    await store.request();
    const pending = store.accept();
    await tick();
    const mid = store.getState();
    check('27. after a transport error the UI enters ACCEPTING(reconciling) and stays blocked until the refresh settles', mid.phase === 'ACCEPTING' && mid.reconciling && store.isAccepting());
    releaseRefresh();
    await pending;
    check('27. ...then converges (commit observed) with no failure claim on the way', store.getState().phase === 'IDLE');
  }

  // ---- 28/55 late accept ----
  {
    const h = await openProposal({ accept: ['DEFER'] });
    const pending = h.store.accept();
    h.store.invalidate(); // UI moved on while the accept was in flight
    check('55. after a local invalidation the UI is IDLE but an accept is still in flight', h.store.getState().phase === 'IDLE' && h.store.isAccepting());
    h.deferred[0](okRes(acceptedBody()));
    await pending;
    check('28/55. the late ACCEPTED is still projected (committed server truth) and reconciled', h.projected.length === 1 && h.projected[0].length === 3 && h.reconciles() === 1);
    check('28/55. ...and the UI reports the update (IDLE, updated) instead of dropping it', (h.store.getState() as { updated?: boolean }).updated === true);
  }
  {
    const h = await openProposal({ accept: ['DEFER'] });
    const pending = h.store.accept();
    h.store.reset();
    h.deferred[0]({ ok: false, body: { status: 'STALE' } });
    await pending;
    check('28. a late STALE for an already-invalidated UI request is ignored (no state resurrected)', h.store.getState().phase === 'IDLE' && !(h.store.getState() as { updated?: boolean }).updated);
  }
  {
    // a committed accept also ends a newer, obsolete proposal request started meanwhile
    const h = makeHarness({ recompose: [okRes(changes3()), 'DEFER'], accept: ['DEFER'] });
    await h.store.request();
    const pending = h.store.accept();
    h.store.invalidate();
    void h.store.request(); // blocked while accepting
    check('28. no new request can start while an accept is in flight', h.calls.length === 2);
    h.deferred[0](okRes(acceptedBody()));
    await pending;
    check('28. the committed batch is applied exactly once', h.projected.length === 1);
  }
  {
    const h = await openProposal({ accept: [okRes(acceptedBody())] });
    const detach = h.store.attach();
    detach(); // Home unmounted: nothing to project into
    await h.store.accept();
    check('34. after unmount (detach) the store neither projects nor notifies', h.projected.length === 0);
  }

  // ============================ projection: multi-move atomicity ============================
  {
    const plans = [plan('A', 'Finish presentation', at('10:00'), at('11:00')), plan('B', 'Call the bank', at('11:00'), at('12:00')), plan('C', 'Review notes', at('12:00'), at('13:00')), plan('K1', 'Lunch', at('13:00'), at('13:30'))];
    const agenda = buildDailyAgenda({ now: NOW, localDate: '2026-08-24', timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    const compose = (facts: ReadonlyMap<string, ExecutionOutcome>, successors: ReadonlyMap<string, PlannedActivity>) => {
      const forHome = applyConfirmedSuccessors(agenda, successors, NOW);
      return hideMovedTimelineItems(overlayExecutionFacts(buildHomeTimeline({ agenda: forHome, guidance: null, selectedActivities: {}, currentMinuteOfDay: 540, timezone: TZ, localDate: '2026-08-24' }), facts));
    };
    const planIds = (t: ReturnType<typeof compose>) => t.filter((i) => i.kind === 'PLAN').map((i) => i.id.replace('plan:', ''));
    const before = compose(new Map(), new Map());
    check('58. BEFORE acceptance the Timeline shows the actual committed plans at their actual times (proposal times exist nowhere in it)', planIds(before).join() === 'A,B,C,K1' && !JSON.stringify(before).includes(at('14:00').toISOString()));

    const committed = (parseAcceptResponse(true, acceptedBody(), expected) as Extract<ReturnType<typeof parseAcceptResponse>, { kind: 'COMMITTED' }>).moves;
    const afterFacts = withMovedSources<ExecutionOutcome>(new Map(), committed);
    const afterSuccessors = withConfirmedMoves(new Map(), committed);
    const after = compose(afterFacts, afterSuccessors);
    check('20/50. ONE projection swaps all sources for all successors together: A,B,C disappear and A2,B2,C2 appear at their new times', planIds(after).join() === 'K1,A2,B2,C2' && !planIds(after).some((id) => ['A', 'B', 'C'].includes(id)));
    const partialA = compose(withMovedSources<ExecutionOutcome>(new Map(), committed.slice(0, 1)), withConfirmedMoves(new Map(), committed.slice(0, 1)));
    check('20. there is no reachable intermediate "A moved, B and C not yet" state from one confirmed response (the helpers take the whole batch)', planIds(partialA).join() !== planIds(after).join() && withMovedSources<ExecutionOutcome>(new Map(), committed).size === 3 && withConfirmedMoves(new Map(), committed).size === 3);
    check('19. the projected day stays chronological', after.filter((i) => i.kind === 'PLAN').every((i, idx, arr) => idx === 0 || Date.parse(arr[idx - 1].start) <= Date.parse(i.start)));
    check('19. projection does not mutate the maps it was given', (() => { const f = new Map<string, ExecutionOutcome>([['X', 'COMPLETED']]); const sM = new Map<string, PlannedActivity>(); withMovedSources(f, committed); withConfirmedMoves(sM, committed); return f.size === 1 && sM.size === 0; })());
  }

  // ============================ observation ============================
  {
    const body = { agenda: { items: [{ id: 'plan:A', status: 'MOVED' }, { id: 'plan:B', status: 'MOVED' }, { id: 'plan:C', status: 'MOVED' }, { id: 'plan:A2', status: 'UPCOMING' }] } };
    check('54. commit is observed only if EVERY source plan reads back as MOVED', sourcesObservedMoved(body, ['A', 'B', 'C']) && !sourcesObservedMoved(body, ['A', 'B', 'D']) && !sourcesObservedMoved({ agenda: { items: [{ id: 'plan:A', status: 'UPCOMING' }] } }, ['A']) && !sourcesObservedMoved(null, ['A']) && !sourcesObservedMoved({ agenda: {} }, ['A']) && !sourcesObservedMoved(body, []));
  }

  // ============================ visibility heuristic ============================
  {
    const item = (status: string, kind = 'PLAN', planned = true) => ({ kind, planned, metadata: { agendaStatus: status } });
    const base = { agendaLocalDate: '2026-08-24', now: NOW, timezone: TZ, items: [item('UPCOMING')], mutationInFlight: false };
    check('1/9. offered: today + an upcoming plan + nothing conflicting running', shouldOfferRecomposition(base));
    check('1. hidden when the viewed day is not today, or has no date', !shouldOfferRecomposition({ ...base, agendaLocalDate: '2026-08-23' }) && !shouldOfferRecomposition({ ...base, agendaLocalDate: undefined }));
    check('1. hidden with nothing upcoming (done/skipped/missed/moved/current only, or no plan rows)', !shouldOfferRecomposition({ ...base, items: [item('COMPLETED'), item('SKIPPED'), item('MISSED'), item('MOVED'), item('CURRENT'), item('UPCOMING', 'OPPORTUNITY', false), item('UPCOMING', 'MOMENT', false)] }) && !shouldOfferRecomposition({ ...base, items: [] }));
    check('1. hidden while a conflicting Home mutation/accept is running', !shouldOfferRecomposition({ ...base, mutationInFlight: true }));
    check('1. the heuristic never looks at scheduling flexibility (it only reads the presentation status)', !/schedulingMode|FLEXIBLE|isFlexible/i.test(strip(read('../apps/web/lib/homeRecomposition.ts'))));
  }

  // ============================ rendering ============================
  const render = (state: RecompositionState, acceptBlocked = false) => renderToStaticMarkup(React.createElement(RecompositionCard, { state, timezone: TZ, acceptBlocked, onAccept: () => {}, onDismiss: () => {}, onRetry: () => {} }));
  const st = (phase: RecompositionState['phase'], extra: object = {}) => ({ generation: 1, phase, ...extra }) as RecompositionState;
  const proposalMarkup = render(st('PROPOSAL', { view: proposal, notice: null }));
  const FORBIDDEN_ENUMS = /FLEXIBLE|FIXED|UNRESOLVED|KEEP\b|MOVE\b|CHANGES_PROPOSED|NEEDS_ATTENTION|NO_CHANGES|TIMING_FAILED|NO_USABLE|INVALID_TOKEN|SAVE_FAILED|proposalToken|signed\.token/;
  const FORBIDDEN_WORDS = /\btier\b|placement fit|constructor|panchang|muhurta|rahu|gulika|yamaganda|nakshatra|\bscore\b|schedulingMode|token/i;
  const FORBIDDEN = { test: (text: string) => FORBIDDEN_ENUMS.test(text) || FORBIDDEN_WORDS.test(text) };
  const allMarkups: Array<[string, string]> = [
    ['proposal', proposalMarkup],
    ['proposal+unresolved', render(st('PROPOSAL', { view: { ...(proposal as object), unresolved: [{ planId: 'U', title: 'Dentist', atIso: at('10:00').toISOString() }] }, notice: null }))],
    ['proposal+SAVE_FAILED', render(st('PROPOSAL', { view: proposal, notice: 'SAVE_FAILED' }))],
    ['proposal+UNCONFIRMED', render(st('PROPOSAL', { view: proposal, notice: 'UNCONFIRMED' }))],
    ['accepting', render(st('ACCEPTING', { view: proposal, reconciling: false }))],
    ['reconciling', render(st('ACCEPTING', { view: proposal, reconciling: true }))],
    ['loading', render(st('LOADING'))],
    ['no changes', render(st('PROPOSAL', { view: { kind: 'NO_CHANGES', keepCount: 2 }, notice: null }))],
    ['needs attention', render(st('PROPOSAL', { view: needs, notice: null }))],
    ['no capacity', render(st('PROPOSAL', { view: { kind: 'NO_USABLE_CAPACITY' }, notice: null }))],
    ['timing failed', render(st('ERROR', { error: 'TIMING_FAILED' }))],
    ['generic error', render(st('ERROR', { error: 'GENERIC' }))],
    ['invalid', render(st('ERROR', { error: 'INVALID_TOKEN' }))],
    ['stale', render(st('STALE'))],
    ['updated', render(st('IDLE', { updated: true }))],
  ];
  const visibleText = (m: string) => m.replace(/<[^>]+>/g, ' ');
  check('8/48. MOVE rows show the title and old -> new time, with the accessible "from X to Y" equivalent', proposalMarkup.includes('Finish presentation') && proposalMarkup.includes('2:00 PM') && proposalMarkup.includes(', from 10:00 AM to 2:00 PM') && proposalMarkup.includes('10:00 AM → 2:00 PM') && presentMove({ planId: 'A', title: 'Finish presentation', fromIso: at('14:00').toISOString(), toIso: at('15:30').toISOString() }, TZ).accessibleText === 'Finish presentation, from 2:00 PM to 3:30 PM');
  check('8. the arrow is decorative only (aria-hidden) so the change is never conveyed by an arrow alone', /aria-hidden="true"[^>]*>10:00 AM → 2:00 PM/.test(proposalMarkup));
  check('7. the proposal card is labelled as not applied yet', proposalMarkup.includes('Suggested changes — not applied yet'));
  check('9/48. unchanged plans are collapsed to a count, not listed', proposalMarkup.includes('2 things stay as they are') && !proposalMarkup.includes('Lunch') && !proposalMarkup.includes('Walk') && keepSummary(1) === '1 thing stays as it is' && keepSummary(0) === null);
  const unresolvedMarkup = allMarkups[1][1];
  check('10/48. unresolved items render plainly under "Needs your attention" with the time and a plain reason', unresolvedMarkup.includes('Needs your attention') && unresolvedMarkup.includes('Dentist, at 10:00 AM. This time no longer works and nothing else fits today.') && unresolvedText({ planId: 'U', title: 'Dentist', atIso: at('10:00').toISOString() }, TZ).startsWith('Dentist, at 10:00 AM'));
  check('10/16. a proposal that also has unresolved items still offers no partial acceptance: exactly one Accept, for the whole proposal', (unresolvedMarkup.match(/Accept new arrangement/g) ?? []).length === 1);
  check('48. no internal enum, timing tier, Constructor/Panchang/Vedic terminology or token appears in ANY rendering', allMarkups.every(([, m]) => !FORBIDDEN.test(visibleText(m))) && allMarkups.every(([, m]) => !FORBIDDEN.test(m.replace(/ (?:class|style|id|aria-[a-z]+|role|type|data-[a-z-]+|tabindex)="[^"]*"/g, '').replace(/ (?:disabled|data-[a-z-]+|aria-busy)(?==|>| )/g, ''))));
  check('11. no Why/causal copy is invented anywhere', allMarkups.every(([, m]) => !/moved to fit|to fit your|because|why\b|better timing|remaining time/i.test(visibleText(m))));
  check('12/47. NO_CHANGES: compact status, no Accept, a Done control', allMarkups[7][1].includes('Your day already works. Nothing to move.') && !allMarkups[7][1].includes('Accept new arrangement') && allMarkups[7][1].includes('>Done<'));
  check('13/47. NEEDS_ATTENTION: decision summary + unresolved rows, no Accept', allMarkups[8][1].includes('A few things need your decision first.') && allMarkups[8][1].includes('Dentist') && !allMarkups[8][1].includes('Accept new arrangement'));
  check('14/47. TIMING_FAILED: retryable failure copy and "Try again", never implying the day is optimal', allMarkups[10][1].includes("Couldn&#x27;t check your day right now. Nothing was changed.") && allMarkups[10][1].includes('Try again') && !allMarkups[10][1].includes('Accept new arrangement') && !/works|optimal|fits/i.test(visibleText(allMarkups[10][1])));
  check('15/47. NO_USABLE_CAPACITY: concise practical copy, no Accept', allMarkups[9][1].includes('There isn&#x27;t any usable time left today to rearrange.') && !allMarkups[9][1].includes('Accept new arrangement'));
  check('16. CHANGES_PROPOSED: primary "Accept new arrangement" and secondary "Not now"; no modal/dialog markup', proposalMarkup.includes('Accept new arrangement') && proposalMarkup.includes('Not now') && !/role="(?:alert)?dialog"|<dialog|aria-modal/.test(proposalMarkup));
  check('24. STALE copy + Check again; INVALID copy + Check again; neither exposes token vocabulary', allMarkups[13][1].includes('Your day changed while you were reviewing.') && allMarkups[13][1].includes('Check again') && allMarkups[12][1].includes('This suggestion is no longer valid.') && allMarkups[12][1].includes('Check again') && !/token/i.test(allMarkups[12][1]));
  check('26. SAVE_FAILED shows a concise failure with the proposal still acceptable; UNCONFIRMED never claims nothing changed', allMarkups[2][1].includes('Nothing was changed. Try again.') && allMarkups[2][1].includes('Accept new arrangement') && allMarkups[3][1].includes('couldn&#x27;t confirm whether your day was updated') && !/Nothing was changed/.test(allMarkups[3][1]) && !/Nothing was changed/.test(allMarkups[4][1] + allMarkups[5][1]));
  check('22. success status: "Your day is updated." as a focusable status', allMarkups[14][1].includes('Your day is updated.') && /role="status"[^>]*data-recomposition-status[^>]*tabindex="-1"|data-recomposition-status[^>]*role="status"/.test(allMarkups[14][1]));
  check('18. ACCEPTING: aria-busy, Accept and Not now disabled, saving status; reconciling says "Checking your day…"', (() => { const m = allMarkups[4][1]; return m.includes('aria-busy="true"') && /<button[^>]*disabled[^>]*>Accept new arrangement/.test(m) && /<button[^>]*disabled[^>]*>Not now/.test(m) && m.includes('Saving your new arrangement…') && allMarkups[5][1].includes('Checking your day…'); })());
  check('18. Accept also waits while a conflicting plan mutation runs (acceptBlocked)', /<button[^>]*disabled[^>]*>Accept new arrangement/.test(render(st('PROPOSAL', { view: proposal, notice: null }), true)));
  check('59. accessibility: a labelled region, headed by a focusable heading', /<section[^>]*role="region"[^>]*aria-labelledby="home-recomposition-heading"/.test(proposalMarkup) && /<h3 id="home-recomposition-heading"[^>]*tabindex="-1"[^>]*data-recomposition-heading/.test(proposalMarkup));
  check('59. loading/success use role="status"; failures use role="alert"; every action is a real <button>', allMarkups[6][1].includes('role="status"') && allMarkups[14][1].includes('role="status"') && [10, 11, 12, 13].every((i) => allMarkups[i][1].includes('role="alert"')) && allMarkups.every(([, m]) => !/<div[^>]*onclick|role="button"/i.test(m)) && (proposalMarkup.match(/<button/g) ?? []).length === 2);
  check('38. mobile: 44px-class tap targets, a wrapping action row and a flexible full-width-capable Accept (no hover/drag dependency)', /min-height:44px/.test(proposalMarkup) && /flex-wrap:wrap/.test(proposalMarkup) && /flex:1 1 220px/.test(proposalMarkup) && !/onMouse|hover|draggable/i.test(read('../apps/web/components/RecompositionCard.tsx')));
  check('36. reduced motion: the card introduces no animation or transition', !/animation|transition|@keyframes/i.test(strip(read('../apps/web/components/RecompositionCard.tsx'))));
  check('7. an idle, quiet state renders nothing (no persistent clutter)', render(initialRecompositionState) === '');

  // ============================ structural: wiring, trust boundary, no scheduling ============================
  const lib = strip(read('../apps/web/lib/homeRecomposition.ts'));
  const card = strip(read('../apps/web/components/RecompositionCard.tsx'));
  const dash = strip(read('../apps/web/components/HomeDashboard.tsx'));
  const imports = (src: string) => [...src.matchAll(/^import[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  const FORBIDDEN_IMPORTS = /dayConstructor|dayIntent|dayCapacity|timingSearch|placement|collision|muhurta|plannedActivitySchedulingMode|planMove|remainingDayRecomposition|recommendation|panchang|orchestrator/i;
  check('42. Home recomposition modules import nothing from the scheduling domain (Constructor, Timing Search, placement/collision, scheduling-mode authority, F2/F3 internals)', imports(lib).concat(imports(card)).every((i) => !FORBIDDEN_IMPORTS.test(i)) && imports(lib).sort().join() === "./db,./timezone");
  check('42. ...and contain no scheduling vocabulary or logic', !/orchestrate|constructDay|runTimingSearch|compareCandidates|findBlockingPlan|isFlexible|hasFlexibleScheduling|collision/i.test(lib + card));
  check('43. trust boundary: the ONLY request body the client can build is { proposalToken }; it never references moves/times/plan ids/scheduling mode in a request', (lib.match(/\bbody: JSON\.stringify/g) ?? []).length === 1 && (lib.match(/JSON\.stringify\(/g) ?? []).length === 1 && /body: JSON\.stringify\(\{ proposalToken: view\.proposalToken \}\)/.test(lib));
  check('2/43. the only endpoints touched are the two existing routes (no new route)', [...lib.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]).sort().join() === '/api/day/recompose,/api/day/recompose/accept' && !fs.existsSync(path.join(__dirname, '../apps/web/app/api/day/recompose/preview')));
  check('3. the proposal is not in DailyAgenda and not global state (no context/store library, no agenda type change)', !/createContext|zustand|redux|localStorage|sessionStorage/.test(lib + card + dash.slice(dash.indexOf('Remaining-Day Recomposition V1 PR F4'))) && !/recomposition|proposal/i.test(strip(read('../apps/web/lib/dailyAgenda.ts'))));
  check('6. the card is presentational: no fetch, no state hooks, no store', !/fetch\(|useState|useReducer|useEffect|createRecompositionStore/.test(card));
  check('7/58. Home never feeds the proposal into the Timeline: buildHomeTimeline/applyConfirmedSuccessors inputs do not mention the recomposition state', (() => { const tl = dash.slice(dash.indexOf('const composedTimeline'), dash.indexOf('const homeTimeline')); return !/recomposition/i.test(tl) && !/recomposition/i.test(dash.slice(dash.indexOf('const agendaForHome'), dash.indexOf('const composedTimeline'))); })());
  check('7. the card renders inside the Your Day area, above the Timeline rows, and not inside Right Now', /quickCaptureSlot=\{\s*<>\s*\{recompositionSlot\}/.test(dash) && (dash.match(/<RecompositionCard/g) ?? []).length === 1 && dash.indexOf('<RecompositionCard') < dash.indexOf('<HomeTimeline') && !/<HomeTimeline[^>]*recomposition/i.test(dash));
  check('1. entry copy is "Reorganize the rest of my day" and appears only through the visibility heuristic', /Reorganize the rest of my day/.test(dash) && /offerRecomposition && \(/.test(dash) && /const offerRecomposition = !recompositionCardVisible && shouldOfferRecomposition\(/.test(dash));
  check('20. Home projects a confirmed batch with ONE applier that uses the shared executionFacts/confirmedSuccessors overlays', (dash.match(/applyConfirmedMoves:/g) ?? []).length === 1 && /setExecutionFacts\(\(current\) => withMovedSources\(current, moves\)\);\s*setConfirmedSuccessors\(\(current\) => withConfirmedMoves\(current, moves\)\);/.test(dash));
  check('22. batch recomposition never uses the successor-focus controller', !/successorFocus/.test(lib + card) && !/successorFocus/.test(dash.slice(dash.indexOf('recompositionStoreRef.current === null'), dash.indexOf('const recompositionAccepting'))));
  check('23. reconciliation reuses the existing best-effort refresh (onPlanCompleted) and adds no ranking logic', /reconcile: async \(\) => \{\s*await onPlanCompletedRef\.current\?\.\(\);/.test(dash) && !/rank|sort\(/.test(lib));
  check('56. invalidation is wired after successful Done, Skip and Move (Missed Recovery uses the same three handlers)', /'COMPLETED'\)\);\s*recompositionStore\.invalidate\(\)/.test(dash) && /'SKIPPED'\)\);\s*recompositionStore\.invalidate\(\)/.test(dash) && /new Map\(current\)\.set\(planId, successor\)\);\s*recompositionStore\.invalidate\(\)/.test(dash) && (dash.match(/recompositionStore\.invalidate\(\)/g) ?? []).length === 3 && /handleCompleteRightNow\(planId, 'TIMELINE'\)/.test(dash) && /handleSkipRightNow\(planId, 'TIMELINE'\)/.test(dash) && /planExecutor\.current\.move/.test(dash));
  check('32/56. Quick Capture does NOT invalidate a proposal', (() => { const captureHandlers = dash.slice(dash.indexOf('handleCaptureSaved'), dash.indexOf('handleCaptureSaved') + 600); return !/recomposition/i.test(captureHandlers) && !/handleCloseCapture[^;]*recomposition/i.test(dash) && !/onQuickCapture=\{[^}]*recomposition/i.test(dash); })());
  check('18/33. conflicting plan mutations are blocked while accepting (handlers early-return, buttons disabled)', (dash.match(/recompositionStore\.isAccepting\(\)\) return;/g) ?? []).length === 3 && (dash.match(/\|\| recompositionAccepting/g) ?? []).length === 4);
  check('34/35. leaving Home detaches the store; a local-day change resets it', /unsubscribe\(\);\s*detach\(\);/.test(dash) && /recompositionStore\.reset\(\);\s*\}, \[recompositionStore, agendaLocalDate\]\)/.test(dash));
  check('37. focus: heading on appear, status after success, entry action after dismiss', /\[data-recomposition-status\]/.test(dash) && /\[data-recomposition-heading\]/.test(dash) && /getElementById\('home-recomposition-entry'\)\?\.focus\(\)/.test(dash) && /preventScroll: true/.test(dash));
  check('39. no analytics: no trackEvent/productEvents in the F4 code and no product-events change', !/trackEvent|productEvent/i.test(lib + card) && !/recompos/i.test(read('../apps/web/lib/productEvents.ts')));
  check('41/66. no backend/domain/schema change is needed: 39 migrations, no new dependency in package.json', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((f) => /^\d{4}_/.test(f)).length === 39);

  if (!allPassed) { console.error('SOME HOME RECOMPOSITION CHECKS FAILED'); process.exit(1); }
  console.log('ALL HOME RECOMPOSITION CHECKS PASSED');
}
main();
