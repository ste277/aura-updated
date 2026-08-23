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
import type { TimingCandidate, TimingCandidateLabel, TimingSearchDateRange, TimingSearchMode, TimingSearchResponse, TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import type { MuhurtaReason } from '../../../packages/muhurta/src/activityOntology';
import { formatMuhurtaReason } from '../../../packages/muhurta/src/muhurtaReasonFormat';
import { localDateTimeToUTC } from '../lib/timezone';
import { triggerHaptic } from '../lib/haptics';
import { trackEvent } from '../lib/trackEvent';

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
  }) => Promise<TimingSearchResponse>;
  onViewDay?: () => void;
  onPlanLogged?: () => void;
  timezone?: string;
  initialActivity?: string | null;
  initialActivityKey?: number;
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

const DURATIONS = [
  { value: 15, label: '15 min', helper: 'Quick reset' },
  { value: 30, label: '30 min', helper: 'Short block' },
  { value: 60, label: '60 min', helper: 'You can adjust later' },
  { value: 90, label: '90 min', helper: 'Deep session' },
  { value: 120, label: '2h', helper: 'Long block' },
];

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

/** TimingCandidateLabel -> friendly copy (section 11). Do not invent a second
 * fit classification -- this is purely a display mapping of the engine's own
 * label values. */
export const RESULT_LABEL_TEXT: Record<TimingCandidateLabel, string> = {
  EXCELLENT: 'Excellent fit',
  VERY_GOOD: 'Very good',
  GOOD: 'Good',
  USABLE: 'Usable',
  CAUTION: 'Caution',
};

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

type PlanIcon = 'workout' | 'focus' | 'heart' | 'study' | 'meditate' | 'meeting' | 'journey';
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
type UpcomingPlan = {
  id: string;
  title: string;
  icon: PlanIcon;
  duration: string;
  time: string;
  window: string;
  match: 'Best Match' | 'Good Match';
  note: string;
  accent: string;
  when: string;
  plannedStartAt: string;
  plannedEndAt: string;
  details: string;
  score?: number;
  googleCalendarUrl?: string;
  source?: 'Aura';
  status?: 'UPCOMING' | 'LOGGED';
  loggedAt?: string;
};

type PlanActionState = 'LOGGING' | 'CANCELLING';

type PlanApiRow = {
  id: string;
  title?: string | null;
  activityType?: string | null;
  icon?: string | null;
  status?: 'UPCOMING' | 'LOGGED' | 'CANCELLED' | string | null;
  plannedStartAt: string | Date;
  plannedEndAt: string | Date;
  durationMinutes?: number | null;
  windowType?: string | null;
  windowLabel?: string | null;
  matchLabel?: string | null;
  score?: number | null;
  recommendation?: string | null;
  calendarUrl?: string | null;
  loggedAt?: string | Date | null;
};

function recommendedPreference(taskTitle: string): TimePreference {
  const title = taskTitle.toLowerCase();
  if (/(date|party|social|romantic|meal|dinner)/.test(title)) return 'EVENING';
  if (/(sleep|wind down|night)/.test(title)) return 'NIGHT';
  if (/(workout|exercise|journey|travel|deep work|study|learn|meditat|meeting)/.test(title)) return 'MORNING';
  return 'ANYTIME';
}

