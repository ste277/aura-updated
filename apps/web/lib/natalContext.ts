import { buildNatalContext, NatalContext } from '../../../packages/vedic/src/natalChart';
import { localDateTimeToUTC } from './timezone';

/**
 * The single shared "raw birth details -> natal context" adapter for this
 * app. Both the authenticated user's own birth profile (timing-search,
 * muhurtham-search, and natal-chart routes) and a SavedPerson's birth
 * profile (savedPersonNatalContext.ts) call this SAME function -- there is
 * exactly one astronomy implementation (packages/vedic/src/natalChart.ts's
 * buildNatalContext()), not a second "calculatePartnerChart()". This file
 * only adds the local-time-to-UTC conversion step (apps/web-specific,
 * that's why it isn't inside packages/vedic itself).
 */
export function natalContextFromBirthDetails(birthDate: string, birthTime: string, birthTimezone: string): NatalContext {
  const birthMomentUTC = localDateTimeToUTC(birthDate, birthTime, birthTimezone);
  return buildNatalContext(birthMomentUTC);
}
