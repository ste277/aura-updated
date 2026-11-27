import type {
  PersonOccasionInput,
  PersonOccasionKind,
  PersonOccasionUpdate,
  SavedPersonChartInput,
  SavedPersonInput,
  SavedPersonRelationshipType,
  SavedPersonUpdate,
} from './db';
import { isValidCustomLocation } from './cities';
import { isValidIanaTimezone } from './timezone';
import { isLeapYear, isValidMonthDay } from './personOccasions';

/**
 * Pure request validation for the SavedPerson / My People API, kept out of
 * the route files (Next's route modules may only export HTTP handlers) --
 * mirrors muhurthamSearchRequest.ts's shape.
 *
 * Two contracts (AURA-MP-1, design 11.5):
 *   - LEGACY (My People switch off): exactly today's behaviour. CREATE needs
 *     chart details; only the five original relationship types; any My
 *     People-only key is rejected with 400. UPDATE is still PARTIAL (a body
 *     without chart keys leaves the chart untouched), so the existing People
 *     screen can edit a name-only person and can never wipe My People data.
 *   - MY PEOPLE (switch on): only the name is required; chart details,
 *     relationship label, location, timezone, interests and notes are optional.
 *
 * Chart details are all-or-none in both contracts and are written whole:
 * either the flat legacy fields (birthDate/birthTime/birthTimezone + optional
 * city/lat/lng) or, in the My People contract only, a `chart` object (or
 * `chart: null` to clear). A partial set is always a 400 -- it can never
 * silently clear or half-update a chart.
 *
 * birthDate/birthTime use the EXACT same regex the existing
 * /api/users/birth-profile route already validates the user's own birth
 * profile with (see apps/web/app/api/users/birth-profile/route.ts).
 */

const MAX_NAME_LENGTH = 80;
const MAX_RELATIONSHIP_LABEL_LENGTH = 40;
const MAX_LOCATION_NAME_LENGTH = 80;
const MAX_INTERESTS = 10;
const MAX_INTEREST_LENGTH = 40;
const MAX_NOTES_LENGTH = 1000;
const MAX_OCCASION_LABEL_LENGTH = 60;
const MIN_OCCASION_YEAR = 1900;

export const LEGACY_RELATIONSHIP_TYPES: readonly SavedPersonRelationshipType[] = ['PARTNER', 'SPOUSE', 'FAMILY', 'FRIEND', 'OTHER'];
export const ALL_RELATIONSHIP_TYPES: readonly SavedPersonRelationshipType[] = [...LEGACY_RELATIONSHIP_TYPES, 'PARENT', 'CHILD', 'SIBLING'];

const FLAT_CHART_KEYS = ['birthDate', 'birthTime', 'birthTimezone'] as const;
const FLAT_CHART_OPTIONAL_KEYS = ['birthCityName', 'birthLatitude', 'birthLongitude'] as const;
/** Keys only the My People contract accepts. */
export const MY_PEOPLE_ONLY_KEYS = ['chart', 'relationshipLabel', 'locationName', 'timezone', 'interests', 'notes'] as const;

export interface SavedPersonRequestOptions {
  /** isMyPeopleEnabled() at request time. */
  myPeopleEnabled: boolean;
}

type Failure = { ok: false; error: string; status: number };
const fail = (error: string, status = 400): Failure => ({ ok: false, error, status });

export type SavedPersonValidationResult = { ok: true; input: SavedPersonInput } | Failure;
export type SavedPersonUpdateValidationResult = { ok: true; update: SavedPersonUpdate } | Failure;

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

