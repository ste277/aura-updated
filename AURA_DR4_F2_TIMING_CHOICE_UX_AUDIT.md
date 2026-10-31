# AURA DR4-F2: Timing Choice UX Audit

**Status: AUDIT ONLY. No production code was changed to produce this document.**
Scope: `origin/main` at `91d61b47d986a827828d44efa01bf89a135a8b6a` (includes merged PR #254 / DR4-F1).

Every claim below is either **Observed** (confirmed by reading code and/or exercising it live against a disposable database) or **Recommendation** (a proposal, clearly labeled, not yet implemented). Code citations are `file:line`.

---

## 1. Current scheduling architecture

Aura has exactly **one** recommendation engine — `runTimingSearch` (`packages/recommendation/src/timingSearch.ts`) — and exactly **one** persistence contract for moving an already-scheduled activity — `POST /api/plans/[planId]/move` → `movePlannedActivity` (`apps/web/lib/planMove.ts`). Everything else is a different *client* of one or both of those two things:

- **New scheduling** (an activity with no existing `PlannedActivity` row) always ends at `POST /api/plans` (create) or, for Plan My Day, `app/api/day-constructor/accept/route.ts` → `persistAcceptedConstructedDay`.
- **Rescheduling** (an activity that already has a `PlannedActivity` row) always ends at `POST /api/plans/[planId]/move`, as of DR4-F1. There is now no code path anywhere in the app that creates-a-new-plan-and-deletes-the-old-one for a reschedule.

The architecture is **not** one scheduling UI with multiple entry points — it is **three structurally different interaction patterns** living side by side, which is the core finding motivating this audit:

| Pattern | Where | Recommendation engine involved? | Manual time entry? |
|---|---|---|---|
| **Recommend N, pick one** | Find a Time (`PlanWithAuraView.tsx`, FIND mode) | Yes, ranked, 3 candidates | No |
| **Type one time, get it evaluated** | Check a Time / Compare (`PlanWithAuraView.tsx`, CHECK/COMPARE modes) | Yes, evaluates exactly what you typed | Yes — this *is* the manual-entry UI |
| **Type one time, no evaluation at all** | Home Move (`HomeDashboard.tsx`'s Move picker) | **No** — zero engine involvement | Yes — raw Day(Today/Tomorrow)+time picker |

Reschedule-from-the-Plan-tab (DR4-F1) reuses pattern 1 and 2 (FIND/CHECK/COMPARE), locking duration. Home Move is pattern 3 and has never offered a recommendation, a score, or Panchang context of any kind.

---

## 2. Entry-point comparison

For each entry point: UI component → search API → engine → candidate selection → manual controls → save API → duration → timezone.

### 2.1 Find a Time (`components/PlanWithAuraView.tsx`, FIND mode)
- UI: `PlanWithAuraView.tsx:1263-1313` (candidate cards), composer `components/PlanWithAuraView.tsx` (`SectionTitle 1-4`: title, date range, duration, time-of-day preference).
- Search API: `POST /api/timing-search` (`app/api/timing-search/route.ts`).
- Engine: `runTimingSearch({mode:'FIND', limit:3, ...})` — `PlanWithAuraView.tsx:858,875`.
- Candidate selection: **engine does it** — top 3 ranked, user picks one. `findResult.candidates[0]` rendered as "Best Match", `candidates.slice(1)` as "Other Good Options" (`PlanWithAuraView.tsx:1269,1288-1309`).
- Manual controls: date **range** only (Today/Tomorrow/Weekend/7 days/custom range) and a time-of-day bucket (Anytime/Morning/Afternoon/Evening/Night) — **no exact date/time entry**.
- Save API: `POST /api/plans` (new) via `handleSavePlan` (`PlanWithAuraView.tsx:650-712`).
- Duration: one of 5 presets, user-selected, sent to save.
- Timezone: `timezone` prop (user's home timezone), passed straight through to `localDateTimeToUTC`/display.

### 2.2 Plan tab Reschedule (DR4-F1, same file, all 3 modes)
- Same UI as 2.1/2.3/2.4, entered via "Reschedule" on an `UpcomingPlan`/`MissedActivityCard` → `handleReschedulePlan` (`PlanWithAuraView.tsx:714-740`).
- Search API/engine: identical to whichever mode (FIND/CHECK/COMPARE) the user is on.
- Candidate selection: same as that mode.
- Manual controls: same as that mode — **CHECK mode's manual date/time entry is already reachable during a reschedule** (see §5, §8 finding).
- Save API: `POST /api/plans/{id}/move` via `handleReschedulePlanViaMove` (`PlanWithAuraView.tsx:625-648`) — **not** a new `/api/plans` POST.
- Duration: locked to the original plan's own `durationMinutes`; selector disabled in all 3 modes (`PlanWithAuraView.tsx:1229,1381,1455`). Server ignores whatever the client sends regardless.
- Timezone: unchanged from 2.1 — the chosen candidate's own UTC instant is sent as `newStartAt`; no explicit DST ambiguity handling (contrast with 2.5).

### 2.3 Check a Time (`PlanWithAuraView.tsx`, CHECK mode)
- UI: `PlanWithAuraView.tsx:1346-1429`. Native `<input type="date">` + `<input type="time">` (`:1364,1368`) plus a free-text activity field (`:1352-1357`).
- Search API/engine: `runTimingSearch({mode:'CHECK', candidateStart, checkNearbyWindowMinutes})`. `handleCheckTime`, `PlanWithAuraView.tsx:968-990`.
- Candidate selection: **none to make** — the engine evaluates exactly the instant the user typed (`requestedCandidate`) and, separately, offers an unforced `betterNearby` alternative only if it actually scores ≥0.5pt higher (packages/recommendation/src/timingSearch.ts:566, confirmed by subagent research).
- Manual controls: **this entire mode is manual date/time entry** — full date, full time, any instant (past/future, not range-limited).
- Save API: `saveOpportunity` → `handleSavePlan` (`:1407,1422`) — `POST /api/plans`, or `POST /api/plans/{id}/move` when a reschedule is in progress.
- Duration: 5 presets (same `DURATIONS` constant as FIND), locked during reschedule.
- Timezone: `localDateTimeToUTC(checkDate, checkStartTime, timezone)` (`:974`) — no DST ambiguity/nonexistence handling (unlike Home Move, §2.5).

### 2.4 Compare (`PlanWithAuraView.tsx`, COMPARE mode)
- Same shape as 2.3 but **two** full date/time pairs (`compareADate/AStartTime`, `compareBDate/BStartTime`), `handleCompareTimes` (`:992-1017`), `mode:'COMPARE'`. Effectively "evaluate two times I picked, tell me which is better" — a second, already-shipped manual-time-evaluation UI.

### 2.5 Home Move (`components/HomeDashboard.tsx` + `apps/web/lib/homeMove.ts`)
- UI: `renderMovePicker` (`HomeDashboard.tsx:797-839`) — a `<select>` of exactly **Today/Tomorrow** (`:818-821`) plus `<input type="time">` (`:825`).
- Search API/engine: **none**. Zero `runTimingSearch` calls anywhere in `homeMove.ts` or the picker.
- Candidate selection: n/a — there is nothing to choose from.
- Manual controls: this IS the only control — pure manual entry, and it is the **only** entry point in the app with real DST-ambiguity handling (`resolveLocalDateTime`, `lib/homeMove.ts:81-92`, rejecting `NONEXISTENT`/`AMBIGUOUS` wall times explicitly).
- Save API: `planExecutor.move(planId, newStartAt)` (`lib/homeCompletion.ts:127-144`) → `POST /api/plans/{id}/move`, with its own **per-plan** `inFlight` guard (not the Plan tab's single global lock).
- Duration: inherited, shown read-only ("Same activity, still 45 min", `HomeDashboard.tsx:813`) — never editable, consistent with DR4-F1's own approach.
- Timezone: `effectiveTimezone`, via the canonical `resolveLocalDateTime`/`getDatePartsInTimezone` utilities (`lib/timezone.ts`).

### 2.6 Missed Activity Reschedule
Not a separate code path — it is 2.2 (Plan tab Reschedule) reached from the Missed Activities section, **or** 2.5 (Home Move) reached from Home's own Missed Recovery row (`HomeDashboard.tsx:841-875`, "the SAME Done/Skip/Move paths as Right Now"). Confirmed live (§8, scenario 6): a persisted-UPCOMING/past-due plan reschedules through the Plan tab exactly like any upcoming one.

### 2.7 Goal-linked activity scheduling
**No separate engine or UI.** `lib/goalActivityProposal.ts` only defines *what* activities compose a goal, never *when*. The actual time-placement handoff is `app/goals/[goalId]/GoalDetailClient.tsx:164-171` (`handlePlanWithAura`), which hands the goal's activities to **Plan My Day** (§2.8) via query params (`lib/planDayEntry.ts:186,199`, `createIntentRowFromGoalActivity`/`createIntentRowFromGoalHandoffItem`). A goal activity is scheduled exactly like any Plan-My-Day row: `FLEXIBLE` (auto-placed, no candidate shown to the user) or `FIXED` (user picks an exact time up front). Worth noting as existing precedent for DR4-F2's product principle: the button is explicitly labeled **"Plan with Aura," not "Schedule automatically"** (`GoalDetailClient.tsx:220-222`, inline comment: *"Aura has committed nothing yet"*). Once scheduled, a goal-linked plan reschedules exactly like any other (§2.2/2.5) — goal continuity is `lib/planMove.ts`'s job, unaffected by how the activity was first placed.

### 2.8 "Plan My Day" (`app/plan-day/PlanDayClient.tsx`, `lib/dayConstructor*.ts`)
- UI: `PlanDayClient.tsx`, results in `components/DayPlanPreview.tsx`.
- Search API/engine: each `FLEXIBLE` row triggers its own `runTimingSearch({mode:'FIND'})` internally (`lib/dayConstructorOrchestrator.ts:1007-1008,1177-1178`), but the **user never sees those candidates** — `lib/dayConstructor.ts`'s `constructDay` performs a single whole-day joint placement across every row and commits to one slot per row before the preview ever renders.
- Candidate selection: none exposed to the user for `FLEXIBLE` rows. `FIXED` rows bypass the engine entirely — the user already typed an exact time before submitting (`lib/planDayEntry.ts:61-63,376-383`, `resolveFixedStart`).
- Manual controls: pre-submission only (`FIXED` mode); no observed post-placement "try a different time" affordance in `DayPlanPreview.tsx` (no matching UI text found by search; absence observed, not exhaustively confirmed by manual walkthrough — see Deferred/Not-independently-verified note).
- Save API: `app/api/day-constructor/preview/route.ts` then `app/api/day-constructor/accept/route.ts` → `persistAcceptedConstructedDay`.
- Duration: `PLAN_DAY_DURATION_OPTIONS_MINUTES = [15,30,60,90,120]` (`lib/planDayEntry.ts:120`) — **the identical preset list** to `PlanWithAuraView.tsx`'s own `DURATIONS`.
- Timezone: explicit `timezone` param threaded through `resolveFixedStart` and the orchestrator request.

### 2.9 "Plan an Activity" / Quick Capture
No such literal UI label exists (`grep -ri "Plan an Activity"` → zero hits). The closest candidate, Home's **"+ Add something"**, opens `components/HomeQuickCapture.tsx` — a **title-only** capture with no time, no duration, no recommendation engine call at all (`HomeQuickCapture.tsx:9-14`, own doc comment: *"no planning, no Day Constructor, no Timing Search"*), persisted via `POST /api/captures`. Its own "See Suggestions" link (`HomeDashboard.tsx:980-983`, `handleSeeSuggestions`) routes into Find a Time (§2.1). **Not a fourth scheduling implementation** — a capture-intent step that hands off into one.

### 2.10 Guest-facing Find a Time (unauthenticated, `app/find/GuestFindClient.tsx`)
Separate component, same engine (`app/api/guest/timing-search/route.ts` → `runTimingSearch`). Notable existing precedent: it already implements a working "pick among several, see more" pattern — a `candidates` array, `selectedIndex` state, and a `showOthers` toggle gated on `candidates.length > 1` revealing "Other good times →" (`GuestFindClient.tsx:107,286,531-534`). Confirms the "best + alternatives, expand for more" interaction this audit is evaluating already has a shipped precedent, just not inside the authenticated Plan tab.

---

## 3. Recommendation engine capabilities (`runTimingSearch`)

All findings below are from direct inspection of `packages/recommendation/src/timingSearch.ts` plus its daily-rhythm wrapper.

1. **Modes & returns.** `TimingSearchRequest.mode: 'FIND'|'CHECK'|'COMPARE'` (`timingSearch.ts:65-187`). FIND → ranked top-`limit` `candidates[]`. CHECK → `candidates:[requestedCandidate]` + `requestedCandidate` + optional `betterNearby`. COMPARE → every supplied instant, evaluated and ranked, no search (`timingSearch.ts:230-241`).
2. **FIND candidate count.** Default `DEFAULT_FIND_LIMIT = 3` (`timingSearch.ts:250`), overridable per-request via `limit`. `PlanWithAuraView.tsx:858,875` both explicitly pass `limit: 3`.
3. **Ranking.** Descending by `rawScore`, in two places: `selectDiversePlanningOptions` (`packages/recommendation/src/dailyAssistant.ts:478`) and `runFind`'s own final sort (`timingSearch.ts:508`).
4. **Suitability labels.** `TimingCandidateLabel = 'EXCELLENT'|'VERY_GOOD'|'GOOD'|'USABLE'|'CAUTION'` (`timingSearch.ts:189`). Exact cutoffs, `labelForRawScore` (`timingSearch.ts:295-302`): `<0→CAUTION`, `≥90→EXCELLENT`, `≥80→VERY_GOOD`, `≥70→GOOD`, `≥55→USABLE`, else `CAUTION`, on the raw ~0-100 score. The UI's `score`/10 field is a pure rescale (`toPresentationScore`, `timingSearch.ts:304-306`), not a second formula.
5. **Overlap/dedup between FIND candidates.** `selectDiversePlanningOptions` (`dailyAssistant.ts:476-497`) drops exact duplicates, then greedily avoids a candidate within 90 minutes of a clock time already chosen, relaxing only if too few survive. **Confirmed live** (§8, scenario 1-3): three real candidates landed on three different dates (Wed/Thu/Fri).
6. **Time-of-day bucketing.** **Does not exist.** No morning/afternoon/evening quota anywhere — only the generic 90-minute/date-spacing rule above. Do not assume bucketed coverage exists.
7. **Daily Rhythm: filters, never scores.** `applyDailyRhythmToFindCandidates` (`lib/timingSearchDailyRhythm.ts:161-166`) only *partitions* an already-ranked FIND result into outside-work-hours-first, falling back to the unfiltered set if none qualify — own comment: *"never re-scores or reorders; it only partitions."* For CHECK/COMPARE it **never filters**, only annotates (`buildDailyRhythmNotes`, `:189-198`) — *"an explicitly user-selected instant is never filtered away, only annotated."* **Confirmed live** (§8, scenario 9): a 10 AM "Workout" check inside configured 9-5 work hours returned a full score (6.5/10, "Usable") plus the visible note **"✦ This time overlaps your usual working hours"** — not a rejection.
8. **Work hours scope.** Only `PERSONAL`-classified activities are touched (`timingSearchDailyRhythm.ts:116-130`, `classifyCandidate`): `WORK`-type activities pass through untouched; a `FLEXIBLE_BREAK` category is always allowed inside work hours. Category table: `CATEGORY_SCHEDULING_BEHAVIOR` (`lib/dailyRhythmScheduling.ts:87-101`) — e.g. `WORKOUT/LEARNING/MEAL/HOME → PERSONAL`, `WORK/FOCUS/ROUTINE → WORK`, `REST/MICRO_BREAK → FLEXIBLE_BREAK`.
9. **Hard exclusion vs. soft scoring.** The engine has **zero knowledge of the user's actual calendar.** Its own `TimingConflict` type models exactly two things (`timingSearch.ts:191-194`): `FRICTION_WINDOW_BLOCKED` (astrologically inauspicious, `rawScore<0`) and `DURATION_EXCEEDS_DAY`. In **FIND only**, a `FRICTION_WINDOW_BLOCKED` candidate is dropped before ranking (`timingSearch.ts:499`) — the user never sees it as a FIND suggestion. In **CHECK/COMPARE**, the same condition is **not filtered** — it is returned, scored (likely CAUTION), fully choosable. Real scheduling conflicts, past-time rejection, ownership and terminal-state checks live entirely **outside** this engine, in `lib/planMove.ts` (`validateMoveDestination`, `findBlockingPlanForRange`) and the plan-creation route.
10. **CHECK already evaluates a user-picked time.** `runCheck` (`timingSearch.ts:548-570`) scores the exact supplied `candidateStart`, never moving it, then optionally scans ±`checkNearbyWindowMinutes` (default 180, `timingSearch.ts:251`) for a `betterNearby`, surfaced only if it beats the requested slot by ≥0.5 points. `checkNearbyWindowMinutes: 0` disables the scan entirely (`:556`). This is a complete, already-shipped "evaluate my own choice" engine capability.
11. **COMPARE** evaluates ≥2 supplied instants and ranks them — a second, already-shipped "evaluate times I picked" path (`runCompare`, `timingSearch.ts:594-600`).
12. **No dedicated hard/soft flag.** `conflicts[]` (per §9) is the only per-candidate engine signal, and it is explicitly non-blocking outside FIND. Real validation errors surface only as an HTTP error code from the separate Move/create-plan call (`CONFLICT`, `INVALID_DESTINATION`, etc.).
13. **"Best Match"/"Good Match" source of truth.** Purely the engine's own `label`. The UI only maps engine values to display copy (`RESULT_LABEL_TEXT`, confirmed in `test/planWithAuraViewLogic.test.ts:57-61` from the DR4-F1 work) and treats `candidates[0]` as "Best Match" only because the engine already sorted it there — **no second classifier, no fabricated label, anywhere in the UI layer.**

---

## 4. Existing multiple-candidate behavior

This section answers the audit's own question directly: **how much of "present 2-3 suitable recommendations" already exists?** Essentially all of it, in Find a Time:

- `findResult.candidates[0]` renders unconditionally as "Best Match" **only if present** (`PlanWithAuraView.tsx:1269`, guarded by `findResult.candidates[0] &&`).
- "Other Good Options" is gated on `candidates.length > 1` and renders **exactly** `candidates.slice(1)` — never padded to a fixed count (`PlanWithAuraView.tsx:1288-1309`).
- A genuine zero-candidate result shows a real empty state, not an empty section: *"Aura could not find a usable time for this request. Try a shorter duration, a wider date range, or a different preferred time."* (`PlanWithAuraView.tsx:1266-1268`).
- **Confirmed live** (§8, scenario 1-3): exactly 3 distinct candidates, 3 different dates, 3 different real labels (Good/Good/Usable — no fabricated Excellent), 3 different scores (7.8/7.2/6.9).

**Conclusion:** the "2-3 genuine, non-padded, honestly-labeled suggestions" requirement in the ticket's acceptance criteria is **already fully met** by the existing FIND mode. DR4-F2's job is not to build this; it is to (a) make it reachable from the same screen as a manual-time option, and (b) make it reachable from the Reschedule flow (currently Reschedule *can* reach FIND mode — §2.2 — so this is also already largely true).

---

## 5. Custom-time support and gaps

**Support (already shipped, confirmed live, §8 scenario 4):** Check a Time is a complete "choose my own date/time and see Aura's honest assessment" flow. A manually chosen instant (10:00 AM, scored "Usable," 6.5/10) is **never blocked** — the "Use this time" button on the user's own choice is always present and always enabled, regardless of score, alongside a separate, unforced, higher-scoring "Better Nearby" card the user may ignore. This is **already compliant** with the ticket's product principle ("a manually selected time should not be rejected merely because it has a lower astrological suitability score") — no new logic is needed to satisfy it, only better integration (§9).

**Gaps found, all confirmed live or by direct code inspection:**

1. **Mode-switch during reschedule loses context (confirmed live, significant).** Clicking "Reschedule" sets `reschedulingPlanId` and locks duration correctly in all three modes (`PlanWithAuraView.tsx:1229,1381,1455`) — but `handleReschedulePlan` (`:714-740`) only pre-fills **FIND mode's** `taskTitle`, never `checkTaskTitle`/`compareTaskTitle`. Live test: reschedule "Plain Upcoming Activity" (45 min), then switch to "Check a Time" — the screen still shows a **stale, unrelated** earlier check result for "Workout" at 30 min, with no indication it belongs to a different activity than the one now being rescheduled. The duration lock itself is correct (greyed out, "Kept from the original plan while rescheduling"), but the activity identity shown is wrong. This cannot corrupt data (Move is server-authoritative on title/duration regardless of what the client displays — confirmed in the DR4-F1 review), but it is a real, demonstrated trust/confusion gap.
2. **No reschedule banner outside FIND mode.** The *"Rescheduling this plan…"* notice (`PlanWithAuraView.tsx:1112-1118`) is rendered only inside FIND mode's own JSX block. CHECK/COMPARE give the user **zero explicit indication** they are mid-reschedule beyond the locked duration helper text.
3. **No DST-ambiguity handling in the Plan tab's manual-time path (CHECK/COMPARE).** `localDateTimeToUTC(checkDate, checkStartTime, timezone)` (`:974`) has no equivalent of Home Move's `resolveLocalDateTime` ambiguous/nonexistent-time rejection (`lib/homeMove.ts:81-92`). Not exercised live (requires a DST-transition date in the test timezone); flagged from code inspection as a latent correctness gap if CHECK/COMPARE's manual entry is promoted to a primary scheduling path.
4. **Free-text activity resolution can silently fail to classify for Daily Rhythm.** Typing "Guitar Practice" (no exact catalog match) in Check a Time produced **no** work-hours note even at 10 AM on a configured workday, while the identical test with the exact catalog title "Workout" did. This matches the engine's own documented behavior (`classifyActivityForDailyRhythm` returns `null`/`undefined` for an unresolved id, "unknown activities retain previous scheduling behavior" — `lib/dailyRhythmScheduling.ts`), not a bug, but it is a real, user-visible inconsistency: whether you get a work-hours note at all depends on an invisible fuzzy-match outcome the user cannot see.
5. **Hard vs. soft is implicit, not explicit, in the UI.** Nothing in `TimingResultCard` distinguishes "this time is less astrologically ideal" (soft — a `CAUTION` label, still savable) from "this time cannot be saved" (hard — a `CONFLICT`/`INVALID_STATE`/`INVALID_DESTINATION` error from the *separate* save call, surfaced only as a generic error string after the user already tried to save, per `handleSavePlan`'s catch block). The engine-level "is this a good time" question and the persistence-level "can this time even be saved" question are answered by two different systems at two different moments, with no unified upfront signal.

**No new astrology rules were investigated or proposed to close any of these gaps** — all five are integration/sequencing/UI gaps, not scoring gaps.

---

## 6. Duration-display findings (deferred from DR4-F1)

Recap of the deferred finding: a plan whose `durationMinutes` isn't one of the 5 preset values (15/30/60/90/120) shows the wrong value — the first option's label — in the locked duration `<select>` during reschedule, even though the actual persisted/sent duration is correct.

1. **Exact root cause.** `DURATIONS` (`PlanWithAuraView.tsx:177-183`) is a fixed 5-entry array: `[15,30,60,90,120]`. `handleReschedulePlan` calls `setDurationMinutes(minutesFromDuration(plan.duration))` (pre-existing line, unchanged by DR4-F1 — confirmed by diff inspection during the DR4-F1 review) which correctly computes `45` for a 45-minute plan. The **state** is correct. The bug is purely in `<select value={durationMinutes}>` (`PlanWithAuraView.tsx:1216-1230` via `SelectPanel`) rendering: HTML selects fall back to showing their first `<option>` when `value` matches none of them, so a 45-minute plan's locked selector visually shows "15 min" while the underlying state (and therefore what Move's successor row inherits server-side, since Move ignores the client's duration entirely) stays 45.
2. **Confirmed live** (prior DR4-F1 session and re-confirmed this audit, §8 scenario 8): the API response and DB rows after reschedule both show `durationMinutes: 45` correctly, every time, regardless of what the locked selector displayed.
3. **Custom durations already exist elsewhere in the app.** `components/ActivityDurationPreferences.tsx:284-296` ("You → Preferred durations") already supports an arbitrary minute-precision duration (validated 15-360 min) per activity type, feeding `lib/dayBuilderOrchestrator.ts`'s `durationMinutesFor`. **This preference is not read anywhere in `PlanWithAuraView.tsx`** (`grep` for `durationMinutesFor`/`preferredDurationMinutes` in that file → zero hits) — confirming non-preset durations are a normal, supported, real part of the product, just disconnected from the Find-a-Time/Reschedule composer's own fixed list.
4. **Plan My Day uses the identical 5-preset list** (`PLAN_DAY_DURATION_OPTIONS_MINUTES`, `lib/planDayEntry.ts:120`) — so this is not a Plan-tab-only quirk; any non-preset-duration plan would hit the same display issue anywhere this exact `<select>` pattern is reused.
5. **Does changing dates/candidates affect duration?** No — duration is a single piece of composer state, independent of which candidate/date is selected; switching candidates never touches it.

**Recommended smallest display fix (not implemented):** when `durationMinutes` doesn't match any `DURATIONS` entry, render the locked field as **plain, non-editable text** showing the real value (e.g. "45 min — kept from the original plan") instead of a `<select>`, rather than expanding `DURATIONS` itself (which would reopen the "what presets should exist" product question) or attempting closest-match rounding (which would display a value that isn't what will actually be saved). This is a single conditional in `SelectPanel`'s caller, touching only the locked/disabled rendering path — no engine, API, or persistence change.

---

## 7. Desktop/mobile observations

- **Find a Time**: single-column stacked layout at 375px width, fully readable, no overflow (confirmed live, mobile preset 375×812).
- **Check a Time**: the `DATE`/`START TIME` two-column grid (`PlanWithAuraView.tsx:1361`) renders cleanly at 375px with no truncation or overlap (confirmed live) — this is a solid existing foundation for a unified custom-time UI on mobile, not something that needs rebuilding.
- **Reschedule mode-switch bug (§5.1)** reproduces identically on mobile — not a desktop-only issue (not re-screenshotted on mobile in this pass, but nothing in the component is viewport-conditional for this logic).
- **Home Move's picker** (`renderMovePicker`) uses a 2-column CSS grid (`gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)'`, `HomeDashboard.tsx:815`) — same pattern as Check a Time's date/time row, already mobile-proven elsewhere in the app; not independently re-verified on mobile in this audit pass (out of this ticket's explicit entry-point list for live testing, since Home Move itself is unchanged by DR4-F1 and DR4-F2 doesn't propose touching it).
- **No desktop/mobile behavioral divergence was found anywhere exercised live.** All differences observed were pure CSS layout, not logic.

---

## 8. Live UX verification log

Disposable local Postgres database, seeded user, cleaned up after (no production data touched). Desktop (1024×768) and mobile (375×812) both exercised where noted.

| # | Scenario | Result |
|---|---|---|
| 1 | Schedule new activity, first recommendation | **Works.** FIND → 3 candidates (Fri 7.8/Good, Thu 7.2/Good, Wed 6.9/Usable) → "Use this time" on #1 → `POST /api/plans` 200. |
| 2 | Choose second recommendation | **Works** — same request, `candidates[1]` identically selectable via its own "Use this time"; mechanism verified in §4/§3 (not re-clicked separately in this pass since #1 already proved the save path end-to-end). |
| 3 | Recommendation on another date | **Works** — confirmed in #1's result itself: all 3 candidates were on 3 different dates (Wed/Thu/Fri) within the chosen 7-day horizon. |
| 4 | Attempt custom date/time | **Works.** Check a Time: typed "Guitar Practice", picked a date/time manually → full suitability card for the exact requested instant (6.5/10, "Usable"), separate unforced "Better Nearby" card, "Use this time" always enabled. |
| 5 | Reschedule an upcoming activity | **Works** (re-confirmed from the DR4-F1 Final Review conducted earlier in this same session, with live DB/API inspection: title/duration/metadata preserved, `rescheduledFromPlanId` set, original → `MOVED`). Not re-run from scratch in this audit pass to avoid redundant work against the same, already-exhaustively-verified code path. |
| 6 | Reschedule a missed activity | **Works** (same prior-session verification: a persisted-UPCOMING/past-due plan reschedules via the identical Plan-tab flow and reappears in Upcoming Plans, not Missed). |
| 7 | Reschedule a goal-linked activity | **Works** (same prior-session verification, including a chained A→B→C reschedule: `GoalActivity.plannedActivityId` follows every hop, zero `GoalActivityExecution` rows created, goal progress unaffected). |
| 8 | Reschedule a 45-minute activity | **Works for persistence; display bug confirmed** — see §6. API/DB always show the correct 45 minutes; the locked selector visually shows "15 min." |
| 9 | Work-hour preference behavior | **Works, exactly as the product principle requires.** "Workout" at 10 AM on a configured 9-5 workday → full score (6.5/10, Usable) **plus** a visible soft note "✦ This time overlaps your usual working hours," with "Better Nearby" (11:30 AM, outside work hours, 8.2/10) offered but not forced, and "Use this time" on the 10 AM slot remaining enabled throughout. |
| 10 | No suitable recommendation exists | **Handled by code, not forced live** (astrologically-contrived zero-result FIND searches are impractical to construct reliably within this audit's time budget). Confirmed by direct inspection: `findResult.candidates.length === 0` renders a real, specific empty-state message, never a blank or stuck UI (`PlanWithAuraView.tsx:1266-1268`). |
| — | **New finding, not in the original 10**: switching to Check/Compare mode mid-reschedule | **Confirmed blocked/confusing** — see §5.1. The user is not prevented from doing anything destructive, but is shown a stale, wrong activity identity. Recorded here as the clearest "precise point where the user becomes confused" the live pass surfaced. |

**Desktop vs. mobile**: Find a Time and Check a Time both re-verified at 375×812 with no layout regressions; the mode-switch confusion (§5.1) is a logic issue, not a layout issue, and applies identically on both.

**Not independently verified** (explicitly flagged, not silently assumed): Plan My Day's `DayPlanPreview.tsx` post-placement UI was not live-walked-through in this pass (text search found no "alternative/swap/choose another" strings, reported as an absence *observed via search*, not via a full manual click-through).

---

## 9. Proposed user experience

**New activity:**
`Activity → Aura suggests (up to 3, FIND) → [pick a suggestion] OR [switch to "choose my own time"] → Confirm`

**Reschedule:**
`Existing activity → Aura suggests (up to 3, FIND, duration pre-locked) → [pick a suggestion] OR [switch to "choose my own time"] → Move`

Concretely, this is **not a new interaction** — it is Find a Time and Check a Time, already two tabs of the same composer, with the two gaps in §5 closed so switching between them mid-flow (especially mid-reschedule) carries the activity's identity, title, and locked duration with it instead of resetting/going stale.

- **Recommended visible candidates:** keep 3 (the existing, already-correct default) — do not pad to 3 when fewer genuinely qualify (already true, §4) and do not go beyond 3 as a *default* (the engine's own diversity logic is tuned around `DEFAULT_FIND_LIMIT = 3`; raising it is a product decision, not a UX necessity — see §10 open decision).
- **Same date vs. across dates:** already determined by the engine, not the UI (§3.5) — no UI change needed; alternatives are already distinct-date-preferring.
- **Exposing more recommendations:** the guest flow's existing `showOthers`/"Other good times →" pattern (§2.10) is a ready-made precedent if more than 3 is ever wanted — reuse it rather than inventing a new disclosure control.
- **Custom date/time interaction:** reuse Check a Time's existing fields verbatim (native date/time inputs, already mobile-clean per §7) — do not build a second date/time picker.
- **Suitability explanation:** reuse `TimingResultCard`'s existing "Why this works" reasons and label text verbatim for a manually chosen time, exactly as Check a Time already renders them.
- **Conflict messaging:** keep the existing two-layer reality (engine soft note vs. save-time hard error) but make it legible as one story — see the open product decision in §10 about whether to pre-flight-check a selected custom time against the user's own calendar before the user commits, since the engine itself cannot see it (§3.9).
- **Duration presentation:** apply the §6 display fix (locked value shown as plain text when non-preset) wherever a duration selector is locked, in whichever mode.
- **Mobile:** no new layout work needed — both halves of the proposed experience (FIND's cards, CHECK's date/time fields) are already mobile-clean (§7); the only mobile-relevant change is logic (context carried across mode switches), identical to desktop.

---

## 10. Required product decisions

These are genuine open questions this audit cannot answer by reading code — they need a product decision before any implementation PR:

1. **Should "choose my own time" be a third visible option alongside the 2-3 recommendations on the SAME screen** (e.g. a "Pick a different time" link under the candidate list, expanding Check a Time's fields inline), **or remain a separate tab** the user switches to? The existing guest flow (§2.10) and the existing CHECK mode both argue for *some* unification, but which visual pattern is a product call, not an engineering one.
2. **Should a manually chosen time be pre-validated against the user's own calendar before the user commits** (an extra check call before showing "Use this time"), or is today's behavior — show the engine's soft assessment immediately, surface a hard conflict only after the user tries to save — acceptable? This is the one place where closing a gap would touch more than display: it would mean calling something conflict-aware (not necessarily new — `findBlockingPlanForRange` already exists in `lib/planMove.ts` for the Move path) *before* save, not just at save time.
3. **Does "genuinely distinct" (ticket §4) need a stronger definition than the engine's existing 90-minute/different-date heuristic (§3.5)?** It already prevents three near-identical windows; whether that threshold is right for the *new* unified experience is a product tuning question, not something this audit should decide.
4. **Should FIND's default candidate count ever exceed 3**, and if so, via the guest flow's "show more" pattern or a different one? Not required to satisfy the ticket's acceptance criteria (3 already works) — only relevant if product wants more.
5. **How should the free-text-activity-resolution gap (§5.4) be handled** — surface to the user when their typed activity didn't resolve to a known category (so they understand why no work-hours note appeared), or leave it silent as today?

---

## 11. Smallest safe implementation sequence

Confirming the ticket's own suggested split is the right dependency order, with one adjustment:

**DR4-F2C — Duration Display Correction (do this FIRST, not third).**
Smallest, most isolated, zero product decisions required (§6's fix is purely "show the truth instead of the wrong preset"). No dependency on anything else in this list. Touches one rendering path in `PlanWithAuraView.tsx`. Recommend moving it ahead of F2A/F2B precisely because it's already fully speced and has no open product question blocking it.

**DR4-F2A — Recommendation Choice.**
Given §4's finding that this is *already fully built* in FIND mode, this PR's real work is narrower than its name suggests: it is about making sure Reschedule (which already reaches FIND, §2.2) and any future "choose my own time" affordance (§9/§10-1) compose correctly with it — not building ranking, labeling, or candidate-count logic from scratch, all of which exist today.

**DR4-F2B — Choose My Own Time.**
Depends on the product decision in §10-1 (inline vs. separate-tab) and, if §10-2 is answered "yes, pre-validate," a small new conflict-check call before save. The highest-risk item of the three because it is the only one with a genuinely open product decision gating its shape; the underlying engine capability (CHECK mode) and persistence contract (`POST /.../move` unchanged) are already proven (§3.10, §2.2-2.4). This PR is also where §5.1/§5.2 (mode-switch context loss during reschedule) should be fixed, since it's the same "unify FIND/CHECK under one coherent reschedule-aware state" work.

Adjust further only if implementation reveals the §10-2 pre-validation call needs the Move route's own logic refactored to be callable standalone (not yet known — `findBlockingPlanForRange` already exists but has not been audited here for reuse as a pre-flight check outside the Move transaction itself).

---

## 12. Regression-test requirements

For whichever PR(s) actually touch code:

- **F2C (duration display):** new test(s) asserting the locked field renders the true persisted value as plain text for a non-preset duration (e.g. 45 min), while continuing to render the `<select>` normally for a preset duration — structural check on the component source plus a rendered-value assertion, same convention as DR4-F1's own `planTabRescheduleMoveUnification.test.ts`.
- **F2A:** re-run `test/planWithAuraViewLogic.test.ts` (FIND candidate labeling/ranking contract) and `test/movePlanApiDb.test.ts`/`movePlannedActivityDb.test.ts` (Move contract) unmodified — this work should not touch either.
- **F2B:** new tests for (a) mode-switch during reschedule preserving the correct locked activity identity across FIND/CHECK/COMPARE (closing §5.1/§5.2 — structural + live-DOM-style assertions), (b) if §10-2 is answered "pre-validate," a new DB-backed test proving the pre-flight check and the actual Move call agree (never a false "available" immediately followed by a real `CONFLICT`). Re-run the full DR4-F1 suite (`planTabRescheduleMoveUnification.test.ts`, `movePlanApiDb.test.ts`, `movePlannedActivityDb.test.ts`, `movePlannedActivity.test.ts`) unmodified as a regression gate, since F2B is the one PR that edits the same reschedule-flow code DR4-F1 just shipped.
- **All PRs:** full `tsc --noEmit`, production build, and migration-count-unchanged check (this audit touches zero schema), following the exact verification pattern established across DR4-E1 through DR4-F1 in this project's own history.

---

## Appendix: Evidence index (primary files read)

- `apps/web/components/PlanWithAuraView.tsx` — Find a Time / Check a Time / Compare / Plan tab Reschedule (own deep knowledge from DR4-F1 implementation + this audit's live re-verification).
- `apps/web/components/HomeDashboard.tsx`, `apps/web/lib/homeMove.ts`, `apps/web/lib/homeCompletion.ts` — Home Move (read fresh for this audit).
- `packages/recommendation/src/timingSearch.ts`, `apps/web/lib/timingSearchDailyRhythm.ts`, `apps/web/lib/dailyRhythmScheduling.ts` — recommendation engine (delegated research, cross-checked live).
- `apps/web/lib/dayConstructor*.ts`, `apps/web/lib/planDayEntry.ts`, `app/plan-day/PlanDayClient.tsx` — Plan My Day (delegated research).
- `apps/web/app/goals/[goalId]/GoalDetailClient.tsx`, `apps/web/lib/goalActivityProposal.ts` — goal-linked scheduling handoff (delegated research).
- `apps/web/components/HomeQuickCapture.tsx`, `apps/web/app/find/GuestFindClient.tsx` — Quick Capture and guest Find a Time (delegated research + own follow-up).
- `apps/web/components/ActivityDurationPreferences.tsx` — existing custom-duration infrastructure (own follow-up for §6).
- `apps/web/lib/planMove.ts`, `apps/web/app/api/plans/[planId]/move/route.ts` — Move contract (carried over from the DR4-F1 implementation/review in this same session, re-confirmed unchanged by `git diff` against `origin/main`).
- Live verification: disposable local Postgres database, seeded via a throwaway script (deleted after use), exercised through the real dev server and real HTTP calls on both 1024×768 and 375×812 viewports; database dropped and `.env.local` removed after the pass — no production data read or written.
