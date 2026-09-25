/**
 * Remaining-Day Recomposition V1 PR F4 -- the Home experience for F2 (proposal) and F3 (acceptance).
 *
 *   F2 DECIDES. F3 VALIDATES + COMMITS. F4 EXPLAINS + LETS THE USER ACT.
 *
 * This module contains NO scheduling intelligence: it never imports the Day Constructor, Timing Search, timing
 * scoring, placement/collision logic or scheduling-mode authority (a structural test pins that). It only
 *   - parses the two server responses defensively (unknown/malformed -> fail closed),
 *   - holds the proposal state machine (a pure reducer) plus a small store that owns the async races,
 *   - prepares presentation rows, and
 *   - projects a SERVER-CONFIRMED batch into Home's existing overlay maps.
 *
 * Trust boundary: the client may only choose whether to accept a valid, server-generated proposal. The accept
 * request is EXACTLY `{ proposalToken }`; plan ids, times and decisions are never sent, and nothing about a
 * proposal's meaning can be edited here. The proposal is ephemeral -- never persisted, never in DailyAgenda.
 */
import type { PlannedActivity } from './db';
import { getDatePartsInTimezone } from './timezone';

// ---------------------------------------------------------------------------
// Parsed shapes (own types on purpose: nothing from the scheduling domain leaks into Home)
// ---------------------------------------------------------------------------

export interface RecompositionMoveRow {
  planId: string;
  title: string;
  fromIso: string;
  toIso: string;
}

export interface RecompositionUnresolvedRow {
  planId: string;
  title: string;
  atIso: string;
}

export type RecompositionView =
  | { kind: 'NO_CHANGES'; keepCount: number }
  | { kind: 'CHANGES_PROPOSED'; proposalToken: string; moves: RecompositionMoveRow[]; unresolved: RecompositionUnresolvedRow[]; keepCount: number }
  | { kind: 'NEEDS_ATTENTION'; unresolved: RecompositionUnresolvedRow[]; keepCount: number }
  | { kind: 'NO_USABLE_CAPACITY' };

export type RecomposeOutcome = { kind: 'VIEW'; view: RecompositionView } | { kind: 'TIMING_FAILED' } | { kind: 'ERROR' };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isInstantString = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

function parseSlotStart(value: unknown): string | null {
  return isObject(value) && isInstantString(value.start) && isInstantString(value.end) && Date.parse(value.end) > Date.parse(value.start) ? value.start : null;
}

/**
 * F2 response -> what Home may show. Only fields Home actually presents are read (ids, titles, times, the summary
 * state and the token); evidence, timing tiers and protected-plan reasons are never copied, so they cannot leak into
 * the UI. Anything inconsistent fails closed to ERROR -- a proposal is never half-trusted.
 */
export function parseRecomposeResponse(httpOk: boolean, body: unknown): RecomposeOutcome {
  if (!httpOk || !isObject(body)) return { kind: 'ERROR' };
  if (body.status === 'NO_USABLE_CAPACITY') return { kind: 'VIEW', view: { kind: 'NO_USABLE_CAPACITY' } };
  if (body.status === 'TIMING_FAILED') return { kind: 'TIMING_FAILED' };
  if (body.status !== 'READY' || !isObject(body.proposal)) return { kind: 'ERROR' };
  const proposal = body.proposal;
  const state = isObject(proposal.summary) ? proposal.summary.state : null;
  if (state !== 'NO_CHANGES' && state !== 'CHANGES_PROPOSED' && state !== 'NEEDS_ATTENTION') return { kind: 'ERROR' };
  if (!Array.isArray(proposal.decisions)) return { kind: 'ERROR' };

  const moves: RecompositionMoveRow[] = [];
  const unresolved: RecompositionUnresolvedRow[] = [];
  let keepCount = 0;
  const seen = new Set<string>();
  for (const decision of proposal.decisions) {
    if (!isObject(decision) || !isNonEmptyString(decision.planId) || typeof decision.title !== 'string' || seen.has(decision.planId)) return { kind: 'ERROR' };
    seen.add(decision.planId);
    const fromIso = parseSlotStart(decision.current);
    if (fromIso === null) return { kind: 'ERROR' };
    if (decision.decision === 'KEEP') {
      keepCount += 1;
    } else if (decision.decision === 'MOVE') {
      const toIso = parseSlotStart(decision.to);
      if (toIso === null) return { kind: 'ERROR' };
      moves.push({ planId: decision.planId, title: decision.title, fromIso, toIso });
    } else if (decision.decision === 'UNRESOLVED') {
      unresolved.push({ planId: decision.planId, title: decision.title, atIso: fromIso });
    } else {
      return { kind: 'ERROR' };
    }
  }

  // The summary must agree with the decisions it summarises; a disagreement is a contract violation, not a display choice.
  if (state === 'NO_CHANGES') return moves.length === 0 && unresolved.length === 0 ? { kind: 'VIEW', view: { kind: 'NO_CHANGES', keepCount } } : { kind: 'ERROR' };
  if (state === 'NEEDS_ATTENTION') return moves.length === 0 && unresolved.length > 0 ? { kind: 'VIEW', view: { kind: 'NEEDS_ATTENTION', unresolved, keepCount } } : { kind: 'ERROR' };
  if (moves.length === 0 || !isNonEmptyString(body.proposalToken)) return { kind: 'ERROR' };
  return { kind: 'VIEW', view: { kind: 'CHANGES_PROPOSED', proposalToken: body.proposalToken, moves, unresolved, keepCount } };
}

