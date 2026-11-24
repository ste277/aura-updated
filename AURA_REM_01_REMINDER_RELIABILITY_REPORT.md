# AURA-REM-01 — Reliable Reminders and Notifications

**Date:** 2026-11-24 · **Baseline:** `main` at `a724997` · **Production:** REL-04 `ac46fc3`, unchanged · **Finding:** PV-F03

**Status: REMINDER IMPLEMENTATION READY. Background delivery is NOT operational in Production and has not been demonstrated on a real device. It needs three owner decisions (§6): a scheduler, Web Push keys and a release.**

## 1. Root causes of PV-F03

Aura already had a complete Web Push design: a service worker, subscriptions, a dispatcher and idempotent delivery rows. Background reminders still never reach anyone, for these reasons:

| # | Cause | Kind | Status |
|---|---|---|---|
| R1 | **No Web Push keys in Production.** `WEB_PUSH_VAPID_*` are absent (confirmed from the project's env list, names only), so `/api/push/public-key` returns 503 and nothing can be sent. | Configuration | **Owner action** (§6) |
| R2 | **The scheduler can't run often enough.** `vercel.json` has one cron, `0 13 * * *`. On the Hobby plan, cron jobs run at most once a day, with ±59 min precision ([Vercel docs](https://vercel.com/docs/cron-jobs/usage-and-pricing)). A reminder is due 15 minutes before an activity, so a daily run almost never catches one. | Infrastructure / plan | **Owner action** (§6) |
| R3 | **The dispatch secret is absent, and two secrets were needed.** The route only accepted `INTERNAL_REMINDER_DISPATCH_SECRET`, while Vercel Cron sends `CRON_SECRET`. Both are absent, so every run returns 404. | Configuration + code | Code fixed: either secret works now. Setting the secret is an **owner action** |
| R4 | **Settings could claim success that wasn't real.** "Enabled — Reminders will reach this device" appeared as soon as a subscription existed, even with no scheduler running. | Code | **Fixed** |
| R5 | **No retry, and claims could get stuck.** A temporary provider error marked the reminder FAILED permanently. A worker that died mid-send left the row PROCESSING forever, so it was never sent. | Code | **Fixed** |
| R6 | **Late and misleading pushes.** A late run could still push after the activity started, and the title always said "starts in 15 min". | Code | **Fixed** |
| R7 | **Permission prompt on every page load.** `app/page.tsx` called `Notification.requestPermission()` on mount. Browsers quiet or auto-block unprompted requests, and a denial there also blocks reminders. | Code | **Fixed** |
| R8 | **Late subscribers missed reminders.** Users without a subscription got a SKIPPED row, so turning notifications on a few minutes before a reminder lost it. | Code | **Fixed** |
| R9 | **The reminder tests weren't in CI.** None of the 9 existing reminder suites (155 checks) ran in CI. | Process | **Fixed**: all wired in |

## 2. What was implemented

All changes reuse the existing architecture: `deriveAuraReminders()` eligibility, `ReminderDelivery` claims, the existing service worker and the existing settings card.

**Scheduler (`lib/reminderDelivery.ts`, `lib/db.ts`, dispatch route)**
- **Retries:** a temporary failure (network error, 5xx, 429) puts the reminder back to PENDING for the next run, up to **3 attempts**. Gone endpoints (404/410) are disabled and never retried. Missing keys aren't retried.
- **Stuck claims:** a row left PROCESSING for more than **5 minutes** is reclaimed by a later run. This uses the same atomic conditional UPDATE, so two workers still can't both win. The service worker's per-item notification tag also collapses any duplicate on the device.
- **Too late:** no push is sent once the activity has started. The in-app reminder keeps its existing 30-minute grace period.
- **Honest title:** "starts in N min" uses the time actually left at send time, or "is starting now".
- **Missing keys:** with no Web Push keys, the run attempts nothing, consumes no delivery rows and returns **503** with `configured: false`, so the scheduler's history shows the problem.
- **Subscribers only:** only users with an active subscription get delivery rows, which fixes R8.
- **Secrets:** the route accepts `CRON_SECRET` or `INTERNAL_REMINDER_DISPATCH_SECRET`, compared in constant time and at least 16 characters. It is still fail-closed: with no secret set, it returns 404.
- **Heartbeat:** every authorized run records a heartbeat (migration below).
- **Unchanged:** eligibility and lead time (the user's `reminderLeadMinutes`, default 15), and how rescheduled, cancelled, completed, revoked and superseded items are excluded.

**Notification settings (`components/DeviceNotificationSettings.tsx`, `lib/webPushClient.ts`, `GET /api/push-subscriptions`)**

The server now reports `backgroundDelivery`, which is one of three values:
- `AVAILABLE`: keys are present **and** the scheduler ran in the last 15 minutes;
- `NOT_CONFIGURED`;
- `SCHEDULER_INACTIVE`.

"On" requires `AVAILABLE`. Every state that isn't working says what to do and that in-app reminders continue.

| State | What the user sees |
|---|---|
| Not requested | "Get reminders on this device, even when Aura is closed." + **Enable notifications** (the only place a prompt can happen) |
| Granted, working | **On** — "Aura will send reminders to this device, even when it's closed" + Turn off. Worded as what Aura sends: "On" means keys, a recent scheduler run and an active subscription, not verified device delivery (§4.3) |
| Granted, scheduler not running | **Not working yet** — "This device is set up, but Aura can't send notifications while it's closed yet. Reminders still appear in Aura while it's open." |
| Denied | How to allow notifications in the browser's site settings. No button that re-prompts. The state is re-read when the user returns to the tab, so recovery needs no reload |
| Unsupported browser / native app shell | Says so, plus the in-app fallback |
| iPhone/iPad Safari tab | "Add to Home Screen" instructions (Web Push needs the installed app on iOS) |
| Service not configured | "Notifications when Aura is closed aren't available yet." No button |
| Subscription expired or invalid | "Notifications stopped working on this device…" + **Turn on again**, which drops the dead browser subscription and registers a fresh one |
| Setup error | "Aura couldn't turn on notifications. Check your connection and try again." |

`navigator.serviceWorker.ready` is now bounded at 5 seconds. Before, the section stayed blank forever if the service worker never registered.

**Page load:** removed the unprompted permission request (R7). Window-alert toasts still show in the app. Their optional system notification still appears when permission was already granted.

**Migration `0054_reminder_dispatch_heartbeat`:** one new table, `ReminderDispatchHeartbeat` (channel, `lastRunAt`, `lastRunConfigured`).
- Additive only; no user data; no existing table changed.
- **Why it is needed:** this is the only reliable way to know the scheduler is actually running. Configuration alone can't tell a daily cron from a 5-minute one. Without it, the settings screen would again claim "On" on Production's daily cron, which is PV-F03 itself.

**Not changed:**
- Panchangam ranking and scheduling; plans, goals and My Rhythm.
- In-app reminders: Bell, Home "Starting soon" and Updates.
- The lead-time setting UI (still fixed at 15 minutes).
- No new analytics or tracking events.
- `vercel.json`: the daily schedule stays, because a more frequent expression **fails deployment on Hobby**.

## 3. Supported notification channels

| Channel | Background delivery (Aura closed) | Notes |
|---|---|---|
| In-app (Bell, Home "Starting soon", Updates) | No: only while Aura is open | Unchanged; works today |
| Web Push, Chrome / Edge / Firefox, desktop | **Yes, once §6 is done**, while the browser is running (tab can be closed) | Not demonstrated on a real device in this ticket |
| Web Push, Chrome on Android | **Yes, once §6 is done**; Android delivers via the push service even when Chrome is closed, subject to battery optimisation | Not demonstrated |
| Web Push, Safari on macOS | Expected to work (Safari 16+) | Not demonstrated |
| Web Push, iPhone/iPad | Only for Aura **added to the Home Screen** and opened from there (iOS/iPadOS 16.4+). The manifest already has `display: standalone` | Safari tabs show the Add to Home Screen guidance. Not demonstrated |
| Native Android/iOS shells (Capacitor) | **No.** The WebView has no Push API, so the UI shows "unsupported". Native reminders would need FCM/APNs or scheduled local notifications | Native apps aren't released (Block 0 NO-GO). Out of scope; noted for later |

## 4. Verification

### 4.1 Automated

| Suite | Result | In CI |
|---|---|---|
| **`reminderReliabilityDb`** (new): real tables and claims, injected sender | **39/39** | Yes (DB job) |
| **`reminderNotificationSettingsJsdom`** (new): mounted settings in every state, plus pure safeguards | **27/27** | Yes |
| Existing reminder suites: `auraReminders` 36, `pushPayload` 11, `reminderAttention` 11, `reminderConsistency` 31, `webPushClientCapability` 13, `reminderDeliveryDb` 12, `reminderDeliveryClaimDb` 18, `pushSubscriptionsDb` 14, `reminderAttentionDb` 9 | **155/155** | Yes, **newly** wired |
| Negative controls | Breaking retries made 9a–9d fail. Treating "scheduler never ran" as available made P2 fail. Both restored | — |
| Related CI regression set (each step with its own CI env, fresh Postgres 16) | **88/88**. The first pass was 86/88: MR3 G12 and INS-01 S9 ("no new migration") failed as expected on `0054` and pass after re-baselining | — |
| Architecture and guard suites that read migrations | **55/55** | — |
| `tsc --noEmit` | Pass | — |
| Next.js production build | Pass (CI placeholder env, no warnings) | — |

**What the new DB suite covers:**
- on-time delivery (nothing early, exactly once);
- a late run says the real minutes left;
- no push after the start time;
- 6 concurrent runs send exactly 1;
- a moved plan (via the real `movePlannedActivity`) and an edited time get reminders only at the new time;
- cancelled and completed plans get none, and neither do users with reminders off;
- a temporary failure is retried and then sent;
- a persistent failure stops at exactly 3 attempts;
- a 410 disables the endpoint;
- a late subscriber still gets the reminder;
- a stuck claim is reclaimed after 5 minutes, but a fresh one is left alone;
- a 00:05 IST activity is reminded at 23:52 IST the previous evening;
- missing keys consume nothing, and the heartbeat only turns AVAILABLE after a configured run.

**Changed existing tests (intended):**
- `webPushClientCapability`: "browser subscription the server rejects" is now `SUBSCRIPTION_EXPIRED` instead of `GRANTED`. It is still never `SUBSCRIBED`.
- `reminderDeliveryClaimDb` is unchanged and passes. Missing keys are now FAILED, never retried.
- MR3 G12 and INS-01 S9 ("no new migration") allow only this ticket's `0054`.

### 4.2 Local browser QA

Local production build (`next build` + `next start`, so the service worker registers as it does in Production). It used a disposable Postgres, throwaway locally generated VAPID keys and `CRON_SECRET`, and one `@e2e.aura.local` user. Production was not touched.

| Check | Result | Evidence |
|---|---|---|
| Real browser, notifications blocked (the in-app browser blocks them by default) | **Denied** guidance with site-settings instructions and the in-app fallback; no re-prompt button; no overflow at 375 px or 1024 px | `01_mobile_denied_real_browser.jpg`, `04_desktop_denied_real_browser.jpg` |
| Permission simulated as not requested, then the page refocused | State re-read without reload: **Enable notifications** offered | `02_mobile_not_requested_permission_simulated.jpg` |
| Click **Enable notifications** | Real `Notification.requestPermission()` call. The browser refused, and the card switched to the Denied guidance (no false success) | DOM state |
| Server without VAPID keys | `/api/push/public-key` 503. Dispatch 503 with `configured:false`. Settings: "aren't available yet", no button | `03_mobile_service_not_configured.jpg` |
| Dispatch with no or wrong bearer | 404 | curl |
| Dispatch as Vercel Cron does (`Authorization: Bearer <CRON_SECRET>`, GET) | 200. Found the due user, skipped them (no subscription, no row written), recorded the heartbeat | curl, DB |
| Background status before and after a scheduler run | `SCHEDULER_INACTIVE` with no heartbeat, then `AVAILABLE` after the run | API |
| In-app reminder preserved | Bell badge and the "QA Walk" reminder in `/api/aura-updates` while due | Screenshot, API |

**Not possible in this environment:**
- The in-app browser denies notification permission, so a real subscription couldn't be created.
- The "On", "Not working yet" and "expired subscription" states were therefore verified in the mounted-component tests (§4.1), not in a real browser.
- No push was delivered to a real device.

### 4.3 Verified locally vs still needing real devices or a deployment

| Verified locally | Needs real-device or deployed validation |
|---|---|
| Scheduler logic on a real database: timing, de-duplication, concurrency, retry, expiry, reschedule/cancel/complete, timezone/midnight | A push actually arriving from a real push service (FCM, Mozilla, Apple) on a real device |
| Every settings state and its copy, permission denial and recovery, the expired-subscription replacement flow | Behaviour with Aura fully closed, the phone locked and battery optimisation on (Android), and the installed iOS Home Screen app |
| Dispatch auth, the 503 on missing config, and the heartbeat | Vercel Cron actually invoking the route at the chosen interval, and its real timing in Production |
| — | Notification click opening Aura and marking the reminder seen (existing service worker code, unchanged) |

**Background delivery has not been demonstrated end to end, and this report does not claim it is operational.**

## 5. Scheduling infrastructure

| Option | Interval and precision | Cost | Verdict |
|---|---|---|---|
| Current: Vercel Cron on Hobby | Once a day, ±59 min | $0 | **Can't support reminders** |
| Vercel Schedules (beta) on Hobby | Every 15 min, always with a 15-min jitter | $0 | Too late for a 15-minute reminder (often after the start) |
| **A. Vercel Pro + Vercel Cron (recommended)** | Down to every minute, per-minute precision | Pro **$20/month** for one developer seat (Vercel pricing page; confirm at upgrade). About 8,600 invocations/month at a 5-minute interval, expected to be well within Pro's included usage | Uses existing infrastructure; `CRON_SECRET` is sent automatically |
| B. External scheduler (e.g. cron-job.org, or a GitHub Actions schedule) calling the route with the secret | cron-job.org: every minute. GitHub Actions: at least 5 minutes, and runs are often delayed or skipped under load | $0 | Works with this code unchanged. It adds a third party that holds the secret, and timing isn't guaranteed. Acceptable as a short pilot stop-gap |

**Database note:** a scheduler every 1–5 minutes queries Production's Neon database around the clock. That can keep Neon compute from scaling to zero and raise compute usage. The owner should check the Neon plan before choosing the interval. A 5-minute interval is the suggested balance: reminders arrive 10–15 minutes before start, and the title states the real time.

## 6. Owner decisions needed before REL-05

1. **Scheduler: choose A or B** (§5). For A: upgrade the team to Pro, then in a follow-up release change `apps/web/vercel.json` to `"schedule": "*/5 * * * *"`. That change must not ship while the team is on Hobby, because the deployment would fail.
2. **Production environment variables** (owner sets them; never committed):
   - `WEB_PUSH_VAPID_PUBLIC_KEY` and `WEB_PUSH_VAPID_PRIVATE_KEY`: generate once with `npx web-push generate-vapid-keys`. Keep them stable: changing them invalidates every subscription.
   - `WEB_PUSH_VAPID_SUBJECT`: a `mailto:` contact address.
   - `CRON_SECRET`: a random value of at least 16 characters. For option B, give the same value to the external scheduler as `Authorization: Bearer …`.
3. **Release REL-05** with this PR. It includes migration `0054` (additive), which must be applied to the Production database as part of the release.
4. **After release, validate on real devices** before telling participants reminders work:
   - desktop Chrome, Android Chrome and an installed iPhone app;
   - Aura closed, then a plan due in about 20 minutes;
   - confirm the settings screen shows **On**;
   - confirm the notification arrives 10–15 minutes before, and tapping it opens Aura.
5. Until steps 1–4 are done, **keep the participant guide's disclosure** ("Aura won't notify you when it's closed"). With this PR, the app itself now shows "aren't available yet" or "Not working yet" instead of a false "Enabled".

## 7. Roadmap

- **REM-02 — Native Android and iOS notifications** (future; not started). The Capacitor shells have no Web Push, so native background reminders would need FCM/APNs push or scheduled local notifications. Until REM-02, native apps show "unsupported" and **no native background notification support is claimed**.

## 8. PR and CI

- **PR:** the single PR for branch `feature/aura-rem-01-reminder-reliability`. This report can't contain its own commit hash; the exact head and CI result are in the PR and the session summary.
- **CI:** see the PR checks. The new steps are "Run REM-01 notification settings (jsdom) test" and "Run REM-01 reminder reliability DB test"; the 9 existing reminder suites are newly added too.
- Auto-fix and auto-merge are disabled. Not merged; no deploy; no Production settings changed; Production stays on REL-04.
