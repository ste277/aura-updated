'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { UserChartContext, FULL_ACTIVITY_CATALOG, normalizeWindowType } from '../../../packages/recommendation/src/personalizedTasks';
import { getActionCards, getActivityDiscoveryCards, ActionCard } from '../../../packages/recommendation/src/actionCards';
import type { PersonalMuhurtaContext } from '../../../packages/recommendation/src/auraFitEngine';
import { getActivityDefinition, ImmediateAction, ActivityDurationMode } from '../../../packages/recommendation/src/activityDefinitions';
import type { DailyBriefing } from '../../../packages/recommendation/src/dailyAssistant';
import type { TimingCandidate, TimingSearchResponse } from '../../../packages/recommendation/src/timingSearch';
import type { DailyGuidanceRecommendation } from '../../../packages/personal-intelligence/src/context';
import type { AuraUpdate } from '../lib/auraUpdates';
import type { AuraReminder } from '../lib/auraReminders';
import { formatReminderTiming } from '../lib/auraReminders';
import { triggerHaptic } from '../lib/haptics';
import { trackEvent } from '../lib/trackEvent';
import * as theme from './theme';
import { colors, spacing, typography } from './theme';
import { PageHeader, SectionHeader, SurfaceCard, StatusBadge, IconButton, SecondaryButton, TextButton, PrimaryButton, ActivityChip } from './ui';
import type { DailyAgenda, DailyAgendaItem } from '../lib/dailyAgenda';
import type { DailyStory } from '../lib/dailyStory';
import type { DailyReflection } from '../lib/dailyReflection';
import type { TomorrowPreview } from '../lib/tomorrowPreview';
import { deriveNextMeaningfulThing } from '../lib/nextMeaningfulThing';
import type { PendingActivityPresentationItem } from '../lib/myDayPendingOverlay';
import { LoggedEntryItem } from './CalendarViewSection';
import { resolvePendingActivityStatus } from '../lib/pendingReplayReconciliation';
import { DayBuilderCard } from './DayBuilderCard';
import { PersonalizationPromptCard } from './PersonalizationPromptCard';
import { saveUpcomingPlanFromCandidate } from './PlanWithAuraView';
import type { DailyIntentionGroupId } from '../lib/dailyIntentions';
import { HomeTimeline } from './HomeTimeline';
import { buildHomeTimeline } from '../lib/homeTimelineComposer';
import { selectRightNowState } from '../lib/rightNowSelection';
import type { HomeTimelineContextWindow, HomeTimelineItem } from '../lib/homeTimelineTypes';
import { buildWhyAuraExplanation } from '../lib/whyAuraViewModel';
import type { GuidanceUiState } from '../lib/bestForYouViewModel';

/** Matches page.tsx's own FALLBACK_TZ -- defensive only, page.tsx always supplies a real value today. */
const FALLBACK_HOME_TZ = 'Asia/Kolkata';

