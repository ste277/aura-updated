'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { UserChartContext, FULL_ACTIVITY_CATALOG, normalizeWindowType } from '../../../packages/recommendation/src/personalizedTasks';
import { getActionCards, getActivityDiscoveryCards, ActionCard } from '../../../packages/recommendation/src/actionCards';
import type { PersonalMuhurtaContext } from '../../../packages/recommendation/src/auraFitEngine';
import { getActivityDefinition, ImmediateAction, ActivityDurationMode } from '../../../packages/recommendation/src/activityDefinitions';
import type { DailyBriefing } from '../../../packages/recommendation/src/dailyAssistant';
import type { AuraUpdate } from '../lib/auraUpdates';
import type { AuraReminder } from '../lib/auraReminders';
import { formatReminderTiming } from '../lib/auraReminders';
import { triggerHaptic } from '../lib/haptics';
import { stripCountdownWrapper } from '../lib/formatTimeLeft';
import { trackEvent } from '../lib/trackEvent';
import * as theme from './theme';
import { colors, spacing, typography } from './theme';
import { PageHeader, SectionHeader, SurfaceCard, StatusBadge, IconButton, PrimaryButton, SecondaryButton, TextButton, ActivityChip } from './ui';
import type { DailyAgenda, DailyAgendaItem } from '../lib/dailyAgenda';
import type { DailyStory } from '../lib/dailyStory';
import type { DailyReflection } from '../lib/dailyReflection';
import type { TomorrowPreview } from '../lib/tomorrowPreview';
import { deriveNextMeaningfulThing } from '../lib/nextMeaningfulThing';
import { deriveAuraSuggestion, AuraSuggestion } from '../lib/auraSuggests';
import { MyDayStoryCard } from './MyDayStoryCard';
import { DayBuilderCard } from './DayBuilderCard';
import { PersonalizationPromptCard } from './PersonalizationPromptCard';
import type { DailyIntentionGroupId } from '../lib/dailyIntentions';
import { YourDayTimeline } from './YourDayTimeline';

