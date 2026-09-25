/**
 * Daily Experience V1 PR B -- complete a committed plan from Home.
 *
 * Home is another ACCESS POINT to the existing PlannedActivity logging
 * lifecycle (POST /api/plans/[planId]/log -> logPlannedActivity, db.ts): the
 * same route, transaction, HabitLog, Capture.completedAt materialization and
 * derived GoalActivity completion the Plan tab already uses. Nothing here
 * defines completion, generates a timestamp, or synchronizes a source
 * object. Pure/injectable so it is testable without a component harness.
 */
import type { HomeTimelineItem } from './homeTimelineTypes';
import type { RightNowState } from './rightNowSelection';
import type { DailyAgenda, DailyAgendaItem } from './dailyAgenda';
import { parseMoveResponse, type MoveOutcome } from './homeMove';

/** DailyAgenda projects a plan as `plan:<PlannedActivity.id>` (dailyAgenda.ts). Returns null for anything else. */
export function planIdFromTimelineItem(item: HomeTimelineItem): string | null {
  if (item.source !== 'PLAN' || !item.id.startsWith('plan:')) return null;
  const id = item.id.slice('plan:'.length);
  return id.length > 0 ? id : null;
}

/** Done is offered only for a committed plan Right Now is showing (active, or imminent -- the existing log route already accepts an UPCOMING plan early). Never for an Opportunity or the context state. */
export function completablePlanId(state: RightNowState): string | null {
  if (state.kind !== 'ACTIVE_PLAN' && state.kind !== 'IMMINENT_PLAN') return null;
  return planIdFromTimelineItem(state.item);
}

/** Daily Experience V1 PR C2 -- the server-CONFIRMED execution outcome of a plan, held by Home until the authoritative refresh catches up (or fails). Deliberately two values, not a generic "resolved": Done and Skip stay distinct facts. */
export type ExecutionOutcome = 'COMPLETED' | 'SKIPPED' | 'MOVED';

/** Skip is offered only for the committed plan that is happening NOW (Right Now's absolute-instant ACTIVE_PLAN). Never for an imminent plan, an Opportunity, the context state, or anything already resolved. */
export function skippablePlanId(state: RightNowState): string | null {
  if (state.kind !== 'ACTIVE_PLAN') return null;
  return planIdFromTimelineItem(state.item);
}

/** Move is offered for a committed plan Right Now is showing -- active or imminent (D2's domain also allows missed, but Home exposure for that is a later slice). Never for an Opportunity, the context state, or anything resolved. */
export function moveablePlanId(state: RightNowState): string | null {
  if (state.kind !== 'ACTIVE_PLAN' && state.kind !== 'IMMINENT_PLAN') return null;
  return planIdFromTimelineItem(state.item);
}

/** Overlays CONFIRMED execution outcomes onto the composed timeline so the day stays truthful even if the follow-up agenda refresh fails, is slow, or returns stale data. Only marks the confirmed plans; everything else is untouched. COMPLETED and SKIPPED keep distinct agendaStatus values. */
export function overlayExecutionFacts(timeline: HomeTimelineItem[], facts: ReadonlyMap<string, ExecutionOutcome>): HomeTimelineItem[] {
  if (facts.size === 0) return timeline;
  return timeline.map((item) => {
    const planId = planIdFromTimelineItem(item);
    const outcome = planId ? facts.get(planId) : undefined;
    if (!outcome) return item;
    if (outcome === 'COMPLETED') {
      if (item.metadata?.isCompleted) return item;
      return { ...item, metadata: { ...item.metadata, agendaStatus: 'COMPLETED', isCompleted: true, isCurrent: false, isPast: true } };
    }
    const status = outcome === 'MOVED' ? 'MOVED' : 'SKIPPED';
    if (item.metadata?.agendaStatus === status) return item;
    return { ...item, metadata: { ...item.metadata, agendaStatus: status, isCompleted: false, isCurrent: false, isPast: true } };
  });
}

/** PR B's completion-only overlay, kept as the single-outcome form its suite exercises. */
export function overlayLoggedPlans(timeline: HomeTimelineItem[], loggedPlanIds: ReadonlySet<string>): HomeTimelineItem[] {
  return overlayExecutionFacts(timeline, new Map([...loggedPlanIds].map((id): [string, ExecutionOutcome] => [id, 'COMPLETED'])));
}

