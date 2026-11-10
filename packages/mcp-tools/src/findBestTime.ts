import { buildTimingSearchRequest } from '../../../apps/web/lib/timingSearchRequest';
import { runTimingSearchWithDailyRhythm, type TimingSearchResponseWithDailyRhythm } from '../../../apps/web/lib/timingSearchDailyRhythm';
import { validateDailyRhythmPreferencesInput } from '../../../apps/web/lib/dailyRhythmPreferences';
import type { DailyRhythmPreferencesInput } from '../../../apps/web/lib/dailyRhythmScheduling';
import { resolveTzOffsetMinutes } from '../../../apps/web/lib/timezone';
import type { DailyAssistantContext } from '../../recommendation/src/dailyAssistant';
import type { TimingCandidate } from '../../recommendation/src/timingSearch';
import { findBestTimeInputSchema, PERSONALIZATION_NOTE, type FindBestTimeInput } from './findBestTimeSchema';

/**
 * `find_best_time` adapter. A thin translation layer only:
 *
 *   MCP arguments
 *     -> findBestTimeInputSchema (shape/format validation)
 *     -> DailyAssistantContext built exactly as apps/web/app/api/timing-search/route.ts
 *        builds it, minus `personalContext` (no account, no birth profile)
 *     -> buildTimingSearchRequest()          (existing validation, FIND mode)
 *     -> runTimingSearchWithDailyRhythm()    (existing ranking + Daily Rhythm)
 *     -> response envelope (adds rank + personalization disclosure; candidate
 *        objects are passed through unmodified)
 *
 * It performs no Panchangam calculation, overlap resolution, scoring,
 * ranking or activity classification of its own, and it has no side effects:
 * no database, no session, no product events, no persistence.
 */

export type FindBestTimeErrorKind = 'INVALID_INPUT' | 'CALCULATION_FAILED';

export interface RankedCandidate extends TimingCandidate {
  /** 1-based position in the pipeline's own returned order. */
  rank: number;
  /** Daily Rhythm note for this candidate, when the pipeline produced one. */
  dailyRhythmNote?: string;
}

export interface FindBestTimeResult {
  personalized: false;
  personalizationNote: string;
  query: {
    activityId?: string;
    taskTitle?: string;
    durationMinutes: number;
    timePreference: string;
    searchWindow: { dateRange: { start: string; end: string } } | { horizon: string };
    timezone: string;
    tzOffsetMinutes: number;
    location: { latitude: number; longitude: number };
    referenceTime: string;
    referenceTimeSource: 'SUPPLIED' | 'SERVER_CLOCK';
    limit: number | null;
    dailyRhythm: { workStart: string; workEnd: string; workDays: number[] } | null;
  };
  mode: 'FIND';
  candidates: RankedCandidate[];
  unavailableDayCount?: number;
  unavailable?: TimingSearchResponseWithDailyRhythm['unavailable'];
}

export type FindBestTimeOutcome =
  | { ok: true; result: FindBestTimeResult; pipeline: TimingSearchResponseWithDailyRhythm }
  | { ok: false; kind: FindBestTimeErrorKind; message: string };

const UNCONFIGURED_DAILY_RHYTHM: DailyRhythmPreferencesInput = { workStart: null, workEnd: null, workDays: [] };

function formatIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => (issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

/**
 * `now` is injectable only so callers can pin the default clock in tests;
 * a supplied `referenceTime` always takes precedence.
 */
export function executeFindBestTime(rawArgs: unknown, now: () => Date = () => new Date()): FindBestTimeOutcome {
  const parsed = findBestTimeInputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { ok: false, kind: 'INVALID_INPUT', message: formatIssues(parsed.error.issues) };
  }
  const input: FindBestTimeInput = parsed.data;

  let dailyRhythm: DailyRhythmPreferencesInput = UNCONFIGURED_DAILY_RHYTHM;
  let normalizedRhythm: FindBestTimeResult['query']['dailyRhythm'] = null;
  if (input.dailyRhythm) {
    try {
      normalizedRhythm = validateDailyRhythmPreferencesInput(input.dailyRhythm);
    } catch (err) {
      return { ok: false, kind: 'INVALID_INPUT', message: `dailyRhythm: ${(err as Error).message}` };
    }
    dailyRhythm = normalizedRhythm;
  }

  const referenceTimeSource = input.referenceTime ? 'SUPPLIED' : 'SERVER_CLOCK';
  const reference = input.referenceTime ? new Date(input.referenceTime) : now();

  // Same construction as apps/web/app/api/timing-search/route.ts, with the
  // user row replaced by explicit arguments and no personalContext.
  const context: DailyAssistantContext = {
    now: reference,
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    timezone: input.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(input.timezone, reference),
  };

  const body: Record<string, unknown> = {
    mode: 'FIND',
    durationMinutes: input.durationMinutes,
  };
  if (input.activityId !== undefined) body.activityId = input.activityId;
  if (input.taskTitle !== undefined) body.taskTitle = input.taskTitle;
  if (input.timePreference !== undefined) body.timePreference = input.timePreference;
  if (input.limit !== undefined) body.limit = input.limit;
  if (input.dateRange !== undefined) body.dateRange = input.dateRange;
  else body.horizon = input.horizon ?? 'TODAY';

  const validated = buildTimingSearchRequest(body, context);
  if (!validated.ok) {
    return { ok: false, kind: 'INVALID_INPUT', message: validated.error };
  }

  let pipeline: TimingSearchResponseWithDailyRhythm;
  try {
    pipeline = runTimingSearchWithDailyRhythm(validated.request, input.timezone, dailyRhythm);
  } catch (err) {
    // Never surface stack traces or internals to the client. The error class
    // name (e.g. SolarInputValidationError) is safe and useful.
    const name = err instanceof Error ? err.name : 'Error';
    return { ok: false, kind: 'CALCULATION_FAILED', message: `The timing calculation could not be completed (${name}).` };
  }

  const notes = pipeline.dailyRhythmNotes ?? {};
  const candidates: RankedCandidate[] = pipeline.candidates.map((candidate, index) => {
    const ranked: RankedCandidate = { ...candidate, rank: index + 1 };
    if (notes[candidate.start] !== undefined) ranked.dailyRhythmNote = notes[candidate.start];
    return ranked;
  });

  const result: FindBestTimeResult = {
    personalized: false,
    personalizationNote: PERSONALIZATION_NOTE,
    query: {
      ...(input.activityId !== undefined ? { activityId: input.activityId } : { taskTitle: input.taskTitle }),
      durationMinutes: input.durationMinutes,
      timePreference: validated.request.timePreference ?? 'ANY',
      searchWindow: validated.request.dateRange ? { dateRange: validated.request.dateRange } : { horizon: validated.request.horizon ?? 'TODAY' },
      timezone: input.timezone,
      tzOffsetMinutes: context.tzOffsetMinutes,
      location: { latitude: input.location.latitude, longitude: input.location.longitude },
      referenceTime: reference.toISOString(),
      referenceTimeSource,
      limit: validated.request.limit ?? null,
      dailyRhythm: normalizedRhythm,
    },
    mode: 'FIND',
    candidates,
  };
  if (pipeline.unavailableDayCount !== undefined) result.unavailableDayCount = pipeline.unavailableDayCount;
  if (pipeline.unavailable !== undefined) result.unavailable = pipeline.unavailable;

  return { ok: true, result, pipeline };
}