interface HomeDashboardProps {
  userName: string;
  energyScore: number;
  themeText: string;
  bestForToday: string[];
  cautionItems: string[];
  nextShift: {
    windowName: string;
    startsIn: string;
    startTime: string;
    /** The upcoming window's OWN score/theme (see DailyEnergyInsight.nextShift
     * in lib/scoreEngine.ts) -- the "Next Best Moment" card must use these,
     * not the top-level energyScore/themeText props, which describe the
     * CURRENT window instead. */
    score: number;
    themeText: string;
  };
  currentWindow?: {
    name: string;
    startTime: string;
    endTime: string;
    timeRemaining: string;
  };
  activeWindowName?: string;
  /** Full-day window list, already computed in page.tsx (mappedTimelineWindows)
   * for TimelineView -- reused here only to cross-reference Next Best
   * Moment's own end time (nextMomentWindow below). */
  dayWindows?: HomeDayWindow[];
  loggedActivitiesToday?: string[];
  dailyBriefing?: DailyBriefing | null;
  todayReflection?: {
    outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW';
    followedGuidance: boolean;
  } | null;
  userChart?: UserChartContext;
  /** Home Good Right Now Personalization V1 -- the owner's derived natal
   * context (never raw birth date/time/timezone), sourced server-side from
   * GET /api/daily-assistant/briefing's own buildPersonalMuhurtaContextForUser()
   * call (page.tsx) and threaded into selectGoodRightNowCards' discovery-card
   * ranking below -- the SAME optional parameter Ask Aura everyday CHECK/
   * FIND, Day Builder, and ordinary Plan Timing Search already pass to
   * evaluateActivityFit(). Undefined for an incomplete birth profile,
   * exactly buildPersonalMuhurtaContextForUser's own existing contract --
   * no clarification, no onboarding interruption, natural neutral
   * degradation to today's existing (unpersonalized) behavior. */
  personalContext?: PersonalMuhurtaContext;
  onLogActivity?: (
    activityTitle: string,
    notes?: string,
    customTimestamp?: Date,
    overrideWindowType?: string,
    durationMinutes?: number,
    logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION',
    activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH'
  ) => Promise<void>;
  onSubmitReflection?: (outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW', followedGuidance: boolean) => Promise<void>;
  onLogPlan?: (planId: string) => Promise<void>;
  onNextShiftClick?: () => void;
  onPlanClick?: (activity?: string) => void;
  onInsightsClick?: () => void;
  /** Product Structure V2 (brief section 25) -- the bell is now the primary
   * Aura Updates entry point (was window-alert settings; that moved to You
   * -> Preferences). */
  onNotificationsClick?: () => void;
  /** Product Structure V2 (brief section 25) -- reuses Aura Updates V1's
   * unreadCount exactly, no new notification state. Omitted or 0 renders no
   * badge. */
  unreadUpdatesCount?: number;
  onPanchangClick?: () => void;
  /** Product Structure V2 (brief section 27): now the SAME already-sorted
   * list Aura Updates V1 produces, capped to just its single most
   * actionable/most-recent entry (updates[0]) -- one card, not up to 3, so
   * Home doesn't duplicate the bell's own Updates screen. Omitted or
   * undefined renders no section at all -- never an empty state. */
  topMomentUpdate?: AuraUpdate;
  /** Opens the moment's own public link (View / View moment) AND marks its
   * response seen -- both happen together, see page.tsx. */
  onViewMomentUpdate?: (momentToken: string) => void;
  /** Routes into the EXISTING Shared Moments reschedule flow (brief section
   * 12: "Do not create a second alternatives flow") -- never runs a search
   * on Home itself. */
  onFindAnotherTimeForMoment?: (momentToken: string) => void;
  /** Aura Reminders V1 (brief section 20/21) -- the SINGLE most imminent
   * active reminder (already the first entry of the already-sorted
   * `upcoming` list GET /api/aura-updates returns), or undefined/null when
   * nothing is currently starting soon. Home reacts to just this one, using
   * only its already-saved/safe fields -- no recomputation of any timing
   * score happens here. */
  startingSoonReminder?: AuraReminder | null;
  /** Explicit destination for the reminder's own action button (brief
   * section 22) -- routes to the relevant Plan or Moment, never to Home. */
  onOpenReminder?: (reminder: AuraReminder) => void;
  /** My Day V1 -- GET /api/my-day's response. Both null/undefined while
   * loading or if the fetch failed; Home degrades gracefully (no My Day
   * section rendered) rather than showing an error state for what's meant
   * to be a lightweight, optional-feeling layer. */
  myDayAgenda?: DailyAgenda | null;
  myDayStory?: DailyStory | null;
  /** Daily Reflection & Tomorrow Preview V1 -- also from GET /api/my-day.
   * reflection is null until the API returns; tomorrowPreview is only ever
   * populated at the NIGHT phase (brief section 4/8), null the rest of the
   * day by design, not a loading state. */
  myDayReflection?: DailyReflection | null;
  myDayTomorrowPreview?: TomorrowPreview | null;
  /** Refetches /api/my-day -- called after "Add to my day"/"Invite
   * someone" succeeds so Your Day reflects the new item immediately. */
  onMyDayChanged?: () => void;
  /** Routes to People (brief section 27's "+ Add person" -- reuses the
   * existing People screen/add-person form, never a lightweight duplicate
   * that skips required birth data). */
  onOpenPeople?: () => void;
  /** Opens the relevant Plan/Moment for an agenda item tap (brief section
   * 36) -- same routing convention as onOpenReminder above. */
  onOpenAgendaItem?: (item: DailyAgendaItem) => void;
  /** Daily Reflection & Tomorrow Preview V1 (brief section 5) -- routes into
   * Plan/Timing Search with the TOMORROW horizon (and, when provided, an
   * activity preselected). Never creates a Plan itself. Falls back to
   * onPlanClick (today, no horizon override) if not provided, same as the
   * pre-existing "Plan tomorrow" link's behavior. */
  onPlanTomorrow?: (activityTitle?: string) => void;
  /** Day Builder "Show me less like this" (brief: dismiss support) --
   * updates the EXISTING muted-group preference, never a new mechanism. */
  onMuteDayBuilderGroup?: (groupId: DailyIntentionGroupId) => void;
  /** Personalization Foundation V1 -- drives whether/what
   * PersonalizationPromptCard shows above DayBuilderCard. */
  dayBuilderEnabled?: boolean;
  dayBuilderPriorities?: string[];
  dayBuilderPrioritiesPromptDismissed?: boolean;
  onDayBuilderPrefsChange?: (next: Partial<{ dayBuilderPriorities: string[]; dayBuilderPrioritiesPromptDismissed: boolean }>) => void;
}

interface HomeDayWindow {
  name: string;
  startTime: string;
  endTime: string;
  startMinute: number;
  endMinute: number;
  /** 'friction' | 'auspicious' | 'neutral' in practice (see page.tsx's
   * mappedTimelineWindows) -- left as `string` here since that value is
   * inferred, not literal-typed, at its source. */
  type: string;
}

const PROMPT_CHIPS = ['Workout', 'Deep work', 'Study', 'Date night'];

// "Best Time" is a claim of credibility: it should only appear once the engine
// has actually evaluated a window as genuinely strong (e.g. Abhijit, a real
// Muhurta peak). Neutral Flow is the *absence* of a special window, not a
// verdict that now is the best moment for anything — so it always gets its
// own honest "Flexible" framing here, regardless of its numeric score.
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
      description: 'Flexible period for steady progress. Good for existing work, everyday tasks, and activities that don\u2019t need a special window.',
    };
  }
  if (score >= 7.5) return { label: 'Strong Window', pill: 'Best Time', color: '#4ade80', description: 'Good for focused, important, or momentum-building work.' };
  if (score >= 5) return { label: 'Good Window', pill: 'Good Time', color: '#4ade80', description: 'Good for steady progress, planning, and everyday tasks.' };
  return { label: 'Light Flow', pill: 'Steady Time', color: '#facc15', description: 'Good for maintenance, reflection, and gentle progress.' };
}

/** Product Journey / E2E Hardening V1 (brief section 18) -- "Next Best
 * Moment" is a claim of credibility, same principle as getWindowTone's own
 * "Best Time" doc comment above. Calling a caution/low-quality candidate
 * "Best" merely because it's the highest-scoring one left today is
 * conceptually contradictory (the reported example: "Next Best Moment /
 * Caution Window / 4.2/10"). Reuses getWindowTone's own existing tone
 * classification -- no new astrology threshold. */
export function nextMomentSurfaceLabel(tone: { pill: string }): { icon: string; label: string } {
  return tone.pill === 'Caution' ? { icon: '🕐', label: 'Coming Up' } : { icon: '⭐', label: 'Next Best Moment' };
}

/** Maps getWindowTone's own hex color to a StatusBadge tone (brief section
 * 6: colored by semantic meaning, not a fresh color per screen) -- never a
 * second color decision, just a lookup against the same four hex values
 * getWindowTone already returns. */
function toneToStatusTone(hexColor: string): 'positive' | 'caution' | 'danger' | 'info' {
  if (hexColor === '#fb6b6b') return 'danger';
  if (hexColor === '#38bdf8') return 'info';
  if (hexColor === '#facc15') return 'caution';
  return 'positive';
}

