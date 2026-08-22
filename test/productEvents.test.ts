import { isProductEventName, PRODUCT_EVENT_NAMES, validateProductEvent } from '../apps/web/lib/productEvents';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Closed event-name vocabulary
// ============================================================

check('isProductEventName accepts every name in the taxonomy', PRODUCT_EVENT_NAMES.every((name) => isProductEventName(name)));
check('isProductEventName rejects an unknown event name', isProductEventName('SOMETHING_MADE_UP') === false);
check('validateProductEvent rejects an unknown event name', validateProductEvent('SOMETHING_MADE_UP', {}).ok === false);

// ============================================================
// Empty-metadata events accept an empty object
// ============================================================

check('AURA_HOME_VIEWED (no metadata fields) accepts an empty object', validateProductEvent('AURA_HOME_VIEWED', {}).ok === true);
check('AURA_HOME_VIEWED accepts undefined metadata', validateProductEvent('AURA_HOME_VIEWED', undefined).ok === true);

// ============================================================
// Forbidden metadata keys -- rejected regardless of the per-event schema,
// and regardless of casing
// ============================================================

const forbiddenCases: Array<{ key: string; value: unknown }> = [
  { key: 'birthDate', value: '1990-01-01' },
  { key: 'birthTime', value: '06:30' },
  { key: 'latitude', value: 13.08 },
  { key: 'janmaNakshatra', value: 'Rohini' },
  { key: 'natalNakshatraIndex', value: 4 },
  { key: 'tarabala', value: 'SUPPORT' },
  { key: 'name', value: 'Anu' },
  { key: 'email', value: 'user@example.com' },
  { key: 'publicToken', value: 'abc123' },
  { key: 'query', value: 'when should I start a journey' },
];
for (const { key, value } of forbiddenCases) {
  const result = validateProductEvent('AURA_MOMENT_CREATED', { scope: 'GENERAL', activityId: 'start-journey', [key]: value });
  check(`Forbidden metadata key "${key}" is rejected even on an otherwise-valid event`, result.ok === false);
}
// Case-insensitivity: an attacker (or a bug) using different casing must not slip through.
check('Forbidden key check is case-insensitive (BirthDate)', validateProductEvent('AURA_MOMENT_CREATED', { scope: 'GENERAL', activityId: 'start-journey', BirthDate: '1990-01-01' }).ok === false);
check('Forbidden key check is case-insensitive (EMAIL)', validateProductEvent('AURA_HOME_VIEWED', { EMAIL: 'x@example.com' }).ok === false);

// ============================================================
// Per-event allow-list -- a key valid on one event is NOT automatically
// valid on another
// ============================================================

check('"preference" is valid on AURA_MOMENT_ANOTHER_TIME', validateProductEvent('AURA_MOMENT_ANOTHER_TIME', { scope: 'SHARED', preference: 'LATER' }).ok === true);
check('"preference" is NOT valid on AURA_MOMENT_ACCEPTED (not in that event\'s schema)', validateProductEvent('AURA_MOMENT_ACCEPTED', { scope: 'SHARED', preference: 'LATER' }).ok === false);
check('An unlisted metadata key is rejected even when it looks harmless', validateProductEvent('AURA_HOME_VIEWED', { theme: 'dark' }).ok === false);

// ============================================================
// Enum / type / bounds validation
// ============================================================

check('scope must be one of GENERAL/PERSONAL/SHARED', validateProductEvent('MUHURTHAM_SCOPE_SELECTED', { scope: 'EVERYONE' }).ok === false);
check('scope accepts a valid value', validateProductEvent('MUHURTHAM_SCOPE_SELECTED', { scope: 'PERSONAL' }).ok === true);
check('mode must be a string enum, not a number', validateProductEvent('PLAN_STARTED', { mode: 1 }).ok === false);
check('activityId must be a real, supported Muhurtham activity id', validateProductEvent('AURA_MOMENT_CREATED', { scope: 'GENERAL', activityId: 'not-a-real-activity' }).ok === false);
check('activityId accepts a real supported activity id', validateProductEvent('AURA_MOMENT_CREATED', { scope: 'GENERAL', activityId: 'start-journey' }).ok === true);
check('resultCount rejects a negative number', validateProductEvent('MUHURTHAM_SEARCH_COMPLETED', { scope: 'GENERAL', activityId: 'start-journey', resultCount: -1 }).ok === false);
check('resultCount rejects a non-finite number', validateProductEvent('MUHURTHAM_SEARCH_COMPLETED', { scope: 'GENERAL', activityId: 'start-journey', resultCount: Infinity }).ok === false);
check('durationMs rejects an absurdly large value (bounds enforced)', validateProductEvent('PLAN_SEARCH_COMPLETED', { mode: 'FIND', resultCount: 1, durationMs: 999_999_999 }).ok === false);
check('durationMs accepts a realistic value', validateProductEvent('PLAN_SEARCH_COMPLETED', { mode: 'FIND', resultCount: 1, durationMs: 240 }).ok === true);
check('relationshipType must be a known SavedPerson relationship', validateProductEvent('SAVED_PERSON_CREATED', { relationshipType: 'SOULMATE' }).ok === false);
check('relationshipType accepts a known relationship', validateProductEvent('SAVED_PERSON_CREATED', { relationshipType: 'PARTNER' }).ok === true);
check('method must be native_share or copy_link', validateProductEvent('AURA_MOMENT_SHARE_INITIATED', { scope: 'GENERAL', method: 'carrier_pigeon' }).ok === false);

// ============================================================
// Metadata sanitization -- only allow-listed keys survive into the result
// ============================================================

const sanitized = validateProductEvent('MUHURTHAM_SEARCH_COMPLETED', { scope: 'SHARED', activityId: 'start-journey', resultCount: 2, durationMs: 500 });
check('A fully valid event returns exactly the submitted allow-listed keys', sanitized.ok === true && sanitized.ok && Object.keys(sanitized.metadata).sort().join(',') === ['activityId', 'durationMs', 'resultCount', 'scope'].sort().join(','));

console.log(allPassed ? '\nALL PRODUCT EVENTS CHECKS PASSED' : '\nSOME PRODUCT EVENTS CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
