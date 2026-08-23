// Product Instrumentation V1 -- a small, closed event taxonomy plus per-event
// metadata validation. This is the ONLY module in the app that knows what a
// "valid" product event looks like; every write path (server route handlers,
// and the client-tracking API route) must go through `validateProductEvent`
// here before anything reaches the database.
//
// Two things are deliberately enforced BEFORE any per-event allow-list is
// consulted:
//   1. The event name must be one of the closed set below (no free-form
//      event names).
//   2. No metadata key may appear in FORBIDDEN_METADATA_KEYS, regardless of
//      whether a per-event schema would otherwise accept it. This is
//      defense-in-depth: even a future mistake in an event's own schema
//      cannot leak one of these fields.
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';
import { createProductEvent } from './db';

export type ProductEventName =
  | 'AURA_HOME_VIEWED'
  | 'PLAN_STARTED'
  | 'PLAN_SEARCH_COMPLETED'
  | 'PLAN_RESULT_SELECTED'
  | 'PANCHANG_CALENDAR_VIEWED'
  | 'PANCHANG_DATE_VIEWED'
  | 'MUHURTHAM_SEARCH_STARTED'
  | 'MUHURTHAM_SCOPE_SELECTED'
  | 'MUHURTHAM_SEARCH_COMPLETED'
  | 'SAVED_PERSON_CREATED'
  | 'AURA_MOMENT_CREATED'
  | 'AURA_MOMENT_SHARE_INITIATED'
  | 'AURA_MOMENT_OPENED'
  | 'AURA_MOMENT_ACCEPTED'
  | 'AURA_MOMENT_ANOTHER_TIME'
  | 'AURA_MOMENT_ALTERNATIVE_CREATED'
  | 'AURA_MOMENT_FIND_YOUR_OWN_CLICKED'
  | 'REMINDER_OPENED'
  | 'ACTIVITY_LOGGED_NOW'
  | 'WEB_PUSH_ENABLED'
  | 'WEB_PUSH_DISABLED'
  | 'REMINDER_PUSH_SENT'
  | 'ASK_AURA_SUBMITTED'
  | 'ASK_AURA_INTENT_RESOLVED'
  | 'ASK_AURA_RESULT_ACTION';

export const PRODUCT_EVENT_NAMES: ProductEventName[] = [
  'AURA_HOME_VIEWED',
  'PLAN_STARTED',
  'PLAN_SEARCH_COMPLETED',
  'PLAN_RESULT_SELECTED',
  'PANCHANG_CALENDAR_VIEWED',
  'PANCHANG_DATE_VIEWED',
  'MUHURTHAM_SEARCH_STARTED',
  'MUHURTHAM_SCOPE_SELECTED',
  'MUHURTHAM_SEARCH_COMPLETED',
  'SAVED_PERSON_CREATED',
  'AURA_MOMENT_CREATED',
  'AURA_MOMENT_SHARE_INITIATED',
  'AURA_MOMENT_OPENED',
  'AURA_MOMENT_ACCEPTED',
  'AURA_MOMENT_ANOTHER_TIME',
  'AURA_MOMENT_ALTERNATIVE_CREATED',
  'AURA_MOMENT_FIND_YOUR_OWN_CLICKED',
  'REMINDER_OPENED',
  'ACTIVITY_LOGGED_NOW',
  'WEB_PUSH_ENABLED',
  'WEB_PUSH_DISABLED',
  'REMINDER_PUSH_SENT',
  'ASK_AURA_SUBMITTED',
  'ASK_AURA_INTENT_RESOLVED',
  'ASK_AURA_RESULT_ACTION',
];

export function isProductEventName(value: string): value is ProductEventName {
  return (PRODUCT_EVENT_NAMES as string[]).includes(value);
}

