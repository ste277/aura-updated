import { getUserById, listAllPersonOccasionsForOwner, type PersonOccasion, type SavedPerson } from './db';
import { getDatePartsInTimezone } from './timezone';
import { listUpcomingOccasions, nextOccurrence, type UpcomingOccasion } from './personOccasions';

/**
 * AURA-MP-1 -- small shared helpers for the My People routes (route modules
 * may only export HTTP handlers). Pure apart from the user/occasion reads.
 */

/** The user's local calendar date and year, in their own User.timezone. */
export async function userLocalToday(userId: string, now: Date = new Date()): Promise<{ date: string; year: number } | null> {
  const user = await getUserById(userId);
  if (!user) return null;
  const parts = getDatePartsInTimezone(user.timezone, now);
  return { date: parts.dateStr, year: parts.year };
}

export function toOccasionResponse(occasion: PersonOccasion, todayLocal: string) {
  const next = nextOccurrence(occasion, todayLocal);
  return {
    id: occasion.id,
    savedPersonId: occasion.savedPersonId,
    kind: occasion.kind,
    label: occasion.label,
    calendar: occasion.calendar,
    month: occasion.month,
    day: occasion.day,
    year: occasion.year,
    remindDaysBefore: occasion.remindDaysBefore,
    next: next ? { date: next.date, daysUntil: next.daysUntil, turning: next.turning, observedFromLeapDay: next.observedFromLeapDay } : null,
  };
}

/** Next special day per person (soonest), for the people list. */
export async function nextOccasionByPerson(ownerUserId: string, people: SavedPerson[], todayLocal: string): Promise<Map<string, UpcomingOccasion>> {
  const occasions = await listAllPersonOccasionsForOwner(ownerUserId);
  const peopleById = new Map(people.map((p) => [p.id, { name: p.name }]));
  const upcoming = listUpcomingOccasions(occasions, peopleById, todayLocal, 366);
  const byPerson = new Map<string, UpcomingOccasion>();
  for (const item of upcoming) if (!byPerson.has(item.personId)) byPerson.set(item.personId, item);
  return byPerson;
}
