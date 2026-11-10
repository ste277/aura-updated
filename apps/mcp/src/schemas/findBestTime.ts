import { z } from 'zod';
import { isValidIanaTimezone } from '../../../web/lib/timezone';
import { FULL_ACTIVITY_CATALOG } from '../../../../packages/recommendation/src/personalizedTasks';

/**
 * Input contract for `find_best_time`, derived from what the existing
 * pipeline actually accepts in FIND mode:
 *   apps/web/lib/timingSearchRequest.ts  buildTimingSearchRequest()
 *   apps/web/lib/timingSearchDailyRhythm.ts  runTimingSearchWithDailyRhythm()
 *   apps/web/lib/dailyRhythmPreferences.ts  validateDailyRhythmPreferencesInput()
 *
 * The numeric bounds below MIRROR the private constants in
 * timingSearchRequest.ts (they are not exported). They are advertised here so
 * MCP clients see them in the tool's JSON Schema; buildTimingSearchRequest()
 * still re-validates every request, so it remains the authority, and
 * test/validation.test.ts asserts the two agree at each boundary.
 *
 * Deliberate differences from the HTTP route (documented in README):
 *  - FIND mode only (the tool is "find", not check/compare).
 *  - Exactly one of activityId / taskTitle (the route silently prefers
 *    activityId when both are sent).
 *  - activityId must exist in FULL_ACTIVITY_CATALOG (the route silently
 *    falls back to free-text classification of an empty title).
 *  - Dates must be real calendar dates (the route only checks the
 *    YYYY-MM-DD shape).
 *  - horizon excludes CUSTOM; use dateRange for an explicit range.
 *  - referenceTime is explicit and must carry an offset; the route instead
 *    takes the browser clock, clamped to +/-12h of the server clock.
 */

export const TIMING_LIMITS = {
  MAX_TASK_TITLE_LENGTH: 200,
  MAX_ACTIVITY_ID_LENGTH: 100,
  MIN_DURATION_MINUTES: 15,
  MAX_DURATION_MINUTES: 360,
  MAX_DATE_RANGE_DAYS: 90,
  MIN_LIMIT: 1,
  MAX_LIMIT: 10,
} as const;

export const SUPPORTED_ACTIVITY_IDS: ReadonlySet<string> = new Set(FULL_ACTIVITY_CATALOG.map((activity) => activity.id));

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** YYYY-MM-DD that names a real calendar day (rejects 2026-02-30). */
export function isRealCalendarDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function daySpan(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}

const calendarDate = z
  .string()
  .refine(isRealCalendarDate, { message: 'must be a real calendar date in YYYY-MM-DD form' })
  .describe('Local calendar date in the supplied timezone, YYYY-MM-DD.');

export const findBestTimeInputShape = {
  activityId: z
    .string()
    .trim()
    .min(1)
    .max(TIMING_LIMITS.MAX_ACTIVITY_ID_LENGTH)
    .refine((id) => SUPPORTED_ACTIVITY_IDS.has(id), { message: 'is not a supported Aura activity id; use taskTitle for free text' })
    .optional()
    .describe('Known Aura catalog activity id (e.g. "exercise"). Provide exactly one of activityId or taskTitle.'),
  taskTitle: z
    .string()
    .trim()
    .min(1)
    .max(TIMING_LIMITS.MAX_TASK_TITLE_LENGTH)
    .optional()
    .describe('Free-text activity, classified by Aura\'s existing activity classifier (e.g. "Go for a run"). Provide exactly one of activityId or taskTitle.'),
  durationMinutes: z
    .number()
    .min(TIMING_LIMITS.MIN_DURATION_MINUTES)
    .max(TIMING_LIMITS.MAX_DURATION_MINUTES)
    .describe('Activity length in minutes (15-360).'),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .strict()
    .describe('Coordinates the Panchangam windows are computed for. Not geocoded, not inferred.'),
  timezone: z
    .string()
    .refine(isValidIanaTimezone, { message: 'must be a valid IANA timezone such as "Asia/Kolkata"' })
    .describe('IANA timezone used to interpret every local date/time (e.g. "Asia/Kolkata").'),
  dateRange: z
    .object({ start: calendarDate, end: calendarDate })
    .strict()
    .refine((r) => daySpan(r.start, r.end) >= 0, { message: 'end must not be before start' })
    .refine((r) => daySpan(r.start, r.end) <= TIMING_LIMITS.MAX_DATE_RANGE_DAYS, { message: `must span ${TIMING_LIMITS.MAX_DATE_RANGE_DAYS} days or fewer` })
    .optional()
    .describe('Explicit local date range to search (inclusive). Mutually exclusive with horizon.'),
  horizon: z
    .enum(['NOW', 'TODAY', 'TOMORROW', 'WEEKEND', 'SEVEN_DAYS'])
    .optional()
    .describe('Relative search window, resolved against referenceTime in the supplied timezone. Defaults to TODAY when neither horizon nor dateRange is given.'),
  timePreference: z
    .enum(['ANY', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT'])
    .optional()
    .describe('Optional part-of-day preference. Defaults to ANY.'),
  limit: z
    .number()
    .min(TIMING_LIMITS.MIN_LIMIT)
    .max(TIMING_LIMITS.MAX_LIMIT)
    .optional()
    .describe('Maximum candidates to return (1-10). Defaults to 3.'),
  referenceTime: z
    .string()
    .refine((s) => INSTANT_WITH_OFFSET.test(s) && !Number.isNaN(Date.parse(s)), {
      message: 'must be an ISO 8601 instant with an explicit offset, e.g. "2026-11-10T09:00:00+05:30" or "...Z"',
    })
    .optional()
    .describe('"Now" for the search: past times are excluded and relative horizons are resolved from it. Defaults to the server clock at call time; supply it for reproducible results.'),
  dailyRhythm: z
    .object({
      workStart: z.string().regex(HH_MM, 'must be HH:mm (24h)'),
      workEnd: z.string().regex(HH_MM, 'must be HH:mm (24h)'),
      workDays: z.array(z.number().int().min(0).max(6)).max(7).describe('Weekdays, 0=Sunday .. 6=Saturday.'),
    })
    .strict()
    .refine((r) => r.workStart < r.workEnd, { message: 'workStart must be before workEnd (no overnight window)' })
    .optional()
    .describe('Optional explicit work hours. When omitted, no Daily Rhythm preference is applied.'),
};

export const findBestTimeInputSchema = z
  .object(findBestTimeInputShape)
  .strict()
  .refine((input) => (input.activityId === undefined) !== (input.taskTitle === undefined), {
    message: 'Provide exactly one of activityId or taskTitle.',
  })
  .refine((input) => !(input.dateRange && input.horizon), {
    message: 'Provide either dateRange or horizon, not both.',
  });

export type FindBestTimeInput = z.infer<typeof findBestTimeInputSchema>;

export const PERSONALIZATION_NOTE =
  'Recommendations use the supplied location, timezone and scheduling preferences. No Aura account or birth-profile personalization was applied.';
