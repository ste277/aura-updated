import { NextRequest } from 'next/server';

/**
 * Product Journey / E2E Hardening V1 (brief section 30) -- the smallest
 * safe test-time boundary needed for deterministic E2E coverage of
 * date/time-dependent journeys (NIGHT-phase Reflection/Tomorrow Preview,
 * day rollover, reminder eligibility). Structurally inert in production:
 * the `x-e2e-now` header is only ever honored when
 * E2E_TIME_OVERRIDE_ENABLED=true, a flag the Playwright webServer sets on
 * its own spawned dev process (see e2e/playwright.config.ts) and that is
 * never set for a real deployment or a developer's own `next dev`. One
 * shared helper at the couple of routes whose eligibility genuinely
 * depends on "now" (GET /api/my-day, GET /api/aura-updates) -- not
 * scattered `new Date()` mocks throughout production code, and
 * production behavior (the env var unset) is byte-for-byte unchanged:
 * `resolveRequestNow` degrades to `new Date()`.
 */
export function resolveRequestNow(req: NextRequest): Date {
  if (process.env.E2E_TIME_OVERRIDE_ENABLED === 'true') {
    const override = req.headers.get('x-e2e-now');
    if (override) {
      const parsed = new Date(override);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return new Date();
}
