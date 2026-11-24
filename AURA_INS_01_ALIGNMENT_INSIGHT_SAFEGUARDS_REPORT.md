# AURA-INS-01 — Alignment Insight Safeguards

**Date:** 2026-11-24 · **Baseline:** `main` at `25b09c8` · **Production:** REL-04 `ac46fc3`, unchanged · **Finding:** PV-F04

**Status: PV-F04 RESOLVED in code; verified locally; PR open for review, not merged; ready for inclusion in REL-05 once merged.**

## 1. What changed

| Area | Before | After |
|---|---|---|
| **Home** (Daily Reflection) | Showed the comparison, for example "Your check-ins score 15 points lower on days when you followed favorable windows." | The comparison is removed. Home shows a plain line, "Your check-ins help you notice patterns in how your days feel over time.", plus **View insights**. The Low/Balanced/Strong check-in is unchanged. |
| **Insights** card | "Your Alignment", a large "−15 pts" headline and the same sentence. It appeared from **3 check-ins** with at least 1 in each group. | "Your check-in patterns". It appears only with **≥30 qualifying days and ≥10 in each group**. It shows a neutral sentence, the sample size for each group, a non-causal caveat and a collapsible **How it's calculated**. There's no headline number. |
| Below the thresholds | "Log a few evening check-ins…" | "Keep checking in to explore patterns in your daily experience. There aren't enough observations for a meaningful comparison yet." plus "N of 30 check-in days so far (A following favorable windows, B other). At least 10 of each are needed." |
| Calculation | Inline in `route.ts` | A pure module, `lib/insightsAlignment.ts`, which the route calls |

**Example wording when there is enough data:** "In your check-ins, days you followed favorable windows averaged about 50 points higher than other days." · "Based on 16 days following favorable windows and 16 other days." · "This describes what you've recorded, not a cause and effect. Many things shape how a day feels."

## 2. Methodology: unchanged vs new

**Unchanged** (no silent change to scoring or to which days qualify):
- **Mood score:** Strong (`PEAK_FLOW`) = 1, Balanced (`MODERATE`) = 0.5, Low = 0.
- **"Followed favorable windows":** the check-in's own `followedGuidance` is true, **or** that day's logged activities include more supportive than friction windows. This still uses the shared `classifyInsightsWindow` grouping, so Gulika and Neutral count for neither side.
- **Difference:** the mean on followed days minus the mean on other days, × 100, in percentage points.
- **Data window:** the last 60 check-ins, plus activity logs from the last 400 days. *Correction to PV-01 §5.5, which said 400 days for check-ins: the check-in window is the last 60 check-ins.*

**New safeguards:**

| Safeguard | Rule |
|---|---|
| Display thresholds | **≥30 qualifying days overall and ≥10 in each group.** The same rule applies whatever the direction of the result. These are minimum display thresholds, **not** statistical significance, and no significance claim is made. |
| Valid mood only | A check-in counts only if its mood is LOW, MODERATE or PEAK_FLOW. An unknown or missing value is excluded; before, it silently scored as Low. |
| One per day | Days are de-duplicated; the first row is kept. The database already enforces one check-in per user per day, so this is defensive. |
| Empty or small groups | Group means are computed only after eligibility, so there is never a zero or near-zero denominator. |
| Precision | The displayed difference is rounded to the **nearest 5 points**. A difference that rounds to 0 is shown as "about the same". |
| Wording | Results describe the user's own recordings, and a caveat is always shown. Tests reject causal or evaluative words ("because", "caused", "leads to", "improve", "better", "worse", "Panchang", "%"). |

**API compatibility:** `GET /api/daily-assistant/insights` keeps every existing field.
- `alignmentDeltaPoints` is now the rounded difference, or `null` below the thresholds.
- `insightText` is the new neutral sentence.
- `alignedDays` and `unalignedDays` now count qualifying days.
- A new `alignment` object carries the status, group sizes, thresholds, summary, sample, method and caveat.

**Existing historical data:** the module recomputes on each request, so no data changes or migration are needed. Users with history see their real result once they meet the thresholds. Below them, they see the neutral state; the owner's 31 check-ins (17/14) are above them.

## 3. Files changed

| File | Change |
|---|---|
| `apps/web/lib/insightsAlignment.ts` | **New.** Pure calculation, thresholds, rounding, neutral copy |
| `apps/web/app/api/daily-assistant/insights/route.ts` | Uses the module; adds the `alignment` field |
| `apps/web/components/HomeDashboard.tsx`, `apps/web/app/page.tsx` | Home no longer receives or shows the comparison |
| `apps/web/components/InsightsView.tsx` | Neutral card with sample sizes, caveat and method; no headline number; the Aura Fit footnote now refers to "your check-in patterns above" |
| `test/insightsAlignmentSafeguards.test.ts` | **New**, wired into CI. 34 checks |
| `test/insightsAlignmentComparison.test.ts`, `test/insightsEvidenceIntegrity.test.ts`, `test/insightsAuraFit.test.ts` | Not in CI. Source checks that pinned the old inline code were re-pointed to the same invariants in the module (§5) |
| `.github/workflows/ci.yml` | Adds the new suite |
| `AURA_INS_01_SCREENSHOTS/` | Mobile and desktop QA screenshots |

