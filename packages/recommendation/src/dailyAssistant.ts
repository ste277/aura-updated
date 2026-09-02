import { computeSolarEphemeris } from '../../astronomy/src/ephemeris';
import {
  computePanchangWindows,
  getActiveWindow,
  SolarWindowType,
  WeekdayIndex,
  WindowSpan,
} from '../../panchang/src/windows';
import { evaluateMuhurta, MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';
import type { MuhurtaClassification } from '../../muhurta/src/activityOntology';
import { getActionCards } from './actionCards';
import { ActivityProfile, findActivityIntent } from './personalizedTasks';
import { evaluateActivityFit, familyForActivityProfile, PersonalMuhurtaContext } from './auraFitEngine';
import { getActivityDefinition } from './activityDefinitions';

export interface DailyAssistantLocation {
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface DailyAssistantContext extends DailyAssistantLocation {
  now: Date;
  tzOffsetMinutes: number;
  personalContext?: PersonalMuhurtaContext;
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
  planningOptions?: Array<{
    dateLabel: string;
    startTime: string;
    endTime: string;
    startsAtLocal: string;
    endsAtLocal: string;
    score: number;
    quality: 'STRONG' | 'GOOD' | 'USABLE';
    summary: string;
    googleCalendarUrl: string;
  }>;
}

export type PlanningHorizon = 'NOW' | 'TODAY' | 'TOMORROW' | 'WEEKEND' | 'SEVEN_DAYS' | 'CUSTOM';
export type TimePreference = 'ANYTIME' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT' | 'WORK_HOURS';
type PlanningOption = NonNullable<TaskSlotRecommendation['planningOptions']>[number];
type ScoredPlanningOption = PlanningOption & {
  dayOffset: number;
  startMinute: number;
  rawScore: number;
};

export function computeAssistantWindows(context: DailyAssistantContext): WindowSpan[] {
  const resolvedContext = resolveContextOffset(context);
  const localDate = localDateForContext(context);
  const solar = computeSolarEphemeris({
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
    latitude: resolvedContext.latitude,
    longitude: resolvedContext.longitude,
    tzOffsetMinutes: resolvedContext.tzOffsetMinutes,
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
      timeZone: 'UTC',
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

function resolveTzOffsetMinutes(timezone: string, date: Date): number | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const offsetPart = dtf.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+0';
    const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!match) return 0;

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = match[3] ? Number(match[3]) : 0;
    return sign * (hours * 60 + minutes);
  } catch {
    return null;
  }
}

function resolveContextOffset(context: DailyAssistantContext): DailyAssistantContext {
  const offset = resolveTzOffsetMinutes(context.timezone, context.now);
  return offset === null || offset === context.tzOffsetMinutes
    ? context
    : { ...context, tzOffsetMinutes: offset };
}

export function contextForDayOffset(context: DailyAssistantContext, dayOffset: number): DailyAssistantContext {
  if (dayOffset === 0) return resolveContextOffset(context);

  const localDate = localDateForContext(context);
  const targetLocalTimestamp = Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate() + dayOffset,
    localDate.getUTCHours(),
    localDate.getUTCMinutes(),
    localDate.getUTCSeconds(),
    localDate.getUTCMilliseconds()
  );
  const targetNow = localTimestampToUtcInstant(context.timezone, targetLocalTimestamp, context.tzOffsetMinutes);
  return resolveContextOffset({ ...context, now: targetNow });
}

export function localDateForContext(context: DailyAssistantContext): Date {
  const resolved = resolveContextOffset(context);
  return new Date(resolved.now.getTime() + resolved.tzOffsetMinutes * 60 * 1000);
}

function localTimestampToUtcInstant(timezone: string, localTimestamp: number, fallbackOffsetMinutes: number): Date {
  const firstGuess = new Date(localTimestamp - fallbackOffsetMinutes * 60 * 1000);
  const firstOffset = resolveTzOffsetMinutes(timezone, firstGuess) ?? fallbackOffsetMinutes;
  const secondGuess = new Date(localTimestamp - firstOffset * 60 * 1000);
  const secondOffset = resolveTzOffsetMinutes(timezone, secondGuess) ?? firstOffset;
  return new Date(localTimestamp - secondOffset * 60 * 1000);
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
  const safeDuration = Math.min(360, Math.max(15, Math.round(durationMinutes)));
  const cleanTitle = normalizeTaskTitle(taskTitle);
  const windows = computeAssistantWindows(context);
  const localDate = localDateForContext(context);
  const currentMinute = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
  const profile = classifyTask(cleanTitle);
  profile.personalContext = context.personalContext;
  const candidates = buildSlotCandidates(windows);
  const targetMinute = requestedStartMinute === undefined ? currentMinute : clampMinute(requestedStartMinute);
  const targetCandidate = candidates.find((candidate) => containsMinute(candidate, targetMinute));

  if (requestedStartMinute !== undefined && targetCandidate && isFriction(targetCandidate.type) && profile.significance !== 'LOW') {
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
    .filter((candidate) => candidate.startMinute > currentMinute && candidate.endMinute - candidate.startMinute >= safeDuration && scoreCandidate(candidate, profile, localInstantForMinute(context, candidate.startMinute)) >= 0)
    .sort((a, b) => scoreCandidate(b, profile, localInstantForMinute(context, b.startMinute)) - scoreCandidate(a, profile, localInstantForMinute(context, a.startMinute)))[0];
  if (requestedStartMinute === undefined && currentCandidate && currentIsUsable) {
    return buildTaskRecommendation(cleanTitle, profile, 'BEST_NOW', currentCandidate, currentMinute, safeDuration, context, windows);
  }

  const best = bestFuture ?? candidates
    .filter((candidate) => candidate.startMinute >= currentMinute && candidate.endMinute - candidate.startMinute >= safeDuration && scoreCandidate(candidate, profile, localInstantForMinute(context, candidate.startMinute)) >= 0)
    .sort((a, b) => scoreCandidate(b, profile, localInstantForMinute(context, b.startMinute)) - scoreCandidate(a, profile, localInstantForMinute(context, a.startMinute)))[0];
  if (bestFuture) {
    return buildTaskRecommendation(cleanTitle, profile, 'BETTER_LATER', bestFuture, bestFuture.startMinute, safeDuration, context, windows);
  }

  if (!best) {
    return buildTaskRecommendation(cleanTitle, profile, 'NO_FIT', currentCandidate ?? candidates[0], currentMinute, safeDuration, context, windows);
  }

  return buildTaskRecommendation(cleanTitle, profile, 'NEXT_BEST', best, best.startMinute, safeDuration, context, windows);
}

export function findOptimalTaskTimes(
  taskTitle: string,
  context: DailyAssistantContext,
  durationMinutes = 30,
  horizon: PlanningHorizon = 'TODAY',
  customStartDate?: string,
  customEndDate?: string,
  timePreference: TimePreference = 'ANYTIME'
): TaskSlotRecommendation {
  const safeDuration = Math.min(360, Math.max(15, Math.round(durationMinutes)));
  const cleanTitle = normalizeTaskTitle(taskTitle);
  const profile = classifyTask(cleanTitle);
  profile.personalContext = context.personalContext;
  const current = localDateForContext(context);
  const searchOffsets = resolveHorizonDayOffsets(horizon, context, customStartDate, customEndDate);
  const fallbackDayOffset = searchOffsets[0] ?? (horizon === 'TOMORROW' ? 1 : 0);
  const options: ScoredPlanningOption[] = [];
  const currentMinute = current.getUTCHours() * 60 + current.getUTCMinutes();
  for (const day of searchOffsets) {
    const dayContext = contextForDayOffset(context, day);
    const localDay = localDateForContext(dayContext);
    const windows = computeAssistantWindows(dayContext);
    const candidates = buildSlotCandidates(windows);
    const dayStart = day === 0 ? currentMinute : 0;
    const maxStart = 1440 - safeDuration;
    for (let start = dayStart; start <= maxStart; start += 15) {
      if (!matchesTimePreference(start, timePreference)) continue;
      const score = scoreContinuousBlock(candidates, profile, start, start + safeDuration, (minute) => localInstantForMinute(dayContext, minute));
      if (score < 0) continue;
      const startsAtLocal = localDateTimeForMinute(dayContext, start);
      const endsAtLocal = localDateTimeForMinute(dayContext, start + safeDuration);
      options.push({
        dateLabel: localDay.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
        startTime: formatMinute(start),
        endTime: formatMinute(start + safeDuration),
        startsAtLocal,
        endsAtLocal,
        score: Math.round(score * 10) / 10,
        dayOffset: day,
        rawScore: score,
        startMinute: start,
        quality: score >= 85 ? 'STRONG' : score >= 65 ? 'GOOD' : 'USABLE',
        summary: buildPlanSummary(candidates, profile, start, start + safeDuration, localInstantForMinute(dayContext, start)),
        googleCalendarUrl: buildGoogleCalendarUrl(cleanTitle, startsAtLocal, endsAtLocal),
      });
    }
  }
  const selectedScored = horizon === 'SEVEN_DAYS'
    ? selectDailyBestPlanningOptions(options, searchOffsets.length)
    : selectDiversePlanningOptions(options);
  const ranked = selectedScored
    .map(({ dayOffset: _dayOffset, rawScore: _rawScore, startMinute: _startMinute, ...option }) => option);
  const bestScored = [...selectedScored].sort((a, b) => b.rawScore - a.rawScore)[0];
  if (!bestScored) return { ...recommendTaskSlot(cleanTitle, contextForDayOffset(context, fallbackDayOffset), safeDuration), planningOptions: [] };
  const base = recommendTaskSlot(cleanTitle, contextForDayOffset(context, bestScored.dayOffset), safeDuration, bestScored.startMinute);
  return { ...base, planningOptions: ranked };
}

/**
 * Named-horizon -> day-offsets adapter, extracted verbatim from
 * findOptimalTaskTimes's original inline computation (zero behavior change,
 * still the only caller-facing horizon logic) so packages/recommendation/src/
 * timingSearch.ts can resolve the same horizons without re-deriving this math.
 */
export function resolveHorizonDayOffsets(
  horizon: PlanningHorizon,
  context: DailyAssistantContext,
  customStartDate?: string,
  customEndDate?: string
): number[] {
  const days = horizon === 'NOW' || horizon === 'TODAY' ? 1 : horizon === 'TOMORROW' ? 1 : horizon === 'WEEKEND' ? 2 : 7;
  const dayOffset = horizon === 'TOMORROW' ? 1 : 0;
  const current = localDateForContext(context);
  const currentDayOfWeek = current.getUTCDay();
  const customOffsets = horizon === 'CUSTOM' && customStartDate && customEndDate
    ? buildDateOffsets(current, customStartDate, customEndDate)
    : [];
  const weekendOffsets = horizon === 'WEEKEND'
    ? [
        (6 - currentDayOfWeek + 7) % 7,
        (7 - currentDayOfWeek + 7) % 7,
      ].map((offset, index) => offset === 0 && index === 0 && currentDayOfWeek === 0 ? 7 : offset)
    : [];
  return horizon === 'CUSTOM'
    ? customOffsets
    : horizon === 'WEEKEND'
    ? weekendOffsets
    : Array.from({ length: days }, (_, index) => dayOffset + index);
}

export function findBestTimeForActivity(params: {
  activity: string;
  context: DailyAssistantContext;
  durationMinutes?: number;
  horizon?: PlanningHorizon;
  customStartDate?: string;
  customEndDate?: string;
  timePreference?: TimePreference;
}): TaskSlotRecommendation {
  return findOptimalTaskTimes(
    params.activity,
    params.context,
    params.durationMinutes,
    params.horizon,
    params.customStartDate,
    params.customEndDate,
    params.timePreference
  );
}

/** Generic over any shape carrying these three fields so
 * packages/recommendation/src/timingSearch.ts can rank its own
 * TimingCandidate[] with the exact same day-diversity rule as
 * findOptimalTaskTimes's SEVEN_DAYS path, instead of a second
 * implementation. Runtime behavior for the existing ScoredPlanningOption
 * caller below is unchanged -- this is a type-only generalization. */
export function selectDailyBestPlanningOptions<T extends { dateLabel: string; startMinute: number; rawScore: number }>(options: T[], limit: number): T[] {
  const byDate = new Map<string, T>();
  for (const option of options) {
    const existing = byDate.get(option.dateLabel);
    if (!existing || option.rawScore > existing.rawScore || (option.rawScore === existing.rawScore && option.startMinute < existing.startMinute)) {
      byDate.set(option.dateLabel, option);
    }
  }
  return Array.from(byDate.values()).slice(0, limit);
}

/** Generic for the same reason as selectDailyBestPlanningOptions above --
 * this is the diversity/dedup strategy: sort by score, drop exact
 * date+time duplicates, then greedily pick options that don't repeat a
 * clock time within 90 minutes or repeat a date already picked, relaxing
 * those two constraints in two more passes if too few survive. */
export function selectDiversePlanningOptions<T extends { dateLabel: string; startMinute: number; rawScore: number; startTime: string }>(options: T[], limit = 3): T[] {
  const ranked = options
    .sort((a, b) => b.rawScore - a.rawScore || a.startMinute - b.startMinute)
    .filter((option, index, list) => list.findIndex((item) => item.dateLabel === option.dateLabel && item.startTime === option.startTime) === index);
  const selected: T[] = [];
  for (const option of ranked) {
    const repeatsClockTime = selected.some((item) => Math.abs(item.startMinute - option.startMinute) < 90);
    const repeatsDate = selected.some((item) => item.dateLabel === option.dateLabel);
    if (!repeatsClockTime && !repeatsDate) selected.push(option);
    if (selected.length === limit) return selected;
  }
  for (const option of ranked) {
    const repeatsClockTime = selected.some((item) => Math.abs(item.startMinute - option.startMinute) < 90);
    if (!repeatsClockTime && !selected.includes(option)) selected.push(option);
    if (selected.length === limit) return selected;
  }
  for (const option of ranked) {
    if (!selected.includes(option)) selected.push(option);
    if (selected.length === limit) return selected;
  }
  return selected;
}

export function matchesTimePreference(startMinute: number, preference: TimePreference): boolean {
  const hour = Math.floor(startMinute / 60);
  if (preference === 'MORNING') return hour >= 5 && hour < 12;
  if (preference === 'AFTERNOON') return hour >= 12 && hour < 17;
  if (preference === 'EVENING') return hour >= 17 && hour < 21;
  if (preference === 'NIGHT') return hour >= 21 || hour < 5;
  if (preference === 'WORK_HOURS') return hour >= 9 && hour < 18;
  return true;
}

export function buildDateOffsets(current: Date, startDate: string, endDate: string): number[] {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || end < start) return [];
  const currentDay = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  const offsets: number[] = [];
  for (let day = start; day <= end; day += 86400000) {
    offsets.push(Math.round((day - currentDay) / 86400000));
  }
  return offsets;
}

function parseDateOnly(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(timestamp);
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? timestamp : null;
}

export function scoreContinuousBlock(
  candidates: SlotCandidate[],
  profile: TaskProfile,
  start: number,
  end: number,
  dateForMinute?: (minute: number) => Date
): number {
  const boundaries = [...new Set([start, end, ...candidates.flatMap((candidate) => [candidate.startMinute, candidate.endMinute]).filter((minute) => minute > start && minute < end)])].sort((a, b) => a - b);
  let weighted = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const segmentStart = boundaries[index];
    const segmentEnd = boundaries[index + 1];
    const candidate = candidates.find((item) => containsMinute(item, segmentStart));
    const segmentScore = candidate ? scoreCandidate(candidate, profile, dateForMinute?.(segmentStart)) : 55;
    // Everyday Timing Flexibility V1: this block-level friction guard predates
    // muhurtaClassification and used the legacy `significance` field (which
    // conflates "important task" with "commencement-sensitive activity" --
    // e.g. Deep Work/Workout are legacy significance:'HIGH' but everyday-depth).
    // When a catalog activity's classification is available, defer to the
    // same isTimingSensitiveActivity() signal scoreCandidate() already uses,
    // so the two layers can't disagree; fall back to the legacy check only
    // for non-catalog free-text tasks, which have no classification at all.
    const isFrictionSegment = isFriction(candidate?.type ?? 'NEUTRAL');
    const blocksOnFriction = profile.muhurtaClassification
      ? isTimingSensitiveActivity(profile.muhurtaClassification)
      : profile.significance === 'HIGH' || profile.requiresFreshStart;
    if (isFrictionSegment && blocksOnFriction) return -1;
    weighted += segmentScore * (segmentEnd - segmentStart);
  }
  return weighted / (end - start);
}

