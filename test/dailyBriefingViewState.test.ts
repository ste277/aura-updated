// AURA DB2 -- apps/web/lib/dailyBriefingViewState.ts.
// Run with: npx ts-node test/dailyBriefingViewState.test.ts
import { loadLastExpandedLocalDate, saveLastExpandedLocalDate } from '../apps/web/lib/dailyBriefingViewState';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// A minimal in-memory localStorage stand-in (Node has no real one). Each
// test section installs/uninstalls it explicitly so "storage unavailable"
// can be exercised as a genuine absence, not just an empty store.
// ============================================================

function installMemoryStorage() {
  const store = new Map<string, string>();
  (global as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  return store;
}

function installThrowingStorage() {
  (global as any).localStorage = {
    getItem: () => { throw new Error('SecurityError: storage disabled'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
}

function uninstallStorage() {
  delete (global as any).localStorage;
}

async function main() {
  // ---- 1. Normal read/write round trip ----
  installMemoryStorage();

  check('1. loadLastExpandedLocalDate returns null for a user with no recorded state', loadLastExpandedLocalDate('user-a') === null);
  saveLastExpandedLocalDate('user-a', '2026-10-22');
  check('1. loadLastExpandedLocalDate returns exactly what was saved', loadLastExpandedLocalDate('user-a') === '2026-10-22');

  // ---- 2. Per-user isolation (user switching on the same browser) ----
  check('2. a DIFFERENT userId has its own, independent (still null) state -- no shared key', loadLastExpandedLocalDate('user-b') === null);
  saveLastExpandedLocalDate('user-b', '2026-10-05');
  check('2. user-a\'s own state is untouched by user-b\'s write', loadLastExpandedLocalDate('user-a') === '2026-10-22');
  check('2. user-b\'s own state is exactly what user-b wrote, not user-a\'s', loadLastExpandedLocalDate('user-b') === '2026-10-05');

  // ---- 3. New local day resets (string comparison, caller's own responsibility) ----
  check('3. a stored date differs from "today" by plain string inequality -- the exact mechanism a caller uses to detect a new local day', loadLastExpandedLocalDate('user-a') !== '2026-10-23');
  saveLastExpandedLocalDate('user-a', '2026-10-23');
  check('3. after a new day\'s write, the record reflects the new day (overwrites, not appends)', loadLastExpandedLocalDate('user-a') === '2026-10-23');

  // ---- 4. Storage unavailable (private browsing, disabled, quota) must not throw ----
  installThrowingStorage();
  let threw = false;
  try {
    loadLastExpandedLocalDate('user-c');
  } catch {
    threw = true;
  }
  check('4. loadLastExpandedLocalDate never throws even when the underlying storage.getItem throws', !threw);
  check('4. it degrades to null (treated as "nothing recorded yet", a safe default) rather than crashing', loadLastExpandedLocalDate('user-c') === null);

  threw = false;
  try {
    saveLastExpandedLocalDate('user-c', '2026-10-22');
  } catch {
    threw = true;
  }
  check('4. saveLastExpandedLocalDate never throws even when the underlying storage.setItem throws', !threw);

  // ---- 5. localStorage entirely undefined (SSR) must not crash ----
  uninstallStorage();
  threw = false;
  try {
    loadLastExpandedLocalDate('user-d');
  } catch {
    threw = true;
  }
  check('5. with localStorage entirely undefined (SSR-safe), loadLastExpandedLocalDate does not throw', !threw);
  check('5. and returns null (safe default)', loadLastExpandedLocalDate('user-d') === null);

  threw = false;
  try {
    saveLastExpandedLocalDate('user-d', '2026-10-22');
  } catch {
    threw = true;
  }
  check('5. with localStorage entirely undefined, saveLastExpandedLocalDate does not throw', !threw);

  if (!allPassed) { console.error('SOME DB2 VIEW-STATE CHECKS FAILED'); process.exit(1); }
  console.log('ALL DB2 VIEW-STATE CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
