# AURA-MP-01 — My People: Product Design and Architecture

| | |
|---|---|
| Date | 2026-11-26 |
| Baseline | `main` @ `3feff03` (worktree `docs/aura-mp-01-my-people-design`) |
| Type | Design and architecture only. No code, migrations, dependencies, deploys or Production access |
| Status | **FINAL.** D1–D10 approved 2026-11-26, with refinements R1–R3 (§9). MP-1 was implemented 2026-11-27 (migration **0056**, since 0055 is reserved for AUTH-SESSION-01) and is awaiting independent verification. Merge and deployment need separate approval |
| Ticket | [AURA_MP_1_DATA_AND_API_FOUNDATION_TICKET.md](AURA_MP_1_DATA_AND_API_FOUNDATION_TICKET.md) |
| Priority | Next major product priority after REL-05, ahead of My Ownership. Nothing here touches the REL-05 candidate |

> Guiding principle: *help people spend less time managing their lives and more time living them.*
> For My People that means: remember the few dates that matter, make it effortless to turn "I should see Amma" into a well-timed plan, and never nag.

---

## 0. Executive summary

1. **Aura already has a People feature.** `SavedPerson` (`apps/web/prisma/schema.prisma:148`), `/api/people`, `components/PeopleView.tsx` (reached from **You → People**) and seven consumers: Personal/Shared Muhurtham, everyday shared timing, Aura Moments, Day Builder "make more time for", My Day, Ask Aura and Plan "Who's this with?". Today it is a **chart-input record**: birth date, time and timezone are mandatory.
2. **Recommendation: evolve `SavedPerson` into the My People record, not a new table.** Only the name stays mandatory. Birth chart details become an optional "chart details" section, still used by Shared Muhurtham. Occasions go into a small new child table. Plans and Life Rhythms get an optional link to a person.
3. **Reuse the main Find a Time pipeline**, `/api/timing-search`. It already keeps Panchang at **0.45 of the fit score** (`packages/recommendation/src/auraFitEngine.ts:224`) and applies availability (hard) and Daily Rhythm (soft). A person only pre-fills the activity and date range and links the saved plan. **No compatibility scoring and no relationship predictions.** The existing per-person Shared Muhurtham stays as it is and stays opt-in.
4. **MVP = 3 small PRs** (§8): MP-1 data and API foundation, MP-2 the My People UI and upcoming occasions, MP-3 Person → Plan / Find a Time with a gentle Home card. Relationship Rhythms (recurring) come in MP-4, after a validation read-out.
5. **First ticket: AURA-MP-1** (§10, separate ticket file). It makes birth details optional, adds occasions, notes and interests, makes `PATCH` partial (chart details preserved), adds people to the export, and makes deletion clean-up atomic. Existing flows stay safe with the switch on or off.

---

## 1. Existing architecture findings

### 1.1 What exists and is reusable

| Area | Existing asset (file:line) | Reuse for My People |
|---|---|---|
| Person record | `SavedPerson` (schema:148): `name`, `relationshipType` PARTNER/SPOUSE/FAMILY/FRIEND/OTHER, **required** `birthDate`/`birthTime`/`birthTimezone`; Cascade from User | **Evolve**: becomes the My People record |
| Person CRUD | `lib/db.ts:269-339` (raw SQL, always `WHERE … "ownerUserId" = $2`); validation `lib/savedPersonRequest.ts:24-83` (name ≤80, IANA tz) | Extend. Keep the owner-scoping pattern |
| Person API | `app/api/people/route.ts` (GET/POST), `app/api/people/[personId]/route.ts` (GET+natalContext/PATCH full-replace/DELETE; cross-owner → 404) | Extend. Make PATCH partial |
| Person UI | `components/PeopleView.tsx` (LIST/ADD/DETAIL/EDIT; empty-state copy "Add someone you plan with…"); `RELATIONSHIP_LABEL/ICON` exports | Redesign into My People (§5) |
| Natal context | `lib/savedPersonNatalContext.ts:36` (derived on read, never stored) | Unchanged. Returns `null` when there are no chart details |
| Shared timing | `findEverydaySharedTiming` (`packages/recommendation/src/everydayTimingFit.ts:182`) already treats a missing partner context as neutral (65); `AURA_SHARED_FIT_V1` is explicitly "NOT a compatibility methodology" (`muhurthamFinder.ts:1581`) | Keep as is. It is not on the My People MVP path |
| Find a Time | `app/api/timing-search/route.ts:50` → `runTimingSearchWithDailyRhythm` (`lib/timingSearchDailyRhythm.ts:219`) → `runTimingSearch`; availability and plans as hard constraints (`lib/findATimeConstraints.ts:113`) | **Primary reuse.** Person-scoped search = this route plus pre-fill |
| Ranking | `evaluateActivityFit` (`auraFitEngine.ts:223-231`): muhurta/Panchang ×0.45, solar ×0.20, time-pref/nature/personal-pattern ×0.10, user-pref ×0.05; Rahu/Yama hard-reject for timing-sensitive activities (`dailyAssistant.ts:1087`) | Unchanged |
| Activity catalog | `ACTIVITY_CATALOG` (`personalizedTasks.ts:53`). 20+ `nature:'CONNECT'` entries already: `catch-up`, `coffee-tea`, `visit-family`, `family-dinner`, `birthday-party`, `anniversary-dinner`, `celebration-dinner`, `walk-together`… | Reuse. Add 2 entries: **`call`**, **`video-call`** (MP-3) |
| Plans | `PlannedActivity` (schema:402), `POST /api/plans` (`app/api/plans/route.ts:127`), client `saveUpcomingPlanFromCandidate` (`PlanWithAuraView.tsx:370`). Person today = free-text `sharedWithName` baked into the title | Add nullable `savedPersonId` |
| Life Rhythms | `GoalActivity` rhythm fields (`rhythmKind N_PER_WEEK`, preferred weekdays/time/duration, schema:793-906), `GoalActivityOccurrence`, weekly proposal (`lib/goalRhythmWeeklyProposal.ts:303`), Home `GoalRhythmSuggestionsCard` | Add nullable `savedPersonId` (MP-4). Cadence logic is person-neutral |
| Home | `HomeDashboard.tsx` cards; timeline kinds PLAN/MOMENT/… (`lib/homeTimelineTypes.ts:18`); Day Builder people groups (`lib/dayBuilder.ts:202`) | Add **one** occasion card (MP-3) |
| Reminders | `deriveAuraReminders` (`lib/auraReminders.ts:118`): pure, on read, minutes-before-plan; `ReminderAttention` stores seen state. Prod has no background push (daily cron only) | Occasions are **in-app, derived on read**. No new reminder rows (§4.4) |
| Navigation | One 6-slot bottom dock (`app/page.tsx:2170-2192`): Home, Plan, Explore, Ask Aura, Insights, You. `'people'` is already a tab state with `peopleReturnTo` | No 7th slot. Entry from You, Home and Plan (§5.1) |
| Auth/isolation | HMAC `as_session` cookie, `getSessionFromRequest` (`lib/session.ts:4`), 401 → owner-scoped `db.ts` call | Same pattern |
| Privacy | `lib/productEvents.ts` forbids `name`, `birth*`, lat/long… in metadata (:283-309); `SAVED_PERSON_CREATED` allows only `relationshipType` (:443) | Same rules for new events |
| Gating | Pure gate functions (e.g. `isPalmistryAvailable`, `magicLinksEnabled`); no flag framework | Add `isMyPeopleServerEnabled()` (authoritative) + a presentation-only public flag (§11.5, R1) |
| Tests | Root `test/` with explicit per-file steps in `.github/workflows/ci.yml`; DB tests in `day-constructor-acceptance-db-tests`; `savedPersonDb.test.ts` covers cross-owner isolation | Extend. Every new test file needs its own CI step |