function buildPlanSummary(candidates: SlotCandidate[], profile: TaskProfile, start: number, end: number, startDate?: Date): string {
  const overlapping = candidates.filter((candidate) => candidate.startMinute < end && candidate.endMinute > start);
  const types = [...new Set(overlapping.map((candidate) => formatWindowLabel(candidate.type)))];
  const frictionMinutes = overlapping.filter((candidate) => isFriction(candidate.type)).reduce((total, candidate) => total + Math.max(0, Math.min(end, candidate.endMinute) - Math.max(start, candidate.startMinute)), 0);
  const muhurta = startDate && overlapping[0] ? evaluateCandidateMuhurta(overlapping[0], profile, startDate).summary : '';
  if (frictionMinutes > 0) return appendMuhurtaSummary(`Mixed quality. This block includes ${frictionMinutes} minutes of higher-friction timing.`, muhurta);
  if (types.length === 1 && types[0] === 'Neutral Flow') return appendMuhurtaSummary('Usable stretch. The full period is Neutral Flow.', muhurta);
  if (types.length === 1) return appendMuhurtaSummary(`Clean ${end - start >= 60 ? `${(end - start) / 60}-hour` : `${end - start}-minute`} stretch in ${types[0]}.`, muhurta);
  return appendMuhurtaSummary(`Strong start, steady finish across ${types.join(' + ')}. No high-friction overlap.`, muhurta);
}

