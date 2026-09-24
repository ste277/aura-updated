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

/** Overlays a CONFIRMED completion onto the composed timeline so the day stays truthful even if the follow-up agenda refresh fails or is slow. Only marks the confirmed plans; everything else is untouched. */
export function overlayLoggedPlans(timeline: HomeTimelineItem[], loggedPlanIds: ReadonlySet<string>): HomeTimelineItem[] {
  if (loggedPlanIds.size === 0) return timeline;
  return timeline.map((item) => {
    const planId = planIdFromTimelineItem(item);
    if (!planId || !loggedPlanIds.has(planId) || item.metadata?.isCompleted) return item;
    return { ...item, metadata: { ...item.metadata, agendaStatus: 'COMPLETED', isCompleted: true, isCurrent: false, isPast: true } };
  });
}

export type CompletePlanResult = 'DONE' | 'FAILED' | 'BUSY';

/**
 * One submitter per Home instance. `inFlight` is a closure Set, so a second
 * call for the same plan in the SAME task sees the first (React state would
 * not). Success requires the server to report the plan as LOGGED.
 */
export function createPlanCompleter(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const inFlight = new Set<string>();
  return async function complete(planId: string): Promise<CompletePlanResult> {
    if (inFlight.has(planId)) return 'BUSY';
    inFlight.add(planId);
    try {
      const res = await fetchImpl(`/api/plans/${encodeURIComponent(planId)}/log`, { method: 'POST' });
      if (!res.ok) return 'FAILED';
      const body = await res.json().catch(() => null);
      return body?.plan?.status === 'LOGGED' ? 'DONE' : 'FAILED';
    } catch {
      return 'FAILED';
    } finally {
      inFlight.delete(planId);
    }
  };
}
