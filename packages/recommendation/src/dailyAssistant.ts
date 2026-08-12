import { computeSolarEphemeris } from '../../astronomy/src/ephemeris';
import {
  computePanchangWindows,
  getActiveWindow,
  SolarWindowType,
  WeekdayIndex,
  WindowSpan,
} from '../../panchang/src/windows';
import { getActionCards } from './actionCards';

export interface DailyAssistantLocation {
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface DailyAssistantContext extends DailyAssistantLocation {
  now: Date;
  tzOffsetMinutes: number;
}

export interface DailyBriefing {
  dateLabel: string;
  briefingState: 'UPCOMING' | 'ACTIVE' | 'COMPLETED';
  peakWindow: {
    name: string;
    startTime: string;
    endTime: string;
  };
  nextWindow: {
    name: string;
    startTime: string;
    endTime: string;
    windowType: SolarWindowType;
  } | null;
  otherFavorableWindows: Array<{
    name: string;
    startTime: string;
    endTime: string;
    windowType: SolarWindowType;
    state: 'UPCOMING' | 'ACTIVE' | 'COMPLETED';
  }>;
  nextAction: string;
  greenLight: {
    title: string;
    description: string;
    windowType: SolarWindowType;
  };
  notificationText: string;
  widgetText: string;
  activeWindow: SolarWindowType;
}

export interface TaskSlotRecommendation {
  taskTitle: string;
  activityType: string;
  activityIcon: string;
  activityFit: 'IDEAL' | 'SUITABLE' | 'NEUTRAL' | 'UNSUITABLE';
  timeStatus: 'NOW' | 'UPCOMING' | 'SCHEDULED';
  windowQuality: 'BEST' | 'GOOD' | 'NEUTRAL' | 'AVOID';
  durationMinutes: number;
  durationFits: boolean;
  availableMinutes: number;
  recommendationState: 'BEST_NOW' | 'BETTER_LATER' | 'NEXT_BEST' | 'SCHEDULED' | 'AVOID' | 'NO_FIT';
  recommendationLabel: string;
  bestWindowToday: {
    startMinute: number;
    endMinute: number;
    startTime: string;
    endTime: string;
    startsInMinutes: number;
    label: string;
    reason: string;
    googleCalendarUrl: string;
  } | null;
  bestWindow: {
    startMinute: number;
    endMinute: number;
    startTime: string;
    endTime: string;
    label: string;
    reason: string;
  };
  avoidWindow: {
    startMinute: number;
    endMinute: number;
    startTime: string;
    endTime: string;
    label: string;
    reason: string;
  } | null;
  calendar: {
    title: string;
    startsAtLocal: string;
    endsAtLocal: string;
    googleCalendarUrl: string;
  };
}

export function computeAssistantWindows(context: DailyAssistantContext): WindowSpan[] {
  const localDate = localDateForContext(context);
  const solar = computeSolarEphemeris({
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
    latitude: context.latitude,
    longitude: context.longitude,
    tzOffsetMinutes: context.tzOffsetMinutes,
  });

  return computePanchangWindows(solar, localDate.getUTCDay() as WeekdayIndex);
}

export function buildDailyBriefing(context: DailyAssistantContext): DailyBriefing {
  const windows = computeAssistantWindows(context);
  const localDate = localDateForContext(context);
  const minuteOfDay = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
  const activeWindow = getActiveWindow(windows, minuteOfDay);
  const peak = findWindow(windows, 'ABHIJIT') ?? windows[0];
  const action = getActionCards(peak?.type ?? activeWindow)[0] ?? getActionCards(activeWindow)[0];
  const peakName = peak?.label ?? 'Peak Solar Window';
  const peakStart = formatMinute(peak?.startMinutes ?? 720);
  const peakEnd = formatMinute(peak?.endMinutes ?? 780);
  const briefingState = activeWindow === peak?.type
    ? 'ACTIVE'
    : minuteOfDay < (peak?.startMinutes ?? 720)
      ? 'UPCOMING'
      : 'COMPLETED';
  const next = findNextFavorableWindow(windows, minuteOfDay, peak?.type);
  const nextWindow = next
    ? {
        name: next.label,
        startTime: formatMinute(next.startMinutes),
        endTime: formatMinute(next.endMinutes),
        windowType: next.type,
      }
    : null;
  const otherFavorableWindows = windows
    .filter((window) => window.type !== peak?.type && window.type !== 'RAHU_KALAM' && window.type !== 'YAMA')
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((window) => ({
      name: window.label,
      startTime: formatMinute(window.startMinutes),
      endTime: formatMinute(window.endMinutes),
      windowType: window.type,
      state: minuteOfDay >= window.startMinutes && minuteOfDay <= window.endMinutes
        ? 'ACTIVE' as const
        : minuteOfDay < window.startMinutes
          ? 'UPCOMING' as const
          : 'COMPLETED' as const,
    }));

  return {
    dateLabel: localDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }),
    briefingState,
    peakWindow: {
      name: peakName,
      startTime: peakStart,
      endTime: peakEnd,
    },
    greenLight: {
      title: action.title,
      description: action.description,
      windowType: peak?.type ?? activeWindow,
    },
    nextWindow,
    otherFavorableWindows,
    nextAction: buildNextAction(briefingState, action.title, nextWindow),
    notificationText: `Good morning. Today's peak focus window begins at ${peakStart}. ${action.title} is your top green light.`,
    widgetText: `${peakName}: ${peakStart} - ${peakEnd}`,
    activeWindow,
  };
}

