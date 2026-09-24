/**
 * Home Timeline Composer V1.
 *
 * Pure presentation/composition layer only -- see the "AURA -- HOME
 * INFORMATION ARCHITECTURE V2" architecture audit's own verdict and this
 * PR's own ticket for the full rationale. This module owns exactly:
 *   - presentation projection (DailyAgendaItem/DailyGuidanceRecommendation
 *     -> HomeTimelineItem)
 *   - the cross-surface join (a PLAN-sourced recommendation annotates its
 *     already-existing DailyAgenda Plan row; it never becomes a second row)
 *   - chronological composition and deterministic same-start tie-breaking
 *   - source precedence (Plan > Moment > Completed activity > Opportunity
 *     > Context window)
 *   - status-vocabulary mapping (EXCELLENT/VERY_GOOD/GOOD/USABLE/CAUTION
 *     -> Best/Good/Workable/Caution)
 *   - lightweight current/past classification, driven only by the
 *     caller's own `currentMinuteOfDay` (never `Date.now()`)
 *   - partial degradation (agenda null, guidance null, both null, both
 *     empty -- every combination is a valid, non-error input)
 *
 * It does NOT own, and never imports/calls: recommendation selection
 * (`buildPersonalDailyGuidance`), personal relevance/timing quality/
 * Panchang/Muhurta calculation, Plan eligibility, behavioral scoring, Day
 * Builder intent selection, or Why Aura explanation generation
 * (`buildWhyAuraExplanation`) -- PR B builds explanations lazily, on
 * expansion, from the original `DailyGuidanceContext` this module already
 * received, never from this file's own output.
 *
 * DEDUPE TRUST (merge-critical): `dailyGuidanceCandidates.ts`'s own
 * `dedupeCandidates` has already removed a Day-Builder-sourced candidate
 * for any `activityId` a real Plan already covers, before this module
 * ever sees `guidance.recommendations`. This module never re-implements
 * or re-verifies that removal -- its only new responsibility is the join
 * (matching a PLAN-sourced recommendation to its already-existing
 * DailyAgenda row via `sourceEntityId` <-> `target.id`), never a second
 * dedupe pass.
 *
 * PURITY (mandatory): no React/DOM/window/document imports, no fetch, no
 * DB, no `Date.now()`/no-argument `new Date()`, no `Math.random()`, no
 * mutation of any input argument (`agenda.items`, `guidance.recommendations`,
 * `timelineWindows` are only ever read, cloned before sort, never mutated
 * or reordered in place).
 */
import type { DailyAgendaItem } from './dailyAgenda';
import type { DailyGuidanceRecommendation } from '../../../packages/personal-intelligence/src/context';
import type { SelectedActivityMetadata } from './dailyGuidanceTypes';
import { getMinuteOfDayInTimezone, localDateTimeToUTC } from './timezone';
import type {
  BuildHomeTimelineInput,
  HomeTimelineAction,
  HomeTimelineContextWindow,
  HomeTimelineContextWindowType,
  HomeTimelineItem,
  HomeTimelineItemMetadata,
  HomeTimelineStatus,
} from './homeTimelineTypes';

/** Product composition policy (architecture audit's own §66/§68), not a visual styling choice -- enforced here so PR B never has to re-derive it. */
const MAX_OPPORTUNITIES = 3;
const MAX_CONTEXT_WINDOWS = 2;

/** Same-start tie-break (see this module's own doc comment, "source precedence"). Lower sorts first. */
const KIND_PRIORITY: Record<HomeTimelineItem['kind'], number> = {
  PLAN: 0,
  MOMENT: 1,
  COMPLETED_ACTIVITY: 2,
  OPPORTUNITY: 3,
  CONTEXT_WINDOW: 4,
};

