/**
 * AURA-REM-01 -- notification availability and permission states, plus the
 * pure scheduler safeguards. Mounts the real components/DeviceNotificationSettings.tsx
 * (React 18 + jsdom via test/jsdomReactHarness.ts) with stubbed browser push
 * APIs and a stubbed server, and checks every state the brief lists:
 * not requested, granted, denied (and recovery), unsupported device/browser,
 * iPhone/iPad browser tab, service not configured, subscription expired, and
 * "set up but background delivery not running".
 *
 * Run with:
 *   npx ts-node --project tsconfig.jsdom-tests.json test/reminderNotificationSettingsJsdom.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { React, mount, click, act } from './jsdomReactHarness';

const { DeviceNotificationSettings } = require('../apps/web/components/DeviceNotificationSettings');
const { classifyBackgroundDelivery, DISPATCH_HEARTBEAT_MAX_AGE_MINUTES } = require('../apps/web/lib/reminderDeliveryStatus');
const { dispatchSecrets, isDispatchAuthorized } = require('../apps/web/lib/reminderDispatchAuth');
const { isTooLateForPush } = require('../apps/web/lib/reminderDelivery');

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

type Delivery = 'AVAILABLE' | 'NOT_CONFIGURED' | 'SCHEDULER_INACTIVE';
interface Scenario {
  supported?: boolean;
  userAgent?: string;
  permission?: NotificationPermission;
  /** What requestPermission() resolves to when the user is asked. */
  promptAnswer?: NotificationPermission;
  browserSubscription?: boolean;
  serverActive?: boolean;
  delivery?: Delivery;
  publicKeyStatus?: number;
}

const env = {
  requestPermissionCalls: 0,
  unsubscribeCalls: 0,
  subscribeCalls: 0,
  posts: [] as string[],
  permission: 'default' as NotificationPermission,
  hasBrowserSub: false,
  serverActive: false,
  delivery: 'AVAILABLE' as Delivery,
};