interface HomeDashboardProps {
  userName: string;
  energyScore: number;
  themeText: string;
  nextShift: {
    windowName: string;
    startsIn: string;
    startTime: string;
    score: number;
    themeText: string;
  };
  currentWindow?: {
    name: string;
    /** null when there is no active named window right now (a Neutral gap)
     * -- see Finding C (AURA HOME IA V2 FOLLOW-UP FIXES): this used to be
     * the literal string 'Current' in that case, a non-time sentinel that
     * rendered as a fabricated clock time. */
    startTime: string | null;
    endTime: string;
    /** True when `endTime` is tomorrow's clock, not today's (the boundary
     * wrapped past midnight) -- must be surfaced explicitly rather than
     * left for the reader to infer from a bare clock time. */
    boundaryIsTomorrow?: boolean;
    timeRemaining: string;
  };
  activeWindowName?: string;
  /** Full-day window list, already computed in page.tsx (mappedTimelineWindows).
   * Home UI V2 -- this is now ALSO adapted into the canonical timeline
   * composer's own `HomeTimelineContextWindow[]` input (see the
   * `timelineWindows` useMemo below); it is never re-derived, only
   * reshaped field-by-field. */
  dayWindows?: HomeDayWindow[];
  loggedActivitiesToday?: string[];
  dailyBriefing?: DailyBriefing | null;
  todayReflection?: {
    outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW';
    followedGuidance: boolean;
  } | null;
  userChart?: UserChartContext;
  personalContext?: PersonalMuhurtaContext;
  onLogActivity?: (
    activityTitle: string,
    notes?: string,
    customTimestamp?: Date,
    overrideWindowType?: string,
    durationMinutes?: number,
    logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION',
    activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH',
    activityId?: string
  ) => Promise<'confirmed' | 'pending'>;
  onSubmitReflection?: (outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW', followedGuidance: boolean) => Promise<void>;
  onNextShiftClick?: () => void;
  onPlanClick?: (activity?: string) => void;
  /** Day Constructor V1 -- PR F2. Navigates to the dedicated `/plan-day`
   * entry experience (this ticket's own section 6) -- distinct from
   * `onPlanClick` (Ask Aura, single-activity search/check) and Day
   * Builder's own single-suggestion add affordance (HomeTimeline's own
   * `onAddSomething`): this is the only Home entry point for arranging
   * MULTIPLE things together in one pass. A real navigation (cross-route,
   * not another `activeTab`), so this component never performs it itself
   * -- the caller (page.tsx) owns the actual redirect, matching every
   * other cross-route Home callback's own convention. */
  onPlanDay?: () => void;
  onInsightsClick?: () => void;
  onNotificationsClick?: () => void;
  unreadUpdatesCount?: number;
  onPanchangClick?: () => void;
  topMomentUpdate?: AuraUpdate;
  onViewMomentUpdate?: (momentToken: string) => void;
  onViewMomentInvitation?: (momentToken: string) => void;
  onFindAnotherTimeForMoment?: (momentToken: string) => void;
  startingSoonReminder?: AuraReminder | null;
  onOpenReminder?: (reminder: AuraReminder) => void;
  myDayAgenda?: DailyAgenda | null;
  /** Home UI V2 -- only `.phase` is still read (Day Builder's own
   * `dayPhase` prop); the narrative fields (`headline`/`narrative`/
   * `suggestedIntentions`/`primaryPrompt`) are no longer rendered on Home
   * -- Right Now already owns "what matters right now," and Your Day's
   * own empty state now owns intent-discovery. */
  myDayStory?: DailyStory | null;
  myDayReflection?: DailyReflection | null;
  myDayTomorrowPreview?: TomorrowPreview | null;
  myDayPendingActivities?: PendingActivityPresentationItem[];
  timezone?: string;
  /** Home UI V2 -- the composer's own required, non-optional input; no
   * new clock is created here, this is threaded straight from page.tsx's
   * existing `useCurrentMinuteOfDay` value. */
  currentMinuteOfDay: number;
  logEntries?: LoggedEntryItem[];
  onMyDayChanged?: () => void;
  onOpenAgendaItem?: (item: DailyAgendaItem) => void;
  onPlanTomorrow?: (activityTitle?: string) => void;
  onMuteDayBuilderGroup?: (groupId: DailyIntentionGroupId) => void;
  dayBuilderEnabled?: boolean;
  dayBuilderPriorities?: string[];
  dayBuilderPrioritiesPromptDismissed?: boolean;
  onDayBuilderPrefsChange?: (next: Partial<{ dayBuilderPriorities: string[]; dayBuilderPrioritiesPromptDismissed: boolean }>) => void;
  guidance?: GuidanceUiState;
  onOpenBirthProfile?: () => void;
  /** Home Plan/Add Actions fix -- "+ Add something"'s own fallback when
   * Day Builder has nothing to show (NIGHT phase / no agenda yet, see
   * `dayBuilderBlock` below): the SAME existing Explore navigation
   * `onPanchangClick` already performs (`setActiveTab('explore')` in
   * page.tsx) -- a second, distinctly-named prop for a distinct caller
   * rather than repurposing `onPanchangClick` for an unrelated action,
   * but no new navigation mechanism. Never fires while Day Builder's own
   * block is available -- see `handleAddSomething` below. */
  onExploreClick?: () => void;
  /** Home UI V2 -- reuses page.tsx's existing `handleTimingSearch`
   * (already passed to Plan/Ask Aura/Muhurtham) so an OPPORTUNITY row's
   * "Plan" action can re-evaluate its own already-chosen instant via a
   * CHECK call and obtain a genuine, non-fabricated `TimingCandidate` to
   * hand to `saveUpcomingPlanFromCandidate` -- see this file's own
   * `handlePlanOpportunity` for why this is necessary (a `HomeTimelineItem`
   * deliberately never carries a full `TimingCandidate`, only the safe
   * presentation fields). Not a new endpoint -- `/api/timing-search`
   * already exists and this same handler already calls it elsewhere;
   * only fired on this explicit user action, never at render time. */
  onTimingSearch?: (request: {
    mode: 'CHECK';
    activityId?: string;
    durationMinutes: number;
    candidateStart: string;
  }) => Promise<TimingSearchResponse>;
  /** Home UI V2 -- the real personalized insight already fetched for the
   * Insights tab (`GET /api/daily-assistant/insights`), threaded through
   * unchanged so Daily Reflection can show a truthful line instead of the
   * old generic, non-personalized "Aura Insight" text. No new fetch. */
  assistantInsight?: { insightText: string } | null;
}

interface HomeDayWindow {
  name: string;
  startTime: string;
  endTime: string;
  startMinute: number;
  endMinute: number;
  type: string;
}

const PROMPT_CHIPS = ['Workout', 'Deep work', 'Study', 'Date night'];

// "Best Time" is a claim of credibility: it should only appear once the engine
// has actually evaluated a window as genuinely strong. Neutral Flow is the
// *absence* of a special window, so it always gets its own honest "Flexible"
// framing regardless of its numeric score.
export function getWindowTone(score: number, windowName: string) {
  const cleanWindow = windowName.toUpperCase();
  if (cleanWindow.includes('RAHU') || cleanWindow.includes('YAMA') || score < 4) {
    return { label: 'Use Caution', pill: 'Caution', color: '#fb6b6b', description: 'Better for routine, low-stakes tasks and cleanup.' };
  }
  if (cleanWindow.includes('NEUTRAL')) {
    return {
      label: 'Neutral Flow',
      pill: 'Flexible',
      color: '#38bdf8',
      description: 'Flexible period for steady progress. Good for existing work, everyday tasks, and activities that don’t need a special window.',
    };
  }
  if (score >= 7.5) return { label: 'Strong Window', pill: 'Best Time', color: '#4ade80', description: 'Good for focused, important, or momentum-building work.' };
  if (score >= 5) return { label: 'Good Window', pill: 'Good Time', color: '#4ade80', description: 'Good for steady progress, planning, and everyday tasks.' };
  return { label: 'Light Flow', pill: 'Steady Time', color: '#facc15', description: 'Good for maintenance, reflection, and gentle progress.' };
}

function toneToStatusTone(hexColor: string): 'positive' | 'caution' | 'danger' | 'info' {
  if (hexColor === '#fb6b6b') return 'danger';
  if (hexColor === '#38bdf8') return 'info';
  if (hexColor === '#facc15') return 'caution';
  return 'positive';
}

function getHeroHeadline(windowName: string): string {
  const cleanWindow = windowName.toUpperCase();
  if (cleanWindow.includes('RAHU')) return 'Better to avoid important new starts';
  if (cleanWindow.includes('YAMA')) return 'Keep things routine for now';
  if (cleanWindow.includes('BRAHMA')) return 'Quiet time for clarity and reflection';
  if (cleanWindow.includes('ABHIJIT') || cleanWindow.includes('VIJAYA')) return 'Strong time for important work';
  if (cleanWindow.includes('GULIKA')) return 'Steady time for ongoing work';
  return 'Good time to keep things moving';
}

/**
 * Home UI V2 -- Next Best Moment no longer renders as a standalone card on
 * Home, so this pure helper is no longer called from anywhere in this
 * file. Kept, exported, and unmodified purely because `nextMomentSurfaceLabel`
 * still has a real, passing existing test (test/nextMomentSurface.test.ts)
 * that imports it directly -- deleting it would break that test, which
 * this PR was not asked to modify. Flagged as a dead-code cleanup
 * candidate for a dedicated follow-up (removing this function and its
 * test together), not silently deleted as part of this IA migration.
 */
export function nextMomentSurfaceLabel(tone: { pill: string }): { icon: string; label: string } {
  return tone.pill === 'Caution' ? { icon: '🕐', label: 'Coming Up' } : { icon: '⭐', label: 'Next Best Moment' };
}

function formatWindowName(name: string) {
  const formatted = name.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  return formatted.toUpperCase() === 'NEUTRAL' ? 'Neutral Flow' : formatted;
}

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

function greeting() {
  const hour = new Date().getHours();
  if (hour >= 17) return 'Good Evening';
  if (hour >= 12) return 'Good Afternoon';
  return 'Good Morning';
}

function formatUpdateDateTime(iso: string) {
  const date = new Date(iso);
  return {
    day: date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    time: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

const PREFERENCE_TEXT: Record<string, string> = {
  EARLIER: 'Earlier',
  LATER: 'Later',
  DIFFERENT_DAY: 'A different day',
  NO_PREFERENCE: 'Anything else',
};

/**
 * "Good right now" -- the deterministic window -> 3 activity cards table
 * (packages/recommendation/src/actionCards.ts). A card whose canonical
 * activity has already been logged TODAY, other than one logged from THIS
 * Home visit's own cards, is swapped for the next-best still-undone
 * activity for this SAME window. PLAN-only alternatives are excluded --
 * "Good Right Now" is about doing something now.
 *
 * Home UI V2 -- Right Now now surfaces only `goodRightNow[0]` by default
 * (or the personalized current-guidance spotlight when one exists); the
 * full ranked list this function returns is preserved unchanged so the
 * existing swap/exemption/fallback behavior stays intact, and the deeper
 * alternatives remain reachable via the existing Timeline screen.
 */
export function selectGoodRightNowCards(
  activeWindowName: string,
  loggedActivitiesToday: string[],
  justLoggedTitles: Set<string> = new Set(),
  personalContext?: PersonalMuhurtaContext
): ActionCard[] {
  const loggedTitles = new Set(loggedActivitiesToday.map((title) => title.trim().toLowerCase()));
  const cardTitle = (card: ActionCard) =>
    (card.activityId ? FULL_ACTIVITY_CATALOG.find((activity) => activity.id === card.activityId)?.title : undefined) ?? card.title;
  const isLogged = (card: ActionCard) => {
    const title = cardTitle(card).toLowerCase();
    return loggedTitles.has(title) && !justLoggedTitles.has(title);
  };

  const base = getActionCards(activeWindowName);
  const kept = base.filter((card) => !isLogged(card));
  const stillNeeded = 3 - kept.length;
  if (stillNeeded <= 0) return kept.slice(0, 3);

  const usedActivityKeys = new Set(kept.map((card) => card.activityId ?? card.id));
  const alternatives = getActivityDiscoveryCards(activeWindowName, 12, personalContext).filter((card) => {
    if (isLogged(card) || usedActivityKeys.has(card.activityId ?? card.id)) return false;
    const definition = card.activityId ? getActivityDefinition(card.activityId) : undefined;
    return (definition?.experience.immediateAction ?? 'LOG_NOW') !== 'PLAN';
  });

  return [...kept, ...alternatives.slice(0, stillNeeded)];
}

export function HomeDashboard({
  userName,
  energyScore,
  themeText,
  nextShift,
  currentWindow,
  activeWindowName = 'NEUTRAL',
  dayWindows,
  loggedActivitiesToday = [],
  dailyBriefing,
  todayReflection,
  personalContext,
  onLogActivity,
  onSubmitReflection,
  onNextShiftClick,
  onPlanClick,
  onPlanDay,
  onInsightsClick,
  onNotificationsClick,
  unreadUpdatesCount = 0,
  onPanchangClick,
  topMomentUpdate,
  onViewMomentUpdate,
  onViewMomentInvitation,
  onFindAnotherTimeForMoment,
  startingSoonReminder,
  onOpenReminder,
  myDayAgenda,
  myDayStory,
  myDayReflection,
  myDayTomorrowPreview,
  myDayPendingActivities = [],
  timezone,
  currentMinuteOfDay,
  logEntries = [],
  onMyDayChanged,
  onOpenAgendaItem,
  onPlanTomorrow,
  onMuteDayBuilderGroup,
  dayBuilderEnabled,
  dayBuilderPriorities,
  dayBuilderPrioritiesPromptDismissed,
  onDayBuilderPrefsChange,
  guidance,
  onOpenBirthProfile,
  onTimingSearch,
  assistantInsight,
  onExploreClick,
}: HomeDashboardProps) {
  const effectiveTimezone = timezone ?? FALLBACK_HOME_TZ;

  const [askAuraIdeasOpen, setAskAuraIdeasOpen] = useState(false);
  const [reflectionSaved, setReflectionSaved] = useState(Boolean(todayReflection));
  const [isEditingReflection, setIsEditingReflection] = useState(false);
  const [isSavingReflection, setIsSavingReflection] = useState(false);
  const [reflectionError, setReflectionError] = useState('');
  const [selectedReflection, setSelectedReflection] = useState<'LOW' | 'MODERATE' | 'PEAK_FLOW' | null>(todayReflection?.outputLevel ?? null);
  const [showReflectionWhy, setShowReflectionWhy] = useState(false);
  // Home UI V2 -- one expanded timeline item at a time (Why Aura), keyed by
  // HomeTimelineItem.id, generalizing the same single-expansion pattern
  // BestForYouSection.tsx already established for the section it replaces.
  const [expandedTimelineId, setExpandedTimelineId] = useState<string | null>(null);
  // Home UI V2 -- Day Builder's own intent-setting UI is now reached from
  // Your Day's own empty state or its "+ Add something" toggle, never a
  // permanently-visible top-level module.
  const [showDayBuilder, setShowDayBuilder] = useState(false);
  const [planningOpportunityId, setPlanningOpportunityId] = useState<string | null>(null);
  const [opportunityError, setOpportunityError] = useState('');

  useEffect(() => {
    setReflectionSaved(Boolean(todayReflection));
    setSelectedReflection(todayReflection?.outputLevel ?? null);
    setIsEditingReflection(false);
    setReflectionError('');
  }, [todayReflection?.outputLevel]);

  const tone = getWindowTone(energyScore, activeWindowName);
  const currentWindowLabel = dailyBriefing?.briefingState === 'ACTIVE'
    ? dailyBriefing.peakWindow.name
    : formatWindowName(currentWindow?.name ?? activeWindowName);
  // Finding C (AURA HOME IA V2 FOLLOW-UP FIXES): currentWindow.startTime is
  // null while in a Neutral gap (no active named window) -- previously this
  // templated straight into "{startTime} - {endTime}" using the literal
  // string 'Current' as a fake start time, producing labels like
  // "Current - 4:31 AM" that read as "it is currently 4:31 AM" when it was
  // actually evening. A gap now gets its own honest sentence naming
  // `endTime` as the next window's boundary, not "now" -- and calls out
  // explicitly when that boundary is tomorrow's clock, not today's.
  const currentTimeRange = dailyBriefing?.briefingState === 'ACTIVE'
    ? `${dailyBriefing.peakWindow.startTime} - ${dailyBriefing.peakWindow.endTime}`
    : currentWindow
      ? currentWindow.startTime !== null
        ? `${currentWindow.startTime} - ${currentWindow.endTime}`
        : `Open until ${currentWindow.endTime}${currentWindow.boundaryIsTomorrow ? ' tomorrow' : ''}`
      : `Next shift ${nextShift.startTime}`;
  const remainingText = currentWindow ? `${currentWindow.timeRemaining} left` : nextShift.startsIn;

  const [justLoggedTitles, setJustLoggedTitles] = useState<Set<string>>(() => new Set());
  const handleCardLogged = (title: string) => {
    setJustLoggedTitles((prev) => new Set(prev).add(title.trim().toLowerCase()));
  };

  const goodRightNow = useMemo(
    () => selectGoodRightNowCards(activeWindowName, loggedActivitiesToday, justLoggedTitles, personalContext),
    [activeWindowName, loggedActivitiesToday, justLoggedTitles, personalContext]
  );

  const guidanceState: GuidanceUiState = guidance ?? { status: 'loading' };
  const readyGuidance = guidanceState.status === 'READY' ? guidanceState : null;

  // Home UI V2 -- the canonical timeline projection. Every input here is
  // already fetched/computed elsewhere (page.tsx); this useMemo performs
  // NO joining/deduplication/ranking/sorting of its own -- buildHomeTimeline
  // owns all of that. dayWindows is only field-adapted (name->label), never
  // recomputed.
  const timelineWindows: HomeTimelineContextWindow[] = useMemo(
    () => (dayWindows ?? []).map((w) => ({ label: w.name, startMinute: w.startMinute, endMinute: w.endMinute, type: w.type as HomeTimelineContextWindow['type'] })),
    [dayWindows]
  );

  const homeTimeline: HomeTimelineItem[] = useMemo(
    () =>
      buildHomeTimeline({
        agenda: myDayAgenda ?? null,
        guidance: readyGuidance?.guidance ?? null,
        selectedActivities: readyGuidance?.selectedActivities,
        timelineWindows,
        currentMinuteOfDay,
        timezone: effectiveTimezone,
      }),
    [myDayAgenda, readyGuidance, timelineWindows, currentMinuteOfDay, effectiveTimezone]
  );

  // Home UI V2 -- Why Aura lines, resolved once here (never inside
  // HomeTimeline itself) by matching each annotated item back to its
  // ORIGINAL DailyGuidanceRecommendation via `rank` -- rank is unique
  // within one DailyGuidanceContext.recommendations array by construction,
  // so this is a safe, deterministic identity match, never a title/family
  // guess (see this PR's own pre-PR review §30). An item with no rank (an
  // unannotated Plan, a Moment, a completed activity, context) never gets
  // an entry here -- Why fails closed, never shows for the wrong item.
  const explanationsById = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!readyGuidance) return map;
    for (const item of homeTimeline) {
      if (item.rank === undefined) continue;
      if (item.source !== 'PLAN' && item.source !== 'DAY_BUILDER_INTENTION') continue;
      const recommendation = readyGuidance.guidance.recommendations.find((r: DailyGuidanceRecommendation) => r.rank === item.rank);
      if (!recommendation) continue;
      const lines = buildWhyAuraExplanation(recommendation, item.source, item.metadata?.behavioralAffinity).lines;
      if (lines.length > 0) map[item.id] = lines;
    }
    return map;
  }, [homeTimeline, readyGuidance]);

