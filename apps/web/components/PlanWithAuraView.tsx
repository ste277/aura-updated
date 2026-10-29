'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanningHorizon, TimePreference } from '../../../packages/recommendation/src/dailyAssistant';
import { buildGoogleCalendarUrl } from '../../../packages/recommendation/src/dailyAssistant';
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../../../packages/recommendation/src/activityDefinitions';
import type { EverydaySharedCandidate } from '../../../packages/recommendation/src/everydayTimingFit';
import { RELATIONSHIP_ICON, SavedPersonRow } from './PeopleView';
import { SharedMomentsView } from './SharedMomentsView';
import * as theme from './theme';
import { colors, spacing, typography } from './theme';
import { PageHeader, SegmentedControl, SecondaryButton, EmptyState, TextButton } from './ui';
import type { TimingCandidate, TimingCandidateLabel, TimingSearchDateRange, TimingSearchMode, TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import type { TimingSearchResponseWithDailyRhythm } from '../lib/timingSearchDailyRhythm';
import type { MuhurtaReason } from '../../../packages/muhurta/src/activityOntology';
import { formatMuhurtaReason } from '../../../packages/muhurta/src/muhurtaReasonFormat';
import { localDateTimeToUTC, getDatePartsInTimezone, getMinuteOfDayInTimezone } from '../lib/timezone';
import { triggerHaptic } from '../lib/haptics';
import { trackEvent } from '../lib/trackEvent';
import { isKnownSchedulingEligibilityCode, presentSchedulingEligibilityError, type SchedulingEligibilityPresentation } from '../lib/schedulingEligibilityPresentation';
// Event Location Plan Persistence V1 closeout: pure plan display/formatting
// logic moved to a plain .ts module so it can be unit-tested under this
// repo's normal (non-JSX) test runner -- see planFormatting.ts's own doc
// comment. Re-exported below (RESULT_LABEL_TEXT, findCandidateKey,
// planPayloadFromCandidate, PlanEventLocation) for the handful of other
// files that already import them `from './PlanWithAuraView'`, so none of
// those call sites need to change.
import type {
  PlanEventLocation,
  UpcomingPlan,
  PlanApiRow,
  PlanIcon,
  SaveUpcomingPlanOptions,
} from '../lib/planFormatting';
import {
  RESULT_LABEL_TEXT,
  durationLabel,
  minutesFromDuration,
  windowTypeFromLabel,
  mapPlanRow,
  isUpcomingOrCurrentPlan,
  isMissedPlan,
  isCompletedPlan,
  findCandidateKey,
  planPayloadFromCandidate,
  getTodayForTimezone,
  addDays,
  formatShortDate,
} from '../lib/planFormatting';
// HPG4-2 CI/functional hardening -- reuses Home's own generic, timeline-
// agnostic succeeded/failed tally helper (pure string-outcome counting only;
// Plan's own eligibility derivation and its own fetch/skip transport stay
// fully independent of Home's, unchanged from the original HPG4-2 PR).
import { summarizeSkipAllOutcome, collectSkipAllOutcomes } from '../lib/homeMissedRecovery';

export type { PlanEventLocation };
export { RESULT_LABEL_TEXT, findCandidateKey, planPayloadFromCandidate };

interface TaskSuggestion {
  title: string;
  icon: string;
  keywords: string[];
  accent: string;
  defaultDurationMinutes?: number;
}

interface PlanWithAuraViewProps {
  /** Client-facing subset of TimingSearchRequest -- `context` (location/timezone/
   * personal Muhurta context) is resolved server-side from the session user,
   * exactly like the legacy slot-task route did, so it's never built or sent
   * from here. */
  onTimingSearch: (request: {
    mode: TimingSearchMode;
    activityId?: string;
    taskTitle?: string;
    durationMinutes: number;
    dateRange?: TimingSearchDateRange;
    horizon?: PlanningHorizon;
    customStartDate?: string;
    customEndDate?: string;
    timePreference?: TimingTimePreference;
    limit?: number;
    candidateStart?: string;
    checkNearbyWindowMinutes?: number;
    candidateStarts?: string[];
  }) => Promise<TimingSearchResponseWithDailyRhythm>;
  onViewDay?: () => void;
  onPlanLogged?: () => void;
  timezone?: string;
  initialActivity?: string | null;
  initialActivityKey?: number;
  /** HPG1 -- a stable, already-resolved catalog activity id to prefer over
   * re-deriving identity from `initialActivity`'s title text. Only ever
   * set by a caller that genuinely already has one (e.g. a Good Right Now
   * card's own `ActionCard.activityId`, or Ask Aura's own resolved
   * `action.activityId`) -- never backfilled by matching titles. Validated
   * against FULL_ACTIVITY_CATALOG on arrival (see the prefill effect
   * below); a missing, stale, malformed, or otherwise unrecognized id is
   * silently ignored and this falls back to the exact title-only behavior
   * that existed before this field was added. */
  initialActivityId?: string | null;
  /** Daily Reflection & Tomorrow Preview V1 (brief section 5) -- the
   * "Plan tomorrow" handoff from a Tomorrow Preview suggestion preselects
   * both the activity AND this horizon, so the search itself still runs
   * through the normal FIND flow below rather than creating a Plan
   * directly. Only meaningful together with initialActivity/
   * initialActivityKey (same effect, same key). */
  initialHorizon?: PlanningHorizon;
  /** Product Structure V2 (brief section 10/22) -- "Add someone" from the
   * Who's-this-with picker navigates to the existing People screen; Plan
   * itself never builds a second Add Person UI. */
  onOpenPeople?: () => void;
  /** Product Structure V2 (brief section 19) -- jump straight to the
   * bottom-of-Plan "Your Moments" section. */
  focusMomentsKey?: number;
  /** Forwarded to the embedded SharedMomentsView's own onSeen (brief
   * section 6 of Aura Updates V1) -- keeps the bell's unread badge accurate
   * even when a moment is viewed from Plan's "Your Moments", not just You. */
  onMomentSeen?: () => void;
  /** Forwarded to the embedded SharedMomentsView -- jumps straight into one
   * moment's alternatives when arriving via a "Find another time" deep
   * link (Home's card, or the old Shared Moments entry under You). */
  focusMomentToken?: string;
  /** Insights V1 PR7 (finding F-4) -- an Insights suggestion's "Review
   * plans"/"Open Plan" CTA jump, mirroring focusMomentsKey's own
   * established pattern: an incrementing counter so the destination
   * effect re-fires even when the SAME plan/filter is requested twice in
   * a row. Only meaningful together with focusPlanId/focusPlansFilter. */
  focusPlansKey?: number;
  /** A specific, real PlannedActivity id to expand (e.g. a Move chain's
   * live terminal, or the one unconfirmed plan when there is exactly
   * one). If the id no longer matches any loaded plan (deleted, or
   * resolved and moved to a different list between the suggestion being
   * shown and clicked), nothing matches and nothing expands -- the user
   * still safely lands on "My Plans" with its real current contents,
   * never a crash or a fabricated row. */
  focusPlanId?: string | null;
  /** Pre-filters the "Upcoming Plans" list to this criterion when more
   * than one plan is the suggestion's subject (so no single `focusPlanId`
   * exists) -- currently only 'AWAITING_CONFIRMATION' is defined. */
  focusPlansFilter?: 'AWAITING_CONFIRMATION' | null;
}

// Product Structure V2 (brief section 8): "Suggested" leads with everyday
// TOGETHER activities (❤️ Date Night, 🍽 Dinner, ☕ Coffee, 🎬 Movie) --
// filteredTasks shows only the first 4 when the search box is empty, so
// ordering here is what actually decides the default suggestion set.
// Titles are exact FULL_ACTIVITY_CATALOG matches so resolveActivitySelection
// sends a real activityId, not a free-text fallback.
const TASKS: TaskSuggestion[] = [
  { title: 'Date Night', icon: '❤️', keywords: ['date', 'romantic', 'relationship', 'partner'], accent: '#ff5f95' },
  { title: 'Dinner Date', icon: '🍽️', keywords: ['dinner', 'romantic dinner'], accent: '#ff5f95' },
  { title: 'Coffee / Tea', icon: '☕', keywords: ['coffee', 'tea'], accent: '#fb923c' },
  { title: 'Movie Night', icon: '🎬', keywords: ['movie', 'film'], accent: '#a78bfa' },
  { title: 'Workout', icon: '🏋️', keywords: ['workout', 'exercise', 'gym', 'training', 'fitness'], accent: '#ff5f95' },
  { title: 'Deep work', icon: '🧠', keywords: ['deep work', 'focus', 'coding', 'research', 'writing'], accent: '#38bdf8' },
  { title: 'Study', icon: '📖', keywords: ['study', 'learn', 'course', 'exam', 'reading'], accent: '#4ade80' },
  { title: 'Journey', icon: '🚗', keywords: ['journey', 'travel', 'trip', 'flight', 'train'], accent: '#facc15' },
  { title: 'Party', icon: '🎉', keywords: ['party', 'social', 'celebration', 'night out'], accent: '#a78bfa' },
  { title: 'Meditation', icon: '🧘', keywords: ['meditation', 'mindful', 'breath', 'prayer'], accent: '#4ade80' },
];

function accentForActivity(category: string, title: string): string {
  const lower = title.toLowerCase();
  if (/date|relationship|romantic|workout|exercise|gym/.test(lower)) return '#ff5f95';
  if (/study|learn|meditat|breath|spiritual/.test(lower)) return '#4ade80';
  if (/journey|travel|trip|financial|decision|new beginning|launch/.test(lower)) return '#facc15';
  if (category === 'SOCIAL') return '#a78bfa';
  if (category === 'REST' || category === 'MICRO_BREAK') return '#7dd3fc';
  return '#38bdf8';
}

const ALL_TASKS: TaskSuggestion[] = [
  ...TASKS,
  ...FULL_ACTIVITY_CATALOG.map((activity) => ({
    title: activity.title,
    icon: activity.icon,
    keywords: activity.aliases,
    accent: accentForActivity(activity.category, activity.title),
    defaultDurationMinutes: activity.defaultDurationMinutes,
  })),
].filter((task, index, list) => list.findIndex((item) => item.title.toLowerCase() === task.title.toLowerCase()) === index);

const HORIZONS: Array<{ value: PlanningHorizon; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'TOMORROW', label: 'Tomorrow' },
  { value: 'WEEKEND', label: 'This weekend' },
  { value: 'SEVEN_DAYS', label: 'Next 7 days' },
  { value: 'CUSTOM', label: 'Pick dates' },
];

export const DURATIONS = [
  { value: 15, label: '15 min', helper: 'Quick reset' },
  { value: 30, label: '30 min', helper: 'Short block' },
  { value: 60, label: '60 min', helper: 'You can adjust later' },
  { value: 90, label: '90 min', helper: 'Deep session' },
  { value: 120, label: '2h', helper: 'Long block' },
];

// DR4-F2C -- a rescheduled plan's own durationMinutes (always what Move
// actually persists, never whatever this selector shows) is frequently NOT
// one of the 5 presets above (e.g. 45, 75 minutes). A native <select>
// whose value matches none of its <option>s falls back to displaying its
// FIRST option -- so the locked selector was silently showing "15 min" for
// a 45-minute plan, even though the correct value was already selected
// internally and Move was already persisting it correctly. This appends a
// single non-duplicate, non-rounded option representing the actual
// duration only when it isn't already one of the presets -- DURATIONS
// itself, and every other caller of it, is untouched.
export function durationSelectOptions(minutes: number): Array<{ value: number; label: string }> {
  return DURATIONS.some((option) => option.value === minutes) ? DURATIONS : [...DURATIONS, { value: minutes, label: durationLabel(minutes) }];
}

const TIME_PREFERENCES: Array<{ value: TimePreference; label: string; icon: string; accent: string }> = [
  { value: 'ANYTIME', label: 'Anytime', icon: '∞', accent: '#a855f7' },
  { value: 'MORNING', label: 'Morning', icon: '☀️', accent: '#facc15' },
  { value: 'AFTERNOON', label: 'Afternoon', icon: '☀', accent: '#fb923c' },
  { value: 'EVENING', label: 'Evening', icon: '🌅', accent: '#ff5f95' },
  // Existing product semantics: Night runs 21:00-05:00 (wraps past midnight),
  // not 21:00-24:00 -- deliberately not stating an exact range here so the
  // wording can't imply the shorter window (see timingSearch.ts's
  // mapTimingTimePreference doc comment for where this is preserved).
  { value: 'NIGHT', label: 'Night', icon: '🌙', accent: '#38bdf8' },
];

/** Timing Search's mode-switcher tabs (section 3 of the brief) -- human labels only. */
const PLAN_MODES: Array<{ value: TimingSearchMode; label: string; helper: string }> = [
  { value: 'FIND', label: 'Find a Time', helper: 'When should I do this?' },
  { value: 'CHECK', label: 'Check a Time', helper: 'Is this specific time good?' },
  { value: 'COMPARE', label: 'Compare', helper: 'Which option is better?' },
];

// DR4-F2B -- while rescheduling, the mode switcher offers exactly these two
// reschedule-framed choices instead of the normal three: FIND and CHECK are
// both reschedule-aware (prefilled, duration-locked, Move-backed); COMPARE
// stays out of scope for this ticket (AURA_DR4_F2_TIMING_CHOICE_UX_AUDIT.md
// section 9 / the DR4-F2B brief section 3) and is simply never offered as
// an option here, rather than left reachable-but-stale as it briefly was
// before DR4-F2A's own fix. Same underlying TimingSearchMode values as
// PLAN_MODES -- only the presented label set (and the exclusion of
// COMPARE) differs.
export const RESCHEDULE_MODES: Array<{ value: 'FIND' | 'CHECK'; label: string; helper: string }> = [
  { value: 'FIND', label: 'Find a Better Time', helper: 'Choose from Aura’s recommended timings.' },
  { value: 'CHECK', label: 'Choose My Own Time', helper: 'Pick your own date and time and see Aura’s assessment.' },
];

/** TimingCandidateLabel -> friendly copy (section 11). Do not invent a second
 * fit classification -- this is purely a display mapping of the engine's own
 * label values. */
const RESULT_LABEL_COLOR: Record<TimingCandidateLabel, string> = {
  EXCELLENT: '#4ade80',
  VERY_GOOD: '#4ade80',
  GOOD: '#38bdf8',
  USABLE: '#facc15',
  CAUTION: '#fb7185',
};

const REASON_FACTOR_LABEL: Record<MuhurtaReason['factor'], string> = {
  NAKSHATRA: 'Nakshatra',
  TITHI: 'Tithi',
  YOGA: 'Yoga',
  KARANA: 'Karana',
  SOLAR_WINDOW: 'Solar window',
  PERSONAL: 'Personal Tara',
  ACTIVITY: 'Activity rule',
};

export function toTimingPreference(preference: TimePreference): TimingTimePreference {
  // WORK_HOURS is part of the legacy TimePreference union but was never
  // offered by this component's own TIME_PREFERENCES picker (unreachable via
  // the UI) -- mapped to ANY defensively rather than narrowing the shared type.
  if (preference === 'MORNING' || preference === 'AFTERNOON' || preference === 'EVENING' || preference === 'NIGHT') return preference;
  return 'ANY';
}

/** Section 8: known activity selection must send activityId, not a title
 * string converted back to free text. A title that exactly matches a
 * catalog entry (whether picked from a chip or typed verbatim) is treated
 * as that known activity; anything else falls through to taskTitle, which
 * the API resolves via the same classifyTask() fallback as ever. */
export function resolveActivitySelection(rawTitle: string): { activityId?: string; taskTitle?: string } {
  const trimmed = rawTitle.trim();
  const known = FULL_ACTIVITY_CATALOG.find((activity) => activity.title.toLowerCase() === trimmed.toLowerCase());
  return known ? { activityId: known.id } : { taskTitle: trimmed };
}

/**
 * HPG1 -- resolves the Home -> Plan handoff's own `initialActivity` /
 * `initialActivityId` pair into what the prefill effect should apply.
 *
 * `activityId` is trusted directly (an exact `.id` lookup against
 * FULL_ACTIVITY_CATALOG, the same static, non-user-scoped catalog
 * `resolveActivitySelection` itself reads) -- it is NEVER derived by
 * matching `rawTitle`'s text, so two catalog entries that happen to share
 * a title can never cross-resolve as long as the caller passed the
 * correct id. A missing, empty, malformed, stale, or otherwise
 * unrecognized id (anything `FULL_ACTIVITY_CATALOG.find` doesn't match)
 * is silently ignored -- this falls through to the exact title-only
 * resolution that already existed before `activityId` was introduced,
 * never a thrown error or a blocked handoff.
 *
 * When the id resolves, the returned `taskTitle` is the catalog entry's
 * OWN title (not whatever string the caller happened to send) so every
 * later resolveActivitySelection(taskTitle) call keeps agreeing with it.
 */
export function resolvePrefillActivity(rawTitle: string, activityId?: string | null): { taskTitle: string; isCustomTask: boolean; activityId?: string } {
  const trimmedTitle = rawTitle.trim();
  const matched = activityId ? FULL_ACTIVITY_CATALOG.find((activity) => activity.id === activityId) : undefined;
  const taskTitle = matched?.title ?? trimmedTitle;
  const isCustomTask = matched === undefined && !TASKS.some((task) => task.title.toLowerCase() === taskTitle.toLowerCase());
  return { taskTitle, isCustomTask, activityId: matched?.id };
}

