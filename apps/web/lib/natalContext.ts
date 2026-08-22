import { buildNatalContext, NatalContext } from '../../../packages/vedic/src/natalChart';
import { localDateTimeToUTC } from './timezone';
import type { User } from './db';
import type { PersonalMuhurtaContext } from '../../../packages/recommendation/src/auraFitEngine';

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

function formatUTCDateString(dateInput: Date | string): string {
  if (typeof dateInput === 'string') return dateInput.split('T')[0];
  const year = dateInput.getUTCFullYear();
  const month = String(dateInput.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateInput.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * "Does this user even have a complete birth profile, and if so what's
 * their natal context" -- the wrapper every PERSONAL/SHARED-aware route
 * needs on top of natalContextFromBirthDetails() above. Previously
 * duplicated byte-for-byte in muhurtham-search/route.ts and
 * timing-search/route.ts (each with its own private formatUTCDateString());
 * consolidated here as part of Aura Moment Rescheduling, which needs this
 * exact same resolution a third time (to recompute the owner's personal
 * context server-side when generating reschedule alternatives -- see brief
 * section 11: "Recalculate private personal context server-side", never
 * snapshot it).
 */
export function buildPersonalMuhurtaContextForUser(user: User): PersonalMuhurtaContext | undefined {
  if (!user.birthDate || !user.birthTime || !user.birthTimezone) return undefined;
  return natalContextFromBirthDetails(formatUTCDateString(user.birthDate), user.birthTime, user.birthTimezone);
}
