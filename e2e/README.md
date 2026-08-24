# E2E tests

Permanent browser-level product-journey coverage (Product Journey / E2E Hardening V1), replacing the ad hoc manual-browser verification this project had relied on. Runs Playwright against the real Next.js app — never a harness page.

## Running locally

```bash
npx playwright test                       # headless, all journeys
npx playwright test e2e/tests/smoke.spec.ts   # a single file
npx playwright show-report                 # open the last HTML report
```

The config (`playwright.config.ts`, repo root) spawns `apps/web`'s own dev server on a dedicated port (`E2E_PORT`, default 3100 — separate from a developer's own `next dev`, usually 3000) and reuses it across runs (`reuseExistingServer`) unless `CI` is set.

Requires the same `DATABASE_URL` your normal local dev already uses (`apps/web/.env.local`) — no second database. See "Test data isolation" below for why this is safe against a developer's own rows.

## Test data isolation

Every test gets a freshly signed-in user via `e2e/fixtures/testUser.ts`'s `testUser` auto-fixture, using the app's own dev-only magic-link shortcut (`POST /api/auth/request-link` returns `devLoginUrl` when no email provider is configured and `NODE_ENV !== 'production'`) — no forged sessions. Every email is tagged `e2e-<test-name>-<uuid8>@e2e.aura.local`.

`e2e/fixtures/cleanup.ts` runs as Playwright's `globalTeardown` after every run: deletes every row for users matching `email LIKE '%@e2e.aura.local'` (HabitLog/VisitLog/Habit first — they reference `User` with `ON DELETE RESTRICT`, then `User`, which cascades everything else). Never touches any other row. Set `E2E_SKIP_CLEANUP=true` to leave fixture data in place for manual inspection after a run.

## Clock / timezone strategy

Two independent time concerns, two independent mechanisms — see `apps/web/lib/testTimeOverride.ts`'s own doc comment for why they can't share one:

1. **Server-side "now"** (My Day's day-phase/MISSED status, reminder eligibility) — `GET /api/my-day` and `GET /api/aura-updates` read an `x-e2e-now` request header instead of `new Date()`, but *only* when `E2E_TIME_OVERRIDE_ENABLED=true` (set exclusively on the Playwright `webServer`'s own process — never in a developer's `next dev`, never in production). Use `setControlledTime(page.context(), isoString)` from `e2e/fixtures/testUser.ts`.
2. **Client-side "now"** (Good Right Now's active Panchang window — computed browser-side from `astronomy-engine`, unaffected by the header above) — Playwright's own `page.clock.install({ time })`. `e2e/fixtures/panchangWindows.ts` computes today's *real* neutral/Rahu-Kalam windows (reusing the app's own `computeSolarEphemeris`/`computePanchangWindows` — never a second astronomy implementation) so a test never hardcodes a date/time that would land in the wrong window on a different real-world day.

Production `new Date()` behavior is unchanged in both cases.

## Fixtures

- `fixtures/testUser.ts` — the `test`/`expect` re-export every spec imports from; `testUser` auto-fixture; `signInNewUser`; `setControlledTime`.
- `fixtures/testData.ts` — thin wrappers over the app's real APIs (`createPlan`, `logPlan`, `createSavedPerson`, `createSharedMoment`, `logHabitInstant`, `fetchMyDay`, `fetchAuraUpdates`, `listPlans`, `listHabitLogs`) for fast prerequisite setup; the journey itself still click-drives the UI under test.
- `fixtures/panchangWindows.ts` / `fixtures/time.ts` — the clock helpers above.
- `fixtures/cleanup.ts` — globalTeardown.

## What's covered vs. deferred

Covered: My Day → Add Plan (A), shared Moment + recipient accept + Bell (B), reminder → Bell → seen (C), Good Right Now INSTANT/FIXED/USER_SELECTED + double-click regression (D), MISSED-vs-COMPLETED regression (E), Night Reflection + Tomorrow Preview (F), Tomorrow Preview → Plan tomorrow → day rollover (G), Recipient Conversion (H) — full guest→signup→restore→Plan loop, idempotency, true concurrent redemption, stale-candidate recovery, expired/tampered guest state, existing-user `/find`, magic-link-click restore, analytics + privacy boundaries — Ask Aura cross-feature handoffs (I) — CHECK/FIND/SHARED/Panchang/Muhurtham intents, casual-vs-Muhurtham routing regression, follow-up context, Why, Unknown/clarification — Good Right Now/Aura Suggests dedup (J), caution-never-"Best" presentation (K).

Both H and I also carry responsive (375px) and accessibility smoke coverage (`recipientConversionAskAuraSmoke.spec.ts`).

Not covered by this pass: deeper Ask Aura conversational breadth beyond the intents above (only a few representative intents were protected, per the brief's own scope — this suite is a regression net for existing behavior, not exhaustive intent coverage), and acquisition channels other than the Recipient Conversion (shared-Moment) path. Good candidates for a future E2E addition.
