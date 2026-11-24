# AURA-PV-01 — Product Validation and Early User Pilot

**Date:** 2026-11-24 (revision R1) · **Baseline:** REL-04 Production `dpl_3SstUr7PBWFJHG6zM2oKjPxVBUhE` = commit `ac46fc3` (verified, §2.1) · **Type:** product validation, no implementation

**Status: PRODUCT EXPERIENCE REVIEW COMPLETE — USER PILOT READY.** Final product validation stays **PENDING** until real participant feedback has been collected.

Companion files:
- [AURA_PV_01_PARTICIPANT_TESTING_GUIDE.md](AURA_PV_01_PARTICIPANT_TESTING_GUIDE.md)
- [AURA_PV_01_PILOT_FEEDBACK_TEMPLATE.md](AURA_PV_01_PILOT_FEEDBACK_TEMPLATE.md)

### R1 changes (focused re-verification)

| Item | Earlier claim | R1 result |
|---|---|---|
| Source ↔ Production | Assumed `ac46fc3` | **Verified:** alias → `dpl_3Sst` with commit metadata `ac46fc3`, and 438/438 listed source files are byte-identical (§2.1) |
| My Rhythm (PV-F02) | "No UI for preferences or pause" | **Confirmed. Classification: a deliberately deferred scope gap, not a defect and not a discoverability problem.** MR1/MR2 shipped the storage, API and scheduling logic. The UI was explicitly deferred to MR3, which hasn't shipped (§5.2) |
| Reminders (PV-F03) | "Daily cron, so reminders are late" | **Worse than stated: background reminders can't be delivered on Production web at all.** Web Push isn't configured (live 503), and the dispatch secret is absent. Only in-app reminders work, and only while Aura is open (§5.3) |
| Availability / work hours (PV-F01) | "Availability defaults to 5 AM–10 PM" | **Corrected:** 5 AM–10 PM was the owner's own saved setting. A new user has **no** availability and **no** work hours, so recommendations are unconstrained Panchang-ranked times for the whole day (§5.4) |
| Insights correlation (PV-F04) | "Needs only 3 reflections" | **Confirmed and specified:** at least 3 reflections in total, with at least 1 on each side; no per-group minimum and no significance check (§5.5) |

---

## 1. Summary

The core loop works: discover as a guest → result in about 0.3 s → code sign-in → Home → plan → save → return. Four of the earlier first-user problems (READY-02 F1–F4) are fixed in Production. **No P0 was found.**

The risk to the pilot is whether Aura is worth the effort for a busy professional:
- Background reminders don't exist on Production web.
- Out of the box, recommendations aren't constrained by work hours.
- Routines can't be shaped by day or time.
- An insight shown on Home can tell users that following Aura made their days worse, based on very little data.

The corrected P1 list and the pre-pilot recommendation are in §6.

---

## 2. Method and evidence classes

| Class | Meaning | What it covered |
|---|---|---|
| **[obs]** | Observed in the Production browser (mobile 375×812) | The owner's existing signed-in session: Home, Plan, Explore → Panchang Calendar, Insights, You, and guest `/find`. **View-only:** nothing was tapped that saves data. Opening tabs records the app's normal view events (for example `AURA_HOME_VIEWED`) on the owner's account. |
| **[live-API]** | Read-only Production HTTP call, cookies omitted | `POST /api/guest/timing-search` (Workout, today, Chennai, 60 min): 200, 3 candidates, 344 ms. It stores nothing. `GET /api/push/public-key`: **503 "Web Push is not configured on this deployment."** |
| **[config]** | Read-only Vercel metadata | The production alias and deployment, the deployment source-file hashes, and Production env var **names**. No values were decrypted, and nothing was changed. |
| **[code]** | Source at `ac46fc3`, verified identical to the deployed source (§2.1) | The signed-in journeys a new user would see: landing, sign-in, onboarding, Goals, rhythm, weekly planning, `/plan-day`, reminders and the Insights calculation. **Behaviour inferred from code wasn't exercised in the browser** unless it's also marked [obs]. |
| **[doc]** | Repo documentation and prior reports | `DEPLOY.md`, MR1/MR2 reports, the GOV-02 I0-B report, READY-02. |
| **[validate]** | A hypothesis about user perception | Needs pilot evidence. |