### 1.2 Gaps and debts this design must handle

| # | Finding | Impact | Addressed in |
|---|---|---|---|
| G1 | Birth date, time and timezone are **mandatory** on `SavedPerson`, and the form defaults Relationship to PARTNER | Violates "only name mandatory" and "no exact birth time required" | MP-1 |
| G2 | No birthday/anniversary/occasion, notes or interest fields | Core MP features missing | MP-1 |
| G3 | `/api/people/[id]` PATCH is full-replace | Unsafe once fields are optional (it would wipe chart details) | MP-1 |
| G4 | Deleting a person leaves the id in `User.dayBuilderPriorityPersonIds` (TEXT[], no FK) and `DayBuilderDismissal.personId` | Dangling references, minor data-minimisation gap | MP-1 |
| G5 | `/api/users/export` omits SavedPerson | Ownership/portability gap | MP-1 |
| G6 | `/api/timing-search/shared` applies **no** availability or Daily Rhythm constraints | Must not be the Person → Find a Time path | MP-3 uses the main route |
| G7 | Shared plans copy the person's name into `PlannedActivity.title`, and Aura Moments copy it into `sharedPersonDisplayName` | Deleting a person does not scrub historical titles | Documented. Owner decision D6 |
| G8 | No account-deletion endpoint (Cascade exists in schema only) | Platform-wide, not MP-specific | Out of scope. Noted |
| G9 | No CSRF/origin check (relies on SameSite=lax + JSON) | Platform-wide | Out of scope. New routes follow the existing pattern |

---

## 2. Recommended MVP scope

**In MVP (MP-1 → MP-3)**

- A private list of people. **Name required.** Everything else is optional: relationship, a short custom label ("Amma", "Best friend"), birthday (day + month, year optional), anniversary, other important dates, a location label and timezone, interests (a few tags), and a private note.
- Upcoming occasions: a 30-day list in My People, plus **one** Home card when an occasion is ≤ 7 days away (configurable per occasion, can be turned off).
- Person → **Plan**: "Plan time with Ravi" → pick Call / Coffee / Visit / Dinner (catalog CONNECT activities) → main Find a Time, Panchang-ranked, availability-constrained → saved plan linked to the person.
- Occasion → **Prepare**: "Ravi's birthday is Sat 5 Dec" → `Plan a celebration` (Find a Time pinned to that date or the weekend around it) or `Plan a call on the day` (fixed date, best window that day).
- Person detail shows **upcoming plans with them** and **recent time together** (completed linked plans). This is factual, with no score and no streak.
- Existing chart details and Shared Muhurtham keep working unchanged for people who have chart details.

**MP-4 (after validation)**: Relationship Rhythms. "Call Amma every week" as a Life Rhythm linked to a person, using the existing weekly proposal and occasion machinery.

**Explicitly not in MVP**: contact import, phone/email/address fields, photos, messaging, external notifications, invitations, sharing, groups, multi-person plans, "last contacted" nags, relationship health scores, astrological compatibility, gift lists or shopping.

> **Anti-contact-manager guardrails:** no phone, email or address fields. No import. No alphabetical A–Z index. The list is ordered by *what's coming up* and capped softly (prompt shown after 50 people: "My People works best for the people who matter most").

---

## 3. Data model (proposed, not migrated)

### 3.1 `SavedPerson` (evolved, same table, additive and nullable)

```prisma
model SavedPerson {
  id               String   @id @default(uuid())
  ownerUserId      String
  owner            User     @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)

  name             String                  // REQUIRED, trimmed, 1–80
  relationshipType String   @default("OTHER") // existing enum-as-string; add PARENT, CHILD, SIBLING (D2)
  relationshipLabel String?                // NEW, ≤40, free text ("Amma", "Mentor")

  // Chart details: NOW OPTIONAL, all-or-none trio (DB CHECK constraint)
  birthDate        DateTime? @db.Timestamptz(3)
  birthTime        String?
  birthTimezone    String?
  birthCityName    String?
  birthLatitude    Float?
  birthLongitude   Float?

  locationName     String?                 // NEW, ≤80, label only, no coordinates
  timezone         String?                 // NEW, IANA, for "it's 9pm for them" hints only
  interests        String[] @default([])   // NEW, ≤10 tags × ≤40 chars
  notes            String?                 // NEW, ≤1000 chars, private, never logged/exported to events

  createdAt        DateTime @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime @updatedAt @db.Timestamptz(3)

  occasions        PersonOccasion[]
  auraMoments      AuraMoment[]
  plannedActivities PlannedActivity[]       // via new FK
  @@index([ownerUserId])
}
```