function localDateForContext(context: DailyAssistantContext): Date {
  return new Date(context.now.getTime() + context.tzOffsetMinutes * 60 * 1000);
}

function findNextFavorableWindow(
  windows: WindowSpan[],
  minuteOfDay: number,
  peakType?: SolarWindowType
): WindowSpan | undefined {
  return [...windows]
    .filter((window) => window.type !== 'RAHU_KALAM' && window.type !== 'YAMA' && window.type !== peakType)
    .filter((window) => window.startMinutes > minuteOfDay)
    .sort((a, b) => a.startMinutes - b.startMinutes)[0];
}

function buildNextAction(
  state: DailyBriefing['briefingState'],
  actionTitle: string,
  nextWindow: DailyBriefing['nextWindow']
): string {
  if (state === 'UPCOMING') return `Prepare ${actionTitle.toLowerCase()} for the peak window.`;
  if (state === 'ACTIVE') return `Do your highest-value ${actionTitle.toLowerCase()} now.`;
  if (nextWindow) return `Shift to ${nextWindow.name.toLowerCase()} work at ${nextWindow.startTime}.`;
  return "Today's key windows are complete. Shift to lower-intensity tasks and recovery.";
}

export function recommendTaskSlot(
  taskTitle: string,
  context: DailyAssistantContext,
  durationMinutes = 30,
  requestedStartMinute?: number
): TaskSlotRecommendation {
  const safeDuration = Math.min(180, Math.max(15, Math.round(durationMinutes)));
  const cleanTitle = normalizeTaskTitle(taskTitle);
  const windows = computeAssistantWindows(context);
  const localDate = localDateForContext(context);
  const currentMinute = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
  const profile = classifyTask(cleanTitle);
  const candidates = buildSlotCandidates(windows);
  const targetMinute = requestedStartMinute === undefined ? currentMinute : clampMinute(requestedStartMinute);
  const targetCandidate = candidates.find((candidate) => containsMinute(candidate, targetMinute));

  if (requestedStartMinute !== undefined && targetCandidate && isFriction(targetCandidate.type) && profile.significance === 'HIGH') {
    if (targetCandidate.endMinute - targetMinute < safeDuration) {
      return buildTaskRecommendation(cleanTitle, profile, 'NO_FIT', targetCandidate, targetMinute, safeDuration, context, windows);
    }
    return buildTaskRecommendation(cleanTitle, profile, 'AVOID', targetCandidate, targetMinute, safeDuration, context, windows);
  }
  if (requestedStartMinute !== undefined && targetCandidate) {
    if (targetCandidate.endMinute - targetMinute < safeDuration) {
      return buildTaskRecommendation(cleanTitle, profile, 'NO_FIT', targetCandidate, targetMinute, safeDuration, context, windows);
    }
    return buildTaskRecommendation(cleanTitle, profile, 'SCHEDULED', targetCandidate, targetMinute, safeDuration, context, windows);
  }

  const currentCandidate = candidates.find((candidate) => containsMinute(candidate, currentMinute));
  const currentIsUsable = currentCandidate && (
    currentCandidate.endMinute - currentMinute >= safeDuration &&
    (profile.significance === 'LOW' || !isFriction(currentCandidate.type))
  );
  const bestFuture = candidates
    .filter((candidate) => candidate.startMinute > currentMinute && candidate.endMinute - candidate.startMinute >= safeDuration && scoreCandidate(candidate, profile) >= 0)
    .sort((a, b) => scoreCandidate(b, profile) - scoreCandidate(a, profile))[0];
  if (requestedStartMinute === undefined && currentCandidate && currentIsUsable) {
    return buildTaskRecommendation(cleanTitle, profile, 'BEST_NOW', currentCandidate, currentMinute, safeDuration, context, windows);
  }

  const best = bestFuture ?? candidates
    .filter((candidate) => candidate.startMinute >= currentMinute && candidate.endMinute - candidate.startMinute >= safeDuration && scoreCandidate(candidate, profile) >= 0)
    .sort((a, b) => scoreCandidate(b, profile) - scoreCandidate(a, profile))[0];
  if (bestFuture) {
    return buildTaskRecommendation(cleanTitle, profile, 'BETTER_LATER', bestFuture, bestFuture.startMinute, safeDuration, context, windows);
  }

  if (!best) {
    return buildTaskRecommendation(cleanTitle, profile, 'NO_FIT', currentCandidate ?? candidates[0], currentMinute, safeDuration, context, windows);
  }

  return buildTaskRecommendation(cleanTitle, profile, 'NEXT_BEST', best, best.startMinute, safeDuration, context, windows);
}