**Not done:**
- No Production account was registered, and no emails were sent.
- There was no native or Android testing.
- New-user screens (landing signed-out, onboarding, Goals) were assessed from **code**, not seen in the browser.
- The owner's account is a heavily used test account, so its numbers aren't representative.

### 2.1 Source ↔ Production verification

| Check | Result |
|---|---|
| `aura-updated.vercel.app` alias | → `dpl_3SstUr7PBWFJHG6zM2oKjPxVBUhE` [config] |
| Deployment | READY, target production, source `cli`, meta `githubCommitSha = ac46fc315771685abefc38783be311745b007f2c` [config] |
| Source files | **438/438** files in the deployment's source listing have a SHA-1 identical to the `ac46fc3` checkout, with **0 mismatches**. The listing was partial (Vercel omitted 1,165 files), so those weren't compared individually. [config] |
| Conclusion | The reviewed source is the deployed Production version. CLI-deploy metadata is self-reported, but the file-hash match corroborates it independently. |

---

## 3. Core journey assessment

| Journey | Objective | Assessment | Evidence |
|---|---|---|---|
| Landing page | Do users understand what Aura offers? | **Mostly.** There's a value line plus "Try it without an account" → `/find`. The brand varies: AuraSchedule, Aura, myAuraMoment. | [code] LoginScreen.tsx:125-181 |
| Guest discovery | Can users experience value without registering? | **Yes.** About 0.3 s to a ranked result. `/find` has no brand or "why timing" line and no sign-in link; Back exits the flow (READY-02 F7 is still open). | [obs] `/find`; [live-API]; [code] |
| Registration | Is there a compelling reason to sign up? | **Weak.** The only stated reason is "Sign in only when you want to save it." | [code]; [validate] |
| Home | Is it clear what to do next? | **No single next step.** The astrology briefing sits above Right Now, and there are five or more planning entry points. The page is about 2,380 px on mobile. | [obs] |
| Goals | Can users turn intentions into activities? | **Capable but hidden:** You → Goals only, outside onboarding. | [code] YouView.tsx:153 |
| My Rhythm | Can users set up practical routines? | **Partly.** "N per week" works and is scheduled. Preferred days, time of day, duration and pause **aren't settable in Production** (MR3 deferred, §5.2). | [obs] Home; [code]; [doc] |
| Weekly scheduling | Are recommendations relevant? | **The mechanics are sound** ("Suggested — not booked yet", accept-all, distinct errors). Relevance depends on work hours, which new users don't have (§5.4). | [code]; [validate] |
| Home → Plan | Can users turn suggestions into plans? | **Yes**, via "Plan this →". The separate `/plan-day` page overlaps with it, and its "Set your availability first" step dead-ends on You. | [code] |
| Find a Time | Do recommendations help users decide? | **Yes**: typed errors with Retry. "Why this works" can list negative reasons (READY-02 F9 open). The Plan tab's Popular chips skew social (Date Night, Dinner, Movie). | [obs]; [code] |
| Panchangam | Is the guidance meaningful and understandable? | **Accurate, but unexplained.** Terms have no meanings; Insights shows raw enums (`RAHU_KALAM`, `YAMA`). | [obs] |
| Returning experience | Is there a reason to come back tomorrow? | **Weak.** There are no background reminders on web (§5.3). The pull-backs are the evening reflection, a night-only tomorrow preview and the briefing. | [obs]; [live-API]; [code]; [config] |

---

## 4. Owner experience review — three perspectives