type SpeechRecognitionConstructor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

// DR4-E2 -- SKIPPING added for the Missed Activities card's Skip action
// (reuses the existing skipPlannedActivity workflow, same busy-state
// convention as LOGGING/CANCELLING -- no new mutation, no new status).
type PlanActionState = 'LOGGING' | 'CANCELLING' | 'SKIPPING';

function recommendedPreference(taskTitle: string): TimePreference {
  const title = taskTitle.toLowerCase();
  if (/(date|party|social|romantic|meal|dinner)/.test(title)) return 'EVENING';
  if (/(sleep|wind down|night)/.test(title)) return 'NIGHT';
  if (/(workout|exercise|journey|travel|deep work|study|learn|meditat|meeting)/.test(title)) return 'MORNING';
  return 'ANYTIME';
}

function getHorizonHelper(horizon: PlanningHorizon, timezone?: string): string {
  const today = getTodayForTimezone(timezone);
  if (horizon === 'TODAY') return 'Best moments today';
  if (horizon === 'TOMORROW') return `Tomorrow, ${formatShortDate(addDays(today, 1))}`;
  if (horizon === 'WEEKEND') {
    const day = today.getDay();
    const saturdayOffset = (6 - day + 7) % 7 || 7;
    const sundayOffset = saturdayOffset + 1;
    return `${formatShortDate(addDays(today, saturdayOffset))} to ${formatShortDate(addDays(today, sundayOffset))}`;
  }
  if (horizon === 'SEVEN_DAYS') return `Today to ${formatShortDate(addDays(today, 6))}`;
  return 'Choose a date range';
}

/**
 * Saves a TimingCandidate-shaped result straight to POST /api/plans, using
 * planPayloadFromCandidate() (planFormatting.ts) for the exact same field
 * mapping PlanWithAuraView's own handleSavePlan() uses -- for callers
 * (Muhurtham Finder's "Use this time ->") that need the same save pipeline
 * but aren't PlanWithAuraView itself, so don't have its local savedPlans
 * list state to update. Intentionally does none of that list bookkeeping;
 * callers that want the saved plan reflected immediately in their own UI
 * should refetch (e.g. via the onPlanLogged callback already threaded
 * through page.tsx). See SaveUpcomingPlanOptions (planFormatting.ts) for
 * what each option does.
 */

export async function saveUpcomingPlanFromCandidate(candidate: TimingCandidate, durationMinutes: number, options: SaveUpcomingPlanOptions = {}): Promise<UpcomingPlan> {
  const { sharedWithName, guestConversionToken, clientRequestId, eventLocation, activityId } = options;
  const plan = planPayloadFromCandidate(candidate, durationMinutes, sharedWithName, eventLocation);
  const res = await fetch('/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: plan.title,
      activityType: plan.title,
      icon: plan.icon,
      plannedStartAt: plan.plannedStartAt,
      plannedEndAt: plan.plannedEndAt,
      durationMinutes: minutesFromDuration(plan.duration),
      windowType: windowTypeFromLabel(plan.window),
      windowLabel: plan.window,
      matchLabel: plan.match,
      score: plan.score,
      recommendation: plan.details,
      calendarUrl: plan.googleCalendarUrl,
      // Planned Activity Canonical Identity Propagation V1 -- the caller's
      // own already-known canonical id (or null when none is known). No
      // resolution happens here; the server (POST /api/plans) validates.
      activityId: activityId ?? null,
      ...(guestConversionToken ? { guestConversionToken } : {}),
      ...(clientRequestId ? { clientRequestId } : {}),
      ...(eventLocation ? { eventLocation } : {}),
    }),
  });
  if (!res.ok) throw new Error('Unable to save plan.');
  return mapPlanRow(await res.json());
}

/** HPG3-A3b -- carries an optional, untrusted-until-validated `code` string
 * alongside a human-readable message, so a catch block can distinguish "a
 * known scheduling-eligibility code" from "an ordinary save/move failure"
 * without re-reading the response body it was built from. Never thrown
 * for anything this file hasn't itself read off a real response. */
class PlanActionError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'PlanActionError';
  }
}

