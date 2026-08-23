'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getPersonalizedTasks, UserChartContext, FULL_ACTIVITY_CATALOG, normalizeWindowType } from '../../../packages/recommendation/src/personalizedTasks';
import { getActionCards, getActivityDiscoveryCards, ActionCard } from '../../../packages/recommendation/src/actionCards';
import { getActivityDefinition, ImmediateAction } from '../../../packages/recommendation/src/activityDefinitions';
import type { DailyBriefing } from '../../../packages/recommendation/src/dailyAssistant';
import type { AuraUpdate } from '../lib/auraUpdates';
import type { AuraReminder } from '../lib/auraReminders';
import { formatReminderTiming } from '../lib/auraReminders';
import { triggerHaptic } from '../lib/haptics';
import { stripCountdownWrapper } from '../lib/formatTimeLeft';
import { trackEvent } from '../lib/trackEvent';
import * as theme from './theme';

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
   * for TimelineView -- reused here so Today's Flow can show caution/avoid
   * windows too. dailyBriefing.otherFavorableWindows deliberately excludes
   * Rahu Kalam/Yama, so it alone can't produce an "avoid" card. */
  dayWindows?: HomeDayWindow[];
  currentMinuteOfDay?: number;
  loggedActivitiesToday?: string[];
  dailyBriefing?: DailyBriefing | null;
  todayReflection?: {
    outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW';
    followedGuidance: boolean;
  } | null;
  upcomingPlans?: HomeUpcomingPlan[];
  userChart?: UserChartContext;
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

interface HomeUpcomingPlan {
  id: string;
  title: string;
  icon?: string | null;
  status: 'UPCOMING' | 'LOGGED' | 'CANCELLED';
  plannedStartAt: string;
  plannedEndAt: string;
  durationMinutes: number;
  windowType?: string | null;
  windowLabel?: string | null;
  matchLabel?: string | null;
  recommendation?: string | null;
}

interface AssistantSuggestion {
  title: string;
  description: string;
  icon: string;
  actionLabel: string;
  secondaryLabel: string;
  planId?: string;
}

const PROMPT_CHIPS = ['Workout', 'Deep work', 'Study', 'Date night'];