Migration shape for MP-1 (shipped as `0056_my_people_foundation`):
- `ALTER COLUMN birthDate/birthTime/birthTimezone DROP NOT NULL`, plus `CHECK ((birthDate IS NULL) = (birthTime IS NULL) AND (birthTime IS NULL) = (birthTimezone IS NULL))`.
- `ADD COLUMN` the five new nullable/defaulted columns.
- `CREATE TABLE "PersonOccasion"`. `ADD COLUMN "savedPersonId"` to `PlannedActivity` (FK `ON DELETE SET NULL`, index `("userId", "savedPersonId")`, since `PlannedActivity`'s owner column is `userId`).
- Purely additive and relaxing. Existing rows are untouched and no backfill is needed. Safe for the Neon free tier (no table rewrite for `DROP NOT NULL` or nullable `ADD COLUMN`).

**Why evolve rather than add `Person`:** one identity per human (no "which Ravi?" between People and Muhurtham), seven consumers keep working, `AuraMoment`/Day Builder links stay valid, and the deletion and export work happens once. The cost is a null guard wherever natal context is built. There are 9 read sites across the 7 consumers, listed in §11.1, and the compiler finds every one of them.

### 3.2 `PersonOccasion` (new)

```prisma
model PersonOccasion {
  id              String   @id @default(uuid())
  ownerUserId     String                       // denormalised for owner-scoped SQL, same as every MP query
  savedPersonId   String
  person          SavedPerson @relation(fields: [savedPersonId], references: [id], onDelete: Cascade)

  kind            String                       // "BIRTHDAY" | "ANNIVERSARY" | "OTHER"
  label           String?                      // required when kind = OTHER ("Graduation", "Amma's puja day"), ≤60
  calendar        String   @default("GREGORIAN") // MVP: CHECK allows only GREGORIAN (R3)
  month           Int?                         // 1–12; required by CHECK when calendar = GREGORIAN
  day             Int?                         // 1–31, validated against month (Feb 29 allowed); same CHECK
  year            Int?                         // OPTIONAL; used only for "turns 40" / "10th anniversary" if present
  remindDaysBefore Int?    @default(7)         // null = don't surface ahead; 0 = on the day only; max 30

  createdAt       DateTime @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime @updatedAt @db.Timestamptz(3)

  @@index([ownerUserId])
  @@index([savedPersonId])
  // partial unique: one BIRTHDAY per person (raw SQL, same convention as AuraMoment partial index)
}
```

- **Civil date, no timezone.** An occasion is a calendar day. "Upcoming" is computed in the **user's** `User.timezone`.
- **Feb 29** is observed on Feb 28 in non-leap years (D4).
- **Birthday ≠ chart birth date.** These are deliberately separate. When a user enters chart details, the form offers once to "Also remember their birthday?", which pre-fills an occasion. Nothing syncs silently. This keeps the birthday free of a year and time, and keeps chart details optional (D3).
- **Future calendar types (R3).** Tithi-based and other culturally significant days (a tithi-dated shraddha, a nakshatra birthday, festival-linked family days) stay on the roadmap and are **not implemented**. Three choices keep them open:
  - the `calendar` column exists from day one;
  - `month`/`day` are required by a calendar-specific CHECK rather than `NOT NULL`, so a future TITHI row can carry its own nullable fields (e.g. `lunarMonth`, `paksha`, `tithi`) and widen the CHECK, with no table rewrite;
  - all date maths goes through one `nextOccurrence(occasion, fromLocalDate, tz)` function that branches on `calendar`, so a future branch can call `packages/panchang` and nothing else changes.
  Dismissal keys and the upcoming API already work with the *resolved* occurrence date, which is calendar-neutral.

### 3.3 Link columns

| Table | Column | FK behaviour | PR |
|---|---|---|---|
| `PlannedActivity` | `savedPersonId String?` | `SET NULL` | MP-1 (column), MP-3 (written) |
| `GoalActivity` | `savedPersonId String?` | `SET NULL` | MP-4 |
| `User.dayBuilderPriorityPersonIds` | existing TEXT[] | app-level cleanup on delete | MP-1 |

`AuraMoment.savedPersonId` already exists (SetNull). No change.

### 3.4 Derived, never stored

- Next occurrence of each occasion, days-until and age/years (when a year is given): computed on read (`lib/personOccasions.ts`, a pure function, like `deriveAuraReminders`).
- "Time together" summary = count and last date of completed `PlannedActivity` rows with that `savedPersonId`. A query, not a column. **No score.**

---

## 4. API contracts

All routes: `getSessionFromRequest` → 401. All SQL scoped by `ownerUserId`. Cross-owner or missing id → **404** (never 403, so ids can't be probed). JSON only, using the existing `parseJsonObject`. Gated by the server flag `isMyPeopleServerEnabled()` (`AURA_MY_PEOPLE_ENABLED`, R1 F2) for new behaviour; existing routes stay live for current consumers.

### 4.1 People

```
GET    /api/people
  200 [{ id, name, relationshipType, relationshipLabel, hasChartDetails,
         nextOccasion: { id, kind, label, date: "YYYY-MM-DD", daysUntil } | null }]
  // ordered: soonest nextOccasion first, then name. Never returns notes or birth fields in the list.
  // R1 F5: implemented exactly (no ownerUserId, notes, interests, location, timezone or birth fields).
  // While My People is disabled the list keeps the pre-existing legacy shape for existing consumers.
  // Every /api/people response carries `x-aura-my-people: enabled|disabled` (R1 F2).

POST   /api/people
  body { name, relationshipType?, relationshipLabel?, locationName?, timezone?,
         interests?, notes?, chart?: { birthDate, birthTime, birthTimezone, birthCityName?, birthLatitude?, birthLongitude? } }
  201 PersonDetail
  // MP-1 (R1 F5): `occasions` is NOT accepted on create -> 400. Special days are created only with
  // POST /api/people/:id/occasions (no additional occasion workflow in MP-1).
  // R1 F3: birthDate must be a real calendar date; coordinates optional, but if either is given both must be
  // finite numbers in range (null / '' / strings / NaN rejected, never coerced). All-or-none chart kept.
  // Back-compat: the legacy flat body (birthDate/birthTime/birthTimezone at top level) is still accepted.

GET    /api/people/:personId
  200 PersonDetail = { …all fields, chart|null, occasions[], natalContext|null,
                       upcomingPlans[≤5], recentTogether: { count90d, lastDate|null } }

PATCH  /api/people/:personId     // PARTIAL: absent key = unchanged, null = clear
  body any subset of POST fields; chart: null clears all chart fields together
  200 PersonDetail

DELETE /api/people/:personId
  200 { ok: true }
  // one transaction: delete person (cascades occasions), null PlannedActivity/AuraMoment/GoalActivity links,
  // remove id from User.dayBuilderPriorityPersonIds, delete DayBuilderDismissal rows with that personId.
```

### 4.2 Occasions

```
POST   /api/people/:personId/occasions            body { kind, label?, month, day, year?, remindDaysBefore? }  → 201
PATCH  /api/people/:personId/occasions/:occasionId   partial                                                  → 200
DELETE /api/people/:personId/occasions/:occasionId                                                            → 200
GET    /api/people/occasions/upcoming?days=30      (1–60, default 30)
  200 [{ occasionId, personId, personName, kind, label, date, daysUntil, turning|null, surfaced: boolean }]
```

Validation: `month` 1–12, `day` valid for that month (29 allowed for Feb), `year` between 1900 and the current year, `remindDaysBefore` null or 0–30, `label` required for OTHER, one BIRTHDAY per person (409).

### 4.3 Planning (reuse, minimal extension)

- **Find a Time:** **no new endpoint.** The client calls the existing `POST /api/timing-search` with `activityId` (CONNECT catalog) and `dateRange`, e.g. `{start: occasionDate, end: occasionDate}` for "on the day", or the surrounding weekend for "celebrate". Person context is **not** sent to ranking in MVP. Ranking stays exactly today's: Panchang 0.45 plus availability and Daily Rhythm.
- **Save plan:** `POST /api/plans` gains an optional `savedPersonId` (owner-validated with `getSavedPersonForOwner`, 404 otherwise). The title continues to use the existing "with {name}" convention (D6).
- **Shared Muhurtham** (`/api/muhurtham-search` SHARED, `/api/timing-search/shared`) is unchanged, but its pickers list only people with `hasChartDetails`, and the route returns **422 `CHART_DETAILS_REQUIRED`** instead of throwing on a person without them.

### 4.4 Occasion surfacing (not a new reminder system)

- Derived on read: an occasion is *surfaced* when `0 ≤ daysUntil ≤ remindDaysBefore`.
- In-app only: My People "Coming up" plus one Home card. **No push, email or SMS in MVP.** Prod has no background push anyway, and the brief excludes external notifications.
- Dismissal reuses `ReminderAttention` (schema:621) with `scheduledItemType = "PERSON_OCCASION"`, `scheduledItemId = occasionId` and `reminderAt` = that year's occurrence date. `scheduledItemType` is a plain string, so no migration is needed, and the existing unique key already makes the dismissal once per year. Dismissing hides it for that year only and does not delete the occasion.
- No repeat prompts: an occasion appears at most once ahead (at its `remindDaysBefore` window) and once on the day.

### 4.5 Events (allow-listed, no names)

`MY_PEOPLE_PERSON_CREATED {relationshipType, hasOccasion}` (replaces or extends `SAVED_PERSON_CREATED`), `MY_PEOPLE_OCCASION_ADDED {kind}`, `MY_PEOPLE_PLAN_STARTED {source: "PERSON"|"OCCASION"|"HOME"}`, `MY_PEOPLE_PLAN_SAVED {activityId}`. Existing `FORBIDDEN_METADATA_KEYS` already block `name`, `notes` should be added, and birth keys are already blocked.

---

## 5. Mobile-first UX concepts

Design rules: one screen = one job; at most one primary button; warm and factual copy; **no counters of neglect** ("You haven't called Amma in 23 days"), no red badges, no streaks. Uses existing `components/ui.tsx` primitives and the reserved `--as-relationship` pink tone.

### 5.1 Navigation

No 7th dock slot (the dock is already 6 × 1fr at 375px). Entry points:
- **You → My People** (rename the existing row; subtitle "The people who matter most").
- **Home**: the occasion card (when present) and a quiet "My People" link in the existing personalization area.
- **Plan**: the existing "Who's this with?" chip row gains "+ Add someone" (name-only quick add).
- `?tab=people` deep link (already supported) for the Home card. `peopleReturnTo` gains `'home'` (already allowed).

### 5.2 My People overview

```
┌─────────────────────────────────┐
│ ←  My People               + Add│
├─────────────────────────────────┤
│ COMING UP                       │
│ ┌─────────────────────────────┐ │
│ │ 🎂 Ravi's birthday          │ │
│ │    Sat 5 Dec · in 9 days    │ │
│ │    [Plan something]         │ │
│ └─────────────────────────────┘ │
│ 💍 Amma & Appa's anniversary    │
│    Mon 21 Dec · in 25 days      │
├─────────────────────────────────┤
│ PEOPLE                          │
│ (R) Ravi        Friend      ›   │
│ (A) Amma        Mother      ›   │
│ (P) Priya       Partner     ›   │
│ (M) Meera       Colleague   ›   │
└─────────────────────────────────┘
Empty state: "Keep the people who matter close.
Add someone and Aura will remember their special days
and help you find good times together."   [+ Add someone]
```
Initial-letter avatars only (no photos). "Coming up" is hidden when empty, not shown as "nothing coming up".

### 5.3 Add / edit person (progressive, name-only to save)

```
┌─────────────────────────────────┐
│ ×  Add someone            [Save]│
├─────────────────────────────────┤
│ Name *                          │
│ [ Ravi                       ]  │
│ Relationship                    │
│ (Partner)(Family)(Friend)(…)    │  ← chips, none preselected
│                                 │
│ ＋ Birthday                      │  ← tap → day/month picker, "year (optional)"
│ ＋ Anniversary                   │
│ ＋ Another important date        │
│ ＋ Where they live               │  ← city label + timezone (auto from catalog city)
│ ＋ Interests                     │  ← tag chips: "cricket", "filter coffee"
│ ＋ Private note                  │
│ ＋ Chart details (for Muhurtham) │  ← existing birth date/time/place block, collapsed
│                                 │
│ 🔒 Only you can see this.        │
└─────────────────────────────────┘
```
Every optional section is collapsed until tapped, so the minimum is 1 field and 1 tap. Chart details carry the explainer "Only needed for shared Muhurtham timing. Never used to judge your relationship."

### 5.4 Person detail

```
┌─────────────────────────────────┐
│ ←  Ravi                    Edit │
│    Friend · Bengaluru           │
│    It's 7:40 pm for Ravi        │  ← only if timezone ≠ user's
├─────────────────────────────────┤
│ [ Plan time with Ravi ]         │  ← single primary action
├─────────────────────────────────┤
│ SPECIAL DAYS                    │
│ 🎂 Birthday · 5 Dec (in 9 days) │
│ ＋ Add a date                    │
├─────────────────────────────────┤
│ TOGETHER                        │
│ Thu 3 Dec · Coffee · 6:15 pm    │  ← upcoming linked plans
│ Last time together: 14 Nov      │  ← factual, no judgement
├─────────────────────────────────┤
│ LIKES     cricket · filter coffee│
│ NOTE      Moving house in Jan   │
├─────────────────────────────────┤
│ Remove Ravi                     │
└─────────────────────────────────┘
```

### 5.5 Person → Plan / Find a Time

```
Plan time with Ravi                 Best times (Panchang-ranked)
┌───────────────────────┐          ┌──────────────────────────────┐
│ What would you like?  │          │ Thu 3 Dec · 6:15–7:00 pm     │
│ (📞 Call)(☕ Coffee)   │  ──────▶ │ Supportive · Gulika window,  │
│ (🍽 Dinner)(🏠 Visit)  │          │ you're free, after work      │
│ (💬 Catch up)(More…)  │          │            [Save with Ravi]  │
│ When?                 │          │ Sat 5 Dec · 10:30–11:15 am … │
│ (This week)(Next week)│          └──────────────────────────────┘
│ (Pick dates)          │
└───────────────────────┘
```
This reuses `PlanWithAuraView`'s Find flow with `activityId`, `dateRange` and `savedPersonId` pre-filled, and the "Who's this with?" chip preset to Ravi. The explanation lines come from the existing ranking explanation. Results already exclude busy times and Rahu/Yama for timing-sensitive activities.

### 5.6 Occasion → prepare

```
🎂 Ravi's birthday · Sat 5 Dec
[ Plan a celebration ]   → Find a Time, birthday-party/celebration-dinner, Fri 4–Sun 6 Dec
[ Call on the day ]      → Find a Time, call, dateRange = 5 Dec only (fixed occasion respected)
  Not this year           → dismiss for 2026 only
```

### 5.7 Home: relationship card (at most one per day)

```
┌─────────────────────────────────┐
│ 🎂 Ravi's birthday is Saturday  │
│ A good time to call: 10:30 am   │  ← top Panchang-ranked slot on the day, if computed cheaply
│ [Plan]          Not this year   │
└─────────────────────────────────┘
```
Placement: after `StartingSoonCard`, before `GoalRhythmSuggestionsCard`. Shown only for surfaced occasions. If several are surfaced, the soonest is shown with "+1 more" linking to My People. No card when there is nothing to show. Never a "you haven't seen X" card in MVP.

---

## 6. Integration with existing Aura capabilities

### 6.1 Panchangam ranking (unchanged and significant)
- Every person-originated time recommendation goes through `evaluateActivityFit`: **Panchang (tithi/nakshatra/yoga/karana via `packages/muhurta`) 0.45**, solar windows 0.20, preferences 0.25 combined; Rahu Kalam/Yamaganda avoidance per catalog activity.
- Respect order (hard to soft): **fixed occasion date** (dateRange pin) → **availability and existing plans** (`findATimeConstraints`, hard) → **explicit preferences** (time preference, Daily Rhythm work hours, soft re-order) → **Panchang-weighted fit** (rank).
- New catalog entries `call` and `video-call`: `nature:'CONNECT'`, `significance:'LOW'`, recommended NEUTRAL/GULIKA, avoid none, Daily Rhythm class PERSONAL. Panchang still contributes 0.45 to their score, so good windows rank higher, but nothing is blocked.
- **Prohibited:** synastry, Guna Milan/Ashtakoota, "good day for your relationship", predictions about the person. Chart details only feed the existing, opt-in Shared Muhurtham blend, whose own doc already disclaims compatibility.

### 6.2 Goals and Life Rhythms (MP-4)
- "Keep in touch" = a `GoalActivity` with `rhythmKind N_PER_WEEK` (weekly only at first; monthly cadences deferred, §9) and `savedPersonId`. The weekly proposal (`goalRhythmWeeklyProposal.ts`) and Home `GoalRhythmSuggestionsCard` work unchanged. The person only adds "with Amma" to copy and links the saved plan.
- Parent Goal (D8/R1): adding or editing a person **never** creates a goal. Only when the user explicitly sets up a recurring activity with them ("Keep in touch → Call weekly → Save") does Aura create a visible, editable "Stay close to {name}" goal, or attach the activity to an existing goal the user picks. There are no hidden goals.

### 6.3 Existing people consumers after MP-1

| Consumer | Change |
|---|---|
| Shared/Personal Muhurtham picker, Ask Aura SHARED | List or resolve only `hasChartDetails` people. Otherwise reply "Add Ravi's chart details to include them" |
| `/api/timing-search/shared`, Day Builder shared candidates | Already tolerant (neutral 65). Pass `null` partner context instead of reading null fields |
| Day Builder eligibility (`PEOPLE_GROUP_RELATIONSHIP_TYPES`) | Map new PARENT/CHILD/SIBLING → FAMILY |
| `PlanWithAuraView` "Who's this with?" | Now lists all people. Pass `savedPersonId` to `/api/plans` (MP-3) |
| Aura Moments | Unchanged (sharing is an existing, separate feature, not extended) |

### 6.4 Reminders
Occasions are not plans, so they stay outside `deriveAuraReminders`' minutes-before model. A plan made *from* an occasion is a normal `PlannedActivity` and gets normal plan reminders. When background push is activated (AURA-INFRA-01), a once-a-day occasion digest is a natural fit for the existing daily cron. That is not in MVP.

---

## 7. Privacy and security

| Principle | Design |
|---|---|
| Account-scoped | Every query `WHERE … "ownerUserId" = $n`. `PersonOccasion.ownerUserId` is denormalised so occasion routes never trust a joined id alone. Cross-owner → 404 |
| Data minimisation | Only the name is required. No phone, email, address, photo, gender, birth year or birth time required. Chart details are opt-in and explained. Location is a label plus timezone (no coordinates for MP fields) |
| No outbound | No contact upload, invitations, sharing, external notifications or email in MVP. The person never learns they were added |
| Notes | Private free text, ≤1000 chars, never in ProductEvents, logs or MCP. Add `notes` to `FORBIDDEN_METADATA_KEYS` |
| Logging | Never log names or notes. Errors use ids only (existing `errorForLog` convention) |
| Editing | Partial PATCH: an absent key leaves the field unchanged, so **chart details are never touched unless `chart` is sent**. A chart is replaced only whole, never piecemeal, and cleared only by an explicit `chart: null` |
| Deletion | One transaction; full matrix in §11.2 |
| Export | `/api/users/export` adds `people[]` (fixes G5); see §11.4 |
| MCP / AI | My People is **not** exposed to MCP tools in MVP (MCP workstream untouched). Ask Aura keeps its current name resolution only |
| Account deletion | **Platform-wide public-launch requirement** (carried forward, not part of MP). User cascades already cover every My People table, so no MP-specific work is needed when it lands |
| No pressure | No relationship scoring, health scores, streaks, "days since" counters or repeat nudges. Each special day surfaces at most twice a year, in-app only |
| Abuse limits | ≤200 people per account, ≤10 occasions per person (server-enforced) |

---

## 8. Implementation sequence

Each PR can ship dark behind the My People switch (D9, §11.5). None of them touch Android, Palmistry, MCP, AUTH-01 or PREF-01 files. **None should be merged into the REL-05 candidate.** Start after REL-05 is cut.

| PR | Scope | Migration | Risk |
|---|---|---|---|
| **MP-1 Foundation** | See ticket. Schema, partial PATCH, occasions API, null-guards at all 9 read sites, null-safe legacy People screen, atomic delete, export, switch | `0056_my_people_foundation` (additive) | Low–medium: relaxing NOT NULL is the only behavioural change. Covered by the null-guard and switch-rollback tests |
| **MP-2 My People UI** | Overview, add/edit (progressive), detail, upcoming list; You row rename; Plan quick-add | none | Low |
| **MP-3 Plan with a person** | `call`/`video-call` catalog entries, `savedPersonId` on `/api/plans`, Person → Find a Time and Occasion → prepare flows, Home occasion card + dismissal via `ReminderAttention` | none (column from MP-1) | Low–medium: Home placement. Reuse Home recomposition tests |
| — | **Validation read-out** (PV-01 style, 5–8 users): do people add dates? do occasion cards lead to plans? any guilt signals? | | |
| **MP-4 Relationship Rhythms** | `GoalActivity.savedPersonId`, "Keep in touch" from person detail, parent-goal rule (D8), pause rhythm on person delete (D7) | `0056` additive | Medium |

Tests per PR: unit (validation, occasion maths incl. Feb 29, year-boundary, user-tz edge at midnight), DB (cross-owner isolation for every route, deletion transaction, export), jsdom (forms: name-only save, chart section clear), Home recomposition (card absent or present). Each file is wired explicitly into `.github/workflows/ci.yml`.

---

## 9. Owner decisions (APPROVED 2026-11-26)

All of D1–D10 were approved as recommended, with refinements R1–R3 (shown in the rows and listed below the table).

| # | Decision | Options | **Recommended** | Rationale |
|---|---|---|---|---|
| **D1** | Person record | (a) evolve `SavedPerson`; (b) new `Person` table linked to SavedPerson | **(a) Evolve** | One identity per human, so no "which Ravi?". All 7 consumers and the existing Aura Moment and Day Builder links keep working. Deletion, export and isolation are done once. The cost is the null-guards in §11.1 |
| **D2** | Relationship set | (a) keep the 5 types; (b) add PARENT/CHILD/SIBLING plus an optional free-text label; (c) free text only | **(b)** | The types drive Day Builder family/social eligibility (`lib/dayBuilder.ts:202`), so they must stay an enum. The label ("Amma", "Mentor") covers everything else without adding enum values. COLLEAGUE = OTHER + label. The form preselects no type (today it defaults to PARTNER) |
| **D3** | Birthday vs chart birth date | (a) one field for both; (b) separate, with a one-time prefill offer; (c) separate and kept in sync | **(b)** | A birthday must not need a year or time. Chart details need both. Keeping them in sync would silently change a special day when someone fixes a chart typo, and the reverse. A one-time "Also remember their birthday?" prefill gives the convenience without coupling them |
| **D4** | 29 Feb in non-leap years | (a) 28 Feb; (b) 1 Mar; (c) skip the year | **(a) 28 Feb** | Keeps the day in the person's own month, which is the most common convention. Skipping years would hide three birthdays out of four. The date shows as "28 Feb (for 29 Feb)" |
| **D5** | Default lead time for special days | (a) on the day only; (b) 7 days ahead + on the day; (c) 14 days | **(b)** with a per-day off switch | A week is enough time to plan a visit or a gift without nagging. Each special day surfaces at most twice a year, in-app only |
| **D6** | Person's name in history after deletion (plan titles, Moment display names) | (a) keep; (b) scrub to "someone" | **(a) Keep**, and say so in the delete dialog | These are the user's own calendar records. Rewriting them is surprising and lossy. The private data (notes, special days, chart details) is what deletion removes |
| **D7** | Linked Life Rhythms when the person is deleted (MP-4) | (a) keep running unlinked; (b) pause; (c) archive | **(b) Pause** | Aura must not keep proposing "Call Ravi" after Ravi is removed. Pausing is reversible, keeps the plans already made, and reuses the existing `rhythmPausedAt` |
| **D8** | Parent Goal for person rhythms (MP-4) | (a) visible "Stay close to {name}" Goal; (b) hidden synthetic goal; (c) relax the GoalActivity→Goal requirement | **(a)**, **R1:** created only when the user explicitly sets up a recurring activity with that person, never on person creation. The user can attach it to an existing goal instead | Uses the Goals model unchanged, with no hidden records and no schema relaxation. The user can rename, merge or archive it |
| **D9** | Feature switch scope | (a) UI only; (b) UI + API; (c) no switch | **(b)**, off in Production until release sign-off. **R2:** turning it off after records exist without birth details must not break any screen, API or consumer, and must keep all data (§11.5) | Hiding the UI is not enough. With the switch off, the API must also behave as today, so the dark launch is real and reversible |
| **D10** | Naming and entry points | (a) a 7th nav slot "People"; (b) "My People", reached from You, Home and Plan | **(b)** | The 6-slot dock is full at 375px. My People is about a few occasional moments, not a daily destination. Renaming makes clear it is a distinct, personal place |

**Refinements**
- **R1** (D8): no automatic goals. A goal appears only when the user explicitly creates a recurring relationship activity.
- **R2** (D9): rollback is safe with records that have no birth details, and all data is preserved (§11.5).
- **R3**: tithi-based and culturally significant days stay on the roadmap, kept open by design (§3.2), and are not implemented now.

**Standing constraints (owner):**
- Chart details are preserved on partial updates.
- Deletion and its reference clean-up are atomic.
- Account isolation and export are verified by tests.
- Account deletion is carried forward as a platform-wide public-launch requirement.
- Panchang stays a significant ranking factor (0.45) for flexible planning.
- No contact import, external invitations, relationship scoring or guilt-inducing reminders.

Not in MVP: monthly or longer cadences (wait for weekly-rhythm validation in MP-4) and tithi-dated days (R3).

---

## 10. First implementation ticket

**AURA-MP-1 — My People data and API foundation:** see [AURA_MP_1_DATA_AND_API_FOUNDATION_TICKET.md](AURA_MP_1_DATA_AND_API_FOUNDATION_TICKET.md). **HOLD** until the REL-05 cut and explicit implementation authorisation.

---

## 11. Clarifications requested by the owner

### 11.1 Compatibility when birth details become optional

**Existing chart profiles are untouched.** The migration only drops NOT NULL and adds columns. Every existing row still has its full chart details, so every consumer behaves identically for it. Only people created name-only after launch have no chart details.

**One guard, enforced by the compiler.** Add `natalContextForSavedPerson(person): NatalContext | null` in `lib/savedPersonNatalContext.ts`. It returns `null` unless all three chart fields are present. Making the Prisma/DB row types nullable means every direct read (`person.birthDate.toISOString()`) stops compiling, so no read site can be missed. Each one is switched to the helper.

| # | Consumer | Read site today | Behaviour for a person without chart details |
|---|---|---|---|
| 1 | Shared ("Us") Muhurtham | `app/api/muhurtham-search/route.ts:108` | The picker lists only people with chart details. The API returns **422 `CHART_DETAILS_REQUIRED`** with "Add Ravi's birth details to find a shared Muhurtham" |
| 2 | Everyday shared timing | `app/api/timing-search/shared/route.ts:72` | Allowed. A null partner context scores neutral (65), which is already the documented behaviour of `findEverydaySharedTiming` |
| 3 | Aura Moments (create, suggest, alternatives) | `aura-moments/[token]/suggest:57`, `/alternatives:52` | Already null-tolerant (`?? undefined`). No change |
| 4 | Day Builder shared suggestions | `lib/dayBuilderOrchestrator.ts:297` | Person stays eligible and is scored neutral like #2. Priority ids work unchanged |
| 5 | My Day / Daily Story ("time with X later today") | `lib/myDayOrchestrator.ts:119` (ids only) | No birth data is read. No change |
| 6 | Ask Aura | `lib/askAuraOrchestrator.ts:713, 884, 1006, 1435` | SHARED Muhurtham requests get the same "add birth details" reply as #1. Everyday checks continue as #2 |
| 7 | Plan "Who's this with?" picker and People screen | `components/PeopleView.tsx:216`, `PlanWithAuraView` | Shows chart details only when present. All people are selectable for everyday plans |

Regression tests: run the existing shared-Muhurtham, Day Builder, Ask Aura, Aura Moments and SavedPerson suites unchanged (existing data still has chart details), plus one name-only case per row above.

### 11.2 Deleting a person

The user confirms "Remove Ravi? Their special days, notes and chart details will be deleted. Your plans stay in your calendar." Everything below happens in **one transaction**.

| Linked data | Effect |
|---|---|
| Person row (name, label, notes, interests, location, chart details) | **Hard-deleted** |
| Special days (`PersonOccasion`) | **Deleted** (cascade), plus their `ReminderAttention` dismissal rows |
| Plans, upcoming and past (`PlannedActivity.savedPersonId`) | **Kept.** The link is set to null. Title and reminders are unchanged (D6) |
| Life Rhythms (MP-4, `GoalActivity.savedPersonId`) | Link set to null and the rhythm **paused** (D7). Its goal, occurrences and plans are kept |
| Aura Moments | Existing behaviour: link set to null, display name kept, share links unaffected (the user revokes them separately) |
| Day Builder | Id removed from `dayBuilderPriorityPersonIds`. `DayBuilderDismissal` rows for that person deleted (fixes G4) |
| Completed activity history (habit logs, executions, completed plans) | **Untouched.** It is the user's own record |
| Natal context, ProductEvents | Nothing to delete. Natal context is never stored, and events never hold a person's id or name |

Deletion is permanent with no "trash" in MVP. This is deliberate: it is private data and the user asked for it to go.

### 11.3 Special days: unknown year and 29 February

- **Unknown year:** `year` is null. The day still recurs every year. Aura simply doesn't show an age or "10th anniversary", and nothing ever prompts for the year.
- **Validation:** month 1–12. Day must be valid for that month (31 Apr is rejected). Feb 29 is always accepted; if a year is given, it must be a leap year. Year must be between 1900 and the current year.
- **29 February:** observed on **28 Feb** in non-leap years (D4) and labelled "28 Feb (for 29 Feb)". Ages still count correctly.
- **"Today" and "days until"** are calendar-day maths in the user's `User.timezone`, so there are no DST or UTC off-by-one errors. A day coming up in early January is found from late December, and the dismissal key is that occurrence's year.
- All of this lives in one pure function (`lib/personOccasions.ts`). Unit tests cover unknown year, 29 Feb in leap and non-leap years, invalid dates, year rollover, and the user's midnight in a non-UTC timezone.

### 11.4 Isolation, export and account deletion

- **Isolation:**
  - Every My People query in `lib/db.ts` filters by owner (`"ownerUserId" = $n`, or `"userId"` for plans), following the existing SavedPerson pattern.
  - `PersonOccasion` has its own `ownerUserId` plus a composite FK `(savedPersonId, ownerUserId) → SavedPerson(id, ownerUserId)`, so the database itself cannot hold a special day under someone else's person.
  - A `savedPersonId` sent to `/api/plans` is checked with `getSavedPersonForOwner` (404 otherwise).
  - **Plan ownership (R1 correction):** the `PlannedActivity.savedPersonId` FK only guarantees that the person *exists*; it does not prove the person is the plan owner's. Ownership is enforced by the supported SQL writers: `createPlannedActivity` and `createPlannedActivityWithClient` store the link only through an owner-checked subselect (`SELECT id FROM "SavedPerson" WHERE id = $n AND "ownerUserId" = <plan userId>`), so they store NULL for a foreign id. No other writer sets the column in MP-1. A raw SQL write outside these writers is not prevented by the database. Plans created by Move or Recomposition do not carry the link forward; that is MP-3's concern.
  - Cross-owner and missing ids both return 404.
  - DB tests attempt every route with another user's person or occasion ids and assert nothing leaks or changes.
- **Export:** `/api/users/export` adds `people[]` with each person's fields, chart details (when present) and special days, owner-scoped (fixes G5). It does not export derived natal context.
  - **Nested `ownerUserId` (R1 assessment):** omitted at every level, from the person and from each nested special day. The export is the owner's own data, so the owner id adds nothing and only leaks an internal identifier into a file that may be shared. Record ids and `savedPersonId` are kept because they link records within the file.
- **Account deletion:** Aura has no account-deletion endpoint yet (G8, a platform gap outside MVP). The schema already cascades User → SavedPerson → PersonOccasion, and User → PlannedActivity/GoalActivity, so a future account deletion removes all My People data with no extra work.
- **Logs and events:** names and notes never appear. `notes` is added to `FORBIDDEN_METADATA_KEYS`.

### 11.5 Does the switch protect both API and UI? Yes (corrected in R1, 62007 F2)

Two flags with separate jobs (`lib/myPeopleGate.ts`):

| Flag | Kind | Read | Decides | Default |
|---|---|---|---|---|
| **`AURA_MY_PEOPLE_ENABLED`** | Server-only, **authoritative** | From the server's runtime environment on every request. It is not `NEXT_PUBLIC_`, so it is never inlined into any bundle | Every My People API behaviour: contracts, special-day routes, plan links | **Disabled** unless exactly `"1"`, in every environment (Production, Preview, development, test) |
| `NEXT_PUBLIC_AURA_MY_PEOPLE` | Public, **presentation only** | Inlined into the client bundle when defined at **build** time. Changing it requires a rebuild | Whether the client *may* present My People UI | Hidden unless exactly `"1"` |

- **The public flag can never override server disablement.** The server never reads it. The client presents My People only when the public flag is `"1"` **and** the server's response header `x-aura-my-people` says `enabled`. With the public flag on and the server disabled, the client degrades to the legacy UI. Verified against compiled Production artifacts built with the public flag on and off (R1 evidence).
- **Vercel semantics:** environment variables are fixed per deployment. Changing either flag affects only deployments created after the change, so a **redeploy** is needed. Existing deployments, including an Instant Rollback target, keep the values they were deployed with.
  - **Enable:** set `AURA_MY_PEOPLE_ENABLED=1` (and, for the UI, `NEXT_PUBLIC_AURA_MY_PEOPLE=1`), then redeploy.
  - **Disable:** unset `AURA_MY_PEOPLE_ENABLED`, then redeploy. Leaving the public flag on is harmless.

The switch controls **new capabilities only**. Anything existing records depend on is always on, so turning it off cannot strand data that was created while it was on (R2).

| | Switch **off** (Production until sign-off) | Switch **on** |
|---|---|---|
| People screen | Today's screen and form. **Null-safe:** a person without chart details shows "No birth details" instead of crashing (today's code would crash at `PeopleView.tsx:216, 283`), and can still be edited (name/relationship) or removed. **R1 F1:** an unchanged PARENT / CHILD / SIBLING is kept; the editor never resubmits it. **R2 F1:** the editor submits only fields the user changed; a birth edit sends the full chart with the untouched location taken from the saved record (custom/unlisted cities and absent coordinates preserved); a save with no changes sends nothing | My People screens |
| `POST /api/people` | Legacy contract: chart details required | Name-only allowed |
| `PATCH /api/people/:id` | **Always partial.** Legacy fields only; new-field keys are rejected (400) but the stored new fields are **kept**. Chart details are optional when the person has none. **R1 F1:** resubmitting the person's own unchanged My People type is an accepted no-op; *changing* to one is a 400 | Partial, all fields |
| `GET /api/people[/:id]` | Legacy shape; chart fields may be null; new fields omitted from the response, not from the database | List: the design 4.1 item. Detail: full record |
| Special-day routes, `/api/people/occasions/upcoming` | 404. Rows stay in the database | Live |
| `/api/plans` `savedPersonId` | Ignored, not written. Existing links are kept | Validated and written |
| Home special-day card, "Plan time with" | Hidden | Shown |
| **Always on** | The migration, null-guards at all 9 read sites, the atomic delete with clean-up, the export (including special days and notes), birth-detail validation, the database date CHECKs, atomic limits and updates | same |

Shared Muhurtham with a person who has no chart details returns the friendly 422 in both states. Everyday shared timing, Day Builder, Aura Moments, My Day and Ask Aura behave the same with the switch on or off.

**Rollback verification (MP-1 acceptance test):**
1. With the switch on, create one name-only person with notes and special days, and one chart person.
2. Switch it off. Exercise list, detail, legacy edit, delete, export, Shared Muhurtham (expect 422), everyday shared timing, Day Builder and Ask Aura. There must be no 500s and no client crash.
3. Switch it back on. Assert every field and special day is unchanged.

Rollback = unset `AURA_MY_PEOPLE_ENABLED` and redeploy. No data migration is needed.

---

## Delivery checklist

- [x] Separate worktree from current `main` (`3feff03`), branch `docs/aura-mp-01-my-people-design`
- [x] Design and architecture only: no application code, migrations, dependency changes or deploys
- [x] No commits to `main`; no Production access
- [x] Android, Palmistry, MCP, AUTH-01 and PREF-01 workstreams not modified
- [x] REL-05 not affected (implementation proposed after the REL-05 cut)
- [x] Owner approved D1–D10 with R1–R3 (2026-11-26)
- [ ] AURA-MP-1 implementation: **HOLD** until the REL-05 cut and explicit authorisation
