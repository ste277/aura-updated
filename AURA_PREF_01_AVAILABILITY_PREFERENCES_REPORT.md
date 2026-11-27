# AURA-PREF-01 — Availability Preferences and Planning Consistency

**Date:** 2026-11-24 · **Baseline:** `main` at `ad49e6a` · **Production:** REL-04, unchanged · **Finding:** PV-F01

**Status: PV-F01 RESOLVED in code; verified locally (tests and browser); PR open, not merged; ready for REL-05 once merged.**

## 1. What was there (assessment)

Aura has two optional settings, both on the You tab. Both start **unset** for new users, and onboarding mentions neither.

| Setting | What it does | Where it's applied |
|---|---|---|
| **Availability** (when Aura may plan) | **Hard limit** on suggestions | Find a Time keeps suggestions inside it. Plan My Day **needs it to plan tomorrow** (a deliberate rule: Aura never invents a default day for a future date). Weekly rhythm proposals respect it. |
| **Work hours** (was "Daily Rhythm": start, end, work days) | **Soft preference** | Find a Time, Plan My Day (today and tomorrow), Home guidance, weekly rhythm and goal planning |

**New users:**
- Registration sets nothing, and no Monday–Friday or 9–5 default is assumed anywhere.
- Suggestions are Panchang-ranked across the whole day.
- That stays unchanged; it is still the right default.

**Inconsistencies found:**

| # | Problem | Effect |
|---|---|---|
| I1 | **In multi-day searches, work hours barely worked.** The engine keeps only each day's single best slot, and the work-hours filter ran *after* that. Weekend slots also didn't count as "preferred". | A personal activity searched across a week (Find a Time "next 7 days", weekly rhythm and goal proposals) still landed at weekday lunchtime inside work hours. Example: Workout on Mon/Thu/Fri at 12:00 with work hours 09:00–18:00. |
| I2 | **Work activities ignored work hours.** Only personal activities were steered. | Deep Work and other work tasks could be suggested at 05:00 or 23:00 on a workday. |
| I3 | **The settings were hard to find and understated their effect.** The copy said work hours apply "when you use Plan My Day". Nothing pointed users to either setting from where they mattered. Plan My Day's "Set availability" button opened the top of the You tab. | Users had little reason to set them, and didn't know what they would change. |
| I4 | **Unsaved availability read "Not available" on every day.** | That looks like "you're never free", although the opposite is true: the whole day is considered. |
| I5 | **Mixed naming.** "Daily Rhythm" (header and clear button) vs "work hours" (fields). "Rhythm" also means goal rhythms (PV-F08). | Confusing terms. |

## 2. What changed