**A new visitor.**
- Understands the offer from one line.
- Gets a timed result as a guest quickly; this is the strongest curiosity moment.
- Isn't told why an account helps.
- During onboarding, a non-Indian user is offered "Confirm Chennai" as the primary action. [code; validate]

**A busy professional setting up routines.**
- Has to find Goals under You, create a goal, and set "N per week".
- Then plans each rhythm from Home.
- Can't say "weekday mornings" or pause a routine (MR3 not shipped).
- Work hours live in a separate "Daily Rhythm" setting that onboarding never mentions, and whose copy says it affects only Plan My Day (it also affects Find a Time and weekly planning, §5.4).
- "Rhythm" means three different things in the UI.

**A returning user.**
- Home leads with the briefing and the Right Now card, followed by rhythm cards with four buttons each.
- Insights is dense, with duplicate suggestions, a goal row with no title and raw enums.
- Nothing reaches the user outside the app. [obs]

---

## 5. Focused re-verification (R1)

### 5.1 Scope

This section covers the five items the owner asked to re-verify. It isn't a new comprehensive audit.

### 5.2 My Rhythm: deferred scope gap, not a defect or a discoverability problem

| Layer | State at `ac46fc3` / Production | Evidence |
|---|---|---|
| Schema | `GoalActivity.rhythmPreferredWeekdays` etc. exist. The Production DB has migrations 0052 and 0053 (REL-04 record). | [code] schema.prisma:896-903; [doc] |
| API | `PATCH /api/goals/:goalId/activities/:goalActivityId/rhythm` accepts `rhythm`, `preferences` and `paused`. | [code] rhythm/route.ts:44-61 |
| Scheduling logic (MR2) | Weekly proposal, Plan My Day and Home all honour preferences and pause **when they are set**. | [code] lib/goalActivityRhythmPreferences.ts; [doc] MR2 §3 |
| Home display | "Your rhythm this week", plus a paused-rhythm note (`PausedRhythmsNote`) that appears only when data says paused. | [obs]; [code] |
| **UI writer** | **The only client caller of that route is Goal Detail, and it sends `{ rhythm }` only.** No component sends `preferences` or `paused`. | [code] GoalDetailClient.tsx:434-437 |
| Planned | MR1 report: "no user can have them until **MR3** ships a UI"; MR3 = "Pause/Resume and a preferences panel on the existing `RhythmPicker` and Goal Detail". MR3 isn't on `main`. | [doc] AURA_MR1 report lines 132, 144-148 |

**Verdict:**
- Not outdated: the gap is present in Production.
- Not a discoverability problem: there's nothing to discover.
- Not a defect: it's the documented, intentional MR1/MR2 → MR3 split.

For users it is a **capability gap**: MR2's preference-aware scheduling is unreachable in Production, so routines are "N per week" on engine-chosen days and times. **Severity for the pilot: P1** (practical routines are a core journey). No roadmap change is proposed.

### 5.3 Reminder delivery architecture