  // Home UI V2 -- the current-guidance spotlight (architecture audit §9):
  // a preview of the SAME canonical timeline object, never a second
  // recommendation source.
  //
  // AURA HOME IA V2 FOLLOW-UP FIXES, Finding E: rank===1 alone used to be
  // treated as "the best option right now" regardless of whether it was
  // already a committed Plan -- selectRightNowState (rightNowSelection.ts)
  // still only ever looks at the SAME single rank-1 item, but reinterprets
  // its own source/agendaStatus/isCurrent into the correct one of four
  // states (ACTIVE_PLAN/IMMINENT_PLAN/OPPORTUNITY/CONTEXT_OPEN) -- see that
  // module's own doc comment for the full contract. PLANNED != RECOMMENDED
  // OPTION.
  const rightNowState = useMemo(() => selectRightNowState(homeTimeline), [homeTimeline]);
  const spotlightItem = rightNowState.kind !== 'CONTEXT_OPEN' ? rightNowState.item : undefined;
  const spotlightExplanation = spotlightItem ? explanationsById[spotlightItem.id] : undefined;
  // Finding D: the spotlight's own "Why?" now expands INLINE (below),
  // sharing `expandedTimelineId` with HomeTimeline's own row toggle so
  // both stay in sync -- never a click that only ever affects a distant,
  // possibly off-screen row with no visible feedback at the click site.
  const spotlightWhyExpanded = Boolean(spotlightItem && expandedTimelineId === spotlightItem.id);