const NEXT_ITEM_STATUSES = new Set(['UPCOMING', 'STARTING_SOON', 'WAITING', 'CONFIRMED']);

function planIdFromAgendaItem(item: DailyAgendaItem): string | null {
  if (item.type !== 'PLAN' || !item.id.startsWith('plan:')) return null;
  const id = item.id.slice('plan:'.length);
  return id.length > 0 ? id : null;
}

/** A plan with a confirmed outcome must not remain the agenda's "next" item. Replaces it with the next eligible unresolved item (or none); a next item that is not a resolved plan is returned untouched. */
export function agendaWithoutResolvedNext(agenda: DailyAgenda | null | undefined, facts: { has(planId: string): boolean }): DailyAgenda | null | undefined {
  const next = agenda?.nextItem;
  if (!agenda || !next) return agenda;
  const nextPlanId = planIdFromAgendaItem(next);
  if (!nextPlanId || !facts.has(nextPlanId)) return agenda;
  const replacement = agenda.items.find((item) => {
    if (!NEXT_ITEM_STATUSES.has(item.status)) return false;
    const id = planIdFromAgendaItem(item);
    return !(id && facts.has(id));
  });
  return { ...agenda, nextItem: replacement };
}

export interface CompletionError {
  planId: string;
  message: string;
}

/** A completion error belongs to the plan that failed: it is shown only while THAT plan is the one Done would act on. */
export function visibleCompletionError(error: CompletionError | null, currentPlanId: string | null): string | null {
  return error && currentPlanId !== null && error.planId === currentPlanId ? error.message : null;
}

export type CompletePlanResult = 'DONE' | 'FAILED' | 'BUSY';
export type SkipPlanResult = 'SKIPPED' | 'FAILED' | 'BUSY';

/**
 * One execution-action submitter per Home instance, shared by Done and Skip.
 * `inFlight` is a single closure Set keyed by plan id, so a second action --
 * of EITHER kind -- for the same plan in the SAME task sees the first (React
 * state would not) and never issues a competing request. Success requires
 * the server to report the plan in the expected terminal state (LOGGED for
 * Done, SKIPPED for Skip); anything else is FAILED.
 */
export function createPlanExecutor(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const inFlight = new Set<string>();
  const run = async <R extends string>(planId: string, action: 'log' | 'skip', expectedStatus: 'LOGGED' | 'SKIPPED', success: R): Promise<R | 'FAILED' | 'BUSY'> => {
    if (inFlight.has(planId)) return 'BUSY';
    inFlight.add(planId);
    try {
      const res = await fetchImpl(`/api/plans/${encodeURIComponent(planId)}/${action}`, { method: 'POST' });
      if (!res.ok) return 'FAILED';
      const body = await res.json().catch(() => null);
      return body?.plan?.status === expectedStatus ? success : 'FAILED';
    } catch {
      return 'FAILED';
    } finally {
      inFlight.delete(planId);
    }
  };
  return {
    isBusy: (planId: string) => inFlight.has(planId),
    complete: (planId: string): Promise<CompletePlanResult> => run(planId, 'log', 'LOGGED', 'DONE'),
    skip: (planId: string): Promise<SkipPlanResult> => run(planId, 'skip', 'SKIPPED', 'SKIPPED'),
    /** Move shares the SAME synchronous per-plan guard as Done and Skip. */
    move: async (planId: string, newStartAt: string): Promise<MoveOutcome | { status: 'BUSY' }> => {
      if (inFlight.has(planId)) return { status: 'BUSY' };
      inFlight.add(planId);
      try {
        const res = await fetchImpl(`/api/plans/${encodeURIComponent(planId)}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newStartAt }),
        });
        const body = await res.json().catch(() => null);
        return parseMoveResponse(planId, res.ok, body);
      } catch {
        return { status: 'FAILED' };
      } finally {
        inFlight.delete(planId);
      }
    },
  };
}

/** PR B's completion-only submitter form, backed by the shared executor. */
export function createPlanCompleter(fetchImpl?: typeof fetch) {
  return createPlanExecutor(fetchImpl).complete;
}