// Which events are tracked from the server (at the moment of DB success) vs.
// the client (a UI intent signal with no reliable server equivalent). This
// is documentation for call sites, not enforced by validation itself -- the
// client tracking API still validates SERVER-tracked event names the same
// way, but route handlers should never call it for a client-only event.
export const CLIENT_TRACKED_EVENTS: ReadonlySet<ProductEventName> = new Set<ProductEventName>([
  'AURA_HOME_VIEWED',
  'PLAN_STARTED',
  'PLAN_RESULT_SELECTED',
  'PANCHANG_CALENDAR_VIEWED',
  'PANCHANG_DATE_VIEWED',
  'MUHURTHAM_SEARCH_STARTED',
  'MUHURTHAM_SCOPE_SELECTED',
  'AURA_MOMENT_SHARE_INITIATED',
  'AURA_MOMENT_FIND_YOUR_OWN_CLICKED',
  // Aura Reminders V1 (brief section 29/30): a genuine user click, not a
  // recomputed-per-GET impression -- REMINDER_SURFACED (an impression
  // event) is deliberately NOT implemented (section 30 explicitly permits
  // deferring impression analytics when clean dedup isn't straightforward;
  // reminders are recomputed on every GET /api/aura-updates, so a naive
  // "surfaced" event would fire on every poll).
  'REMINDER_OPENED',
  // Good Right Now Actions V1 (brief section 19) -- handleLogActivity()
  // (page.tsx) is deliberately optimistic/offline-resilient and never
  // surfaces server DB success/failure to its caller (queues locally on
  // any failure instead of throwing), so there is no reliable point to
  // track this server-side at the moment of DB success the way
  // AURA_MOMENT_CREATED is. Tracked as a UI intent signal instead, the same
  // convention as every other CLIENT_TRACKED_EVENTS entry.
  'ACTIVITY_LOGGED_NOW',
  // Web Push V1 (brief section 30) -- both are user-initiated UI intent
  // (the "Enable notifications" / "Turn off" buttons), fired at click time,
  // not server-confirmed subscribe/unsubscribe outcomes.
  'WEB_PUSH_ENABLED',
  'WEB_PUSH_DISABLED',
  // Ask Aura Orchestration V1 (brief section 30) -- SUBMITTED/RESULT_ACTION
  // are UI intent signals (send button pressed / result action clicked),
  // mirroring PLAN_STARTED/PLAN_RESULT_SELECTED's own client-tracked
  // pattern. INTENT_RESOLVED is deliberately NOT here -- it's recorded
  // server-side by the route at the moment parsing actually happens
  // (mirrors PLAN_SEARCH_COMPLETED), never duplicated client-side.
  'ASK_AURA_SUBMITTED',
  'ASK_AURA_RESULT_ACTION',
]);

// Fields that must NEVER appear in ProductEvent.metadata, under any event,
// under any casing. This list is the direct enforcement of the brief's
// forbidden-metadata section (birth data, natal placements, raw reasons,
// names/emails, tokens, and free-text queries).
const FORBIDDEN_METADATA_KEYS = new Set<string>([
  'birthdate',
  'birthtime',
  'birthtimezone',
  'birthlatitude',
  'birthlongitude',
  'latitude',
  'longitude',
  'coordinates',
  'janmanakshatra',
  'janmarashi',
  'natalnakshatraindex',
  'tarabala',
  'reasons',
  'muhurtareasons',
  'name',
  'savedpersonname',
  'recipientname',
  'senderdisplayname',
  'shareddisplayname',
  'email',
  'publictoken',
  'token',
  'query',
  'message',
  'conversation',
]);