type TaskProfile = {
  type: string;
  icon: string;
  significance: 'LOW' | 'HIGH';
  preferredOnlyForHigh?: boolean;
  scores: Partial<Record<SolarWindowType, number>>;
  reason: string;
  neutralReason?: string;
  preferredWindows?: SolarWindowType[];
  acceptableWindows?: SolarWindowType[];
  avoidWindows?: SolarWindowType[];
};

type SlotCandidate = {
  startMinute: number;
  endMinute: number;
  type: SolarWindowType;
  label: string;
};

function buildTaskRecommendation(
  taskTitle: string,
  profile: TaskProfile,
  state: TaskSlotRecommendation['recommendationState'],
  candidate: SlotCandidate | undefined,
  startMinute: number,
  durationMinutes: number,
  context: DailyAssistantContext,
  windows: WindowSpan[]
): TaskSlotRecommendation {
  const safeCandidate = candidate ?? { startMinute, endMinute: startMinute + durationMinutes, type: 'NEUTRAL' as SolarWindowType, label: 'Neutral Flow' };
  const start = state === 'BEST_NOW' || state === 'AVOID' || state === 'SCHEDULED' || state === 'NO_FIT' || (state !== 'BETTER_LATER' && state === 'NEXT_BEST' && startMinute > safeCandidate.startMinute)
    ? startMinute
    : safeCandidate.startMinute;
  const end = Math.min(safeCandidate.endMinute, start + durationMinutes);
  const availableMinutes = Math.max(0, end - start);
  const startsAtLocal = localDateTimeForMinute(context.now, start);
  const endsAtLocal = localDateTimeForMinute(context.now, end);
  const nextAvoid = rankAvoidWindows(windows).find((window) => window.startMinutes >= start) ?? rankAvoidWindows(windows)[0] ?? null;
  const bestTodayCandidate = findBestWindowToday(windows, profile, start, durationMinutes);
  const score = scoreCandidate(safeCandidate, profile);
  const activityFit: TaskSlotRecommendation['activityFit'] = state === 'AVOID'
    ? 'UNSUITABLE'
    : safeCandidate.type === 'NEUTRAL'
      ? profile.significance === 'LOW' ? 'SUITABLE' : 'NEUTRAL'
      : score >= 90 ? 'IDEAL' : score >= 70 ? 'SUITABLE' : 'NEUTRAL';
  const windowQuality: TaskSlotRecommendation['windowQuality'] = state === 'AVOID'
    ? 'AVOID'
    : safeCandidate.type === 'NEUTRAL'
      ? 'NEUTRAL'
      : score >= 90 ? 'BEST' : score >= 70 ? 'GOOD' : 'NEUTRAL';
  const recommendationLabel = state === 'BEST_NOW'
    ? (windowQuality === 'BEST' ? 'Best Time Now' : 'Good Time Now')
    : state === 'AVOID' ? 'Not Ideal' : state === 'SCHEDULED' ? 'Scheduled Time' : state === 'NO_FIT' ? 'No Usable Window' : 'Better Later';

  return {
    taskTitle,
    activityType: profile.type,
    activityIcon: profile.icon,
    activityFit,
    timeStatus: state === 'BEST_NOW' ? 'NOW' : state === 'SCHEDULED' || state === 'AVOID' || state === 'NO_FIT' ? 'SCHEDULED' : 'UPCOMING',
    windowQuality,
    durationMinutes,
    durationFits: availableMinutes >= durationMinutes,
    availableMinutes,
    recommendationState: state,
    recommendationLabel,
    bestWindowToday: state === 'BEST_NOW' && bestTodayCandidate
      ? buildWindowTodayOption(bestTodayCandidate, profile, start, durationMinutes, context)
      : null,
    bestWindow: {
      startMinute: start,
      endMinute: end,
      startTime: formatMinute(start),
      endTime: formatMinute(end),
      label: formatWindowLabel(safeCandidate.type),
      reason: state === 'NO_FIT'
        ? `This ${durationMinutes}-minute task does not fit inside the available ${availableMinutes}-minute period.`
        : state === 'AVOID'
        ? `This falls within ${formatWindowLabel(safeCandidate.type)}. ${profile.type} is better placed in a lower-friction window.`
        : state === 'BETTER_LATER' || state === 'NEXT_BEST'
          ? `Your earlier ideal window has passed. ${reasonForProfile(safeCandidate.type, profile)}`
          : reasonForProfile(safeCandidate.type, profile),
    },
    avoidWindow: profile.significance === 'HIGH' && nextAvoid && nextAvoid.startMinutes > start
      ? { startMinute: nextAvoid.startMinutes, endMinute: nextAvoid.endMinutes, startTime: formatMinute(nextAvoid.startMinutes), endTime: formatMinute(nextAvoid.endMinutes), label: formatWindowLabel(nextAvoid.type), reason: 'High-friction window. Better for routine cleanup than fresh commitments.' }
      : null,
    calendar: { title: taskTitle, startsAtLocal, endsAtLocal, googleCalendarUrl: buildGoogleCalendarUrl(taskTitle, startsAtLocal, endsAtLocal) },
  };
}

