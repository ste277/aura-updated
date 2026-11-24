/**
 * AURA-INS-01 -- the alignment comparison shown in Insights ("Your
 * Alignment"), extracted from app/api/daily-assistant/insights/route.ts so it
 * is a single, pure, directly-tested function.
 *
 * UNCHANGED methodology (PV-F04 asked for safeguards, not a new metric):
 *  - Mood score per check-in: PEAK_FLOW ("Strong") = 1, MODERATE
 *    ("Balanced") = 0.5, LOW = 0.
 *  - A check-in day counts as "followed favorable windows" when the user
 *    said so in the check-in (followedGuidance) OR that day's logged
 *    activities include more SUPPORTIVE than FRICTION windows (classified by
 *    the caller with the shared classifyInsightsWindow taxonomy).
 *  - Result = mean score on followed days minus mean score on other days,
 *    in percentage points of the 0-1 scale.
 *
 * NEW safeguards (display only):
 *  - Only check-ins with a recognised mood value count (an unknown/corrupt
 *    outputLevel used to score silently as LOW); one check-in per local day.
 *  - A comparison is shown only with >= 30 qualifying days overall AND >= 10
 *    in EACH group -- the same rule whatever the direction of the result.
 *    These are minimum display thresholds, NOT statistical significance.
 *  - The displayed difference is rounded to the nearest 5 points (whole-point
 *    precision overstates what tens of check-ins can show); a difference
 *    that rounds to 0 is reported as "about the same".
 *  - Copy describes the user's own recorded observations and never implies
 *    that timing or Panchangam caused a better or worse day.
 *
 * No DB access, no clock -- callers pass everything in.
 */

export const ALIGNMENT_MIN_TOTAL_DAYS = 30;
export const ALIGNMENT_MIN_DAYS_PER_GROUP = 10;
/** Display rounding step for the difference, in points. */
export const ALIGNMENT_DISPLAY_STEP_POINTS = 5;

const MOOD_SCORES: Readonly<Record<string, number>> = { PEAK_FLOW: 1, MODERATE: 0.5, LOW: 0 };

export interface AlignmentReflectionInput {
  /** User-local calendar date, "YYYY-MM-DD". */
  dateKey: string;
  outputLevel: string | null | undefined;
  followedGuidance: boolean;
}

export interface AlignmentDayLogSummary {
  aligned: number;
  friction: number;
}

export type AlignmentDirection = 'HIGHER' | 'LOWER' | 'SIMILAR';

export interface AlignmentComparison {
  status: 'INSUFFICIENT' | 'AVAILABLE';
  /** Distinct days with a valid mood check-in. */
  qualifyingDays: number;
  /** Qualifying days counted as following favorable windows. */
  followedDays: number;
  /** All other qualifying days. */
  otherDays: number;
  /** Check-ins skipped because their mood value was not recognised. */
  excludedInvalidMood: number;
  /** Extra rows for an already-counted day (should be 0: one row per day). */
  excludedDuplicateDays: number;
  minTotalDays: number;
  minDaysPerGroup: number;
  /** Rounded display difference in points (nearest 5), or null when INSUFFICIENT. */
  differencePoints: number | null;
  direction: AlignmentDirection | null;
  /** One neutral sentence: the result, or the insufficient-data explanation. */
  summaryText: string;
  /** "Based on N days ... and M other days." (AVAILABLE only, else null). */
  sampleText: string | null;
  /** How the comparison is calculated (always present). */
  methodText: string;
  /** Observational caveat (always present). */
  caveatText: string;
}

export const ALIGNMENT_INSUFFICIENT_TEXT = "Keep checking in to explore patterns in your daily experience. There aren't enough observations for a meaningful comparison yet.";
export const ALIGNMENT_CAVEAT_TEXT = "This describes what you've recorded, not a cause and effect. Many things shape how a day feels.";