const SCOPE_VALUES = new Set(['GENERAL', 'PERSONAL', 'SHARED']);
const TIMING_MODE_VALUES = new Set(['FIND', 'CHECK', 'COMPARE']);
const PREFERENCE_VALUES = new Set(['EARLIER', 'LATER', 'DIFFERENT_DAY', 'NO_PREFERENCE']);
const SHARE_METHOD_VALUES = new Set(['native_share', 'copy_link']);
const RELATIONSHIP_VALUES = new Set(['PARTNER', 'SPOUSE', 'FAMILY', 'FRIEND', 'OTHER']);
// Product Structure V2 (brief section 31): "at minimum ensure we can
// distinguish... source = PLAN | MUHURTHAM, planningMode = EVERYDAY |
// IMPORTANT | CEREMONIAL" -- reusing the exact same closed vocabularies
// AuraMomentSource/PlanningMode already define, not a third copy.
const SOURCE_VALUES = new Set(['PLAN', 'MUHURTHAM']);
const PLANNING_MODE_VALUES = new Set(['EVERYDAY', 'IMPORTANT', 'CEREMONIAL']);
// Aura Reminders V1 (brief section 12): the only two reminder types -- lead
// time is data (leadTimeMinutes below), not a distinct type per lead time.
const SCHEDULED_ITEM_TYPE_VALUES = new Set(['PLANNED_ACTIVITY', 'AURA_MOMENT']);
// Good Right Now Actions V1 (brief section 19) -- deliberately its own
// vocabulary, not a reuse of SOURCE_VALUES above (PLAN | MUHURTHAM means
// "which search flow produced this AuraMoment", an unrelated concept to
// "which screen initiated this activity log").
const LOG_ORIGIN_VALUES = new Set(['HOME']);
const WINDOW_TYPE_VALUES = new Set(['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'GULIKA', 'YAMA', 'NEUTRAL']);
const IMMEDIATE_ACTION_TYPE_VALUES = new Set(['LOG_NOW', 'START_NOW']);
// Good Right Now Action Semantics V1 (brief section 14) -- the same closed
// vocabulary ActivityDurationMode already defines, not a third copy.
const DURATION_MODE_VALUES = new Set(['INSTANT', 'FIXED', 'USER_SELECTED', 'SESSION']);
// Web Push V1 (brief section 31) -- ONE canonical REMINDER_OPENED event
// with a `source` distinguishing an in-app open (Home/Updates) from a push
// notification click, rather than a second REMINDER_PUSH_OPENED event
// representing the same user action ("this reminder was opened").
const REMINDER_OPEN_SOURCE_VALUES = new Set(['IN_APP', 'PUSH']);
// Ask Aura Orchestration V1 (brief section 30) -- the exact same closed
// enums askAuraIntent.ts's own AskAuraIntent/AskHorizonPhrase types define,
// not a third copy. Deliberately excludes activityId's own free-text
// fallback (taskTitle) and the raw prompt itself -- FORBIDDEN_METADATA_KEYS
// above already blocks 'query'/'message' outright as defense-in-depth.
const ASK_INTENT_VALUES = new Set([
  'GOOD_RIGHT_NOW', 'TIMING_FIND', 'TIMING_CHECK', 'TIMING_COMPARE',
  'PANCHANG_QUERY', 'PANCHANG_EXPLAIN', 'MUHURTHAM_SEARCH', 'PLAN_OPEN', 'UNKNOWN',
]);
const ASK_HORIZON_VALUES = new Set([
  'NOW', 'TODAY', 'TOMORROW', 'THIS_WEEKEND', 'NEXT_WEEKEND', 'THIS_WEEK',
  'NEXT_7_DAYS', 'NEXT_MONTH', 'CUSTOM_DATE', 'UNSPECIFIED',
]);
const ASK_TIME_PREFERENCE_VALUES = new Set(['ANY', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT']);
const ASK_RESULT_ACTION_VALUES = new Set(['PLAN_THIS', 'CREATE_MOMENT', 'OPEN_PLAN', 'OPEN_TIMELINE', 'OPEN_PANCHANG', 'OPEN_MUHURTHAM']);

type FieldSchema =
  | { type: 'enum'; values: Set<string> }
  | { type: 'activityId' }
  | { type: 'number'; min: number; max: number }
  | { type: 'boolean' };

const scopeField: FieldSchema = { type: 'enum', values: SCOPE_VALUES };
const activityIdField: FieldSchema = { type: 'activityId' };
const durationField: FieldSchema = { type: 'number', min: 0, max: 120_000 };
const sourceField: FieldSchema = { type: 'enum', values: SOURCE_VALUES };
const planningModeField: FieldSchema = { type: 'enum', values: PLANNING_MODE_VALUES };

const EVENT_METADATA_SCHEMAS: Record<ProductEventName, Record<string, FieldSchema>> = {
  AURA_HOME_VIEWED: {},
  PLAN_STARTED: {
    mode: { type: 'enum', values: TIMING_MODE_VALUES },
  },
  PLAN_SEARCH_COMPLETED: {
    mode: { type: 'enum', values: TIMING_MODE_VALUES },
    resultCount: { type: 'number', min: 0, max: 1000 },
    durationMs: durationField,
  },
  PLAN_RESULT_SELECTED: {
    mode: { type: 'enum', values: TIMING_MODE_VALUES },
  },
  PANCHANG_CALENDAR_VIEWED: {},
  PANCHANG_DATE_VIEWED: {},
  MUHURTHAM_SEARCH_STARTED: {
    scope: scopeField,
    activityId: activityIdField,
  },
  MUHURTHAM_SCOPE_SELECTED: {
    scope: scopeField,
  },
  MUHURTHAM_SEARCH_COMPLETED: {
    scope: scopeField,
    activityId: activityIdField,
    resultCount: { type: 'number', min: 0, max: 500 },
    durationMs: durationField,
  },
  SAVED_PERSON_CREATED: {
    relationshipType: { type: 'enum', values: RELATIONSHIP_VALUES },
  },
  AURA_MOMENT_CREATED: {
    scope: scopeField,
    activityId: activityIdField,
    source: sourceField,
    planningMode: planningModeField,
  },
  AURA_MOMENT_SHARE_INITIATED: {
    scope: scopeField,
    method: { type: 'enum', values: SHARE_METHOD_VALUES },
    planningMode: planningModeField,
  },
  AURA_MOMENT_OPENED: {
    scope: scopeField,
  },
  AURA_MOMENT_ACCEPTED: {
    scope: scopeField,
  },
  AURA_MOMENT_ANOTHER_TIME: {
    scope: scopeField,
    preference: { type: 'enum', values: PREFERENCE_VALUES },
  },
  AURA_MOMENT_ALTERNATIVE_CREATED: {
    scope: scopeField,
    activityId: activityIdField,
    source: sourceField,
    planningMode: planningModeField,
  },
  AURA_MOMENT_FIND_YOUR_OWN_CLICKED: {},
  REMINDER_OPENED: {
    scheduledItemType: { type: 'enum', values: SCHEDULED_ITEM_TYPE_VALUES },
    leadTimeMinutes: { type: 'number', min: 0, max: 120 },
    // Web Push V1 -- optional; existing in-app call sites are unaffected
    // by adding this (omitted keys are never validated), only the new
    // push-click path sets it to 'PUSH'.
    source: { type: 'enum', values: REMINDER_OPEN_SOURCE_VALUES },
  },
  ACTIVITY_LOGGED_NOW: {
    // Omitted for the two Good Right Now cards with no catalog counterpart
    // (see actionCards.ts's abhijit-meal/yama-lightmeal) -- validation only
    // runs on keys that are actually present.
    activityId: activityIdField,
    source: { type: 'enum', values: LOG_ORIGIN_VALUES },
    windowType: { type: 'enum', values: WINDOW_TYPE_VALUES },
    actionType: { type: 'enum', values: IMMEDIATE_ACTION_TYPE_VALUES },
    // Good Right Now Action Semantics V1 (brief section 14) -- safe,
    // non-identifying: which duration rule applied and the actual minutes
    // logged (0 for INSTANT, never a birth/natal/Panchang-detail payload).
    durationMode: { type: 'enum', values: DURATION_MODE_VALUES },
    durationMinutes: { type: 'number', min: 0, max: 180 },
  },
  WEB_PUSH_ENABLED: {},
  WEB_PUSH_DISABLED: {},
  REMINDER_PUSH_SENT: {
    scheduledItemType: { type: 'enum', values: SCHEDULED_ITEM_TYPE_VALUES },
    leadTimeMinutes: { type: 'number', min: 0, max: 120 },
  },
  ASK_AURA_SUBMITTED: {},
  ASK_AURA_INTENT_RESOLVED: {
    intent: { type: 'enum', values: ASK_INTENT_VALUES },
    activityId: activityIdField,
    scope: scopeField,
    horizon: { type: 'enum', values: ASK_HORIZON_VALUES },
    timePreference: { type: 'enum', values: ASK_TIME_PREFERENCE_VALUES },
  },
  ASK_AURA_RESULT_ACTION: {
    intent: { type: 'enum', values: ASK_INTENT_VALUES },
    action: { type: 'enum', values: ASK_RESULT_ACTION_VALUES },
  },
};

export type ProductEventMetadataValue = string | number | boolean;
export type ProductEventMetadata = Record<string, ProductEventMetadataValue>;

export type ProductEventValidationResult =
  | { ok: true; eventName: ProductEventName; metadata: ProductEventMetadata }
  | { ok: false; error: string };

export function validateProductEvent(eventName: string, rawMetadata: unknown): ProductEventValidationResult {
  if (!isProductEventName(eventName)) {
    return { ok: false, error: `Unknown product event name: "${eventName}"` };
  }

  const source =
    rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)
      ? (rawMetadata as Record<string, unknown>)
      : {};

  const schema = EVENT_METADATA_SCHEMAS[eventName];
  const metadata: ProductEventMetadata = {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;

    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
      return { ok: false, error: `metadata key "${key}" is not allowed on any product event` };
    }

    const fieldSchema = schema[key];
    if (!fieldSchema) {
      return { ok: false, error: `metadata key "${key}" is not allowed on event "${eventName}"` };
    }

    if (fieldSchema.type === 'enum') {
      if (typeof value !== 'string' || !fieldSchema.values.has(value)) {
        return { ok: false, error: `metadata.${key} must be one of: ${Array.from(fieldSchema.values).join(', ')}` };
      }
      metadata[key] = value;
    } else if (fieldSchema.type === 'activityId') {
      // Everyday Moment Rescheduling V1 fix: this used to check
      // isSupportedMuhurthamActivity(), which silently rejected (and
      // dropped) every event carrying an everyday, non-Muhurtham-eligible
      // activityId -- AURA_MOMENT_CREATED/AURA_MOMENT_ALTERNATIVE_CREATED
      // for any Plan-sourced moment (Date Night, Coffee, ...) never
      // actually persisted since Product Structure V2 shipped. Any real
      // catalog activity id is valid metadata here; the events that are
      // genuinely Muhurtham-Finder-only (MUHURTHAM_SEARCH_STARTED/
      // MUHURTHAM_SEARCH_COMPLETED) only ever receive a Muhurtham-eligible
      // id from their own call sites anyway, so this loosening does not
      // weaken validation for those.
      if (typeof value !== 'string' || !FULL_ACTIVITY_CATALOG.some((activity) => activity.id === value)) {
        return { ok: false, error: `metadata.${key} must be a known catalog activity id` };
      }
      metadata[key] = value;
    } else if (fieldSchema.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < fieldSchema.min || value > fieldSchema.max) {
        return { ok: false, error: `metadata.${key} must be a number between ${fieldSchema.min} and ${fieldSchema.max}` };
      }
      metadata[key] = value;
    } else if (fieldSchema.type === 'boolean') {
      if (typeof value !== 'boolean') {
        return { ok: false, error: `metadata.${key} must be a boolean` };
      }
      metadata[key] = value;
    }
  }

  return { ok: true, eventName, metadata };
}

export interface RecordProductEventInput {
  eventName: string;
  userId?: string | null;
  auraMomentId?: string | null;
  metadata?: unknown;
}

/** The ONLY function server/client tracking code should call to persist a
 * product event -- it validates first, then writes. Deliberately never
 * throws: instrumentation must never break the user-facing action it is
 * attached to (an owner creating an Aura Moment must succeed even if a bug
 * in this file's own schema rejects the tracking call for it). Callers that
 * need to distinguish "bad input" from "recorded" (the client-facing
 * tracking API route, so it can return a 400 during development) should
 * inspect the returned `ok` field themselves rather than relying on a throw. */
export async function recordProductEvent(input: RecordProductEventInput): Promise<ProductEventValidationResult> {
  const validation = validateProductEvent(input.eventName, input.metadata ?? {});
  if (!validation.ok) {
    console.warn(`[productEvents] dropped invalid event: ${validation.error}`);
    return validation;
  }
  try {
    await createProductEvent({
      eventName: validation.eventName,
      userId: input.userId ?? null,
      auraMomentId: input.auraMomentId ?? null,
      metadata: validation.metadata,
    });
  } catch (err) {
    console.warn(`[productEvents] failed to persist event "${validation.eventName}":`, err);
  }
  return validation;
}