function findBestWindowToday(
  windows: WindowSpan[],
  profile: TaskProfile,
  currentMinute: number,
  durationMinutes: number
): SlotCandidate | undefined {
  return buildSlotCandidates(windows)
    .filter((candidate) => candidate.startMinute > currentMinute)
    .filter((candidate) => candidate.type !== 'NEUTRAL' && !isFriction(candidate.type))
    .filter((candidate) => candidate.endMinute - candidate.startMinute >= durationMinutes)
    .filter((candidate) => scoreCandidate(candidate, profile) >= 85)
    .sort((a, b) => scoreCandidate(b, profile) - scoreCandidate(a, profile) || a.startMinute - b.startMinute)[0];
}

function buildWindowTodayOption(
  candidate: SlotCandidate,
  profile: TaskProfile,
  currentMinute: number,
  durationMinutes: number,
  context: DailyAssistantContext
) {
  const endMinute = Math.min(candidate.endMinute, candidate.startMinute + durationMinutes);
  const startsAtLocal = localDateTimeForMinute(context.now, candidate.startMinute);
  const endsAtLocal = localDateTimeForMinute(context.now, endMinute);
  return {
    startMinute: candidate.startMinute,
    endMinute,
    startTime: formatMinute(candidate.startMinute),
    endTime: formatMinute(endMinute),
    startsInMinutes: Math.max(0, candidate.startMinute - currentMinute),
    label: formatWindowLabel(candidate.type),
    reason: reasonForProfile(candidate.type, profile),
    googleCalendarUrl: buildGoogleCalendarUrl(profile.type, startsAtLocal, endsAtLocal),
  };
}

