# AURA-MR3 — My Rhythm Preferences UI and Pause/Resume

**Date:** 2026-11-24 · **Baseline:** `main` at `20a076c` (PV-01 merge) · **Production:** REL-04 `ac46fc3`, unchanged · **Finding:** PV-F02

**Status: MR3 IMPLEMENTATION COMPLETE — PV-F02 VERIFIED (locally) — PR READY FOR REVIEW — PRODUCTION UNCHANGED.**
The PR and CI status are in §9.

## 1. Summary

Users can now set and manage every existing My Rhythm setting in the app, with no API calls or database edits. The settings are:
- weekly frequency
- preferred days
- preferred time of day
- session length
- pause and resume

The work is UI only. It reuses MR1/MR2's single endpoint (`PATCH /api/goals/:goalId/activities/:goalActivityId/rhythm`), its validation, and its scheduling engine unchanged. There are **no migrations, no API changes and no ranking changes**.

Where it lives:
- **Goal Detail.** Every weekly activity shows its saved summary (for example "Mon, Wed, Fri · Morning · 45 min") with **Edit rhythm** and **Pause rhythm / Resume rhythm** on one line.
  - Edit opens a compact editor. Frequency is always visible; days, time and length sit behind "Add days, time or length (optional)" until the user opens them or one is already saved.
- **Home "Your rhythm this week".** Each card gets an **Edit rhythm** link, and paused rhythms get a **Resume or edit** link. Both deep-link to the activity on Goal Detail.
  - There's no new navigation section.

## 2. Existing backend capabilities reused (not rebuilt)

| Capability | MR1/MR2 source | How MR3 uses it |
|---|---|---|
| Validation of weekdays, time of day and duration (15–360 min) | `goalActivityRhythmPreferences.ts` | Re-used client-side for early messages; the server still re-validates every save |
| Frequency-vs-days rule (N sessions need at least N days under once-per-day) | `validateRhythmPreferencesAgainstRhythm` | Mirrored in the editor, so the explanation shows before saving, and Save is disabled |
| Partial update semantics (an absent key means unchanged) | `parseGoalActivityRhythmPreferencesPatch` | The editor sends **only changed fields**, so an untouched preference can never be reset |
| Pause and resume preserving preferences and plans | `resolveGoalActivityRhythmSettingsUpdate`, `rhythmPausedAt` | Pause/Resume send only `{ paused }` |
| Preference-aware weekly proposal, Home and Plan My Day | MR2 (`goalRhythmWeeklyProposal`, `homeGoalRhythmSuggestions`, `planDayBootstrap`) | Unchanged; verified end to end (§6, §7) |
| Read model (`rhythmPaused`, `rhythmPreferences`) | `GET /api/goals/:goalId` (MR1) | Already returned; now typed and consumed |

## 3. Behaviour details

- **Weekdays** are a single Mon–Sun row: seven equal columns, each 44 px high.
  - "Any day" clears the selection, and no days means flexible.
  - Picking fewer days than the weekly frequency shows "3 times a week needs at least 3 preferred days. You've chosen 1. Pick more days or lower the frequency." Save is disabled until it's fixed, so Aura never quietly schedules on days the user didn't choose.
- **Time of day:** Any time, Morning, Afternoon, Evening or Night.
  - A hint shows the hours (for example "5 AM – 12 PM") and MR2's fallback ("If no good time fits, Aura offers the best time that day and says so").
  - Work hours, availability and existing plans still apply (MR2 hard and soft constraints, unchanged).