// Human-readable hero heading, derived from the same window-type data
// getWindowTone already reads -- never a fixed "Neutral Flow" heading. Keyed
// on the same categories getWindowTone/normalizeWindowType use elsewhere.
function getHeroHeadline(windowName: string): string {
  const cleanWindow = windowName.toUpperCase();
  if (cleanWindow.includes('RAHU')) return 'Better to avoid important new starts';
  if (cleanWindow.includes('YAMA')) return 'Keep things routine for now';
  if (cleanWindow.includes('BRAHMA')) return 'Quiet time for clarity and reflection';
  if (cleanWindow.includes('ABHIJIT') || cleanWindow.includes('VIJAYA')) return 'Strong time for important work';
  if (cleanWindow.includes('GULIKA')) return 'Steady time for ongoing work';
  return 'Good time to keep things moving';
}

// nextShift.startsIn is always phrased "In Xh Ym" (scoreEngine.ts) for a
// window that, by construction, hasn't started yet at the moment it was
// computed -- but the value can go stale by the time it renders (the clock
// ticks once a minute). Treating a non-positive/empty remainder as "already
// started" is a presentation-only safety net, not a new calculation.
function formatNextMomentTiming(startsIn: string): string {
  const bare = stripCountdownWrapper(startsIn);
  const hasRemainingTime = /[1-9]/.test(bare);
  return hasRemainingTime ? `Starts in ${bare}` : 'Active now';
}