// "Best Time" is a claim of credibility: it should only appear once the engine
// has actually evaluated a window as genuinely strong (e.g. Abhijit, a real
// Muhurta peak). Neutral Flow is the *absence* of a special window, not a
// verdict that now is the best moment for anything — so it always gets its
// own honest "Flexible" framing here, regardless of its numeric score.
function getWindowTone(score: number, windowName: string) {
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

// dailyBriefing only gives formatted clock strings ("4:38 AM"), not raw minute
// values, so this recovers a sortable minute-of-day from them — needed to
// merge the peak window and the other favorable windows into one true
// chronological order (see flowItems below).
function parseClockToMinutes(clock: string): number {
  const match = clock.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return 0;
  let hours = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hours += 12;
  return hours * 60 + Number(match[2]);
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

function isCautionWindow(windowName: string) {
  const cleanWindow = windowName.toUpperCase();
  return cleanWindow.includes('RAHU') || cleanWindow.includes('YAMA');
}

function formatPlanClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function findActionablePlan(plans: HomeUpcomingPlan[]) {
  const now = Date.now();
  const horizonEnd = now + 90 * 60 * 1000;
  return plans
    .filter((plan) => plan.status === 'UPCOMING')
    .map((plan) => ({
      plan,
      startMs: new Date(plan.plannedStartAt).getTime(),
      endMs: new Date(plan.plannedEndAt).getTime(),
    }))
    .filter(({ startMs, endMs }) => Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= horizonEnd && endMs >= now - 15 * 60 * 1000)
    .sort((a, b) => a.startMs - b.startMs)[0]?.plan ?? null;
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
 */
export function selectGoodRightNowCards(
  activeWindowName: string,
  loggedActivitiesToday: string[],
  justLoggedTitles: Set<string> = new Set()
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
  const alternatives = getActivityDiscoveryCards(activeWindowName, 12).filter((card) => {
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
  currentMinuteOfDay,
  loggedActivitiesToday = [],
  dailyBriefing,
  todayReflection,
  upcomingPlans = [],
  userChart,
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
}: HomeDashboardProps) {
  const [selectedHabit, setSelectedHabit] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [activityNote, setActivityNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logError, setLogError] = useState('');
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

  const personalizedTasks = useMemo(
    () => getPersonalizedTasks(activeWindowName, userChart, loggedActivitiesToday),
    [activeWindowName, userChart, loggedActivitiesToday]
  );
  const primaryTask = personalizedTasks[0] ?? {
    id: 'steady-progress',
    title: bestForToday[0] ?? 'Steady Progress',
    description: themeText,
    icon: '✨',
  };
  const tone = getWindowTone(energyScore, activeWindowName);
  // The "Next Best Moment" card's OWN tone -- must not reuse `tone` above,
  // which describes the CURRENT window (e.g. a Rahu Kalam caution color
  // would otherwise bleed into a favorable upcoming Abhijit window's gauge).
  const nextTone = getWindowTone(nextShift.score, nextShift.windowName);
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

  const assistantSuggestion: AssistantSuggestion = useMemo(() => {
    const actionablePlan = findActionablePlan(upcomingPlans);
    if (actionablePlan) {
      const start = formatPlanClock(actionablePlan.plannedStartAt);
      const label = actionablePlan.windowLabel || formatWindowName(actionablePlan.windowType || activeWindowName);
      return {
        title: actionablePlan.title,
        description: `You planned this for ${start}. ${label} is the context Aura picked for it.`,
        icon: actionablePlan.icon || primaryTask.icon || '✨',
        actionLabel: 'Log now',
        secondaryLabel: 'Open Plan',
        planId: actionablePlan.id,
      };
    }

    if (isCautionWindow(activeWindowName)) {
      const lightTask = personalizedTasks.find((task) => task.significance === 'LOW') ?? personalizedTasks[0] ?? primaryTask;
      return {
        title: lightTask.title,
        description: `This is a caution window, so Aura is keeping the suggestion low-stakes. ${lightTask.description}`,
        icon: lightTask.icon || '✨',
        actionLabel: 'Do lightly',
        secondaryLabel: 'Find better time',
      };
    }

    // Situate the suggestion in the actual moment (how much usable time is
    // left before the next shift) rather than just restating a static
    // catalog description — a recommendation should sound like it looked at
    // the clock, not like a lookup table entry.
    const timeLeft = stripCountdownWrapper(remainingText);
    const situatedDescription = timeLeft
      ? `You have about ${timeLeft} before the next shift, making this a good time to ${primaryTask.title.toLowerCase()}.`
      : primaryTask.description;

    return {
      title: primaryTask.title,
      description: situatedDescription,
      icon: primaryTask.icon || '✨',
      actionLabel: 'Do it now',
      secondaryLabel: 'More options',
    };
  }, [activeWindowName, personalizedTasks, primaryTask, remainingText, upcomingPlans]);

  // Today's Flow should read Now -> Next -> Later, prioritizing what's still
  // ahead rather than history. Previously the peak window was always listed
  // first regardless of whether it had already passed (labeled "Peak" even
  // hours after it ended), and completed windows crowded out what's actually
  // coming up. dailyBriefing only exposes formatted clock strings, so the
  // peak window and otherFavorableWindows are merged into one real
  // chronological order via parseClockToMinutes before labeling.
  const flowItems = useMemo(() => {
    // Preferred path: the full-day window list (includes friction windows
    // like Rahu Kalam/Yama, unlike dailyBriefing.otherFavorableWindows which
    // excludes them) -- lets Today's Flow show a real "avoid" card.
    if (dayWindows && dayWindows.length > 0 && typeof currentMinuteOfDay === 'number') {
      const sorted = [...dayWindows].sort((a, b) => a.startMinute - b.startMinute);
      const currentIndex = sorted.findIndex((w) => w.startMinute <= currentMinuteOfDay && currentMinuteOfDay < w.endMinute);
      const current = currentIndex >= 0 ? sorted[currentIndex] : null;
      const upcoming = current ? sorted.slice(currentIndex + 1) : sorted.filter((w) => w.startMinute > currentMinuteOfDay);

      const items = [
        current
          ? { label: 'Now', name: formatWindowName(current.name), time: 'Current', accent: '#4ade80' }
          : { label: 'Now', name: currentWindowLabel, time: 'Current', accent: tone.color },
      ];

      upcoming.slice(0, 3).forEach((window, index) => {
        const isFirst = index === 0;
        const accent = isFirst ? '#38bdf8' : window.type === 'friction' ? '#fb6b6b' : '#facc15';
        items.push({ label: isFirst ? 'Next' : 'Later', name: formatWindowName(window.name), time: `${window.startTime} - ${window.endTime}`, accent });
      });

      if (items.length === 1) {
        items.push({ label: 'Next', name: nextShift.windowName, time: nextShift.startTime, accent: '#38bdf8' });
      }

      return items;
    }

    if (!dailyBriefing) {
      return [
        { label: 'Now', name: currentWindowLabel, time: 'Current', accent: tone.color },
        { label: 'Next', name: nextShift.windowName, time: nextShift.startTime, accent: '#38bdf8' },
      ];
    }

    const candidates = [
      {
        name: dailyBriefing.peakWindow.name,
        startTime: dailyBriefing.peakWindow.startTime,
        endTime: dailyBriefing.peakWindow.endTime,
        state: dailyBriefing.briefingState,
        sortMinute: parseClockToMinutes(dailyBriefing.peakWindow.startTime),
      },
      ...dailyBriefing.otherFavorableWindows.map((window) => ({
        name: window.name,
        startTime: window.startTime,
        endTime: window.endTime,
        state: window.state,
        sortMinute: parseClockToMinutes(window.startTime),
      })),
    ].sort((a, b) => a.sortMinute - b.sortMinute);

    const active = candidates.find((c) => c.state === 'ACTIVE');
    const upcoming = candidates.filter((c) => c.state === 'UPCOMING');

    const items = [
      active
        ? { label: 'Now', name: active.name, time: `${active.startTime} - ${active.endTime}`, accent: '#4ade80' }
        : { label: 'Now', name: currentWindowLabel, time: 'Current', accent: tone.color },
    ];

    upcoming.slice(0, 3).forEach((candidate, index) => {
      items.push({
        label: index === 0 ? 'Next' : 'Later',
        name: candidate.name,
        time: `${candidate.startTime} - ${candidate.endTime}`,
        accent: index === 0 ? '#38bdf8' : '#facc15',
      });
    });

    if (items.length === 1) {
      // Nothing favorable remains today — fall back to whatever's next overall.
      items.push({ label: 'Next', name: nextShift.windowName, time: nextShift.startTime, accent: '#38bdf8' });
    }

    return items;
  }, [currentWindowLabel, dailyBriefing, dayWindows, currentMinuteOfDay, nextShift.startTime, nextShift.windowName, tone.color]);

  // See selectGoodRightNowCards' own doc comment for the full reasoning --
  // justLoggedTitles exempts a card the user just logged from THIS Home
  // visit so it keeps showing its own confirmation instead of being
  // swapped away mid-flight.
  const [justLoggedTitles, setJustLoggedTitles] = useState<Set<string>>(() => new Set());
  const handleCardLogged = (title: string) => {
    setJustLoggedTitles((prev) => new Set(prev).add(title.trim().toLowerCase()));
  };

  const goodRightNow = useMemo(
    () => selectGoodRightNowCards(activeWindowName, loggedActivitiesToday, justLoggedTitles),
    [activeWindowName, loggedActivitiesToday, justLoggedTitles]
  );

  // Next Best Moment's end time -- nextShift itself only carries a start
  // time (scoreEngine.ts), so this cross-references the SAME real window in
  // dayWindows (matched by its already-identical formatted start clock) for
  // its endTime, rather than fabricating a duration.
  const nextMomentWindow = useMemo(
    () => dayWindows?.find((w) => w.startTime === nextShift.startTime) ?? null,
    [dayWindows, nextShift.startTime]
  );

  const handleConfirmLog = async () => {
    if (!selectedHabit) return;
    setIsSubmitting(true);
    setLogError('');
    try {
      if (selectedPlanId && onLogPlan) {
        await onLogPlan(selectedPlanId);
      } else if (onLogActivity) {
        const selectedTask = personalizedTasks.find((task) => task.title === selectedHabit);
        await onLogActivity(selectedHabit, activityNote, undefined, undefined, 30, 'AURA_DO_NOW', selectedTask?.significance);
      }
      triggerHaptic('success');
      setSelectedHabit(null);
      setSelectedPlanId(null);
      setActivityNote('');
    } catch (err) {
      console.error('Failed to log activity:', err);
      setLogError('Could not log this activity. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 17, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, lineHeight: 1.08, fontWeight: 900, color: '#f8fafc', margin: 0, letterSpacing: 0 }}>
            {greeting()}, {userName}! 👋
          </h1>
          <p style={{ fontSize: 15, color: '#aab7d2', margin: '7px 0 0' }}>{todayLabel()}</p>
        </div>
        <button type="button" onClick={onNotificationsClick} aria-label="Updates" style={topActionStyle}>
          {unreadUpdatesCount > 0 && (
            <span style={{ position: 'absolute', right: 3, top: 2, minWidth: 16, height: 16, borderRadius: 8, background: '#fb7185', color: '#020617', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
              {unreadUpdatesCount > 9 ? '9+' : unreadUpdatesCount}
            </span>
          )}
          <BellIcon />
        </button>
      </header>

      <section style={{ ...panelStyle, padding: 22, boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 0 0 1px ${tone.color}14, 0 22px 44px -28px ${tone.color}55` }}>
        <div style={{ display: 'grid', gridTemplateColumns: '128px minmax(0, 1fr)', gap: 20, alignItems: 'center' }}>
          <FlowRing score={energyScore} color={tone.color} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={sectionKickerStyle}>● Right Now</div>
              <span style={{ border: `1px solid ${tone.color}80`, color: tone.color, borderRadius: 999, padding: '7px 13px', fontSize: 13, fontWeight: 850, whiteSpace: 'nowrap' }}>
                {tone.pill}
              </span>
            </div>
            <h2 style={{ margin: '13px 0 0', fontSize: 25, color: '#f8fafc', lineHeight: 1.14 }}>{getHeroHeadline(activeWindowName)}</h2>
            <div style={{ marginTop: 8, color: '#dbe7f4', fontSize: 15, fontWeight: 800 }}>{currentWindowLabel} · {tone.pill}</div>
          </div>
        </div>
        <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 850, marginTop: 18, lineHeight: 1.35 }}>
          {currentTimeRange}
          <span style={{ color: tone.color, display: 'inline-block', marginLeft: 8 }}>{remainingText}</span>
        </div>
        <p style={{ margin: '11px 0 0', color: '#aab7d2', fontSize: 15, lineHeight: 1.42 }}>{tone.description}</p>

        <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid rgba(148, 163, 184, 0.14)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={sectionKickerStyle}>Good Right Now</div>
            {onNextShiftClick && (
              <button type="button" onClick={onNextShiftClick} style={linkButtonStyle}>See all activities →</button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 9, marginTop: 13 }}>
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
      </section>

      <section style={panelStyle}>
        <div style={inputShellStyle}>
          <span style={{ color: '#93c5fd', fontSize: 23 }}>✦</span>
          <button type="button" onClick={() => onPlanClick?.()} style={promptButtonStyle}>
            What are you thinking about?
          </button>
          <button type="button" onClick={() => onPlanClick?.()} style={voiceButtonStyle} aria-label="Find a time">
            →
          </button>
        </div>
        <div style={{ marginTop: 17, color: '#aab7d2', fontSize: 13 }}>Popular</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 12 }}>
          {PROMPT_CHIPS.map((chip) => (
            <button key={chip} type="button" onClick={() => onPlanClick?.(chip)} style={chipStyle}>
              {chip}
            </button>
          ))}
        </div>
      </section>

      {/* Aura Reminders V1 (brief section 21) -- priority ordering on Home:
       * (1) a critical/actionable coordination update (topMomentUpdate,
       * pre-existing), (2) Starting Soon, ahead of (3) the Aura Suggests /
       * Next Best Moment pair below. The hero panel above stays first --
       * it's the page's anchor ("Right Now"), not a competing
       * recommendation card, so moving it would break existing product
       * intent rather than preserve it. */}
      {topMomentUpdate && (
        <section>
          <SectionHeader label="Your Moments" />
          {(() => {
            const update = topMomentUpdate;
            const { day, time } = formatUpdateDateTime(update.eventStartAt);
            const isAccepted = update.type === 'MOMENT_ACCEPTED';
            return (
              <div style={{ ...panelStyle, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: isAccepted ? '#4ade80' : '#facc15' }}>
                  {isAccepted ? `❤️ ${update.recipientDisplayName ?? 'They'} is in` : `↻ ${update.recipientDisplayName ?? 'They'} want${update.recipientDisplayName ? 's' : ''} another time`}
                </div>
                <div style={{ marginTop: 8, fontSize: 14, fontWeight: 750, color: '#f8fafc' }}>{update.activityTitle}</div>
                <div style={{ marginTop: 3, fontSize: 12, color: '#aab7d2' }}>
                  {isAccepted ? `${day} · ${time}` : `Prefers: ${PREFERENCE_TEXT[update.preference ?? 'NO_PREFERENCE']}`}
                </div>
                <button
                  type="button"
                  onClick={() => (isAccepted ? onViewMomentUpdate?.(update.momentToken) : onFindAnotherTimeForMoment?.(update.momentToken))}
                  style={{ ...outlineButtonStyle, width: 'auto', marginTop: 10, padding: '8px 16px' }}
                >
                  {isAccepted ? 'View' : 'Find another time'}
                </button>
              </div>
            );
          })()}
        </section>
      )}

      {startingSoonReminder && (
        <section>
          <SectionHeader label="Starting Soon" />
          <StartingSoonCard reminder={startingSoonReminder} onOpen={onOpenReminder} />
        </section>
      )}

      <div style={pairGridStyle}>
        <section style={{ ...panelStyle, padding: 18 }}>
          <div style={sectionKickerStyle}>✨ Aura Suggests</div>
          <div style={{ display: 'grid', gridTemplateColumns: '74px minmax(0, 1fr)', alignItems: 'center', gap: 15, marginTop: 15 }}>
            <div style={suggestIconStyle}>{assistantSuggestion.icon}</div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, color: '#f8fafc', fontSize: 18, lineHeight: 1.2 }}>{assistantSuggestion.title}</h2>
              <p style={{ margin: '8px 0 0', color: '#aab7d2', lineHeight: 1.38, fontSize: 14 }}>{assistantSuggestion.description}</p>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
              <button
                type="button"
                onClick={() => {
                  setSelectedHabit(assistantSuggestion.title);
                  setSelectedPlanId(assistantSuggestion.planId ?? null);
                  setLogError('');
                }}
                style={primaryButtonStyle}
              >
                {assistantSuggestion.actionLabel}
              </button>
              <button type="button" onClick={() => onPlanClick?.(assistantSuggestion.title)} style={linkButtonStyle}>{assistantSuggestion.secondaryLabel} →</button>
            </div>
          </div>
        </section>

        <section style={{ ...panelStyle, padding: 18, display: 'grid', gridTemplateColumns: '1fr 74px', gap: 14, alignItems: 'center' }}>
          <div>
            <div style={{ ...sectionKickerStyle, color: '#facc15' }}>⭐ Next Best Moment</div>
            <h2 style={{ margin: '14px 0 0', color: '#f8fafc', fontSize: 22 }}>{nextShift.windowName}</h2>
            <div style={{ marginTop: 7, color: '#38bdf8', fontSize: 15, fontWeight: 850 }}>{formatNextMomentTiming(nextShift.startsIn)}</div>
            {nextMomentWindow && (
              <div style={{ marginTop: 3, color: '#94a3b8', fontSize: 13 }}>{nextMomentWindow.startTime} – {nextMomentWindow.endTime}</div>
            )}
            <p style={{ color: '#aab7d2', fontSize: 14, margin: '10px 0 0' }}>{nextShift.themeText}</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <ScoreGauge score={scoreLabel(nextShift.score)} color={nextTone.color} />
            <button type="button" onClick={() => onPlanClick?.()} style={outlineButtonStyle}>Plan this</button>
          </div>
        </section>
      </div>

      <section>
        <SectionHeader label="Today's Flow" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {flowItems.slice(0, 4).map((item, index) => (
            <div key={`${item.name}-${item.time}-${index}`} style={{ ...flowPillStyle, flex: 'unset', borderColor: `${item.accent}45`, borderLeft: `3px solid ${item.accent}` }}>
              <div style={{ color: item.accent, fontFamily: 'var(--as-font-mono)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{item.label}</div>
              <div style={{ color: '#f8fafc', marginTop: 9, fontSize: 13, fontWeight: 750 }}>{item.name}</div>
              <div style={{ color: '#aab7d2', marginTop: 7, fontSize: 12 }}>{item.time}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 12 }}>
          <button type="button" onClick={onNextShiftClick} style={{ ...viewDayButtonStyle, margin: 0 }}>View full day timeline →</button>
          {onPanchangClick && (
            <button type="button" onClick={onPanchangClick} style={{ ...viewDayButtonStyle, margin: 0, color: '#a78bfa' }}>Today&apos;s Panchang →</button>
          )}
        </div>
      </section>

      <div style={pairGridStyle}>
      {onSubmitReflection && (
        <section style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
            <div style={{ ...sectionKickerStyle, color: '#facc15' }}>Daily Check-in</div>
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
          <h2 style={{ margin: '13px 0 0', color: '#f8fafc', fontSize: 18 }}>How did today feel so far?</h2>
          {reflectionSaved && !isEditingReflection ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 }}>
              <div style={{ color: '#4ade80', fontSize: 13, lineHeight: 1.4 }}>
                Saved{selectedReflection ? `: ${formatReflectionLabel(selectedReflection)}` : ''}. Your insights get stronger with every check-in.
              </div>
              <button type="button" onClick={() => setIsEditingReflection(true)} style={changeReflectionButtonStyle}>
                Change
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 16 }}>
                <ReflectionButton label="Low" icon="☹" disabled={isSavingReflection} onClick={() => handleReflection('LOW')} />
                <ReflectionButton label="Balanced" icon="-" disabled={isSavingReflection} onClick={() => handleReflection('MODERATE')} />
                <ReflectionButton label="Strong" icon="☺" disabled={isSavingReflection} onClick={() => handleReflection('PEAK_FLOW')} />
              </div>
              {isSavingReflection && <div style={{ color: '#aab7d2', fontSize: 12, marginTop: 10 }}>Saving check-in...</div>}
              {reflectionError && <div style={{ color: '#fb6b6b', fontSize: 12, marginTop: 10 }}>{reflectionError}</div>}
            </>
          )}
        </section>
      )}

      <section style={{ ...panelStyle, padding: 15, display: 'grid', gridTemplateColumns: '30px 1fr', alignItems: 'start', gap: 11 }}>
        <div style={{ color: '#4ade80', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AuraInsightIcon />
        </div>
        <div>
          <div style={{ ...sectionKickerStyle, marginBottom: 6, fontSize: 11 }}>Aura Insight</div>
          <div style={{ color: '#dbe7f4', fontSize: 13.5, lineHeight: 1.4 }}>
            {bestForToday[0] ? `You tend to do well with ${bestForToday[0].toLowerCase()} during ${currentWindowLabel} windows.` : 'Your best patterns will appear as you log more moments.'}
          </div>
          {cautionItems[0] && <div style={{ color: '#94a3b8', fontSize: 11.5, marginTop: 5 }}>Avoid: {cautionItems[0]}</div>}
          <button type="button" onClick={onInsightsClick} style={{ ...linkButtonStyle, marginTop: 8, fontSize: 12 }}>View insights →</button>
        </div>
      </section>
      </div>

      {onPlanClick && (
        <section style={{ ...panelStyle, background: 'linear-gradient(135deg, rgba(88, 28, 135, 0.55), rgba(30, 41, 82, 0.7))', border: '1px solid rgba(167, 139, 250, 0.32)', padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 220px' }}>
            <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 850, lineHeight: 1.3 }}>Need the best time for something important?</div>
            <div style={{ color: '#c4b5fd', fontSize: 13, marginTop: 6, lineHeight: 1.4 }}>Ask Aura and I&apos;ll find the best window for you.</div>
          </div>
          <button type="button" onClick={() => onPlanClick()} style={askAuraCtaStyle}>Ask Aura →</button>
        </section>
      )}

      {selectedHabit && (
        <LogActivityModal
          title={selectedHabit}
          activeWindowName={activeWindowName}
          note={activityNote}
          isSubmitting={isSubmitting}
          error={logError}
          onNoteChange={setActivityNote}
          onCancel={() => {
            if (isSubmitting) return;
            setSelectedHabit(null);
            setSelectedPlanId(null);
            setLogError('');
          }}
          onConfirm={handleConfirmLog}
        />
      )}
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
    <div style={{ width: 58, height: 58, borderRadius: 58, border: `4px solid ${color}`, borderLeftColor: 'rgba(148, 163, 184, 0.28)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'rgba(15, 23, 42, 0.75)' }}>
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

function SectionHeader({ label }: { label: string }) {
  return (
    <h2 style={{ margin: '0 0 12px', color: '#aab7d2', fontFamily: 'var(--as-font-mono)', fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {label}
    </h2>
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
    <div style={{ ...panelStyle, padding: 16, borderColor: 'rgba(250, 204, 21, 0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }} aria-hidden="true">{reminder.activityIcon || '✨'}</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#f8fafc' }}>{reminder.activityTitle}</div>
      </div>
      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 850, color: '#facc15' }}>{formatReminderTiming(reminder.minutesUntilStart)}</div>
      <div style={{ marginTop: 3, fontSize: 12, color: '#aab7d2' }}>{timeRange}</div>
      {participantLine && <div style={{ marginTop: 3, fontSize: 12, color: '#aab7d2' }}>{participantLine}</div>}
      <button
        type="button"
        onClick={() => onOpen?.(reminder)}
        style={{ ...outlineButtonStyle, width: 'auto', marginTop: 10, padding: '8px 16px', borderColor: 'rgba(250, 204, 21, 0.42)', color: '#facc15' }}
      >
        {actionLabel}
      </button>
    </div>
  );
}

// Good Right Now Actions V1 -- a deliberately small, fixed duration for
// LOG_NOW activities (hydration, tea/coffee, a quick check-in): the
// existing HabitLog model has no "durationless" concept, so this is the
// smallest honest placeholder, distinct from the 30-minute default meant
// for genuinely timed activities.
const LOG_NOW_DURATION_MINUTES = 5;

/**
 * Good Right Now Actions V1 -- replaces the previous "every card routes to
 * Plan" behavior with canonical per-activity action semantics (brief
 * section 5/6). `card.activityId`, when present, resolves to a real
 * ActivityDefinition via getActivityDefinition() -- never a title regex --
 * whose `experience.immediateAction` decides LOG_NOW / START_NOW / PLAN /
 * BOTH. The two cards with no catalog counterpart (a generic "meal") carry
 * their own explicit `card.immediateAction` fallback instead (see
 * actionCards.ts).
 *
 * LOG_NOW and START_NOW both reuse the EXACT SAME onLogActivity pipeline
 * Timeline already logs through (brief section 7: "reuse existing activity
 * logging pipeline... do not create another logging implementation") --
 * this component only decides which duration/copy to use, never how a log
 * is persisted. There is no real running-session/timer model anywhere in
 * this app (audited: HabitLog stores a single fixed durationMinutes, no
 * start/stop pair) -- see the completion report for why START_NOW
 * therefore logs immediately using the activity's own default/suggested
 * duration rather than opening a timer (brief section 9/10's documented V1
 * fallback), and for the extension point a future real timer would hook
 * into.
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

  const definition = card.activityId ? getActivityDefinition(card.activityId) : undefined;
  const action: ImmediateAction = definition?.experience.immediateAction ?? card.immediateAction ?? 'LOG_NOW';
  // The real catalog title (e.g. "Deep Work"), not this card's own
  // window-flavor copy (e.g. "Regular work block") -- passing the window
  // copy into Plan's existing free-text prefill would silently fail to
  // match any catalog alias and fall through to the fallback classifier.
  const catalogTitle = card.activityId ? FULL_ACTIVITY_CATALOG.find((activity) => activity.id === card.activityId)?.title : undefined;
  const planTitle = catalogTitle ?? card.title;

  const handleImmediateAction = async (type: 'LOG_NOW' | 'START_NOW') => {
    if (status === 'loading' || !onLogActivity) return;
    setStatus('loading');
    // Mark this title exempt from the "already logged today" swap BEFORE
    // calling onLogActivity, not after -- handleLogActivity (page.tsx)
    // updates loggedActivitiesToday synchronously (before its own network
    // call even resolves), so calling onLogged() only after await would
    // lose the race: the parent could already have swapped this card out
    // (and unmounted this component) before it ever reached setStatus('logged').
    onLogged?.(planTitle);
    try {
      const durationMinutes = type === 'START_NOW'
        ? definition?.experience.defaultDurationMinutes ?? definition?.experience.suggestedDurations?.[0] ?? 30
        : LOG_NOW_DURATION_MINUTES;
      // overrideWindowType reuses the CURRENT structured window (brief
      // section 13) already known here as a prop, never re-inferred from a
      // display string -- Insights/window distribution then sees this log
      // exactly like a Timeline-created one (brief section 14).
      await onLogActivity(planTitle, undefined, undefined, activeWindowName, durationMinutes, 'AURA_DO_NOW', definition?.muhurta.significance);
      setStatus('logged');
      setLoggedAtLabel(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
      triggerHaptic('success');
      trackEvent('ACTIVITY_LOGGED_NOW', {
        metadata: {
          ...(card.activityId ? { activityId: card.activityId } : {}),
          source: 'HOME',
          windowType: normalizeWindowType(activeWindowName),
          actionType: type,
        },
      });
    } catch {
      // handleLogActivity (page.tsx) is itself optimistic/offline-resilient
      // and rarely rejects -- this mainly guards the case onLogActivity is
      // missing entirely. See the completion report for why a genuine
      // server failure has no reliable signal to surface here today.
      setStatus('error');
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
      <span style={{ marginTop: 4, color: '#94a3b8', fontSize: 10.5, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{card.description}</span>
      <div style={{ marginTop: 'auto', paddingTop: 8, width: '100%' }}>
        {action === 'PLAN' ? (
          <button type="button" onClick={() => onPlanClick?.(planTitle)} style={goodRightNowActionButtonStyle} aria-label={`Plan ${planTitle}`}>
            Plan
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => handleImmediateAction(action === 'BOTH' ? 'START_NOW' : action)}
              disabled={status === 'loading'}
              style={{ ...goodRightNowActionButtonStyle, opacity: status === 'loading' ? 0.6 : 1, cursor: status === 'loading' ? 'default' : 'pointer' }}
              aria-label={`${action === 'LOG_NOW' ? 'Log' : 'Start'} ${planTitle} now`}
            >
              {status === 'loading' ? 'Logging…' : action === 'LOG_NOW' ? 'Log now' : 'Start now'}
            </button>
            {action === 'BOTH' && (
              <button type="button" onClick={() => onPlanClick?.(planTitle)} style={goodRightNowSecondaryLinkStyle} aria-label={`Plan ${planTitle} for later`}>
                Plan for later →
              </button>
            )}
          </>
        )}
        {status === 'error' && <div style={{ color: '#fb7185', fontSize: 10, marginTop: 5 }}>Couldn&apos;t log. Try again.</div>}
      </div>
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

function LogActivityModal({
  title,
  activeWindowName,
  note,
  isSubmitting,
  error,
  onNoteChange,
  onCancel,
  onConfirm,
}: {
  title: string;
  activeWindowName: string;
  note: string;
  isSubmitting: boolean;
  error: string;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => noteRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onCancel();
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, onCancel]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.82)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 20 }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="home-log-title" aria-describedby="home-log-window" style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 18, padding: 20, width: '100%', maxWidth: 360, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)', color: '#f8fafc' }}>
        <h3 id="home-log-title" style={{ margin: 0, fontSize: 17 }}>Log {title}?</h3>
        <p id="home-log-window" style={{ fontSize: 12, color: '#94a3b8', marginTop: 5 }}>Tagging this under {formatWindowName(activeWindowName)}.</p>
        <textarea ref={noteRef} placeholder="Optional notes or reflection..." value={note} onChange={(event) => onNoteChange(event.target.value)} style={{ width: '100%', height: 72, marginTop: 12, borderRadius: 10, background: '#020617', border: '1px solid #334155', color: '#f8fafc', padding: 10, fontSize: 12, resize: 'none', boxSizing: 'border-box', outline: 'none' }} />
        {error && <div style={{ color: '#fb7185', fontSize: 12, lineHeight: 1.35, marginTop: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" onClick={onCancel} disabled={isSubmitting} style={{ flex: 1, padding: '10px 0', borderRadius: 10, background: 'transparent', border: '1px solid #334155', color: '#94a3b8', fontSize: 13, cursor: isSubmitting ? 'default' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={isSubmitting} style={{ flex: 1, padding: '10px 0', borderRadius: 10, background: '#4ade80', border: 'none', color: '#020617', fontWeight: 800, fontSize: 13, cursor: isSubmitting ? 'default' : 'pointer', opacity: isSubmitting ? 0.7 : 1 }}>{isSubmitting ? 'Saving...' : 'Confirm Log'}</button>
        </div>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = theme.panelStyle;

const sectionKickerStyle: React.CSSProperties = {
  color: '#4ade80',
  fontSize: 12,
  fontFamily: 'var(--as-font-mono)',
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const topActionStyle: React.CSSProperties = {
  position: 'relative',
  width: 44,
  height: 44,
  border: '1px solid rgba(96, 165, 250, 0.23)',
  borderRadius: 14,
  background: 'rgba(15, 23, 42, 0.75)',
  color: '#f8fafc',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const inputShellStyle: React.CSSProperties = {
  minHeight: 64,
  border: '1px solid #2f95ff',
  borderRadius: 14,
  background: 'rgba(2, 6, 23, 0.52)',
  boxShadow: '0 0 0 1px rgba(47, 149, 255, 0.14), 0 14px 28px -20px rgba(47, 149, 255, 0.55)',
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

const chipStyle: React.CSSProperties = {
  flex: '0 0 auto',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(2, 6, 23, 0.35)',
  color: '#cbd5e1',
  borderRadius: 999,
  padding: '8px 14px',
  fontSize: 13,
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

const primaryButtonStyle: React.CSSProperties = {
  minWidth: 116,
  minHeight: 45,
  border: 'none',
  borderRadius: 10,
  background: '#4ade80',
  color: '#020617',
  fontSize: 15,
  fontWeight: 950,
  cursor: 'pointer',
};

const linkButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#4ade80',
  fontSize: 13,
  fontWeight: 850,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const changeReflectionButtonStyle: React.CSSProperties = {
  minHeight: 32,
  borderRadius: 9,
  border: '1px solid rgba(74, 222, 128, 0.32)',
  background: 'rgba(74, 222, 128, 0.1)',
  color: '#4ade80',
  fontSize: 12,
  fontWeight: 850,
  padding: '0 12px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
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

const outlineButtonStyle: React.CSSProperties = {
  minWidth: 86,
  minHeight: 38,
  borderRadius: 10,
  border: '1px solid rgba(56, 189, 248, 0.42)',
  background: 'rgba(2, 6, 23, 0.22)',
  color: '#7dd3fc',
  fontSize: 13,
  fontWeight: 850,
  cursor: 'pointer',
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
  minHeight: 132,
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: 12,
  background: 'rgba(2, 6, 23, 0.4)',
  padding: '11px 10px',
};

// One primary action per card (brief section 6: never "Log now | Start now
// | Plan" all at once) -- full-width within the card so it stays legible
// down to 375px without needing two side-by-side buttons (brief section 22).
const goodRightNowActionButtonStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 30,
  border: '1px solid rgba(74, 222, 128, 0.35)',
  borderRadius: 8,
  background: 'rgba(74, 222, 128, 0.12)',
  color: '#4ade80',
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
  color: '#94a3b8',
  fontSize: 10,
  fontWeight: 750,
  cursor: 'pointer',
  padding: 0,
};

const askAuraCtaStyle: React.CSSProperties = {
  minHeight: 46,
  padding: '0 20px',
  border: 'none',
  borderRadius: 12,
  background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
  color: '#f8fafc',
  fontSize: 14,
  fontWeight: 850,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const flowPillStyle: React.CSSProperties = {
  flex: '0 0 138px',
  minHeight: 82,
  borderRadius: 13,
  background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(13, 28, 62, 0.82))',
  border: '1px solid rgba(96, 165, 250, 0.16)',
  padding: 12,
};

const viewDayButtonStyle: React.CSSProperties = {
  display: 'block',
  margin: '12px auto 0',
  border: 'none',
  background: 'transparent',
  color: '#38bdf8',
  fontSize: 16,
  fontWeight: 850,
  cursor: 'pointer',
};
