# AURA — Insights V1 End-to-End Product & Release Readiness Audit

MODE: READ-ONLY PRODUCT AUDIT. No implementation, no PR, no commits, no migrations were performed. PR7 was not started.

Baseline: `3bb83791c29f824bcc769d14161eb00d84c858a2` (origin/main == local main). Migration count: 49. Completed milestones audited: PR1 (Move Timestamp Foundation), PR2 (Stable Scheduled-Week Attribution), PR3 (Durable Goal Completion Evidence), PR4 (Goal & Planning Reporting), PR5 (Evidence-Backed Improvement Prompts), PR6 (Durable Completion Attribution).

Legend: **VERIFIED** (confirmed by live browser interaction or direct code/DB inspection this session), **INFERRED** (confirmed by code reading / subagent code trace, not independently exercised live), **UNTESTED** (not exercised this session — explicitly not claimed as passing), **RECOMMENDED** (a proposed action, not a finding of fact).

---

## 1. Executive Verdict

**AURA — INSIGHTS V1 — PR7 REQUIRED — three confirmed trust/comprehension defects (two P1, several P2) are narrow and fixable without new infrastructure; nothing rises to data corruption or release-blocking severity.**

Insights V1 is substantively well-built: every empty state is honest (no fabricated zeros, no placeholder percentages), the evidence-gating vocabulary (NO_DATA/LIMITED/AVAILABLE) is applied consistently, and the underlying PR1–PR6 data layer is verifiably correct at the database level (28/28 and 47/47 real-DB scenarios already passing per the PR6 and Move/improvement-signal regression suites re-confirmed this session). The problems found are concentrated in **three places**: (1) two numbers on the same "Confirmed Progress" card measure different units with no disambiguating copy, (2) "Planning Patterns" and "Aura Suggests" can contradict each other for the identical underlying evidence because one is range-limited and the other isn't, and (3) the entire PR4/5/6 reporting block has no loading state, so it is reproducibly, visibly absent for 1–3 seconds on every fresh load with nothing to tell the user it's still coming. None of these require a new persistence model, a new signal, or a redesign — see §21/§22.

## 2. Baseline and Workspace Status — VERIFIED

- `git rev-parse HEAD` == `git rev-parse origin/main` == `3bb83791c29f824bcc769d14161eb00d84c858a2`, confirmed before and after this audit.
- Migration count: 49 (unchanged).
- Working tree: clean except the standing untracked audit documents (this file plus the seven prior `AURA_INSIGHTS_*.md` deliverables) and `.claude/settings.local.json` — identical to every prior checkpoint in this program.
- Worktrees: 47, all preserved untouched, including the PR6 worktree (`insights-v1-pr6-durable-completion-attribution`) used for the live dev-server inspection in this audit (its own `git status --porcelain=v1` is clean — no diff from the branch it was created on).
- No destructive Git command was run. No repository file was modified. The dev server used for live testing was started and stopped cleanly from that worktree (its own, isolated `npm ci`, never the shared main checkout's broken `node_modules`, per the standing policy established in the PR5/PR6 sessions).
- Disposable test data: two throwaway accounts (`aura-audit-limited@example.com`, `aura-audit-established@example.com`) were created via the application's own real production functions (never raw business-data INSERTs), used for live UI inspection, then their business data (Goals, PlannedActivity, HabitLog, DailyReflection, AuthCode rows) was deleted; the bare `User` rows were deliberately left in place (same convention as every other disposable test account in this program — `VisitLog` and other analytics tables FK to `User`, and removing those rows is out of scope for a read-only audit's own cleanup). A third, pre-existing test account ("Ui Preview Pr", left over from earlier UI-verification work in this program) was inspected read-only and not modified.

## 3. Product Promise Assessment — INFERRED / VERIFIED (copy), UNRESOLVED (no single product-intent document exists)

No single "Insights V1 promise" document exists in the repo; the promise has to be reconstructed from the six PR architecture audits and the shipped copy itself.

**What a user understands within 10 seconds (VERIFIED by screenshot, §4):** the header ("Insights — Patterns from your journey"), then — for an account with any history — either an actionable prompt ("Aura Suggests") or a bare numeric summary ("Confirmed Progress"). For a brand-new account, the first thing visible is a plain zero-state card, not a value proposition or a "here's what this page will do for you once you have data" framing (see §5, finding D-4).

**What decision Insights should help a user make:** per the PR4/PR5/PR6 audit docs' own stated intent, the decision is "what should I do right now / this week" (Aura Suggests) and "am I keeping up with my Goals" (Goals This Week / Confirmed Progress). The shipped UI matches this intent in ordering (§12) but undercuts it in clarity (§7, §9).

**Differentiation from adjacent surfaces — INFERRED:**
- **Home** shows "right now" guidance (what to do in this exact moment); Insights shows retrospective/aggregate state. No overlap found.
- **Plan tab ("Plan with Aura")** is where a suggestion's `OPEN_PLAN_REVIEW` CTA lands, and where the actual Reschedule/Log/Cancel actions live — Insights deliberately has no write actions of its own (confirmed: no suggestion CTA performs a write directly, §15). This is a clean, correct separation.
- **Goals (`/goals`, `/goals/[goalId]`)** is the canonical, full-detail Goal view; Insights' "Goals This Week" is explicitly a read-only summary reusing the Goal Detail's own presentation helpers (`formatGoalProgressLabel` etc., confirmed by code — no second vocabulary). No duplication of write capability found; some duplication of *information* (Goals This Week repeats what Goal Detail already shows) is intentional per the PR4 audit and matches a legitimate "weekly rollup" product shape.
- **Daily Reflection** feeds "Your Alignment" (the `alignmentDeltaPoints` card) directly — this is a pre-existing (pre-PR1) section, not duplicated elsewhere.
- **Aura Suggests elsewhere:** no other surface in the codebase renders `ImprovementSuggestion` objects (confirmed by the PR5 code trace — `improvementSignalsComposition.ts` is only called from `/api/insights/reporting`). No duplication.