| Area | Before | After |
|---|---|---|
| Multi-day Find a Time, weekly rhythm and goal proposals (I1) | Post-filter on each day's single best slot | The preference is applied **before** each day's best is picked:<br>• one extra engine pass with the steered-away time excluded (the engine's existing `excludedIntervals`);<br>• per day, a day with no slot outside work hours keeps its normal best slot.<br>Panchang still chooses the time; no ranking change. |
| Work activities (I2) | No effect | **Prefer time inside work hours** on work days, the mirror image of the personal rule. Soft, with the same fallback. Applied in Find a Time (note: "Fits your working hours."), Plan My Day, tomorrow and Home. |
| Discovery (I3) | None | **Find a Time:** one short optional line under the results, only when a setting is missing, with a deep link:<br>• neither set: "These times consider your whole day. *Add your usual hours*";<br>• work hours only: "*Set work hours*";<br>• availability only: "These times can be early or late in the day. *Set your available hours*".<br>**Plan My Day "plan tomorrow":** the button opens the Availability card directly and now says "You can still plan today without it." |
| Deep links | — | `/?tab=you&section=availability` and `section=work-hours` open You scrolled to that card. Same tab, no new route or navigation section. |
| Settings copy (I3, I5) | "…when you use Plan My Day" | **Work hours:** "Optional. On your work days, Aura suggests personal activities outside these hours and work activities inside them, in Find a Time, Plan My Day, Home and weekly planning. It's a preference, not a hard limit, and it never moves plans you've already confirmed."<br>**Availability:** "…Optional. Find a Time only suggests times inside these hours, and Plan My Day uses them to plan tomorrow. Without them, Aura considers your whole day. Changing them never moves plans you've already confirmed."<br>The header "Daily Rhythm" becomes **"Work hours"**, and the button reads "Clear work hours". |
| Empty availability (I4) | "Not available" on every day | **"Not set"** until availability is first saved |
| API | — | The signed-in Find a Time response's existing `constraintsApplied` summary gains `workHours: CONFIGURED/UNCONFIGURED`. No new endpoint. |

**Not changed:**
- the ranking engine and Panchang scoring;
- registration and onboarding (no mandatory step);
- the "tomorrow needs availability" rule;
- availability as a hard limit;
- existing plans and goals, My Rhythm and goal-rhythm preferences;
- reminders, MCP and Palmistry;
- the database (no migration).

**Order of authority (unchanged, now actually true in multi-day searches):**
1. Hard constraints: existing plans, availability, Panchang friction windows.
2. Explicit choices: a chosen time of day, chosen weekdays, a specific time checked.
3. Work hours (soft).
4. Panchang ranking picks the time.

Example: an explicit "afternoon" search on workdays still returns weekday afternoons, labelled as inside working hours.

## 3. Before and after (real engine, Chennai, week of 30 Nov 2026, Workout 45 min)

| Setup | Before | After |
|---|---|---|
| New user, nothing set | Panchang best per day (Mon 12:00, Tue 11:45, …) | **Identical** |
| Work hours Mon–Fri 09:00–18:00 | Mon 12:00, Tue 12:15, Thu 12:00, Fri 12:00 (all inside work hours) | Mon 18:00, Tue 04:45, Wed 23:00, Thu 04:45, Fri 18:00 ("Fits your preferred personal time."); weekend unchanged |
| + Availability 06:00–22:00 daily | — | Mon/Tue/Wed/Fri 18:00, Thu 06:00; weekend unchanged |
| Deep Work, work hours set | Workdays at any time | Workdays inside 09:00–18:00 ("Fits your working hours."); weekend unchanged |
| Explicit "afternoon", work hours set | Weekday afternoons | Weekday afternoons kept (explicit choice wins), labelled |

With work hours but no availability, the best time outside work can be very early or late. That's why the Find a Time hint then points to availability. Aura doesn't invent waking hours.

## 4. Tests

| Suite | Result | In CI |
|---|---|---|
| **`availabilityPreferencesPref01`** (new): real engine plus the wrapper used by Find a Time, weekly and goal planning; source guards | **52/52** | Yes |
| **`availabilityPreferencesPref01Db`** (new): a new user starts unset; setting, changing (to a non-Mon–Fri schedule) or clearing work hours or availability never changes confirmed plans | **8/8** | Yes (DB job) |
| `dailyRhythmScheduling`, `timingSearchDailyRhythm`, `dailyRhythmCandidateCoverageIntegration` (existing work-hours suites) | Pass | **Newly** added to CI |
| Negative controls | Restoring the old post-filter fails 2b/2e/3a/5a/5b/10b. Removing the work-activity rule fails 8a/8b. Both restored | — |
| Related regression set (101 suites: Daily Rhythm, Availability, Find a Time, Plan My Day, tomorrow, weekly and goal rhythm, My Rhythm, Home guidance, day constructor, timing search; fresh Postgres 16; each CI step with its own env) | **All 80 CI suites pass.** 8 non-CI suites fail, but identically on unchanged `main` (list below) | — |
| `tsc --noEmit`, Next.js production build | Pass, no warnings | — |

**What the new suite covers:**
- new users unchanged;
- custom hours and days (Tue–Sat 13:00–21:00);
- work, personal and break activities;
- explicit time-of-day and check overrides;
- plans and availability still honoured (and the soft fallback);
- tomorrow and single-day planning;
- the Panchang order preserved (results equal the engine's own best per day within allowed time, best first);
- DST and midnight boundaries;
- weekly rhythm (Mon/Wed/Fri) and preferred time of day;
- the hint and deep-link logic;
- no imposed defaults, no onboarding step, no migration.

**Existing tests updated, intentionally (each check is labelled "re-baselined by AURA-PREF-01"):**
- tests that asserted "work activities are never affected" now assert the new preference (`dailyGuidanceDailyRhythmAlignment` 3, `dailyRhythmScheduling` 8, `dailyRhythmCandidateCoverageIntegration` 8, `timingSearchDailyRhythm` 16d and 17f);
- `findATimeConstraintsDb` T3 and T9 expect the added `workHours` field;
- `dailyRhythmSettingsWiring` 1b expects the "Work hours" header;
- `planDayWiring` 48 and 102 expect the Availability deep link;
- `availabilitySettingsWiring` 76 expects "Not set" before the first save.

**Failures that already exist on unchanged `main`** (none of these suites are in CI; identical before and after):
- `dailyGuidanceBehaviorIntegration`: depends on the time of day; 2 failures in the afternoon, 6 in the evening, the same on unchanged `main` at each time;
- `dailyRhythmDR2/DR3/DR4BWiring` (a stale migration count);
- `dailyRhythmSettingsWiring` 14;
- `planDayWiring` 87c;
- `tomorrowWindowAwareTimingSearch` Q3;
- `goalActivityRhythmSetupUi` (5).

## 5. Browser QA

Local production build, a disposable database and a fresh `@e2e.aura.local` user. Production not touched.

| Check | Result | Evidence |
|---|---|---|
| New user, Find a Time (mobile) | Results, plus "These times consider your whole day. *Add your usual hours*"; no overflow | `01_mobile_find_a_time_new_user_hint.jpg` |
| Hint link | Opens You scrolled to Availability; every day shows "Not set"; new copy | `02_mobile_availability_deep_link.jpg` |
| Set work hours in the form (Mon–Fri 09:00–18:00) | Saved; nothing pre-selected beforehand; "Clear work hours" | `03_mobile_work_hours_saved.jpg` |
| Find a Time after saving | Weekday workouts outside work hours; Deep Work inside; notes shown; hint changes to the availability prompt | API + UI |
| Plan My Day, Tomorrow, no availability | "Set your availability first … You can still plan today without it." The button opens the Availability card | `04_mobile_plan_tomorrow_prerequisite.jpg` |
| Both set (desktop) | No hint; practical times; notes shown; no overflow | `05_desktop_find_a_time_both_set.jpg` |

## 6. Remaining limitations

- **Without availability**, the best time outside work hours can be very early or late (e.g. 04:45). That's by design: Aura doesn't assume sleep hours. The Find a Time hint then suggests setting availability.
- **Plan My Day doesn't explain work placements.** It doesn't say "fits your working hours" for work activities. Adding a new preview warning code would change the signed preview contract, so this was left out. Find a Time does explain them.
- **Cross-midnight work hours** (night shifts) aren't supported. This is an existing V1 limit and is unchanged.
- **Plan tomorrow still needs availability.** This is a deliberate existing rule; the prompt is now direct and explains that today works without it.
- **Activity classification** (work vs personal) uses the existing catalog categories. Free-text activities that don't match a catalog entry aren't steered, which is existing behaviour.
- **Existing engine observation, not changed:** in a multi-day search the engine orders by its internal score, which can place a "Caution" slot above a "Good" one with a higher display score. Out of scope (no ranking changes).
- **Not measured with real users.** Whether people set these settings, and whether relevance improves, is for early user validation (the PV-01 feedback template records whether work hours were set).

## 7. PV-F01 disposition

**PV-F01: RESOLVED in code and VERIFIED locally. PR open, not merged.**

New users still get useful whole-day suggestions with nothing to configure. The two settings are:
- explained accurately;
- one tap away from where they matter;
- applied consistently across Find a Time, Plan My Day (today and tomorrow), Home, and weekly, goal and rhythm planning. That includes multi-day searches, where they previously had little effect.

Work activities now use work hours too. Everything stays soft, and explicit choices win. The change reaches users after merge and REL-05.

## 8. PR and CI

- **PR:** the single PR for branch `feature/aura-pref-01-availability-preferences`. The exact head and CI result are in the PR and the session summary.
- Auto-fix and auto-merge are disabled. Not merged; no deploy; Production stays on REL-04.
