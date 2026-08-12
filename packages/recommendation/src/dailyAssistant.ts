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
  durationMinutes = 30
): TaskSlotRecommendation {
  const safeDuration = Math.min(180, Math.max(15, Math.round(durationMinutes)));
  const cleanTitle = normalizeTaskTitle(taskTitle);
  const windows = computeAssistantWindows(context);
  const taskType = classifyTask(cleanTitle);
  const bestCandidates = rankBestWindows(windows, taskType);
  const best = firstWindowWithRoom(bestCandidates, safeDuration) ?? bestCandidates[0] ?? windows[0];
  const avoid = rankAvoidWindows(windows)[0] ?? null;
  const startMinute = best?.startMinutes ?? 720;
  const endMinute = Math.min(best?.endMinutes ?? startMinute + safeDuration, startMinute + safeDuration);
  const startsAtLocal = localDateTimeForMinute(context.now, startMinute);
  const endsAtLocal = localDateTimeForMinute(context.now, endMinute);

  return {
    taskTitle: cleanTitle,
    bestWindow: {
      startMinute,
      endMinute,
      startTime: formatMinute(startMinute),
      endTime: formatMinute(endMinute),
      label: formatWindowLabel(best?.type ?? 'NEUTRAL'),
      reason: reasonForTask(best?.type ?? 'NEUTRAL', taskType),
    },
    avoidWindow: avoid
      ? {
          startMinute: avoid.startMinutes,
          endMinute: avoid.endMinutes,
          startTime: formatMinute(avoid.startMinutes),
          endTime: formatMinute(avoid.endMinutes),
          label: formatWindowLabel(avoid.type),
          reason: 'High-friction window. Better for routine cleanup than fresh commitments.',
        }
      : null,
    calendar: {
      title: cleanTitle,
      startsAtLocal,
      endsAtLocal,
      googleCalendarUrl: buildGoogleCalendarUrl(cleanTitle, startsAtLocal, endsAtLocal),
    },
  };
}

function findWindow(windows: WindowSpan[], type: SolarWindowType): WindowSpan | undefined {
  return windows.find((window) => window.type === type);
}

function firstWindowWithRoom(windows: WindowSpan[], durationMinutes: number): WindowSpan | undefined {
  return windows.find((window) => windowDuration(window) >= durationMinutes);
}

function windowDuration(window: WindowSpan): number {
  if (window.endMinutes >= window.startMinutes) return window.endMinutes - window.startMinutes;
  return 1440 - window.startMinutes + window.endMinutes;
}

function rankBestWindows(windows: WindowSpan[], taskType: string): WindowSpan[] {
  const scoreByType: Record<string, Partial<Record<SolarWindowType, number>>> = {
    cognition: { ABHIJIT: 100, BRAHMA: 92, GULIKA: 78, NEUTRAL: 65 },
    meeting: { ABHIJIT: 92, GULIKA: 80, NEUTRAL: 72, BRAHMA: 50 },
    admin: { GULIKA: 90, NEUTRAL: 78, ABHIJIT: 70, BRAHMA: 65 },
    recovery: { BRAHMA: 88, GULIKA: 76, NEUTRAL: 72, ABHIJIT: 62 },
  };

  const scores = scoreByType[taskType] ?? scoreByType.cognition;
  return [...windows]
    .filter((window) => window.type !== 'RAHU_KALAM' && window.type !== 'YAMA')
    .sort((a, b) => (scores[b.type] ?? 40) - (scores[a.type] ?? 40));
}

function rankAvoidWindows(windows: WindowSpan[]): WindowSpan[] {
  return [...windows]
    .filter((window) => window.type === 'RAHU_KALAM' || window.type === 'YAMA')
    .sort((a, b) => (a.type === 'RAHU_KALAM' ? -1 : 1) - (b.type === 'RAHU_KALAM' ? -1 : 1));
}

function classifyTask(taskTitle: string): 'cognition' | 'meeting' | 'admin' | 'recovery' {
  const title = taskTitle.toLowerCase();
  if (/(meeting|1-on-1|one-on-one|call|interview|sync|review)/.test(title)) return 'meeting';
  if (/(invoice|email|admin|cleanup|organize|errand|expense|filing)/.test(title)) return 'admin';
  if (/(walk|rest|meditat|breath|stretch|nap|recover)/.test(title)) return 'recovery';
  return 'cognition';
}

function reasonForTask(windowType: SolarWindowType, taskType: string): string {
  if (windowType === 'ABHIJIT') return 'Peak solar clarity supports high-stakes thinking and decisive execution.';
  if (windowType === 'BRAHMA') return 'Quiet pre-dawn energy is strongest for deep planning and clean starts.';
  if (windowType === 'GULIKA') return 'Steady compounding energy suits practice, follow-through, and repeatable work.';
  if (taskType === 'meeting') return 'Neutral flow keeps the conversation grounded without a major friction marker.';
  return 'Neutral flow is a reliable default when no stronger auspicious window is available.';
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