function validateName(raw: unknown): { ok: true; value: string } | Failure {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return fail('name is required.');
  if (name.length > MAX_NAME_LENGTH) return fail(`name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  return { ok: true, value: name };
}

function validateRelationship(raw: unknown, allowed: readonly SavedPersonRelationshipType[]): { ok: true; value: SavedPersonRelationshipType } | Failure {
  if (typeof raw !== 'string' || !allowed.includes(raw as SavedPersonRelationshipType)) {
    return fail(`relationshipType must be one of: ${allowed.join(', ')}.`);
  }
  return { ok: true, value: raw as SavedPersonRelationshipType };
}

/** Validates a COMPLETE chart from any object carrying the flat chart keys. */
function validateChart(source: Record<string, unknown>): { ok: true; chart: SavedPersonChartInput } | Failure {
  const birthDate = typeof source.birthDate === 'string' ? source.birthDate.trim() : '';
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return fail('birthDate must be YYYY-MM-DD.');

  const birthTime = typeof source.birthTime === 'string' ? source.birthTime.trim() : '';
  if (!birthTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(birthTime)) {
    return fail('birthTime must be HH:MM (24h) -- required for a reliable Janma Nakshatra.');
  }

  const birthTimezone = typeof source.birthTimezone === 'string' ? source.birthTimezone.trim() : '';
  if (!birthTimezone) return fail('birthTimezone is required.');
  try {
    Intl.DateTimeFormat('en-US', { timeZone: birthTimezone });
  } catch {
    return fail('birthTimezone must be a valid IANA timezone name.');
  }

  const birthCityName = typeof source.birthCityName === 'string' && source.birthCityName.trim() ? source.birthCityName.trim() : undefined;

  let birthLatitude: number | undefined;
  let birthLongitude: number | undefined;
  if (source.birthLatitude != null || source.birthLongitude != null) {
    const latNum = Number(source.birthLatitude);
    const lngNum = Number(source.birthLongitude);
    if (!isValidCustomLocation({ latitude: latNum, longitude: lngNum, timezone: birthTimezone })) {
      return fail('Invalid birth location coordinates.');
    }
    birthLatitude = latNum;
    birthLongitude = lngNum;
  }

  return { ok: true, chart: { birthDate, birthTime, birthTimezone, birthCityName, birthLatitude, birthLongitude } };
}

/**
 * Resolves the chart part of a body:
 *   'absent'  -> no chart keys at all;
 *   chart     -> a complete, valid chart;
 *   null      -> explicit `chart: null` (My People contract only).
 */
function resolveChart(body: Record<string, unknown>, opts: SavedPersonRequestOptions): { ok: true; chart: SavedPersonChartInput | null | 'absent' } | Failure {
  const flatPresent = [...FLAT_CHART_KEYS, ...FLAT_CHART_OPTIONAL_KEYS].filter((k) => has(body, k));
  if (has(body, 'chart')) {
    if (!opts.myPeopleEnabled) return fail('Unknown field: chart.');
    if (flatPresent.length > 0) return fail('Send chart details either as `chart` or as the flat birth fields, not both.');
    if (body.chart === null) return { ok: true, chart: null };
    if (typeof body.chart !== 'object' || Array.isArray(body.chart)) return fail('chart must be an object or null.');
    const result = validateChart(body.chart as Record<string, unknown>);
    return result.ok ? { ok: true, chart: result.chart } : result;
  }
  if (flatPresent.length === 0) return { ok: true, chart: 'absent' };
  // Any flat chart key present means the WHOLE chart is being written.
  const result = validateChart(body);
  return result.ok ? { ok: true, chart: result.chart } : result;
}

function optionalText(raw: unknown, field: string, max: number): { ok: true; value: string | null } | Failure {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return fail(`${field} must be a string or null.`);
  const value = raw.trim();
  if (value.length > max) return fail(`${field} must be ${max} characters or fewer.`);
  return { ok: true, value: value || null };
}

function validateInterests(raw: unknown): { ok: true; value: string[] } | Failure {
  if (raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail('interests must be an array of strings.');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return fail('interests must be an array of strings.');
    const value = item.trim();
    if (!value) continue;
    if (value.length > MAX_INTEREST_LENGTH) return fail(`each interest must be ${MAX_INTEREST_LENGTH} characters or fewer.`);
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  if (out.length > MAX_INTERESTS) return fail(`at most ${MAX_INTERESTS} interests.`);
  return { ok: true, value: out };
}

/** Validates the My People-only optional fields present in `body`. */
function validateMyPeopleFields(body: Record<string, unknown>, opts: SavedPersonRequestOptions): { ok: true; fields: Partial<SavedPersonUpdate> } | Failure {
  const present = MY_PEOPLE_ONLY_KEYS.filter((k) => k !== 'chart' && has(body, k));
  if (!opts.myPeopleEnabled) {
    return present.length > 0 ? fail(`Unknown field: ${present[0]}.`) : { ok: true, fields: {} };
  }
  const fields: Partial<SavedPersonUpdate> = {};
  if (has(body, 'relationshipLabel')) {
    const r = optionalText(body.relationshipLabel, 'relationshipLabel', MAX_RELATIONSHIP_LABEL_LENGTH);
    if (!r.ok) return r;
    fields.relationshipLabel = r.value;
  }
  if (has(body, 'locationName')) {
    const r = optionalText(body.locationName, 'locationName', MAX_LOCATION_NAME_LENGTH);
    if (!r.ok) return r;
    fields.locationName = r.value;
  }
  if (has(body, 'timezone')) {
    const r = optionalText(body.timezone, 'timezone', 64);
    if (!r.ok) return r;
    if (r.value !== null && !isValidIanaTimezone(r.value)) return fail('timezone must be a valid IANA timezone name.');
    fields.timezone = r.value;
  }
  if (has(body, 'interests')) {
    const r = validateInterests(body.interests);
    if (!r.ok) return r;
    fields.interests = r.value;
  }
  if (has(body, 'notes')) {
    const r = optionalText(body.notes, 'notes', MAX_NOTES_LENGTH);
    if (!r.ok) return r;
    fields.notes = r.value;
  }
  return { ok: true, fields };
}

/** CREATE (POST /api/people). */
export function buildSavedPersonCreateInput(body: Record<string, unknown>, opts: SavedPersonRequestOptions): SavedPersonValidationResult {
  const name = validateName(body.name);
  if (!name.ok) return name;

  const allowed = opts.myPeopleEnabled ? ALL_RELATIONSHIP_TYPES : LEGACY_RELATIONSHIP_TYPES;
  const relationship = validateRelationship(has(body, 'relationshipType') ? body.relationshipType : 'OTHER', allowed);
  if (!relationship.ok) return relationship;

  const chart = resolveChart(body, opts);
  if (!chart.ok) return chart;
  if (!opts.myPeopleEnabled && (chart.chart === 'absent' || chart.chart === null)) {
    // Legacy contract: chart details are required to create a person. Run
    // the full validator so the error message is exactly today's.
    const legacy = validateChart(body);
    if (!legacy.ok) return legacy;
  }

  const extra = validateMyPeopleFields(body, opts);
  if (!extra.ok) return extra;

  const c = chart.chart !== 'absent' && chart.chart !== null ? chart.chart : null;
  return {
    ok: true,
    input: {
      name: name.value,
      relationshipType: relationship.value,
      ...(c
        ? {
            birthDate: c.birthDate,
            birthTime: c.birthTime,
            birthTimezone: c.birthTimezone,
            birthCityName: c.birthCityName ?? undefined,
            birthLatitude: c.birthLatitude ?? undefined,
            birthLongitude: c.birthLongitude ?? undefined,
          }
        : {}),
      ...(extra.fields as Partial<SavedPersonInput>),
    },
  };
}

/** UPDATE (PATCH /api/people/:id) -- always PARTIAL, in both contracts. */
export function buildSavedPersonUpdate(body: Record<string, unknown>, opts: SavedPersonRequestOptions): SavedPersonUpdateValidationResult {
  const update: SavedPersonUpdate = {};
  if (has(body, 'name')) {
    const name = validateName(body.name);
    if (!name.ok) return name;
    update.name = name.value;
  }
  if (has(body, 'relationshipType')) {
    const allowed = opts.myPeopleEnabled ? ALL_RELATIONSHIP_TYPES : LEGACY_RELATIONSHIP_TYPES;
    const relationship = validateRelationship(body.relationshipType, allowed);
    if (!relationship.ok) return relationship;
    update.relationshipType = relationship.value;
  }
  const chart = resolveChart(body, opts);
  if (!chart.ok) return chart;
  if (chart.chart !== 'absent') update.chart = chart.chart;

  const extra = validateMyPeopleFields(body, opts);
  if (!extra.ok) return extra;
  Object.assign(update, extra.fields);
  return { ok: true, update };
}

/**
 * The ORIGINAL legacy full-body validator (chart required, five original
 * relationship types). Kept so existing callers and tests keep their exact
 * semantics; equivalent to buildSavedPersonCreateInput with My People off.
 */
export function buildSavedPersonInput(body: Record<string, unknown>): SavedPersonValidationResult {
  return buildSavedPersonCreateInput(body, { myPeopleEnabled: false });
}

// ============================================================
// Special days (PersonOccasion)
// ============================================================

const OCCASION_KINDS: readonly PersonOccasionKind[] = ['BIRTHDAY', 'ANNIVERSARY', 'OTHER'];
const OCCASION_KEYS = ['kind', 'label', 'month', 'day', 'year', 'remindDaysBefore'] as const;

export type PersonOccasionValidationResult = { ok: true; input: PersonOccasionInput } | Failure;
export type PersonOccasionUpdateValidationResult = { ok: true; update: PersonOccasionUpdate } | Failure;

/** Parses the occasion keys present in `body` (types only, no cross-field rules). */
export function parsePersonOccasionFields(body: Record<string, unknown>): PersonOccasionUpdateValidationResult {
  const unknownKey = Object.keys(body).find((k) => !(OCCASION_KEYS as readonly string[]).includes(k));
  if (unknownKey) return fail(`Unknown field: ${unknownKey}.`);
  const update: PersonOccasionUpdate = {};
  if (has(body, 'kind')) {
    if (typeof body.kind !== 'string' || !OCCASION_KINDS.includes(body.kind as PersonOccasionKind)) {
      return fail(`kind must be one of: ${OCCASION_KINDS.join(', ')}.`);
    }
    update.kind = body.kind as PersonOccasionKind;
  }
  if (has(body, 'label')) {
    const r = optionalText(body.label, 'label', MAX_OCCASION_LABEL_LENGTH);
    if (!r.ok) return r;
    update.label = r.value;
  }
  for (const key of ['month', 'day'] as const) {
    if (has(body, key)) {
      if (!Number.isInteger(body[key])) return fail(`${key} must be a whole number.`);
      update[key] = body[key] as number;
    }
  }
  if (has(body, 'year')) {
    if (body.year !== null && !Number.isInteger(body.year)) return fail('year must be a whole number or null.');
    update.year = body.year as number | null;
  }
  if (has(body, 'remindDaysBefore')) {
    if (body.remindDaysBefore !== null && !Number.isInteger(body.remindDaysBefore)) return fail('remindDaysBefore must be a whole number or null.');
    update.remindDaysBefore = body.remindDaysBefore as number | null;
  }
  return { ok: true, update };
}

/**
 * Full cross-field validation of a complete special day (used for CREATE and
 * for the merged result of an UPDATE). `currentYear` is the user's local year.
 *   - month 1-12; day valid for that month (31 Apr rejected, 29 Feb allowed);
 *   - year optional, 1900..currentYear, and a leap year when the date is 29 Feb;
 *   - label required for OTHER; remindDaysBefore null or 0..30.
 */
export function validatePersonOccasion(occasion: PersonOccasionInput, currentYear: number): Failure | null {
  if (!OCCASION_KINDS.includes(occasion.kind)) return fail(`kind must be one of: ${OCCASION_KINDS.join(', ')}.`);
  if (!Number.isInteger(occasion.month) || occasion.month < 1 || occasion.month > 12) return fail('month must be 1-12.');
  if (!isValidMonthDay(occasion.month, occasion.day)) return fail('day is not a valid date for that month.');
  if (occasion.year != null) {
    if (occasion.year < MIN_OCCASION_YEAR || occasion.year > currentYear) return fail(`year must be between ${MIN_OCCASION_YEAR} and ${currentYear}.`);
    if (occasion.month === 2 && occasion.day === 29 && !isLeapYear(occasion.year)) return fail('29 February needs a leap year.');
  }
  if (occasion.kind === 'OTHER' && !occasion.label) return fail('label is required for OTHER special days.');
  if (occasion.remindDaysBefore != null && (occasion.remindDaysBefore < 0 || occasion.remindDaysBefore > 30)) {
    return fail('remindDaysBefore must be between 0 and 30, or null.');
  }
  return null;
}

/** CREATE a special day: kind, month and day are required. */
export function buildPersonOccasionInput(body: Record<string, unknown>, currentYear: number): PersonOccasionValidationResult {
  const parsed = parsePersonOccasionFields(body);
  if (!parsed.ok) return parsed;
  const { kind, month, day } = parsed.update;
  if (kind === undefined) return fail('kind is required.');
  if (month === undefined || day === undefined) return fail('month and day are required.');
  const input: PersonOccasionInput = {
    kind,
    month,
    day,
    label: parsed.update.label ?? null,
    year: parsed.update.year ?? null,
    remindDaysBefore: parsed.update.remindDaysBefore === undefined ? 7 : parsed.update.remindDaysBefore,
  };
  const error = validatePersonOccasion(input, currentYear);
  return error ?? { ok: true, input };
}