  // Home UI V2 -- Your Day is genuinely empty only when the composer's own
  // output has nothing to show. Distinguishing this from "still loading"
  // is intentionally left to myDayAgenda's own null vs. real-empty-array
  // shape, matching every other My Day slice's existing convention.
  const isTimelineEmpty = homeTimeline.length === 0;

  const dayPhase = myDayStory?.phase ?? 'MORNING';
  const dayBuilderBlock =
    myDayAgenda && dayPhase !== 'NIGHT' ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
        {onDayBuilderPrefsChange && (
          <PersonalizationPromptCard
            dayBuilderEnabled={dayBuilderEnabled ?? true}
            dayBuilderPriorities={dayBuilderPriorities ?? []}
            dayBuilderPrioritiesPromptDismissed={dayBuilderPrioritiesPromptDismissed ?? false}
            onChange={onDayBuilderPrefsChange}
          />
        )}
        <DayBuilderCard key={myDayAgenda.localDate} dayPhase={dayPhase} localDate={myDayAgenda.localDate} onCreated={() => { setShowDayBuilder(false); onMyDayChanged?.(); }} onMuteGroup={onMuteDayBuilderGroup} />
      </div>
    ) : null;

  /**
   * Home Plan/Add Actions fix -- "+ Add something" must never produce a
   * click with no visible result (the dead-click audit's own §12
   * invariant). `dayBuilderBlock` above is the ONLY thing toggling
   * `showDayBuilder` can ever reveal; when it's `null` (NIGHT phase, or
   * `myDayAgenda` not yet loaded), toggling state that renders to nothing
   * is exactly the bug being fixed here -- so this falls through to the
   * existing Explore navigation instead, the SAME one-line
   * `setActiveTab('explore')` pattern `onPanchangClick` already uses.
   * Day Builder's own NIGHT semantics are completely unchanged by this --
   * this only decides what HOME does when Day Builder has nothing to
   * show, never what Day Builder itself shows.
   */
  const handleAddSomething = () => {
    if (dayBuilderBlock) {
      setShowDayBuilder((current) => !current);
    } else {
      onExploreClick?.();
    }
  };

  const nextThing = deriveNextMeaningfulThing({ topMomentUpdate, startingSoonReminder, agenda: myDayAgenda });

  const handleReflection = async (outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW') => {
    if (!onSubmitReflection || isSavingReflection) return;
    setIsSavingReflection(true);
    setReflectionError('');
    try {
      await onSubmitReflection(outputLevel, loggedActivitiesToday.length > 0);
      setSelectedReflection(outputLevel);
      setReflectionSaved(true);
      setIsEditingReflection(false);
      triggerHaptic('success');
    } catch (err) {
      console.error('Failed to save reflection:', err);
      setReflectionError('Could not save check-in. Try again.');
    } finally {
      setIsSavingReflection(false);
    }
  };

  const handleToggleExpand = (id: string) => setExpandedTimelineId((current) => (current === id ? null : id));

  // A HomeTimelineItem's own id is reused verbatim from DailyAgendaItem.id
  // for every agenda-sourced kind (composer's own contract) -- looking the
  // real agenda item back up lets this reuse onOpenAgendaItem's existing
  // Plan/Moment routing completely unchanged, rather than duplicating it.
  const handleOpenTimelineItem = (item: HomeTimelineItem) => {
    const agendaItem = myDayAgenda?.items.find((candidate) => candidate.id === item.id);
    if (agendaItem) onOpenAgendaItem?.(agendaItem);
  };

  /**
   * Home UI V2 -- Opportunity "Plan" action. A HomeTimelineItem
   * deliberately carries no raw score/evidence/full TimingCandidate (PR A's
   * own presentation-safety contract), so `saveUpcomingPlanFromCandidate`
   * (which requires a genuine TimingCandidate -- start/end/score/label/
   * muhurtaScore/reasons/metadata) cannot be called with fabricated data.
   * This re-evaluates the exact same already-chosen instant via a CHECK
   * call (the same pattern `collectPlanCandidates` itself already uses
   * server-side to re-evaluate an already-scheduled Plan) to obtain a real,
   * truthful TimingCandidate, then hands it to the one canonical Plan
   * creation path -- never a second save implementation.
   */
  const handlePlanOpportunity = async (item: HomeTimelineItem) => {
    if (!onTimingSearch || !item.metadata?.activityId || planningOpportunityId) return;
    setPlanningOpportunityId(item.id);
    setOpportunityError('');
    try {
      const durationMinutes = item.metadata.durationMinutes ?? 45;
      const response = await onTimingSearch({ mode: 'CHECK', activityId: item.metadata.activityId, durationMinutes, candidateStart: item.start });
      const candidate: TimingCandidate | undefined = response.requestedCandidate ?? response.candidates[0];
      if (!candidate) throw new Error('No candidate returned');
      // Defensive fail-closed check (pre-PR review §8/§9): CHECK mode's own
      // contract guarantees candidates[0]/requestedCandidate always
      // describes the exact requested candidateStart, never a substituted
      // instant -- but this is verified explicitly rather than assumed, so
      // a contract violation surfaces as a clean failure instead of a
      // silently-wrong save.
      if (candidate.start !== item.start) throw new Error('CHECK returned a different instant than the opportunity displayed');
      await saveUpcomingPlanFromCandidate(candidate, durationMinutes, { activityId: item.metadata.activityId, clientRequestId: `home-opportunity:${item.id}` });
      trackEvent('PLAN_RESULT_SELECTED', { metadata: { mode: 'CHECK', source: 'HOME_TIMELINE' } });
      onMyDayChanged?.();
    } catch (err) {
      console.error('Failed to plan opportunity from Home:', err);
      setOpportunityError('Could not plan this. Try again.');
    } finally {
      setPlanningOpportunityId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xxl, paddingBottom: spacing.xxl, fontFamily: 'sans-serif', color: colors.textPrimary }}>
      <PageHeader
        title={<>{greeting()}, {userName}! 👋</>}
        subtitle={todayLabel()}
        rightAction={
          <IconButton
            onClick={onNotificationsClick}
            ariaLabel="Updates"
            badge={
              unreadUpdatesCount > 0 && (
                <span style={{ position: 'absolute', right: 1, top: 0, minWidth: 16, height: 16, borderRadius: 8, background: colors.danger, color: colors.textInverse, fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                  {unreadUpdatesCount > 9 ? '9+' : unreadUpdatesCount}
                </span>
              )
            }
          >
            <BellIcon />
          </IconButton>
        }
      />

      {/* ============================================================
       * RIGHT NOW
       * ============================================================ */}
      <SurfaceCard elevated accentColor={tone.color} padding={spacing.xxl}>
        <div style={{ display: 'grid', gridTemplateColumns: '128px minmax(0, 1fr)', gap: spacing.xl, alignItems: 'center' }}>
          <FlowRing score={energyScore} color={tone.color} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' }}>
              <div style={typography.sectionEyebrow}>● Right Now</div>
              <StatusBadge label={tone.pill} tone={toneToStatusTone(tone.color)} />
            </div>
            <h2 style={{ margin: '13px 0 0', fontSize: 25, color: colors.textPrimary, lineHeight: 1.14 }}>{getHeroHeadline(activeWindowName)}</h2>
            <div style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 15, fontWeight: 800 }}>{currentWindowLabel} · {tone.pill}</div>
          </div>
        </div>
        <div style={{ color: colors.textPrimary, fontSize: 15, fontWeight: 850, marginTop: spacing.lg, lineHeight: 1.35 }}>
          {currentTimeRange}
          <span style={{ color: tone.color, display: 'inline-block', marginLeft: spacing.sm }}>{remainingText}</span>
        </div>
        <p style={{ margin: '11px 0 0', color: colors.textFaint, fontSize: 15, lineHeight: 1.42 }}>{tone.description}</p>

        <div style={{ marginTop: spacing.xl, paddingTop: spacing.lg, borderTop: `1px solid ${colors.borderSubtle}` }}>
          <SectionHeader
            label={
              rightNowState.kind === 'ACTIVE_PLAN'
                ? 'Happening now'
                : rightNowState.kind === 'IMMINENT_PLAN'
                  ? 'Coming up'
                  : rightNowState.kind === 'OPPORTUNITY'
                    ? 'Best option right now'
                    : 'Good Right Now'
            }
          />
          {spotlightItem ? (
            <div>
              {/* Finding E -- PLANNED != RECOMMENDED OPTION: an ACTIVE_PLAN/
               * IMMINENT_PLAN is a commitment the user already made, never
               * described as an "option" (that copy is reserved for a
               * genuine, unplanned OPPORTUNITY). */}
              <div style={{ ...typography.bodyStrong, fontSize: 15 }}>
                {rightNowState.kind === 'ACTIVE_PLAN' && `${spotlightItem.title} is happening now.`}
                {rightNowState.kind === 'IMMINENT_PLAN' && `${spotlightItem.title} starts soon.`}
                {rightNowState.kind === 'OPPORTUNITY' && `${spotlightItem.title} is a strong option right now.`}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                {spotlightItem.status && <StatusBadge label={spotlightItem.status} tone={spotlightItem.status === 'Best' ? 'positive' : 'info'} />}
                {/* Finding D -- a Why control only ever renders when a real
                 * explanation exists (fail closed, never a dead no-op), and
                 * activating it now toggles an explanation panel rendered
                 * INLINE right here, sharing state with HomeTimeline's own
                 * row so both stay in sync. */}
                {spotlightExplanation && spotlightExplanation.length > 0 && (
                  <TextButton onClick={() => handleToggleExpand(spotlightItem.id)} aria-expanded={spotlightWhyExpanded}>
                    {spotlightWhyExpanded ? 'Why? ↑' : 'Why? →'}
                  </TextButton>
                )}
                {/* Finding E §4.C -- OPPORTUNITY supports the existing Plan
                 * action, the same canonical CHECK-then-save path
                 * HomeTimeline's own Opportunity rows already use. */}
                {rightNowState.kind === 'OPPORTUNITY' && (
                  <PrimaryButton
                    onClick={() => handlePlanOpportunity(spotlightItem)}
                    disabled={planningOpportunityId === spotlightItem.id}
                    style={{ padding: '6px 16px', fontSize: 13, marginLeft: 'auto' }}
                  >
                    {planningOpportunityId === spotlightItem.id ? 'Planning…' : 'Plan'}
                  </PrimaryButton>
                )}
              </div>
              {/* Home Plan/Add Actions fix -- moved here from far below
               * HomeTimeline (this ticket's own §4/§25): a CHECK/save
               * failure must be visible where the user actually tapped
               * "Plan," not require scrolling past the entire "Your Day"
               * list to discover. `handlePlanOpportunity` already clears
               * this at the start of every new attempt (`setOpportunityError('')`),
               * so a stale error never lingers into a fresh Planning… state. */}
              {rightNowState.kind === 'OPPORTUNITY' && opportunityError && (
                <div style={{ color: colors.danger, fontSize: 12, marginTop: spacing.xs }}>{opportunityError}</div>
              )}
              {spotlightWhyExpanded && spotlightExplanation && spotlightExplanation.length > 0 && (
                <div style={{ marginTop: spacing.sm, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ ...typography.caption, color: colors.textMuted, fontWeight: 800 }}>Why this time?</div>
                  {spotlightExplanation.map((line, index) => (
                    <div key={index} style={{ ...typography.caption, color: colors.textSecondary }}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            goodRightNow[0] && (
              <div style={{ maxWidth: 240 }}>
                <GoodRightNowCard card={goodRightNow[0]} activeWindowName={activeWindowName} onLogActivity={onLogActivity} onPlanClick={onPlanClick} onLogged={handleCardLogged} logEntries={logEntries} />
              </div>
            )
          )}
          <div style={{ display: 'flex', gap: spacing.lg, marginTop: spacing.md }}>
            <TextButton onClick={onNextShiftClick}>View full day timeline →</TextButton>
            {onPanchangClick && <TextButton onClick={onPanchangClick} color={colors.traditional}>Explore →</TextButton>}
          </div>
          {/* Pre-PR review §40 fix: BestForYouSection used to own this CTA
           * for BIRTH_PROFILE_REQUIRED -- removing that section silently
           * dropped it. Never implies personalized timing exists; only
           * ever shown for this exact guidance status. */}
          {guidanceState.status === 'BIRTH_PROFILE_REQUIRED' && onOpenBirthProfile && (
            <div style={{ marginTop: spacing.md }}>
              <TextButton onClick={onOpenBirthProfile}>Personalize your timing →</TextButton>
            </div>
          )}
        </div>

        {/* Product-critical Moment/reminder facts that need the owner's
         * attention right now -- folded into Right Now rather than a
         * separate permanent section (architecture: "avoid inserting other
         * permanent intelligence sections"). Genuinely absent most of the
         * time (deriveNextMeaningfulThing returns null far more often than
         * not); tier 3 (a plain upcoming agenda item) is deliberately
         * excluded here -- Your Day's own NEXT tag already owns that. */}
        {nextThing && nextThing.kind !== 'AGENDA_ITEM' && (
          <div style={{ marginTop: spacing.xl, paddingTop: spacing.lg, borderTop: `1px solid ${colors.borderSubtle}` }}>
            {nextThing.kind === 'MOMENT_UPDATE' && (() => {
              const update = nextThing.update;
              const { day, time } = formatUpdateDateTime(update.eventStartAt);
              const isAccepted = update.type === 'MOMENT_ACCEPTED';
              return (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: isAccepted ? colors.positive : colors.caution }}>
                    {isAccepted ? `❤️ ${update.recipientDisplayName ?? 'They'} is in` : `↻ ${update.recipientDisplayName ?? 'They'} want${update.recipientDisplayName ? 's' : ''} another time`}
                  </div>
                  <div style={{ marginTop: spacing.sm, fontSize: 14, fontWeight: 750, color: colors.textPrimary }}>{update.activityTitle}</div>
                  <div style={{ marginTop: 3, fontSize: 12, color: colors.textFaint }}>
                    {isAccepted ? `${day} · ${time}` : `Prefers: ${PREFERENCE_TEXT[update.preference ?? 'NO_PREFERENCE']}`}
                  </div>
                  <div style={{ marginTop: spacing.md, display: 'flex', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
                    <SecondaryButton onClick={() => (isAccepted ? onViewMomentUpdate?.(update.momentToken) : onFindAnotherTimeForMoment?.(update.momentToken))}>
                      {isAccepted ? 'View details' : 'Find another time'}
                    </SecondaryButton>
                    {isAccepted && (
                      <TextButton onClick={() => onViewMomentInvitation?.(update.momentToken)} color={colors.textMuted}>
                        View invitation
                      </TextButton>
                    )}
                  </div>
                </div>
              );
            })()}
            {nextThing.kind === 'STARTING_SOON' && <StartingSoonCard reminder={nextThing.reminder} onOpen={onOpenReminder} />}
          </div>
        )}
      </SurfaceCard>

      {/* ============================================================
       * ASK AURA -- placement only, routing/engine unchanged
       * ============================================================ */}
      <SurfaceCard>
        <div style={inputShellStyle}>
          <span style={{ color: '#93c5fd', fontSize: 23 }}>✦</span>
          <button type="button" onClick={() => onPlanClick?.()} onFocus={() => setAskAuraIdeasOpen(true)} style={promptButtonStyle}>
            Ask Aura anything...
          </button>
          <button type="button" onClick={() => onPlanClick?.()} style={voiceButtonStyle} aria-label="Find a time">
            →
          </button>
        </div>
        {askAuraIdeasOpen ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            {PROMPT_CHIPS.map((chip) => (
              <ActivityChip key={chip} label={chip} onClick={() => onPlanClick?.(chip)} />
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => setAskAuraIdeasOpen(true)} style={ideasDisclosureStyle}>
            Ideas
          </button>
        )}
      </SurfaceCard>

      {/* ============================================================
       * PLAN MY DAY -- Day Constructor V1 PR F2. The ONE entry point for
       * arranging multiple things together in one pass (this ticket's own
       * section 6/49) -- deliberately a single, quiet row, not a second
       * hero card; distinct from Ask Aura above (single-activity search)
       * and Day Builder's own single-suggestion add affordance below (one
       * proactive suggestion at a time).
       * ============================================================ */}
      {onPlanDay && (
        <SurfaceCard>
          <button
            type="button"
            onClick={onPlanDay}
            style={{ display: 'flex', alignItems: 'center', gap: spacing.md, width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ color: '#93c5fd', fontSize: 20 }} aria-hidden="true">
              ✦
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={typography.bodyStrong}>Plan my day</div>
              <div style={{ ...typography.caption, marginTop: 2 }}>Arrange today&rsquo;s tasks together</div>
            </div>
            <span style={{ color: colors.textMuted, fontSize: 16 }} aria-hidden="true">
              →
            </span>
          </button>
        </SurfaceCard>
      )}

      {/* ============================================================
       * YOUR DAY
       * ============================================================ */}
      <HomeTimeline
        items={homeTimeline}
        timezone={effectiveTimezone}
        pendingActivities={myDayPendingActivities}
        nextItemId={myDayAgenda?.nextItem?.id}
        explanationsById={explanationsById}
        expandedId={expandedTimelineId}
        onToggleExpand={handleToggleExpand}
        onOpenItem={handleOpenTimelineItem}
        onPlanOpportunity={handlePlanOpportunity}
        planningId={planningOpportunityId}
        onAddSomething={handleAddSomething}
        emptyStateExtra={isTimelineEmpty ? dayBuilderBlock : showDayBuilder ? dayBuilderBlock : undefined}
      />

      {/* ============================================================
       * DAILY REFLECTION
       * ============================================================ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
        <SectionHeader label="Daily Reflection" />
        <SurfaceCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'center' }}>
            <div style={{ ...typography.sectionEyebrow, color: colors.caution }}>How did today feel?</div>
            <div
              style={whyAskWrapStyle}
              onMouseEnter={() => setShowReflectionWhy(true)}
              onMouseLeave={() => setShowReflectionWhy(false)}
              onFocus={() => setShowReflectionWhy(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setShowReflectionWhy(false);
              }}
            >
              <button type="button" aria-expanded={showReflectionWhy} onClick={() => setShowReflectionWhy((value) => !value)} style={whyAskButtonStyle}>
                Why we ask ⓘ
              </button>
              {showReflectionWhy && (
                <div style={whyAskPanelStyle}>
                  Aura compares how your day felt with when you logged activities, so Insights can learn which windows actually help you.
                </div>
              )}
            </div>
          </div>
          {reflectionSaved && !isEditingReflection ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.lg }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textSecondary, fontSize: 13.5, fontWeight: 750 }}>
                <span aria-hidden="true" style={{ fontSize: 11 }}>{selectedReflection === 'PEAK_FLOW' ? '🟢' : selectedReflection === 'LOW' ? '🔵' : '🟡'}</span>
                Today feels {selectedReflection ? formatReflectionLabel(selectedReflection) : 'logged'}
              </div>
              <TextButton onClick={() => setIsEditingReflection(true)} color={colors.textMuted}>
                Change →
              </TextButton>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: spacing.sm, marginTop: spacing.lg }}>
                <ReflectionButton label="Low" icon="☹" disabled={isSavingReflection} onClick={() => handleReflection('LOW')} />
                <ReflectionButton label="Balanced" icon="-" disabled={isSavingReflection} onClick={() => handleReflection('MODERATE')} />
                <ReflectionButton label="Strong" icon="☺" disabled={isSavingReflection} onClick={() => handleReflection('PEAK_FLOW')} />
              </div>
              {isSavingReflection && <div style={{ color: colors.textFaint, fontSize: 12, marginTop: spacing.sm }}>Saving check-in...</div>}
              {reflectionError && <div style={{ color: colors.danger, fontSize: 12, marginTop: spacing.sm }}>{reflectionError}</div>}
            </>
          )}

          {myDayReflection && (
            <p style={{ margin: `${spacing.lg}px 0 0`, color: colors.textSecondary, fontSize: 13.5, lineHeight: 1.4 }}>{myDayReflection.summary}</p>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.lg, paddingTop: spacing.lg, borderTop: `1px solid ${colors.borderSubtle}` }}>
            <div style={{ color: colors.positive, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <AuraInsightIcon />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: colors.textSecondary, fontSize: 13.5, lineHeight: 1.4 }}>
                {assistantInsight?.insightText || 'Your patterns will appear here as you log more moments.'}
              </div>
              <TextButton onClick={onInsightsClick} style={{ marginTop: spacing.sm, fontSize: 12 }}>View insights →</TextButton>
            </div>
          </div>

          {/* Preserves the exact existing NIGHT-only gating (myDayOrchestrator.ts
           * only ever populates myDayTomorrowPreview at the NIGHT phase). */}
          {myDayTomorrowPreview && (
            <div style={{ marginTop: spacing.lg, paddingTop: spacing.lg, borderTop: `1px solid ${colors.borderSubtle}` }}>
              <div style={{ ...typography.sectionEyebrow }}>{myDayTomorrowPreview.headline}</div>
              <p style={{ ...typography.body, marginTop: spacing.sm, lineHeight: 1.5 }}>{myDayTomorrowPreview.narrative}</p>
              {myDayTomorrowPreview.goodForCategories.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                  {myDayTomorrowPreview.goodForCategories.map((c) => (
                    <ActivityChip key={c.activityId} label={c.label} icon={c.icon} onClick={() => onPlanTomorrow?.(c.label)} />
                  ))}
                </div>
              )}
              <div style={{ marginTop: spacing.md }}>
                <TextButton onClick={() => onPlanTomorrow?.()}>Plan tomorrow →</TextButton>
              </div>
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}

function FlowRing({ score, color }: { score: number; color: string }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const normalized = score <= 10 ? score * 10 : score;
  return (
    <div style={{ position: 'relative', width: 120, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={radius} stroke="rgba(148, 163, 184, 0.2)" strokeWidth="10" fill="none" />
        <circle cx="60" cy="60" r={radius} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference - (Math.min(100, normalized) / 100) * circumference} />
      </svg>
      <div style={{ position: 'absolute', color: '#facc15', fontSize: 34 }}>✦</div>
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="27" height="27" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M12 26a4 4 0 0 0 8 0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8.5 23h15c-1.7-2.2-2.3-4.8-2.3-8.2A5.2 5.2 0 0 0 16 9.5a5.2 5.2 0 0 0-5.2 5.3c0 3.4-.6 6-2.3 8.2Z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
}

function AuraInsightIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 25V9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M16 14c-5 0-8-2.5-8-7 5 0 8 2.5 8 7Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M16 20c5 0 8-2.5 8-7-5 0-8 2.5-8 7Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M10 25h12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function StartingSoonCard({ reminder, onOpen }: { reminder: AuraReminder; onOpen?: (reminder: AuraReminder) => void }) {
  const start = new Date(reminder.startAt);
  const end = new Date(reminder.endAt);
  const timeRange = `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const participantLine = reminder.participantDisplayName
    ? reminder.momentResponseState === 'ACCEPTED'
      ? `${reminder.participantDisplayName} confirmed`
      : `Waiting for ${reminder.participantDisplayName}`
    : null;
  const actionLabel = reminder.type === 'MOMENT_APPROACHING' ? 'View Moment' : 'Open Plan';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        <span style={{ fontSize: 20 }} aria-hidden="true">{reminder.activityIcon || '✨'}</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: colors.textPrimary }}>{reminder.activityTitle}</div>
      </div>
      <div style={{ marginTop: spacing.sm, fontSize: 13, fontWeight: 850, color: colors.caution }}>{formatReminderTiming(reminder.minutesUntilStart)}</div>
      <div style={{ marginTop: 3, fontSize: 12, color: colors.textFaint }}>{timeRange}</div>
      {participantLine && <div style={{ marginTop: 3, fontSize: 12, color: colors.textFaint }}>{participantLine}</div>}
      <div style={{ marginTop: spacing.md }}>
        <SecondaryButton onClick={() => onOpen?.(reminder)} style={{ borderColor: 'rgba(250, 204, 21, 0.42)', color: colors.caution, background: colors.cautionSoft }}>
          {actionLabel}
        </SecondaryButton>
      </div>
    </div>
  );
}

function primaryActionLabel(durationMode: ActivityDurationMode): string {
  if (durationMode === 'INSTANT') return 'Log now';
  if (durationMode === 'FIXED') return 'Do now';
  return 'Start now';
}

function GoodRightNowCard({
  card,
  activeWindowName,
  onLogActivity,
  onPlanClick,
  onLogged,
  logEntries,
}: {
  card: ActionCard;
  activeWindowName: string;
  onLogActivity?: HomeDashboardProps['onLogActivity'];
  onPlanClick?: (activity?: string) => void;
  onLogged?: (title: string) => void;
  logEntries?: LoggedEntryItem[];
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'logged' | 'pending' | 'error'>('idle');
  const [loggedAtLabel, setLoggedAtLabel] = useState('');
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const loggingRef = useRef(false);

  const definition = card.activityId ? getActivityDefinition(card.activityId) : undefined;
  const action: ImmediateAction = definition?.experience.immediateAction ?? card.immediateAction ?? 'LOG_NOW';
  const durationMode: ActivityDurationMode = definition?.experience.durationMode ?? 'USER_SELECTED';
  const catalogTitle = card.activityId ? FULL_ACTIVITY_CATALOG.find((activity) => activity.id === card.activityId)?.title : undefined;
  const planTitle = catalogTitle ?? card.title;

  useEffect(() => {
    if (status !== 'pending') return;
    const resolved = resolvePendingActivityStatus(logEntries ?? [], planTitle.trim().toLowerCase());
    if (resolved === 'confirmed') {
      setStatus('logged');
      setLoggedAtLabel(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    } else if (resolved === 'gone') {
      setStatus('idle');
    }
  }, [logEntries, status, planTitle]);

  const logWithDuration = async (durationMinutes: number) => {
    if (loggingRef.current || status === 'loading' || !onLogActivity) return;
    loggingRef.current = true;
    setStatus('loading');
    setShowDurationPicker(false);
    onLogged?.(planTitle);
    try {
      const outcome = await onLogActivity(planTitle, undefined, undefined, activeWindowName, durationMinutes, 'AURA_DO_NOW', definition?.muhurta.significance, card.activityId);
      if (outcome === 'pending') {
        setStatus('pending');
      } else {
        setStatus('logged');
        setLoggedAtLabel(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
        triggerHaptic('success');
        trackEvent('ACTIVITY_LOGGED_NOW', {
          metadata: {
            ...(card.activityId ? { activityId: card.activityId } : {}),
            source: 'HOME',
            windowType: normalizeWindowType(activeWindowName),
            actionType: action === 'BOTH' ? 'START_NOW' : (action as 'LOG_NOW' | 'START_NOW'),
            durationMode,
            durationMinutes,
          },
        });
      }
    } catch {
      setStatus('error');
    } finally {
      loggingRef.current = false;
    }
  };

  const handlePrimaryClick = () => {
    if (durationMode === 'INSTANT') {
      logWithDuration(0);
    } else if (durationMode === 'FIXED') {
      logWithDuration(definition?.experience.defaultDurationMinutes ?? 10);
    } else {
      setShowDurationPicker(true);
    }
  };

  if (status === 'logged' || status === 'pending') {
    return (
      <div style={goodRightNowCardStyle}>
        <span style={{ fontSize: 20 }}>{card.icon ?? '✨'}</span>
        <span style={{ marginTop: 8, color: '#f8fafc', fontSize: 12, fontWeight: 800, lineHeight: 1.3 }}>{card.title}</span>
        {status === 'logged' ? (
          <span style={{ marginTop: 'auto', paddingTop: 8, color: '#4ade80', fontSize: 11, fontWeight: 850 }}>✓ Logged at {loggedAtLabel}</span>
        ) : (
          <span style={{ marginTop: 'auto', paddingTop: 8, color: '#facc15', fontSize: 11, fontWeight: 850 }}>⏳ Saved offline · will sync</span>
        )}
      </div>
    );
  }

  return (
    <div style={goodRightNowCardStyle}>
      <span style={{ fontSize: 20 }}>{card.icon ?? '✨'}</span>
      <span style={{ marginTop: 8, color: '#f8fafc', fontSize: 12, fontWeight: 800, lineHeight: 1.3 }}>{card.title}</span>
      <span style={{ marginTop: 4, color: '#94a3b8', fontSize: 10.5, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{card.description}</span>
      <div style={{ marginTop: 'auto', paddingTop: 8, width: '100%' }}>
        {action === 'PLAN' ? (
          <button type="button" onClick={() => onPlanClick?.(planTitle)} style={goodRightNowActionButtonStyle} aria-label={`Plan ${planTitle}`}>
            Plan
          </button>
        ) : showDurationPicker ? (
          <DurationPicker options={definition?.experience.suggestedDurations ?? [30, 60, 90]} onSelect={logWithDuration} onCancel={() => setShowDurationPicker(false)} />
        ) : (
          <button
            type="button"
            onClick={handlePrimaryClick}
            disabled={status === 'loading'}
            style={{ ...goodRightNowActionButtonStyle, opacity: status === 'loading' ? 0.6 : 1, cursor: status === 'loading' ? 'default' : 'pointer' }}
            aria-label={`${primaryActionLabel(durationMode)} ${planTitle}`}
          >
            {status === 'loading' ? 'Logging…' : primaryActionLabel(durationMode)}
          </button>
        )}
        {status === 'error' && <div style={{ color: '#fb7185', fontSize: 10, marginTop: 5 }}>Couldn&apos;t log. Try again.</div>}
      </div>
    </div>
  );
}

function DurationPicker({ options, onSelect, onCancel }: { options: number[]; onSelect: (minutes: number) => void; onCancel: () => void }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {options.map((minutes) => (
          <button key={minutes} type="button" onClick={() => onSelect(minutes)} aria-label={`Start now for ${minutes} minutes`} style={{ ...goodRightNowActionButtonStyle, width: 'auto', flex: '1 1 auto', minWidth: 0, padding: '0 6px' }}>
            {minutes}m
          </button>
        ))}
      </div>
      <button type="button" onClick={onCancel} style={{ ...goodRightNowSecondaryLinkStyle, marginTop: 5 }}>
        Cancel
      </button>
    </div>
  );
}

function ReflectionButton({ label, icon, disabled, onClick }: { label: string; icon: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} style={{ minHeight: 54, borderRadius: 10, border: '1px solid rgba(148, 163, 184, 0.22)', background: 'rgba(2, 6, 23, 0.36)', color: '#f8fafc', fontSize: 13, fontWeight: 850, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
      <span style={{ fontSize: 21, marginRight: 8, color: label === 'Strong' ? '#4ade80' : label === 'Balanced' ? '#facc15' : '#60a5fa' }}>{icon}</span>
      {label}
    </button>
  );
}

function formatReflectionLabel(outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW') {
  if (outputLevel === 'LOW') return 'Low';
  if (outputLevel === 'PEAK_FLOW') return 'Strong';
  return 'Balanced';
}

const inputShellStyle: React.CSSProperties = {
  minHeight: 56,
  border: '1px solid rgba(96, 165, 250, 0.32)',
  borderRadius: theme.radius.md,
  background: 'rgba(2, 6, 23, 0.4)',
  display: 'grid',
  gridTemplateColumns: '34px 1fr 44px',
  alignItems: 'center',
  gap: 7,
  padding: '0 10px 0 13px',
  width: '100%',
  boxSizing: 'border-box',
};

const promptButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#94a3b8',
  fontSize: 16,
  textAlign: 'left',
  cursor: 'pointer',
  padding: 0,
};

const ideasDisclosureStyle: React.CSSProperties = {
  marginTop: spacing.md,
  border: 'none',
  background: 'transparent',
  color: colors.textFaint,
  fontSize: 12,
  fontWeight: 750,
  padding: 0,
  cursor: 'pointer',
};

const voiceButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 21,
  border: '1px solid rgba(148, 163, 184, 0.2)',
  background: 'rgba(148, 163, 184, 0.16)',
  color: '#f8fafc',
  fontSize: 22,
  fontWeight: 800,
  cursor: 'pointer',
};

const whyAskWrapStyle: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  justifyContent: 'flex-end',
  zIndex: 2,
};

const whyAskButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#aab7d2',
  fontSize: 13,
  fontWeight: 750,
  padding: 0,
  cursor: 'pointer',
};

const whyAskPanelStyle: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 8px)',
  width: 'min(300px, calc(100vw - 48px))',
  border: '1px solid rgba(96, 165, 250, 0.18)',
  borderRadius: 10,
  background: 'rgba(15, 23, 42, 0.98)',
  boxShadow: '0 18px 34px rgba(0, 0, 0, 0.36)',
  color: '#cbd5e1',
  fontSize: 12,
  lineHeight: 1.45,
  padding: 11,
  textAlign: 'left',
};

const goodRightNowCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  textAlign: 'left',
  minHeight: 108,
  border: `1px solid ${colors.borderSubtle}`,
  borderRadius: theme.radius.md,
  background: 'rgba(2, 6, 23, 0.4)',
  padding: '11px 10px',
};

const goodRightNowActionButtonStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 30,
  border: `1px solid ${colors.accentBorder}`,
  borderRadius: theme.radius.sm,
  background: colors.positiveSoft,
  color: colors.positive,
  fontSize: 11,
  fontWeight: 850,
  cursor: 'pointer',
};

const goodRightNowSecondaryLinkStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'center',
  marginTop: 6,
  border: 'none',
  background: 'transparent',
  color: colors.textMuted,
  fontSize: 10,
  fontWeight: 750,
  cursor: 'pointer',
  padding: 0,
};