// ---------------------------------------------------------------------------
// F3 acceptance response
// ---------------------------------------------------------------------------

export interface ConfirmedMove {
  sourcePlanId: string;
  successor: PlannedActivity;
}

export type AcceptOutcome =
  | { kind: 'COMMITTED'; alreadyAccepted: boolean; moves: ConfirmedMove[] }
  | { kind: 'STALE' }
  | { kind: 'INVALID_TOKEN' }
  | { kind: 'SAVE_FAILED' }
  /** No trustworthy answer (transport failure, 401, unparseable body, a "success" whose mapping is unusable): the commit status is UNKNOWN, never assumed to be a failure. */
  | { kind: 'UNKNOWN' };

/**
 * `expectedSourceIds` are the plan ids of the proposal's MOVE rows; a success whose mapping does not match them is
 * not trusted as a projection (UNKNOWN -> reconcile from the server instead).
 */
export function parseAcceptResponse(httpOk: boolean, body: unknown, expectedSourceIds: readonly string[]): AcceptOutcome {
  if (!isObject(body)) return { kind: 'UNKNOWN' };
  const status = body.status;
  if (!httpOk) {
    if (status === 'STALE') return { kind: 'STALE' };
    if (status === 'INVALID_TOKEN') return { kind: 'INVALID_TOKEN' };
    if (status === 'SAVE_FAILED') return { kind: 'SAVE_FAILED' };
    return { kind: 'UNKNOWN' };
  }
  if ((status !== 'ACCEPTED' && status !== 'ALREADY_ACCEPTED') || !Array.isArray(body.moves) || body.moves.length === 0) return { kind: 'UNKNOWN' };
  const moves: ConfirmedMove[] = [];
  const sources = new Set<string>();
  const successors = new Set<string>();
  for (const move of body.moves) {
    const plan = isObject(move) ? move.successor : null;
    if (
      !isObject(move) || !isObject(plan) ||
      !isNonEmptyString(move.sourcePlanId) || !isNonEmptyString(move.successorPlanId) ||
      plan.id !== move.successorPlanId || plan.id === move.sourcePlanId || plan.status !== 'UPCOMING' ||
      typeof plan.title !== 'string' || !isInstantString(plan.plannedStartAt) || !isInstantString(plan.plannedEndAt) || typeof plan.durationMinutes !== 'number' ||
      sources.has(move.sourcePlanId) || successors.has(plan.id as string)
    ) {
      return { kind: 'UNKNOWN' };
    }
    sources.add(move.sourcePlanId);
    successors.add(plan.id as string);
    moves.push({ sourcePlanId: move.sourcePlanId, successor: { ...(plan as object), plannedStartAt: new Date(plan.plannedStartAt as string), plannedEndAt: new Date(plan.plannedEndAt as string) } as unknown as PlannedActivity });
  }
  if (sources.size !== expectedSourceIds.length || expectedSourceIds.some((id) => !sources.has(id))) return { kind: 'UNKNOWN' };
  return { kind: 'COMMITTED', alreadyAccepted: status === 'ALREADY_ACCEPTED', moves };
}

// ---------------------------------------------------------------------------
// Confirmed-batch projection (pure; Home applies both results in one batched update)
// ---------------------------------------------------------------------------

/** Every source becomes MOVED in the execution-fact map -- so Right Now, reminders and the next-item filter treat it as resolved. */
export function withMovedSources<V extends string>(facts: ReadonlyMap<string, V | 'MOVED'>, moves: readonly ConfirmedMove[]): Map<string, V | 'MOVED'> {
  const next = new Map(facts);
  for (const move of moves) next.set(move.sourcePlanId, 'MOVED');
  return next;
}

