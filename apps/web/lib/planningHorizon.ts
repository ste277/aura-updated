/**
 * Planning Horizon V1 -- PR P1: the smallest shared planning-horizon type
 * and its pure civil-date resolution.
 *
 * `THIS_WEEK` is deliberately NOT a member of `PlanningHorizon` yet (this
 * ticket's own section 3: "prefer not to expose unsupported enum
 * values") -- a later PR's own addition, once cross-day orchestration
 * actually exists to serve it.
 *
 * `resolvePlanningTargetDate` reuses `addDaysToDateStr` (timezone.ts)
 * verbatim -- pure calendar-date-string stepping (Date.UTC component
 * arithmetic), never `now + 24h` millisecond arithmetic (this ticket's
 * own section 2/4), so it stays correct across DST transitions, month
 * boundaries, year boundaries, and leap days exactly as
 * `addDaysToDateStr` itself already is. This file never reads a clock --
 * `currentDate` is always the caller's own already-resolved civil date
 * (e.g. from `getDatePartsInTimezone`), matching this repository's own
 * established purity convention for every other date-only helper.
 */

import { addDaysToDateStr } from './timezone';

export type PlanningHorizon = 'TODAY' | 'TOMORROW';

export function resolvePlanningTargetDate(input: { horizon: PlanningHorizon; currentDate: string }): string {
  switch (input.horizon) {
    case 'TODAY':
      return input.currentDate;
    case 'TOMORROW':
      return addDaysToDateStr(input.currentDate, 1);
  }
}