| Component | Design | Production state | Evidence |
|---|---|---|---|
| Reminder model | A plan's reminder is due from `start − 15 min` until `start + 30 min` (fixed 15-minute lead in the UI; the domain supports 10/15/30/60). | Active | [code] auraReminders.ts:74-89, ReminderSettings.tsx:46 |
| **In-app reminders** | Computed on each `GET /api/aura-updates`. This is fetched on load and on app focus/visibility; **there is no timer**. Shown on Home ("starting soon") and the Updates badge. | **Works, but only when the user opens or returns to Aura inside the due window** | [code] page.tsx:818-890 |
| **Web Push (background)** | The service worker `sw.js` handles `push` and `notificationclick`. A device subscribes via You → Device Notifications, which needs the VAPID public key from `/api/push/public-key`. | **Not configured.** The live endpoint returns **503**. The `WEB_PUSH_VAPID_*` env names are absent from Production. A user who taps Enable is asked for browser permission, then the subscription fails as `not_configured`. | [live-API]; [config]; [code] webPushClient.ts:78-84 |
| **Dispatch job** | Vercel Cron `0 13 * * *` (13:00 UTC = 18:30 IST) → `/api/internal/reminders/dispatch`. The route requires `Authorization: Bearer $INTERNAL_REMINDER_DISPATCH_SECRET`; Vercel sends `$CRON_SECRET`, so both must be set to the same value. | **The route's secret and `CRON_SECRET` are absent from the Production env names**, so the route fails closed (404) and sends nothing. Even if it were configured, one daily run reaches only plans starting about 18:00–18:45 IST. | [code] dispatch/route.ts:27-31; vercel.json; [config]; [doc] GOV-02 I0-B §"side observation" |
| Plan-tier limit | DEPLOY.md: Hobby rejects sub-daily crons ("Hobby accounts are limited to daily cron jobs"). It says the daily schedule "does NOT give you real 15-minutes-before reminders". | Documented | [doc] DEPLOY.md:244-273 |
| External scheduler | DEPLOY.md *suggests* cron-job.org or a GitHub Actions schedule as an alternative. | **No evidence of one.** There are no scheduled workflows in `.github/workflows`, and no record of a configured external scheduler. | [code]; [doc] |
| Email | Resend is used **only** for sign-in codes. | No email reminders | [code] lib/email.ts |
| Window alerts (Abhijit/Rahu) | Web: `Notification` API toasts while the page is open. Native: Capacitor `LocalNotifications`. | Web needs permission, which is requested on first load without context. Native wasn't assessed. | [code] page.tsx:333-339, windowNotifications.ts |

**Is the promised "reminder 15 minutes before" supported on Production web? No, except in-app, while the app is open.** The You screen copy ("Get a reminder 15 minutes before…") and "Get reminders when Aura isn't open" overstate what Production can do.

**These can't be verified from the available evidence:**
- **Cron outcomes.** Runtime-log retention on this plan is 1 hour, and the 13:00 UTC run is outside the window, so no 404/200 log was observed. The fail-closed outcome is **inferred** from the code plus the env-name absence.
- **External schedulers.** Whether any scheduler outside the repo or Vercel (cron-job.org or similar) calls the endpoint. It would still get 404 without the secret.
- **Env scope.** Whether a secret exists under a different name or scope not returned by the API. The listing reported `hiddenProductionEnvCount: 0`.
- **REL-05 confirmation.** What the owner's REL-05 "reminders dispatch" confirmation actually covered.
- **Android.** Native Android local-notification behaviour.

### 5.4 Daily Rhythm (work hours) and Availability for new users

| Setting | New-user default | Where it's applied when set | Evidence |
|---|---|---|---|
| **Availability** (You → Availability, `UserAvailabilityPeriod`) | **Unconfigured, so no restriction.** The code deliberately never infers 9–5 or weekends. | Find a Time (FIND mode) restricts candidates to saved windows. Plan My Day: **"Plan tomorrow" requires it** ("Set your availability first"). | [code] availabilitySettings.ts:56-62, findATimeConstraints.ts:63-64, PlanDayClient.tsx:591 |
| **Daily Rhythm** (You → Daily Rhythm: work start, end and days) | **Empty, so no effect.** | A **soft** preference for PERSONAL activities on configured workdays, in Find a Time (signed-in), Plan My Day, the weekly rhythm proposal and Home guidance. Candidates overlapping work hours are dropped **unless that would leave none**, in which case work-hour times are still returned. | [code] dailyRhythmScheduling.ts:149-151, 250-258; timing-search/route.ts:88-115 |
| Guest `/find` | Neither applies | — | [code] |
| Onboarding | Neither is asked | — | [code] OnboardingJourney.tsx |
| Settings copy | "Your working hours help Aura suggest better times… **when you use Plan My Day**" | This understates it: work hours also affect Find a Time, weekly planning and Home | [code] DailyRhythmSettings.tsx:150 |