function install(s: Scenario) {
  env.requestPermissionCalls = 0;
  env.unsubscribeCalls = 0;
  env.subscribeCalls = 0;
  env.posts = [];
  env.permission = s.permission ?? 'default';
  env.hasBrowserSub = s.browserSubscription ?? false;
  env.serverActive = s.serverActive ?? false;
  env.delivery = s.delivery ?? 'AVAILABLE';

  const makeSub = () => ({
    endpoint: 'https://push.example.invalid/device',
    toJSON: () => ({ endpoint: 'https://push.example.invalid/device', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: async () => { env.unsubscribeCalls++; env.hasBrowserSub = false; return true; },
  });
  const registration = {
    pushManager: {
      getSubscription: async () => (env.hasBrowserSub ? makeSub() : null),
      subscribe: async () => { env.subscribeCalls++; env.hasBrowserSub = true; return makeSub(); },
    },
  };
  const notification = {
    get permission() { return env.permission; },
    requestPermission: async () => {
      env.requestPermissionCalls++;
      if (env.permission === 'default') env.permission = s.promptAnswer ?? 'granted';
      return env.permission;
    },
  };

  const nav: Record<string, unknown> = { userAgent: s.userAgent ?? 'Mozilla/5.0 (Macintosh) Chrome/131', platform: 'MacIntel', maxTouchPoints: 0 };
  const w = window as any;
  delete w.PushManager;
  delete w.Notification;
  delete (global as any).Notification;
  if (s.supported !== false) {
    nav.serviceWorker = { ready: Promise.resolve(registration) };
    w.PushManager = function PushManager() {};
    w.Notification = notification;
    (global as any).Notification = notification;
  }
  Object.defineProperty(global, 'navigator', { value: nav, configurable: true });

  (global as any).fetch = async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/push-subscriptions' && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ hasActiveSubscription: env.serverActive, backgroundDelivery: env.delivery }) };
    }
    if (url === '/api/push-subscriptions' && method === 'POST') {
      env.posts.push(url);
      env.serverActive = true;
      return { ok: true, status: 200, json: async () => ({ id: 'sub-1' }) };
    }
    if (url === '/api/push/public-key') {
      const status = s.publicKeyStatus ?? 200;
      return { ok: status === 200, status, json: async () => (status === 200 ? { publicKey: 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } : { error: 'not configured' }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function render(s: Scenario) {
  install(s);
  const h = await mount(React.createElement(DeviceNotificationSettings));
  await flush();
  await flush();
  const root = h.container;
  return {
    h,
    root,
    state: () => root.querySelector('[data-push-state]')?.getAttribute('data-push-state') ?? null,
    text: () => root.textContent ?? '',
    button: (label: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined,
  };
}

const IN_APP = 'Reminders still appear in Aura while it’s open.';

async function main() {
  // ---------------------------------------------------------------
  // Settings states
  // ---------------------------------------------------------------
  {
    const r = await render({ supported: false });
    check('S1. Unsupported browser: says so, offers in-app fallback, no enable button', r.state() === 'UNSUPPORTED' && r.text().includes(IN_APP) && !r.button('Enable notifications'));
    await r.h.unmount();
  }
  {
    const r = await render({ supported: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1' });
    check('S2. iPhone Safari tab: Add to Home Screen guidance', r.state() === 'IOS_INSTALL_REQUIRED' && r.text().includes('Add to Home Screen'));
    await r.h.unmount();
  }
  {
    const r = await render({ permission: 'default', delivery: 'NOT_CONFIGURED' });
    check('S3. Service not configured: no enable button, no prompt, honest copy', r.state() === 'NOT_CONFIGURED' && !r.button('Enable notifications') && env.requestPermissionCalls === 0 && r.text().includes("aren't available yet"));
    await r.h.unmount();
  }
  {
    const r = await render({ permission: 'default' });
    check('S4. Not requested: enable button shown, nothing prompted on mount', r.state() === 'NOT_ASKED' && !!r.button('Enable notifications') && env.requestPermissionCalls === 0);
    await r.h.unmount();
  }
  {
    const r = await render({ permission: 'denied' });
    check('S5. Denied: browser-settings guidance, no button, no prompt', r.state() === 'DENIED' && r.text().includes('site settings') && !r.button('Enable notifications') && env.requestPermissionCalls === 0);
    // Recovery: the user allows notifications in browser settings and returns.
    env.permission = 'granted';
    await act(async () => { window.dispatchEvent(new (window as any).Event('focus')); });
    await flush();
    await flush();
    check('S6. Denied -> allowed in browser settings -> returning to Aura re-reads the state (enable offered, no reload)', r.state() === 'GRANTED' && !!r.button('Enable notifications') && env.requestPermissionCalls === 0);
    await r.h.unmount();
  }
  {
    const r = await render({ permission: 'granted', browserSubscription: true, serverActive: true, delivery: 'AVAILABLE' });
    check('S7. Subscribed and background delivery running: "On"', r.state() === 'SUBSCRIBED' && r.text().includes('even when Aura is closed') && !!r.button('Turn off'));
    await r.h.unmount();
  }
  {
    const r = await render({ permission: 'granted', browserSubscription: true, serverActive: true, delivery: 'SCHEDULER_INACTIVE' });
    check('S8. Subscribed but scheduler not running: never "On"; says not working yet', r.state() === 'BACKGROUND_UNAVAILABLE' && !/\bOn\b/.test(r.text().replace('Turn off', '')) && r.text().includes('Not working yet') && r.text().includes(IN_APP));
    await r.h.unmount();
  }
  {
    const r = await render({ permission: 'granted', browserSubscription: true, serverActive: false });
    check('S9. Expired subscription: explains and offers "Turn on again"', r.state() === 'SUBSCRIPTION_EXPIRED' && !!r.button('Turn on again'));
    await click(r.button('Turn on again')!);
    await flush();
    check('S10. "Turn on again" drops the dead browser subscription and registers a fresh one', env.unsubscribeCalls === 1 && env.subscribeCalls === 1 && env.posts.length === 1 && r.state() === 'SUBSCRIBED');
    await r.h.unmount();
  }

  // ---------------------------------------------------------------
  // Enable flows
  // ---------------------------------------------------------------
  {
    const r = await render({ permission: 'default', delivery: 'AVAILABLE' });
    await click(r.button('Enable notifications')!);
    await flush();
    check('E1. Enable (allowed, scheduler running): one prompt, then "On"', env.requestPermissionCalls === 1 && r.state() === 'SUBSCRIBED');
    await r.h.unmount();
  }
  {
    const r = await render({ permission: 'default', delivery: 'SCHEDULER_INACTIVE' });
    await click(r.button('Enable notifications')!);
    await flush();
    check('E2. Enable while the scheduler is not running: device set up, but shown as not working yet (no false success)', r.state() === 'BACKGROUND_UNAVAILABLE' && !r.text().includes('Reminders will reach this device'));
    await r.h.unmount();
  }
  {
    const r = await render({ permission: 'default', promptAnswer: 'denied' });
    await click(r.button('Enable notifications')!);
    await flush();
    check('E3. User blocks the prompt: denied guidance, no re-prompt button', r.state() === 'DENIED' && !r.button('Enable notifications'));
    await r.h.unmount();
  }
  {
    const r = await render({ permission: 'granted', publicKeyStatus: 503, delivery: 'SCHEDULER_INACTIVE' });
    await click(r.button('Enable notifications')!);
    await flush();
    check('E4. Server push keys missing at enable time: shows not-available, not a generic error', r.state() === 'NOT_CONFIGURED');
    await r.h.unmount();
  }

  // ---------------------------------------------------------------
  // Pure safeguards
  // ---------------------------------------------------------------
  const now = new Date('2026-11-24T10:00:00.000Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  check('P1. No VAPID keys -> NOT_CONFIGURED', classifyBackgroundDelivery({ pushConfigured: false, heartbeat: { lastRunAt: now, lastRunConfigured: true }, now }) === 'NOT_CONFIGURED');
  check('P2. Scheduler never ran -> SCHEDULER_INACTIVE', classifyBackgroundDelivery({ pushConfigured: true, heartbeat: null, now }) === 'SCHEDULER_INACTIVE');
  check(`P3. Last run ${DISPATCH_HEARTBEAT_MAX_AGE_MINUTES} min ago -> AVAILABLE (boundary)`, classifyBackgroundDelivery({ pushConfigured: true, heartbeat: { lastRunAt: minutesAgo(DISPATCH_HEARTBEAT_MAX_AGE_MINUTES), lastRunConfigured: true }, now }) === 'AVAILABLE');
  check('P4. Last run 16 min ago -> SCHEDULER_INACTIVE', classifyBackgroundDelivery({ pushConfigured: true, heartbeat: { lastRunAt: minutesAgo(16), lastRunConfigured: true }, now }) === 'SCHEDULER_INACTIVE');
  check('P5. Once-a-day cron (last run 20 h ago) -> SCHEDULER_INACTIVE', classifyBackgroundDelivery({ pushConfigured: true, heartbeat: { lastRunAt: minutesAgo(1200), lastRunConfigured: true }, now }) === 'SCHEDULER_INACTIVE');
  check('P6. Push not sent at or after the start time', isTooLateForPush(now.toISOString(), now) && isTooLateForPush(minutesAgo(1).toISOString(), now) && !isTooLateForPush(new Date(now.getTime() + 60_000).toISOString(), now));

  const cron = 'c'.repeat(32);
  const internal = 'i'.repeat(32);
  check('A1. Dispatch accepts Vercel Cron\'s CRON_SECRET bearer', isDispatchAuthorized(`Bearer ${cron}`, dispatchSecrets({ CRON_SECRET: cron })));
  check('A2. Dispatch still accepts INTERNAL_REMINDER_DISPATCH_SECRET', isDispatchAuthorized(`Bearer ${internal}`, dispatchSecrets({ INTERNAL_REMINDER_DISPATCH_SECRET: internal })));
  check('A3. No secret configured -> always refused (fail closed)', !isDispatchAuthorized('Bearer ', dispatchSecrets({})) && !isDispatchAuthorized(`Bearer ${cron}`, dispatchSecrets({})));
  check('A4. Wrong or missing bearer refused', !isDispatchAuthorized(`Bearer ${internal}`, dispatchSecrets({ CRON_SECRET: cron })) && !isDispatchAuthorized(null, dispatchSecrets({ CRON_SECRET: cron })) && !isDispatchAuthorized(cron, dispatchSecrets({ CRON_SECRET: cron })));
  check('A5. Secrets shorter than 16 characters are ignored', dispatchSecrets({ CRON_SECRET: 'short' }).length === 0);

  const pageSource = fs.readFileSync(path.join(__dirname, '../apps/web/app/page.tsx'), 'utf8');
  check('G1. No notification permission prompt on page load (app/page.tsx)', !/Notification\.requestPermission\s*\(/.test(pageSource));
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '../apps/web/vercel.json'), 'utf8'));
  check('G2. The reminder cron still targets the dispatch route', Array.isArray(vercel.crons) && vercel.crons.some((c: { path: string }) => c.path === '/api/internal/reminders/dispatch'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
