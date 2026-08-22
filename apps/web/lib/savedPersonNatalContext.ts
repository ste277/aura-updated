import { getSavedPersonForOwner } from './db';
import { natalContextFromBirthDetails } from './natalContext';
import type { NatalContext } from '../../../packages/vedic/src/natalChart';

function formatUTCDateString(dateInput: Date | string): string {
  if (typeof dateInput === 'string') return dateInput.split('T')[0];
  const year = dateInput.getUTCFullYear();
  const month = String(dateInput.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateInput.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The main architectural output of the Partner Profile Foundation PR
 * (brief section 11): the same shape evaluatePersonalMuhurtaFit() /
 * findPersonalMuhurthams() need (structurally == PersonalMuhurtaContext,
 * see NatalContext's own doc comment), derived for a SAVED PERSON instead
 * of the authenticated user -- via the exact same natalContextFromBirthDetails()
 * -> buildNatalContext() chain the user's own context uses, never a second
 * astronomy path.
 *
 * Ownership-enforced: getSavedPersonForOwner() only ever returns a row that
 * belongs to `ownerUserId` (see db.ts) -- there is no code path here that
 * can leak another user's SavedPerson data. Returns null when the id
 * doesn't exist OR doesn't belong to this owner (indistinguishable on
 * purpose, so a caller can't probe for the existence of someone else's
 * record).
 *
 *   User natal context        -> Personal Muhurtham
 *   SavedPerson natal context -> (future) Partner Personal Muhurtham
 *   Both contexts              -> (future) Shared Muhurtham
 *
 * This PR intentionally stops at producing the SavedPerson side of that
 * diagram -- no Finder/scoring change ships here.
 */
export async function getSavedPersonNatalContext(savedPersonId: string, ownerUserId: string): Promise<NatalContext | null> {
  const person = await getSavedPersonForOwner(ownerUserId, savedPersonId);
  if (!person) return null;
  return natalContextFromBirthDetails(formatUTCDateString(person.birthDate), person.birthTime, person.birthTimezone);
}
