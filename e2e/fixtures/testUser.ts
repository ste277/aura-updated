import { test as base, Page, BrowserContext } from '@playwright/test';
import { randomUUID } from 'crypto';

/**
 * Product Journey / E2E Hardening V1 (brief section 2/29/30) -- deterministic
 * test user setup + controlled-time helper shared by every journey test.
 *
 * Test-data isolation: every user is created with a unique, clearly-tagged
 * email (e2e-<label>-<uuid8>@e2e.aura.local). Nothing here depends on or
 * mutates a developer's own pre-existing rows. e2e/fixtures/cleanup.ts
 * (globalTeardown) deletes every row scoped to this exact email pattern
 * after the run -- never a broader wipe.
 */

export const E2E_EMAIL_DOMAIN = 'e2e.aura.local';

export function uniqueEmail(label: string): string {
  const safe = label.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 28);
  return `e2e-${safe}-${randomUUID().slice(0, 8)}@${E2E_EMAIL_DOMAIN}`;
}

export interface TestUser {
  email: string;
  timezone: string;
  cityName: string;
  latitude: number;
  longitude: number;
}

/**
 * Signs a fresh test user in via the dev-only magic-link shortcut
 * (POST /api/auth/request-link returns `devLoginUrl` when no email
 * provider is configured and NODE_ENV !== 'production' -- see
 * apps/web/app/api/auth/request-link/route.ts). Navigating the page to
 * that URL sets the real session cookie via the real /api/auth/verify
 * route, exactly like a genuine magic-link click -- no session is forged.
 */
export async function signInNewUser(
  page: Page,
  opts?: { emailLabel?: string; timezone?: string; cityName?: string; latitude?: number; longitude?: number }
): Promise<TestUser> {
  const email = uniqueEmail(opts?.emailLabel ?? 'user');
  const res = await page.request.post('/api/auth/request-link', { data: { email } });
  if (!res.ok()) throw new Error(`request-link failed: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  if (!body.devLoginUrl) {
    throw new Error('devLoginUrl missing from /api/auth/request-link -- E2E must run against a dev server (NODE_ENV !== production, no email provider configured).');
  }
  await page.goto(body.devLoginUrl);

  const timezone = opts?.timezone ?? 'Asia/Kolkata';
  const cityName = opts?.cityName ?? 'Chennai';
  const latitude = opts?.latitude ?? 13.0827;
  const longitude = opts?.longitude ?? 80.2707;
  const locRes = await page.request.patch('/api/users/location', { data: { cityName, latitude, longitude, timezone } });
  if (!locRes.ok()) throw new Error(`location setup failed: ${locRes.status()} ${await locRes.text()}`);

  return { email, timezone, cityName, latitude, longitude };
}

/**
 * Product Journey / E2E Hardening V1 (brief section 30) -- the controlled-
 * time boundary. Sets the `x-e2e-now` header on every request from this
 * browsing context (navigation AND the app's own client-side fetch/XHR
 * calls), which apps/web/lib/testTimeOverride.ts honors ONLY because the
 * webServer sets E2E_TIME_OVERRIDE_ENABLED=true (playwright.config.ts).
 * Does not touch the real system clock -- Date.now()/new Date() inside the
 * browser are untouched, only the couple of server routes that read this
 * header change what they consider "now".
 */
export async function setControlledTime(context: BrowserContext, iso: string): Promise<void> {
  await context.setExtraHTTPHeaders({ 'x-e2e-now': iso });
}

export const test = base.extend<{ testUser: TestUser }>({
  // `auto: true` means every test using this `test` gets a freshly signed-in
  // user WITHOUT needing to destructure `testUser` -- a test that forgets to
  // list it in its params (an easy mistake) would otherwise silently run
  // unauthenticated instead of failing loudly or being skipped.
  // eslint-disable-next-line no-empty-pattern
  testUser: [
    async ({ page }, use, testInfo) => {
      const user = await signInNewUser(page, { emailLabel: testInfo.title });
      await use(user);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