export function PlanWithAuraView({ onTimingSearch, onViewDay, onPlanLogged, timezone, initialActivity, initialActivityKey, initialActivityId, initialHorizon, onOpenPeople, focusMomentsKey, onMomentSeen, focusMomentToken, focusPlansKey, focusPlanId, focusPlansFilter }: PlanWithAuraViewProps) {
  const [planMode, setPlanMode] = useState<TimingSearchMode>('FIND');
  const [taskTitle, setTaskTitle] = useState('');
  const [, setIsCustomTask] = useState(false);
  // HPG1 -- the caller-confirmed activityId for the CURRENT taskTitle, if
  // any. Set only from a validated initialActivityId (prefill effect
  // below) or left unset; cleared the instant taskTitle changes through
  // any OTHER path (typing, voice, a chip, or starting a reschedule) so a
  // stale id can never outlive the title it was resolved for, and two
  // catalog entries that happen to share a title can never cross-resolve.
  const [prefillActivityId, setPrefillActivityId] = useState<string | undefined>(undefined);
  // HPG2 -- explicit Goal-activity linkage for the plan ABOUT TO BE
  // CREATED. A SEPARATE identity space from prefillActivityId above
  // (catalog activity vs. a real, per-user GoalActivity database row --
  // never interchangeable, never inferred from title). Set ONLY by an
  // explicit selection in the "Link to a Goal" picker below; cleared the
  // instant taskTitle changes through any OTHER path, exactly mirroring
  // prefillActivityId's own discipline, so a stale Goal link can never
  // outlive the title/selection it was made for.
  const [showGoalLinker, setShowGoalLinker] = useState(false);
  const [goalOptions, setGoalOptions] = useState<{ id: string; title: string }[] | null>(null);
  const [loadingGoals, setLoadingGoals] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [goalActivityOptions, setGoalActivityOptions] = useState<{ id: string; title: string; activityId: string | null }[] | null>(null);
  const [loadingGoalActivities, setLoadingGoalActivities] = useState(false);
  const [selectedGoalActivityId, setSelectedGoalActivityId] = useState<string | undefined>(undefined);
  const [selectedGoalActivityTitle, setSelectedGoalActivityTitle] = useState<string | undefined>(undefined);
  const [horizon, setHorizon] = useState<PlanningHorizon>('TODAY');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [timePreference, setTimePreference] = useState<TimePreference>('AFTERNOON');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [findResult, setFindResult] = useState<TimingSearchResponseWithDailyRhythm | null>(null);
  const [error, setError] = useState('');
  // HPG3-A3b -- a SEPARATE state from `error` above, deliberately: a known
  // scheduling-eligibility code (from POST /api/plans or the reschedule-
  // via-Move route, both below) gets this dedicated, richer banner
  // (headline + non-technical detail + a severity-gated recovery action);
  // every OTHER failure in this view (search, voice input, an unrecognized
  // save/move failure) keeps using the plain `error` string exactly as
  // before. The two are mutually exclusive by construction -- whichever
  // catch block runs sets exactly one of them and clears the other, so
  // the view never renders two overlapping failure banners for one event.
  const [schedulingConflict, setSchedulingConflict] = useState<SchedulingEligibilityPresentation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // Product Structure V2 -- "Who's this with?" (brief section 10/11).
  // Lazily fetched the first time an activity whose socialMode permits a
  // person is selected, never on mount (most FIND searches are solo).
  const [savedPeople, setSavedPeople] = useState<SavedPersonRow[] | null>(null);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [sharedFindResult, setSharedFindResult] = useState<EverydaySharedCandidate[] | null>(null);
  const [momentSavingKey, setMomentSavingKey] = useState<string | null>(null);
  const [momentSavedKeys, setMomentSavedKeys] = useState<Set<string>>(() => new Set());
  // Share option under Plan (parity with Muhurtham Finder's "Share this
  // moment"): once a moment is saved, its shareUrl/id are kept here so a
  // second click can open the native share sheet / copy the link without
  // re-creating the moment.
  const [momentShareInfo, setMomentShareInfo] = useState<Record<string, { id: string; shareUrl: string }>>({});
  const [sharingMomentKey, setSharingMomentKey] = useState<string | null>(null);
  const [momentShareFeedback, setMomentShareFeedback] = useState<{ key: string; text: string } | null>(null);
  const momentsSectionRef = useRef<HTMLDivElement | null>(null);

  // CHECK mode
  const [checkTaskTitle, setCheckTaskTitle] = useState('');
  const [checkDate, setCheckDate] = useState('');
  const [checkStartTime, setCheckStartTime] = useState('');
  const [checkDurationMinutes, setCheckDurationMinutes] = useState(60);
  const [checkResult, setCheckResult] = useState<TimingSearchResponseWithDailyRhythm | null>(null);
  const [checkError, setCheckError] = useState('');
  const [isChecking, setIsChecking] = useState(false);

  // COMPARE mode
  const [compareTaskTitle, setCompareTaskTitle] = useState('');
  const [compareDurationMinutes, setCompareDurationMinutes] = useState(60);
  const [compareADate, setCompareADate] = useState('');
  const [compareAStartTime, setCompareAStartTime] = useState('');
  const [compareBDate, setCompareBDate] = useState('');
  const [compareBStartTime, setCompareBStartTime] = useState('');
  const [compareResult, setCompareResult] = useState<TimingSearchResponseWithDailyRhythm | null>(null);
  const [compareError, setCompareError] = useState('');
  const [isComparing, setIsComparing] = useState(false);
  const [showAllPlans, setShowAllPlans] = useState(false);
  // DR4-E2 -- the Missed Activities section's own independent expansion
  // control (2-item default, same pattern as showAllPlans' 3-item default
  // for Upcoming). Deliberately a second, separate flag rather than
  // overloading showAllPlans -- "View all upcoming" and "View all missed"
  // must work independently (collapsing one never affects the other).
  const [showAllMissed, setShowAllMissed] = useState(false);
  // Insights V1 PR7 (finding F-4) -- when an Insights suggestion's
  // subject is more than one unconfirmed plan, the CTA pre-filters this
  // list to that criterion instead of pointing at an invented single
  // plan. null = no filter. DR4-E2: "awaiting confirmation" plans are
  // exactly the Missed collection, so this now drives the Missed section
  // (not Upcoming, which no longer has any missed items to filter to).
  const [plansFilter, setPlansFilter] = useState<'AWAITING_CONFIRMATION' | null>(null);
  const [showMoreActivities, setShowMoreActivities] = useState(false);
  const [savedPlans, setSavedPlans] = useState<UpcomingPlan[]>([]);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [reschedulingPlanId, setReschedulingPlanId] = useState<string | null>(null);
  // DR4-F2B blocking-fix -- a single monotonic counter is the one source of
  // truth for "is this response still relevant". The original DR4-F2B
  // guard only compared reschedulingPlanId before/after a request, which
  // caught a changed RESCHEDULE TARGET but not a changed DATE, TIME,
  // DURATION, TITLE or MODE -- a user who edited any of those while a
  // Check-a-Time (or Find-a-Time) request was still in flight could have
  // the now-irrelevant response silently repopulate the result card (and,
  // if "Use this time" was then clicked, silently Move to the STALE
  // instant instead of whatever the form currently showed -- reproduced
  // live and confirmed via a 200 Move response during the DR4-F2B Final
  // Review). bumpRequestGeneration() is called from every input whose
  // change should invalidate an in-flight request (see each call site's
  // own comment) and once more, unconditionally, at the very start of
  // handleFindTime/handleCheckTime themselves, so even re-running the
  // IDENTICAL search invalidates whatever request came before it. A
  // response is applied ONLY if the generation it captured at request
  // time still strictly equals requestGenerationRef.current when it
  // resolves -- never by comparing input VALUES (which could
  // coincidentally return to what they were and falsely look "unchanged").
  const requestGenerationRef = useRef(0);
  const bumpRequestGeneration = () => { requestGenerationRef.current += 1; };
  const [confirmingRemovePlanId, setConfirmingRemovePlanId] = useState<string | null>(null);
  const [savingOpportunityKey, setSavingOpportunityKey] = useState<string | null>(null);
  const [planActionStates, setPlanActionStates] = useState<Record<string, PlanActionState>>({});
  // HPG4-2 -- "Skip all missed", a parallel implementation to Home's own
  // (deliberately not unified -- this surface already has its own separate
  // per-item Skip mechanism, handleSkipPlan). The ref is a synchronous
  // same-tick double-click guard, same idiom as the executor's own
  // inFlight Set elsewhere in this codebase.
  const skipAllMissedRunningRef = useRef(false);
  const [skipAllMissedBusy, setSkipAllMissedBusy] = useState(false);
  const [skipAllMissedNotice, setSkipAllMissedNotice] = useState<{ succeeded: number; failed: number } | null>(null);
  const [plannedOpportunityKeys, setPlannedOpportunityKeys] = useState<Set<string>>(() => new Set());
  // Aura Reminders V1 dedup linkage (brief section 7): the real saved
  // PlannedActivity id for each candidate key that's already been "Plan
  // this"-saved in this session -- handleMakeMoment passes this along when
  // the same candidate is then also "Make this a Moment"-saved, so the two
  // rows can be linked (AuraMoment.plannedActivityId) instead of silently
  // duplicating the same real-world event.
  const [plannedActivityIdByKey, setPlannedActivityIdByKey] = useState<Record<string, string>>({});
  const plansSectionRef = useRef<HTMLElement | null>(null);
  // DR4-E2 -- the Missed Activities section's own scroll target, separate
  // from plansSectionRef (Upcoming Plans), so an Insights "awaiting
  // confirmation" deep link lands on the right section.
  const missedSectionRef = useRef<HTMLElement | null>(null);
  // DR4-E2 -- an Insights suggestion naming exactly ONE awaiting-confirmation
  // plan targets it by focusPlanId alone (no focusPlansFilter -- see the
  // focusPlansKey effect's own doc comment: planFilter is only set "when
  // the subject is MORE than one unconfirmed plan"). Whether that one plan
  // is missed can only be known by looking it up in the loaded savedPlans,
  // which may not have arrived yet on a fresh mount (the GET /api/plans
  // fetch is async) -- these two refs let the resolution effect below wait
  // for data instead of guessing from a stale/empty missedPlans.
  const pendingFocusRef = useRef<{ planId: string | null; isAwaitingConfirmation: boolean } | null>(null);
  const plansLoadedRef = useRef(false);

  useEffect(() => {
    // initialHorizon (e.g. Tomorrow Preview's TOMORROW handoff) must apply
    // even when no specific activity was preselected -- the generic "Plan
    // tomorrow" link carries a horizon but no activity.
    if (initialHorizon) setHorizon(initialHorizon);

    const nextActivity = initialActivity?.trim();
    if (!nextActivity) return;

    // HPG1 -- see resolvePrefillActivity's own doc comment: activityId is
    // trusted directly when it resolves, never inferred from title text.
    const resolved = resolvePrefillActivity(nextActivity, initialActivityId);
    setTaskTitle(resolved.taskTitle);
    setIsCustomTask(resolved.isCustomTask);
    setPrefillActivityId(resolved.activityId);
    // HPG2 -- a Home/Ask Aura handoff never carries a Goal selection of
    // its own (that identity space is scoped to this file's explicit
    // picker only); clears defensively so a prior selection can never
    // survive onto a newly-handed-off activity.
    clearGoalActivitySelection();
    setTimePreference(recommendedPreference(resolved.taskTitle));
    setFindResult(null);
    setError('');
    setSchedulingConflict(null);
    setShowAllPlans(false);
    setPlansFilter(null);
    setShowMoreActivities(false);
    setExpandedPlanId(null);
    setReschedulingPlanId(null);
    bumpRequestGeneration();
    setSavingOpportunityKey(null);
    setPlanActionStates({});
    setPlannedOpportunityKeys(new Set());
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [initialActivity, initialActivityKey, initialActivityId, initialHorizon]);

  useEffect(() => {
    let cancelled = false;
    const loadPlans = async () => {
      try {
        const res = await fetch('/api/plans');
        if (!res.ok) throw new Error('Unable to load plans.');
        const rows = await res.json();
        if (cancelled) return;
        setSavedPlans(Array.isArray(rows) ? rows.map((row: PlanApiRow) => mapPlanRow(row, timezone)) : []);
      } catch {
        if (!cancelled) setSavedPlans([]);
      } finally {
        // DR4-E2 -- see plansLoadedRef's own doc comment: the Insights
        // focus-jump effect needs to know plans have at least been
        // attempted once (success or failure) before it can correctly
        // decide Upcoming vs. Missed for a focusPlanId-only target.
        if (!cancelled) plansLoadedRef.current = true;
      }
    };

    loadPlans();
    setExpandedPlanId(null);
    return () => {
      cancelled = true;
    };
  }, [timezone]);

  const filteredTasks = useMemo(() => {
    const query = taskTitle.trim().toLowerCase();
    if (!query) return showMoreActivities ? ALL_TASKS : TASKS.slice(0, 4);
    return ALL_TASKS
      .filter((task) => task.title.toLowerCase().includes(query) || task.keywords.some((keyword) => keyword.includes(query)))
      .slice(0, showMoreActivities ? 14 : 5);
  }, [taskTitle, showMoreActivities]);

  // HPG1 -- prefers a caller-confirmed identity (prefillActivityId, already
  // validated against the catalog in the prefill effect above) over a
  // fresh title match for the CURRENT taskTitle, exactly once per use site
  // -- never introduces a new title-matching inference of its own. Used
  // everywhere FIND mode resolves "what activity is this" so a caller-
  // supplied id and a pasted/typed title can never silently disagree, even
  // if two catalog entries happened to share a title.
  const resolveCurrentActivitySelection = (): { activityId?: string; taskTitle?: string } =>
    // Same mutually-exclusive {activityId} XOR {taskTitle} shape
    // resolveActivitySelection itself always returns -- never both at once.
    prefillActivityId ? { activityId: prefillActivityId } : resolveActivitySelection(taskTitle);

  // The exact same resolution handleFindTime's own selection will use
  // (resolveActivitySelection, not the looser alias matcher) -- the person
  // picker must only appear when the search is actually about to resolve
  // to this specific catalog activity.
  const resolvedActivityDefinition = useMemo(() => {
    const selection = prefillActivityId ? { activityId: prefillActivityId } : resolveActivitySelection(taskTitle);
    return selection.activityId ? getActivityDefinition(selection.activityId) : undefined;
  }, [taskTitle, prefillActivityId]);
  const showPersonPicker = planMode === 'FIND' && resolvedActivityDefinition?.socialMode !== undefined && resolvedActivityDefinition.socialMode !== 'SOLO';

  useEffect(() => {
    if (!showPersonPicker || savedPeople !== null || loadingPeople) return;
    setLoadingPeople(true);
    fetch('/api/people')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Unable to load people.'))))
      .then((data: SavedPersonRow[]) => setSavedPeople(data))
      .catch(() => setSavedPeople([]))
      .finally(() => setLoadingPeople(false));
  }, [showPersonPicker, savedPeople, loadingPeople]);

  // HPG2 -- lazy: only fetched once the user actually opens "Link to a
  // Goal" (never on every Plan mount, the common non-Goal case stays at
  // zero extra cost). Reuses the EXISTING GET /api/goals list endpoint
  // unmodified.
  useEffect(() => {
    if (!showGoalLinker || goalOptions !== null || loadingGoals) return;
    setLoadingGoals(true);
    fetch('/api/goals')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Unable to load goals.'))))
      .then((data: { id: string; title: string }[]) => setGoalOptions(Array.isArray(data) ? data.map((g) => ({ id: g.id, title: g.title })) : []))
      .catch(() => setGoalOptions([]))
      .finally(() => setLoadingGoals(false));
  }, [showGoalLinker, goalOptions, loadingGoals]);

  // HPG2 -- reuses the EXISTING GET /api/goals/:goalId detail endpoint
  // unmodified, including its own already-correct derivedState
  // computation (deriveGoalActivityState, lib/goals.ts) -- filtered here
  // to exactly the activities linkGoalActivityToPlannedActivity (db.ts)
  // would itself accept (SUGGESTED = currently unlinked, or linked only to
  // a CANCELLED/SKIPPED plan), so this picker never offers a selection the
  // server-side save would then reject. A stale/now-ineligible selection
  // is still safely rejected server-side regardless (never trusted from
  // this read alone) -- see POST /api/plans's own goalActivityId handling.
  useEffect(() => {
    if (!selectedGoalId) {
      setGoalActivityOptions(null);
      return;
    }
    let cancelled = false;
    setLoadingGoalActivities(true);
    setGoalActivityOptions(null);
    fetch(`/api/goals/${selectedGoalId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Unable to load this goal.'))))
      .then((data: { activities: { id: string; title: string; activityId: string | null; derivedState: string }[] }) => {
        if (cancelled) return;
        const eligible = (data.activities ?? []).filter((a) => a.derivedState === 'SUGGESTED').map((a) => ({ id: a.id, title: a.title, activityId: a.activityId }));
        setGoalActivityOptions(eligible);
      })
      .catch(() => {
        if (!cancelled) setGoalActivityOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingGoalActivities(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGoalId]);

  // HPG2 -- explicit selection only, never inferred from taskTitle's text.
  // Adopts the GoalActivity's OWN canonical title (same discipline as
  // resolvePrefillActivity, HPG1) and, when that GoalActivity also carries
  // its own catalog activityId, threads it into prefillActivityId too --
  // a GoalActivity CAN optionally have a catalog identity alongside its
  // Goal identity; the two are independent and this is the one place both
  // are known at once, so both are preserved together.
  const selectGoalActivity = (activity: { id: string; title: string; activityId: string | null }) => {
    setTaskTitle(activity.title);
    setIsCustomTask(false);
    setPrefillActivityId(activity.activityId ?? undefined);
    setSelectedGoalActivityId(activity.id);
    setSelectedGoalActivityTitle(activity.title);
    setTimePreference(recommendedPreference(activity.title));
    setFindResult(null);
    setError('');
    setSchedulingConflict(null);
    bumpRequestGeneration();
  };

  const clearGoalActivitySelection = () => {
    setSelectedGoalActivityId(undefined);
    setSelectedGoalActivityTitle(undefined);
  };

  useEffect(() => {
    if (!focusMomentsKey) return;
    requestAnimationFrame(() => {
      momentsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [focusMomentsKey]);

  // Insights V1 PR7 (finding F-4) -- an Insights suggestion CTA jump:
  // reveal "My Plans" (the exact same reveal handleMyPlansClick already
  // performs, never the new-activity composer), optionally expand one
  // specific plan, optionally pre-filter the list. A stale/deleted
  // focusPlanId simply matches no row below -- safe, no crash, the user
  // still lands on their real current plans. DR4-E2: this only CAPTURES
  // the request (plansFilter/expandedPlanId, plus what's needed to resolve
  // Upcoming vs. Missed) -- the actual section-targeting/scroll is a
  // separate effect below, after missedPlans exists, because a single-plan
  // suggestion (the common case: "subject is exactly one unconfirmed plan")
  // sets focusPlanId ALONE, no focusPlansFilter (see this same comment
  // historically -- planFilter is used only when "more than one" plan is
  // the subject), and whether THAT plan is missed can only be known by
  // looking it up in savedPlans, which has not necessarily loaded yet.
  useEffect(() => {
    if (!focusPlansKey) return;
    setPlansFilter(focusPlansFilter ?? null);
    setExpandedPlanId(focusPlanId ?? null);
    pendingFocusRef.current = { planId: focusPlanId ?? null, isAwaitingConfirmation: focusPlansFilter === 'AWAITING_CONFIRMATION' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPlansKey]);

  const selectedHorizon = HORIZONS.find((item) => item.value === horizon) ?? HORIZONS[0];
  const selectedDuration = DURATIONS.find((item) => item.value === durationMinutes) ?? DURATIONS[2];
  const horizonHelper = useMemo(() => getHorizonHelper(horizon, timezone), [horizon, timezone]);
  // DR4-E1 (Time-Aware Upcoming Plans) -- the DR4-E audit's Defect 1: status
  // alone (the old isActionableUpcomingPlan-only filter) never excluded a
  // plan whose scheduled window had already elapsed, so a plan from 11 days
  // ago sat here indefinitely. isUpcomingOrCurrentPlan adds the same
  // time-aware MISSED check Home's own agenda already uses (dailyAgenda.ts's
  // timeBasedStatus, via planFormatting.ts's derivedPlanLifecycle) -- not a
  // new classification. Explicitly sorted start-ASC on the client rather
  // than trusting the API's own ordering verbatim (that ordering is
  // Defect 2 and is deliberately left untouched server-side -- GET /api/plans
  // has other consumers, see DR4-E1's own PR notes -- so this view must not
  // depend on it beyond "contains the right rows").
  const upcomingOrCurrentPlans = useMemo(
    () =>
      savedPlans
        .filter((plan) => isUpcomingOrCurrentPlan(plan))
        .sort((a, b) => new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime()),
    [savedPlans]
  );
  // DR4-E1 -- persisted UPCOMING whose scheduled end has elapsed. No longer
  // part of the default "Upcoming Plans" view or its 3-slot limit (that's
  // the fix), but still reachable via "View all" below, most-recently-missed
  // first, through the exact same card -- DR4-E2 owns giving this its own
  // section/actions/labeling; this PR is classification and ordering only.
  const missedPlans = useMemo(
    () =>
      savedPlans
        .filter((plan) => isMissedPlan(plan))
        .sort((a, b) => new Date(b.plannedEndAt).getTime() - new Date(a.plannedEndAt).getTime()),
    [savedPlans]
  );
  // DR4-E2 -- resolves and performs the Insights focus-jump the effect
  // above captured, once it's actually possible to tell Upcoming from
  // Missed. A filter-based request (focusPlansFilter === 'AWAITING_CONFIRMATION')
  // resolves immediately -- it needs no data lookup. A single-plan request
  // (focusPlanId alone) waits for plansLoadedRef so a plan that's actually
  // missed is never misrouted to Upcoming just because savedPlans hadn't
  // loaded yet on a fresh mount (the bug this replaces: that fresh-mount
  // race previously left the page unscrolled, or scrolled to the wrong
  // section, for the single-missed-plan Insights suggestion -- confirmed
  // live). Runs again whenever missedPlans changes (i.e., whenever
  // savedPlans loads/reloads) but is a no-op once pendingFocusRef is
  // cleared, so it never re-scrolls on an unrelated later plan mutation.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    if (!pending.isAwaitingConfirmation && pending.planId && !plansLoadedRef.current) return;
    pendingFocusRef.current = null;
    const isAwaitingConfirmation = pending.isAwaitingConfirmation || (pending.planId ? missedPlans.some((p) => p.id === pending.planId) : false);
    setShowAllPlans(!isAwaitingConfirmation);
    setShowAllMissed(isAwaitingConfirmation);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        (isAwaitingConfirmation ? missedSectionRef : plansSectionRef).current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }, [focusPlansKey, missedPlans]);
  const completedPlans = useMemo(() => savedPlans.filter(isCompletedPlan), [savedPlans]);
  // DR4-E2 -- Upcoming Plans is now ALWAYS upcomingOrCurrentPlans (missed
  // plans have their own section below and no longer pass through this
  // one at all, filtered or not) -- the 3-slot default limit applies only
  // to genuinely upcoming/current plans, unconditionally.
  const visibleUpcomingPlans = showAllPlans ? upcomingOrCurrentPlans : upcomingOrCurrentPlans.slice(0, 3);
  // DR4-E2 (Missed Activity Presentation) -- its own independent 2-item
  // default / "View all missed activities" expansion, entirely separate
  // from Upcoming's own showAllPlans (section 6: "avoid adding a third
  // global expansion state" -- these are the two, each scoped to its own
  // collection, never a combined one). plansFilter === 'AWAITING_CONFIRMATION'
  // (Insights V1 PR7's own existing filter -- now that Missed has its own
  // section, "awaiting confirmation" IS the Missed collection) forces the
  // full list open, same as showAllMissed, so the Insights deep link still
  // shows everything it promised.
  const visibleMissedPlans = showAllMissed || plansFilter === 'AWAITING_CONFIRMATION' ? missedPlans : missedPlans.slice(0, 2);
  const visibleCompletedPlans = showAllPlans ? completedPlans.slice(0, 5) : [];
  const canSubmit = Boolean(taskTitle.trim()) && (horizon !== 'CUSTOM' || Boolean(customStartDate && customEndDate && customEndDate >= customStartDate));

  // DR4-F1 -- rescheduling an EXISTING plan now goes through the same
  // POST /api/plans/{id}/move contract Home's own Move already uses
  // (lib/planMove.ts's movePlannedActivity/applyMoveWrites), instead of
  // the old create-a-new-plan + fire-and-forget-DELETE-the-old-one
  // sequence. Move is one atomic transaction, server-side: it inherits
  // title/activityType/icon/durationMinutes/activityId/schedulingMode
  // verbatim from the ORIGINAL row (never from this search's own
  // candidate), and -- in the SAME transaction -- repoints
  // GoalActivity/GoalActivityOccurrence/GoalActivityExecution/Capture to
  // the replacement and stamps rescheduledFromPlanId. None of that needs
  // any client-side logic; this function only needs to send the chosen
  // instant. See AURA_DR4_F_RESCHEDULING_AUDIT.md for the full audit this
  // fixes (goal association silently lost; activity title silently
  // renamed via the search's own catalog match).
  const handleReschedulePlanViaMove = async (replacedPlanId: string, newStartAt: string): Promise<UpcomingPlan> => {
    const res = await fetch(`/api/plans/${replacedPlanId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newStartAt }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      // HPG3-A3b -- Move's own route (apps/web/app/api/plans/[planId]/move/route.ts)
      // already returns `{error, code}`; 3 of its codes (CAPACITY_EXCEEDED,
      // DAILY_CAPACITY_EXCEEDED, DAILY_ATTRIBUTION_UNRESOLVED) are the EXACT
      // same strings schedulingEligibilityError.ts reuses, so the SAME typed
      // presentation applies here too -- carried through as a PlanActionError
      // rather than a plain Error so the catch below can distinguish it
      // without re-parsing the response body a second time.
      throw new PlanActionError((body && typeof body.error === 'string' && body.error) || 'Unable to reschedule this activity.', typeof body?.code === 'string' ? body.code : undefined);
    }
    const body = await res.json();
    const saved = mapPlanRow(body.plan, timezone);
    setSavedPlans((plans) => [
      saved,
      ...plans.filter((item) => item.id !== saved.id && item.id !== replacedPlanId),
    ]);
    setExpandedPlanId(saved.id);
    setReschedulingPlanId(null);
    bumpRequestGeneration();
    setShowAllPlans(true);
    onPlanLogged?.();
    triggerHaptic('success');
    trackEvent('PLAN_RESULT_SELECTED', { metadata: { mode: planMode } });
    return saved;
  };

  const handleSavePlan = async (plan: UpcomingPlan, activityId?: string | null): Promise<UpcomingPlan> => {
    const replacedPlanId = reschedulingPlanId;
    if (replacedPlanId) {
      try {
        return await handleReschedulePlanViaMove(replacedPlanId, plan.plannedStartAt);
      } catch (err) {
        // Deliberately does NOT clear reschedulingPlanId -- same as the
        // pre-existing catch below, a failed save leaves the user still
        // "in reschedule mode" so they can pick a different candidate and
        // retry, rather than having to tap Reschedule again. The Move
        // transaction itself guarantees the original is untouched on any
        // failure (lib/planMove.ts), so there is nothing to roll back here.
        //
        // HPG3-A3b -- a known scheduling-eligibility code (the 3 Move and
        // schedulingEligibilityError.ts genuinely share) gets the SAME
        // typed banner as a failed NEW-plan save below, for consistent
        // treatment of the same underlying conflict regardless of which
        // action triggered it. Every other Move failure (NOT_FOUND,
        // CONFLICT, HAS_LINKED_MOMENT, etc.) keeps showing Move's own
        // existing message text via the plain `error` state, unchanged.
        if (err instanceof PlanActionError && isKnownSchedulingEligibilityCode(err.code)) {
          setSchedulingConflict(presentSchedulingEligibilityError(err.code));
        } else {
          setError(err instanceof Error && err.message ? err.message : 'Unable to reschedule this activity. Please check your connection and try again.');
        }
        triggerHaptic('warning');
        throw err instanceof Error ? err : new Error('Unable to reschedule plan.');
      }
    }
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: plan.title,
          activityType: plan.title,
          icon: plan.icon,
          plannedStartAt: plan.plannedStartAt,
          plannedEndAt: plan.plannedEndAt,
          durationMinutes: minutesFromDuration(plan.duration),
          windowType: windowTypeFromLabel(plan.window),
          windowLabel: plan.window,
          matchLabel: plan.match,
          score: plan.score,
          recommendation: plan.details,
          calendarUrl: plan.googleCalendarUrl,
          // Planned Activity Canonical Identity Propagation V1 -- the
          // already-resolved catalog activity for this search's own
          // taskTitle (resolveActivitySelection, the same exact-match
          // resolution FIND/CHECK/COMPARE already use for AuraMoment
          // creation), or null for a free-text/no-match search. No
          // resolution happens here; the server validates.
          activityId: activityId ?? null,
          // HPG2 -- only ever set via this view's own explicit "Link to a
          // Goal" picker (selectGoalActivity), never inferred from
          // `plan.title`'s text. The server independently validates
          // ownership/eligibility and fails the WHOLE save closed if it no
          // longer holds (see POST /api/plans's own handling) -- this is
          // advisory intent, not a trusted fact.
          goalActivityId: selectedGoalActivityId ?? null,
        }),
      });
      if (!res.ok) {
        // HPG3-A3b -- POST /api/plans already returns `{error, code}` for
        // every rejection (schedulingEligibilityError.ts, HPG3-A3a); this
        // was previously discarded entirely (the body was never even
        // read), so EVERY failure -- including the pre-A3a "goal no
        // longer active"/"not available to link" cases -- showed the
        // exact same generic text. Reading it now is a strict
        // improvement, not a changed success flow.
        const body = await res.json().catch(() => null);
        throw new PlanActionError((body && typeof body.error === 'string' && body.error) || 'Unable to save plan.', typeof body?.code === 'string' ? body.code : undefined);
      }
      const row = await res.json();
      const saved = mapPlanRow(row, timezone);
      setSavedPlans((plans) => [saved, ...plans.filter((item) => item.id !== saved.id)]);
      setExpandedPlanId(saved.id);
      setShowAllPlans(true);
      // HPG2 -- the Goal-linking intent was just consumed by this specific
      // save; clear it so a subsequent, unrelated search/save in the same
      // Plan session never silently reuses it.
      clearGoalActivitySelection();
      onPlanLogged?.();
      triggerHaptic('success');
      trackEvent('PLAN_RESULT_SELECTED', { metadata: { mode: planMode } });
      return saved;
    } catch (err) {
      // The plan was NOT actually persisted -- do not add it to savedPlans
      // (that previously faked a success the server never confirmed, so the
      // plan silently vanished on the next page load/GET /api/plans). Surface
      // a real error instead.
      //
      // HPG3-A3b -- a known scheduling-eligibility code gets the dedicated
      // `schedulingConflict` banner (headline + non-technical detail +, for
      // a genuine conflict, a real "View your plans" action); every other
      // failure (a network error, an unrecognized/codeless rejection) keeps
      // the exact same generic `error` text as before this ticket.
      if (err instanceof PlanActionError && isKnownSchedulingEligibilityCode(err.code)) {
        setSchedulingConflict(presentSchedulingEligibilityError(err.code));
      } else {
        setError('Unable to save this plan. Please check your connection and try again.');
      }
      triggerHaptic('warning');
      throw new Error('Unable to save plan.');
    }
  };

  const handleReschedulePlan = (plan: UpcomingPlan) => {
    // DR4-F2A -- a reschedule always starts on FIND, regardless of which
    // mode tab happened to be active when "Reschedule" was tapped (Upcoming
    // Plans/Missed Activities render outside the FIND/CHECK/COMPARE blocks,
    // so this could previously be reached from any of the three). FIND is
    // the only mode whose title/duration prefill was reschedule-aware
    // before DR4-F2B; the reschedule-scoped mode switcher rendered below
    // now also offers CHECK ("Choose My Own Time"), prefilled the same way.
    setPlanMode('FIND');
    setTaskTitle(plan.title);
    setIsCustomTask(true);
    // HPG1 -- Move always inherits the ORIGINAL plan's own activityId
    // server-side (see handleReschedulePlanViaMove's own comment below),
    // never whatever this search resolves, so no prefill id applies here.
    setPrefillActivityId(undefined);
    // HPG2 -- likewise, Move inherits the original plan's existing Goal
    // linkage server-side (applyMoveWrites, lib/planMove.ts) -- a
    // reschedule search never creates a NEW Goal link of its own.
    clearGoalActivitySelection();
    // DR4-F1 -- synced across all three composer modes (not just FIND's own
    // durationMinutes) because the "How long?" selector is locked to this
    // value for the duration of a reschedule (Move always inherits the
    // ORIGINAL plan's own durationMinutes, never whatever this search
    // picks -- see handleReschedulePlanViaMove). Switching to Check/Compare
    // mid-reschedule must show the same, correct, locked duration, not
    // whatever those modes' own fields were last left at.
    setDurationMinutes(minutesFromDuration(plan.duration));
    setCheckDurationMinutes(minutesFromDuration(plan.duration));
    setCompareDurationMinutes(minutesFromDuration(plan.duration));
    setTimePreference(recommendedPreference(plan.title));
    setHorizon('SEVEN_DAYS');
    setCustomStartDate('');
    setCustomEndDate('');
    setFindResult(null);
    // DR4-F2B -- "Choose My Own Time" prefills the original plan's own
    // date/time (in the composer's own display timezone, the same
    // convention homeMove.ts's defaultMoveSelection already uses), so a
    // user who just wants to nudge the time slightly isn't starting from a
    // blank form. Only the DISPLAY is prefilled -- Move itself inherits
    // duration/title/metadata from the original row regardless of what's
    // shown here, exactly as it already does for FIND. checkResult/
    // checkError are cleared so a PREVIOUS reschedule's (or a plain
    // stand-alone check's) now-irrelevant result/error can never bleed
    // into this one.
    setCheckTaskTitle(plan.title);
    const planStart = new Date(plan.plannedStartAt);
    const tz = timezone || 'UTC';
    setCheckDate(getDatePartsInTimezone(tz, planStart).dateStr);
    const minuteOfDay = getMinuteOfDayInTimezone(tz, planStart);
    setCheckStartTime(`${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`);
    setCheckResult(null);
    setCheckError('');
    setShowAllPlans(false);
    setPlansFilter(null);
    setExpandedPlanId(null);
    setReschedulingPlanId(plan.status === 'UPCOMING' ? plan.id : null);
    // DR4-F2B blocking-fix -- starting (or re-starting, for a DIFFERENT
    // plan) a reschedule invalidates any FIND/CHECK request still in
    // flight for whatever was on screen before, so its response can never
    // land on the new target.
    bumpRequestGeneration();
    setSavingOpportunityKey(null);
    setPlannedOpportunityKeys(new Set());
    triggerHaptic('light');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogPlan = async (plan: UpcomingPlan) => {
    if (planActionStates[plan.id] || plan.status === 'LOGGED' || plan.status === 'CANCELLED' || plan.status === 'SKIPPED' || plan.status === 'MOVED') return;
    setPlanActionStates((states) => ({ ...states, [plan.id]: 'LOGGING' }));
    try {
      const res = await fetch(`/api/plans/${plan.id}/log`, { method: 'POST' });
      if (!res.ok) throw new Error('Unable to log plan.');
      const result = await res.json();
      const updated = mapPlanRow(result.plan, timezone);
      setSavedPlans((plans) => plans.map((item) => item.id === plan.id ? updated : item));
      setExpandedPlanId(plan.id);
      onPlanLogged?.();
      triggerHaptic('success');
    } catch {
      // Bug: Logged Plan Returns To Upcoming Plans After Page Refresh --
      // this previously faked a local 'LOGGED' state on ANY failure
      // (non-2xx status or a network/exception), the same "trust the
      // client over the server" mistake handleSavePlan's own catch above
      // already learned not to make. POST /api/plans/[planId]/log never
      // actually persisted anything in that case, so status stayed
      // UPCOMING in the database -- the very next GET /api/plans (a page
      // reload, or even this same session's next fetch) always overwrote
      // the fake optimistic entry with the true, still-unlogged row. Real
      // completion state now comes exclusively from the server's own
      // response above; a failure surfaces as a real, visible error
      // instead of a false success.
      setError('Unable to log this activity. Please check your connection and try again.');
      triggerHaptic('warning');
    } finally {
      setPlanActionStates((states) => {
        const next = { ...states };
        delete next[plan.id];
        return next;
      });
    }
  };

  const handleCancelPlan = async (plan: UpcomingPlan) => {
    if (planActionStates[plan.id]) return;

    setPlanActionStates((states) => ({ ...states, [plan.id]: 'CANCELLING' }));
    try {
      // Server decides cancel vs. permanent removal from the plan's own
      // status -- UPCOMING gets cancelled, LOGGED/CANCELLED gets removed
      // for good (see app/api/plans/[planId]/route.ts).
      const res = await fetch(`/api/plans/${plan.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Unable to remove plan.');
      setSavedPlans((plans) => plans.filter((item) => item.id !== plan.id));
      setExpandedPlanId(null);
      setConfirmingRemovePlanId(null);
      onPlanLogged?.();
      triggerHaptic('success');
    } catch (err) {
      console.error('Failed to remove plan:', err);
    } finally {
      setPlanActionStates((states) => {
        const next = { ...states };
        delete next[plan.id];
        return next;
      });
    }
  };

  // DR4-E2 -- Skip is the Missed Activities card's primary dismissal action
  // (never Cancel -- that stays reachable only through the existing
  // UpcomingPlan card's own flow, unchanged). Reuses the existing
  // POST /api/plans/[planId]/skip route verbatim (skipPlannedActivity,
  // already shipped for Home's own Missed Recovery) -- no new mutation, no
  // new status. The server's returned plan (status SKIPPED) naturally drops
  // out of missedPlans on the next render via isMissedPlan/derivedPlanLifecycle
  // (a SKIPPED persisted status is terminal, never MISSED) -- no separate
  // "remove from missed" bookkeeping needed.
  const handleSkipPlan = async (plan: UpcomingPlan) => {
    if (planActionStates[plan.id]) return;
    setPlanActionStates((states) => ({ ...states, [plan.id]: 'SKIPPING' }));
    try {
      const res = await fetch(`/api/plans/${plan.id}/skip`, { method: 'POST' });
      if (!res.ok) throw new Error('Unable to skip plan.');
      const result = await res.json();
      const updated = mapPlanRow(result.plan, timezone);
      setSavedPlans((plans) => plans.map((item) => item.id === plan.id ? updated : item));
      onPlanLogged?.();
      triggerHaptic('success');
    } catch {
      setError('Unable to skip this activity. Please check your connection and try again.');
      triggerHaptic('warning');
    } finally {
      setPlanActionStates((states) => {
        const next = { ...states };
        delete next[plan.id];
        return next;
      });
    }
  };

  // HPG4-2 -- "Skip all missed", calling the exact same per-item skip route
  // handleSkipPlan already uses, once per eligible plan, sequentially (no
  // new endpoint, no second lifecycle path). Eligibility is recomputed
  // fresh here from the live savedPlans/isMissedPlan at the moment of the
  // click -- never from the missedPlans memo, which only recomputes when
  // savedPlans changes and could otherwise show a plan as eligible after
  // the clock alone has already moved it past the missed boundary.
  const handleSkipAllMissed = async () => {
    if (skipAllMissedRunningRef.current) return;
    const eligible = savedPlans.filter((plan) => isMissedPlan(plan));
    if (eligible.length < 2) return;
    skipAllMissedRunningRef.current = true;
    setSkipAllMissedBusy(true);
    setSkipAllMissedNotice(null);
    const outcomes = await collectSkipAllOutcomes(
      eligible,
      (plan) => Boolean(planActionStates[plan.id]),
      async (plan) => {
        setPlanActionStates((states) => ({ ...states, [plan.id]: 'SKIPPING' }));
        try {
          const res = await fetch(`/api/plans/${plan.id}/skip`, { method: 'POST' });
          if (!res.ok) throw new Error('Unable to skip plan.');
          const result = await res.json();
          const updated = mapPlanRow(result.plan, timezone);
          setSavedPlans((plans) => plans.map((item) => item.id === plan.id ? updated : item));
          return 'SKIPPED';
        } catch {
          return 'FAILED';
        } finally {
          setPlanActionStates((states) => {
            const next = { ...states };
            delete next[plan.id];
            return next;
          });
        }
      },
    );
    skipAllMissedRunningRef.current = false;
    setSkipAllMissedBusy(false);
    const { succeeded, failed } = summarizeSkipAllOutcome(outcomes);
    setSkipAllMissedNotice({ succeeded, failed });
    if (succeeded > 0) onPlanLogged?.();
  };

  const handleFindTime = async () => {
    if (!canSubmit) return;
    setIsLoading(true);
    setError('');
    setSchedulingConflict(null);
    // DR4-F2B blocking-fix -- bumped unconditionally so THIS request's own
    // generation is always strictly newer than whatever came before it
    // (including an identical re-run of the same search: "a newer
    // assessment request" invalidates an older one even with unchanged
    // inputs). Captured immediately after the bump; the response is
    // applied only if nothing -- not task title, horizon, custom dates,
    // duration, time preference, person selection, mode, or reschedule
    // target -- has bumped the generation again before it resolves.
    bumpRequestGeneration();
    const myRequestGeneration = requestGenerationRef.current;
    try {
      const selection = resolveCurrentActivitySelection();
      // Product Structure V2 (brief section 12): a person is selected AND
      // resolves to a known catalog activity -> everyday SHARED timing,
      // never findSharedMuhurthams (see everydayTimingFit.ts's own doc
      // comment for why). Otherwise, existing GENERAL/personalized FIND is
      // completely unchanged.
      if (selectedPersonId && selection.activityId) {
        const res = await fetch('/api/timing-search/shared', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activityId: selection.activityId,
            durationMinutes,
            horizon,
            customStartDate: horizon === 'CUSTOM' ? customStartDate : undefined,
            customEndDate: horizon === 'CUSTOM' ? customEndDate : undefined,
            timePreference: toTimingPreference(timePreference),
            limit: 3,
            savedPersonId: selectedPersonId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Unable to find a shared time.');
        if (myRequestGeneration !== requestGenerationRef.current) return;
        setSharedFindResult(data.candidates as EverydaySharedCandidate[]);
        setFindResult(null);
      } else {
        const next = await onTimingSearch({
          mode: 'FIND',
          ...selection,
          durationMinutes,
          horizon,
          customStartDate: horizon === 'CUSTOM' ? customStartDate : undefined,
          customEndDate: horizon === 'CUSTOM' ? customEndDate : undefined,
          timePreference: toTimingPreference(timePreference),
          limit: 3,
        });
        if (myRequestGeneration !== requestGenerationRef.current) return;
        setFindResult(next);
        setSharedFindResult(null);
      }
      setSavingOpportunityKey(null);
      setPlannedOpportunityKeys(new Set());
      setMomentSavedKeys(new Set());
      triggerHaptic('success');
    } catch {
      if (myRequestGeneration !== requestGenerationRef.current) return;
      setError('Aura could not find a time for this request. Try a shorter duration or a wider date range.');
    } finally {
      setIsLoading(false);
    }
  };

  /** Product Structure V2 -- "Make this a Moment" (brief section 9/17):
   * generalizes AuraMoment creation beyond Muhurtham Finder. Reuses the
   * exact same POST /api/aura-moments endpoint, just with source: 'PLAN'.
   * Solo results use scope PERSONAL (Timing Search already personalizes
   * when profile data exists); a selected person uses SHARED. */
  const handleMakeMoment = async (key: string, params: { activityId: string; start: string; end: string; ratingLabel: string; savedPersonId?: string }) => {
    setMomentSavingKey(key);
    try {
      // Aura Reminders V1 dedup linkage (brief section 7): only ever set
      // when THIS candidate was already "Plan this"-saved in this same
      // session, so the client can honestly vouch for both ids referring to
      // the same real-world event -- never inferred any other way.
      const plannedActivityId = plannedOpportunityKeys.has(key) ? plannedActivityIdByKey[key] : undefined;
      const res = await fetch('/api/aura-moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: params.savedPersonId ? 'SHARED' : 'PERSONAL',
          source: 'PLAN',
          activityId: params.activityId,
          startAt: params.start,
          endAt: params.end,
          ratingLabel: params.ratingLabel,
          savedPersonId: params.savedPersonId,
          plannedActivityId,
        }),
      });
      if (!res.ok) throw new Error('Unable to create this moment.');
      const data = await res.json();
      setMomentSavedKeys((prev) => new Set(prev).add(key));
      setMomentShareInfo((prev) => ({ ...prev, [key]: { id: data.id, shareUrl: data.shareUrl } }));
      triggerHaptic('success');
    } catch {
      // Best-effort, same convention as saveOpportunity's own catch below --
      // no destructive state to roll back, the user can just retry.
    } finally {
      setMomentSavingKey(null);
    }
  };

  /** Share option under Plan -- parity with Muhurtham Finder's "Share this
   * moment" (handleShareMoment there): the moment already exists (created by
   * handleMakeMoment above), so this only ever hands its shareUrl to the
   * user -- native share sheet where supported, else copy-to-clipboard,
   * else show the raw link. Never re-POSTs /api/aura-moments. */
  const handleShareSavedMoment = async (key: string, scope: 'PERSONAL' | 'SHARED', activityId: string) => {
    const info = momentShareInfo[key];
    if (!info) return;
    setSharingMomentKey(key);
    setMomentShareFeedback(null);
    const shareTitle = `A moment from Aura — ${FULL_ACTIVITY_CATALOG.find((a) => a.id === activityId)?.title ?? 'Timing'}`;
    const shareText = 'Aura found a good time — take a look.';
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: shareTitle, text: shareText, url: info.shareUrl });
        setMomentShareFeedback({ key, text: 'Shared!' });
        trackEvent('AURA_MOMENT_SHARE_INITIATED', { auraMomentId: info.id, metadata: { scope, method: 'native_share', planningMode: getActivityDefinition(activityId)?.experience.planningMode ?? 'EVERYDAY' } });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(info.shareUrl);
        setMomentShareFeedback({ key, text: 'Link copied!' });
        trackEvent('AURA_MOMENT_SHARE_INITIATED', { auraMomentId: info.id, metadata: { scope, method: 'copy_link', planningMode: getActivityDefinition(activityId)?.experience.planningMode ?? 'EVERYDAY' } });
      } else {
        setMomentShareFeedback({ key, text: info.shareUrl });
      }
    } catch (shareErr) {
      // navigator.share() throws AbortError when the user simply dismisses
      // the native sheet -- not a failure, nothing to show for that.
      if (shareErr instanceof Error && shareErr.name === 'AbortError') {
        setSharingMomentKey(null);
        return;
      }
      setMomentShareFeedback({ key, text: info.shareUrl });
    } finally {
      setSharingMomentKey(null);
    }
  };

  const handleCheckTime = async () => {
    if (!checkTaskTitle.trim() || !checkDate || !checkStartTime) return;
    setIsChecking(true);
    setCheckError('');
    // DR4-F2B blocking-fix -- same generation guard as handleFindTime (see
    // its own comment). The ORIGINAL DR4-F2B guard here only compared
    // reschedulingPlanId, which missed the actual reported defect: editing
    // checkDate/checkStartTime/checkDurationMinutes/checkTaskTitle while
    // THIS SAME request was still in flight let its stale response
    // silently repopulate checkResult for the NEW (not what was checked)
    // inputs -- confirmed live, including a successful Move to the stale
    // date while the form showed a different one. Every one of those
    // inputs' own onChange now also calls bumpRequestGeneration().
    bumpRequestGeneration();
    const myRequestGeneration = requestGenerationRef.current;
    try {
      const selection = resolveActivitySelection(checkTaskTitle);
      const candidateStart = localDateTimeToUTC(checkDate, checkStartTime, timezone || 'UTC').toISOString();
      const next = await onTimingSearch({
        mode: 'CHECK',
        ...selection,
        durationMinutes: checkDurationMinutes,
        candidateStart,
      });
      if (myRequestGeneration !== requestGenerationRef.current) return;
      setCheckResult(next);
      setSavingOpportunityKey(null);
      setPlannedOpportunityKeys(new Set());
      triggerHaptic('success');
    } catch {
      if (myRequestGeneration !== requestGenerationRef.current) return;
      setCheckError('Aura could not check that time. Double check the date and time and try again.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleCompareTimes = async () => {
    if (!compareTaskTitle.trim() || !compareADate || !compareAStartTime || !compareBDate || !compareBStartTime) return;
    setIsComparing(true);
    setCompareError('');
    try {
      const selection = resolveActivitySelection(compareTaskTitle);
      const candidateStarts = [
        localDateTimeToUTC(compareADate, compareAStartTime, timezone || 'UTC').toISOString(),
        localDateTimeToUTC(compareBDate, compareBStartTime, timezone || 'UTC').toISOString(),
      ];
      const next = await onTimingSearch({
        mode: 'COMPARE',
        ...selection,
        durationMinutes: compareDurationMinutes,
        candidateStarts,
      });
      setCompareResult(next);
      setSavingOpportunityKey(null);
      setPlannedOpportunityKeys(new Set());
      triggerHaptic('success');
    } catch {
      setCompareError('Aura could not compare those times. Double check both dates and times and try again.');
    } finally {
      setIsComparing(false);
    }
  };

  const handleVoiceInput = () => {
    if (typeof window === 'undefined' || isListening) return;
    const SpeechRecognition = (
      (window as typeof window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      }).SpeechRecognition ||
      (window as typeof window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      }).webkitSpeechRecognition
    );

    if (!SpeechRecognition) {
      setError('Voice input is not available in this browser. Type the activity instead.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    setError('');
    setSchedulingConflict(null);
    setIsListening(true);

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      setTaskTitle(transcript);
      setIsCustomTask(true);
      setPrefillActivityId(undefined); // HPG1 -- free-text voice input, never a validated id
      clearGoalActivitySelection(); // HPG2 -- same reasoning
      setTimePreference(recommendedPreference(transcript));
      setFindResult(null);
      bumpRequestGeneration();
    };
    recognition.onerror = () => {
      setError('Aura could not hear that clearly. Try typing the activity.');
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognition.start();
  };

  const handleMyPlansClick = () => {
    setShowAllPlans(true);
    // A manual "My Plans" click always shows the real, full list -- a
    // filter left over from an earlier Insights CTA jump must not
    // silently persist past the user's own explicit navigation.
    setPlansFilter(null);
    requestAnimationFrame(() => {
      plansSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const saveOpportunity = async (key: string, plan: UpcomingPlan, activityId?: string | null) => {
    if (savingOpportunityKey || plannedOpportunityKeys.has(key)) return;
    setSavingOpportunityKey(key);
    try {
      const saved = await handleSavePlan(plan, activityId);
      setPlannedOpportunityKeys((prev) => new Set(prev).add(key));
      setPlannedActivityIdByKey((prev) => ({ ...prev, [key]: saved.id }));
    } catch {
      // handleSavePlan() already surfaced this via the `error` state -- leave
      // the opportunity unmarked (not planned) so the user can retry.
    } finally {
      setSavingOpportunityKey(null);
    }
  };

  // DR4-F2B blocking-fix -- an INDEPENDENT guard at the SAVE boundary
  // itself, not just at the fetch-response boundary (the fix brief's own
  // section 3: "Do not rely solely on hiding stale assessment cards").
  // handleCheckTime's generation guard already ensures checkResult can
  // never be SET to a stale value once the user changes an input -- this
  // additionally recomputes, at the moment "Use this time" is actually
  // clicked, the exact instant checkDate/checkStartTime currently
  // represent, and refuses to save a requestedCandidate whose own .start
  // doesn't match it precisely. Two independent layers (never set stale +
  // never save mismatched) so Move can never be invoked for anything
  // other than the CURRENTLY confirmed destination. betterNearby is
  // intentionally NOT held to this same exact-match check -- it is, by
  // design, a genuinely different instant than checkDate/checkStartTime --
  // but is equally protected by handleCheckTime's generation guard, which
  // is what determines whether checkResult (and therefore betterNearby)
  // exists at all.
  const handleUseCheckedRequestedTime = () => {
    const candidate = checkResult?.requestedCandidate;
    if (!candidate) return;
    const expectedStart = localDateTimeToUTC(checkDate, checkStartTime, timezone || 'UTC').toISOString();
    if (candidate.start !== expectedStart) {
      setCheckResult(null);
      setCheckError('This assessment no longer matches the selected date and time. Check this time again before saving.');
      return;
    }
    void saveOpportunity(findCandidateKey(candidate), planPayloadFromCandidate(candidate, checkDurationMinutes), resolveActivitySelection(checkTaskTitle).activityId);
  };

  // DR4-F2B blocking-fix -- FIND's equivalent save-boundary guard (section
  // 4). FIND has no user-typed "expected instant" to recompute against the
  // way CHECK does -- its candidates ARE the search results -- so instead
  // this independently re-confirms, at the moment "Use this time" is
  // clicked, that the candidate being saved is still one of the CURRENT
  // findResult's own candidates. Combined with handleFindTime's generation
  // guard (which already guarantees findResult can never be SET to a stale
  // response) and the existing setFindResult(null) calls on every relevant
  // input change, this closes the same loop as CHECK's guard without
  // introducing any new timing calculation.
  const handleUseFoundCandidate = (candidate: TimingCandidate) => {
    const stillCurrent = findResult?.candidates.some((entry) => entry.start === candidate.start && entry.end === candidate.end) ?? false;
    if (!stillCurrent) {
      setFindResult(null);
      setError('This result no longer matches your current search. Find a time again before saving.');
      return;
    }
    void saveOpportunity(findCandidateKey(candidate), planPayloadFromCandidate(candidate, durationMinutes), resolvedActivityDefinition?.id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 17, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <PageHeader
        title={<>Plan with Aura ✨</>}
        subtitle={<>Tell Aura what you want to do.<br />We&apos;ll find your best moments.</>}
        rightAction={
          <SecondaryButton onClick={handleMyPlansClick} style={{ minHeight: 40 }}>
            <span style={{ fontSize: 15 }}>☷</span> My Plans
          </SecondaryButton>
        }
      />

      {/* DR4-F2A found switching to Check a Time/Compare mid-reschedule left
       * the user on an unrelated, stale result from an earlier search (the
       * composer's own title/duration locking only ever covered FIND), and
       * fixed it by locking the mode switcher to FIND alone for the
       * duration of a reschedule. DR4-F2B gives CHECK its own
       * reschedule-aware prefill (handleReschedulePlan, above) and Move
       * never cared what's typed in CHECK's own fields either way (it only
       * ever reads the locked duration and the ORIGINAL plan id) -- so the
       * switcher can now safely offer CHECK as a second, genuine choice.
       * COMPARE stays excluded (AURA_DR4_F2_TIMING_CHOICE_UX_AUDIT.md
       * section 9 / DR4-F2B brief section 3: "COMPARE does not need to
       * become reschedule-aware in this PR") -- simply never one of the
       * two options offered here, not merely left disabled. */}
      <SegmentedControl
        options={reschedulingPlanId ? RESCHEDULE_MODES.map((mode) => ({ value: mode.value, label: mode.label })) : PLAN_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
        value={planMode}
        onChange={(mode) => {
          // DR4-F2B blocking-fix -- a mode change invalidates any
          // in-flight FIND/CHECK request: its response, whichever mode it
          // belonged to, must not land once the user has moved elsewhere.
          bumpRequestGeneration();
          setPlanMode(mode);
        }}
      />
      <div style={{ ...typography.meta, marginTop: -8 }}>
        {reschedulingPlanId ? RESCHEDULE_MODES.find((mode) => mode.value === planMode)?.helper : PLAN_MODES.find((mode) => mode.value === planMode)?.helper}
      </div>

      {planMode === 'FIND' && (
      <>
      <section style={panelStyle}>
        <SectionTitle number={1} label="What do you want to do?" />
        {reschedulingPlanId && (
          <div style={rescheduleNoticeStyle}>
            {/* DR4-F1 -- now accurate: choosing a time below moves this
             * plan (via the same Move Home already uses) rather than
             * replacing it with an unrelated new one. Its title and any
             * goal link are kept. */}
            Rescheduling this plan. Choosing a time below will move it there — its title and any goal link stay the same.
          </div>
        )}
        <div style={inputShellStyle}>
          <span style={{ fontSize: 21, color: '#7dd3fc' }}>✦</span>
          <input
            value={taskTitle}
            onChange={(event) => {
              setTaskTitle(event.target.value);
              setIsCustomTask(true);
              setPrefillActivityId(undefined); // HPG1 -- free-text typing, never a validated id
              clearGoalActivitySelection(); // HPG2 -- same reasoning
              setFindResult(null);
              bumpRequestGeneration();
            }}
            placeholder="e.g. Workout, Deep work, Study, Date night..."
            style={inputStyle}
          />
          <button
            type="button"
            onClick={handleVoiceInput}
            aria-label={isListening ? 'Listening for activity' : 'Voice input'}
            style={{
              ...voiceButtonStyle,
              borderColor: isListening ? 'rgba(74, 222, 128, 0.55)' : voiceButtonStyle.borderColor,
              color: isListening ? '#4ade80' : voiceButtonStyle.color,
            }}
          >
            {isListening ? '●' : '🎙'}
          </button>
        </div>
        <div style={{ marginTop: 17, color: '#aab7d2', fontSize: 13 }}>Popular</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 12 }}>
          {filteredTasks.map((task) => (
            <ActivityChip
              key={task.title}
              task={task}
              active={taskTitle.toLowerCase() === task.title.toLowerCase()}
              onClick={() => {
                setTaskTitle(task.title);
                setIsCustomTask(false);
                // HPG1 -- chips carry no id of their own (TaskSuggestion has
                // none); resolveActivitySelection's own exact-title match
                // against FULL_ACTIVITY_CATALOG already resolves these
                // correctly today (titles are deliberately kept identical),
                // so this just defers to that existing, unchanged path.
                setPrefillActivityId(undefined);
                clearGoalActivitySelection(); // HPG2 -- a chip pick is not an explicit Goal selection
                if (task.defaultDurationMinutes) setDurationMinutes(task.defaultDurationMinutes);
                setTimePreference(recommendedPreference(task.title));
                setFindResult(null);
                bumpRequestGeneration();
              }}
            />
          ))}
          <button
            type="button"
            onClick={() => setShowMoreActivities((value) => !value)}
            style={{
              ...moreChipStyle,
              borderColor: showMoreActivities ? 'rgba(74, 222, 128, 0.45)' : 'rgba(148, 163, 184, 0.28)',
              color: showMoreActivities ? '#4ade80' : moreChipStyle.color,
            }}
          >
            {showMoreActivities ? 'Show less' : '••• More'}
          </button>
        </div>
      </section>

      {/* HPG2 -- explicit Goal-activity linkage. Selection only, never
          inferred from taskTitle's text (see selectGoalActivity's own doc
          comment). Reuses the EXISTING GET /api/goals and
          GET /api/goals/:goalId endpoints unmodified; the actual link is
          persisted server-side, inside POST /api/plans's own transaction,
          by the SAME linkGoalActivityToPlannedActivity Day Constructor
          acceptance already relies on. */}
      <section style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 9 }}>
          <div style={{ color: '#aab7d2', fontSize: 13 }}>Goal</div>
          {selectedGoalActivityId ? (
            <button
              type="button"
              onClick={() => {
                clearGoalActivitySelection();
                setSelectedGoalId('');
              }}
              style={{ ...moreChipStyle, borderColor: 'rgba(248, 113, 113, 0.4)', color: '#f87171' }}
            >
              Unlink
            </button>
          ) : (
            !showGoalLinker && (
              <button type="button" onClick={() => setShowGoalLinker(true)} style={moreChipStyle}>
                + Link to a Goal
              </button>
            )
          )}
        </div>

        {selectedGoalActivityId && selectedGoalActivityTitle && (
          <p style={{ fontSize: 12, color: '#4ade80', marginTop: 10, lineHeight: 1.5 }}>
            Linked to &ldquo;{selectedGoalActivityTitle}&rdquo; -- completing this plan will count toward that goal.
          </p>
        )}

        {showGoalLinker && !selectedGoalActivityId && (
          <>
            {loadingGoals && <span style={{ fontSize: 12, color: '#94a3b8' }}>Loading your goals…</span>}
            {goalOptions && goalOptions.length === 0 && (
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10, lineHeight: 1.5 }}>You don&apos;t have any active goals yet.</p>
            )}
            {goalOptions && goalOptions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 12 }}>
                {goalOptions.map((goal) => (
                  <PersonPickerChip key={goal.id} label={goal.title} active={selectedGoalId === goal.id} onClick={() => setSelectedGoalId(goal.id)} />
                ))}
              </div>
            )}
            {selectedGoalId && (
              <div style={{ marginTop: 12 }}>
                {loadingGoalActivities && <span style={{ fontSize: 12, color: '#94a3b8' }}>Loading activities…</span>}
                {goalActivityOptions && goalActivityOptions.length === 0 && (
                  <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>No activities under this goal are available to link right now.</p>
                )}
                {goalActivityOptions && goalActivityOptions.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
                    {goalActivityOptions.map((activity) => (
                      <PersonPickerChip key={activity.id} label={activity.title} active={false} onClick={() => selectGoalActivity(activity)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {showPersonPicker && (
        <section style={panelStyle}>
          <div style={{ color: '#aab7d2', fontSize: 13 }}>Who&apos;s this with?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 12 }}>
            <PersonPickerChip label="Just me" active={!selectedPersonId} onClick={() => { setSelectedPersonId(''); setFindResult(null); setSharedFindResult(null); bumpRequestGeneration(); }} />
            {loadingPeople && savedPeople === null && <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>Loading…</span>}
            {savedPeople?.map((person) => (
              <PersonPickerChip
                key={person.id}
                label={`${RELATIONSHIP_ICON[person.relationshipType]} ${person.name}`}
                active={selectedPersonId === person.id}
                onClick={() => { setSelectedPersonId(person.id); setFindResult(null); setSharedFindResult(null); bumpRequestGeneration(); }}
              />
            ))}
            <button type="button" onClick={onOpenPeople} style={moreChipStyle}>
              + Choose someone
            </button>
          </div>
          {savedPeople && savedPeople.length === 0 && (
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10, lineHeight: 1.5 }}>
              Add someone to find timings that work well for both of you.
            </p>
          )}
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <SelectPanel
          number={2}
          icon="🗓"
          label="When?"
          value={selectedHorizon.label}
          helper={horizonHelper}
          options={HORIZONS}
          selectedValue={horizon}
          onChange={(value) => { setHorizon(value as PlanningHorizon); bumpRequestGeneration(); }}
        />
        <SelectPanel
          number={3}
          icon="🕒"
          label="How long?"
          value={selectedDuration.label}
          // DR4-F1 -- while rescheduling an existing plan, duration is
          // locked to the original's own (Move always inherits
          // durationMinutes from the plan being moved, never from this
          // search -- see handleReschedulePlanViaMove's own doc comment).
          // Locking the selector keeps what's shown here honest about
          // what will actually be saved, rather than letting the user
          // pick a duration Move would silently ignore.
          helper={reschedulingPlanId ? 'Kept from the original plan while rescheduling' : selectedDuration.helper}
          options={durationSelectOptions(durationMinutes)}
          selectedValue={durationMinutes}
          onChange={(value) => { setDurationMinutes(Number(value)); bumpRequestGeneration(); }}
          disabled={Boolean(reschedulingPlanId)}
        />
      </div>

      {horizon === 'CUSTOM' && (
        <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={dateLabelStyle}>
            Start
            <input type="date" value={customStartDate} onChange={(event) => { setCustomStartDate(event.target.value); bumpRequestGeneration(); }} style={dateInputStyle} />
          </label>
          <label style={dateLabelStyle}>
            End
            <input type="date" value={customEndDate} min={customStartDate || undefined} onChange={(event) => { setCustomEndDate(event.target.value); bumpRequestGeneration(); }} style={dateInputStyle} />
          </label>
        </div>
      )}

      <section style={panelStyle}>
        <SectionTitle number={4} icon="🕒" label="Preferred time" />
        <div style={{ fontSize: 13, color: '#b6c2d1', marginTop: 10 }}>When would you like to do this?</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
          {TIME_PREFERENCES.map((item) => (
            <TimeTile key={item.value} item={item} active={timePreference === item.value} onClick={() => { setTimePreference(item.value); bumpRequestGeneration(); }} />
          ))}
        </div>
        <button type="button" disabled={!canSubmit || isLoading} onClick={handleFindTime} style={{ ...ctaStyle, opacity: canSubmit ? 1 : 0.55 }}>
          {isLoading ? 'Finding...' : '✦ Find My Best Time'}
        </button>
        <div style={{ color: '#dbe7f4', fontSize: 12, textAlign: 'center', marginTop: 13 }}>
          🛡 Aura finds options using today&apos;s Panchang + your patterns
        </div>
        {error && <div role="alert" style={{ color: '#fb6b6b', fontSize: 12, marginTop: 10, lineHeight: 1.35 }}>{error}</div>}
        {/* HPG3-A3b -- the dedicated scheduling-eligibility banner (never
            rendered at the same time as the generic `error` div above --
            see the `schedulingConflict`/`error` state's own doc comment
            for why they're mutually exclusive). "View your plans" is
            offered ONLY for a genuine conflict (severity === 'conflict':
            CAPACITY_EXCEEDED/DAILY_CAPACITY_EXCEEDED/DAILY_ATTRIBUTION_UNRESOLVED)
            -- never for the two 'blocked' codes, which have no "existing
            session" concept at all. It reuses `handleMyPlansClick`
            UNCHANGED (the same real, already-wired action the "My Plans"
            tab button already calls) rather than fabricating any new
            navigation or claiming to jump to the specific conflicting
            session, which no existing route can safely resolve (see this
            ticket's delivery report). */}
        {schedulingConflict && (
          <div role="alert" style={{ marginTop: 10, padding: 12, borderRadius: 10, border: '1px solid rgba(251,107,107,0.35)', background: 'rgba(251,107,107,0.08)' }}>
            <div style={{ color: '#fb6b6b', fontSize: 13, fontWeight: 700 }}>{schedulingConflict.headline}</div>
            <div style={{ color: '#dbe7f4', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{schedulingConflict.detail}</div>
            {schedulingConflict.severity === 'conflict' && (
              <div style={{ marginTop: 10 }}>
                <SecondaryButton onClick={handleMyPlansClick} style={{ minHeight: 36 }}>
                  View your plans
                </SecondaryButton>
              </div>
            )}
          </div>
        )}
      </section>

      {findResult && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeader label="Aura's Best Moments" actionLabel={onViewDay ? 'View my day' : undefined} onAction={onViewDay} />
          {findResult.candidates.length === 0 && (
            <div style={emptyPlansStyle}>Aura could not find a usable time for this request. Try a shorter duration, a wider date range, or a different preferred time.</div>
          )}
          {findResult.candidates[0] && (
            <TimingResultCard
              kicker="BEST MATCH"
              candidate={findResult.candidates[0]}
              activityTitle={findResult.candidates[0].metadata.activityType}
              durationMinutes={durationMinutes}
              timezone={timezone || 'UTC'}
              isSaving={savingOpportunityKey === findCandidateKey(findResult.candidates[0])}
              isPlanned={plannedOpportunityKeys.has(findCandidateKey(findResult.candidates[0]))}
              onPlan={() => handleUseFoundCandidate(findResult.candidates[0])}
              onMakeMoment={resolvedActivityDefinition?.experience.momentEligible ? () => handleMakeMoment(findCandidateKey(findResult.candidates[0]), { activityId: resolvedActivityDefinition.id, start: findResult.candidates[0].start, end: findResult.candidates[0].end, ratingLabel: findResult.candidates[0].label }) : undefined}
              isMomentSaving={momentSavingKey === findCandidateKey(findResult.candidates[0])}
              isMomentSaved={momentSavedKeys.has(findCandidateKey(findResult.candidates[0]))}
              onShareMoment={resolvedActivityDefinition ? () => handleShareSavedMoment(findCandidateKey(findResult.candidates[0]), 'PERSONAL', resolvedActivityDefinition.id) : undefined}
              isSharingMoment={sharingMomentKey === findCandidateKey(findResult.candidates[0])}
              shareFeedback={momentShareFeedback?.key === findCandidateKey(findResult.candidates[0]) ? momentShareFeedback.text : null}
              dailyRhythmNote={findResult.dailyRhythmNotes?.[findResult.candidates[0].start]}
            />
          )}
          {findResult.candidates.length > 1 && (
            <>
              <SectionHeader label="Other Good Options" />
              {findResult.candidates.slice(1).map((candidate) => (
                <TimingResultCard
                  key={findCandidateKey(candidate)}
                  kicker="OTHER OPTION"
                  candidate={candidate}
                  activityTitle={candidate.metadata.activityType}
                  durationMinutes={durationMinutes}
                  timezone={timezone || 'UTC'}
                  isSaving={savingOpportunityKey === findCandidateKey(candidate)}
                  isPlanned={plannedOpportunityKeys.has(findCandidateKey(candidate))}
                  onPlan={() => handleUseFoundCandidate(candidate)}
                  onMakeMoment={resolvedActivityDefinition?.experience.momentEligible ? () => handleMakeMoment(findCandidateKey(candidate), { activityId: resolvedActivityDefinition.id, start: candidate.start, end: candidate.end, ratingLabel: candidate.label }) : undefined}
                  isMomentSaving={momentSavingKey === findCandidateKey(candidate)}
                  isMomentSaved={momentSavedKeys.has(findCandidateKey(candidate))}
                  onShareMoment={resolvedActivityDefinition ? () => handleShareSavedMoment(findCandidateKey(candidate), 'PERSONAL', resolvedActivityDefinition.id) : undefined}
                  isSharingMoment={sharingMomentKey === findCandidateKey(candidate)}
                  shareFeedback={momentShareFeedback?.key === findCandidateKey(candidate) ? momentShareFeedback.text : null}
                  dailyRhythmNote={findResult.dailyRhythmNotes?.[candidate.start]}
                />
              ))}
            </>
          )}
        </section>
      )}

      {sharedFindResult && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeader label="Best For You Two" />
          {sharedFindResult.length === 0 && (
            <div style={emptyPlansStyle}>Aura could not find a shared time for this request. Try a shorter duration or a wider date range.</div>
          )}
          {sharedFindResult.map((candidate, index) => {
            const key = `${candidate.start}-${candidate.end}`;
            return (
              <EverydaySharedResultCard
                key={key}
                kicker={index === 0 ? 'BEST FOR YOU TWO' : 'OTHER OPTION'}
                activityTitle={resolvedActivityDefinition ? FULL_ACTIVITY_CATALOG.find((a) => a.id === resolvedActivityDefinition.id)?.title ?? taskTitle : taskTitle}
                candidate={candidate}
                durationMinutes={durationMinutes}
                timezone={timezone || 'UTC'}
                isMomentSaving={momentSavingKey === key}
                isMomentSaved={momentSavedKeys.has(key)}
                onMakeMoment={() => resolvedActivityDefinition && handleMakeMoment(key, { activityId: resolvedActivityDefinition.id, start: candidate.start, end: candidate.end, ratingLabel: candidate.rating, savedPersonId: selectedPersonId })}
                onShareMoment={resolvedActivityDefinition ? () => handleShareSavedMoment(key, 'SHARED', resolvedActivityDefinition.id) : undefined}
                isSharingMoment={sharingMomentKey === key}
                shareFeedback={momentShareFeedback?.key === key ? momentShareFeedback.text : null}
              />
            );
          })}
        </section>
      )}
      </>
      )}

      {planMode === 'CHECK' && (
        <>
          <section style={panelStyle}>
            <SectionTitle number={1} label="Activity" />
            {reschedulingPlanId && (
              <div style={rescheduleNoticeStyle}>
                {/* DR4-F2B -- the date/time below are prefilled from the
                 * original plan (handleReschedulePlan); saving moves it
                 * there via the same Move FIND's own "Use this time"
                 * already uses. Its title and any goal link stay the same
                 * regardless of what's typed above. */}
                Rescheduling this plan. Date and time are prefilled from the original — saving will move it there. Its title and any goal link stay the same.
              </div>
            )}
            <div style={inputShellStyle}>
              <span style={{ fontSize: 21, color: '#7dd3fc' }}>✦</span>
              <input
                value={checkTaskTitle}
                onChange={(event) => { setCheckTaskTitle(event.target.value); setCheckResult(null); bumpRequestGeneration(); }}
                placeholder="e.g. Important meeting"
                style={inputStyle}
              />
            </div>
          </section>

          <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={dateLabelStyle}>
              Date
              {/* DR4-F2B blocking-fix -- setCheckResult(null) alone only
               * hides a stale card; it does NOT stop an already-in-flight
               * request for the OLD date from later reapplying itself.
               * bumpRequestGeneration() is what actually invalidates it
               * (see handleCheckTime's own guard). */}
              <input type="date" value={checkDate} onChange={(event) => { setCheckDate(event.target.value); setCheckResult(null); bumpRequestGeneration(); }} style={dateInputStyle} />
            </label>
            <label style={dateLabelStyle}>
              Start time
              <input type="time" value={checkStartTime} onChange={(event) => { setCheckStartTime(event.target.value); setCheckResult(null); bumpRequestGeneration(); }} style={dateInputStyle} />
            </label>
          </div>

          <SelectPanel
            number={2}
            icon="🕒"
            label="How long?"
            value={DURATIONS.find((item) => item.value === checkDurationMinutes)?.label ?? `${checkDurationMinutes} min`}
            helper={reschedulingPlanId ? 'Kept from the original plan while rescheduling' : 'Duration to check'}
            options={durationSelectOptions(checkDurationMinutes)}
            selectedValue={checkDurationMinutes}
            onChange={(value) => { setCheckDurationMinutes(Number(value)); setCheckResult(null); bumpRequestGeneration(); }}
            disabled={Boolean(reschedulingPlanId)}
          />

          <section style={panelStyle}>
            <button
              type="button"
              disabled={!checkTaskTitle.trim() || !checkDate || !checkStartTime || isChecking}
              onClick={handleCheckTime}
              style={{ ...ctaStyle, marginTop: 0, opacity: checkTaskTitle.trim() && checkDate && checkStartTime ? 1 : 0.55 }}
            >
              {isChecking ? 'Checking...' : '✦ Check This Time'}
            </button>
            {checkError && <div style={{ color: '#fb6b6b', fontSize: 12, marginTop: 10, lineHeight: 1.35 }}>{checkError}</div>}
          </section>

          {checkResult?.requestedCandidate && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SectionHeader label="Your Requested Time" />
              <TimingResultCard
                kicker="REQUESTED TIME"
                candidate={checkResult.requestedCandidate}
                activityTitle={checkResult.requestedCandidate.metadata.activityType}
                durationMinutes={checkDurationMinutes}
                timezone={timezone || 'UTC'}
                isSaving={savingOpportunityKey === findCandidateKey(checkResult.requestedCandidate)}
                isPlanned={plannedOpportunityKeys.has(findCandidateKey(checkResult.requestedCandidate))}
                onPlan={handleUseCheckedRequestedTime}
                dailyRhythmNote={checkResult.dailyRhythmNotes?.[checkResult.requestedCandidate.start]}
              />
              {checkResult.betterNearby && (
                <>
                  <SectionHeader label="Better Nearby" />
                  <TimingResultCard
                    kicker="BETTER NEARBY"
                    candidate={checkResult.betterNearby}
                    activityTitle={checkResult.betterNearby.metadata.activityType}
                    durationMinutes={checkDurationMinutes}
                    timezone={timezone || 'UTC'}
                    planCtaLabel="Use better time"
                    isSaving={savingOpportunityKey === findCandidateKey(checkResult.betterNearby)}
                    isPlanned={plannedOpportunityKeys.has(findCandidateKey(checkResult.betterNearby))}
                    onPlan={() => saveOpportunity(findCandidateKey(checkResult.betterNearby!), planPayloadFromCandidate(checkResult.betterNearby!, checkDurationMinutes), resolveActivitySelection(checkTaskTitle).activityId)}
                  />
                </>
              )}
            </section>
          )}
        </>
      )}

      {planMode === 'COMPARE' && (
        <>
          <section style={panelStyle}>
            <SectionTitle number={1} label="Activity" />
            <div style={inputShellStyle}>
              <span style={{ fontSize: 21, color: '#7dd3fc' }}>✦</span>
              <input
                value={compareTaskTitle}
                onChange={(event) => { setCompareTaskTitle(event.target.value); setCompareResult(null); }}
                placeholder="e.g. Dinner date"
                style={inputStyle}
              />
            </div>
          </section>

          <SelectPanel
            number={2}
            icon="🕒"
            label="How long?"
            value={DURATIONS.find((item) => item.value === compareDurationMinutes)?.label ?? `${compareDurationMinutes} min`}
            helper={reschedulingPlanId ? 'Kept from the original plan while rescheduling' : 'Duration for both options'}
            options={durationSelectOptions(compareDurationMinutes)}
            selectedValue={compareDurationMinutes}
            onChange={(value) => { setCompareDurationMinutes(Number(value)); setCompareResult(null); }}
            disabled={Boolean(reschedulingPlanId)}
          />

          <section style={panelStyle}>
            <SectionTitle number={3} label="Option A" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <label style={dateLabelStyle}>
                Date
                <input type="date" value={compareADate} onChange={(event) => { setCompareADate(event.target.value); setCompareResult(null); }} style={dateInputStyle} />
              </label>
              <label style={dateLabelStyle}>
                Start time
                <input type="time" value={compareAStartTime} onChange={(event) => { setCompareAStartTime(event.target.value); setCompareResult(null); }} style={dateInputStyle} />
              </label>
            </div>
          </section>

          <section style={panelStyle}>
            <SectionTitle number={4} label="Option B" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <label style={dateLabelStyle}>
                Date
                <input type="date" value={compareBDate} onChange={(event) => { setCompareBDate(event.target.value); setCompareResult(null); }} style={dateInputStyle} />
              </label>
              <label style={dateLabelStyle}>
                Start time
                <input type="time" value={compareBStartTime} onChange={(event) => { setCompareBStartTime(event.target.value); setCompareResult(null); }} style={dateInputStyle} />
              </label>
            </div>
          </section>

          <section style={panelStyle}>
            <button
              type="button"
              disabled={!compareTaskTitle.trim() || !compareADate || !compareAStartTime || !compareBDate || !compareBStartTime || isComparing}
              onClick={handleCompareTimes}
              style={{ ...ctaStyle, marginTop: 0, opacity: compareTaskTitle.trim() && compareADate && compareAStartTime && compareBDate && compareBStartTime ? 1 : 0.55 }}
            >
              {isComparing ? 'Comparing...' : '✦ Compare Times'}
            </button>
            {compareError && <div style={{ color: '#fb6b6b', fontSize: 12, marginTop: 10, lineHeight: 1.35 }}>{compareError}</div>}
          </section>

          {compareResult && compareResult.candidates.length >= 2 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SectionHeader label="Recommended" />
              <TimingResultCard
                kicker="RECOMMENDED"
                candidate={compareResult.candidates[0]}
                activityTitle={compareResult.candidates[0].metadata.activityType}
                durationMinutes={compareDurationMinutes}
                timezone={timezone || 'UTC'}
                isSaving={savingOpportunityKey === findCandidateKey(compareResult.candidates[0])}
                isPlanned={plannedOpportunityKeys.has(findCandidateKey(compareResult.candidates[0]))}
                onPlan={() => saveOpportunity(findCandidateKey(compareResult.candidates[0]), planPayloadFromCandidate(compareResult.candidates[0], compareDurationMinutes), resolveActivitySelection(compareTaskTitle).activityId)}
                dailyRhythmNote={compareResult.dailyRhythmNotes?.[compareResult.candidates[0].start]}
              />
              <SectionHeader label="Compared With" />
              {compareResult.candidates.slice(1).map((candidate) => (
                <TimingResultCard
                  key={findCandidateKey(candidate)}
                  kicker="COMPARED WITH"
                  candidate={candidate}
                  activityTitle={candidate.metadata.activityType}
                  durationMinutes={compareDurationMinutes}
                  timezone={timezone || 'UTC'}
                  isSaving={savingOpportunityKey === findCandidateKey(candidate)}
                  isPlanned={plannedOpportunityKeys.has(findCandidateKey(candidate))}
                  onPlan={() => saveOpportunity(findCandidateKey(candidate), planPayloadFromCandidate(candidate, compareDurationMinutes), resolveActivitySelection(compareTaskTitle).activityId)}
                  dailyRhythmNote={compareResult.dailyRhythmNotes?.[candidate.start]}
                />
              ))}
            </section>
          )}
        </>
      )}

      <section ref={plansSectionRef} style={{ display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 18 }}>
        <SectionHeader
          label="Upcoming Plans"
          actionLabel={showAllPlans ? 'Show less' : 'View all'}
          onAction={() => setShowAllPlans((value) => !value)}
        />
        {visibleUpcomingPlans.length > 0 ? visibleUpcomingPlans.map((plan) => (
          <UpcomingPlan
            key={plan.id}
            plan={plan}
            expanded={expandedPlanId === plan.id}
            actionState={planActionStates[plan.id]}
            onToggle={() => setExpandedPlanId((id) => id === plan.id ? null : plan.id)}
            onReschedule={() => handleReschedulePlan(plan)}
            onLog={() => handleLogPlan(plan)}
            confirmingRemove={confirmingRemovePlanId === plan.id}
            onRequestRemove={() => setConfirmingRemovePlanId(plan.id)}
            onCancelRemove={() => setConfirmingRemovePlanId(null)}
            onConfirmRemove={() => handleCancelPlan(plan)}
          />
        )) : (
          <EmptyState
            title="Nothing planned yet."
            description="Choose an activity above and tap Find My Best Time to create one."
            action={
              <SecondaryButton onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Find a time</SecondaryButton>
            }
          />
        )}
      </section>

      {/* DR4-E2 (Missed Activity Presentation) -- a compact, clearly-labeled
       * group immediately after Upcoming Plans for persisted-UPCOMING plans
       * whose scheduled end has elapsed (the missedPlans collection DR4-E1
       * already derives and sorts most-recently-missed-first). Section 2:
       * no section at all when there are none -- never a redundant empty
       * card -- except while an Insights "awaiting confirmation" deep link
       * is active, which keeps its own existing empty state/escape hatch. */}
      {(missedPlans.length > 0 || plansFilter === 'AWAITING_CONFIRMATION') && (
        <section ref={missedSectionRef} style={{ display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 18 }}>
          <SectionHeader
            label="Missed Activities"
            actionLabel={missedPlans.length > 2 ? (showAllMissed ? 'Show less' : 'View all missed activities') : undefined}
            onAction={() => setShowAllMissed((value) => !value)}
          />
          {missedPlans.length >= 2 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              <TextButton
                onClick={() => void handleSkipAllMissed()}
                disabled={skipAllMissedBusy}
                ariaLabel="Skip all missed activities"
                color={colors.textSecondary}
                style={{ minHeight: 44, padding: '0 8px' }}
              >
                {skipAllMissedBusy ? 'Skipping…' : 'Skip all missed'}
              </TextButton>
              {skipAllMissedNotice && (
                <span role="status" style={{ ...typography.meta, color: colors.textMuted }}>
                  {skipAllMissedNotice.failed === 0
                    ? `Skipped ${skipAllMissedNotice.succeeded} missed ${skipAllMissedNotice.succeeded === 1 ? 'activity' : 'activities'}.`
                    : skipAllMissedNotice.succeeded === 0
                      ? "Couldn't skip those. Try again."
                      : `Skipped ${skipAllMissedNotice.succeeded} of ${skipAllMissedNotice.succeeded + skipAllMissedNotice.failed}.`}
                </span>
              )}
            </div>
          )}
          {/* Insights V1 PR7 (finding F-4) -- unchanged banner, now scoped to
           * the Missed section it actually describes. */}
          {plansFilter === 'AWAITING_CONFIRMATION' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, ...typography.meta }}>
              <span>Showing plans awaiting confirmation</span>
              <TextButton onClick={() => setPlansFilter(null)} color={colors.textSecondary}>Show all</TextButton>
            </div>
          )}
          {visibleMissedPlans.length > 0 ? visibleMissedPlans.map((plan) => (
            <MissedActivityCard
              key={plan.id}
              plan={plan}
              actionState={planActionStates[plan.id]}
              onLog={() => handleLogPlan(plan)}
              onReschedule={() => handleReschedulePlan(plan)}
              onSkip={() => handleSkipPlan(plan)}
            />
          )) : (
            <EmptyState
              title="Nothing awaiting confirmation."
              description="Everything's confirmed, or the plan this suggestion pointed at has since been resolved."
              action={<SecondaryButton onClick={() => setPlansFilter(null)}>Show all plans</SecondaryButton>}
            />
          )}
        </section>
      )}

      {showAllPlans && visibleCompletedPlans.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeader label="Recently Completed" />
          {visibleCompletedPlans.map((plan) => (
            <UpcomingPlan
              key={plan.id}
              plan={plan}
              expanded={expandedPlanId === plan.id}
              actionState={planActionStates[plan.id]}
              onToggle={() => setExpandedPlanId((id) => id === plan.id ? null : plan.id)}
              onReschedule={() => handleReschedulePlan(plan)}
              onLog={() => handleLogPlan(plan)}
              confirmingRemove={confirmingRemovePlanId === plan.id}
              onRequestRemove={() => setConfirmingRemovePlanId(plan.id)}
              onCancelRemove={() => setConfirmingRemovePlanId(null)}
              onConfirmRemove={() => handleCancelPlan(plan)}
            />
          ))}
        </section>
      )}

      {/* Product Structure V2 (brief section 19): "Your Moments" becomes a
       * primary Plan surface. Reuses SharedMomentsView as-is (embedded
       * mode), never a second implementation. */}
      <div ref={momentsSectionRef} style={{ scrollMarginTop: 18 }}>
        <SharedMomentsView embedded onSeen={onMomentSeen} focusMomentToken={focusMomentToken} />
      </div>
    </div>
  );
}

function SectionTitle({ number, label, icon }: { number: number; label: string; icon?: string }) {
  return (
    <div style={{ color: '#4ade80', fontSize: 12, fontFamily: 'var(--as-font-mono)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {icon ? `${icon} ` : ''}{number}. {label}
    </div>
  );
}

function SectionHeader({ label, actionLabel, onAction }: { label: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <h2 style={{ margin: 0, color: '#aab7d2', fontFamily: 'var(--as-font-mono)', fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </h2>
      {actionLabel && (
        <button type="button" onClick={onAction} style={{ border: 'none', background: 'transparent', color: '#4ade80', fontSize: 14, fontWeight: 850, cursor: onAction ? 'pointer' : 'default' }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function PersonPickerChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? '#4ade80' : 'rgba(148, 163, 184, 0.28)'}`,
        background: active ? 'rgba(74, 222, 128, 0.16)' : 'rgba(2, 6, 23, 0.35)',
        color: active ? '#4ade80' : '#dbe7f4',
        borderRadius: 999,
        padding: '9px 14px',
        fontSize: 12,
        fontWeight: 850,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function ActivityChip({ task, active, onClick }: { task: TaskSuggestion; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? task.accent : `${task.accent}55`}`,
        background: active ? `${task.accent}22` : 'rgba(2, 6, 23, 0.35)',
        color: active ? '#f8fafc' : '#dbe7f4',
        borderRadius: 999,
        padding: '9px 12px',
        fontSize: 12,
        fontWeight: 850,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: task.accent, marginRight: 5 }}>{task.icon}</span>{task.title}
    </button>
  );
}

function SelectPanel({
  number,
  icon,
  label,
  value,
  helper,
  options,
  selectedValue,
  onChange,
  disabled,
}: {
  number: number;
  icon: string;
  label: string;
  value: string;
  helper: string;
  options: Array<{ value: string | number; label: string }>;
  selectedValue: string | number;
  onChange: (value: string | number) => void;
  disabled?: boolean;
}) {
  return (
    <section style={{ ...panelStyle, padding: 14, minWidth: 0 }}>
      <SectionTitle number={number} icon={icon} label={label} />
      <div style={{ position: 'relative', marginTop: 13 }}>
        <select
          value={selectedValue}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          style={{
            width: '100%',
            minHeight: 51,
            appearance: 'none',
            border: '1px solid rgba(96, 165, 250, 0.25)',
            borderRadius: 10,
            background: 'rgba(2, 6, 23, 0.62)',
            color: disabled ? '#7a8699' : '#f8fafc',
            fontSize: 17,
            fontWeight: 850,
            padding: '0 36px 0 13px',
            outline: 'none',
            opacity: disabled ? 0.7 : 1,
            cursor: disabled ? 'default' : undefined,
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <span style={{ position: 'absolute', right: 14, top: 15, color: '#7dd3fc', pointerEvents: 'none', fontSize: 17 }}>⌄</span>
      </div>
      <div style={{ color: '#aab7d2', fontSize: 13, marginTop: 10 }}>{helper}</div>
    </section>
  );
}

function TimeTile({ item, active, onClick }: { item: typeof TIME_PREFERENCES[number]; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 76,
        minWidth: 0,
        border: `1px solid ${active ? '#4ade80' : 'rgba(148, 163, 184, 0.22)'}`,
        borderRadius: 14,
        background: active ? 'rgba(74, 222, 128, 0.1)' : 'rgba(2, 6, 23, 0.35)',
        color: active ? '#4ade80' : '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        cursor: 'pointer',
        padding: 6,
      }}
    >
      <span style={{ color: item.accent, fontSize: 25, lineHeight: 1 }}>{item.icon}</span>
      <span style={{ fontSize: 12, fontWeight: 850, lineHeight: 1.1 }}>{item.label}</span>
    </button>
  );
}

function UpcomingPlan({
  plan,
  expanded,
  actionState,
  onToggle,
  onReschedule,
  onLog,
  confirmingRemove,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  plan: UpcomingPlan;
  expanded: boolean;
  actionState?: PlanActionState;
  onToggle: () => void;
  onReschedule: () => void;
  onLog: () => void;
  confirmingRemove: boolean;
  onRequestRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  const isLogged = plan.status === 'LOGGED';
  const isBusy = Boolean(actionState);
  const logButtonLabel = isLogged ? 'Logged' : actionState === 'LOGGING' ? 'Logging...' : 'Log activity';
  return (
    <article style={{ ...panelStyle, padding: 0, overflow: 'hidden', borderColor: isLogged ? 'rgba(74, 222, 128, 0.38)' : expanded ? 'rgba(56, 189, 248, 0.38)' : undefined }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          width: '100%',
          border: 'none',
          background: 'transparent',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          padding: 16,
          textAlign: 'left',
          cursor: 'pointer',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 26, background: `${plan.accent}18`, border: `1px solid ${plan.accent}44`, color: plan.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
          <PlanGlyph type={plan.icon} color={plan.accent} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 900, lineHeight: 1.25 }}>
                {plan.title}
                {/* DR4-E3 -- the checkmark is a COMPLETION indicator and
                 * must never fire on recommendation quality alone (the
                 * DR4-E audit's own finding: a Best Match rating used to
                 * draw this checkmark on an activity nobody had done yet).
                 * isLogged only. */}
                {isLogged && <span style={{ color: '#4ade80', fontSize: 13, marginLeft: 6 }}>✓</span>}
              </div>
              <div style={{ color: isLogged ? '#a7f3d0' : '#4ade80', fontSize: 14, fontWeight: 850, marginTop: 4 }}>{plan.time}</div>
              {/* Event Location Plan Persistence V1 (brief section 19):
                  only rendered when this plan actually snapshotted a
                  custom Event Location -- NULL means the Timing Location
                  was used, and must never show a fabricated location
                  label (brief section 20). */}
              {plan.eventLocationName && (
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>📍 {plan.eventLocationName}</div>
              )}
            </div>
          </div>

          {plan.details && (
            <p
              style={{
                margin: '9px 0 0',
                color: '#94a3b8',
                fontSize: 13,
                lineHeight: 1.42,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {plan.details}
            </p>
          )}

          <div style={{ color: '#aab7d2', fontSize: 12.5, marginTop: 8 }}>{plan.when} · {plan.duration} · {plan.window}</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
            {/* DR4-E3 -- a match badge is recommendation quality, Logged is
             * completion; the two are never the same indicator, and a plan
             * with no genuine matchLabel (plan.match undefined) shows
             * neither badge, never a fabricated one. */}
            {isLogged ? (
              <span style={planMatchBadgeStyle}>Logged{plan.loggedAt ? ` ${plan.loggedAt}` : ''}</span>
            ) : plan.match === 'Best Match' ? (
              <span style={planMatchBadgeStyle}>{plan.match}</span>
            ) : plan.match === 'Good Match' ? (
              <span style={{ color: '#76e7a5', fontSize: 12, fontWeight: 800 }}>{plan.match}</span>
            ) : null}
            <span style={{ marginLeft: 'auto', color: '#aab7d2', fontSize: 22, lineHeight: 1, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 140ms ease' }}>›</span>
          </div>
        </div>
      </button>
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(96, 165, 250, 0.16)', padding: '14px 16px 16px 82px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {plan.googleCalendarUrl && (
              <a href={plan.googleCalendarUrl} target="_blank" rel="noreferrer" style={planActionStyle}>
                Add calendar
              </a>
            )}
            <button type="button" onClick={onReschedule} disabled={isBusy} style={{ ...planSecondaryActionStyle, opacity: isBusy ? 0.55 : 1, cursor: isBusy ? 'default' : 'pointer' }}>Reschedule</button>
            <button type="button" onClick={onLog} disabled={isLogged || isBusy} style={{ ...planSecondaryActionStyle, opacity: isLogged || isBusy ? 0.55 : 1, cursor: isLogged || isBusy ? 'default' : 'pointer' }}>
              {logButtonLabel}
            </button>
            {confirmingRemove ? (
              <>
                <button type="button" onClick={onConfirmRemove} disabled={isBusy} style={{ ...planDangerActionStyle, opacity: isBusy ? 0.55 : 1, cursor: isBusy ? 'default' : 'pointer' }}>
                  {isBusy ? 'Removing...' : isLogged ? 'Confirm remove' : 'Confirm cancel'}
                </button>
                <button type="button" onClick={onCancelRemove} disabled={isBusy} style={{ ...planSecondaryActionStyle, opacity: isBusy ? 0.55 : 1, cursor: isBusy ? 'default' : 'pointer' }}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" onClick={onRequestRemove} disabled={isBusy} style={{ ...planDangerActionStyle, opacity: isBusy ? 0.55 : 1, cursor: isBusy ? 'default' : 'pointer' }}>
                {isLogged ? 'Remove' : 'Cancel'}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * DR4-E2 (Missed Activity Presentation) -- the Missed Activities card.
 * Deliberately a separate, smaller component rather than a conditional
 * branch bolted onto UpcomingPlan: the content and action set are different
 * enough (no expand/collapse -- actions are always visible, matching
 * "compact group" / "keep actions discoverable without overcrowding") that
 * reusing the same component would mean threading a `variant` flag through
 * most of its branches. Still built from the exact same style constants
 * (panelStyle / planSecondaryActionStyle / PlanGlyph) for visual consistency
 * -- "reuse Aura's existing card design, spacing, typography" (brief
 * section 4), never a new visual language.
 *
 * No checkmark, no match-quality badge, no generic "Aura saved this..."
 * reassurance caption -- all would either imply completion/upcoming-ness or
 * obscure the Missed state (brief sections 4/5). The Missed label uses
 * colors.caution, the SAME neutral "needs attention" amber HomeTimeline.tsx
 * already uses for its own WAITING status -- not a new color vocabulary.
 * plan.when/plan.time are read verbatim from mapPlanRow's existing,
 * already-timezone-correct formatting (brief section 7: no new lifecycle
 * calculation, no new date math here).
 */
function MissedActivityCard({
  plan,
  actionState,
  onLog,
  onReschedule,
  onSkip,
}: {
  plan: UpcomingPlan;
  actionState?: PlanActionState;
  onLog: () => void;
  onReschedule: () => void;
  onSkip: () => void;
}) {
  const isBusy = Boolean(actionState);
  return (
    <article style={{ ...panelStyle, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 26, background: `${plan.accent}18`, border: `1px solid ${plan.accent}44`, color: plan.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, opacity: 0.72 }}>
          <PlanGlyph type={plan.icon} color={plan.accent} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 900, lineHeight: 1.25 }}>{plan.title}</div>
          {/* The Missed label leads and is the ONLY lifecycle/quality badge
           * on this card -- more prominent than recommendation quality by
           * simply never showing a match badge here at all (brief section 5). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            <span style={missedBadgeStyle}>Missed</span>
            <span style={{ color: '#aab7d2', fontSize: 13, fontWeight: 700 }}>{plan.when} · {plan.time}</span>
          </div>
          {plan.eventLocationName && (
            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>📍 {plan.eventLocationName}</div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 11 }}>
            <button type="button" onClick={onLog} disabled={isBusy} style={{ ...planSecondaryActionStyle, opacity: isBusy ? 0.55 : 1, cursor: isBusy ? 'default' : 'pointer' }}>
              {actionState === 'LOGGING' ? 'Logging...' : 'Log activity'}
            </button>
            <button type="button" onClick={onReschedule} disabled={isBusy} style={{ ...planSecondaryActionStyle, opacity: isBusy ? 0.55 : 1, cursor: isBusy ? 'default' : 'pointer' }}>
              Reschedule
            </button>
            <button type="button" onClick={onSkip} disabled={isBusy} style={{ ...planSecondaryActionStyle, opacity: isBusy ? 0.55 : 1, cursor: isBusy ? 'default' : 'pointer' }}>
              {actionState === 'SKIPPING' ? 'Skipping...' : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function PlanGlyph({ type, color }: { type: PlanIcon; color: string }) {
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      {type === 'workout' && (
        <>
          <path {...common} d="M6 13v6M10 10v12M22 10v12M26 13v6M10 16h12" />
        </>
      )}
      {type === 'focus' && (
        <>
          <path {...common} d="M16 6a6 6 0 0 0-6 6v1.5A4.5 4.5 0 0 0 10 22" />
          <path {...common} d="M16 6a6 6 0 0 1 6 6v1.5A4.5 4.5 0 0 1 22 22" />
          <path {...common} d="M10 17h12M12 25c2.5-2 5.5-2 8 0" />
        </>
      )}
      {type === 'heart' && (
        <path {...common} d="M16 25s-9-5.4-9-12a4.8 4.8 0 0 1 8.6-2.9A4.8 4.8 0 0 1 25 13c0 6.6-9 12-9 12Z" />
      )}
      {type === 'study' && (
        <>
          <path {...common} d="M6 9.5h8a3 3 0 0 1 3 3V25a3 3 0 0 0-3-3H6Z" />
          <path {...common} d="M26 9.5h-8a3 3 0 0 0-3 3V25a3 3 0 0 1 3-3h8Z" />
        </>
      )}
      {type === 'meditate' && (
        <>
          <circle {...common} cx="16" cy="8" r="2.5" />
          <path {...common} d="M16 12v6M11 16l5 3 5-3M8 24c3.5-4 12.5-4 16 0" />
        </>
      )}
      {type === 'meeting' && (
        <>
          <rect {...common} x="7" y="8" width="18" height="16" rx="3" />
          <path {...common} d="M11 14h10M11 18h7M12 5v5M20 5v5" />
        </>
      )}
      {type === 'journey' && (
        <>
          <path {...common} d="M8 23c3-9 13-5 16-14" />
          <path {...common} d="M9 9h6v6M22 17h2v6h-6" />
        </>
      )}
    </svg>
  );
}

/**
 * Shared result card for FIND/CHECK/COMPARE (Timing Search). Renders the
 * engine's own TimingCandidateLabel via RESULT_LABEL_TEXT (never a second
 * fit classification) and its structured MuhurtaReason[] via the existing
 * English formatter (formatMuhurtaReason) -- no new free-form copy is
 * generated here, per the brief. "Why this works" shows the 2-3 leading
 * reasons inline; "Why this time?" progressively discloses the full
 * structured breakdown grouped by factor.
 */
function TimingResultCard({
  kicker,
  candidate,
  activityTitle,
  durationMinutes,
  timezone,
  planCtaLabel = 'Use this time',
  isSaving,
  isPlanned,
  onPlan,
  onMakeMoment,
  isMomentSaving,
  isMomentSaved,
  onShareMoment,
  isSharingMoment,
  shareFeedback,
  dailyRhythmNote,
}: {
  kicker: string;
  candidate: TimingCandidate;
  activityTitle: string;
  durationMinutes: number;
  /** DR4-B.1 -- the real IANA timezone the candidate's own `start`/`end`
   * instants should be DISPLAYED in. Every caller already resolves this
   * from PlanWithAuraView's own `timezone` prop (the authenticated user's
   * real timezone, apps/web/app/page.tsx's `timezone={user.timezone}`)
   * via the same `timezone || 'UTC'` fallback this file already uses
   * elsewhere (e.g. `localDateTimeToUTC(checkDate, checkStartTime,
   * timezone || 'UTC')`) -- never a second, different fallback
   * convention. Previously this card formatted with no `timeZone` at
   * all, so `toLocaleTimeString` silently used the BROWSER's own local
   * timezone -- correct only by coincidence when it happened to match
   * the user's configured one. */
  timezone: string;
  planCtaLabel?: string;
  isSaving?: boolean;
  isPlanned?: boolean;
  onPlan: () => void;
  /** Product Structure V2 -- present only when the resolved activity is
   * momentEligible (brief section 3). */
  onMakeMoment?: () => void;
  isMomentSaving?: boolean;
  isMomentSaved?: boolean;
  /** Share option under Plan -- present once the moment has been saved. */
  onShareMoment?: () => void;
  isSharingMoment?: boolean;
  shareFeedback?: string | null;
  /** Daily Rhythm V1 PR DR4-B -- the response's own `dailyRhythmNotes[candidate.start]`,
   * looked up by the caller. Absent whenever Daily Rhythm has nothing to
   * say about this specific candidate (unconfigured, non-workday, a WORK
   * activity, etc.) -- never invented here. */
  dailyRhythmNote?: string;
}) {
  const [showAllReasons, setShowAllReasons] = useState(false);
  const start = new Date(candidate.start);
  const end = new Date(candidate.end);
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: timezone };
  const timeRange = `${start.toLocaleTimeString('en-US', timeOpts)} - ${end.toLocaleTimeString('en-US', timeOpts)}`;
  const topReasons = candidate.reasons.slice(0, 3);
  const hasMoreReasons = candidate.reasons.length > topReasons.length;
  const labelColor = RESULT_LABEL_COLOR[candidate.label];

  return (
    <article style={{ ...panelStyle, padding: 15 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start' }}>
        <div>
          <div style={{ color: '#4ade80', fontFamily: 'var(--as-font-mono)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{kicker}</div>
          <h2 style={{ margin: '7px 0 0', color: '#f8fafc', fontSize: 18 }}>{activityTitle}</h2>
          <div style={{ color: '#dbe7f4', fontSize: 14, marginTop: 5 }}>{candidate.metadata.dateLabel} · {timeRange}</div>
          <div style={{ color: labelColor, fontSize: 12, marginTop: 7, fontWeight: 800 }}>{RESULT_LABEL_TEXT[candidate.label]} · {durationLabel(durationMinutes)}</div>
          {/* Daily Rhythm V1 PR DR4-B -- its own line, bold, the same
              brighter-than-caption text color and ✦ glyph DR4-A already
              established for this exact "personal-fit guidance, kept
              separate from timing-quality labels" distinction in Plan My
              Day -- never the labelColor above (that's the astrological
              timing-quality signal) and never folded into "Why this
              works" (that list is astrological reasons only). */}
          {dailyRhythmNote && (
            <div style={{ color: '#dbe7f4', fontSize: 12, marginTop: 7, fontWeight: 800 }}>
              <span aria-hidden="true">✦ </span>
              {dailyRhythmNote}
            </div>
          )}
        </div>
        <div style={{ width: 58, height: 58, borderRadius: 29, border: `1px solid ${labelColor}99`, background: `${labelColor}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <span style={{ color: '#f8fafc', fontSize: 19, fontWeight: 900 }}>{candidate.score.toFixed(1)}</span>
          <span style={{ color: '#94a3b8', fontSize: 9 }}>Aura Fit</span>
        </div>
      </div>

      {topReasons.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: '#aab7d2', fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Why this works</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#dbe7f4', fontSize: 12, lineHeight: 1.5 }}>
            {topReasons.map((reason, index) => (
              <li key={index}>{formatMuhurtaReason(reason)}</li>
            ))}
          </ul>
        </div>
      )}

      {candidate.conflicts && candidate.conflicts.length > 0 && (
        <div style={{ marginTop: 10, color: '#fb7185', fontSize: 12, lineHeight: 1.4 }}>
          {candidate.conflicts.map((conflict, index) => <div key={index}>⚠ {conflict.message}</div>)}
        </div>
      )}

      {hasMoreReasons && (
        <button
          type="button"
          onClick={() => setShowAllReasons((value) => !value)}
          style={{ border: 'none', background: 'transparent', color: '#7dd3fc', fontSize: 12, fontWeight: 800, padding: 0, marginTop: 9, cursor: 'pointer' }}
        >
          {showAllReasons ? 'Hide details ⌃' : 'Why this time? ⌄'}
        </button>
      )}
      {showAllReasons && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#aab7d2', fontSize: 12, lineHeight: 1.55 }}>
          {candidate.reasons.map((reason, index) => (
            <li key={index}><strong style={{ color: '#dbe7f4' }}>{REASON_FACTOR_LABEL[reason.factor]}:</strong> {formatMuhurtaReason(reason)}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button
          type="button"
          onClick={onPlan}
          disabled={isSaving || isPlanned}
          style={{ border: 'none', background: 'transparent', color: isPlanned ? '#4ade80' : '#38bdf8', fontWeight: 850, fontSize: 12, padding: 0, cursor: isSaving || isPlanned ? 'default' : 'pointer', opacity: isSaving ? 0.65 : 1 }}
        >
          {isSaving ? 'Saving...' : isPlanned ? 'Planned' : planCtaLabel}
        </button>
        {onMakeMoment && (
          <button
            type="button"
            onClick={onMakeMoment}
            disabled={isMomentSaving || isMomentSaved}
            style={{ border: 'none', background: 'transparent', color: isMomentSaved ? '#4ade80' : '#fb7185', fontWeight: 850, fontSize: 12, padding: 0, cursor: isMomentSaving || isMomentSaved ? 'default' : 'pointer', opacity: isMomentSaving ? 0.65 : 1 }}
          >
            {isMomentSaving ? 'Saving…' : isMomentSaved ? '✓ Moment saved' : 'Make this a Moment'}
          </button>
        )}
        {isMomentSaved && onShareMoment && (
          <button
            type="button"
            onClick={onShareMoment}
            disabled={isSharingMoment}
            style={{ border: 'none', background: 'transparent', color: shareFeedback ? '#4ade80' : '#38bdf8', fontWeight: 850, fontSize: 12, padding: 0, cursor: isSharingMoment ? 'default' : 'pointer', opacity: isSharingMoment ? 0.65 : 1 }}
          >
            {shareFeedback ?? (isSharingMoment ? 'Sharing…' : 'Share this moment')}
          </button>
        )}
      </div>
    </article>
  );
}

/** Section 14's everyday shared result experience: "Strong shared fit / Good
 * social window / Supportive for you / Supportive for Anna" -- never
 * "Muhurtham"/"auspicious" language (that's Explore's ceremonial framing).
 * Deliberately a lighter, separate card from TimingResultCard/its Aura Fit
 * gauge and reasons list -- EverydaySharedCandidate carries the general
 * candidate's own reasons but this card focuses on the "for both of you"
 * framing the brief's mockup shows. */
export const EVERYDAY_SHARED_RATING_TEXT: Record<string, string> = {
  STRONG_TOGETHER_FIT: 'Strong shared fit',
  GOOD_TOGETHER_FIT: 'Good shared fit',
  EASY_TOGETHER_FIT: 'Easy fit together',
};

function EverydaySharedResultCard({
  kicker,
  activityTitle,
  candidate,
  durationMinutes,
  timezone,
  onMakeMoment,
  isMomentSaving,
  isMomentSaved,
  onShareMoment,
  isSharingMoment,
  shareFeedback,
}: {
  kicker: string;
  activityTitle: string;
  candidate: EverydaySharedCandidate;
  durationMinutes: number;
  /** DR4-B.1 -- see TimingResultCard's own `timezone` doc comment above;
   * same real-IANA-timezone contract, same `timezone || 'UTC'` fallback
   * at the call site. */
  timezone: string;
  onMakeMoment: () => void;
  isMomentSaving?: boolean;
  isMomentSaved?: boolean;
  /** Share option under Plan -- present once the moment has been saved. */
  onShareMoment?: () => void;
  isSharingMoment?: boolean;
  shareFeedback?: string | null;
}) {
  const start = new Date(candidate.start);
  const end = new Date(candidate.end);
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: timezone };
  const timeRange = `${start.toLocaleTimeString('en-US', timeOpts)} - ${end.toLocaleTimeString('en-US', timeOpts)}`;
  const dateLabel = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });

  return (
    <article style={{ ...panelStyle, padding: 15 }}>
      <div style={{ color: '#4ade80', fontFamily: 'var(--as-font-mono)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{kicker}</div>
      <h2 style={{ margin: '7px 0 0', color: '#f8fafc', fontSize: 18 }}>{activityTitle}</h2>
      <div style={{ color: '#dbe7f4', fontSize: 14, marginTop: 5 }}>{dateLabel} · {timeRange}</div>
      <div style={{ color: '#fb7185', fontSize: 12, marginTop: 7, fontWeight: 800 }}>{EVERYDAY_SHARED_RATING_TEXT[candidate.rating]} · {durationLabel(durationMinutes)}</div>
      <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
        Supportive for you{candidate.partnerScore >= candidate.generalCandidate.score ? ' and them' : ''}.
      </div>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={onMakeMoment}
          disabled={isMomentSaving || isMomentSaved}
          style={{ border: 'none', background: 'transparent', color: isMomentSaved ? '#4ade80' : '#fb7185', fontWeight: 850, fontSize: 12, padding: 0, cursor: isMomentSaving || isMomentSaved ? 'default' : 'pointer', opacity: isMomentSaving ? 0.65 : 1 }}
        >
          {isMomentSaving ? 'Saving…' : isMomentSaved ? '✓ Moment saved' : 'Make this a Moment'}
        </button>
        {isMomentSaved && onShareMoment && (
          <button
            type="button"
            onClick={onShareMoment}
            disabled={isSharingMoment}
            style={{ border: 'none', background: 'transparent', color: shareFeedback ? '#4ade80' : '#38bdf8', fontWeight: 850, fontSize: 12, padding: 0, cursor: isSharingMoment ? 'default' : 'pointer', opacity: isSharingMoment ? 0.65 : 1 }}
          >
            {shareFeedback ?? (isSharingMoment ? 'Sharing…' : 'Share this moment')}
          </button>
        )}
      </div>
    </article>
  );
}

const panelStyle: React.CSSProperties = theme.panelStyle;

const inputShellStyle: React.CSSProperties = {
  minHeight: 62,
  marginTop: 14,
  border: '1px solid #2f95ff',
  borderRadius: 12,
  background: 'rgba(2, 6, 23, 0.52)',
  display: 'grid',
  gridTemplateColumns: '34px 1fr 44px',
  alignItems: 'center',
  gap: 7,
  padding: '0 10px 0 13px',
};

const rescheduleNoticeStyle: React.CSSProperties = {
  marginTop: 12,
  border: '1px solid rgba(56, 189, 248, 0.28)',
  borderRadius: 10,
  background: 'rgba(56, 189, 248, 0.1)',
  color: '#dbe7f4',
  fontSize: 12,
  lineHeight: 1.4,
  padding: '9px 11px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  color: '#f8fafc',
  fontSize: 16,
  outline: 'none',
};

const voiceButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 21,
  border: '1px solid rgba(148, 163, 184, 0.2)',
  background: 'rgba(148, 163, 184, 0.16)',
  color: '#f8fafc',
  fontSize: 18,
  cursor: 'pointer',
};

const moreChipStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(2, 6, 23, 0.35)',
  color: '#f8fafc',
  borderRadius: 999,
  padding: '9px 13px',
  fontSize: 12,
  fontWeight: 850,
  cursor: 'pointer',
};

const ctaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 54,
  border: 'none',
  borderRadius: 12,
  background: 'linear-gradient(90deg, #4ade80 0%, #22d3ee 52%, #2f95ff 100%)',
  color: '#020617',
  fontSize: 17,
  fontWeight: 950,
  marginTop: 22,
  cursor: 'pointer',
};

const dateLabelStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 11,
  fontWeight: 900,
  textTransform: 'uppercase',
};

const dateInputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 6,
  background: '#020617',
  border: '1px solid #334155',
  borderRadius: 9,
  color: '#cbd5e1',
  fontSize: 12,
  padding: '9px 10px',
};