function parseTime(value: string): number {
  const match = value.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 0;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  return hour * 60 + Number(match[2]);
}

export type TaskProfile = {
  activityId?: string;
  type: string;
  icon: string;
  family?: MuhurtaActivityFamily;
  significance: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresFreshStart?: boolean;
  preferredOnlyForHigh?: boolean;
  scores: Partial<Record<SolarWindowType, number>>;
  reason: string;
  neutralReason?: string;
  preferredWindows?: SolarWindowType[];
  acceptableWindows?: SolarWindowType[];
  avoidWindows?: SolarWindowType[];
  activity?: ActivityProfile;
  personalContext?: PersonalMuhurtaContext;
  /** Resolved from activityDefinitions.ts's ActivityDefinition when
   * `activity` is a known catalog activity (see profileFromActivity below).
   * Threaded into evaluateActivityFit() by scoreCandidate() so the
   * rule-pack-aware evaluation path (muhurtaRulePacks.ts) can run when the
   * legacy family has no legitimate data -- see auraFitEngine.ts's own doc
   * comment on evaluateActivityFit's `classification` param. */
  muhurtaClassification?: MuhurtaClassification;
};

export type SlotCandidate = {
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
  const startsAtLocal = localDateTimeForMinute(context, start);
  const endsAtLocal = localDateTimeForMinute(context, end);
  const nextAvoid = rankAvoidWindows(windows).find((window) => window.startMinutes >= start) ?? rankAvoidWindows(windows)[0] ?? null;
  const startDate = localInstantForMinute(context, start);
  const bestTodayCandidate = findBestWindowToday(windows, profile, start, durationMinutes, context);
  const score = scoreCandidate(safeCandidate, profile, startDate);
  const muhurta = evaluateCandidateMuhurta(safeCandidate, profile, startDate);
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
        : appendMuhurtaSummary(
            state === 'BETTER_LATER' || state === 'NEXT_BEST'
              ? `Your earlier ideal window has passed. ${reasonForProfile(safeCandidate.type, profile)}`
              : reasonForProfile(safeCandidate.type, profile),
            muhurta.summary
          ),
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
  durationMinutes: number,
  context: DailyAssistantContext
): SlotCandidate | undefined {
  return buildSlotCandidates(windows)
    .filter((candidate) => candidate.startMinute > currentMinute)
    .filter((candidate) => candidate.type !== 'NEUTRAL' && !isFriction(candidate.type))
    .filter((candidate) => candidate.endMinute - candidate.startMinute >= durationMinutes)
    .filter((candidate) => scoreCandidate(candidate, profile, localInstantForMinute(context, candidate.startMinute)) >= 85)
    .sort((a, b) => scoreCandidate(b, profile, localInstantForMinute(context, b.startMinute)) - scoreCandidate(a, profile, localInstantForMinute(context, a.startMinute)) || a.startMinute - b.startMinute)[0];
}

