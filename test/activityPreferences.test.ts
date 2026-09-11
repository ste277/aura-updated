/**
 * Explicit Duration Preferences Foundation V1: pure regression suite for
 * apps/web/lib/activityPreferences.ts's validation and projection helpers.
 * No DB, no fetch, no Date.now() -- matches this repo's established pure
 * test pattern (see test/behavioralAffinity.test.ts).
 *
 * FOUNDATION ONLY: this suite proves the module's own validation/projection
 * contract. It does not touch Day Builder, Daily Guidance, Forward Planner,
 * Ask Aura, or behavioralAffinity.ts -- this module has no consumer yet.
 * Live-DB persistence (set/clear/list against a real Postgres row) is
 * covered separately in test/activityPreferencesDb.test.ts.
 */
import {
  validateActivityId,
  validatePreferredDurationMinutes,
  preferredDurationByActivityId,
  UserActivityPreference,
} from '../apps/web/lib/activityPreferences';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ── Duration validation (items A-G) ─────────────────────────────────────

check('A. 15 (lower bound) accepted', validatePreferredDurationMinutes(15) === 15);
check('B. 360 (upper bound) accepted', validatePreferredDurationMinutes(360) === 360);
check('C. 14 (just under lower bound) rejected', throws(() => validatePreferredDurationMinutes(14)));
check('D. 361 (just over upper bound) rejected', throws(() => validatePreferredDurationMinutes(361)));
check('E. decimal (45.5) rejected', throws(() => validatePreferredDurationMinutes(45.5)));
check('F. NaN rejected', throws(() => validatePreferredDurationMinutes(NaN)));
check('G. Infinity rejected', throws(() => validatePreferredDurationMinutes(Infinity)));
check('G. -Infinity rejected', throws(() => validatePreferredDurationMinutes(-Infinity)));
check('bonus: 0 rejected (below floor, not just "falsy passes")', throws(() => validatePreferredDurationMinutes(0)));
check('bonus: negative value rejected', throws(() => validatePreferredDurationMinutes(-30)));
check('bonus: a mid-range valid integer (45) accepted', validatePreferredDurationMinutes(45) === 45);
check(
  'bonus: an arbitrary valid value NOT present in any catalog suggestedDurations (50) is still accepted -- suggestedDurations are UI hints, never storage constraints',
  validatePreferredDurationMinutes(50) === 50
);

// ── Activity validation ─────────────────────────────────────────────────

check('canonical activityId (workout) accepted', validateActivityId('workout') === 'workout');
check('canonical activityId (deep-work) accepted', validateActivityId('deep-work') === 'deep-work');
check('unknown activityId rejected', throws(() => validateActivityId('not-a-real-activity-xyz')));
check('empty-string activityId rejected', throws(() => validateActivityId('')));

// ── Projection helper (items H-L) ───────────────────────────────────────

{
  const prefs: UserActivityPreference[] = [
    { activityId: 'workout', preferredDurationMinutes: 45 },
    { activityId: 'deep-work', preferredDurationMinutes: 90 },
  ];
  const map = preferredDurationByActivityId(prefs);
  check('H. projection creates an activityId -> preferredDurationMinutes map', map['workout'] === 45 && map['deep-work'] === 90);
  check('H. projection contains exactly the entries given, nothing extra', Object.keys(map).length === 2);
}

{
  const prefs: UserActivityPreference[] = [{ activityId: 'workout', preferredDurationMinutes: 45 }];
  const mapA = preferredDurationByActivityId(prefs);
  const mapB = preferredDurationByActivityId(prefs);
  check('I. projection is deterministic (repeated calls, identical output)', JSON.stringify(mapA) === JSON.stringify(mapB));
}

{
  const prefs: UserActivityPreference[] = [{ activityId: 'workout', preferredDurationMinutes: 45 }];
  const before = JSON.stringify(prefs);
  preferredDurationByActivityId(prefs);
  check('J. projection does not mutate its input array', JSON.stringify(prefs) === before);
}

{
  // K. Duplicate projection behavior: LAST ENTRY WINS, deliberately mirroring
  // behavioralAffinity.ts's own activityDurationByActivityId semantics. This
  // can never happen from real DB data (the @@unique([userId, activityId])
  // constraint guarantees at most one row per activityId) -- this test only
  // proves the pure function's own documented, deliberate behavior for
  // hand-constructed input.
  const prefs: UserActivityPreference[] = [
    { activityId: 'workout', preferredDurationMinutes: 30 },
    { activityId: 'workout', preferredDurationMinutes: 60 },
  ];
  const map = preferredDurationByActivityId(prefs);
  check('K. duplicate activityId in input: LAST ENTRY WINS (documented, deliberate)', map['workout'] === 60);
}

{
  const map = preferredDurationByActivityId([]);
  check('bonus: empty input projects to an empty map', Object.keys(map).length === 0);
}

// ── Family-vs-activity granularity contract (item L) ─────────────────────

{
  // L. The app contract is activity-level (activityId), never family-level
  // -- two activities in the SAME Muhurta family (coffee-tea and
  // birthday-party are both SOCIAL) must resolve completely independently,
  // proving the type/projection carries no family concept at all.
  const prefs: UserActivityPreference[] = [
    { activityId: 'coffee-tea', preferredDurationMinutes: 30 },
    { activityId: 'birthday-party', preferredDurationMinutes: 150 },
  ];
  const map = preferredDurationByActivityId(prefs);
  check(
    'L. contract is activity-level, not family-level: coffee-tea and birthday-party (same SOCIAL family) resolve independently',
    map['coffee-tea'] === 30 && map['birthday-party'] === 150
  );
  check('L. UserActivityPreference carries only activityId + preferredDurationMinutes, no family field', Object.keys(prefs[0]).sort().join(',') === 'activityId,preferredDurationMinutes');
}

if (!allPassed) {
  console.error('\nSome Explicit Duration Preferences (pure) checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL EXPLICIT DURATION PREFERENCES (PURE) CHECKS PASSED');
}
