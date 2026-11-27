import { savedPersonHasChartDetails, type SavedPerson } from './db';

/**
 * AURA-MP-1 -- the API response shape for a person.
 *
 * Switch OFF (legacy contract): exactly today's fields (chart fields may now
 * be null) plus `hasChartDetails`. The My People-only columns are omitted
 * from the RESPONSE but always kept in the database, so switching back on
 * shows them again unchanged.
 * Switch ON: the full record.
 *
 * `notes` is private: it is returned only to the owner, here, and is never
 * logged or put in a ProductEvent.
 */
export function toSavedPersonResponse(person: SavedPerson, myPeopleEnabled: boolean) {
  const legacy = {
    id: person.id,
    ownerUserId: person.ownerUserId,
    name: person.name,
    relationshipType: person.relationshipType,
    birthDate: person.birthDate,
    birthTime: person.birthTime,
    birthTimezone: person.birthTimezone,
    birthCityName: person.birthCityName,
    birthLatitude: person.birthLatitude,
    birthLongitude: person.birthLongitude,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
    hasChartDetails: savedPersonHasChartDetails(person),
  };
  if (!myPeopleEnabled) return legacy;
  return {
    ...legacy,
    relationshipLabel: person.relationshipLabel,
    locationName: person.locationName,
    timezone: person.timezone,
    interests: person.interests,
    notes: person.notes,
  };
}

/**
 * R1 F5: the LIST item contract while My People is enabled (design 4.1):
 * only what a list needs. Never notes, interests, location, timezone, the
 * owner id or any detailed birth field. Detail (GET /api/people/:id) and
 * export keep the full authorised record.
 */
export function toSavedPersonListItem(
  person: SavedPerson,
  nextOccasion: { id: string; kind: string; label: string | null; date: string; daysUntil: number } | null
) {
  return {
    id: person.id,
    name: person.name,
    relationshipType: person.relationshipType,
    relationshipLabel: person.relationshipLabel,
    hasChartDetails: savedPersonHasChartDetails(person),
    nextOccasion,
  };
}