**Not changed:**
- scheduling and recommendation code, Panchangam ranking, check-in behaviour;
- the database schema and migrations;
- tracking and data collection;
- Production.

## 4. Automated tests

| Suite | Result |
|---|---|
| `insightsAlignmentSafeguards` (new, in CI) | **34/34** |
| Negative control: the per-group minimum removed from the eligibility rule | E4, E5 and E8 **fail**, as expected; restored afterwards |
| `insightsAlignmentComparison` (updated, not in CI) | 25/25 |
| `insightsAuraFit` (updated, not in CI) | 68/68 |
| `insightsEvidenceIntegrity` (updated, not in CI) | 93/94. The 1 failure (`sevenDayAlignmentScore`) is **pre-existing**: it fails identically on clean `main` and is unrelated |
| Related CI regression set, each step run with its own CI env (Home, Insights, reflection, daily briefing and guidance, My Day, dashboard, Right Now, goals, rhythm, Panchang, timing search; includes database suites on a fresh Postgres 16) | **101/101** |
| `tsc --noEmit` | Pass |
| Next.js production build (CI placeholder env) | Pass |

**Coverage:**
- **Boundaries:** 29/30 days overall, 9/10 per group, and an empty group.
- **Results:** positive, negative and neutral; rounding, with no "−0"; unequal groups (10 vs 40).
- **Data handling:** invalid moods, duplicate days, the unchanged log-based "followed" rule, purity.
- **Wording:** neutral copy, the exact insufficient-data text.
- **Structure:** Home no longer shows the comparison, the check-in buttons are intact, no migration.

## 5. Updated legacy tests (not in CI)

Three older suites that are not run in CI asserted the *source text* of the old inline route code. They were re-pointed to the **same invariants**, now in the module:
- a single rounding formula;
- both groups required, and never a one-sided number;
- no division by an empty group;
- an unchanged signed percentage-point difference;
- the unchanged OR-based "followed" inference;
- the response field still named `alignmentDeltaPoints`;
- the Insights insufficient-data branch.

No behavioural assertion was removed. The old 3-check-in gate assertion was replaced by the stricter 30/10/10 rule, which is the intended change.

## 6. Browser QA

Local `next dev`, a disposable database (`ins01_qa`) and five disposable `@e2e.aura.local` users with seeded check-ins. Mobile is 375 px; desktop is 1280 px. Production was not touched.

| Scenario | Data | Result | Evidence |
|---|---|---|---|
| New user, no observations | 0 | Neutral message, "0 of 30 check-in days so far…", no number | `07_insights_new_user_no_observations.jpg` |
| Below threshold | 20 days (12/8) | Neutral message, "20 of 30… At least 10 of each are needed.", no number | `06_insights_below_threshold_20_days.jpg` |
| Positive | 32 (16 Strong followed / 16 Balanced other) | "about 50 points higher", "Based on 16 … and 16 other days", caveat | `02_insights_positive_16_16.jpg` |
| Negative | 32 (16 Low / 16 Balanced) | "about 50 points lower", the same neutral framing | `04_insights_negative_16_16.jpg` |
| Neutral | 32 (Balanced / Balanced) | "felt about the same on average" | `05_insights_neutral_16_16.jpg` |
| How it's calculated | — | Expands to the method text | `03_insights_how_calculated_expanded.jpg` |
| Home without the comparison | Positive user (would be +50) | No comparison or number on Home; neutral line plus View insights; Low/Balanced/Strong present | `01_home_no_comparison_positive_user.jpg` |
| Check-in still works | New user | Tapping Balanced → `POST /api/daily-assistant/reflection` 200; row saved; Insights then shows "1 of 30" | DB query |
| Mobile and desktop layout | — | No horizontal overflow at 375 or 1280 px | Measured |

The API responses for all five users matched the expected status, group sizes, difference and direction.

## 7. PV-F04 disposition

**PV-F04: RESOLVED in code and VERIFIED locally. PR open, not merged.**
- The comparison no longer appears on Home.
- In Insights it appears only past conservative display thresholds, with sample sizes, method and a non-causal caveat.
- It reaches users after the PR is merged and included in a separately authorized release (target: REL-05).

**Remaining notes:**
- The thresholds are display safeguards only. With 30–60 check-ins, differences can still reflect chance; the caveat says so in plain terms. No significance test was added, because none has been validated for this data.
- The data model still can't distinguish "explicitly answered no" from "didn't answer" for `followedGuidance`, a pre-existing decision recorded in `insightsEvidenceIntegrity`. This is unchanged here.

## 8. PR and CI

- **PR:** the single PR for branch `feature/aura-ins-01-alignment-safeguards` (link in the PR description and session summary).
- **CI:** see the PR checks.
- Auto-fix and auto-merge are disabled. Not merged; no deploy; Production stays on REL-04.