/**
 * Exhaustive, pure mapping from #103/#104's own internal timing-label
 * vocabulary to Home's product-facing status vocabulary. A
 * `DailyGuidanceRecommendation` never actually carries a `CAUTION` label
 * in V1 (CAUTION-labeled timing is never eligible for a recommendation at
 * all -- see `DailyGuidanceSelectionReason`'s own doc comment in
 * packages/personal-intelligence/src/context.ts), but this mapping still
 * covers it so the helper stays exhaustive rather than silently returning
 * `undefined` for a label that later becomes reachable. An unrecognized
 * label (contract drift) also returns `undefined` rather than guessing --
 * never `HIGHLY_RELEVANT`/`RELEVANT`/`BASELINE` (personal relevance) or
 * behavioral-affinity tiers, which are never valid inputs to this helper.
 */
export function mapTimingLabelToHomeStatus(label: string | undefined): HomeTimelineStatus | undefined {
  switch (label) {
    case 'EXCELLENT':
    case 'VERY_GOOD':
      return 'Best';
    case 'GOOD':
      return 'Good';
    case 'USABLE':
      return 'Workable';
    case 'CAUTION':
      return 'Caution';
    default:
      return undefined;
  }
}

function minuteOfDayFromIso(iso: string, timezone: string): number {
  return getMinuteOfDayInTimezone(timezone, new Date(iso));
}

