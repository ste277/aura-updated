/**
 * Pure logic test for lib/webPushClient.ts's capability-state detection and
 * permission-request gating (Web Push V1, brief sections 6/7/35). Runs
 * under plain Node with hand-built stand-ins for the browser globals this
 * module reads (window, navigator, Notification, fetch) -- no jsdom, no
 * real browser needed to prove the two things this brief cares most about:
 *
 *   1. NOTHING in this module calls Notification.requestPermission() except
 *      subscribeToPush() itself -- there is no path from module load or
 *      getPushCapabilityState() (the function every page mount calls) to a
 *      permission prompt.
 *   2. getPushCapabilityState() never claims SUBSCRIBED from the browser's
 *      local PushManager state alone -- it must agree with the server.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

let requestPermissionCallCount = 0;

function installBrowserStubs(opts: {
  supported?: boolean;
  permission?: 'granted' | 'denied' | 'default';
  browserSubscription?: unknown;
  serverHasActiveSubscription?: boolean;
  fetchOk?: boolean;
}) {
  requestPermissionCallCount = 0;
  const permission = opts.permission ?? 'default';

  const notificationStub = {
    permission,
    requestPermission: async () => {
      requestPermissionCallCount += 1;
      return permission === 'default' ? 'granted' : permission;
    },
  };

  const registrationStub = {
    pushManager: {
      getSubscription: async () => opts.browserSubscription ?? null,
    },
  };

  const navigatorStub: Record<string, unknown> = {
    userAgent: 'test-agent',
    serviceWorker: opts.supported === false ? undefined : { ready: Promise.resolve(registrationStub) },
  };
  if (opts.supported === false) delete navigatorStub.serviceWorker;

  const windowStub: Record<string, unknown> = {};
  if (opts.supported !== false) {
    windowStub.PushManager = function PushManager() {};
    windowStub.Notification = notificationStub;
  }

  // Node 21+ ships built-in read-only `global.navigator`/`global.fetch`
  // getters -- redefine them (configurable, writable) rather than assigning
  // directly, which throws against a getter-only property.
  const defineGlobal = (name: string, value: unknown) => {
    Object.defineProperty(global, name, { value, configurable: true, writable: true });
  };
  defineGlobal('window', windowStub);
  defineGlobal('navigator', navigatorStub);
  if (opts.supported === false) {
    delete (global as unknown as { Notification?: unknown }).Notification;
  } else {
    defineGlobal('Notification', notificationStub);
  }

  defineGlobal('fetch', async (url: string) => {
    if (url === '/api/push-subscriptions') {
      return {
        ok: opts.fetchOk ?? true,
        json: async () => ({ hasActiveSubscription: opts.serverHasActiveSubscription ?? false }),
      };
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
}

function stubFetch(handler: (url: string) => Promise<unknown>) {
  Object.defineProperty(global, 'fetch', { value: handler, configurable: true, writable: true });
}

async function main() {
  // Import AFTER the global stubs module is loadable -- webPushClient.ts
  // reads window/navigator/Notification inside function bodies (never at
  // module-load time), so importing once up top and re-stubbing globals
  // between calls is safe and matches how the real module is written.
  const { isPushSupported, getPushCapabilityState, subscribeToPush } = await import('../apps/web/lib/webPushClient');

  // ============================================================
  // isPushSupported -- false whenever any required browser API is missing.
  // ============================================================
  installBrowserStubs({ supported: false });
  check('isPushSupported is false when serviceWorker/PushManager/Notification are unavailable', isPushSupported() === false);

  installBrowserStubs({ supported: true, permission: 'default' });
  check('isPushSupported is true when all required browser APIs are present', isPushSupported() === true);

  // ============================================================
  // Brief section 6/35 -- THE central requirement: no automatic permission
  // prompt. getPushCapabilityState() is what every page mount calls to
  // decide what to render; it must NEVER call requestPermission(),
  // regardless of the current permission state.
  // ============================================================
  for (const permission of ['default', 'denied', 'granted'] as const) {
    installBrowserStubs({ supported: true, permission, browserSubscription: null });
    await getPushCapabilityState();
    check(`getPushCapabilityState() never calls Notification.requestPermission() when permission is '${permission}'`, requestPermissionCallCount === 0);
  }

  // ============================================================
  // Capability state mapping.
  // ============================================================
  installBrowserStubs({ supported: false });
  check('UNSUPPORTED when the browser lacks push APIs', (await getPushCapabilityState()) === 'UNSUPPORTED');

  installBrowserStubs({ supported: true, permission: 'denied' });
  check("DENIED when Notification.permission is 'denied'", (await getPushCapabilityState()) === 'DENIED');

  installBrowserStubs({ supported: true, permission: 'default' });
  check("NOT_ASKED when Notification.permission is 'default'", (await getPushCapabilityState()) === 'NOT_ASKED');

  installBrowserStubs({ supported: true, permission: 'granted', browserSubscription: null });
  check('GRANTED when permission is granted but there is no browser PushManager subscription yet', (await getPushCapabilityState()) === 'GRANTED');

  installBrowserStubs({ supported: true, permission: 'granted', browserSubscription: { endpoint: 'https://example.com/x' }, serverHasActiveSubscription: true });
  check('SUBSCRIBED only when BOTH a browser subscription AND an active server record exist', (await getPushCapabilityState()) === 'SUBSCRIBED');

  // Brief section 7 -- the two can disagree (e.g. server disabled the
  // subscription after a provider 410 while the browser object is still
  // technically present). Must NEVER claim SUBSCRIBED from browser state
  // alone.
  installBrowserStubs({ supported: true, permission: 'granted', browserSubscription: { endpoint: 'https://example.com/x' }, serverHasActiveSubscription: false });
  check('GRANTED (not SUBSCRIBED) when the browser has a subscription object but the server disagrees', (await getPushCapabilityState()) === 'GRANTED');

  // ============================================================
  // subscribeToPush -- the ONE place a permission prompt may occur, and
  // only from this explicit call (never from getPushCapabilityState above).
  // ============================================================
  installBrowserStubs({ supported: true, permission: 'default' });
  stubFetch(async (url: string) => {
    if (url === '/api/push/public-key') return { ok: false }; // short-circuits before subscribe -- still exercises the permission call
    throw new Error(`Unexpected fetch: ${url}`);
  });
  await subscribeToPush();
  check('subscribeToPush() DOES call Notification.requestPermission() -- it is the one deliberate, user-initiated path', requestPermissionCallCount === 1);

  installBrowserStubs({ supported: true, permission: 'denied' });
  const deniedOutcome = await subscribeToPush();
  check('subscribeToPush() reports permission_denied without throwing when the browser blocks it', !deniedOutcome.ok && deniedOutcome.ok === false && (deniedOutcome as { reason: string }).reason === 'permission_denied');

  console.log(allPassed ? '\nALL WEB PUSH CLIENT CAPABILITY CHECKS PASSED' : '\nSOME WEB PUSH CLIENT CAPABILITY CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
