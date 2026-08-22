import type { SavedPersonInput, SavedPersonRelationshipType } from './db';
import { isValidCustomLocation } from './cities';

/**
 * Pure request validation for the SavedPerson CRUD API, kept out of the
 * route files (Next's route modules may only export HTTP handlers) --
 * mirrors muhurthamSearchRequest.ts's shape.
 *
 * birthDate/birthTime use the EXACT same regex the existing
 * /api/users/birth-profile route already validates the user's own birth
 * profile with (see apps/web/app/api/users/birth-profile/route.ts) -- same
 * validation semantics, per brief section 4. birthLatitude/birthLongitude
 * are validated when PRESENT but never required (see SavedPerson's own
 * schema doc comment for why they're genuinely optional for natal
 * calculation).
 */

const MAX_NAME_LENGTH = 80;
const VALID_RELATIONSHIP_TYPES = new Set<SavedPersonRelationshipType>(['PARTNER', 'SPOUSE', 'FAMILY', 'FRIEND', 'OTHER']);

export type SavedPersonValidationResult =
  | { ok: true; input: SavedPersonInput }
  | { ok: false; error: string; status: number };

export function buildSavedPersonInput(body: Record<string, unknown>): SavedPersonValidationResult {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required.', status: 400 };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `name must be ${MAX_NAME_LENGTH} characters or fewer.`, status: 400 };

  const rawRelationship = typeof body.relationshipType === 'string' ? body.relationshipType : 'OTHER';
  if (!VALID_RELATIONSHIP_TYPES.has(rawRelationship as SavedPersonRelationshipType)) {
    return { ok: false, error: `relationshipType must be one of: ${[...VALID_RELATIONSHIP_TYPES].join(', ')}.`, status: 400 };
  }

  const birthDate = typeof body.birthDate === 'string' ? body.birthDate.trim() : '';
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { ok: false, error: 'birthDate must be YYYY-MM-DD.', status: 400 };
  }

  const birthTime = typeof body.birthTime === 'string' ? body.birthTime.trim() : '';
  if (!birthTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(birthTime)) {
    return { ok: false, error: 'birthTime must be HH:MM (24h) -- required for a reliable Janma Nakshatra.', status: 400 };
  }

  const birthTimezone = typeof body.birthTimezone === 'string' ? body.birthTimezone.trim() : '';
  if (!birthTimezone) return { ok: false, error: 'birthTimezone is required.', status: 400 };
  try {
    Intl.DateTimeFormat('en-US', { timeZone: birthTimezone });
  } catch {
    return { ok: false, error: 'birthTimezone must be a valid IANA timezone name.', status: 400 };
  }

  const birthCityName = typeof body.birthCityName === 'string' && body.birthCityName.trim() ? body.birthCityName.trim() : undefined;

  let birthLatitude: number | undefined;
  let birthLongitude: number | undefined;
  if (body.birthLatitude !== undefined || body.birthLongitude !== undefined) {
    const latNum = Number(body.birthLatitude);
    const lngNum = Number(body.birthLongitude);
    if (!isValidCustomLocation({ latitude: latNum, longitude: lngNum, timezone: birthTimezone })) {
      return { ok: false, error: 'Invalid birth location coordinates.', status: 400 };
    }
    birthLatitude = latNum;
    birthLongitude = lngNum;
  }

  return {
    ok: true,
    input: {
      name,
      relationshipType: rawRelationship as SavedPersonRelationshipType,
      birthDate,
      birthTime,
      birthTimezone,
      birthCityName,
      birthLatitude,
      birthLongitude,
    },
  };
}
