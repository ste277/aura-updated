import { defineConfig, devices } from '@playwright/test';

/**
 * Product Journey / E2E Hardening V1 (brief section 2) -- permanent
 * browser-level E2E infrastructure, replacing the ad hoc manual-browser
 * verification this session had relied on. Runs against the REAL Next.js
 * app (webServer below), not a harness page.
 *
 * - Deterministic port (E2E_PORT, default 3100) -- separate from a
 *   developer's own `next dev` (usually 3000), so E2E can run alongside
 *   normal local development.
 * - E2E_TIME_OVERRIDE_ENABLED=true is set ONLY on this spawned server
 *   process -- see apps/web/lib/testTimeOverride.ts. A developer's own
 *   `next dev` never sets this, so production/dev behavior is unchanged.
 * - Uses the SAME dev database (DATABASE_URL from apps/web/.env.local) as
 *   normal local development -- brief section 2 asks for isolated
 *   fixtures, not a second database. Every fixture user is created with a
 *   unique e2e-tagged email (see e2e/fixtures/testUser.ts) and cleaned up
 *   in globalTeardown (e2e/fixtures/cleanup.ts), scoped to that email
 *   pattern only -- never a developer's own rows.
 */
const PORT = process.env.E2E_PORT ?? '3100';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e/tests',
  // Real timing-search/Muhurta computation plus multi-step UI flows
  // routinely take 20-30s end to end -- the 30s default is too tight.
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  globalTeardown: require.resolve('./e2e/fixtures/cleanup.ts'),
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    cwd: './apps/web',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      E2E_TIME_OVERRIDE_ENABLED: 'true',
      PORT,
    },
  },
});
