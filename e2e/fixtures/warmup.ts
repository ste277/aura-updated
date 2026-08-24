import { request, FullConfig } from '@playwright/test';

/**
 * Playwright globalSetup -- eliminates a cold-server timing leak that made
 * reminderJourney.spec.ts and sharedMomentJourney.spec.ts intermittently
 * fail ONLY in a full single-worker suite run, never in isolation.
 *
 * Root cause (confirmed empirically): Next.js dev mode compiles each route
 * on-demand on its FIRST request. `POST /api/reminders/seen` and
 * `POST /api/aura-moments/[token]/seen` are the mark-seen endpoints these
 * two tests exercise -- and they are the ONLY tests in the whole suite that
 * ever call them. Measured cold-vs-warm latency on a freshly started dev
 * server: ~2.5-2.9s first request vs ~0.4-0.6s once compiled. Both tests
 * assert the mark-seen effect via a bounded `toPass({ timeout: 10000 })`
 * poll of a fire-and-forget client fetch (see apps/web/app/page.tsx's
 * handleOpenReminder/handleViewMomentUpdate) -- on a genuinely cold server
 * that one-time compile cost can eat enough of the 10s budget to flake.
 *
 * The fix is to pay that one-time compile cost HERE, before any timed
 * assertion runs, not to retry the assertion or the fetch. This runs once
 * per `npx playwright test` invocation (webServer is already up by the
 * time globalSetup runs); on an already-warm, reused local server
 * (reuseExistingServer) it's a harmless ~1s no-op.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3100';
  const context = await request.newContext({ baseURL });

  try {
    const email = `e2e-warmup-${Date.now()}@e2e.aura.local`;
    const linkRes = await context.post('/api/auth/request-link', { data: { email } });
    const { devLoginUrl } = await linkRes.json();
    await context.get(devLoginUrl); // sets the session cookie in this context, like a real magic-link click

    // Fire these once each -- the RESPONSE is irrelevant (a garbage id/token
    // 404s), only the compile-on-first-request cost matters.
    await context.post('/api/reminders/seen', {
      data: {
        scheduledItemType: 'PLANNED_ACTIVITY',
        scheduledItemId: '00000000-0000-0000-0000-000000000000',
        reminderAt: new Date().toISOString(),
      },
    }).catch(() => {});
    await context.post('/api/aura-moments/warmup-nonexistent-token/seen').catch(() => {});

    console.log('[e2e warmup] Pre-compiled mark-seen routes.');
  } finally {
    await context.dispose();
  }
}