function durationLabel(minutes: number): string {
  if (minutes < 120) return `${minutes} min`;
  return `${minutes / 60} hours`;
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

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function getTodayForTimezone(timezone?: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  if (!year || !month || !day) return new Date();
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function planIconForTitle(title: string): PlanIcon {
  const lower = title.toLowerCase();
  if (/workout|exercise|gym|training/.test(lower)) return 'workout';
  if (/date|relationship|romantic/.test(lower)) return 'heart';
  if (/study|learn|course|exam|read/.test(lower)) return 'study';
  if (/meditat|breath|prayer/.test(lower)) return 'meditate';
  if (/meeting|review|call|interview|presentation/.test(lower)) return 'meeting';
  if (/journey|travel|trip|flight|train/.test(lower)) return 'journey';
  return 'focus';
}

function planAccentForTitle(title: string): string {
  const lower = title.toLowerCase();
  if (/date|relationship|romantic|workout|exercise|gym/.test(lower)) return '#ff5f95';
  if (/study|learn|meditat|breath/.test(lower)) return '#4ade80';
  if (/journey|travel|trip/.test(lower)) return '#facc15';
  return '#38bdf8';
}

function minutesFromDuration(duration: string): number {
  const hourMatch = duration.match(/(\d+(?:\.\d+)?)\s*h/i);
  if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
  const minuteMatch = duration.match(/(\d+)\s*min/i);
  if (minuteMatch) return Number(minuteMatch[1]);
  return 60;
}

function formatPlanDay(date: Date): string {
  const today = getTodayForTimezone();
  const dateKey = date.toISOString().slice(0, 10);
  const todayKey = today.toISOString().slice(0, 10);
  const tomorrowKey = addDays(today, 1).toISOString().slice(0, 10);
  if (dateKey === todayKey) return 'Today';
  if (dateKey === tomorrowKey) return 'Tomorrow';
  return formatShortDate(date);
}

function formatPlanTimeRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleTimeString('en-US', opts)} - ${end.toLocaleTimeString('en-US', opts)}`;
}

function windowTypeFromLabel(label?: string): string {
  if (!label) return 'NEUTRAL';
  if (/abhijit/i.test(label)) return 'ABHIJIT';
  if (/gulika|steady/i.test(label)) return 'GULIKA';
  if (/brahma/i.test(label)) return 'BRAHMA';
  if (/rahu/i.test(label)) return 'RAHU_KALAM';
  if (/yama/i.test(label)) return 'YAMA';
  return 'NEUTRAL';
}

function mapPlanRow(row: PlanApiRow): UpcomingPlan {
  const start = new Date(row.plannedStartAt);
  const end = new Date(row.plannedEndAt);
  const title = row.title || row.activityType || 'Planned activity';
  const status = row.status === 'LOGGED' ? 'LOGGED' : 'UPCOMING';
  return {
    id: row.id,
    title,
    icon: planIconForTitle(row.icon || title),
    when: formatPlanDay(start),
    plannedStartAt: start.toISOString(),
    plannedEndAt: end.toISOString(),
    duration: `${row.durationMinutes ?? 60} min`,
    time: formatPlanTimeRange(start, end),
    window: row.windowLabel || row.windowType || 'Neutral Flow',
    match: row.matchLabel === 'Good Match' ? 'Good Match' : 'Best Match',
    note: status === 'LOGGED' ? 'Logged' : row.matchLabel || 'Good match',
    accent: planAccentForTitle(title),
    details: row.recommendation || 'Aura saved this as one of your planned moments.',
    score: typeof row.score === 'number' ? row.score : undefined,
    googleCalendarUrl: row.calendarUrl || undefined,
    source: 'Aura',
    status,
    loggedAt: row.loggedAt ? new Date(row.loggedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : undefined,
  };
}

export function findCandidateKey(candidate: TimingCandidate): string {
  return `${candidate.metadata.activityType}-${candidate.start}-${candidate.end}`.toLowerCase();
}

/** Adapts a TimingCandidate into the existing UpcomingPlan/handleSavePlan
 * pipeline (POST /api/plans) so Find/Check/Compare's "Use this time" reuses
 * the same persistence path the original Plan flow already had, rather than
 * a second save mechanism. candidate.metadata.windowLabel is produced by the
 * same formatWindowLabel() the old slot-task-backed flow used, so
 * windowTypeFromLabel() below still resolves it correctly.
 *
 * `sharedWithName` (Shared Muhurtham brief section 18): PlannedActivity has
 * no JSON metadata column and this PR does not add one ("do not create a new
 * plan model solely for this") -- so when a SHARED "Use this time" saves a
 * plan, the only schema-migration-free way to preserve that context is a
 * short human-readable prefix on the existing `details`/`recommendation`
 * text field. Omitted (undefined), `details` is byte-identical to before --
 * GENERAL/PERSONAL "Use this time" callers are completely unaffected. */
export function planPayloadFromCandidate(candidate: TimingCandidate, durationMinutes: number, sharedWithName?: string): UpcomingPlan {
  const start = new Date(candidate.start);
  const end = new Date(candidate.end);
  const title = candidate.metadata.activityType;
  const reasonDetails = candidate.reasons.length > 0 ? candidate.reasons.map((reason) => formatMuhurtaReason(reason)).join(' ') : 'Aura found this as a good moment for this activity.';
  return {
    id: `aura-${findCandidateKey(candidate)}`.replace(/[^a-z0-9]+/g, '-'),
    title,
    icon: planIconForTitle(title),
    when: candidate.metadata.dateLabel,
    plannedStartAt: candidate.start,
    plannedEndAt: candidate.end,
    duration: durationLabel(durationMinutes),
    time: formatPlanTimeRange(start, end),
    window: candidate.metadata.windowLabel,
    match: candidate.label === 'EXCELLENT' || candidate.label === 'VERY_GOOD' ? 'Best Match' : 'Good Match',
    note: RESULT_LABEL_TEXT[candidate.label],
    accent: planAccentForTitle(title),
    details: sharedWithName ? `❤️ Planned with ${sharedWithName}. ${reasonDetails}` : reasonDetails,
    score: candidate.score * 10,
    googleCalendarUrl: buildGoogleCalendarUrl(title, candidate.start, candidate.end),
    source: 'Aura',
  };
}

/**
 * Saves a TimingCandidate-shaped result straight to POST /api/plans, using
 * planPayloadFromCandidate() above for the exact same field mapping
 * PlanWithAuraView's own handleSavePlan() uses -- for callers (Muhurtham
 * Finder's "Use this time ->") that need the same save pipeline but aren't
 * PlanWithAuraView itself, so don't have its local savedPlans list state to
 * update. Intentionally does none of that list bookkeeping; callers that
 * want the saved plan reflected immediately in their own UI should refetch
 * (e.g. via the onPlanLogged callback already threaded through page.tsx).
 */
export async function saveUpcomingPlanFromCandidate(candidate: TimingCandidate, durationMinutes: number, sharedWithName?: string): Promise<UpcomingPlan> {
  const plan = planPayloadFromCandidate(candidate, durationMinutes, sharedWithName);
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
    }),
  });
  if (!res.ok) throw new Error('Unable to save plan.');
  return mapPlanRow(await res.json());
}

export function PlanWithAuraView({ onTimingSearch, onViewDay, onPlanLogged, timezone, initialActivity, initialActivityKey, onOpenPeople, focusMomentsKey, onMomentSeen, focusMomentToken }: PlanWithAuraViewProps) {
  const [planMode, setPlanMode] = useState<TimingSearchMode>('FIND');
  const [taskTitle, setTaskTitle] = useState('');
  const [, setIsCustomTask] = useState(false);
  const [horizon, setHorizon] = useState<PlanningHorizon>('TODAY');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [timePreference, setTimePreference] = useState<TimePreference>('AFTERNOON');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [findResult, setFindResult] = useState<TimingSearchResponse | null>(null);
  const [error, setError] = useState('');
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
  const [checkResult, setCheckResult] = useState<TimingSearchResponse | null>(null);
  const [checkError, setCheckError] = useState('');
  const [isChecking, setIsChecking] = useState(false);

  // COMPARE mode
  const [compareTaskTitle, setCompareTaskTitle] = useState('');
  const [compareDurationMinutes, setCompareDurationMinutes] = useState(60);
  const [compareADate, setCompareADate] = useState('');
  const [compareAStartTime, setCompareAStartTime] = useState('');
  const [compareBDate, setCompareBDate] = useState('');
  const [compareBStartTime, setCompareBStartTime] = useState('');
  const [compareResult, setCompareResult] = useState<TimingSearchResponse | null>(null);
  const [compareError, setCompareError] = useState('');
  const [isComparing, setIsComparing] = useState(false);
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [showMoreActivities, setShowMoreActivities] = useState(false);
  const [savedPlans, setSavedPlans] = useState<UpcomingPlan[]>([]);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [reschedulingPlanId, setReschedulingPlanId] = useState<string | null>(null);
  const [confirmingRemovePlanId, setConfirmingRemovePlanId] = useState<string | null>(null);
  const [savingOpportunityKey, setSavingOpportunityKey] = useState<string | null>(null);
  const [planActionStates, setPlanActionStates] = useState<Record<string, PlanActionState>>({});
  const [plannedOpportunityKeys, setPlannedOpportunityKeys] = useState<Set<string>>(() => new Set());
  const plansSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const nextActivity = initialActivity?.trim();
    if (!nextActivity) return;

    const knownTask = TASKS.some((task) => task.title.toLowerCase() === nextActivity.toLowerCase());
    setTaskTitle(nextActivity);
    setIsCustomTask(!knownTask);
    setTimePreference(recommendedPreference(nextActivity));
    setFindResult(null);
    setError('');
    setShowAllPlans(false);
    setShowMoreActivities(false);
    setExpandedPlanId(null);
    setReschedulingPlanId(null);
    setSavingOpportunityKey(null);
    setPlanActionStates({});
    setPlannedOpportunityKeys(new Set());
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [initialActivity, initialActivityKey]);

  useEffect(() => {
    let cancelled = false;
    const loadPlans = async () => {
      try {
        const res = await fetch('/api/plans');
        if (!res.ok) throw new Error('Unable to load plans.');
        const rows = await res.json();
        if (cancelled) return;
        setSavedPlans(Array.isArray(rows) ? rows.map(mapPlanRow) : []);
      } catch {
        if (!cancelled) setSavedPlans([]);
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

  // The exact same resolution handleFindTime's own selection will use
  // (resolveActivitySelection, not the looser alias matcher) -- the person
  // picker must only appear when the search is actually about to resolve
  // to this specific catalog activity.
  const resolvedActivityDefinition = useMemo(() => {
    const selection = resolveActivitySelection(taskTitle);
    return selection.activityId ? getActivityDefinition(selection.activityId) : undefined;
  }, [taskTitle]);
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

  useEffect(() => {
    if (!focusMomentsKey) return;
    requestAnimationFrame(() => {
      momentsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [focusMomentsKey]);

  const selectedHorizon = HORIZONS.find((item) => item.value === horizon) ?? HORIZONS[0];
  const selectedDuration = DURATIONS.find((item) => item.value === durationMinutes) ?? DURATIONS[2];
  const horizonHelper = useMemo(() => getHorizonHelper(horizon, timezone), [horizon, timezone]);
  const upcomingPlans = useMemo(() => savedPlans.filter((plan) => plan.status !== 'LOGGED'), [savedPlans]);
  const completedPlans = useMemo(() => savedPlans.filter((plan) => plan.status === 'LOGGED'), [savedPlans]);
  const visibleUpcomingPlans = showAllPlans ? upcomingPlans : upcomingPlans.slice(0, 3);
  const visibleCompletedPlans = showAllPlans ? completedPlans.slice(0, 5) : [];
  const canSubmit = Boolean(taskTitle.trim()) && (horizon !== 'CUSTOM' || Boolean(customStartDate && customEndDate && customEndDate >= customStartDate));

  const handleSavePlan = async (plan: UpcomingPlan): Promise<UpcomingPlan> => {
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
        }),
      });
      if (!res.ok) throw new Error('Unable to save plan.');
      const row = await res.json();
      const saved = mapPlanRow(row);
      const replacedPlanId = reschedulingPlanId;
      if (replacedPlanId && replacedPlanId !== saved.id) {
        fetch(`/api/plans/${replacedPlanId}`, { method: 'DELETE' }).catch((err) => {
          console.warn('Could not cancel previous rescheduled plan:', err);
        });
      }
      setSavedPlans((plans) => [
        saved,
        ...plans.filter((item) => item.id !== saved.id && item.id !== replacedPlanId),
      ]);
      setExpandedPlanId(saved.id);
      setReschedulingPlanId(null);
      setShowAllPlans(true);
      onPlanLogged?.();
      triggerHaptic('success');
      trackEvent('PLAN_RESULT_SELECTED', { metadata: { mode: planMode } });
      return saved;
    } catch {
      const replacedPlanId = reschedulingPlanId;
      setSavedPlans((plans) => [
        { ...plan, status: 'UPCOMING' },
        ...plans.filter((item) => item.id !== plan.id && item.id !== replacedPlanId),
      ]);
      setExpandedPlanId(plan.id);
      setReschedulingPlanId(null);
      setShowAllPlans(true);
      triggerHaptic('success');
      return plan;
    }
  };

  const handleReschedulePlan = (plan: UpcomingPlan) => {
    setTaskTitle(plan.title);
    setIsCustomTask(true);
    setDurationMinutes(minutesFromDuration(plan.duration));
    setTimePreference(recommendedPreference(plan.title));
    setHorizon('SEVEN_DAYS');
    setCustomStartDate('');
    setCustomEndDate('');
    setFindResult(null);
    setShowAllPlans(false);
    setExpandedPlanId(null);
    setReschedulingPlanId(plan.status === 'UPCOMING' ? plan.id : null);
    setSavingOpportunityKey(null);
    setPlannedOpportunityKeys(new Set());
    triggerHaptic('light');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogPlan = async (plan: UpcomingPlan) => {
    if (planActionStates[plan.id] || plan.status === 'LOGGED') return;
    setPlanActionStates((states) => ({ ...states, [plan.id]: 'LOGGING' }));
    try {
      const res = await fetch(`/api/plans/${plan.id}/log`, { method: 'POST' });
      if (!res.ok) throw new Error('Unable to log plan.');
      const result = await res.json();
      const updated = mapPlanRow(result.plan);
      setSavedPlans((plans) => plans.map((item) => item.id === plan.id ? updated : item));
      setExpandedPlanId(plan.id);
      onPlanLogged?.();
      triggerHaptic('success');
    } catch {
      const loggedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setSavedPlans((plans) => plans.map((item) => item.id === plan.id
        ? {
            ...item,
            status: 'LOGGED',
            loggedAt,
            note: 'Logged',
            details: `${item.details} Logged at ${loggedAt}.`,
          }
        : item
      ));
      setExpandedPlanId(plan.id);
      triggerHaptic('success');
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

  const handleFindTime = async () => {
    if (!canSubmit) return;
    setIsLoading(true);
    setError('');
    try {
      const selection = resolveActivitySelection(taskTitle);
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
        setFindResult(next);
        setSharedFindResult(null);
      }
      setSavingOpportunityKey(null);
      setPlannedOpportunityKeys(new Set());
      setMomentSavedKeys(new Set());
      triggerHaptic('success');
    } catch {
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
    try {
      const selection = resolveActivitySelection(checkTaskTitle);
      const candidateStart = localDateTimeToUTC(checkDate, checkStartTime, timezone || 'UTC').toISOString();
      const next = await onTimingSearch({
        mode: 'CHECK',
        ...selection,
        durationMinutes: checkDurationMinutes,
        candidateStart,
      });
      setCheckResult(next);
      setSavingOpportunityKey(null);
      setPlannedOpportunityKeys(new Set());
      triggerHaptic('success');
    } catch {
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
    setIsListening(true);

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      setTaskTitle(transcript);
      setIsCustomTask(true);
      setTimePreference(recommendedPreference(transcript));
      setFindResult(null);
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
    requestAnimationFrame(() => {
      plansSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const saveOpportunity = async (key: string, plan: UpcomingPlan) => {
    if (savingOpportunityKey || plannedOpportunityKeys.has(key)) return;
    setSavingOpportunityKey(key);
    try {
      await handleSavePlan(plan);
      setPlannedOpportunityKeys((prev) => new Set(prev).add(key));
    } finally {
      setSavingOpportunityKey(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 17, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, lineHeight: 1.08, margin: 0, color: '#f8fafc', letterSpacing: 0 }}>
            Plan with Aura ✨
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.35, color: '#b6c2d1', margin: '7px 0 0' }}>
            Tell Aura what you want to do.<br />We&apos;ll find your best moments.
          </p>
        </div>
        <button type="button" onClick={handleMyPlansClick} style={myPlansStyle}>
          <span style={{ fontSize: 15 }}>☷</span>
          My Plans
        </button>
      </header>

      <div style={modeSwitcherStyle}>
        {PLAN_MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            onClick={() => setPlanMode(mode.value)}
            style={{ ...modePillStyle, ...(planMode === mode.value ? modePillActiveStyle : {}) }}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div style={{ color: '#aab7d2', fontSize: 13, marginTop: -8 }}>
        {PLAN_MODES.find((mode) => mode.value === planMode)?.helper}
      </div>

      {planMode === 'FIND' && (
      <>
      <section style={panelStyle}>
        <SectionTitle number={1} label="What do you want to do?" />
        {reschedulingPlanId && (
          <div style={rescheduleNoticeStyle}>
            Rescheduling this plan. Saving a new best moment will replace the current upcoming plan.
          </div>
        )}
        <div style={inputShellStyle}>
          <span style={{ fontSize: 21, color: '#7dd3fc' }}>✦</span>
          <input
            value={taskTitle}
            onChange={(event) => {
              setTaskTitle(event.target.value);
              setIsCustomTask(true);
              setFindResult(null);
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
                if (task.defaultDurationMinutes) setDurationMinutes(task.defaultDurationMinutes);
                setTimePreference(recommendedPreference(task.title));
                setFindResult(null);
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

      {showPersonPicker && (
        <section style={panelStyle}>
          <div style={{ color: '#aab7d2', fontSize: 13 }}>Who&apos;s this with?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 12 }}>
            <PersonPickerChip label="Just me" active={!selectedPersonId} onClick={() => { setSelectedPersonId(''); setFindResult(null); setSharedFindResult(null); }} />
            {loadingPeople && savedPeople === null && <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>Loading…</span>}
            {savedPeople?.map((person) => (
              <PersonPickerChip
                key={person.id}
                label={`${RELATIONSHIP_ICON[person.relationshipType]} ${person.name}`}
                active={selectedPersonId === person.id}
                onClick={() => { setSelectedPersonId(person.id); setFindResult(null); setSharedFindResult(null); }}
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
          onChange={(value) => setHorizon(value as PlanningHorizon)}
        />
        <SelectPanel
          number={3}
          icon="🕒"
          label="How long?"
          value={selectedDuration.label}
          helper={selectedDuration.helper}
          options={DURATIONS}
          selectedValue={durationMinutes}
          onChange={(value) => setDurationMinutes(Number(value))}
        />
      </div>

      {horizon === 'CUSTOM' && (
        <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={dateLabelStyle}>
            Start
            <input type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} style={dateInputStyle} />
          </label>
          <label style={dateLabelStyle}>
            End
            <input type="date" value={customEndDate} min={customStartDate || undefined} onChange={(event) => setCustomEndDate(event.target.value)} style={dateInputStyle} />
          </label>
        </div>
      )}

      <section style={panelStyle}>
        <SectionTitle number={4} icon="🕒" label="Preferred time" />
        <div style={{ fontSize: 13, color: '#b6c2d1', marginTop: 10 }}>When would you like to do this?</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
          {TIME_PREFERENCES.map((item) => (
            <TimeTile key={item.value} item={item} active={timePreference === item.value} onClick={() => setTimePreference(item.value)} />
          ))}
        </div>
        <button type="button" disabled={!canSubmit || isLoading} onClick={handleFindTime} style={{ ...ctaStyle, opacity: canSubmit ? 1 : 0.55 }}>
          {isLoading ? 'Finding...' : '✦ Find My Best Time'}
        </button>
        <div style={{ color: '#dbe7f4', fontSize: 12, textAlign: 'center', marginTop: 13 }}>
          🛡 Aura finds options using today&apos;s Panchang + your patterns
        </div>
        {error && <div style={{ color: '#fb6b6b', fontSize: 12, marginTop: 10, lineHeight: 1.35 }}>{error}</div>}
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
              isSaving={savingOpportunityKey === findCandidateKey(findResult.candidates[0])}
              isPlanned={plannedOpportunityKeys.has(findCandidateKey(findResult.candidates[0]))}
              onPlan={() => saveOpportunity(findCandidateKey(findResult.candidates[0]), planPayloadFromCandidate(findResult.candidates[0], durationMinutes))}
              onMakeMoment={resolvedActivityDefinition?.experience.momentEligible ? () => handleMakeMoment(findCandidateKey(findResult.candidates[0]), { activityId: resolvedActivityDefinition.id, start: findResult.candidates[0].start, end: findResult.candidates[0].end, ratingLabel: findResult.candidates[0].label }) : undefined}
              isMomentSaving={momentSavingKey === findCandidateKey(findResult.candidates[0])}
              isMomentSaved={momentSavedKeys.has(findCandidateKey(findResult.candidates[0]))}
              onShareMoment={resolvedActivityDefinition ? () => handleShareSavedMoment(findCandidateKey(findResult.candidates[0]), 'PERSONAL', resolvedActivityDefinition.id) : undefined}
              isSharingMoment={sharingMomentKey === findCandidateKey(findResult.candidates[0])}
              shareFeedback={momentShareFeedback?.key === findCandidateKey(findResult.candidates[0]) ? momentShareFeedback.text : null}
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
                  isSaving={savingOpportunityKey === findCandidateKey(candidate)}
                  isPlanned={plannedOpportunityKeys.has(findCandidateKey(candidate))}
                  onPlan={() => saveOpportunity(findCandidateKey(candidate), planPayloadFromCandidate(candidate, durationMinutes))}
                  onMakeMoment={resolvedActivityDefinition?.experience.momentEligible ? () => handleMakeMoment(findCandidateKey(candidate), { activityId: resolvedActivityDefinition.id, start: candidate.start, end: candidate.end, ratingLabel: candidate.label }) : undefined}
                  isMomentSaving={momentSavingKey === findCandidateKey(candidate)}
                  isMomentSaved={momentSavedKeys.has(findCandidateKey(candidate))}
                  onShareMoment={resolvedActivityDefinition ? () => handleShareSavedMoment(findCandidateKey(candidate), 'PERSONAL', resolvedActivityDefinition.id) : undefined}
                  isSharingMoment={sharingMomentKey === findCandidateKey(candidate)}
                  shareFeedback={momentShareFeedback?.key === findCandidateKey(candidate) ? momentShareFeedback.text : null}
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
            <div style={inputShellStyle}>
              <span style={{ fontSize: 21, color: '#7dd3fc' }}>✦</span>
              <input
                value={checkTaskTitle}
                onChange={(event) => { setCheckTaskTitle(event.target.value); setCheckResult(null); }}
                placeholder="e.g. Important meeting"
                style={inputStyle}
              />
            </div>
          </section>

          <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={dateLabelStyle}>
              Date
              <input type="date" value={checkDate} onChange={(event) => { setCheckDate(event.target.value); setCheckResult(null); }} style={dateInputStyle} />
            </label>
            <label style={dateLabelStyle}>
              Start time
              <input type="time" value={checkStartTime} onChange={(event) => { setCheckStartTime(event.target.value); setCheckResult(null); }} style={dateInputStyle} />
            </label>
          </div>

          <SelectPanel
            number={2}
            icon="🕒"
            label="How long?"
            value={DURATIONS.find((item) => item.value === checkDurationMinutes)?.label ?? `${checkDurationMinutes} min`}
            helper="Duration to check"
            options={DURATIONS}
            selectedValue={checkDurationMinutes}
            onChange={(value) => { setCheckDurationMinutes(Number(value)); setCheckResult(null); }}
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
                isSaving={savingOpportunityKey === findCandidateKey(checkResult.requestedCandidate)}
                isPlanned={plannedOpportunityKeys.has(findCandidateKey(checkResult.requestedCandidate))}
                onPlan={() => saveOpportunity(findCandidateKey(checkResult.requestedCandidate!), planPayloadFromCandidate(checkResult.requestedCandidate!, checkDurationMinutes))}
              />
              {checkResult.betterNearby && (
                <>
                  <SectionHeader label="Better Nearby" />
                  <TimingResultCard
                    kicker="BETTER NEARBY"
                    candidate={checkResult.betterNearby}
                    activityTitle={checkResult.betterNearby.metadata.activityType}
                    durationMinutes={checkDurationMinutes}
                    planCtaLabel="Use better time"
                    isSaving={savingOpportunityKey === findCandidateKey(checkResult.betterNearby)}
                    isPlanned={plannedOpportunityKeys.has(findCandidateKey(checkResult.betterNearby))}
                    onPlan={() => saveOpportunity(findCandidateKey(checkResult.betterNearby!), planPayloadFromCandidate(checkResult.betterNearby!, checkDurationMinutes))}
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
            helper="Duration for both options"
            options={DURATIONS}
            selectedValue={compareDurationMinutes}
            onChange={(value) => { setCompareDurationMinutes(Number(value)); setCompareResult(null); }}
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
                isSaving={savingOpportunityKey === findCandidateKey(compareResult.candidates[0])}
                isPlanned={plannedOpportunityKeys.has(findCandidateKey(compareResult.candidates[0]))}
                onPlan={() => saveOpportunity(findCandidateKey(compareResult.candidates[0]), planPayloadFromCandidate(compareResult.candidates[0], compareDurationMinutes))}
              />
              <SectionHeader label="Compared With" />
              {compareResult.candidates.slice(1).map((candidate) => (
                <TimingResultCard
                  key={findCandidateKey(candidate)}
                  kicker="COMPARED WITH"
                  candidate={candidate}
                  activityTitle={candidate.metadata.activityType}
                  durationMinutes={compareDurationMinutes}
                  isSaving={savingOpportunityKey === findCandidateKey(candidate)}
                  isPlanned={plannedOpportunityKeys.has(findCandidateKey(candidate))}
                  onPlan={() => saveOpportunity(findCandidateKey(candidate), planPayloadFromCandidate(candidate, compareDurationMinutes))}
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
          <div style={emptyPlansStyle}>
            No upcoming plans yet. Choose an activity above and tap Find My Best Time to create one.
          </div>
        )}
      </section>

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
}: {
  number: number;
  icon: string;
  label: string;
  value: string;
  helper: string;
  options: Array<{ value: string | number; label: string }>;
  selectedValue: string | number;
  onChange: (value: string | number) => void;
}) {
  return (
    <section style={{ ...panelStyle, padding: 14, minWidth: 0 }}>
      <SectionTitle number={number} icon={icon} label={label} />
      <div style={{ position: 'relative', marginTop: 13 }}>
        <select
          value={selectedValue}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: '100%',
            minHeight: 51,
            appearance: 'none',
            border: '1px solid rgba(96, 165, 250, 0.25)',
            borderRadius: 10,
            background: 'rgba(2, 6, 23, 0.62)',
            color: '#f8fafc',
            fontSize: 17,
            fontWeight: 850,
            padding: '0 36px 0 13px',
            outline: 'none',
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
                {(plan.match === 'Best Match' || isLogged) && <span style={{ color: '#4ade80', fontSize: 13, marginLeft: 6 }}>✓</span>}
              </div>
              <div style={{ color: isLogged ? '#a7f3d0' : '#4ade80', fontSize: 14, fontWeight: 850, marginTop: 4 }}>{plan.time}</div>
            </div>
            {typeof plan.score === 'number' && <MatchScoreRing score={plan.score} />}
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
            {isLogged ? (
              <span style={planMatchBadgeStyle}>Logged{plan.loggedAt ? ` ${plan.loggedAt}` : ''}</span>
            ) : plan.match === 'Best Match' ? (
              <span style={planMatchBadgeStyle}>{plan.match}</span>
            ) : (
              <span style={{ color: '#76e7a5', fontSize: 12, fontWeight: 800 }}>{plan.match}</span>
            )}
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

// Compact circular score indicator -- mirrors HomeDashboard's own ScoreGauge
// visual language (bordered ring, stacked number/unit) so Upcoming Plans
// reads as part of the same design system, just adapted to the existing
// 0-100 plan.score scale instead of Home's 0-10 next-shift score.
function MatchScoreRing({ score }: { score: number }) {
  return (
    <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 44, border: '3px solid #4ade80', borderLeftColor: 'rgba(148, 163, 184, 0.28)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'rgba(15, 23, 42, 0.75)' }}>
      <span style={{ color: '#f8fafc', fontSize: 13, fontWeight: 900, lineHeight: 1 }}>{Math.round(score)}</span>
      <span style={{ color: '#94a3b8', fontSize: 8, lineHeight: 1.3 }}>/100</span>
    </div>
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
}: {
  kicker: string;
  candidate: TimingCandidate;
  activityTitle: string;
  durationMinutes: number;
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
}) {
  const [showAllReasons, setShowAllReasons] = useState(false);
  const start = new Date(candidate.start);
  const end = new Date(candidate.end);
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
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
const EVERYDAY_SHARED_RATING_TEXT: Record<string, string> = {
  STRONG_TOGETHER_FIT: 'Strong shared fit',
  GOOD_TOGETHER_FIT: 'Good shared fit',
  EASY_TOGETHER_FIT: 'Easy fit together',
};

function EverydaySharedResultCard({
  kicker,
  activityTitle,
  candidate,
  durationMinutes,
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
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const timeRange = `${start.toLocaleTimeString('en-US', timeOpts)} - ${end.toLocaleTimeString('en-US', timeOpts)}`;
  const dateLabel = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

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

const modeSwitcherStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 8,
  border: '1px solid rgba(96, 165, 250, 0.18)',
  borderRadius: 14,
  background: 'rgba(2, 6, 23, 0.5)',
  padding: 5,
};

const modePillStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 10,
  background: 'transparent',
  color: '#aab7d2',
  fontSize: 13,
  fontWeight: 850,
  padding: '10px 6px',
  cursor: 'pointer',
};

const modePillActiveStyle: React.CSSProperties = {
  background: 'linear-gradient(90deg, #4ade80 0%, #22d3ee 52%, #2f95ff 100%)',
  color: '#020617',
};

const myPlansStyle: React.CSSProperties = {
  minHeight: 45,
  border: '1px solid rgba(96, 165, 250, 0.23)',
  borderRadius: 14,
  background: 'rgba(15, 23, 42, 0.75)',
  color: '#4ade80',
  fontSize: 15,
  fontWeight: 900,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 15px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

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