function methodTextFor(reflectionWindow: number): string {
  return `Each check-in counts Strong as 100, Balanced as 50 and Low as 0. Aura compares your average on days you followed favorable windows (you said so in your check-in, or most of that day's logged activities were in favorable windows) with your average on other check-in days, using your last ${reflectionWindow} check-ins. A comparison appears once there are at least ${ALIGNMENT_MIN_TOTAL_DAYS} check-in days, including at least ${ALIGNMENT_MIN_DAYS_PER_GROUP} of each kind.`;
}

function dayWord(n: number): string {
  return n === 1 ? 'day' : 'days';
}

/** Rounds to the nearest display step; -0 becomes 0. */
export function roundAlignmentDifference(rawPoints: number): number {
  const rounded = Math.round(rawPoints / ALIGNMENT_DISPLAY_STEP_POINTS) * ALIGNMENT_DISPLAY_STEP_POINTS;
  return rounded === 0 ? 0 : rounded;
}

export function computeAlignmentComparison(
  reflections: readonly AlignmentReflectionInput[],
  logsByDay: ReadonlyMap<string, AlignmentDayLogSummary>,
  reflectionWindow: number,
): AlignmentComparison {
  const seenDays = new Set<string>();
  let excludedInvalidMood = 0;
  let excludedDuplicateDays = 0;
  let followedDays = 0;
  let followedScoreTotal = 0;
  let otherDays = 0;
  let otherScoreTotal = 0;

  for (const reflection of reflections) {
    const score = reflection.outputLevel ? MOOD_SCORES[reflection.outputLevel] : undefined;
    if (score === undefined) {
      excludedInvalidMood += 1;
      continue;
    }
    if (seenDays.has(reflection.dateKey)) {
      excludedDuplicateDays += 1;
      continue;
    }
    seenDays.add(reflection.dateKey);
    const dayLogs = logsByDay.get(reflection.dateKey);
    const followed = reflection.followedGuidance || Boolean(dayLogs && dayLogs.aligned > dayLogs.friction);
    if (followed) {
      followedDays += 1;
      followedScoreTotal += score;
    } else {
      otherDays += 1;
      otherScoreTotal += score;
    }
  }

  const qualifyingDays = followedDays + otherDays;
  const base = {
    qualifyingDays,
    followedDays,
    otherDays,
    excludedInvalidMood,
    excludedDuplicateDays,
    minTotalDays: ALIGNMENT_MIN_TOTAL_DAYS,
    minDaysPerGroup: ALIGNMENT_MIN_DAYS_PER_GROUP,
    methodText: methodTextFor(reflectionWindow),
    caveatText: ALIGNMENT_CAVEAT_TEXT,
  };

  // Both group sizes are >= 10 here, so neither mean has a zero denominator.
  const eligible = qualifyingDays >= ALIGNMENT_MIN_TOTAL_DAYS && followedDays >= ALIGNMENT_MIN_DAYS_PER_GROUP && otherDays >= ALIGNMENT_MIN_DAYS_PER_GROUP;
  if (!eligible) {
    return { ...base, status: 'INSUFFICIENT', differencePoints: null, direction: null, summaryText: ALIGNMENT_INSUFFICIENT_TEXT, sampleText: null };
  }

  const rawPoints = (followedScoreTotal / followedDays - otherScoreTotal / otherDays) * 100;
  const differencePoints = roundAlignmentDifference(rawPoints);
  const direction: AlignmentDirection = differencePoints > 0 ? 'HIGHER' : differencePoints < 0 ? 'LOWER' : 'SIMILAR';
  const summaryText =
    direction === 'SIMILAR'
      ? 'In your check-ins, days you followed favorable windows and other days felt about the same on average.'
      : `In your check-ins, days you followed favorable windows averaged about ${Math.abs(differencePoints)} points ${direction === 'HIGHER' ? 'higher' : 'lower'} than other days.`;
  const sampleText = `Based on ${followedDays} ${dayWord(followedDays)} following favorable windows and ${otherDays} other ${dayWord(otherDays)}.`;
  return { ...base, status: 'AVAILABLE', differencePoints, direction, summaryText, sampleText };
}