**Missing value — INFERRED:** there is no persistent signal telling a first-time or low-data user *what to do to make Insights useful* beyond scattered per-card hints ("Log at least 3 activities...", "Log a few evening check-ins..."). See §5.

## 4. Actual UI Screenshots — VERIFIED

Captured live against a running dev server (`localhost:3001`, isolated worktree install) for three real accounts and three breakpoints. Representative screenshots (not exhaustively reproduced in this text document, but all claims below were visually confirmed this session):

- **Desktop (1440 viewport approximated at the pane's native ~800–1024px width, confirmed no reflow issues scaling up):** single-column card stack, consistent card chrome (`SurfaceCard`), legible type scale, no overlapping elements, no horizontal scroll.
- **Tablet (768×1024):** identical single-column layout, just wider — the extra horizontal space is not used for a second column or denser layout (not a defect, but a missed opportunity; §13/§18 P3).
- **Mobile (375×812):** cards stack cleanly, text wraps without clipping, bottom nav (6 icons + labels) fits without crowding, segmented control (Overview/Patterns/Trends/Streaks) fits 4 tabs across the full width without truncation. One minor layout seam: a secondary Aura-Suggests line with long wrapped text pushes its own "Open Plan ✕" controls into a slightly cramped position relative to the wrapped text (§18 P3).

**Section hierarchy (Overview tab, confirmed by direct observation):** Aura Suggests → Confirmed Progress → Goals This Week → Planning Patterns → Awaiting Confirmation → (plain-text limitations line) → Your Alignment → This Month → Aura Fit → Your Patterns → Window Distribution → Things to Watch (conditional). This matches the ordering the PR4 architecture audit itself recommended.

**Content density:** moderate-to-high — nine to eleven stacked cards on a populated account's Overview tab alone, before the three additional tabs. No section is collapsible; a returning daily user sees the full stack every time (§13 finding).

**Loading/error states — VERIFIED, significant finding:** see §13 (C) below; this is the single most load-bearing UI finding in this audit.

**Empty states — VERIFIED:** every one of the twelve zero-state messages encountered (Goals This Week, Awaiting Confirmation, Your Alignment, This Month, Aura Fit, Your Patterns, Window Distribution, Trends' "—" bars, Streaks' "0 Days") uses honest, specific, non-judgmental copy with no fabricated numbers. This is a genuine strength, confirmed across two independently-seeded accounts and one found-empty pre-existing account.

Source-code findings are marked INFERRED throughout; everything else in this section is VERIFIED by direct browser observation.

## 5. New-User (First-Time) Assessment — VERIFIED

Tested against an account with zero Goals, zero PlannedActivity rows, zero HabitLogs, zero Daily Reflections (a pre-existing test account, independently confirmed empty across every rendered metric).

1. **What Insights displays:** every card renders its own honest empty state. No "Aura Suggests" section renders at all (correct — `suggestions` is `null`, and the component returns `null` rather than an empty shell).
2. **Does the empty state explain Insights' purpose?** Partially. Each card explains *what unlocks it* ("Log a few evening check-ins to unlock your personal before-and-after trend", "Log at least 3 activities to start seeing patterns"), but there is no single, prominent "here's what Insights will show you once you've used Aura for a bit" framing at the top of the page. A first-time user has to read eight separate micro-hints to assemble that picture themselves.
3. **Does the user understand how to generate useful Insights?** Yes, directionally (every hint says "log" or "set up a Goal"), but **no hint is a clickable CTA** — "Goals This Week" says "Set up a Goal to see its progress here" with no button; the user must independently know to find Goal creation elsewhere in the app. **Finding D-1 (P3):** empty-state copy is directional but not actionable.
4. **Is a valid next action available?** Not from within Insights itself — every empty-state card is read-only prose. **Finding D-2 (P3).**
5. **Does empty data create misleading zero scores?** No. Every percentage/score that would be 0% is instead `null`/"—"/"Not enough data yet"; only genuinely known facts (activity count, streak) show a real `0`. The one presentation wrinkle: the Streaks tab shows "0 Days" at 28px bold next to a large 🔥 emoji — this is a *true* fact, not a fabricated one, but the visual weight given to "0" reads more like a failure state than a neutral starting point. **Finding D-3 (P3, tone only, not a correctness defect.)**

**Finding D-4 (P2, new):** the Trends tab's "Window Session Frequency" card shows only its header with no rows and no explanatory empty-state line for a zero-data account — inconsistent with the Overview tab's own "Window Distribution" card, which *does* show "No activity logs yet. Start logging from Home to see your patterns here." for the identical underlying data. Same information, two presentations, one of them silently blank.

## 6. Established-User Assessment — VERIFIED

Tested against a seeded account with 3 Goals (2 rhythm-based, 1 finite), 9 Goal-linked completions across 3 weeks, a 2-hop Move chain, 2 skipped plans, 1 unconfirmed past plan, 1 deleted-but-completed non-Goal plan, and 7 Daily Reflections.

**Does Insights synthesize, or just list unrelated numbers?** Mixed. Aura Suggests genuinely synthesizes (it correctly surfaced both AWAITING_CONFIRMATION and REPEATED_RESCHEDULING simultaneously, ranked, deduplicated, with calm non-alarmist copy). But immediately below it, "Confirmed Progress" presents two large numbers ("10 confirmed completed", "4 Goal activities done") that look like they should relate to each other (same card, same header, adjacent) but in fact measure fundamentally different things — see §7, finding F-1 (P1), the most significant comprehension defect found in this audit.

**Does repeated information appear in multiple sections?** Yes, in two ways:
- **"Aura-guided" counts appear twice with different scopes:** "This Month" (Overview tab) shows "59% Aura guided" (calendar-month-scoped, client-computed from raw `logEntries`); the Patterns tab's "Planning Loop" card shows the same underlying signal as three raw counts ("Planned"/"Do Now"/"Overrides", lifetime-scoped-by-component-mount, same client computation). Different scope, different presentation, same underlying `logSource` field, no cross-reference between them.
- **"Confirmed completed" (PR4/PR6, server-computed, scheduled-date-attributed, rolling 30 days) and "This Month: N activities" (client-computed from `logEntries`, calendar-month-attributed, filtered only by `syncStatus`) both answer "how much did I do," with different date windows, different attribution rules, and different source data — yet sit on the same Overview tab with no indication they're answering slightly different questions.** This is the duplication the ticket's Section F explicitly asked about; **Finding F-2 (P2).**

## 7. Reporting Correctness (PR4/PR6) — INFERRED (code+docs) / VERIFIED (UI numbers cross-checked against seeded ground truth)

- **What `confirmedCompleted` counts:** live `LOGGED` PlannedActivity rows in range (filtered by `plannedStartAt BETWEEN [now-30d, now]`) **plus** the PR6 HabitLog fallback (filtered by `scheduledStartAtSnapshot` in the same range) — both **scheduled-date-attributed, never completion-date-attributed.** Confirmed in code (`insightsReporting.ts`, `db.ts`) and in the PR6 decision doc's own stated design.
- **Default range:** rolling 30 days ending "now" (`to = now`, `from = to - 30d`), plain millisecond arithmetic — not calendar-month, not "this week." No date-range control exists in the UI at all (§11).
- **Finding G-1 (P2):** "confirmed completed" is bare-labeled with no copy anywhere distinguishing "scheduled date" from "completion date." PR6's own evidence shows these can diverge by a full month for a real, legitimate case (activity scheduled in September, actually done in October). `reporting.limitations` — the one mechanism that could carry this caveat — **never does**; the only limitation string the backend can ever produce (confirmed by full code read) is: *"Some of the requested range is before this account existed -- there is nothing to report for that period."* This single string fired on **every one of the three test accounts in this audit**, including the 20-day-old "established" one, because any account younger than 30 days triggers it — it is the most commonly-seen "limitation" in the product and it says nothing about scheduled-vs-completion-date semantics, timezone, or legacy-unknown attribution.
- **Finding F-1 (P1, confirmed live):** "Goal activities done" counts **distinct Goal-activity slots** that have reached a completed state at least once — not completion events. A rhythm-based Goal activity done 5 times in 3 weeks still contributes exactly **1** to this number (confirmed live: the seeded account had 5 Exercise completions + 2 Journal completions + 2 Book completions = **9 real Goal-linked completion events**, all counted inside "confirmed completed" = 10 (the 9 plus 1 deleted non-Goal fallback) — yet "Goal activities done" showed **4** (1 Exercise-activity-slot + 1 Journal-activity-slot + 2 Book-activity-slots, since Read-5-Books has 5 distinct finite slots). Two adjacent, equally-prominent numbers on the same card, same header, same visual weight, counting in incompatible units, with zero copy telling the user why a "10" and a "4" that both sound like "how much I did" aren't comparable. This is a real, demonstrable risk of a user concluding they've done "less for their Goals" than they actually have, or being confused about what either number means.
- **Over-target / partial completion labels — INFERRED, not independently reproduced live:** code confirms `formatGoalActivityRhythmWeeklyProgressLabel` never collapses "committed" into "completed," and an over-target week just shows the real count (e.g. "5 sessions this week") with the "remaining capacity" line suppressed (returns `null`) rather than showing a negative or "0 remaining" — correct, no mislabeling found. The finite-progress label (`formatGoalProgressLabel`) structurally cannot show `completed > total`. **Live confirmation:** "Read 5 Books — 2 of 5 completed" rendered correctly for a genuine partial-finite case.
- **Cross-week attribution / timezone — INFERRED only this session (not re-exercised live beyond the DB regression suite already shown passing: scenario 11, a Los Angeles user, and scenario 12, a cross-week Move, both already pass against the real database per the PR6 test suite's own 47/47 output).**
- **DB round-trips — INFERRED:** 7 queries for `/api/insights/reporting` itself, batched across all Goals (no per-Goal loop; confirmed by code), plus up to ~11 more inside `computeImprovementSuggestions` depending on day-of-week (not Goal count). Reasonable; no N+1 pattern found (§17).

## 8. Goal Progress Clarity — VERIFIED (live) / INFERRED (edge cases)

Users can answer "what did I plan" (per-Goal rhythm targets, e.g. "3 sessions/week") and "what remains" (remaining-capacity line) directly from "Goals This Week." "What did I complete" is ambiguous for rhythm Goals specifically because of the F-1 unit mismatch above — a user reading only "Goals This Week" (which correctly shows weekly session counts, not slot counts) is fine; a user cross-referencing it against "Confirmed Progress" above it is not. Goal Detail navigation itself (`/goals/[goalId]`) was not clicked through in this session beyond confirming the link's `href` is correct and goalId-specific (§15); it was not separately re-verified for long Goal lists or its own mobile layout (**UNTESTED**, out of this audit's scope — Goal Detail is not part of the Insights surface).

## 9. Planning Patterns Assessment — VERIFIED, significant finding

**Finding F-3 (P1, confirmed live):** "Planning Patterns" showed **"0 rescheduled"** on the exact same page render where "Aura Suggests" showed **"This activity has been moved a few times. Would another time work better?"** — both driven by the identical underlying 2-hop Move chain in the seeded test data. The cause (confirmed by code): "Planning Patterns" counts are derived from `listPlannedActivitiesForReporting`, filtered by `plannedStartAt BETWEEN [now-30d, now]` — a **backward-looking-only** window. A Move chain whose terminal plan is scheduled in the near future (as any live, not-yet-due rescheduled plan necessarily is) falls **outside** that window and is never counted, while the REPEATED_RESCHEDULING signal evaluates the live chain directly with no date-range filter at all. The result: two cards on the same screen, both claiming to describe "your planning behavior," disagreeing with each other about whether a reschedule happened, for the same event, at the same moment. This is a genuine, user-visible internal-consistency failure, not a hypothetical — it reproduced identically on first observation.

Separately: "Planning Patterns" distinguishes Plans from distinct activities correctly (each row is a Plan, not conflated with a Goal activity); Move-chain rows are never themselves presented as clickable actions in this card (the Move chain's own actionability lives entirely in the Aura Suggests CTA, which is correct separation); "awaiting confirmation" is clearly described as a missing outcome, never as failure (confirmed copy: *"This isn't a judgment -- just activities Aura hasn't heard back about yet."*) — this is a genuine strength.

## 10. Suggestion Quality (PR5, Aura Suggests) — VERIFIED (2 of 4 signals live) / INFERRED (2 of 4 signals, code-only)

| Signal | Evidence/eligibility | Copy (verbatim) | Historical-claim check | CTA | Status |
|---|---|---|---|---|---|
| AWAITING_CONFIRMATION | ≥1 unresolved past plan | "Some past plans don't have a recorded outcome yet." | Present-tense, no historical-frequency claim. | `OPEN_PLAN_REVIEW` | **VERIFIED live** (fired correctly on 2 independent seeded accounts, including one with <1 week of history) |
| PLANNING_OVERLOAD | live capacity utilization > 1, or committed>0 with no usable capacity | "Your current plans may need more time than you have available." | Explicitly present-tense by design (code comment confirms this was a deliberate correction). | `OPEN_PLAN_REVIEW` | **UNTESTED live** (not constructed this session; INFERRED correct from code) |
| REPEATED_RESCHEDULING | ≥2-hop live Move chain, unresolved terminal | "This activity has been moved a few times. Would another time work better?" | Describes a real live chain's own history, not a false present-state claim — acceptable. | `OPEN_PLAN_REVIEW` | **VERIFIED live** (fired correctly; see §9 for the consistency problem this exposed) |
| WEEKLY_GOAL_OPPORTUNITY | remaining weekly rhythm capacity > 0 AND a live, re-checked feasible contiguous free slot exists this week | "There's room for another activity toward your weekly goal." | Explicitly structural/capacity-only language; code comment confirms the design deliberately avoids `runTimingSearch`/muhurta equivalence to prevent implying auspicious timing. | `OPEN_GOAL` + real `goalId` | **UNTESTED live** (did not fire for the seeded account, likely because no Day-Constructor availability was configured for the disposable test user; INFERRED correct from code) |

**Ranking/suppression — INFERRED, confirmed by code:** fixed priority order (AWAITING_CONFIRMATION > PLANNING_OVERLOAD > REPEATED_RESCHEDULING > WEEKLY_GOAL_OPPORTUNITY), stable sort, dedup by `subjectId`, capped at 1 primary + 2 secondary. **Live confirmation:** exactly this shape rendered (1 primary + 1 secondary) for the established test account.

**CTA actionability — VERIFIED, mixed finding.** `OPEN_GOAL` is a real `<a href="/goals/{goalId}">` link, landing on the correct, specific Goal — genuinely actionable, confirmed by code (goalId is only ever drawn from the caller's own `ACTIVE`-filtered Goal list, so it cannot reference a stale/archived Goal within one response). **`OPEN_PLAN_REVIEW` is not actionable in the way its label implies — Finding F-4 (P1, confirmed live):** clicking "Review plans" on the AWAITING_CONFIRMATION suggestion does not open the unconfirmed plan, or a filtered view of unconfirmed plans. It opens the generic "Plan with Aura → Find a Time" screen (a *new-activity* creation flow). Reaching the actual plan that needs confirming requires two further manual steps (tap "My Plans," then visually identify and expand the correct row among all "Upcoming Plans" — the stale, past-due plan is not flagged, sorted first, or visually distinguished from a genuine future plan). This matches the `onOpenPlanReview={() => setActiveTab('plan')}` wiring found in code — a bare tab switch with zero preserved context.

**Dismissal/suppression — VERIFIED live:** session-local dismissal works exactly as documented (dismissed card disappears immediately; reloading the page brings it back, matching the code's own explicit promise of no cross-session persistence — not a bug, a documented design choice). **Empty state — VERIFIED:** zero suggestions renders nothing (no empty card, no placeholder), confirmed on the brand-new account.

**Does a suggestion repeat information already obvious elsewhere?** AWAITING_CONFIRMATION's count is also shown, with slightly more detail, in the "Awaiting Confirmation" card further down the same tab — mild, low-cost repetition, not misleading (**P3**).

## 11. Historical / Traditional-Timing Sections — VERIFIED, one notable finding

The Patterns/Trends/Streaks tabs predate PR1–PR6 and were not re-audited line-by-line for correctness (out of this program's stated scope), but their **copy** sits on the same page as PR4–PR6's carefully evidence-gated, hedged language, so it was read for consistency per the ticket's explicit instruction.

**Finding F-5 (P2):** the "Patterns" tab's "Deep Pattern Analysis" card carries the static caption *"Correlating habit execution timestamps against optimal Vedic energy windows"* (unconditional — shown regardless of the user's actual data), and the adjacent "Peak Energy Windows" card is subtitled *"Distribution of logged activities across diurnal solar segments"* for what is, per code (`insightsWindowAlignment.ts`, `classifyInsightsWindow`), a plain clock-hour bucket count (05:00/12:00/17:00/22:00 boundaries) with no astronomical or astrological computation behind *that specific card*. The word "optimal" in particular asserts a value judgment (these windows are the best ones) without the hedge that every other PR4–PR6 string in this program carries ("this is what was observed," never "this is what you should believe"). This is defensible as consistent with the app's own stated identity as a Vedic-timing-based scheduler — Aura's "SUPPORTIVE/NEUTRAL/FRICTION" window classification genuinely is derived from Panchang concepts (Rahu Kalam, Abhijit, etc.) elsewhere in the data model — but the specific juxtaposition of this unhedged, authority-toned copy directly beside PR4-6's own rigorously-hedged "not enough data yet" / "this isn't a judgment" language reads as two different voices on one page, and a user has no way to tell, from the copy alone, that "Peak Energy Windows" is just a clock-time tally while "Deep Pattern Analysis" invokes a traditional-timing framework.

**Old vs. new sections — do they form one coherent experience?** Partially. The ordering (new PR4-6 content first, old content below) is sound, and nothing in the old sections fabricates data. But the voice shift noted above, plus the F-2 duplication (§6) between old "This Month"/"Planning Loop" and new "Confirmed Progress," means a user scrolling the full Overview tab is reading two different Insights products stitched together rather than one.

## 12. Information Architecture — VERIFIED (current order), RECOMMENDED (changes)

Current Overview ordering (confirmed): Aura Suggests → Confirmed Progress → Goals This Week → Planning Patterns → Awaiting Confirmation → limitations line → Your Alignment → This Month → Aura Fit → Your Patterns → Window Distribution → Things to Watch. This matches "most actionable first, most detailed last" and is a reasonable hierarchy — **no evidence found that this ordering itself is a problem.**

**RECOMMENDED, scoped to this audit's own findings only (not speculative):**
- Fix F-1/F-3 before touching ordering — the ordering is fine; the content within two of its cards is the problem.
- The three old tabs (Patterns/Trends/Streaks) could reasonably be described as "what belongs in a monthly view" vs. the Overview tab's "what belongs in a weekly/daily view," which is roughly how they already function — no reordering recommended here, only the copy-consistency fix in §11.
- "This Month" (§6, F-2) duplicates "Confirmed Progress" closely enough that one of the two should either be removed or explicitly reconciled; this audit does not have the product authority to pick which, and flags it as a decision for product rather than prescribing an answer.

## 13. Time-Range Experience — VERIFIED, one clear finding

**No date-range control exists anywhere in the Insights UI** (confirmed: full read of `InsightsView.tsx` and the reporting route — `from`/`to` are entirely server-defaulted, never client-overridable in this UI, even though the API itself accepts query params). The default rolling 30-day window is never stated to the user anywhere on the page — there is no "showing data from Sep 15 – Oct 14" header. **Finding M-1 (P2):** the single limitations string that does appear ("Some of the requested range is before this account existed...") implicitly references a range the user is never shown, making that sentence meaningfully harder to interpret than it needs to be. Ambiguity between "today / this week / this month / last 30 days" is real: "Confirmed Progress" = rolling 30 days by scheduled date; "This Month" = calendar month by log date; "Goals This Week" = calendar week (Mon-start or Sun-start, not independently confirmed which). **Smallest viable fix:** add one line of plain-language date-range context near the top of the reporting block (e.g., "Last 30 days"), and extend the existing `limitations` string to name the actual dates — no new UI control required.

## 14. Personalization Quality — VERIFIED (qualitative)

No arbitrary productivity score was found anywhere (confirmed by full read of both `InsightsView.tsx` and the reporting/signal code — every percentage is either a real weighted average of real data or explicitly gated to `null`/a text caption). No judgmental labels were found ("This isn't a judgment" is the house style, applied consistently). No unsupported predictions were found — `planningLift` copy is deliberately past-tense/observational, not causal (confirmed verbatim: *"Aura-planned activities were X points more aligned... in your logged history"*, never "Aura makes you..."). Suggestions are specific enough to act on for 3 of 4 signals (AWAITING_CONFIRMATION, REPEATED_RESCHEDULING, WEEKLY_GOAL_OPPORTUNITY all name the actual subject); PLANNING_OVERLOAD's copy is deliberately generic ("your current plans") rather than naming which plan, which is a reasonable, intentional tradeoff per its own code comment (specificity risks a false-precision claim about *which* plan is the problem when the underlying signal is aggregate capacity, not a single plan).

## 15. CTA Audit — VERIFIED

| CTA | Source | Destination | Context preserved? | Confirmation needed for writes? |
|---|---|---|---|---|
| "Review plans" (AWAITING_CONFIRMATION) | Aura Suggests | Plan tab, "Find a Time" (new-activity flow) | **No** — generic tab switch only (Finding F-4) | N/A, no write from this CTA itself |
| "Review today's plan" (PLANNING_OVERLOAD) | Aura Suggests | same as above | **No**, same mechanism | N/A |
| CTA (REPEATED_RESCHEDULING, "Open Plan") | Aura Suggests | same as above | **No**, same mechanism | N/A |
| Goal name link (WEEKLY_GOAL_OPPORTUNITY) | Aura Suggests | `/goals/{goalId}` | **Yes** — real, specific Goal | N/A |
| "Dismiss" / "✕" | Aura Suggests | none (local state only) | N/A | No write — confirmed session-local only, no API call observed in Network panel during the dismiss click |
| "Confirm location" | Global banner (every tab) | unexplored this session | UNTESTED | UNTESTED |

**Dead ends:** the three `OPEN_PLAN_REVIEW` CTAs all share the same dead-end-adjacent problem (land on an unrelated "create new" screen rather than the relevant item). **No silent writes were observed or found in code** — every state-changing action (Log/Skip/Reschedule/Cancel) requires its own explicit tap on the Plan tab's own controls, confirmed both by code (no write call inside any Insights CTA handler) and by live interaction (clicking "Dismiss" produced no network request; clicking into "My Plans" and expanding a row only revealed buttons, did not itself log/skip/cancel anything).

## 16. Trust and Explanations — VERIFIED / INFERRED

Evidence transparency is strong for the two non-copy-related areas verified live (Aura Suggests' `evidence` strings are machine-oriented internal tags, never shown to the user directly — the user-facing `message` is the only thing rendered, confirmed by code and by screenshot). Historical coverage limitations are **under**-surfaced (§7, §13 — the single possible limitations string is generic and fires on almost every account under 30 days old). Unknown outcomes are framed correctly as neutral, not failure (§9). Deleted-Plan behavior is invisible to the user by design (a deleted-but-completed activity is folded into "confirmed completed" with no separate callout) — this is defensible (the product principle is "don't lose evidence," not "narrate every schema-level event to the user") but means a user has no way to learn *why* a number might not match their own memory of what they deleted. Legacy-evidence gaps (`UNKNOWN_LEGACY` attribution, introduced by PR6) are **never surfaced to the user at all** — confirmed by code, the concept exists purely server-side with no UI representation, which is correct restraint (ticket explicitly warns against exposing implementation details unnecessarily) but means a legacy-attribution gap is silently invisible rather than explained. **Recommended, smallest viable copy fix:** extend the one existing `limitations` string mechanism to also cover the scheduled-vs-completion-date distinction (§7, G-1) — no new UI surface needed, reusing the exact mechanism that already exists and already renders.

## 17. Performance — INFERRED (query-count analysis only; no empirical measurement performed)

**Not measured empirically this session** — no profiling, no response-time capture, no load test against empty/typical/many-Goals/many-plans accounts was performed; the ticket's instruction not to recommend new infrastructure "without measured need" is honored by recommending none.

**Code-derived facts (INFERRED):** `/api/insights/reporting` makes 7 DB round-trips, with Goal/GoalActivity data batched in exactly 2 queries regardless of Goal count (no N+1 across Goals, confirmed by code). `computeImprovementSuggestions` adds 3–11 more queries depending on day-of-week (driven by how many weekdays remain, not by Goal count or plan count) — also no N+1 pattern. The client fetches `goalReporting` and `assistantInsight` via a single `Promise.all` of 4 parallel requests on mount, not polled, not re-fetched on tab switch (§13, C). No caching layer exists; none is recommended, since no measured bottleneck exists to justify one.

## 18. Accessibility / Mobile — VERIFIED (partial) / UNTESTED (partial)

- **Keyboard navigation — VERIFIED:** Tab-key traversal reaches the Aura Suggests "Dismiss" button with a clearly visible focus ring (confirmed by live screenshot after 8 Tab presses) — no suppressed outline on Insights' own interactive elements (confirmed by code: `TextButton` sets no `outline: none`; that property exists only on unrelated text-input fields elsewhere in `ui.tsx`, not used by Insights).
- **Button labels — VERIFIED:** `TextButton`'s dismiss controls carry an explicit `aria-label="Dismiss this suggestion"` (confirmed by code and present in the accessibility tree at runtime).
- **Screen-reader semantics, full color-contrast measurement — UNTESTED** this session (no screen reader was run; contrast was not measured with a tool, only eyeballed — the dark theme's text-to-background pairings appeared legible in every screenshot captured, but this is not a substitute for measurement).
- **Small-screen layout (375px) — VERIFIED:** no horizontal scroll, no clipped text, cards stack correctly, bottom nav remains usable, across all three test accounts.
- **Touch targets — VERIFIED qualitatively, not measured in px:** "Dismiss"/"Review plans"/segmented-control tabs all appeared comfortably tappable in screenshots; not measured against a 44×44px minimum.
- **Long text wrapping — VERIFIED, one minor issue (§4):** the REPEATED_RESCHEDULING secondary suggestion line wraps to 3 lines on mobile with its CTA controls sitting slightly awkwardly beside the wrapped text — not broken, not clipped, just visually tight (P3).
- **Empty and error states at 375px — VERIFIED:** the brand-new account's empty-state cards were also checked at mobile width; all rendered correctly, no clipping.

## 19. Release Acceptance Scenario Matrix

| # | Scenario | Expected | Observed | Verdict | Evidence |
|---|---|---|---|---|---|
| 1 | Brand-new account | Honest empty states, no fabricated zeros | Confirmed — every card shows a real empty state | **PASS** | §5, live screenshots |
| 2 | First completed activity | Shown immediately, no evidence-gate blocking facts | "1 confirmed completed" shown instantly, ungated | **PASS** | §6, live (account E) |
| 3 | First Goal | Goal appears in "Goals This Week" | "Morning Meditation" appeared correctly; weekly rhythm completed-count could not be independently verified live (seed-script limitation, §20) | **PARTIAL** | Live for presence; UNTESTED for weekly-count accuracy |
| 4 | First missed confirmation | AWAITING_CONFIRMATION fires, non-judgmental copy | Fired correctly on 2 accounts, copy as documented | **PASS** | §10, live |
| 5 | Repeated rescheduling | REPEATED_RESCHEDULING fires; consistent with Planning Patterns | Signal fired correctly; **but contradicted** "Planning Patterns: 0 rescheduled" for the same evidence | **FAIL** (internal consistency) | §9, F-3, live |
| 6 | Current overload | PLANNING_OVERLOAD fires under utilization > 1 | Not constructed this session | **UNTESTED** | Code-verified only (§10) |
| 7 | Weekly Goal opportunity | WEEKLY_GOAL_OPPORTUNITY fires with feasible slot | Did not fire for seeded account (no availability config) | **UNTESTED** | Code-verified only (§10) |
| 8 | Goal target reached | No "needs more work" framing when met/exceeded | Not independently pushed to target live; code confirms no mislabeling | **UNTESTED (live)** / INFERRED pass | §7 |
| 9 | Deleted non-Goal completion | Still counted in confirmedCompleted | Confirmed — seeded deletion included correctly in the live "10" total | **PASS** | §7, live + prior DB suite (28/28) |
| 10 | Deleted Goal-linked completion | Never double-counted | Confirmed at DB level (prior suite scenario 6); UI-level aggregate consistent | **PASS** | §7, DB suite + live aggregate |
| 11 | Multiple Goals | All listed, correctly typed (rhythm/finite) | 3 Goals rendered correctly, correct rhythm/finite split | **PASS** | §6, §8, live |
| 12 | Timezone change | Correct attribution for non-UTC/non-IST user | Not exercised live this session (prior DB suite covers LA user server-side) | **UNTESTED (live)** | Prior suite only |
| 13 | Cross-week Move | Correct snapshot after Move | Prior DB suite confirms (scenario 12); not independently re-verified at UI level this session | **UNTESTED (live)** / INFERRED pass | Prior suite only |
| 14 | Historical legacy unknown | Never silently treated as NON_GOAL | Prior DB suite confirms (scenarios 17–18); no legacy rows exist in this fresh DB to re-verify live | **UNTESTED (live)** / INFERRED pass | Prior suite only |
| 15 | No suggestions eligible | Section renders nothing | Confirmed on brand-new account | **PASS** | §10, live |
| 16 | Dismiss suggestion | Card disappears immediately | Confirmed | **PASS** | §10, live |
| 17 | Reload after dismissal | Suggestion reappears (documented session-local-only behavior) | Confirmed — also surfaced the loading-race finding (§13→this doc's §C below) | **PASS** (by design) | §10, live |
| 18 | Mobile navigation | Usable at 375px, no horizontal scroll | Confirmed across 3 accounts | **PASS** | §4, §18, live |
| 19 | Reporting API failure | Graceful degradation | Not forced live; code confirms failure is swallowed silently (console.error only, no user-visible error state) | **UNTESTED (live)** / INFERRED — degrades silently, not gracefully explained to the user | §C below, code |
| 20 | Slow loading | Some indication content is still arriving | **No loading indicator exists anywhere in this flow** — confirmed live, reproduced twice: the entire PR4/5/6 block (5 cards) is simply absent for 1–3 seconds after every fresh navigation to the Insights tab, then pops in with no transition or skeleton | **FAIL** | Live, reproduced 2× independently |

**Do not mark untested scenarios as passing** — six rows above are explicitly UNTESTED at the live-UI level (6, 7, 8-live, 12-live, 13-live, 14-live, 19-live) despite favorable code-level inference; they are reported as such, not as passes.

## 20. Testing-Methodology Disclosure (required for honest interpretation of §19)

The two disposable seed accounts in this audit were built using the application's real production write functions (`createPlannedActivity`, `logPlannedActivity`, `movePlannedActivity`, `skipPlannedActivity`, `createGoalWithActivities`, `upsertDailyReflection`, `createHabitLog`) with one exception: linking a `PlannedActivity` to a `GoalActivity` was done via a direct `UPDATE "GoalActivity" SET "plannedActivityId"` (matching the established precedent in the PR6 real-DB test suite itself), which bypasses the Day-Constructor-acceptance pipeline that creates `GoalActivityOccurrence` rows. As a direct, confirmed consequence, "Goals This Week"'s own weekly completed/remaining counts always showed 0-completed for the seeded accounts regardless of how many real completions existed (verified by direct DB inspection: zero `GoalActivityOccurrence` rows existed for either seeded account). **This is a self-identified fixture limitation, not a product defect** — it does not affect the validity of any other finding in this document (in particular, F-1's "4 Goal activities done" figure is computed from `GoalActivityExecution`, a different table, unaffected by this gap, and was cross-checked arithmetically against the seeded ground truth). The correctness of weekly-rhythm-progress counting itself rests on code inspection only for this audit (§8) and is marked accordingly.

## 21. Prioritized Findings

**P0 (data corruption, privacy, severe integrity):** none found.

**P1 (incorrect user-facing facts, broken core actions, or major trust issue):**

1. **F-1 — "Confirmed Progress" shows two numbers in incompatible units with no disambiguation.**
   - *Reproduction:* seed an account with a rhythm Goal activity completed 5× and a finite Goal with 2/5 slots done; also complete 2 non-Goal/other-Goal activities. Open Insights → Overview.
   - *Evidence:* live screenshot showed "10 confirmed completed" / "4 Goal activities done" for ground truth of 9 Goal-linked completion events + 1 deleted non-Goal completion.
   - *User impact:* a user with substantial, real Goal engagement sees a number ("4") that undercounts their actual completions by more than half, directly beside a larger number that looks like it should be comparable.
   - *Root cause:* "Goal activities done" counts distinct `GoalActivity` rows reaching `COMPLETED` derivedState, not completion events; rhythm activities structurally cap this at 1 regardless of repeat frequency.
   - *Proposed correction:* either relabel "Goal activities done" to make the unit explicit (e.g., "Goal activities with progress"), or replace it with a same-unit figure (total Goal-linked completion events), or add one clause of copy distinguishing the two. No schema change required.
   - *Smallest viable scope:* a copy/label change plus (if the relabel-to-same-unit path is chosen) one new aggregate computed from already-fetched data — no new query, no migration.
   - *Release-blocking:* not release-blocking in isolation, but material to Section G's own explicit question ("Could users mistake... reporting for...?") — yes, confirmed they could.

2. **F-3 — "Planning Patterns: rescheduled" can contradict a live "Aura Suggests" message for the same evidence.**
   - *Reproduction:* create a plan, Move it twice (future-dated terminal), reload Insights.
   - *Evidence:* live screenshot showing simultaneous "0 rescheduled" and "This activity has been moved a few times."
   - *User impact:* directly undermines trust in both numbers — a user who notices the contradiction has no way to know which card is "right" (both are, for different definitions of "reschedule" — the UI doesn't say so).
   - *Root cause:* `listPlannedActivitiesForReporting`'s `plannedStartAt BETWEEN [now-30d, now]` filter excludes any Move chain whose current terminal is scheduled in the future, which is the normal case for a live, actionable rescheduling signal; the signal-computation path has no such filter.
   - *Proposed correction:* either widen "Planning Patterns"'s rescheduled count to include live MOVED plans regardless of the terminal's scheduled date, or add a footnote clarifying the two counts use different windows. The former is more honest and likely smaller in scope (reuse of existing Move-lineage data already loaded for the signal check).
   - *Smallest viable scope:* a query/filter change in one existing function, no schema change.
   - *Release-blocking:* this is the strongest candidate for release-blocking in this audit, since it is a direct, reproducible self-contradiction on one screen.

3. **F-4 — "Review plans" / "Review today's plan" CTA does not open the relevant plan.**
   - *Reproduction:* trigger AWAITING_CONFIRMATION or PLANNING_OVERLOAD, click its CTA.
   - *Evidence:* live screenshot showing the destination is the generic "Plan with Aura → Find a Time" (new-activity) screen.
   - *User impact:* the suggestion says "some past plans don't have a recorded outcome" and offers a button labeled to resolve exactly that — the button does not do so; finding the actual plan takes 2 more manual steps with no visual aid.
   - *Root cause:* `onOpenPlanReview={() => setActiveTab('plan')}` — a bare tab switch, no plan-id or filter threaded through.
   - *Proposed correction:* thread the relevant plan id (or at minimum a "show overdue only" filter) into the Plan tab's own existing props (`initialActivity`/`initialActivityKey`, already present on `PlanWithAuraView` per the page-wiring trace, just unused by this call site).
   - *Smallest viable scope:* wire one existing, already-supported prop through one existing callback — no new screen, no new API.
   - *Release-blocking:* borderline; defensible to ship V1 without this (the destination is not a dead end, just an extra-click detour), but it directly weakens Section J's "actionable, not merely descriptive" requirement.

**P2 (significant usability or comprehension problem):**

4. **G-1 — "confirmed completed" is scheduled-date-attributed with zero disambiguating copy**, and the one `limitations` mechanism that could carry it never does (§7).
5. **M-1 — no visible date range anywhere in the UI**, despite three different, silently-conflicting date-attribution rules across adjacent cards (§6 F-2, §13).
6. **F-5 — tonal/rigor inconsistency between old (Patterns/Trends tabs) and new (PR4-6) copy**, specifically unhedged "optimal Vedic energy windows" language beside carefully-hedged evidence-gated language (§11).
7. **D-4 — "Window Session Frequency" (Trends tab) has no empty-state message**, inconsistent with its Overview-tab twin "Window Distribution," which does (§5).
8. **No error handling around `computeImprovementSuggestions`** — confirmed by code (zero `try/catch` in `route.ts`), any exception there fails the *entire* `/api/insights/reporting` response, not just the suggestions, taking down Confirmed Progress/Goals This Week/Planning Patterns/Awaiting Confirmation along with it. Not reproduced live (would require forcing an internal exception), but a clear, code-confirmed blast-radius risk for a feature area (PR5) that is new and has had at least one real bug found and fixed in this same program window (the PR5 final-review corrections mentioned in this session's own history).

**P3 (polish / optional):** D-1/D-2 (empty states are directional, not clickable), D-3 (streak-zero tone), tablet breakpoint not using its extra width, mobile secondary-suggestion line wrapping tightness, AWAITING_CONFIRMATION mild repetition between Aura Suggests and its own detail card.

## 22. Release Recommendation

**Option B — one focused PR7 for the verified UX/correctness issues — is recommended.** The three P1s (§21) are all narrowly scoped (a label/copy change, a query-filter widening, and a prop threaded through an existing callback) and do not require a new persistence model, new signal, or redesign; nothing found in this audit contradicts the "no unnecessary complexity" product principle or implies the PR1–PR6 foundation itself is unsound — on the contrary, every data-layer claim independently checked this session (deleted-completion fallback, dedup, cross-user isolation, idempotency) held. Option A (ship as-is) is not recommended because F-3 is a direct, reproducible self-contradiction on the primary Insights screen — a core trust problem the ticket itself explicitly asked this audit to catch. Option C (multiple scoped PRs) is not recommended because the findings are concentrated, not systemic — they fit naturally in one PR. Option D (hold for foundational change) is not supported by any evidence found here.

**Scope for a proposed PR7, drawn directly from §21 and nothing broader:**
1. Fix F-3 (Planning Patterns vs. Aura Suggests reschedule-count contradiction) — highest priority.
2. Fix or relabel F-1 (Confirmed Progress's two incompatible numbers).
3. Add a minimal loading indicator for the PR4/5/6 reporting block (§19 scenario 20 — currently a hard FAIL, reproduced twice).
4. Thread plan context through F-4's `OPEN_PLAN_REVIEW` CTA (time-permitting; smallest of the three P1s in impact).
5. Time-permitting P2s: extend the `limitations` string to cover scheduled-vs-completion-date and the active date range (§7 G-1, §13 M-1); fix the Trends-tab empty-state gap (D-4).

## 23. PR7 Necessity Decision

**PR7 is necessary.** Direct answers to Section U's ten questions:

1. Is Insights V1 genuinely useful? **Yes, for the majority of its surface** — the underlying evidence is real, honestly gated, and the suggestions are genuinely actionable for 3 of 4 signals.
2. Understandable in 10 seconds? **Partially** — the header and first card are clear; the Confirmed Progress card's two numbers are not (F-1).
3. Are the metrics trustworthy? **Mostly, with one confirmed exception** (F-3's direct contradiction).
4. Are the suggestions actionable? **3 of 4 fully; 3 of 4 CTA destinations are weakened by F-4.**
5. Is the UI too dense? **Moderate, not excessive** — 9-11 cards on a populated Overview tab, no collapsibility, but no evidence this blocks comprehension on its own.
6. Does it duplicate Home or Goals? **No duplication of write capability; some information overlap with Goal Detail (intentional, low-cost) and within itself (This Month vs. Confirmed Progress, F-2, higher-cost).**
7. Are traditional timing and behavioral evidence clearly distinguished? **Mostly — PR4-6's own language is careful; the older Patterns-tab copy (F-5) is the one place this blurs, and it predates this program's own scope.**
8. Are any P0/P1 issues present? **No P0. Three P1s, detailed in §21.**
9. What must change before release? **At minimum, F-3 (the direct self-contradiction) and the missing loading state (§19 scenario 20); F-1 and F-4 are strongly recommended alongside them.**
10. Is PR7 necessary? **Yes — scoped narrowly per §22, not a sign the PR1-6 foundation needs rework.**

## STOP Conditions

- **STOP AFTER AUDIT.** No implementation was performed.
- **No PR was opened.**
- **No migration was created or applied** (migration count confirmed unchanged at 49, both before and after this audit).
- **PR7 was not started.** This document is a recommendation only; it does not authorize work to begin.

---

**FINAL VERDICT:**

**AURA — INSIGHTS V1 — PR7 REQUIRED — three confirmed trust/comprehension defects (F-1, F-3, F-4) plus a missing loading state for the reporting block; all are narrowly scoped fixes to existing code, not evidence the PR1-6 architecture or data layer is unsound.**