/** Every source -> successor mapping, added together (the existing applyConfirmedSuccessors overlay then swaps them all in one pass). */
export function withConfirmedMoves(successors: ReadonlyMap<string, PlannedActivity>, moves: readonly ConfirmedMove[]): Map<string, PlannedActivity> {
  const next = new Map(successors);
  for (const move of moves) next.set(move.sourcePlanId, move.successor);
  return next;
}

/** After a lost accept response: true only if a fresh /api/my-day read shows EVERY source plan as MOVED. Anything unreadable is "not observed". */
export function sourcesObservedMoved(myDayBody: unknown, sourcePlanIds: readonly string[]): boolean {
  const items = isObject(myDayBody) && isObject(myDayBody.agenda) && Array.isArray(myDayBody.agenda.items) ? myDayBody.agenda.items : null;
  if (!items || sourcePlanIds.length === 0) return false;
  const moved = new Set<string>();
  for (const item of items) if (isObject(item) && typeof item.id === 'string' && item.status === 'MOVED') moved.add(item.id);
  return sourcePlanIds.every((id) => moved.has(`plan:${id}`));
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type RecompositionErrorKind = 'GENERIC' | 'TIMING_FAILED' | 'INVALID_TOKEN';
export type RecompositionNotice = 'SAVE_FAILED' | 'UNCONFIRMED' | null;

export type RecompositionState = { generation: number } & (
  /** `updated`: a batch was just accepted -- the card shows "Your day is updated." until closed. */
  | { phase: 'IDLE'; updated: boolean }
  | { phase: 'LOADING' }
  | { phase: 'PROPOSAL'; view: RecompositionView; notice: RecompositionNotice }
  | { phase: 'ACCEPTING'; view: RecompositionView; reconciling: boolean }
  | { phase: 'STALE' }
  | { phase: 'ERROR'; error: RecompositionErrorKind }
);

export type RecompositionAction =
  | { type: 'REQUEST_STARTED' }
  | { type: 'REQUEST_RESOLVED'; generation: number; outcome: RecomposeOutcome }
  | { type: 'ACCEPT_STARTED' }
  | { type: 'ACCEPT_RECONCILING'; generation: number }
  | { type: 'ACCEPT_SUCCEEDED'; generation: number }
  | { type: 'ACCEPT_SAVE_FAILED'; generation: number }
  | { type: 'ACCEPT_UNCONFIRMED'; generation: number }
  | { type: 'ACCEPT_STALE'; generation: number }
  | { type: 'ACCEPT_INVALID'; generation: number }
  /** A committed result whose UI request was already superseded: committed truth still ends any older proposal. */
  | { type: 'COMMITTED_ELSEWHERE' }
  | { type: 'DISMISS' }
  | { type: 'INVALIDATE' }
  | { type: 'RESET' };

export const initialRecompositionState: RecompositionState = { generation: 0, phase: 'IDLE', updated: false };

const idle = (generation: number, updated = false): RecompositionState => ({ generation, phase: 'IDLE', updated });

export function recompositionReducer(state: RecompositionState, action: RecompositionAction): RecompositionState {
  switch (action.type) {
    case 'REQUEST_STARTED':
      // A re-run supersedes any previous proposal/request by moving the generation on; an in-flight accept is never displaced.
      return state.phase === 'ACCEPTING' ? state : { generation: state.generation + 1, phase: 'LOADING' };
    case 'REQUEST_RESOLVED': {
      if (action.generation !== state.generation || state.phase !== 'LOADING') return state; // obsolete response: never reopen an old proposal
      const { outcome } = action;
      if (outcome.kind === 'VIEW') return { generation: state.generation, phase: 'PROPOSAL', view: outcome.view, notice: null };
      return { generation: state.generation, phase: 'ERROR', error: outcome.kind === 'TIMING_FAILED' ? 'TIMING_FAILED' : 'GENERIC' };
    }
    case 'ACCEPT_STARTED':
      return state.phase === 'PROPOSAL' && state.view.kind === 'CHANGES_PROPOSED' ? { generation: state.generation, phase: 'ACCEPTING', view: state.view, reconciling: false } : state;
    case 'ACCEPT_RECONCILING':
      return action.generation === state.generation && state.phase === 'ACCEPTING' ? { ...state, reconciling: true } : state;
    case 'ACCEPT_SUCCEEDED':
      return action.generation === state.generation && state.phase === 'ACCEPTING' ? idle(state.generation, true) : state;
    case 'ACCEPT_SAVE_FAILED':
    case 'ACCEPT_UNCONFIRMED':
      return action.generation === state.generation && state.phase === 'ACCEPTING'
        ? { generation: state.generation, phase: 'PROPOSAL', view: state.view, notice: action.type === 'ACCEPT_SAVE_FAILED' ? 'SAVE_FAILED' : 'UNCONFIRMED' }
        : state;
    case 'ACCEPT_STALE':
      return action.generation === state.generation && state.phase === 'ACCEPTING' ? { generation: state.generation, phase: 'STALE' } : state;
    case 'ACCEPT_INVALID':
      return action.generation === state.generation && state.phase === 'ACCEPTING' ? { generation: state.generation, phase: 'ERROR', error: 'INVALID_TOKEN' } : state;
    case 'COMMITTED_ELSEWHERE':
      return idle(state.generation + 1, true);
    case 'DISMISS':
      return state.phase === 'ACCEPTING' ? state : idle(state.generation + 1);
    case 'INVALIDATE':
      // Also detaches an in-flight accept from the UI (its committed result is still projected, see the store).
      return state.phase === 'IDLE' && !state.updated ? state : idle(state.generation + 1);
    case 'RESET':
      return idle(state.generation + 1);
  }
}

// ---------------------------------------------------------------------------
// Store: owns the async races around the reducer
// ---------------------------------------------------------------------------

export interface RecompositionStoreDeps {
  fetchImpl: typeof fetch;
  /** Project a SERVER-CONFIRMED batch into Home in one update. Never called for anything unconfirmed. */
  applyConfirmedMoves: (moves: ConfirmedMove[]) => void;
  /** Best-effort Home reconciliation (the existing refresh). Rejections are swallowed here: a refresh never decides truth. */
  reconcile: () => Promise<void> | void;
  /** A fresh authoritative read after a lost accept response: true iff every source plan is observed as moved. */
  observeMovedSources: (sourcePlanIds: string[]) => Promise<boolean>;
}

export interface RecompositionStore {
  getState(): RecompositionState;
  subscribe(listener: (state: RecompositionState) => void): () => void;
  /** Explicit user request (F2). Ignored while a request or accept is in flight (synchronous guard). */
  request(): Promise<void>;
  /** Explicit acceptance of the CURRENT proposal. Sends exactly `{ proposalToken }`. Ignored unless a CHANGES_PROPOSED proposal is showing. */
  accept(): Promise<void>;
  dismiss(): void;
  invalidate(): void;
  reset(): void;
  /** True while an accept is in flight (including its reconciliation): conflicting plan mutations must not start. */
  isAccepting(): boolean;
  /** Mount/unmount: a detached store performs no notifications or projections (nothing to show them in). Returns the detach function. */
  attach(): () => void;
}

export const RECOMPOSE_ENDPOINT = '/api/day/recompose';
export const RECOMPOSE_ACCEPT_ENDPOINT = '/api/day/recompose/accept';

export function createRecompositionStore(deps: RecompositionStoreDeps): RecompositionStore {
  let state = initialRecompositionState;
  let attached = true;
  let acceptInFlight = false;
  const listeners = new Set<(s: RecompositionState) => void>();

  const dispatch = (action: RecompositionAction) => {
    const next = recompositionReducer(state, action);
    if (next === state) return;
    state = next;
    if (attached) for (const listener of [...listeners]) listener(state);
  };
  const reconcile = async () => {
    try {
      await deps.reconcile();
    } catch {
      // last valid Home stays
    }
  };
  const project = (moves: ConfirmedMove[]) => {
    if (attached) deps.applyConfirmedMoves(moves);
  };

  const request = async () => {
    if (acceptInFlight || state.phase === 'LOADING' || state.phase === 'ACCEPTING') return;
    dispatch({ type: 'REQUEST_STARTED' });
    const generation = state.generation;
    let outcome: RecomposeOutcome;
    try {
      const res = await deps.fetchImpl(RECOMPOSE_ENDPOINT, { method: 'POST' });
      const body = await res.json().catch(() => null);
      outcome = parseRecomposeResponse(res.ok, body);
    } catch {
      outcome = { kind: 'ERROR' };
    }
    dispatch({ type: 'REQUEST_RESOLVED', generation, outcome });
  };

  const accept = async () => {
    const start = state;
    if (acceptInFlight || start.phase !== 'PROPOSAL' || start.view.kind !== 'CHANGES_PROPOSED') return;
    const view = start.view;
    const generation = start.generation;
    acceptInFlight = true; // synchronous: a second click in the same task sees this before any re-render
    const sourceIds = view.moves.map((m) => m.planId);
    dispatch({ type: 'ACCEPT_STARTED' });
    try {
      let outcome: AcceptOutcome;
      try {
        const res = await deps.fetchImpl(RECOMPOSE_ACCEPT_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposalToken: view.proposalToken }),
        });
        const body = await res.json().catch(() => null);
        outcome = parseAcceptResponse(res.ok, body, sourceIds);
      } catch {
        outcome = { kind: 'UNKNOWN' };
      }
      const isCurrent = () => state.generation === generation && state.phase === 'ACCEPTING';

      if (outcome.kind === 'COMMITTED') {
        // Committed server truth is projected even if the UI moved on (dismiss/invalidate/re-run) while it was in flight.
        const current = isCurrent();
        project(outcome.moves);
        dispatch(current ? { type: 'ACCEPT_SUCCEEDED', generation } : { type: 'COMMITTED_ELSEWHERE' });
        await reconcile();
      } else if (outcome.kind === 'UNKNOWN') {
        // The server may have committed before the answer was lost: never claim failure. Refresh, then look.
        if (isCurrent()) dispatch({ type: 'ACCEPT_RECONCILING', generation });
        await reconcile();
        let observed = false;
        try {
          observed = await deps.observeMovedSources(sourceIds);
        } catch {
          observed = false;
        }
        if (observed) dispatch(isCurrent() ? { type: 'ACCEPT_SUCCEEDED', generation } : { type: 'COMMITTED_ELSEWHERE' });
        else dispatch({ type: 'ACCEPT_UNCONFIRMED', generation }); // same token stays retryable (F3 is state-idempotent)
      } else if (outcome.kind === 'SAVE_FAILED') {
        dispatch({ type: 'ACCEPT_SAVE_FAILED', generation });
      } else if (outcome.kind === 'STALE') {
        dispatch({ type: 'ACCEPT_STALE', generation });
        await reconcile();
      } else {
        dispatch({ type: 'ACCEPT_INVALID', generation });
        await reconcile();
      }
    } finally {
      acceptInFlight = false;
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    request,
    accept,
    dismiss: () => dispatch({ type: 'DISMISS' }),
    invalidate: () => dispatch({ type: 'INVALIDATE' }),
    reset: () => dispatch({ type: 'RESET' }),
    isAccepting: () => acceptInFlight,
    attach() {
      attached = true;
      return () => {
        attached = false;
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export function formatRecompositionTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

export interface PresentedMove {
  key: string;
  title: string;
  from: string;
  to: string;
  /** "Finish presentation, from 2:00 PM to 3:30 PM" -- the readable equivalent of the visual arrow. */
  accessibleText: string;
}

export function presentMove(move: RecompositionMoveRow, timezone: string): PresentedMove {
  const from = formatRecompositionTime(move.fromIso, timezone);
  const to = formatRecompositionTime(move.toIso, timezone);
  return { key: move.planId, title: move.title, from, to, accessibleText: `${move.title}, from ${from} to ${to}` };
}

/** "3 things stay as they are" -- null when nothing stays (never a "0 things" line). */
export function keepSummary(keepCount: number): string | null {
  if (keepCount <= 0) return null;
  return keepCount === 1 ? '1 thing stays as it is' : `${keepCount} things stay as they are`;
}

/** Plain reason an unresolved item needs the user: its current time no longer works and nothing else fits today. */
export function unresolvedText(row: RecompositionUnresolvedRow, timezone: string): string {
  return `${row.title}, at ${formatRecompositionTime(row.atIso, timezone)}. This time no longer works and nothing else fits today.`;
}

/**
 * Presentation heuristic ONLY (F2 stays authoritative about what can actually change): today's view, something still
 * upcoming, and no conflicting Home mutation/accept running. It does NOT inspect scheduling flexibility.
 */
export function shouldOfferRecomposition(input: {
  agendaLocalDate: string | null | undefined;
  now: Date;
  timezone: string;
  items: ReadonlyArray<{ kind: string; planned: boolean; metadata?: { agendaStatus?: string } }>;
  mutationInFlight: boolean;
}): boolean {
  if (input.mutationInFlight || !input.agendaLocalDate) return false;
  if (input.agendaLocalDate !== getDatePartsInTimezone(input.timezone, input.now).dateStr) return false;
  return input.items.some((item) => item.kind === 'PLAN' && item.planned && (item.metadata?.agendaStatus === 'UPCOMING' || item.metadata?.agendaStatus === 'STARTING_SOON'));
}