function buildSlotCandidates(windows: WindowSpan[]): SlotCandidate[] {
  const candidates: SlotCandidate[] = windows.map((window) => ({ startMinute: window.startMinutes, endMinute: window.endMinutes, type: window.type, label: window.label }));
  const boundaries = [0, ...windows.flatMap((window) => [window.startMinutes, window.endMinutes]), 1440].sort((a, b) => a - b);
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMinute = boundaries[index];
    const endMinute = boundaries[index + 1];
    const midpoint = startMinute + (endMinute - startMinute) / 2;
    if (endMinute > startMinute && !windows.some((window) => containsMinute(window, midpoint))) {
      candidates.push({ startMinute, endMinute, type: 'NEUTRAL', label: 'Neutral Flow' });
    }
  }
  return candidates;
}

function scoreCandidate(candidate: SlotCandidate, profile: TaskProfile): number {
  if (isFriction(candidate.type)) return profile.significance === 'LOW' ? 20 : -100;
  return profile.scores[candidate.type] ?? 55;
}

function containsMinute(window: { startMinutes?: number; endMinutes?: number; startMinute?: number; endMinute?: number }, minute: number): boolean {
  const start = window.startMinute ?? window.startMinutes;
  const end = window.endMinute ?? window.endMinutes;
  if (start === undefined || end === undefined) return false;
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

function isFriction(type: SolarWindowType): boolean {
  return type === 'RAHU_KALAM' || type === 'YAMA';
}

function clampMinute(minute: number): number {
  return Math.min(1439, Math.max(0, Math.round(minute)));
}

function findWindow(windows: WindowSpan[], type: SolarWindowType): WindowSpan | undefined {
  return windows.find((window) => window.type === type);
}

function rankAvoidWindows(windows: WindowSpan[]): WindowSpan[] {
  return [...windows]
    .filter((window) => window.type === 'RAHU_KALAM' || window.type === 'YAMA')
    .sort((a, b) => (a.type === 'RAHU_KALAM' ? -1 : 1) - (b.type === 'RAHU_KALAM' ? -1 : 1));
}

function classifyTask(taskTitle: string): TaskProfile {
  const title = taskTitle.toLowerCase();
  if (/(tea|coffee|break|snack)/.test(title)) return { type: 'Tea break', icon: '☕', significance: 'LOW', scores: { NEUTRAL: 90, GULIKA: 65 }, reason: 'A short reset fits well here.', neutralReason: 'A short break does not require an auspicious starting window.', preferredWindows: ['NEUTRAL', 'GULIKA'], acceptableWindows: ['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'YAMA'] };
  if (/(rest|nap|recover|sleep|wind down)/.test(title)) return { type: 'Rest', icon: '😴', significance: 'LOW', scores: { NEUTRAL: 90, BRAHMA: 70 }, reason: 'A recovery period supports rest and reset.', neutralReason: 'Recovery and low-stimulation time fit well here.', preferredWindows: ['NEUTRAL', 'BRAHMA'], acceptableWindows: ['GULIKA', 'ABHIJIT'] };
  if (/(meditat|breath|mindful|prayer)/.test(title)) return { type: 'Meditation', icon: '🧘', significance: 'LOW', scores: { BRAHMA: 100, NEUTRAL: 85 }, reason: 'A calmer period supports reflection and reset.', neutralReason: 'A quiet neutral period is suitable for stillness.', preferredWindows: ['BRAHMA', 'NEUTRAL'], acceptableWindows: ['GULIKA', 'ABHIJIT'] };
  if (/(workout|training|lift|lifting|run|gym|exercise|heavy)/.test(title)) return { type: 'Heavy workout', icon: '🏋️', significance: 'HIGH', preferredOnlyForHigh: true, scores: { ABHIJIT: 100, NEUTRAL: 62, GULIKA: 58 }, reason: 'Peak solar energy supports high physical output.', neutralReason: 'A neutral period is suitable for a workout, although it is not a peak-performance window.', preferredWindows: ['ABHIJIT', 'NEUTRAL'], acceptableWindows: ['GULIKA', 'BRAHMA'], avoidWindows: ['RAHU_KALAM', 'YAMA'] };
  if (/(deep work|focus|coding|code|research|study|write|writing)/.test(title)) return { type: 'Deep work', icon: '🧠', significance: 'HIGH', preferredOnlyForHigh: true, scores: { ABHIJIT: 100, BRAHMA: 94, NEUTRAL: 66, GULIKA: 60 }, reason: 'Good conditions support sustained concentration.', neutralReason: 'A neutral period can support focused work without a special Panchang advantage.', preferredWindows: ['ABHIJIT', 'BRAHMA'], acceptableWindows: ['NEUTRAL', 'GULIKA'], avoidWindows: ['RAHU_KALAM', 'YAMA'] };
  if (/(meeting|1-on-1|one-on-one|call|interview|pitch|presentation|decision)/.test(title)) return { type: 'Important meeting', icon: '💼', significance: 'HIGH', preferredOnlyForHigh: true, scores: { ABHIJIT: 96, GULIKA: 76, NEUTRAL: 70 }, reason: 'A favorable window supports clear communication and decisive outcomes.', neutralReason: 'A neutral period is workable for a meeting, without a special advantage.', preferredWindows: ['ABHIJIT'], acceptableWindows: ['GULIKA', 'NEUTRAL'], avoidWindows: ['RAHU_KALAM', 'YAMA'] };
  if (/(creative|brainstorm|design|idea)/.test(title)) return { type: 'Creative work', icon: '✍️', significance: 'HIGH', scores: { ABHIJIT: 88, BRAHMA: 84, NEUTRAL: 78, GULIKA: 70 }, reason: 'Favorable flow gives creative work room to develop.', neutralReason: 'A neutral period is still suitable for creative work.', preferredWindows: ['ABHIJIT', 'BRAHMA', 'NEUTRAL'], acceptableWindows: ['GULIKA'], avoidWindows: ['RAHU_KALAM', 'YAMA'] };
  if (/(admin|email|communication|inbox|message|invoice|cleanup|organize|errand|expense|filing|paperwork|documentation|docs|document)/.test(title)) return { type: 'Admin', icon: '📋', significance: 'LOW', scores: { NEUTRAL: 90, GULIKA: 82 }, reason: 'Routine work fits well here.', neutralReason: 'Suitable for routine, lower-intensity work.', preferredWindows: ['NEUTRAL', 'GULIKA'], acceptableWindows: ['RAHU_KALAM', 'YAMA', 'BRAHMA', 'ABHIJIT'] };
  return { type: 'Focused work', icon: '🎯', significance: 'HIGH', preferredOnlyForHigh: true, scores: { ABHIJIT: 95, BRAHMA: 84, NEUTRAL: 68, GULIKA: 62 }, reason: 'A favorable window supports focused execution.', neutralReason: 'A neutral period is usable for focused work, without a meaningful Panchang advantage.', preferredWindows: ['ABHIJIT', 'BRAHMA'], acceptableWindows: ['NEUTRAL', 'GULIKA'], avoidWindows: ['RAHU_KALAM', 'YAMA'] };
}

function reasonForProfile(windowType: SolarWindowType, profile: TaskProfile): string {
  if (windowType === 'ABHIJIT') return profile.reason;
  if (windowType === 'BRAHMA') return profile.type === 'Meditation' ? profile.reason : 'Quiet pre-dawn energy supports calm, deliberate work.';
  if (windowType === 'GULIKA') return 'Steady compounding energy suits practice, follow-through, and repeatable work.';
  if (isFriction(windowType)) return profile.significance === 'LOW' ? (profile.neutralReason ?? profile.reason) : 'Better later for this significant activity; routine work is fine during this period.';
  if (windowType === 'NEUTRAL') return profile.neutralReason ?? profile.reason;
  return profile.reason;
}

function normalizeTaskTitle(taskTitle: string): string {
  const trimmed = String(taskTitle || '').replace(/\s+/g, ' ').trim();
  return trimmed || 'Focused work block';
}

function formatWindowLabel(type: SolarWindowType): string {
  if (type === 'ABHIJIT') return 'Abhijit Muhurta';
  if (type === 'BRAHMA') return 'Brahma Muhurta';
  if (type === 'GULIKA') return 'Gulika steady window';
  if (type === 'RAHU_KALAM') return 'Rahu Kalam';
  if (type === 'YAMA') return 'Yama Gandam';
  return 'Neutral Flow';
}

export function formatMinute(totalMinutes: number): string {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

function localDateTimeForMinute(date: Date, minuteOfDay: number): string {
  const local = new Date(date);
  local.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return local.toISOString();
}

function buildGoogleCalendarUrl(title: string, startsAtIso: string, endsAtIso: string): string {
  const compact = (value: string) => value.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${compact(startsAtIso)}/${compact(endsAtIso)}`,
    details: 'Scheduled by AuraSchedule during a recommended solar flow window.',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
