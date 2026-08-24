import {
  User,
  listPlannedActivitiesForDay,
  listAuraMomentsForReminders,
  listMomentIdsWithSuccessorForOwner,
  listHabitLogs,
} from './db';
import { localDateTimeToUTC, getDatePartsInTimezone, getMinuteOfDayInTimezone } from './timezone';
import { buildDailyAgenda, DailyAgenda } from './dailyAgenda';
import { buildDailyStory, DailyStory } from './dailyStory';

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

  return { agenda, story };
}
