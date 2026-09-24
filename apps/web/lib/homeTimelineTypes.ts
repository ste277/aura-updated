/**
 * Home Timeline Composer V1 -- presentation-only types.
 *
 * `HomeTimelineItem` is a projection, never a domain model: it carries no
 * astrology, no recommendation-selection logic, no raw evidence/score.
 * Every field is either copied verbatim from an already-computed upstream
 * result (`DailyAgenda`, `DailyGuidanceContext`) or derived by pure,
 * deterministic mapping (status vocabulary, chronological classification)
 * -- see homeTimelineComposer.ts's own module doc comment for the full
 * ownership boundary this PR is scoped to.
 */
import type { DailyAgenda, DailyAgendaItemStatus } from './dailyAgenda';
import type { DailyGuidanceContext } from '../../../packages/personal-intelligence/src/context';
import type { SelectedActivityMetadata } from './dailyGuidanceTypes';
import type { BehavioralAffinityTier } from '../../../packages/daily-guidance/src/types';

export type HomeTimelineItemKind = 'PLAN' | 'MOMENT' | 'COMPLETED_ACTIVITY' | 'OPPORTUNITY' | 'CONTEXT_WINDOW';

export type HomeTimelineSource = 'PLAN' | 'MOMENT' | 'HABIT_LOG' | 'DAY_BUILDER_INTENTION' | 'PANCHANG';

/**
 * Product-facing timing-quality vocabulary -- see
 * homeTimelineComposer.ts's `mapTimingLabelToHomeStatus` for the
 * exhaustive internal-label mapping this replaces. Never
 * `HIGHLY_RELEVANT`/`RELEVANT`/`BASELINE` (personal relevance) or
 * `STRONG`/`MODERATE`/`NEUTRAL` (behavioral affinity) -- those stay
 * metadata-only, see `HomeTimelineItemMetadata` below.
 */
export type HomeTimelineStatus = 'Best' | 'Good' | 'Workable' | 'Caution';

export type HomeTimelineContextWindowType = 'friction' | 'auspicious' | 'neutral';

/**
 * The composer's own minimal presentation-input contract for a Panchang
 * window -- deliberately not importing `page.tsx`'s local, unexported
 * `mappedTimelineWindows` shape (adapting that into this contract is a
 * PR B wiring concern). Minute-of-day values, matching Panchang's own
 * internal convention (and `page.tsx`'s own `startMinute`/`endMinute`
 * fields) -- the composer converts to a real ISO instant only when it has
 * a calendar date to anchor them to (see `BuildHomeTimelineInput.localDate`).
 *
 * INVARIANT: `startMinute`/`endMinute` both fall within a single local day
 * (`0 <= startMinute < endMinute <= 1440`) -- a window spanning midnight is
 * not representable here. This matches `page.tsx`'s own
 * `mappedTimelineWindows` construction exactly (every real window/gap is
 * explicitly clamped to `[0, 1440)` and never wraps), so the case is
 * structurally impossible given today's only real producer of this
 * contract. The composer does not implement midnight-rollover semantics;
 * do not construct a wrapping window contrary to this invariant.
 */
export interface HomeTimelineContextWindow {
  label: string;
  startMinute: number;
  endMinute: number;
  type: HomeTimelineContextWindowType;
}

export interface HomeTimelineAction {
  label: string;
  kind: 'VIEW_PLAN' | 'VIEW_MOMENT' | 'PLAN_OPPORTUNITY';
}

/**
 * Typed metadata bag -- deliberately not `Record<string, unknown>` (every
 * field the composer can populate is known ahead of time). Never carries
 * raw `PersonalEvidenceRef[]`/timing `score`/theme evidence -- Why Aura
 * (PR B) derives its own explanation lazily from the original
 * `DailyGuidanceContext` this module already received, never from this
 * file's own output.
 */
export interface HomeTimelineItemMetadata {
  activityId?: string;
  sourceEntityId?: string;
  agendaStatus?: DailyAgendaItemStatus;
  durationMinutes?: number;
  personalRelevance?: string;
  timingLabel?: string;
  selectionReason?: string;
  behavioralAffinity?: BehavioralAffinityTier;
  isCurrent?: boolean;
  isPast?: boolean;
  isCompleted?: boolean;
}

export interface HomeTimelineItem {
  id: string;
  kind: HomeTimelineItemKind;
  start: string;
  end?: string;
  title: string;
  icon?: string | null;
  status?: HomeTimelineStatus;
  /**
   * True iff this item represents an already-committed schedule entry
   * (a real Plan, or an accepted/shared Moment) -- never true for a
   * spontaneous log (`COMPLETED_ACTIVITY`), an unscheduled suggestion
   * (`OPPORTUNITY`), or ambient astrological context (`CONTEXT_WINDOW`).
   * Deliberately distinct from `metadata.agendaStatus`/`isCompleted`,
   * which describe lifecycle/completion, not whether the item was ever a
   * real commitment.
   */
  planned: boolean;
  source: HomeTimelineSource;
  rank?: number;
  primaryAction?: HomeTimelineAction;
  metadata?: HomeTimelineItemMetadata;
}

/**
 * Pure input contract. `agenda`/`guidance` are BOTH independently
 * optional/nullable (see homeTimelineComposer.ts's own partial-degradation
 * doc comment) -- a caller passes `null` for whichever slice failed to
 * load or isn't applicable, never omits the whole call.
 */
export interface BuildHomeTimelineInput {
  agenda?: DailyAgenda | null;
  guidance?: DailyGuidanceContext | null;
  selectedActivities?: Record<string, SelectedActivityMetadata>;
  timelineWindows?: HomeTimelineContextWindow[];
  currentMinuteOfDay: number;
  timezone: string;
  /**
   * Anchors `timelineWindows`' minute-of-day values to a real calendar
   * date so the composer can emit a genuine ISO `start`/`end` for a
   * CONTEXT_WINDOW item -- defaults to `agenda?.localDate` when omitted.
   * Context windows are omitted entirely (never a fabricated ISO string)
   * when neither this nor `agenda.localDate` is available.
   */
  localDate?: string;
}