**Effect:** a new user, guest or registered, gets Panchang-ranked times across the whole day, existing plans aside. The observed guest result for a 60-minute Workout on a Tuesday was **4:28–5:28 PM IST**, which falls in typical office hours [live-API]. A registered new user gets the same unconstrained behaviour [code; not exercised in browser]. Once work hours are set, recommendations should move outside them where possible. That's [code]; this review didn't observe it in Production.

### 5.5 Insights alignment correlation: exact logic

Source: `app/api/daily-assistant/insights/route.ts:40-157`, `lib/insightsEvidence.ts:32-36`. Shown on **Home** (Daily Reflection) and **Insights → Your Alignment**.

1. **Data:** the user's evening check-ins (`DailyReflection`) and activity logs (`HabitLog`) from the last **400 days**.
2. **"Followed" day:** the reflection's own `followedGuidance` flag is true, **or** that day's logs include more SUPPORTIVE windows (Abhijit, Brahma) than FRICTION windows (Rahu, Yama). Gulika and Neutral count for neither.
3. **Score per check-in:** Strong (`PEAK_FLOW`) = 1, Balanced (`MODERATE`) = 0.5, Low = 0.
4. **Result:** `round((mean score on followed days − mean score on other days) × 100)`, shown as "± N pts".
5. **Evidence gate:** at least **3 reflections in total** and **at least 1 in each group**. There's **no per-group minimum, no confidence interval or significance test, and no recency weighting.** The smallest sample that displays a figure is 2 vs 1: one check-in can swing it by up to ±100 points.
6. **Copy:** "Your check-ins score N points **lower/higher** on days when you followed favorable windows". This is causal-sounding phrasing for an observational difference.

The owner's −15 pts rests on 31 check-ins (17 followed, 14 not) [obs]. That's a real, honestly computed figure, not a bug. **The issue is the low gate, the causal wording and the placement on Home**, where a pilot participant could see a strong negative claim after three evenings.

---

## 6. Corrected findings

Severity follows the brief: P0 prevents core value; P1 is a significant usability or adoption barrier; P2 is a meaningful improvement; P3 is a minor refinement.

### 6.1 Corrected P1 list

| ID | Finding (corrected) | Evidence | Nature |
|---|---|---|---|
| **PV-F03** | **Background reminders can't be delivered on Production web,** although the UI promises "15 minutes before" and "reminders when Aura isn't open". Web Push isn't configured (503), the dispatch secret and `CRON_SECRET` are absent, and the cron runs once a day anyway. Only in-app reminders work, while Aura is open. | [live-API], [config], [code], [doc] | Production configuration gap plus a plan-tier limit. Cron outcomes aren't directly observed (§5.3). |
| **PV-F04** | **The alignment insight can tell users that following Aura made their days worse,** shown on Home, from as few as 3 check-ins (2 vs 1), with causal wording. | [obs], [code] | Product framing and evidence-threshold decision |
| **PV-F01** | **New users' recommendations ignore the working day.** Availability and work hours both start unset, onboarding doesn't ask, and the settings copy understates their effect. When set, work hours are only a soft preference. | [live-API] (4:28 PM Tuesday result), [code] | Onboarding and default gap; impact [validate] |
| **PV-F02** | **Routines can't be shaped (days, time of day, duration, pause) in Production.** MR2's logic exists, but the MR3 UI isn't shipped. | [code], [doc] | Deferred scope (MR3); not a defect |
| **PV-F05** | **No clear next action on Home:** the briefing sits above Right Now, there are five or more planning CTAs and multiple four-button rhythm cards. | [obs] | Impact [validate] |

