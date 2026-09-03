import { buildGoogleCalendarUrl } from '../../../packages/recommendation/src/dailyAssistant';
import { formatMuhurtaReason } from '../../../packages/muhurta/src/muhurtaReasonFormat';
import type { TimingCandidate, TimingCandidateLabel } from '../../../packages/recommendation/src/timingSearch';

/**
 * Pure plan display/formatting logic shared by PlanWithAuraView.tsx and its
 * callers -- extracted into a plain .ts module (Event Location Plan
 * Persistence V1 closeout) specifically so it can be unit-tested under this
 * repo's normal (non-JSX) test runner without importing a .tsx component
 * file. No React, no JSX, no UI here -- see PlanWithAuraView.tsx for the
 * component that renders these values.
 */

export type PlanIcon = 'workout' | 'focus' | 'heart' | 'study' | 'meditate' | 'meeting' | 'journey';

/** Event Location Plan Persistence V1: the minimal, coordinate-free shape
 * a plan-save call passes through to persistence -- deliberately just
 * `{cityName, timezone}`, extracted from PR #55's own resultEventLocation
 * (which also carries latitude/longitude) at the save boundary, never the
 * full CityOption shape. See saveUpcomingPlanFromCandidate()'s own doc
 * comment (PlanWithAuraView.tsx) for why coordinates are never passed this
 * far. */
export interface PlanEventLocation {
  cityName: string;
  timezone: string;
}

export type UpcomingPlan = {
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
  /** Event Location Plan Persistence V1 -- the immutable snapshot (both
   * present, or both absent -- never one without the other), kept
   * separately from the pre-formatted `time` string above so a future
   * surface can still read the raw timezone/location identity rather than
   * only ever having the already-formatted text. */
  eventTimezone?: string;
  eventLocationName?: string;
};

export type PlanApiRow = {
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
  eventTimezone?: string | null;
  eventLocationName?: string | null;
};

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

export function durationLabel(minutes: number): string {
  if (minutes < 120) return `${minutes} min`;
  return `${minutes / 60} hours`;
}

export function minutesFromDuration(duration: string): number {
  const hourMatch = duration.match(/(\d+(?:\.\d+)?)\s*h/i);
  if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
  const minuteMatch = duration.match(/(\d+)\s*min/i);
  if (minuteMatch) return Number(minuteMatch[1]);
  return 60;
}

export function planIconForTitle(title: string): PlanIcon {
  const lower = title.toLowerCase();
  if (/workout|exercise|gym|training/.test(lower)) return 'workout';
  if (/date|relationship|romantic/.test(lower)) return 'heart';
  if (/study|learn|course|exam|read/.test(lower)) return 'study';
  if (/meditat|breath|prayer/.test(lower)) return 'meditate';
  if (/meeting|review|call|interview|presentation/.test(lower)) return 'meeting';
  if (/journey|travel|trip|flight|train/.test(lower)) return 'journey';
  return 'focus';
}