function buildWindowTodayOption(
  candidate: SlotCandidate,
  profile: TaskProfile,
  currentMinute: number,
  durationMinutes: number,
  context: DailyAssistantContext
) {
  const endMinute = Math.min(candidate.endMinute, candidate.startMinute + durationMinutes);
  const startsAtDate = localInstantForMinute(context, candidate.startMinute);
  const startsAtLocal = localDateTimeForMinute(context, candidate.startMinute);
  const endsAtLocal = localDateTimeForMinute(context, endMinute);
  return {
    startMinute: candidate.startMinute,
    endMinute,
    startTime: formatMinute(candidate.startMinute),
    endTime: formatMinute(endMinute),
    startsInMinutes: Math.max(0, candidate.startMinute - currentMinute),
    label: formatWindowLabel(candidate.type),
    reason: appendMuhurtaSummary(reasonForProfile(candidate.type, profile), evaluateCandidateMuhurta(candidate, profile, startsAtDate).summary),
    googleCalendarUrl: buildGoogleCalendarUrl(profile.type, startsAtLocal, endsAtLocal),
  };
}

export function buildSlotCandidates(windows: WindowSpan[]): SlotCandidate[] {
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

/** Everyday Timing Flexibility V1: for everyday/reversible activities,
 * Panchang should RANK real availability rather than RESTRICT it -- only
 * commencement-sensitive/consequential activities keep the hard exclusion
 * in scoreCandidate() below. Reuses the existing MuhurtaClassification
 * signal (evaluationDepth + timingSensitivity.start) that already drives
 * Muhurtham-eligibility gating elsewhere, rather than introducing a new
 * taxonomy. An activity with no classification is treated as sensitive
 * (fail safe toward the existing strict behavior). */
export function isTimingSensitiveActivity(classification: MuhurtaClassification | undefined): boolean {
  if (!classification) return true;
  if (classification.evaluationDepth === 'DEEP' || classification.evaluationDepth === 'CEREMONIAL') return true;
  if (classification.timingSensitivity.start === 'HIGH') return true;
  return false;
}

export function scoreCandidate(candidate: SlotCandidate, profile: TaskProfile, date?: Date): number {
  if (profile.activity && date) {
    const fit = evaluateActivityFit({
      activity: profile.activity,
      date,
      windowType: candidate.type,
      personalContext: profile.personalContext,
      classification: profile.muhurtaClassification,
    });
    const isAvoidWindow = profile.activity.avoidWindowTypes.includes(candidate.type) && !profile.activity.allowDuringAvoidWindow && fit.score < 55;
    if (isAvoidWindow && isTimingSensitiveActivity(profile.muhurtaClassification)) return -100;
    return fit.score;
  }
  const base = profile.avoidWindows?.includes(candidate.type)
    ? profile.significance === 'LOW' && !profile.requiresFreshStart ? 30 : -100
    : profile.scores[candidate.type] !== undefined
    ? profile.scores[candidate.type]!
    : isFriction(candidate.type)
    ? profile.significance === 'LOW' ? 65 : profile.significance === 'MEDIUM' ? 25 : -100
    : 55;
  if (!date || base < 0) return base;
  const muhurta = evaluateCandidateMuhurta(candidate, profile, date);
  return Math.max(0, Math.min(100, base + muhurta.modifier));
}

export function containsMinute(window: { startMinutes?: number; endMinutes?: number; startMinute?: number; endMinute?: number }, minute: number): boolean {
  const start = window.startMinute ?? window.startMinutes;
  const end = window.endMinute ?? window.endMinutes;
  if (start === undefined || end === undefined) return false;
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function isFriction(type: SolarWindowType): boolean {
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

export function evaluateCandidateMuhurta(candidate: SlotCandidate, profile: TaskProfile, date: Date) {
  return evaluateMuhurta({
    taskTitle: profile.type,
    date,
    windowType: candidate.type,
    family: profile.family,
  });
}

function appendMuhurtaSummary(base: string, muhurtaSummary: string): string {
  if (!muhurtaSummary || muhurtaSummary === 'Panchanga factors are neutral for this activity.') return base;
  return `${base} ${muhurtaSummary}`;
}

export function profileFromActivity(activity: ActivityProfile): TaskProfile {
  return {
    activityId: activity.id,
    type: activity.title,
    icon: activity.icon,
    family: familyForActivityProfile(activity),
    significance: activity.significance,
    requiresFreshStart: activity.requiresFreshStart,
    muhurtaClassification: getActivityDefinition(activity)?.muhurta,
    scores: {},
    reason: activity.description,
    neutralReason: activity.significance === 'HIGH'
      ? `${activity.title} is workable in a neutral window, but Aura will still prefer a stronger opening when one is available.`
      : activity.description,
    preferredWindows: activity.recommendedWindowTypes,
    acceptableWindows: activity.acceptableWindowTypes,
    avoidWindows: activity.avoidWindowTypes,
    activity,
  };
}

export function classifyTask(taskTitle: string): TaskProfile {
  const activity = findActivityIntent(taskTitle);
  if (activity) return profileFromActivity(activity);

  const title = taskTitle.toLowerCase();
  if (/(start|begin|take|go on).*(journey|trip|road trip|flight|train|vacation|pilgrimage)|journey start|travel start|relocat|move to a new home/.test(title)) return { type: 'Start a journey', icon: '🚗', family: 'JOURNEY_START', significance: 'HIGH', preferredOnlyForHigh: true, scores: { ABHIJIT: 98, GULIKA: 76, NEUTRAL: 62 }, reason: 'A favorable start supports a smooth, intentional journey.', neutralReason: 'A neutral period is workable for travel, but not a preferred start.', preferredWindows: ['ABHIJIT'], acceptableWindows: ['GULIKA', 'NEUTRAL'], avoidWindows: ['RAHU_KALAM', 'YAMA'] };
  if (/(date|dating|romantic|ask someone out|meet someone new|relationship|partner|proposal|engagement|anniversary)/.test(title)) return { type: 'Dating & relationships', icon: '❤️', family: 'RELATIONSHIP', significance: 'MEDIUM', scores: { ABHIJIT: 88, GULIKA: 84, NEUTRAL: 78, BRAHMA: 72 }, reason: 'Favorable, open energy supports meaningful connection.', neutralReason: 'A neutral period is comfortable for a date or social connection.', preferredWindows: ['ABHIJIT', 'GULIKA', 'NEUTRAL'], acceptableWindows: ['BRAHMA'], avoidWindows: ['RAHU_KALAM', 'YAMA'] };
  if (/(party|partying|celebration|concert|movie|theatre|night out|clubbing|social gathering|dinner with friends|game night)/.test(title)) return { type: 'Party & social time', icon: '🎉', family: 'SOCIAL', significance: 'LOW', scores: { NEUTRAL: 88, GULIKA: 82, ABHIJIT: 74, YAMA: 68, RAHU_KALAM: 65 }, reason: 'Social energy is best used for connection and enjoyment.', neutralReason: 'This is a flexible activity; choose a comfortable time and enjoy it.', preferredWindows: ['NEUTRAL', 'GULIKA'], acceptableWindows: ['ABHIJIT', 'YAMA', 'RAHU_KALAM'] };
  if (/(financial|finance|investment|invest|loan|property|purchase|buy|sell|contract|pay debt|transfer money|open account)/.test(title)) return { type: 'Financial decision', icon: '💰', family: 'FINANCE', significance: 'HIGH', preferredOnlyForHigh: true, scores: { ABHIJIT: 100, GULIKA: 72, NEUTRAL: 58 }, reason: 'A strong, clear window is preferable for financial commitments.', neutralReason: 'Use neutral time for research and preparation, not the final commitment.', preferredWindows: ['ABHIJIT'], acceptableWindows: ['GULIKA', 'NEUTRAL'], avoidWindows: ['RAHU_KALAM', 'YAMA'] };
  if (/(start|begin|launch|open|new project|new business|new job|new course|renovation|new habit|marriage|wedding)/.test(title)) return { type: 'New beginning', icon: '🚀', family: 'NEW_BEGINNING', significance: 'HIGH', preferredOnlyForHigh: true, scores: { ABHIJIT: 100, BRAHMA: 90, GULIKA: 74, NEUTRAL: 58 }, reason: 'New beginnings benefit from a clear, favorable start.', neutralReason: 'Use this time to prepare; make the formal start in a stronger window.', preferredWindows: ['ABHIJIT', 'BRAHMA'], acceptableWindows: ['GULIKA', 'NEUTRAL'], avoidWindows: ['RAHU_KALAM', 'YAMA'] };
  if (/(walk|cycling|swim|yoga|stretch|massage|spa|digital detox|journal|sleep preparation|early bedtime)/.test(title)) return { type: 'Wellbeing', icon: '🌿', family: 'WELLBEING', significance: 'LOW', scores: { NEUTRAL: 88, BRAHMA: 86, GULIKA: 78, ABHIJIT: 76 }, reason: 'A restorative activity supports balance and recovery.', neutralReason: 'This is a flexible, restorative activity that fits now.', preferredWindows: ['NEUTRAL', 'BRAHMA'], acceptableWindows: ['GULIKA', 'ABHIJIT', 'RAHU_KALAM', 'YAMA'] };
  if (/(learn|course|read|book|exam|language|practice|certification|music|art)/.test(title)) return { type: 'Learning', icon: '📚', family: 'LEARNING', significance: 'MEDIUM', scores: { BRAHMA: 92, ABHIJIT: 88, NEUTRAL: 76, GULIKA: 72 }, reason: 'Steady concentration supports learning and skill development.', neutralReason: 'A neutral period is suitable for consistent practice.', preferredWindows: ['BRAHMA', 'ABHIJIT', 'NEUTRAL'], acceptableWindows: ['GULIKA'], avoidWindows: ['RAHU_KALAM', 'YAMA'] };
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

export function normalizeTaskTitle(taskTitle: string): string {
  const trimmed = String(taskTitle || '').replace(/\s+/g, ' ').trim();
  return trimmed || 'Focused work block';
}

export function formatWindowLabel(type: SolarWindowType): string {
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

function localDateTimeForMinute(context: DailyAssistantContext, minuteOfDay: number): string {
  return localInstantForMinute(context, minuteOfDay).toISOString();
}

export function localInstantForMinute(context: DailyAssistantContext, minuteOfDay: number): Date {
  const localDate = localDateForContext(context);
  const localTimestamp = Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
    0,
    0
  );
  return localTimestampToUtcInstant(context.timezone, localTimestamp, context.tzOffsetMinutes);
}

export function buildGoogleCalendarUrl(title: string, startsAtIso: string, endsAtIso: string): string {
  const compact = (value: string) => value.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${compact(startsAtIso)}/${compact(endsAtIso)}`,
    details: 'Scheduled by AuraSchedule during a recommended solar flow window.',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
