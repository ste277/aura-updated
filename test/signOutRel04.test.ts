/**
 * AURA-ANDROID-REL-04 -- lib/signOut.ts: sign-out reports success only when the
 * server removed the session cookie, and clears the account-less offline
 * activity-log queue only then (after asking when it still holds entries).
 *
 *   npx ts-node test/signOutRel04.test.ts
 *
 * Baseline defect (app/page.tsx before REL-04): `await fetch(logout); setUser(null)`
 * -- a 5xx showed "signed out" while the cookie stayed valid; offline threw and
 * said nothing; the queue survived and replayed under the next account.
 */
import { performSignOut, unsyncedQueueCount, unsyncedQueueWarning, OFFLINE_HABIT_QUEUE_KEY, SignOutDeps } from '../apps/web/lib/signOut';

let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }

function memStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    removeItem: (k: string) => { data.delete(k); },
  };
}

function deps(over: Partial<SignOutDeps> & { status?: number | 'throw'; confirmAnswer?: boolean; storageInit?: Record<string, string> } = {}) {
  const calls = { fetch: [] as string[], confirm: [] as string[] };
  const storage = memStorage(over.storageInit);
  const d: SignOutDeps = {
    fetch: async (url, init) => {
      calls.fetch.push(`${init.method} ${url}`);
      if (over.status === 'throw') throw new TypeError('Failed to fetch');
      const status = over.status ?? 200;
      return { ok: status >= 200 && status < 300 };
    },
    storage,
    confirm: (m) => { calls.confirm.push(m); return over.confirmAnswer ?? true; },
  };
  return { d, calls, storage };
}

const queue2 = JSON.stringify([{ activityTitle: 'Walk' }, { activityTitle: 'Read' }]);

(async () => {
  {
    const { d, calls, storage } = deps();
    check('200, empty queue -> signed-out', (await performSignOut(d)) === 'signed-out');
    check('posts to /api/auth/logout exactly once', calls.fetch.length === 1 && calls.fetch[0] === 'POST /api/auth/logout');
    check('no confirmation when nothing is queued', calls.confirm.length === 0);
    check('storage untouched apart from the queue key', storage.data.size === 0);
  }
  {
    const { d } = deps({ status: 500 });
    check('HTTP 500 -> failed (UI must stay signed in)', (await performSignOut(d)) === 'failed');
  }
  {
    const { d } = deps({ status: 'throw' });
    check('network error -> failed, never throws', (await performSignOut(d)) === 'failed');
  }
  {
    const { d, storage } = deps({ status: 503, storageInit: { [OFFLINE_HABIT_QUEUE_KEY]: queue2 } });
    check('failed sign-out keeps the offline queue', (await performSignOut(d)) === 'failed' && storage.data.get(OFFLINE_HABIT_QUEUE_KEY) === queue2);
  }
  {
    const { d, calls, storage } = deps({ storageInit: { [OFFLINE_HABIT_QUEUE_KEY]: queue2, other: 'x' } });
    check('queued entries + confirm yes -> signed-out', (await performSignOut(d)) === 'signed-out');
    check('asked once, naming the 2 unsynced logs', calls.confirm.length === 1 && /2 activity logs/.test(calls.confirm[0]));
    check('confirmed sign-out removes the queue', !storage.data.has(OFFLINE_HABIT_QUEUE_KEY));
    check('other storage keys are left alone', storage.data.get('other') === 'x');
  }
  {
    const { d, calls, storage } = deps({ confirmAnswer: false, storageInit: { [OFFLINE_HABIT_QUEUE_KEY]: queue2 } });
    check('confirm no -> cancelled', (await performSignOut(d)) === 'cancelled');
    check('cancelled: no logout request sent', calls.fetch.length === 0);
    check('cancelled: queue kept', storage.data.get(OFFLINE_HABIT_QUEUE_KEY) === queue2);
  }
  {
    const { d, calls } = deps({ storageInit: { [OFFLINE_HABIT_QUEUE_KEY]: '{not json' } });
    check('corrupt queue -> no prompt, sign-out proceeds', (await performSignOut(d)) === 'signed-out' && calls.confirm.length === 0);
  }
  {
    const d: SignOutDeps = { fetch: async () => ({ ok: true }), storage: null, confirm: () => true };
    check('no storage available -> signed-out', (await performSignOut(d)) === 'signed-out');
  }
  {
    const throwing = { getItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    const d: SignOutDeps = { fetch: async () => ({ ok: true }), storage: throwing, confirm: () => true };
    check('throwing storage -> signed-out, never throws', (await performSignOut(d)) === 'signed-out');
  }
  check('unsyncedQueueCount counts array entries', unsyncedQueueCount(memStorage({ [OFFLINE_HABIT_QUEUE_KEY]: queue2 })) === 2);
  check('singular wording for one entry', /1 activity log that/.test(unsyncedQueueWarning(1)) && /remove it/.test(unsyncedQueueWarning(1)));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