function minutesToHHMM(minute: number): string {
  const normalized = ((Math.floor(minute) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** `endMinute` defaults to `startMinute` for a point-in-time item (e.g. a HabitLog with no `endAt`) -- current/past classification never throws on a missing end. Both bounds inclusive, so a zero-duration point event is classified `isCurrent` exactly at its own minute. */
function classifyCurrent(startMinute: number, endMinute: number | undefined, currentMinuteOfDay: number): { isCurrent: boolean; isPast: boolean } {
  const effectiveEnd = endMinute ?? startMinute;
  return {
    isCurrent: startMinute <= currentMinuteOfDay && currentMinuteOfDay <= effectiveEnd,
    isPast: effectiveEnd < currentMinuteOfDay,
  };
}

function agendaActionFor(item: DailyAgendaItem): HomeTimelineAction | undefined {
  if (item.type === 'PLAN') return { label: 'View', kind: 'VIEW_PLAN' };
  if (item.type === 'MOMENT') return { label: 'View', kind: 'VIEW_MOMENT' };
  // COMPLETED_ACTIVITY (a raw HabitLog): no dedicated view route exists
  // today -- dailyAgenda.ts's own DailyAgendaItem doc comment already
  // notes HABIT_LOG items have no dedicated permalink. Never a fabricated
  // action.
  return undefined;
}

function projectAgendaItem(item: DailyAgendaItem, currentMinuteOfDay: number, timezone: string): HomeTimelineItem {
  const kind: HomeTimelineItem['kind'] = item.type;
  const source: HomeTimelineItem['source'] = item.type === 'PLAN' ? 'PLAN' : item.type === 'MOMENT' ? 'MOMENT' : 'HABIT_LOG';
  // PLAN/MOMENT are always a real commitment; COMPLETED_ACTIVITY is a
  // spontaneous, already-happened log that was never scheduled ahead of
  // time -- see this module's own "planned" semantics.
  const planned = item.type !== 'COMPLETED_ACTIVITY';

  const startMinute = minuteOfDayFromIso(item.startAt, timezone);
  const endMinute = item.endAt ? minuteOfDayFromIso(item.endAt, timezone) : undefined;
  const temporal = classifyCurrent(startMinute, endMinute, currentMinuteOfDay);
  // Lifecycle completion always wins over a purely temporal read (pre-PR
  // review §34-36): a Plan already logged early -- or an elapsed, unlogged
  // MISSED Plan -- must never render as "current" just because `now`
  // still falls inside its nominal window. Only these two already-resolved
  // agenda statuses override; every other status (UPCOMING/STARTING_SOON/
  // CURRENT/WAITING/CONFIRMED) stays purely temporal.
  const lifecycleResolved = item.status === 'COMPLETED' || item.status === 'MISSED';
  const isCurrent = lifecycleResolved ? false : temporal.isCurrent;
  const isPast = lifecycleResolved ? true : temporal.isPast;

  const metadata: HomeTimelineItemMetadata = {
    agendaStatus: item.status,
    durationMinutes: item.durationMinutes,
    isCurrent,
    isPast,
    isCompleted: item.status === 'COMPLETED',
    ...(startMinute > currentMinuteOfDay ? { startsInMinutes: startMinute - currentMinuteOfDay } : {}),
  };

  return {
    id: item.id,
    kind,
    start: item.startAt,
    end: item.endAt,
    title: item.title,
    icon: item.icon,
    planned,
    source,
    primaryAction: agendaActionFor(item),
    metadata,
  };
}

/**
 * Looks up a recommendation's concrete activity via `selectedActivities`
 * -- the exact same join `bestForYouViewModel.ts`'s own
 * `mapGuidanceToBestForYouItems` performs. Returns `undefined` (never a
 * guessed `source`/`sourceEntityId`/title) when the entry is missing. A
 * real `buildPersonalDailyGuidance` result never produces this miss (the
 * "recommendation-only metadata" contract), but unlike
 * `bestForYouViewModel.ts` -- where a join miss only affects display text
 * -- this value also decides which branch (Plan annotation vs. opportunity
 * row) the caller takes below, so a guessed default here would be a real
 * correctness risk, not a cosmetic one. Fail closed: the caller skips the
 * recommendation entirely rather than fabricate a match (pre-PR review
 * §17/§19/§45/§46).
 */
function resolveActivity(recommendation: DailyGuidanceRecommendation, selectedActivities: Record<string, SelectedActivityMetadata>): SelectedActivityMetadata | undefined {
  return selectedActivities[recommendation.activityFamily];
}

/** `sourceEntityId` is a required, always-real field on a genuine `SelectedActivityMetadata` (never intentionally empty) -- the empty-string fallback below is defensive only, guarding a malformed entry the type system doesn't itself rule out, never a real-world path. */
function buildOpportunityId(sourceEntityId: string, activityFamily: string, start: string): string {
  return sourceEntityId ? `guidance:${sourceEntityId}` : `guidance:${activityFamily}:${start}`;
}

function projectOpportunity(recommendation: DailyGuidanceRecommendation, resolved: SelectedActivityMetadata, currentMinuteOfDay: number, timezone: string): HomeTimelineItem {
  const { start, end } = recommendation.timing;
  const startMinute = minuteOfDayFromIso(start, timezone);
  const endMinute = minuteOfDayFromIso(end, timezone);
  const { isCurrent, isPast } = classifyCurrent(startMinute, endMinute, currentMinuteOfDay);
  // Derivable directly from the recommendation's own already-resolved
  // window (basic arithmetic on data already in hand) -- not new
  // duration-source plumbing; see this PR's own ticket §26 on why that
  // stays deferred to PR B.
  const durationMinutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);

  return {
    id: buildOpportunityId(resolved.sourceEntityId, recommendation.activityFamily, start),
    kind: 'OPPORTUNITY',
    start,
    end,
    title: resolved.title,
    planned: false,
    source: 'DAY_BUILDER_INTENTION',
    rank: recommendation.rank,
    status: mapTimingLabelToHomeStatus(recommendation.timing.label),
    primaryAction: { label: 'Plan', kind: 'PLAN_OPPORTUNITY' },
    metadata: {
      activityId: resolved.activityId,
      sourceEntityId: resolved.sourceEntityId,
      durationMinutes,
      personalRelevance: recommendation.personalRelevance,
      timingLabel: recommendation.timing.label,
      selectionReason: recommendation.selectionReason,
      behavioralAffinity: resolved.behavioralAffinity,
      isCurrent,
      isPast,
    },
  };
}

/** Includes `label` alongside type/start/end (pre-PR review §30) -- purely defensive: two real Panchang windows sharing an identical type/start/end but a different label are not known to occur given today's `mappedTimelineWindows` construction, but the extra discriminator costs nothing and removes any doubt. */
function contextWindowId(window: HomeTimelineContextWindow): string {
  return `context:${window.type}:${window.startMinute}:${window.endMinute}:${window.label}`;
}

/**
 * Deliberately NOT `'Good'` for `'auspicious'` (pre-PR review §31): a
 * context band is ambient astrological framing, never a personal
 * recommendation, and labeling it with the same product-facing status a
 * real Best-For-You row can carry would blur that distinction. Only
 * `'friction'` carries a real status today -- a caution band's whole
 * purpose is an explicit warning, which is exactly what `'Caution'`
 * communicates.
 */
function contextStatus(type: HomeTimelineContextWindowType): HomeTimelineStatus | undefined {
  if (type === 'friction') return 'Caution';
  return undefined; // 'auspicious' and 'neutral' both render with no status badge; 'neutral' never reaches here regardless (filtered out by selectContextWindows before projection)
}

/**
 * Selects at most the currently-active relevant window plus the nearest
 * future relevant window (architecture audit's own §29/§30/§68 rule) --
 * never a full-day context list, never a past-only window. 'neutral'
 * windows are never eligible context (§28). Deduped by deterministic
 * context id (§69) purely defensively -- active/future are mutually
 * exclusive by construction (`start <= current < end` vs `start > current`),
 * so this only guards against an literal input duplicate.
 */
function selectContextWindows(windows: readonly HomeTimelineContextWindow[] | undefined, currentMinuteOfDay: number): HomeTimelineContextWindow[] {
  const relevant = (windows ?? []).filter((window) => window.type !== 'neutral');

  const active = relevant.find((window) => window.startMinute <= currentMinuteOfDay && currentMinuteOfDay < window.endMinute);
  const future = relevant
    .filter((window) => window.startMinute > currentMinuteOfDay)
    .reduce<HomeTimelineContextWindow | undefined>((nearest, window) => (!nearest || window.startMinute < nearest.startMinute ? window : nearest), undefined);

  const selected: HomeTimelineContextWindow[] = [];
  const seenIds = new Set<string>();
  for (const candidate of [active, future]) {
    if (!candidate) continue;
    const id = contextWindowId(candidate);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    selected.push(candidate);
  }
  return selected.slice(0, MAX_CONTEXT_WINDOWS);
}

/** Returns `null` (never a fabricated ISO string) when no calendar-date anchor is available -- see `BuildHomeTimelineInput.localDate`'s own doc comment. */
function projectContextWindow(window: HomeTimelineContextWindow, currentMinuteOfDay: number, localDate: string | undefined, timezone: string): HomeTimelineItem | null {
  if (!localDate) return null;
  const start = localDateTimeToUTC(localDate, minutesToHHMM(window.startMinute), timezone).toISOString();
  const end = localDateTimeToUTC(localDate, minutesToHHMM(window.endMinute), timezone).toISOString();
  const { isCurrent, isPast } = classifyCurrent(window.startMinute, window.endMinute, currentMinuteOfDay);

  return {
    id: contextWindowId(window),
    kind: 'CONTEXT_WINDOW',
    start,
    end,
    title: window.label,
    planned: false,
    source: 'PANCHANG',
    status: contextStatus(window.type),
    metadata: { isCurrent, isPast },
  };
}

/**
 * Clones before sorting (never mutates the composer's own already-built
 * `items` array in place, matching this module's own input-immutability
 * discipline). `Array.prototype.sort` is spec-guaranteed stable, so
 * agenda's own pre-sorted relative order (see dailyAgenda.ts's own
 * `buildDailyAgenda`) survives untouched for any remaining tie beyond kind
 * priority -- this happens to already match `buildDailyAgenda`'s own
 * implicit push order (Plans, then Moments, then HabitLogs, all before its
 * own single stable sort) for items sharing an exact start, so
 * `KIND_PRIORITY` reinforces that existing order rather than overriding
 * it. Deliberately no further ID-based tie-break beyond kind+start (pre-PR
 * review §43): one would risk reordering two same-kind agenda rows that
 * `DailyAgenda` itself deliberately placed in a specific relative order
 * (e.g. DB insertion order) for no product benefit.
 */
function stableChronologicalSort(items: readonly HomeTimelineItem[]): HomeTimelineItem[] {
  return [...items].sort((a, b) => {
    const startDiff = new Date(a.start).getTime() - new Date(b.start).getTime();
    if (startDiff !== 0) return startDiff;
    return KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
  });
}

/**
 * Composes one deterministic, chronological Home timeline from already-
 * computed inputs. See this module's own doc comment for the full
 * ownership boundary. Never throws on missing/empty input -- every
 * combination of `agenda`/`guidance` null/empty is a valid result, per
 * this PR's own ticket §36-40.
 */
export function buildHomeTimeline(input: BuildHomeTimelineInput): HomeTimelineItem[] {
  const { agenda, guidance, timelineWindows, currentMinuteOfDay, timezone } = input;
  const selectedActivities = input.selectedActivities ?? {};
  const localDate = input.localDate ?? agenda?.localDate;

  const items: HomeTimelineItem[] = [];
  const planItemsByTargetId = new Map<string, HomeTimelineItem>();

  for (const agendaItem of agenda?.items ?? []) {
    const projected = projectAgendaItem(agendaItem, currentMinuteOfDay, timezone);
    items.push(projected);
    if (agendaItem.type === 'PLAN') {
      planItemsByTargetId.set(agendaItem.target.id, projected);
    }
  }

  if (guidance) {
    const opportunityCandidates: Array<{ recommendation: DailyGuidanceRecommendation; resolved: SelectedActivityMetadata }> = [];
    const planAnnotationRankByItemId = new Map<string, number>();

    for (const recommendation of guidance.recommendations) {
      const resolved = resolveActivity(recommendation, selectedActivities);
      if (!resolved) continue; // no concrete activity identity -- never guess, never render (resolveActivity's own doc comment)

      if (resolved.source === 'DAY_BUILDER_INTENTION') {
        opportunityCandidates.push({ recommendation, resolved });
        continue;
      }

      // PLAN-sourced: annotate the matching agenda row only -- see this
      // module's own "DEDUPE TRUST" doc comment for why no second row is
      // ever created here.
      const planItem = planItemsByTargetId.get(resolved.sourceEntityId);
      if (!planItem) continue; // structurally shouldn't happen; never fabricate a row for it

      const existingRank = planAnnotationRankByItemId.get(planItem.id);
      if (existingRank !== undefined && existingRank <= recommendation.rank) continue; // lowest rank wins (defensive; see ticket §65)
      planAnnotationRankByItemId.set(planItem.id, recommendation.rank);

      planItem.rank = recommendation.rank;
      planItem.status = mapTimingLabelToHomeStatus(recommendation.timing.label);
      planItem.metadata = {
        ...planItem.metadata,
        activityId: resolved.activityId,
        sourceEntityId: resolved.sourceEntityId,
        personalRelevance: recommendation.personalRelevance,
        timingLabel: recommendation.timing.label,
        selectionReason: recommendation.selectionReason,
        behavioralAffinity: resolved.behavioralAffinity,
      };
    }

    // Top-N by guidance's own existing rank (never re-ranked here), THEN
    // merged chronologically by the final sort below -- see ticket §66/§67.
    // `rank` is a required field on `DailyGuidanceRecommendation` (never
    // missing) and is documented as "1-based, in final selection order" --
    // duplicate/non-contiguous ranks aren't expected, but even if they
    // occurred this sort degrades deterministically (stable, first-seen
    // wins an exact tie), never throws or produces nondeterministic order
    // (pre-PR review §21).
    const topOpportunities = [...opportunityCandidates].sort((a, b) => a.recommendation.rank - b.recommendation.rank).slice(0, MAX_OPPORTUNITIES);

    for (const { recommendation, resolved } of topOpportunities) {
      items.push(projectOpportunity(recommendation, resolved, currentMinuteOfDay, timezone));
    }
  }

  for (const window of selectContextWindows(timelineWindows, currentMinuteOfDay)) {
    const contextItem = projectContextWindow(window, currentMinuteOfDay, localDate, timezone);
    if (contextItem) items.push(contextItem);
  }

  return stableChronologicalSort(items);
}
