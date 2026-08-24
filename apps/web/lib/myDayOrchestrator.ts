import {
  User,
  listPlannedActivitiesForDay,
  listAuraMomentsForReminders,
  listMomentIdsWithSuccessorForOwner,
  listHabitLogs,
} from './db';
import { localDateTimeToUTC, getDatePartsInTimezone, getMinuteOfDayInTimezone } from './timezone';
import { buildDailyAgenda, DailyAgenda } from './dailyAgenda';
import { buildDailyStory, DailyStory, resolveDailyStoryPhase } from './dailyStory';
import { buildDailyReflection, DailyReflection } from './dailyReflection';
import { buildTomorrowPreview, TomorrowPreview } from './tomorrowPreview';
import { getPanchangForDate } from '../../../packages/panchang/src/panchangDay';

/**
 * My Day V1 -- the I/O orchestrator behind GET /api/my-day (brief section
 * 41: "route should orchestrate, domain functions should derive"). Owns
 * bounded DB reads and local-day boundary math; all actual aggregation/
 * narrative logic lives in the pure dailyAgenda.ts/dailyStory.ts, same
 * split as askAuraIntent.ts (pure) / askAuraOrchestrator.ts (I/O).
 */

function addDaysToDateStr(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Brief section 43: the local calendar day's [start, end) as real UTC
 * instants, never a UTC-day approximation -- reuses the exact same
 * localDateTimeToUTC() birth-time forms already use, just with "00:00". */
function localDayBoundsUTC(dateStr: string, timezone: string): { from: Date; to: Date } {
  const from = localDateTimeToUTC(dateStr, '00:00', timezone);
  const to = localDateTimeToUTC(addDaysToDateStr(dateStr, 1), '00:00', timezone);
  return { from, to };
}

export interface MyDayResult {
  agenda: DailyAgenda;
  story: DailyStory;
  /** Brief section 3 -- always derived alongside the agenda (cheap, pure);
   * whether/when it's actually shown to the user is a UI-layer decision
   * (the NIGHT day-phase, per brief section 8), not this function's. */
  reflection: DailyReflection;
  /** Brief section 4/8 -- only populated at the NIGHT phase, to avoid an
   * unconditional extra day of reads + a Panchang computation on every
   * single My Day request. Absent the rest of the day. */
  tomorrowPreview?: TomorrowPreview;
}

export async function buildMyDay(user: User, requestedDate: string | undefined, now: Date): Promise<MyDayResult> {
  const localDate = requestedDate ?? getDatePartsInTimezone(user.timezone, now).dateStr;
  const { from, to } = localDayBoundsUTC(localDate, user.timezone);

  // Bounded reads only (brief section 42) -- no month/180-day scans, no
  // natal recomputation. listAuraMomentsForReminders is reused as-is (not
  // duplicated): it already applies the exact ACTIVE + unexpired filter
  // brief section 5 wants, bounded to [from, to].
  const [plans, moments, momentIdsWithSuccessor, habitLogsRecent] = await Promise.all([
    listPlannedActivitiesForDay(user.id, from, to),
    listAuraMomentsForReminders(user.id, from, to),
    listMomentIdsWithSuccessorForOwner(user.id),
    listHabitLogs(user.id),
  ]);

  // listHabitLogs is the last-50-overall query the rest of the app already
  // relies on for "today's logs" (page.tsx's own loggedActivitiesToday) --
  // reused here rather than adding a new query, filtered to this local day.
  const habitLogs = habitLogsRecent.filter((log) => getDatePartsInTimezone(user.timezone, log.logTimestamp).dateStr === localDate);

  const agenda = buildDailyAgenda({
    now,
    localDate,
    timezone: user.timezone,
    plans,
    moments,
    momentIdsWithSuccessor,
    habitLogs,
  });

  const minuteOfDay = getMinuteOfDayInTimezone(user.timezone, now);
  const story = buildDailyStory(agenda, minuteOfDay);
  const reflection = buildDailyReflection(agenda);

  let tomorrowPreview: TomorrowPreview | undefined;
  if (resolveDailyStoryPhase(minuteOfDay) === 'NIGHT') {
    tomorrowPreview = await buildTomorrowPreviewForNextDay(user, localDate, now);
  }

  return { agenda, story, reflection, tomorrowPreview };
}

/** Brief section 4 -- tomorrow's already-scheduled Plans/Moments (reusing
 * buildDailyAgenda for a second, later local day, same as the primary
 * agenda) plus a human-readable "good for" read of tomorrow's Panchang
 * (existing getGoodForDayCategories(), GENERAL-only -- no personal natal
 * context threaded through, same choice Guest/GENERAL timing search
 * already makes). A Panchang computation failure (e.g. an extreme
 * latitude/longitude edge case) degrades to "no highlights" rather than
 * failing the whole My Day request. */
async function buildTomorrowPreviewForNextDay(user: User, localDate: string, now: Date): Promise<TomorrowPreview> {
  const tomorrowDate = addDaysToDateStr(localDate, 1);
  const { from, to } = localDayBoundsUTC(tomorrowDate, user.timezone);

  const [plans, moments, momentIdsWithSuccessor, habitLogsRecent] = await Promise.all([
    listPlannedActivitiesForDay(user.id, from, to),
    listAuraMomentsForReminders(user.id, from, to),
    listMomentIdsWithSuccessorForOwner(user.id),
    listHabitLogs(user.id),
  ]);
  const habitLogs = habitLogsRecent.filter((log) => getDatePartsInTimezone(user.timezone, log.logTimestamp).dateStr === tomorrowDate);

  const tomorrowAgenda = buildDailyAgenda({
    now,
    localDate: tomorrowDate,
    timezone: user.timezone,
    plans,
    moments,
    momentIdsWithSuccessor,
    habitLogs,
  });

  try {
    const panchangDay = getPanchangForDate({
      localDate: tomorrowDate,
      latitude: user.latitude,
      longitude: user.longitude,
      timezone: user.timezone,
    });
    return buildTomorrowPreview(tomorrowAgenda, panchangDay);
  } catch {
    return { date: tomorrowAgenda.localDate, timezone: tomorrowAgenda.timezone, agenda: tomorrowAgenda, goodForCategories: [], headline: 'Looking ahead to tomorrow', narrative: tomorrowAgenda.items.length > 0 ? `${tomorrowAgenda.items.length} thing${tomorrowAgenda.items.length === 1 ? '' : 's'} already on tomorrow's calendar.` : 'Nothing is on the calendar yet.' };
  }
}
