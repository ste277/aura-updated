# Aura — 7-Day Pilot Feedback Template

One copy per participant. Fill in only what the participant actually said or did. **Leave a field blank rather than guessing.** Use the participant's own words in quotes wherever you can.

**Participant ID:** P__ (don't write the name here)  **Start date:** ____  **Device:** iPhone / Android, browser ____
**City:** ____  **Familiar with Panchangam?** None / Some / Strong  **Work pattern:** ____
**Consent to link in-app usage counts to this feedback:** Yes / No

---

## Part A — First-use observation (day 0, optional, ~10 min)

Note the time from first opening the link to each milestone. Write "—" for a milestone they didn't reach.

| Milestone | Clock time (mm:ss) | Notes (hesitation, comments, wrong taps) |
|---|---|---|
| Opened the link | 00:00 | |
| Said in their own words what Aura is for | | |
| Chose an activity | | |
| Saw their first recommended time | | |
| Decided to create an account, or not (and why) | | |
| Received and entered the sign-in code | | |
| Reached Home | | |
| First action on their own (what was it?) | | |

The first thing they said Aura was for (quote): "______________________"

Moments of confusion, frustration or delight (quote, plus the screen it happened on):
1.
2.
3.

---

## Part B — Evening check-in (days 1–6, ~2 min)

| Day | Did you open Aura today? (Y/N) | What did you use it for? | Did a suggested time change what you did? (Yes / Partly / No / Didn't see one) | One word for how it felt to use |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |

Free comment, any day (optional):

---

## Part C — End-of-week survey (day 7, ~5 min)

Use a scale of 1 = strongly disagree to 5 = strongly agree.

| # | Statement | 1–5 |
|---|---|---|
| C1 | I quickly understood what Aura could help me with. | |
| C2 | Aura made planning my week easier. | |
| C3 | Aura saved me time compared with how I normally plan. | |
| C4 | The recommended times were realistic for my schedule. | |
| C5 | The recommended times influenced when I actually did things. | |
| C6 | I understood why Aura recommended a particular time. | |
| C7 | The Panchangam information was meaningful to me. | |
| C8 | Setting up a routine (for example, exercise 3× a week) was easy. | |
| C9 | The Home screen made it clear what to do next. | |
| C10 | Aura was easy to use on my phone. | |

- **C11.** How likely are you to keep using Aura next week? (0–10) ____
- **C12.** How would you feel if you could no longer use Aura? Very disappointed / Somewhat disappointed / Not disappointed
- **C13.** On a typical day this week, roughly how many minutes did you spend planning *with* Aura? ____ How does that compare with your usual planning? More / Same / Less

---

## Part D — Closing interview (day 7, 20–30 min)

Ask the questions as written, then follow up with "Tell me more" or "Can you show me?" Don't explain or defend the product during the interview.

1. **Before you started**, what did you think Aura would help you with? After a week, what do you think it's for?
2. **Did it make planning easier?** Walk me through one plan you made with Aura, from start to finish.
3. **Did the recommended timings influence your decisions?** Can you remember a time you followed one? A time you ignored one, and why?
4. **What confused or frustrated you?** Was there a moment you nearly gave up? *(Ask them to show it on their phone if they can.)*
5. **What made you come back, or not come back?** What were you doing when you opened it?
6. **What would make Aura part of your everyday life?**
7. Which words or labels didn't make sense to you? *(Prompt only if needed: Rahu Kalam, Abhijit, Tithi, Nakshatra, My Rhythm, Daily Rhythm, Aura Fit, Alignment.)*
8. If you could change one thing, what would it be?
9. *(Ask only if the alignment insight wasn't fixed before the pilot.)* Did you notice the line about how your check-ins score on days you followed favorable windows? What did you make of it? Did it change how much you trusted Aura's suggestions?
10. Did you expect Aura to remind you about plans when the app was closed? Did the lack of reminders affect whether you came back?
11. Did you set your work hours (You → Daily Rhythm)? If so, did the suggested times feel more realistic afterwards?

**Top 3 quotes:**
1.
2.
3.

---

## Part E — Usage counts (owner, after day 7, only with the participant's consent)

Use existing Production records only, and record **counts and timestamps, not content**. Leave a field blank if it can't be measured. See the gaps in §6 of the validation report.

| Measure | Value | Source |
|---|---|---|
| Account created (date/time) | | `User.createdAt` |
| Returns are self-initiated (no push reminders exist on Production web) | n/a | Report §5.3 |
| Active days in days 1–7 (list) | | `VisitLog` (one row per day per user) |
| Returned on day 1 / day 3 / day 7 (Y/N each) | | `VisitLog` |
| Plans created | | `PlannedActivity` count |
| Plans logged as done / skipped / cancelled / moved | | `PlannedActivity.status` |
| Goals / weekly-rhythm activities created | | `Goal`, `GoalActivity` counts |
| Evening check-ins | | `DailyReflection` count |
| First meaningful action after sign-up (event + minutes after sign-up) | | `ProductEvent` (first non-view event) |
| Work hours configured? (Y/N, and on which day) | | `User.dailyRhythmWorkStart` / `WorkEnd` non-null (a setting, not content) |
| Availability configured? (Y/N) | | `UserAvailabilityPeriod` row count > 0 |
| Saw an alignment figure? (Y/N; only if PV-F04 wasn't fixed) | | Interview D9 (no query) |

Notes:
- `VisitLog` days follow the database date, which is probably UTC, so the day boundary is 05:30 IST. Convert to the participant's local day before scoring D1/D3/D7.
- `/api/internal/product-metrics` isn't usable on Production (its secret isn't set). Any query needs the owner's own database access, plus approval to analyse per-participant records.
- **Guide version used:** with or without the work-hours tip: ____

---

## Part F — Finding log (one row per distinct issue)

| ID | Participant(s) | Journey | What happened (observed) | Participant quote | Severity (P0–P3) | Matches a report finding? (e.g. PV-F03) |
|---|---|---|---|---|---|---|
| | | | | | | |

**Severity guide.** P0: stopped them experiencing core value. P1: a significant barrier to using or adopting Aura. P2: a meaningful improvement. P3: a minor refinement.
