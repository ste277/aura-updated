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

/**
 * Planning Horizon V1 -- PR P2: the one place a raw `?horizon=` URL value
 * becomes a real `PlanningHorizon`. Pure string matching only -- no
 * clock, no civil-date resolution (that stays `resolvePlanningTargetDate`
 * above's own job). `value` accepts Next.js's own `searchParams` shape
 * for a possibly-repeated query key (`string | string[] | undefined`) --
 * only its first occurrence is ever consulted, matching this
 * repository's own `?tab=` precedent (`apps/web/app/page.tsx`) of
 * treating an unexpected/duplicated param defensively rather than
 * throwing.
 *
 * Only the literal `"tomorrow"` selects `'TOMORROW'` -- every other
 * value (missing, `"today"`, unknown, malformed, empty string) resolves
 * `'TODAY'` (this ticket's own section 4: "Missing/unknown/malformed ->
 * TODAY. No not-found/error page."), which is already the correct
 * default, so no separate `"today"` branch is needed.
 */
export function parseHorizonSearchParam(value: string | string[] | undefined): PlanningHorizon {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'tomorrow' ? 'TOMORROW' : 'TODAY';
}