### 6.2 P2 and P3 (unchanged except where noted)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| PV-F06 | P2 | Goals is reachable only via You → Goals (outside onboarding) | [code] |
| PV-F07 | P2 | Panchang terms aren't explained; Insights shows raw enums (`RAHU_KALAM`, `YAMA`); briefing jargon | [obs] |
| PV-F08 | P2 | Terminology: "rhythm" has three meanings; brand naming varies; onboarding says "Settings" for You → Location & Time. **R1:** the Daily Rhythm copy understates its scope (§5.4). | [obs], [code] |
| PV-F09 | P2 | Browser notification permission is requested on first load without context. **R1:** Device Notifications can then fail as `not_configured` after the user grants permission. | [code], [live-API] |
| PV-F10 | P2 | The reason to register is thin | [code], [validate] |
| PV-F11 | P2 | "Why this works" can show negative reasons (READY-02 F9) | [code] |
| PV-F12 | P2 | Plan tab and `/plan-day` overlap; "Plan tomorrow" requires availability, which new users don't have, and dead-ends on You | [code] |
| PV-F13 | P2 | The Plan tab's Popular chips skew social and differ from `/find` | [obs] |
| PV-F14 | P2 | `/find` has no browser history (READY-02 F7) | [code] |
| PV-F15 | P2 | Location defaults to Chennai; onboarding's primary button is "Confirm Chennai" | [code] |
| PV-F16 | P3 | Insights polish: duplicate suggestions, an untitled goal row | [obs] |
| PV-F17 | P3 | Literal "--" in user-facing copy | [obs], [code] |
| PV-F18 | P3 | Touch targets of 32–38 px; nav labels at 10 px | [code] |
| PV-F19 | P3 | Muhurtham Finder shows raw error messages | [code] |
| PV-F20 | P3 | Tab scroll position carries over between tabs; the "Loading..." screen uses a serif font | [obs] |

**Working well, keep:**
- Sub-second guest results.
- A favourable-only onboarding window.
- Resend and change-email on the code screen.
- Typed Find a Time errors.
- "Suggested — not booked" honesty.
- An accurate Panchang calendar with overlap warnings.
- Caution windows avoided in ranking.

### 6.3 Recommendation: what to address before the pilot

None of these is implemented by this ticket. Each needs the owner's separate authorization.

| Priority | Issue | Recommended pre-pilot action | Why before the pilot |
|---|---|---|---|
| **Before the pilot** | **PV-F03 Reminders** | Choose one of two options. **(a)** Authorize the Production configuration (VAPID keys, dispatch secret = `CRON_SECRET`, and a sub-daily scheduler, either an external one or a Pro-plan cron) as a separate release ticket. **(b) Zero-change minimum:** tell participants plainly that Aura won't notify them when it's closed (the guide now says this). | Day 1/3/7 return is a headline metric. Without disclosure, participants who expect reminders will read their absence as a failure, and results will be confounded. |
| **Before the pilot** | **PV-F04 Alignment insight** | A small product change: raise the evidence gate (for example, at least 5 check-ins per group), use non-causal wording, and keep it off Home until the gate is met. Or explicitly accept the risk and capture reactions with Template D9. | A participant could see "following Aura made your days worse" by day 4, which directly contaminates the question "did the timings influence you?". |
| **Before the pilot (zero-code)** | **PV-F01 Work hours** | Include the optional one-line tip in the participant guide ("set your usual work hours under You → Daily Rhythm"), and record per participant whether it was set (Template E). | Otherwise feedback on "relevance" mostly measures the missing default, not the recommendations. |
| During the pilot | PV-F02 My Rhythm | No change; MR3 is already planned. Use Template D to probe whether day and time preferences are wanted. | It's a known, planned gap, and the pilot shows its priority. |
| During the pilot | PV-F05 Home clarity | No change; observe first use (Template A). | It needs evidence before redesigning. |

---

## 7. Analytics coverage and measurement gaps

Production has:
- `ProductEvent`: a closed list of 54 event names with validated metadata.
- `VisitLog`: one row per user per database `CURRENT_DATE`.
- `User.createdAt` and `PlannedActivity.status`.
- `Goal`, `GoalActivity` and `GoalActivityOccurrence`.
- `DailyReflection`.