- **Session length:** Default (the activity's own duration), 15, 30, 45, 60 or 90 min, or Other (15–360).
- **Pause** asks first, explains the effect in one line, and offers "Keep active".
  - Paused rows show a **Paused** badge, keep their summary, offer **Resume rhythm**, and lose their "Plan with Aura" checkbox. The server already refused that handoff; the checkbox was a dead end.
- **Editing:**
  - Cancel restores the saved values.
  - Save is disabled when nothing changed or the input is invalid.
  - A synchronous in-flight guard prevents duplicate submissions.
  - Failed saves keep the draft and show the server's reason, or "Could not reach Aura…" for network failures. Retry works.
  - Switching to "Once" warns that preferences will be cleared, and sends `{ rhythm: NONE }` only; the server clears them, as designed.
- **Plan My Day ("Just today").** The task row now shows the carried-forward preference ("Flexible · Morning · 45 min") instead of "Automatic", using MR2's existing row defaults.
  - When a rhythm's preferred time has passed for the day, the "couldn't fit" result now adds a specific reason and next step.
  - This is presentation only; Plan My Day scheduling is unchanged.
- **Mobile fit.** The shared frequency picker (`RhythmPicker`, also used by Create Goal and onboarding) previously overflowed its card on phones: 355 px of content in a 291 px card at 375 px, with "Custom" cut off.
  - It now uses the same wrapping chip row as session length. Labels and behaviour are unchanged.
  - Verified with no horizontal scroll at 320, 375 and 1280 px.

## 4. Files changed

| File | Change |
|---|---|
| `apps/web/components/RhythmSettingsEditor.tsx` | **New.** The editor plus Pause/Resume (one PATCH call site) |
| `apps/web/lib/rhythmPreferencesDraft.ts` | **New.** Pure draft, validation and minimal-PATCH logic, the summary, the deep link and the read-model adapter |
| `apps/web/app/goals/[goalId]/GoalDetailClient.tsx` | `RhythmEditor` now wraps the new editor; Paused badge; paused rows are not selectable; deep-link anchor and scroll |
| `apps/web/components/GoalRhythmSuggestionsCard.tsx` | "Edit rhythm" link on Home cards (same single `.map`) |
| `apps/web/components/PausedRhythmsNote.tsx` | "Resume or edit" link |
| `apps/web/components/RhythmPicker.tsx` | Wrapping chips instead of a nowrap segmented control (mobile overflow fix) |
| `apps/web/lib/goalsPresentation.ts` | Types the existing MR1 fields on `GoalActivityView` |
| `apps/web/lib/planDayEntry.ts`, `apps/web/app/plan-day/PlanDayClient.tsx` | Row summary shows the rhythm time and length; explanation for deferrals caused by the time of day |
| `test/myRhythmPreferencesUi.test.ts` | **New.** 51 pure and structural checks |
| `test/myRhythmPreferencesEditorJsdom.test.ts` | **New.** 32 mounted-component checks |
| `test/myRhythmPreferencesUiDb.test.ts` | **New.** 33 real-Postgres checks |
| 5 existing guard tests | Deliberate MR3 re-baselines, explained in comments (§5) |
| `.github/workflows/ci.yml` | Wires the 3 new suites next to their MR1/MR2 siblings |
| `AURA_MR3_SCREENSHOTS/` | QA screenshots (§7) |

There are no migrations, no API route changes, and no changes to ranking or `dailyRhythmScheduling`.

## 5. Guard re-baselines (deliberate)

| Guard | Old assertion | Why it changed | Invariant kept |
|---|---|---|---|
| `goalActivityRhythmSetupStructuralGuards` 59 | No weekday picker in setup UI | The MR1 report requires MR3 to re-baseline it deliberately | Setup surfaces (RhythmPicker, Create Goal, Goal Detail) **still** have none; the weekday selector exists only in the post-setup editor (new check G2) |
| `goalActivityRhythmGoalDetailStructuralGuards` (write sites) | The PATCH lives in GoalDetailClient | The PATCH moved into `RhythmSettingsEditor` | Exactly one rhythm-edit write site plus the Add-activity POST |
| `goalDetailCompletionStructuralGuards` | 6 fetches in GoalDetailClient | 5 + 1 in the editor | No progress or completion write endpoint was added |
| `goalPlanningHandoffUi` A/4 | Exact `isSelectable` expression | Adds `a.rhythmPaused !== true &&` | The same eligibility gate, closed for paused rhythms |
| `goalActivityRhythmSetupUi` 20 (not in CI) | PATCH in GoalDetailClient | Same move | Unchanged; its 5 documented pre-existing failures (CI comment) remain |

## 6. Automated test results

Run locally against a disposable Postgres 16 with all 53 migrations (TCP-only, throwaway credentials).

| Suite | Result |
|---|---|
| `myRhythmPreferencesUi` (new) | **51/51** |
| `myRhythmPreferencesEditorJsdom` (new) | **32/32** |
| `myRhythmPreferencesUiDb` (new) | **33/33** |
| Negative control: in-flight guard removed | J21 "two rapid clicks send ONE request" **fails**, as expected; restored afterwards |
| MR1/MR2 DB baseline before changes | myRhythmFoundationDb 81, myRhythmSchedulingDb 41, goalActivityRhythmGoalDetailDb 30, goalActivityRhythmSetupDb 51, weeklyPlanReviewClientDb 25, goalRhythmWeeklyAcceptanceDb 57 — **all pass** |
| Related CI regression set (155 suites: rhythm, goals, Home, plan, scheduling, Day Constructor, Panchang, muhurta, timing, availability, find-a-time, DB) | **155/155 pass under CI conditions.** 144 passed in a plain sequential run. 10 needed their CI step env (`TS_NODE_COMPILER_OPTIONS={"jsx":"react"}`) and passed with it. `dayConstructorAcceptancePersistenceDb` passes on a fresh database, which is how CI runs it; it fails only when re-run on an already-used database (fixed-date rows; pre-existing, not MR3) |
| `tsc --noEmit` (apps/web) | Pass |
| Next.js production build (`npm run build` with CI placeholder env) | **Pass** (exit 0) |

**The new tests cover:**
- creating a rhythm with preferences;
- editing each preference on its own;
- save and reload;
- clearing preferences;
- invalid frequency/day combinations;
- invalid durations;
- pause/resume, including preservation of preferences and confirmed plans (byte-identical `PlannedActivity` rows);
- failed and duplicate saves;
- rhythms with no preferences;
- frequency-only edits leaving preferences untouched;
- MR1/MR2 backward compatibility.

## 7. Browser QA

Local `next dev` on the worktree, a disposable QA database (`aura_qa`), and a disposable account `mr3-qa@e2e.aura.local` signed in with the dev-mode code. Nothing touched Production.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Create a 3×/week rhythm on Mon/Wed/Fri, Morning, 45 min | **PASS.** Created via Create Goal; preferences set via the editor; one `PATCH …/rhythm` → 200 | `01_mobile_editor_mon_wed_fri_morning_45.jpg` |
| 2 | Reload and check persistence | **PASS.** "Mon, Wed, Fri · Morning · 45 min" after reload | — |
| 3 | Next-week suggestions respect preferences | **PASS.** Mon Nov 30 9:45 AM, Wed Dec 2 10:45 AM, Fri Dec 4 10:30 AM; 45 min each; `matchedPreferences: true`; Panchang reasons shown | `03_mobile_next_week_suggestions_mwf_morning.jpg` |
| 4 | Cancel creates no plans | **PASS.** 0 `PlannedActivity` and 0 occurrences in the database afterwards | DB query |
| 5 | "Just today" carries activity and duration | **PASS.** Tuesday was added so today qualifies. Plan My Day row: "Strength training session · Flexible · Morning · 45 min"; preview intent `estimatedDurationMinutes: 45`. At 4:45 PM no morning time was left: the preview says so, with a next step | `04_…just_today…45min.jpg`, `05_…morning_passed_explained.jpg` |
| 6 | Pause suppresses planning | **PASS.** Confirm step; Paused badge; no Plan checkbox; Home lists it as "Paused · Resume or edit"; weekly proposal `NOT_ELIGIBLE` for both weeks | `06_mobile_pause_confirmation.jpg`, `07_mobile_home_paused_resume_link.jpg` |
| 7 | Resume restores preferences and eligibility | **PASS.** Preferences intact; next-week proposal OK (Tue/Wed/Fri mornings, 45 min); no plans created | — |
| 8 | Edits change later suggestions | **PASS.** Changed to Tue/Thu/Sat, Evening, 30 min: next week Dec 1, 3 and 5 at 5:00 PM, 30 min; Plan My Day today proposes 5:14 PM, 30 min. The live validation for "1 day for 3×/week" appeared on the way | `08_mobile_validation_too_few_days.jpg` |
| 9 | A rhythm with no preferences keeps working | **PASS.** Go for a run and Stretch propose 3 and 2 sessions with catalog defaults (30 and 10 min) | — |
| 10 | Mobile and desktop | **PASS.** No horizontal overflow at 320, 375 and 1280 px (was 397/375 before the fix); Create Goal re-checked at 375 | `02_…home…`, `09_desktop_…`, `10_mobile_320px_…` |

Console: no errors on fresh loads. A transient Fast Refresh `ReferenceError` was seen once while editing, before an import was added; fresh loads afterwards had no errors.

## 8. Remaining limitations

1. **Plan My Day has no time-of-day fallback** (MR2 design; the weekly proposal does have one). If the preferred window has passed today, nothing is proposed. MR3 now explains why, but doesn't change scheduling.
2. **Weekday chips are 44 px high but about 31–39 px wide** at 320–375 px, so all seven fit on one row. The full 44×44 would need two rows.
3. **Preferences are edited after setup, not during Create Goal.** This is intentional (guard 59 keeps setup "how often" only), but a new user sets frequency first and refines on Goal Detail.
4. **Home card density (PV-F05) is unchanged.** It gains one small "Edit rhythm" link; Home clarity is deferred to pilot evidence, as decided.
5. **Pre-existing, outside MR3:** the Home "Plan remaining N" button can touch the card edge at 375 px.

## 9. PV-F02 disposition, PR and CI

- **PV-F02: RESOLVED in code, VERIFIED locally** (automated tests, plus browser QA scenarios 1–10). It reaches users only after a separately authorized release; Production is unchanged.
- **PR:** https://github.com/ste277/aura-updated/pull/384. CI was started on the final commit; see the PR checks (the 5 required checks gate merge). Not merged; no automatic merge.
- **Restrictions honoured:**
  - No Production deploy, promotion, database write or env change.
  - The deployment guard is untouched.
  - No migrations.
  - No reminder, insight, work-hour onboarding, Home redesign, analytics, MCP, Palmistry or Android changes.