export function planAccentForTitle(title: string): string {
  const lower = title.toLowerCase();
  if (/date|relationship|romantic|workout|exercise|gym/.test(lower)) return '#ff5f95';
  if (/study|learn|meditat|breath/.test(lower)) return '#4ade80';
  if (/journey|travel|trip/.test(lower)) return '#facc15';
  return '#38bdf8';
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function getTodayForTimezone(timezone?: string): Date {
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

export function formatPlanDay(date: Date): string {
  const today = getTodayForTimezone();
  const dateKey = date.toISOString().slice(0, 10);
  const todayKey = today.toISOString().slice(0, 10);
  const tomorrowKey = addDays(today, 1).toISOString().slice(0, 10);
  if (dateKey === todayKey) return 'Today';
  if (dateKey === tomorrowKey) return 'Tomorrow';
  return formatShortDate(date);
}

/** Event Location Plan Persistence V1: `timezone`, when given, is used
 * explicitly (Intl `timeZone` option) -- for a plan with an Event Location
 * snapshot this is `plan.eventTimezone`, and for an ordinary plan rendered
 * inside PlanWithAuraView it's the component's own Timing Location prop
 * (the "intended" fallback the audit found already threaded through but
 * never actually used here). Omitted entirely, this preserves the exact
 * prior browser-local behavior -- the one call site with no timezone of
 * any kind available (saveUpcomingPlanFromCandidate's own immediate
 * post-save response mapping, outside any component). */
export function formatPlanTimeRange(start: Date, end: Date, timezone?: string): string {
  const opts: Intl.DateTimeFormatOptions = timezone ? { hour: 'numeric', minute: '2-digit', timeZone: timezone } : { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleTimeString('en-US', opts)} - ${end.toLocaleTimeString('en-US', opts)}`;
}

export function windowTypeFromLabel(label?: string): string {
  if (!label) return 'NEUTRAL';
  if (/abhijit/i.test(label)) return 'ABHIJIT';
  if (/gulika|steady/i.test(label)) return 'GULIKA';
  if (/brahma/i.test(label)) return 'BRAHMA';
  if (/rahu/i.test(label)) return 'RAHU_KALAM';
  if (/yama/i.test(label)) return 'YAMA';
  return 'NEUTRAL';
}

/** `fallbackTimezone` -- the Timing Location to format in when this row has
 * no Event Location snapshot of its own (row.eventTimezone null). Omitted
 * by the one call site with nothing better available (see
 * formatPlanTimeRange's own doc comment); every call site inside the
 * PlanWithAuraView component itself passes its own `timezone` prop. */
export function mapPlanRow(row: PlanApiRow, fallbackTimezone?: string): UpcomingPlan {
  const start = new Date(row.plannedStartAt);
  const end = new Date(row.plannedEndAt);
  const title = row.title || row.activityType || 'Planned activity';
  const status = row.status === 'LOGGED' ? 'LOGGED' : 'UPCOMING';
  const eventTimezone = row.eventTimezone || undefined;
  const eventLocationName = row.eventLocationName || undefined;
  return {
    id: row.id,
    title,
    icon: planIconForTitle(row.icon || title),
    when: formatPlanDay(start),
    plannedStartAt: start.toISOString(),
    plannedEndAt: end.toISOString(),
    duration: `${row.durationMinutes ?? 60} min`,
    time: formatPlanTimeRange(start, end, eventTimezone ?? fallbackTimezone),
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
    eventTimezone,
    eventLocationName,
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
 * windowTypeFromLabel() above still resolves it correctly.
 *
 * `sharedWithName` (Shared Muhurtham brief section 18): PlannedActivity has
 * no JSON metadata column and this PR does not add one ("do not create a new
 * plan model solely for this") -- so when a SHARED "Use this time" saves a
 * plan, the only schema-migration-free way to preserve that context is a
 * short human-readable prefix on the existing `details`/`recommendation`
 * text field. Omitted (undefined), `details` is byte-identical to before --
 * GENERAL/PERSONAL "Use this time" callers are completely unaffected.
 *
 * `eventLocation` (Event Location Plan Persistence V1): when the candidate
 * being saved came from a custom Event Location search (never the ordinary
 * Timing Location), this is PR #55's own resultEventLocation -- the
 * client-side snapshot of the location that actually produced the search
 * result, already trimmed to `{cityName, timezone}` (no coordinates) by the
 * caller. Used for the IMMEDIATE display time here (so the returned
 * UpcomingPlan is correct without waiting for a reload) and threaded
 * through to persistence by saveUpcomingPlanFromCandidate() (PlanWithAuraView.tsx).
 * Omitted entirely for an ordinary Timing Location save -- `time` falls
 * back to plain browser-local formatting here exactly as before, since
 * this function (unlike mapPlanRow's own call sites inside the component)
 * has no Timing Location value of its own to fall back to. */
export function planPayloadFromCandidate(candidate: TimingCandidate, durationMinutes: number, sharedWithName?: string, eventLocation?: PlanEventLocation): UpcomingPlan {
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
    time: formatPlanTimeRange(start, end, eventLocation?.timezone),
    window: candidate.metadata.windowLabel,
    match: candidate.label === 'EXCELLENT' || candidate.label === 'VERY_GOOD' ? 'Best Match' : 'Good Match',
    note: RESULT_LABEL_TEXT[candidate.label],
    accent: planAccentForTitle(title),
    details: sharedWithName ? `❤️ Planned with ${sharedWithName}. ${reasonDetails}` : reasonDetails,
    score: candidate.score * 10,
    googleCalendarUrl: buildGoogleCalendarUrl(title, candidate.start, candidate.end),
    source: 'Aura',
    eventTimezone: eventLocation?.timezone,
    eventLocationName: eventLocation?.cityName,
  };
}

/** `guestConversionToken` (Recipient Conversion V1 Hardening, brief section
 * 10) is optional and only ever passed by the guest-conversion save path
 * (apps/web/app/find/GuestFindClient.tsx) -- every other caller of
 * saveUpcomingPlanFromCandidate (PlanWithAuraView.tsx) is unaffected. POST
 * /api/plans uses it purely as an idempotency key (see that route's own
 * doc comment); it never changes what gets created, only whether a retry
 * creates a SECOND Plan.
 *
 * `clientRequestId` (Intentional Day Builder V1, brief section 20) is the
 * same kind of idempotency key, only ever passed by Day Builder's own Add
 * action (DayBuilderCard.tsx) -- independent of guestConversionToken, never
 * both at once in practice. A stable id per (suggestion, local date) so a
 * double-tap or a benign re-render never creates a second Plan.
 *
 * `eventLocation` (Event Location Plan Persistence V1): only ever passed by
 * MuhurthamFinderView, and only ever PR #55's resultEventLocation (the
 * snapshot of the location that produced the currently-displayed result) --
 * never live picker state, never reconstructed from the User's current
 * Timing Location. Absent for every other caller and for an ordinary
 * Timing-Location Muhurtham save, in which case the persisted
 * eventTimezone/eventLocationName are both null (see route.ts's own
 * validation) -- byte-identical to this function's pre-persistence
 * behavior for those callers.
 *
 * Options-object shape (rather than a sixth positional parameter on
 * saveUpcomingPlanFromCandidate, PlanWithAuraView.tsx): that function
 * already had four optional trailing parameters before this PR: a fifth
 * positional would have made the call site unreadable without counting
 * commas.
 */
export interface SaveUpcomingPlanOptions {
  sharedWithName?: string;
  guestConversionToken?: string;
  clientRequestId?: string;
  eventLocation?: PlanEventLocation;
}