**R1 additions:**
- The internal metrics endpoint `/api/internal/product-metrics` is **unusable in Production**: `INTERNAL_METRICS_SECRET` is absent [config].
- An existing operator script, `apps/web/scripts/retention-report.js`, computes day-2 return. It needs `DATABASE_URL`, and wasn't run.

There's no third-party analytics. **Nothing new is proposed for the pilot.**

| PV-01 metric | Coverage | How to measure | Gap |
|---|---|---|---|
| Time to first useful recommendation | Partial | Guest `GUEST_TIMING_SEARCH_STARTED` → `GUEST_TIMING_RESULT_VIEWED` (aggregate); registered: `User.createdAt` → first `PLAN_SEARCH_COMPLETED` | Guest events have no visitor id. Use Template A. |
| Guest-to-registration | Aggregate only | `GUEST_TIMING_RESULT_VIEWED` → `GUEST_SIGNUP_STARTED` → `GUEST_SIGNUP_COMPLETED` | Not joinable per visitor |
| First meaningful action | Yes | First non-view `ProductEvent` or row after `createdAt` | — |
| Activity and rhythm creation | Yes (rows) | `Goal`, `GoalActivity`, `PlannedActivity` | No rhythm-set event |
| Suggested → confirmed | Partial | Day Builder and goal-decomposition events; accepted weekly sessions via `GoalActivityOccurrence` | The weekly-plan modal emits no events, and `PlannedActivity` has no origin field |
| Day 1/3/7 return | Yes, with a caveat | `VisitLog` vs `createdAt`; `retention-report.js` (day 2) | The day boundary is the DB date, probably UTC (05:30 IST) |
| Usefulness, abandonment, effort | No | Template B/C/D | Qualitative only |

**Data rule:** use counts and timestamps for consenting participants only; never read titles or notes. Any per-participant query needs the owner's prior approval. Candidate instrumentation for later (each needs separate approval): an anonymous guest session id, weekly-plan events, a rhythm-set event, and a `PlannedActivity` origin field.

---

## 8. Recommendations for the next iteration (unchanged in substance)

1. Ask for work hours during onboarding, and fix the Daily Rhythm copy (PV-F01).
2. Ship MR3's preferences and pause UI as already planned (PV-F02).
3. Make background reminders real, or stop promising them; ask for notification permission at the first saved plan (PV-F03, PV-F09).
4. Give Home one obvious next action, and add a Goals entry point (PV-F05, PV-F06).
5. Gate and reword the alignment insight (PV-F04).
6. Explain Panchang in plain language; show only supportive reasons (PV-F07, PV-F11).
7. Consolidate terminology (PV-F08).

---

## 9. Pilot readiness

**Ready on the current Production build**, provided the owner makes the §6.3 decisions on PV-F03 and PV-F04 first. Registration stays open, with no invitation gate.

| What the pilot must answer | Proposed success signal (the owner can adjust it) |
|---|---|
| Do people understand the offer within 1 minute? | At least 6 of 8 explain it in their own words (Part A) |
| Do recommended times influence behaviour? | Yes/Partly on at least half of active days (Part B), and a C5 median of 4 or more |
| Do people return without prompting? | Active on day 3 and day 7 for at least half of participants. Note: there are no push reminders, so all returns are self-initiated. |
| Does Aura reduce planning effort? | A C3 median of 4 or more, and "Less" in C13 |

**No results have been collected and none are implied.**

---

## 10. Restrictions honoured

- No Production configuration, data or settings changes.
- R1 Vercel access was read-only: the alias, the deployment, source-file hashes, and env **names** with `decrypt=false`.
- No features or fixes.
- No new analytics.
- MCP and Palmistry were not activated.
- The roadmap is unchanged.
- No participants were contacted.
- No feedback or retention data was fabricated.
- No Production account was created.
- Production writes were limited to the app's own view events on the owner's existing session.