const emptyPlansStyle: React.CSSProperties = {
  ...panelStyle,
  color: '#aab7d2',
  fontSize: 13,
  lineHeight: 1.4,
  textAlign: 'center',
};

const planActionStyle: React.CSSProperties = {
  minHeight: 32,
  border: '1px solid rgba(56, 189, 248, 0.55)',
  borderRadius: 8,
  background: 'rgba(14, 165, 233, 0.14)',
  color: '#7dd3fc',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 12px',
  textDecoration: 'none',
  fontSize: 12,
  fontWeight: 850,
};

const planMatchBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  color: '#4ade80',
  border: '1px solid rgba(74, 222, 128, 0.3)',
  background: 'rgba(74, 222, 128, 0.1)',
  borderRadius: 7,
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 850,
};

// DR4-E2 -- same chip shape as planMatchBadgeStyle (reused dimensions/
// radius/weight, never a new badge language), colors.caution instead of
// the completion green -- the same neutral "needs attention" amber
// HomeTimeline.tsx's own WAITING status already uses.
const missedBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  color: colors.caution,
  border: `1px solid ${colors.caution}4d`,
  background: `${colors.caution}1a`,
  borderRadius: 7,
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 850,
};

const planSecondaryActionStyle: React.CSSProperties = {
  ...planActionStyle,
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(148, 163, 184, 0.12)',
  color: '#dbe7f4',
  cursor: 'pointer',
};

const planDangerActionStyle: React.CSSProperties = {
  ...planActionStyle,
  border: '1px solid rgba(251, 113, 133, 0.35)',
  background: 'rgba(251, 113, 133, 0.1)',
  color: '#fb7185',
  cursor: 'pointer',
};