function formatWindowName(name: string) {
  // Callers pass raw SolarWindowType-style strings (e.g. "ABHIJIT",
  // "RAHU_KALAM") as often as already-cased labels -- lowercasing first
  // makes the title-case regex actually title-case rather than a no-op on
  // strings that were already all-uppercase.
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

function scoreLabel(score: number) {
  return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
}


/**
 * "Good right now" -- the deterministic window -> 3 activity cards table
 * (packages/recommendation/src/actionCards.ts), already used by Timeline's
 * own tap-arc interaction. A card whose canonical activity has already been
 * logged TODAY (loggedActivitiesToday), other than one logged from THIS
 * Home visit's own cards (justLoggedTitles), is swapped for the next-best
 * still-undone activity for this SAME window, sourced from the existing
 * catalog-driven getActivityDiscoveryCards() ranking rather than inventing
 * a second "what else fits this window" concept. PLAN-only alternatives are
 * excluded -- "Good Right Now" is about doing something now, not proposing
 * an occasion to plan for later.
 *
 * justLoggedTitles exists so a card the user just tapped keeps showing its
 * own "✓ Logged" confirmation for the rest of THIS visit instead of being
 * swapped away the instant handleLogActivity's optimistic update lands in
 * loggedActivitiesToday (a real race: page.tsx updates loggedActivitiesToday
 * synchronously, before its own network call even resolves). It resets
 * naturally on the next fresh mount (e.g. navigating away and back to
 * Home), which is exactly when the swap SHOULD apply -- this is what stops
 * a logged/started activity from reappearing as clickable again after
 * leaving and returning to Home.
 *
 * Exported (not inlined in the component) so this selection logic is
 * testable without rendering React -- see test/goodRightNowActions.test.ts.
 *
 * Home Good Right Now Personalization V1 -- `personalContext` (optional,
 * from the owner's own derived natal context) is passed ONLY into the
 * discovery/ranked alternatives path below (getActivityDiscoveryCards) --
 * never into the static base table (getActionCards, brief section 12: the
 * pre-authored immediate-action cards are not live-scored candidates), and
 * never changes logged-activity filtering, just-logged filtering, card
 * count, or fallback behavior, all of which are untouched.
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
  bestForToday,
  cautionItems,
  nextShift,
  currentWindow,
  activeWindowName = 'NEUTRAL',
  dayWindows,
  loggedActivitiesToday = [],
  dailyBriefing,
  todayReflection,
  userChart,
  personalContext,
  onLogActivity,
  onSubmitReflection,
  onLogPlan,
  onNextShiftClick,
  onPlanClick,
  onInsightsClick,
  onNotificationsClick,
  unreadUpdatesCount = 0,
  onPanchangClick,
  topMomentUpdate,
  onViewMomentUpdate,
  onFindAnotherTimeForMoment,
  startingSoonReminder,
  onOpenReminder,
  myDayAgenda,
  myDayStory,
  myDayReflection,
  myDayTomorrowPreview,
  onMyDayChanged,
  onOpenPeople,
  onOpenAgendaItem,
  onPlanTomorrow,
  onMuteDayBuilderGroup,
  dayBuilderEnabled,
  dayBuilderPriorities,
  dayBuilderPrioritiesPromptDismissed,
  onDayBuilderPrefsChange,
}: HomeDashboardProps) {
  // Home Compactness + Flexible Day Story V1 (brief section 13) -- Popular
  // chips render only for a fresh/unused state (nothing typed/tapped yet
  // this session), on focus of the Ask Aura input, or behind this small
  // disclosure -- never unconditionally on every load.
  const [askAuraIdeasOpen, setAskAuraIdeasOpen] = useState(false);
  const [reflectionSaved, setReflectionSaved] = useState(Boolean(todayReflection));
  const [isEditingReflection, setIsEditingReflection] = useState(false);
  const [isSavingReflection, setIsSavingReflection] = useState(false);
  const [reflectionError, setReflectionError] = useState('');
  const [selectedReflection, setSelectedReflection] = useState<'LOW' | 'MODERATE' | 'PEAK_FLOW' | null>(todayReflection?.outputLevel ?? null);
  const [showReflectionWhy, setShowReflectionWhy] = useState(false);

  useEffect(() => {
    setReflectionSaved(Boolean(todayReflection));
    setSelectedReflection(todayReflection?.outputLevel ?? null);
    setIsEditingReflection(false);
    setReflectionError('');
  }, [todayReflection?.outputLevel]);

  const tone = getWindowTone(energyScore, activeWindowName);
  // The "Next Best Moment" card's OWN tone -- must not reuse `tone` above,
  // which describes the CURRENT window (e.g. a Rahu Kalam caution color
  // would otherwise bleed into a favorable upcoming Abhijit window's gauge).
  const nextTone = getWindowTone(nextShift.score, nextShift.windowName);
  const nextMomentSurface = nextMomentSurfaceLabel(nextTone);
  const currentWindowLabel = dailyBriefing?.briefingState === 'ACTIVE'
    ? dailyBriefing.peakWindow.name
    : formatWindowName(currentWindow?.name ?? activeWindowName);
  const currentTimeRange = dailyBriefing?.briefingState === 'ACTIVE'
    ? `${dailyBriefing.peakWindow.startTime} - ${dailyBriefing.peakWindow.endTime}`
    : currentWindow
      ? `${currentWindow.startTime} - ${currentWindow.endTime}`
      : `Next shift ${nextShift.startTime}`;
  // Bug fix: this used to show nextShift.startsIn even while ACTIVE --
  // nextShift is the countdown to whatever window comes next
  // chronologically (scoreEngine.ts), unrelated to when the peak window
  // itself (shown just above in currentTimeRange) actually ends. That
  // produced nonsense like "11:47 AM - 12:37 PM  In 2h 56m" for a 50-minute
  // window. currentWindow.timeRemaining is already time-left-in-THIS-window
  // (page.tsx's currentWindowInfo, matched via the same getActiveWindow call
  // dailyBriefing itself uses to decide ACTIVE), so reuse it here too --
  // mirroring the currentTimeRange ternary two lines above instead of
  // diverging from it.
  const remainingText = currentWindow
    ? `${currentWindow.timeRemaining} left`
    : nextShift.startsIn;

  // See selectGoodRightNowCards' own doc comment for the full reasoning --
  // justLoggedTitles exempts a card the user just logged from THIS Home
  // visit so it keeps showing its own confirmation instead of being
  // swapped away mid-flight.
  const [justLoggedTitles, setJustLoggedTitles] = useState<Set<string>>(() => new Set());
  const handleCardLogged = (title: string) => {
    setJustLoggedTitles((prev) => new Set(prev).add(title.trim().toLowerCase()));
  };

  const goodRightNow = useMemo(
    () => selectGoodRightNowCards(activeWindowName, loggedActivitiesToday, justLoggedTitles, personalContext),
    [activeWindowName, loggedActivitiesToday, justLoggedTitles, personalContext]
  );

  // Home Recommendation Hierarchy V1 (+ amendment) -- Aura Suggests
  // interprets DailyAgenda/window context only; it never recommends a
  // catalog activity (that would overlap Good Right Now's own job even
  // with canonical-id dedup -- see auraSuggests.ts's own doc comment for
  // the full history). Hidden entirely (null) when it has nothing additive
  // to say -- a genuinely empty, non-caution day is the expected null
  // case, not a fallback state to avoid.
  const assistantSuggestion: AuraSuggestion | null = useMemo(
    () =>
      deriveAuraSuggestion({
        agenda: myDayAgenda,
        activeWindowName,
        currentWindowEndTime: currentWindow?.endTime,
      }),
    [myDayAgenda, activeWindowName, currentWindow?.endTime]
  );

  // Next Best Moment's end time -- nextShift itself only carries a start
  // time (scoreEngine.ts), so this cross-references the SAME real window in
  // dayWindows (matched by its already-identical formatted start clock) for
  // its endTime, rather than fabricating a duration.
  const nextMomentWindow = useMemo(
    () => dayWindows?.find((w) => w.startTime === nextShift.startTime) ?? null,
    [dayWindows, nextShift.startTime]
  );

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

  // My Day V1 (brief section 31/33/40) -- consolidates the previously-
  // separate "Your Moments" and "Starting Soon" cards into ONE "What's
  // Next" slot instead of asking "what needs my attention?" twice. Reuses
  // the exact same already-computed states (topMomentUpdate/
  // startingSoonReminder come from GET /api/aura-updates, myDayAgenda.nextItem
  // from GET /api/my-day) -- no new eligibility/score is computed here.
  const nextThing = deriveNextMeaningfulThing({ topMomentUpdate, startingSoonReminder, agenda: myDayAgenda });

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

      {myDayStory && (
        <MyDayStoryCard
          story={myDayStory}
          reflection={myDayReflection ?? null}
          tomorrowPreview={myDayTomorrowPreview ?? null}
          onOpenPeople={() => onOpenPeople?.()}
          onCreated={() => onMyDayChanged?.()}
          onPlanTomorrow={(activityTitle) => (onPlanTomorrow ? onPlanTomorrow(activityTitle) : onPlanClick?.())}
        />
      )}

      {/* Personalization Foundation V1 -- a quiet, one-time nudge; renders
       * nothing once priorities are set or the prompt was dismissed (see
       * PersonalizationPromptCard's own shouldShow logic). */}
      {onDayBuilderPrefsChange && (
        <PersonalizationPromptCard
          dayBuilderEnabled={dayBuilderEnabled ?? true}
          dayBuilderPriorities={dayBuilderPriorities ?? []}
          dayBuilderPrioritiesPromptDismissed={dayBuilderPrioritiesPromptDismissed ?? false}
          onChange={onDayBuilderPrefsChange}
        />
      )}

      {/* Intentional Day Builder V1 -- a self-contained sibling to
       * MyDayStoryCard above, sharing the same Daily Story visual region
       * (brief: "Daily Story should evolve... into something that actively
       * helps shape the day"). Keyed on myDayAgenda?.localDate so it
       * re-fetches its own suggestions when the local day actually
       * changes, not on every unrelated My Day refresh. */}
      {myDayStory && myDayAgenda && (
        <DayBuilderCard
          key={myDayAgenda.localDate}
          dayPhase={myDayStory.phase}
          localDate={myDayAgenda.localDate}
          onCreated={() => onMyDayChanged?.()}
          onMuteGroup={onMuteDayBuilderGroup}
        />
      )}

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
            label="Good Right Now"
            right={onNextShiftClick && <TextButton onClick={onNextShiftClick}>See all activities →</TextButton>}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: spacing.sm }}>
            {goodRightNow.map((card) => (
              <GoodRightNowCard
                key={card.id}
                card={card}
                activeWindowName={activeWindowName}
                onLogActivity={onLogActivity}
                onPlanClick={onPlanClick}
                onLogged={handleCardLogged}
              />
            ))}
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard>
        <div style={inputShellStyle}>
          <span style={{ color: '#93c5fd', fontSize: 23 }}>✦</span>
          <button
            type="button"
            onClick={() => onPlanClick?.()}
            onFocus={() => setAskAuraIdeasOpen(true)}
            style={promptButtonStyle}
          >
            Ask Aura anything...
          </button>
          <button type="button" onClick={() => onPlanClick?.()} style={voiceButtonStyle} aria-label="Find a time">
            →
          </button>
        </div>
        {/* Home Compactness + Flexible Day Story V1 (brief section 13) --
         * Popular chips are no longer unconditionally rendered every visit;
         * a small "Ideas" disclosure keeps them one tap away without
         * costing vertical space on every load. Focusing the input above
         * also reveals them directly (no extra tap needed there). */}
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

      {/* Home cleanup (Daily Reflection & Tomorrow Preview V1 follow-up) --
       * the standalone "What's Next" card is gone for a normal upcoming
       * Plan/Moment (tier 3, deriveNextMeaningfulThing's AGENDA_ITEM kind):
       * that item now gets a NEXT eyebrow directly inside "Your Day" below
       * instead of a duplicate card up here (see YourDayTimeline's
       * nextItemId). Tiers 1-2 are NOT duplicates -- an actionable Moment
       * coordination issue or an active Starting Soon reminder carry
       * context Your Day's plain row doesn't, so they keep surfacing here
       * exactly as before. deriveNextMeaningfulThing() itself is
       * untouched; only which of its outcomes render a standalone card
       * changed. */}
      {nextThing && nextThing.kind !== 'AGENDA_ITEM' && (
        <section>
          <SectionHeader label="What's Next" />
          {nextThing.kind === 'MOMENT_UPDATE' && (() => {
            const update = nextThing.update;
            const { day, time } = formatUpdateDateTime(update.eventStartAt);
            const isAccepted = update.type === 'MOMENT_ACCEPTED';
            return (
              <SurfaceCard accentColor={isAccepted ? colors.positive : colors.caution}>
                <div style={{ fontSize: 13, fontWeight: 800, color: isAccepted ? colors.positive : colors.caution }}>
                  {isAccepted ? `❤️ ${update.recipientDisplayName ?? 'They'} is in` : `↻ ${update.recipientDisplayName ?? 'They'} want${update.recipientDisplayName ? 's' : ''} another time`}
                </div>
                <div style={{ marginTop: spacing.sm, fontSize: 14, fontWeight: 750, color: colors.textPrimary }}>{update.activityTitle}</div>
                <div style={{ marginTop: 3, fontSize: 12, color: colors.textFaint }}>
                  {isAccepted ? `${day} · ${time}` : `Prefers: ${PREFERENCE_TEXT[update.preference ?? 'NO_PREFERENCE']}`}
                </div>
                <div style={{ marginTop: spacing.md }}>
                  <SecondaryButton onClick={() => (isAccepted ? onViewMomentUpdate?.(update.momentToken) : onFindAnotherTimeForMoment?.(update.momentToken))}>
                    {isAccepted ? 'View' : 'Find another time'}
                  </SecondaryButton>
                </div>
              </SurfaceCard>
            );
          })()}
          {nextThing.kind === 'STARTING_SOON' && <StartingSoonCard reminder={nextThing.reminder} onOpen={onOpenReminder} />}
        </section>
      )}

      <YourDayTimeline agenda={myDayAgenda ?? null} onOpenItem={onOpenAgendaItem} onAddSomething={() => onPlanClick?.()} />

      <div style={pairGridStyle}>
        {/* Home Recommendation Hierarchy V1 -- hidden entirely rather than
         * duplicating Good Right Now or repeating a bare agenda fact when
         * deriveAuraSuggestion() has nothing additive to say. Zero Aura
         * Suggests is a valid, expected state -- never populated just
         * because the layout expects a card. */}
        {assistantSuggestion && (
          <SurfaceCard>
            <div style={typography.sectionEyebrow}>✨ Aura Suggests</div>
            <div style={{ display: 'grid', gridTemplateColumns: '74px minmax(0, 1fr)', alignItems: 'center', gap: spacing.md, marginTop: spacing.md }}>
              <div style={suggestIconStyle}>{assistantSuggestion.icon}</div>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, color: colors.textPrimary, fontSize: 18, lineHeight: 1.2 }}>{assistantSuggestion.title}</h2>
                <p style={{ margin: '8px 0 0', color: colors.textFaint, lineHeight: 1.38, fontSize: 14 }}>{assistantSuggestion.description}</p>
              </div>
              {/* CAUTION_CONTEXT carries no actionLabel at all (brief
               * amendment section 4/7: "no action required") -- nothing
               * renders below the copy. Every OTHER type either describes
               * an existing agenda item (View -> onOpenAgendaItem, the same
               * routing Your Day's own rows use) or is OPEN_GAP (Add
               * something -> onPlanClick, reusing Your Day's own timeline
               * entry point -- never a second Plan flow, never a log
               * action: Aura Suggests doesn't recommend activities). */}
              {assistantSuggestion.actionLabel && (
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: spacing.md, alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
                  <PrimaryButton
                    onClick={() => {
                      if (assistantSuggestion.agendaItem) {
                        onOpenAgendaItem?.(assistantSuggestion.agendaItem);
                        return;
                      }
                      onPlanClick?.();
                    }}
                  >
                    {assistantSuggestion.actionLabel}
                  </PrimaryButton>
                  <TextButton onClick={() => onNextShiftClick?.()}>
                    {assistantSuggestion.secondaryLabel} →
                  </TextButton>
                </div>
              )}
            </div>
          </SurfaceCard>
        )}

        <SurfaceCard style={{ display: 'grid', gridTemplateColumns: '1fr 74px', gap: spacing.md, alignItems: 'center' }}>
          <div>
            <div style={{ ...typography.sectionEyebrow, color: colors.caution }}>{nextMomentSurface.icon} {nextMomentSurface.label}</div>
            <h2 style={{ margin: '14px 0 0', color: colors.textPrimary, fontSize: 22 }}>{nextShift.windowName}</h2>
            <div style={{ marginTop: 7, color: colors.info, fontSize: 15, fontWeight: 850 }}>{formatNextMomentTiming(nextShift.startsIn)}</div>
            {nextMomentWindow && (
              <div style={{ marginTop: 3, color: colors.textMuted, fontSize: 13 }}>{nextMomentWindow.startTime} – {nextMomentWindow.endTime}</div>
            )}
            <p style={{ color: colors.textFaint, fontSize: 14, margin: '10px 0 0' }}>{nextShift.themeText}</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: spacing.sm }}>
            <ScoreGauge score={scoreLabel(nextShift.score)} color={nextTone.color} />
            <SecondaryButton onClick={() => onPlanClick?.()}>Plan this</SecondaryButton>
          </div>
        </SurfaceCard>
      </div>

      {/* My Day V1 (brief section 40) -- decluttered, not removed: the
       * inline 4-window preview grid duplicated what "Your Day" above and
       * the full Timeline/Panchang screens (one tap away below) already
       * show. Panchang's own window-by-window detail belongs on those
       * screens, not repeated here (brief section 29: Panchang answers
       * "when", My Day/Your Day answers "what does my day look like"). */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'center', gap: spacing.xl }}>
          <TextButton onClick={onNextShiftClick} style={{ display: 'block', margin: '0 auto', fontSize: 15 }}>View full day timeline →</TextButton>
          {onPanchangClick && (
            <TextButton onClick={onPanchangClick} color={colors.traditional} style={{ display: 'block', margin: '0 auto', fontSize: 15 }}>Today&apos;s Panchang →</TextButton>
          )}
        </div>
      </section>

      <div style={pairGridStyle}>
      {onSubmitReflection && (
        <SurfaceCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'center' }}>
            <div style={{ ...typography.sectionEyebrow, color: colors.caution }}>Daily Check-in</div>
            <div
              style={whyAskWrapStyle}
              onMouseEnter={() => setShowReflectionWhy(true)}
              onMouseLeave={() => setShowReflectionWhy(false)}
              onFocus={() => setShowReflectionWhy(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setShowReflectionWhy(false);
              }}
            >
              <button
                type="button"
                aria-expanded={showReflectionWhy}
                onClick={() => setShowReflectionWhy((value) => !value)}
                style={whyAskButtonStyle}
              >
                Why we ask ⓘ
              </button>
              {showReflectionWhy && (
                <div style={whyAskPanelStyle}>
                  Aura compares how your day felt with when you logged activities. Balanced counts as partial signal, Strong as high signal, and Low as low signal, so Insights can learn which windows actually help you.
                </div>
              )}
            </div>
          </div>
          <h2 style={{ margin: '13px 0 0', color: colors.textPrimary, fontSize: 18 }}>How did today feel so far?</h2>
          {reflectionSaved && !isEditingReflection ? (
            // Home Compactness + Flexible Day Story V1 (brief section 18) --
            // stays collapsed to one compact line after answering; "Change"
            // is the only way back to the full Low/Balanced/Strong controls.
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
        </SurfaceCard>
      )}

      <SurfaceCard padding={15} style={{ display: 'grid', gridTemplateColumns: '30px 1fr', alignItems: 'start', gap: spacing.md }}>
        <div style={{ color: colors.positive, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AuraInsightIcon />
        </div>
        <div>
          <div style={{ ...typography.sectionEyebrow, marginBottom: spacing.xs }}>Aura Insight</div>
          <div style={{ color: colors.textSecondary, fontSize: 13.5, lineHeight: 1.4 }}>
            {bestForToday[0] ? `You tend to do well with ${bestForToday[0].toLowerCase()} during ${currentWindowLabel} windows.` : 'Your best patterns will appear as you log more moments.'}
          </div>
          {cautionItems[0] && <div style={{ color: colors.textMuted, fontSize: 11.5, marginTop: spacing.xs }}>Avoid: {cautionItems[0]}</div>}
          <TextButton onClick={onInsightsClick} style={{ marginTop: spacing.sm, fontSize: 12 }}>View insights →</TextButton>
        </div>
      </SurfaceCard>
      </div>

      {/* My Day V1 (brief section 40): the bottom "Need the best time for
       * something important?" banner was a second Ask Aura entry point,
       * redundant with the "What are you thinking about?" prompt already
       * at the top of this page -- removed, not just hidden, since the top
       * one already covers the same action. */}
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

function ScoreGauge({ score, color }: { score: number; color: string }) {
  return (
    <div
      style={{
        width: 58,
        height: 58,
        borderRadius: 58,
        // Product Journey / E2E Hardening V1 (brief section 28) -- was a
        // mixed `border` shorthand + `borderLeftColor` longhand on the
        // same style object, which React warns about across re-renders
        // (a `score`/`color` prop change diffs shorthand vs. longhand
        // inconsistently). All longhand now, same visual result.
        borderWidth: 4,
        borderStyle: 'solid',
        borderTopColor: color,
        borderRightColor: color,
        borderBottomColor: color,
        borderLeftColor: 'rgba(148, 163, 184, 0.28)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'rgba(15, 23, 42, 0.75)',
      }}>
      <span style={{ color: '#f8fafc', fontSize: 19, fontWeight: 950 }}>{score}</span>
      <span style={{ color: '#aab7d2', fontSize: 10 }}>/10</span>
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


// Aura Reminders V1 (brief section 20) -- two example layouts, both handled
// by one card: a Plan reminder never has participant/response copy, a
// SHARED Moment reminder shows response-aware copy (brief section 9) only
// when it actually has one. Every field here is already on the reminder
// DTO -- no recomputation.
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
    <SurfaceCard accentColor={colors.caution}>
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
    </SurfaceCard>
  );
}

/** Good Right Now Action Semantics V1 -- durationMode-driven button copy
 * (brief section 10). Never exposes internal concepts like LOG_NOW/
 * durationMode/HabitLog to the user. */
function primaryActionLabel(durationMode: ActivityDurationMode): string {
  if (durationMode === 'INSTANT') return 'Log now';
  if (durationMode === 'FIXED') return 'Do now';
  return 'Start now'; // USER_SELECTED and SESSION (see the picker fallback below)
}

/**
 * Good Right Now Actions V1/Action Semantics V1 -- replaces the previous
 * "every card routes to Plan" behavior with canonical per-activity action
 * semantics (brief section 5/6). `card.activityId`, when present, resolves
 * to a real ActivityDefinition via getActivityDefinition() -- never a
 * title regex -- whose `experience.immediateAction` decides LOG_NOW /
 * START_NOW / PLAN / BOTH and `experience.durationMode` decides HOW that
 * immediate action's duration is determined:
 *   INSTANT       -- logs durationMinutes = 0 immediately, no picker.
 *   FIXED         -- logs the catalog's own defaultDurationMinutes
 *                    immediately, no picker.
 *   USER_SELECTED -- reveals a lightweight inline duration picker (the
 *                    catalog's own suggestedDurations) in place of the
 *                    action button; tapping one immediately logs that
 *                    duration. Still no timer.
 *   SESSION       -- not selected by any current activity (brief section
 *                    7: architecture-only in this PR); if it ever were,
 *                    this component falls back to the SAME picker
 *                    USER_SELECTED uses rather than leaving an unhandled
 *                    case -- a reasonable stand-in until a real
 *                    start/running/done flow exists to replace it with.
 *
 * Every path reuses the EXACT SAME onLogActivity pipeline Timeline already
 * logs through (brief section 8: "do not create a second logging
 * pipeline") -- this component only decides which duration/copy to use,
 * never how a log is persisted. There is no real running-session/timer
 * model anywhere in this app (audited: HabitLog stores a single fixed
 * durationMinutes, no start/stop pair) -- SESSION above is the extension
 * point a future real timer would hook into.
 */
function GoodRightNowCard({
  card,
  activeWindowName,
  onLogActivity,
  onPlanClick,
  onLogged,
}: {
  card: ActionCard;
  activeWindowName: string;
  onLogActivity?: HomeDashboardProps['onLogActivity'];
  onPlanClick?: (activity?: string) => void;
  /** Reports the canonical title back up to HomeDashboard the moment a log
   * succeeds, so it can be exempted from the "already logged today" swap
   * for the rest of this visit -- see goodRightNow's own doc comment. */
  onLogged?: (title: string) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'logged' | 'error'>('idle');
  const [loggedAtLabel, setLoggedAtLabel] = useState('');
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  // Duration Display Polish (brief section 9) -- a `status` state check
  // alone does NOT stop two clicks fired in the same synchronous event
  // (e.g. a fast physical double-tap on the duration picker, or a stuck
  // button re-firing): both handlers can read the same stale 'idle' value
  // before React flushes the first setStatus('loading'), producing two
  // HabitLog rows for one tap -- confirmed live via a synchronous
  // double-click during this PR's own verification pass. A ref updates
  // immediately (no render/flush needed), so it closes that specific race;
  // `status` still drives all UI/rendering as before.
  const loggingRef = useRef(false);

  const definition = card.activityId ? getActivityDefinition(card.activityId) : undefined;
  const action: ImmediateAction = definition?.experience.immediateAction ?? card.immediateAction ?? 'LOG_NOW';
  const durationMode: ActivityDurationMode = definition?.experience.durationMode ?? 'USER_SELECTED';
  // The real catalog title (e.g. "Deep Work"), not this card's own
  // window-flavor copy (e.g. "Regular work block") -- passing the window
  // copy into Plan's existing free-text prefill would silently fail to
  // match any catalog alias and fall through to the fallback classifier.
  const catalogTitle = card.activityId ? FULL_ACTIVITY_CATALOG.find((activity) => activity.id === card.activityId)?.title : undefined;
  const planTitle = catalogTitle ?? card.title;

  const logWithDuration = async (durationMinutes: number) => {
    if (loggingRef.current || status === 'loading' || !onLogActivity) return;
    loggingRef.current = true;
    setStatus('loading');
    setShowDurationPicker(false);
    // Mark this title exempt from the "already logged today" swap BEFORE
    // calling onLogActivity, not after -- handleLogActivity (page.tsx)
    // updates loggedActivitiesToday synchronously (before its own network
    // call even resolves), so calling onLogged() only after await would
    // lose the race: the parent could already have swapped this card out
    // (and unmounted this component) before it ever reached setStatus('logged').
    onLogged?.(planTitle);
    try {
      // overrideWindowType reuses the CURRENT structured window (brief
      // section 9) already known here as a prop, never re-inferred from a
      // display string -- Insights/window distribution then sees this log
      // exactly like a Timeline-created one.
      await onLogActivity(planTitle, undefined, undefined, activeWindowName, durationMinutes, 'AURA_DO_NOW', definition?.muhurta.significance);
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
    } catch {
      // handleLogActivity (page.tsx) is itself optimistic/offline-resilient
      // and rarely rejects -- this mainly guards the case onLogActivity is
      // missing entirely. See the completion report for why a genuine
      // server failure has no reliable signal to surface here today.
      setStatus('error');
    } finally {
      // Only the 'error' branch re-renders a clickable button again ('logged'
      // renders no button at all) -- reset here so a retry after a genuine
      // failure isn't permanently inert, while a completed log can never be
      // double-submitted since there's nothing left to click.
      loggingRef.current = false;
    }
  };

  const handlePrimaryClick = () => {
    if (durationMode === 'INSTANT') {
      logWithDuration(0);
    } else if (durationMode === 'FIXED') {
      // Defensive-only fallback (every FIXED-mapped activity has a real
      // catalog defaultDurationMinutes) -- the catalog stays the source of
      // truth, this never overrides it (brief section 5).
      logWithDuration(definition?.experience.defaultDurationMinutes ?? 10);
    } else {
      setShowDurationPicker(true);
    }
  };

  if (status === 'logged') {
    return (
      <div style={goodRightNowCardStyle}>
        <span style={{ fontSize: 20 }}>{card.icon ?? '✨'}</span>
        <span style={{ marginTop: 8, color: '#f8fafc', fontSize: 12, fontWeight: 800, lineHeight: 1.3 }}>{card.title}</span>
        <span style={{ marginTop: 'auto', paddingTop: 8, color: '#4ade80', fontSize: 11, fontWeight: 850 }}>✓ Logged at {loggedAtLabel}</span>
      </div>
    );
  }

  return (
    <div style={goodRightNowCardStyle}>
      <span style={{ fontSize: 20 }}>{card.icon ?? '✨'}</span>
      <span style={{ marginTop: 8, color: '#f8fafc', fontSize: 12, fontWeight: 800, lineHeight: 1.3 }}>{card.title}</span>
      {/* Home Compactness + Flexible Day Story V1 (brief section 11) --
       * a short tag line, not a repeated paragraph explaining the current
       * window again (that's the "Right Now" hero's own job, just above).
       * Clamped to 1 line -- card.description is already short catalog
       * copy, so this rarely truncates in practice. */}
      <span style={{ marginTop: 4, color: '#94a3b8', fontSize: 10.5, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{card.description}</span>
      <div style={{ marginTop: 'auto', paddingTop: 8, width: '100%' }}>
        {action === 'PLAN' ? (
          <button type="button" onClick={() => onPlanClick?.(planTitle)} style={goodRightNowActionButtonStyle} aria-label={`Plan ${planTitle}`}>
            Plan
          </button>
        ) : showDurationPicker ? (
          <DurationPicker
            options={definition?.experience.suggestedDurations ?? [30, 60, 90]}
            onSelect={logWithDuration}
            onCancel={() => setShowDurationPicker(false)}
          />
        ) : (
          // Home Compactness + Flexible Day Story V1 (brief section 12) --
          // "Plan for later" removed from this compact card: Good Right Now
          // = immediate action, Day Builder = add meaningful things to
          // today, Plan = explicit search/planning. A BOTH activity's
          // planning path remains fully available from Plan/Day Builder,
          // just not duplicated as a second action on every card here.
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

/** Good Right Now Action Semantics V1 (brief section 6) -- the lightweight
 * duration chooser for USER_SELECTED activities: "keep this lightweight:
 * inline... no new full-screen flow." Tapping an option immediately logs
 * it (via the same onLogActivity pipeline the primary button would have
 * used) -- there is no separate confirm step, matching "Aura should feel
 * fast." */
function DurationPicker({ options, onSelect, onCancel }: { options: number[]; onSelect: (minutes: number) => void; onCancel: () => void }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {options.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => onSelect(minutes)}
            aria-label={`Start now for ${minutes} minutes`}
            style={{ ...goodRightNowActionButtonStyle, width: 'auto', flex: '1 1 auto', minWidth: 0, padding: '0 6px' }}
          >
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

const suggestIconStyle: React.CSSProperties = {
  width: 66,
  height: 66,
  borderRadius: 13,
  border: '1px solid rgba(96, 165, 250, 0.22)',
  background: 'rgba(2, 6, 23, 0.32)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 35,
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

// Desktop pairing (Aura Suggests + Next Best Moment; Daily Check-in + Aura
// Insight) via intrinsic grid responsiveness -- no @media query needed (none
// exist elsewhere in this app) and no new dependency: auto-fit/minmax alone
// stacks to one column under ~560px combined width and sits two-up above it.
const pairGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 17,
  alignItems: 'stretch',
};

// Good Right Now Actions V1: was a single clickable <button> wrapping the
// whole card (routed everything to Plan); now a plain container with its
// own real action button(s) inside (brief section 21: "Do not make the
// entire card clickable if the card contains more than one possible
// action"). minHeight grew to fit the new action row -- same 3-column grid,
// same card footprint otherwise, so this stays an action-semantics change,
// not a layout redesign.
const goodRightNowCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  textAlign: 'left',
  // Home Compactness + Flexible Day Story V1 (brief section 11/51) --
  // shorter now that the description clamps to 1 line and "Plan for
  // later" no longer adds a second row under BOTH-type activities.
  minHeight: 108,
  border: `1px solid ${colors.borderSubtle}`,
  borderRadius: theme.radius.md,
  background: 'rgba(2, 6, 23, 0.4)',
  padding: '11px 10px',
};

// One primary action per card (brief section 6: never "Log now | Start now
// | Plan" all at once) -- full-width within the card so it stays legible
// down to 375px without needing two side-by-side buttons (brief section 22).
// Same tight sizing as before (this sits in a narrow 3-up grid) -- V2.1
// section 21 only tokenizes the colors, doesn't touch layout/copy here.
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

// BOTH activities only (brief section 22): a small text link under the
// primary button, never a second equal-weight button.
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

