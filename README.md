# AuraSchedule — math core + dial UI (v1)

## What's here and verified

- `packages/astronomy` — NOAA solar ephemeris math. Tested against live sunrise/sunset
  data for Chennai (`npx ts-node test/ephemeris.test.ts`).
- `packages/panchang` — Rahu Kalam / Gulika / Yama / Abhijit / Brahma window math.
  Segment tables cross-checked against multiple published panchang sources
  (Sunday/Monday spot checks matched exactly).
- `packages/recommendation` — hardcoded, single-persona action-card lookup (no LLM).
- `apps/web` — Next.js 14 App Router components (`Dial.tsx`, `ActionCards.tsx`,
  `HabitLog.tsx`, `page.tsx`) that import directly from the packages above.
  Typechecked clean against React types (`npx tsc -p tsconfig.web.json`).

## What's NOT scaffolded yet

This is component code, not a runnable `next dev` project — there's no `next`
dependency, no `next.config.js`, and no build pipeline wired up. To actually run it:

```bash
npx create-next-app@14 auraschedule-web --typescript --app --no-tailwind
# then copy apps/web/app/*, apps/web/components/*, apps/web/lib/*
# and packages/* into the new project (or set up workspace symlinks if you
# want to keep the monorepo layout — a simple relative-import setup like the
# one here works fine for a single app, but breaks once you add a second app
# consuming the same packages, at which point it's worth reaching for
# pnpm workspaces / Turborepo properly).
npm install
npm run dev
```

## Known limitations (intentional, per the MVP spec)

- Location is hardcoded to Chennai. No location picker yet.
- Habit log state is in-memory only (React state) — resets on page refresh.
  Wiring to the `User`/`HabitLog` Prisma models from the MVP spec is the next step.
- Single persona (STANDARD-style copy), no GEN_Z/DASANKUTTY branching yet.
- No auth.

## Calendar view (completes Phase 1.2's notification-free items)

Month grid (`components/CalendarView.tsx`) highlighting days with logged activity —
either from the fixed 3-card suggestions or custom habits, both land in the same
`HabitLog` table so no separate query was needed to combine them. Prev/next month
navigation, today outlined.

`GET /api/habit-logs/calendar?year=&month=` (`getMonthlyActivity` in `lib/db.ts`)
returns per-day counts via a single grouped SQL query rather than fetching every log
row and counting client-side.

**Verified against real Postgres:** seeded 5 logs on day 1, 2 on day 15, 3 on day 28
of the current month directly via SQL, then confirmed the API returns exactly
`[{day:1,count:5},{day:15,count:2},{day:28,count:3}]` — not approximately, exactly.
Also confirmed: a month with no data returns `[]` (not an error), missing
year/month params return 400, and an unauthenticated request returns 401.

This completes everything in Phase 1.2 except notifications/daily reminders, which
are intentionally deferred — see the retention-tracking section above for why.

## Calendar drill-down (found via real usage — day cells did nothing)

The calendar previously showed activity counts as colored cells but had no
`onClick` at all — a scope gap from when it was first built (summary query and
grid, no drill-down). Fixed: clicking a day now opens a modal showing that day's
actual logged entries (title + time), not just the count.

New `GET /api/habit-logs/calendar/day?year=&month=&day=` (session-gated) backs it.
**Verified against real Postgres:** seeded 3 distinct logs with different titles
and times on a specific day, confirmed the endpoint returns exactly those 3 with
correct titles and timestamps; confirmed an empty day returns `[]` rather than an
error; confirmed missing params → 400 and no auth → 401.

## Timezone-dependent timestamp bug (found via real testing, not sandbox testing)

Every timestamp column originally used Postgres's `TIMESTAMP` (no timezone) type.
That's a real latent bug: node-postgres's default parser reads a naive timestamp
back by constructing a JS Date using the *reading process's own local timezone* —
not UTC. If Postgres's session timezone and the Node process's timezone don't
match, every timestamp read back is silently shifted, and that shift corrupts any
day-boundary logic (streaks, "today's" calendar activity, visit dedup) whenever it
happens to cross midnight.

**This sandbox never caught it** because its Postgres session timezone and its
Node process timezone are both UTC — the bug was invisible by pure coincidence.
Found only once the app was actually run on a real developer machine, where the
two didn't necessarily match.

Fixed via `prisma/migrations/0006_timestamptz_fix/` — converts every timestamp
column to `TIMESTAMPTZ`, which stores an unambiguous instant and is always read
back correctly regardless of either side's timezone.

**Verified the fix directly, not just reasoned about it:** inserted a timestamp
deliberately 2 hours before UTC midnight (the exact condition needed to cross a day
boundary under the old bug), read it back through a Node process explicitly set to
`Asia/Kolkata`, and confirmed the returned instant matched the inserted one exactly
byte-for-byte (`2026-08-05T22:00:00.000Z` in, same value out) — no shift at all.

**Known open question, flagged rather than silently decided:** even with this
fixed, "today" for streak purposes is currently computed inconsistently — the
browser-side streak calculation uses the visitor's own local day, while the
server-side visit dedup uses Postgres's session-timezone day. These will usually
agree but could disagree by a day right at a boundary. Worth an explicit decision
(probably: always the visitor's own local day) rather than leaving it implicit.

## Dial selection bleed — a real, always-present rendering bug (now fixed)

Reported: colors visibly overlapping specifically when a segment is selected.
This turned out to be unrelated to the weekday time-overlap issue above —
checked the actual geometry:

- Gap carved between adjacent arc segments: 14.7px
- Combined width of two `round` line-cap ends facing each other, at normal
  stroke width: **34px** — already more than double the gap, meaning adjacent
  segments' rounded ends were bleeding into each other *all the time*, not just
  when overlapping.
- When one segment is selected (stroke width grows for the "pop" effect):
  **37px** — worse. Combined with unselected neighbors dropping to 55% opacity,
  the bright, full-opacity round cap sitting on a dimmed neighbor became
  obvious in a way it wasn't at rest.

Fixed by switching `strokeLinecap` from `round` to `butt` — butt caps have zero
extension past the path's actual endpoint, so there's nothing to bleed,
regardless of stroke width or selection state. Considered widening the gap
instead, but rejected it: Abhijit Muhurtham is only ~12° wide, and the gap
needed to fit a `round` cap at max stroke width (~15° total) would exceed
Abhijit's own width, carving the segment down to nothing.

## Dial "overlapping" segments — investigated, not a bug in the math

Reported from real screen-recording usage. Checked directly rather than guessing:
Abhijit Muhurtham is always centered on solar noon, while Rahu/Gulika/Yama Kalam
are independently computed as weekday-indexed eighths of daylight — nothing
prevents them from landing on the same clock minutes, and they genuinely do on
5 of 7 weekdays (verified for 2026-08-06 across all weekdays: overlap on Sun,
Mon, Tue, Wed, Fri; none on Thu/Sat). This is a real, traditionally-acknowledged
phenomenon in panchang systems (there's a traditional statement that Abhijit's
auspiciousness is negated when it coincides with Rahu Kalam) — the underlying
data is correct. The visual confusion is real too, though: two arcs drawn at the
same angle with one painting over the other looks exactly like a glitch, and
whichever window is drawn last (always Yama Gandam, per array order) fully wins
the hover/click target in the overlap region — the one underneath becomes
unreachable there. Not fixed in this pass (would need a real design decision —
stacking, splitting, or an explicit "overlap" indicator), but now at least
legible: both the dial and the timeline show the actual time range in their
labels, not just the window name, so which window covers which minutes is no
longer only inferable from position on the ring.

## Day timeline bar

`components/DayTimeline.tsx` — horizontal 24-hour bar version of the dial, with
sunrise/sunset markers at their actual position and a live "now" line. Deliberately
built as a full 24-hour bar rather than the reference mockup's sunrise-to-sunset-only
version, so Brahma Muhurtham (which falls before sunrise) isn't silently clipped
off the visualization.

Shares selection state with the dial via the same `selectedType`/`onSelectWindow`
props already passed to `Dial` — tapping a segment on either the dial or the
timeline updates the same state, so they can't drift out of sync. The color mapping
was extracted to `lib/windowColors.ts` so both components stay visually consistent
by construction rather than by two copies happening to agree.

**Verified:** clean build, clean typecheck, error-free server log through a full
login flow. Like the rest of the client-fetched UI panels, this wasn't verified via
actual browser DOM interaction — there's no browser-automation tool available here,
so verification stops at build/typecheck/server-log correctness plus the underlying
data (already independently validated at the API level) being correct. Worth an
actual click-through once you're running this locally.

## Birth chart & Tara Bala (rest of Phase 2)

`packages/vedic/src/natalChart.ts` computes sidereal positions for all 9 classical
grahas (Sun through Saturn, plus Rahu/Ketu) at a birth moment, placed into the 12
Rashis. Rahu/Ketu use the *mean* lunar node (standard for Vedic astrology, as
opposed to the faster-oscillating true node) via a Meeus polynomial approximation,
since `astronomy-engine` only exposes node *crossing events*, not a longitude
function.

**Scope boundary, stated plainly:** this does not compute the Ascendant/Lagna or
house cusps (needs sidereal-time + latitude-dependent spherical trigonometry — a
meaningfully bigger and more error-prone piece of math than sign placements) or
Vimshottari Dasha (the planetary period system). Both are real, separate scope for
a future pass, not silently missing.

**What's here instead, and it's a real feature, not a placeholder:** Tara Bala —
today's personalized favorability relative to the person's own birth nakshatra,
one of the actual traditional "personalized auspicious window" concepts, computed
from the 9-fold count between natal and current nakshatra.

**Validated three separate ways:**
1. The Rahu/Ketu mean-node formula against a live published reference
   (appliedjyotish.com's Aug 1, 2026 "mean Rahu" position): computed 306.69°
   sidereal vs. published 306.67° (Aquarius 6°40'11") — same Rashi, within 1.3
   arcminutes.
2. The local-birth-time-to-UTC conversion (`lib/timezone.ts`'s
   `localDateTimeToUTC`) against 3 hand-checked cases spanning IST (no DST) and
   both EST/EDT sides of a historical (1990) DST transition — all exact.
3. The Tara Bala arithmetic independently recomputed from scratch outside the
   application (not just re-reading the same code) for a real test birth profile
   (1990-03-15, 14:30, Chennai) and compared against what the live API actually
   returned — matched exactly (today's nakshatra Revati, distance 13, tara number
   4, "Kshema").

The underlying planetary-position engine itself was already validated earlier in
this README (DrikPanchang panchang cross-check, Mars/Gemini transit confirmation) —
the birth chart reuses the exact same position code at a different moment in time,
so no new positional-accuracy risk was introduced, only the birth-time-conversion
and Tara Bala counting logic needed independent verification.

`GET /api/panchang/natal-chart` (session-gated, 404 if no birth profile set) and
`PATCH /api/users/birth-profile` (validates date/time format and location).
`components/BirthChartSection.tsx` renders the form and, once set, the chart and
today's Tara Bala.

## Phase 2: Tithi, Nakshatra, Yoga, Karana

**Licensing note before the technical details, because it matters more:** Swiss
Ephemeris (the astronomical library, regardless of which JS wrapper —
`swisseph`, `@kuntay/swisseph`, `sweph`, etc. all bind the same underlying C library
from Astrodienst) is dual-licensed AGPL or paid-commercial. AGPL in a closed-source
product with paid tiers (this PRD has Pro/Family/Team) is a real legal exposure, not
a technicality — it generally requires making the whole application's source
available. Decision: used `astronomy-engine` (Don Cross, MIT license) instead —
same underlying astronomical rigor (used in production astronomy software), no
licensing conflict with a commercial product. This isn't legal advice; if Swiss
Ephemeris specifically is wanted later, get an actual legal opinion on the AGPL
question or budget for Astrodienst's commercial license first.

`packages/vedic/src/panchangElements.ts` computes:
- **Tithi** — from the raw tropical Moon-Sun elongation (ayanamsa cancels out in
  the subtraction, so no sidereal conversion needed here)
- **Nakshatra** — needs the Moon's *sidereal* longitude, so Lahiri ayanamsa matters
- **Yoga** — sidereal Sun+Moon sum; ayanamsa does *not* cancel here (unlike Tithi)
  since it's a sum, not a difference — a mistake that would be easy to make by
  reusing Tithi's logic
- **Karana** — half-tithi (6° increments instead of 12°), with the correct 4
  fixed + 7-cycle-repeated naming pattern
- `findNextTransition` — generic binary-search utility computing "ends at HH:MM"
  for any of the above, used by both the API and matching how published panchang
  sites display transition times

Lahiri ayanamsa uses a linear approximation anchored at J2000 rather than a lookup
table — validated against a live reference (Gochar.in showed 24°13'37" for
2026-07-23; the approximation gives 24°13'27", ~10 arcseconds off, negligible
against nakshatra boundaries that are 13°20' wide).

**Validated against real published panchang data, twice, on different dates:**

1. **2026-07-28** (India, generic) — ground truth: Shukla Chaturdashi tithi
   (transitions to Purnima at 6:19 PM), Purva Ashadha nakshatra (transitions to
   Uttara Ashadha at 1:11 PM), Vishkumbha yoga all day. Computed: tithi transition
   exact to the minute (18:19), nakshatra transition within 1 minute (13:10 vs
   13:11), yoga matched throughout.
2. **2026-08-03** (DrikPanchang, the field's standard reference) — tithi ends
   10:54:39 PM computed vs. 10:54 PM published (exact), nakshatra ends 9:59:48 PM
   vs. 10:00 PM (within 15 seconds), yoga ends 9:12:19 PM vs. 9:13 PM (within ~1
   minute), and the second Karana of the day (Taitila) correctly ends at the same
   moment as the tithi — matching DrikPanchang's own listed structure exactly.

One source (grahaguru.in) gave wrong values on both test dates, contradicted by
every other source and by the math itself — treated as unreliable rather than as
a tiebreaker.

`GET /api/panchang/today` (session-gated) returns all four elements with end
times; `components/TodayOverview.tsx` renders them, matching the mockup's "Today
Overview" panel layout. Live-tested end to end: correct data returned with a valid
session, 401 without one.

**Not yet built:** birth chart and personalized auspicious windows (the rest of
Phase 2) — these need natal planetary positions, not just today's Sun/Moon, which
is a meaningfully bigger scope than the daily panchang elements above.

## Recurring habits (Phase 1.2, notification-free)

Deliberately built the non-notification parts of Phase 1.2 first — see the
sequencing note in the retention-tracking section above for why.

- New `Habit` model, distinct from the fixed 3 action-card suggestions. Users can
  add their own recurring habit (title + category + target window) via "+ Add
  custom habit," log a completion, and see a per-habit streak.
- `POST /api/habits/:id/log` (`lib/db.ts`'s `logHabitCompletion`) does the actual
  streak math: continues the streak if yesterday was also logged, resets to 1 after
  a gap, and preserves `longestStreak` even through a reset. Runs inside a real
  Postgres transaction with a row lock (`FOR UPDATE`) to avoid a race if the same
  habit gets logged twice concurrently.

**Verified against real Postgres, not just reasoned about:** created a habit,
logged it twice in the same day (streak correctly stayed at 1, not 2 — idempotent
per calendar day), then directly backdated log timestamps to simulate two more
scenarios that can't be tested by just waiting real days: (1) yesterday's log
present → today's log correctly bumps the streak to 2, and (2) a 3-day gap before
today → today's log correctly resets `currentStreak` to 1 while `longestStreak`
stays at its prior best of 2. Also confirmed a forged habit ID belonging to another
user is rejected (400), not silently accepted.

Calendar view (the other Phase 1.2 non-notification item) is still open — natural
next step on top of this, since the data (`HabitLog` rows with timestamps) already
supports it.

## Phase 1.1 polish (countdown, explanations, arc interactions)

- **Countdown** (`lib/countdown.ts`) — "ends in Xm Ys" for the active window, or
  "starts in" for the next upcoming one if currently in a neutral gap. Unit-tested
  against 4 scenarios including midnight wraparound (23:50 → next window at 04:30 =
  4h40m, verified by hand). Ticks every second via a dedicated
  `useCurrentSecondOfDay` hook, kept separate from the coarser 30s dial-position
  hook so the whole dial doesn't re-render every second.
- **Recommendation explanations** — added a "Why these?" toggle above the action
  cards explaining the lookup methodology (deterministic, no LLM). The per-card
  `reasoning` text itself already existed in the data model from v1.
- **Arc interaction polish** — small angular gaps between arcs, a glow on the
  currently-active window, hover feedback, and dimming of non-selected arcs when
  one is selected.

**Real bug caught and fixed while building this:** the dial's "now" position and
the countdown were both computed from the *browser's* local clock
(`new Date().getHours()`), not the selected city's clock. Invisible as long as
everyone's browser and selected city were both India — but as soon as international
locations exist (previous update), anyone checking a city that isn't where they're
physically sitting (the core diaspora use case this app is partly built for) would
see the wrong "now" marker. Fixed by resolving the current time in the *target
timezone* via `Intl.DateTimeFormat` (`lib/timezone.ts`'s
`getMinuteOfDayInTimezone`/`getSecondOfDayInTimezone`), not the browser's own clock.
Verified directly: for the same instant, Chennai correctly reads 20:00 while Los
Angeles simultaneously reads 07:30.

## Location (now works anywhere, not just India)

`lib/cities.ts` now includes major Indian-diaspora hubs outside India (Singapore,
Dubai, London, New York, SF, Toronto, Sydney) alongside the original 10 Indian
cities, plus a fully custom lat/lng/timezone entry for anywhere else — the solar
math itself has no India-specific assumptions.

**Real correctness issue caught and fixed:** several of the international cities
observe daylight saving time (India doesn't, which is why this never came up
before). Storing a fixed `tzOffsetMinutes` would have been silently wrong for
roughly half the year in New York, London, Toronto, and Sydney. Fixed by storing an
IANA timezone name (`America/New_York`, etc.) instead, and resolving the correct
UTC offset live for the current date via `lib/timezone.ts` (uses `Intl.DateTimeFormat`
rather than a hand-maintained DST rules table). This required a schema migration
(`0003_timezone_column`) replacing the old `tzOffsetMinutes` column.

**Verified:** `resolveTzOffsetMinutes` tested against 8 known cases spanning winter
and summer for New York, London, and Sydney — including Sydney specifically because
its DST is inverted relative to the Northern Hemisphere (summer there is
Dec-through-Feb), which is exactly the kind of case a hand-maintained rules table
tends to get wrong. All 8 passed. Live-tested the full location-change flow: default
India location → switch to a curated non-Indian city (New York) → switch to a fully
custom location not on any list (Berlin) → confirm an invalid timezone name is
rejected with 400. New York's computed day length (14h29m) was cross-checked against
published July 2026 reference points via interpolation and matched within 2 minutes
— slightly less rigorously confirmed than the exact-match Chennai verification
earlier, since no single-day published figure for that exact date was available, but
consistent with it.

## Retention tracking (the actual kill criteria)

The MVP spec's kill criteria is day-2 return rate — but nothing tracked app opens
until now, only habit logs (a user can open the app without logging anything, or
log without it being a "return visit" in any meaningful sense). Added:

- `VisitLog` table + `prisma/migrations/0002_visit_log/` — one row per user per
  calendar day, recorded automatically whenever `/api/auth/session` confirms a
  valid session (i.e., every real page load). Deduped server-side so repeated
  requests in the same day don't inflate the numbers.
- `scripts/retention-report.js` — computes day-2 and day-7 return rate directly
  against `DATABASE_URL`, and reports pass/fail against the MVP spec's ~20% day-2
  bar once you have at least 5 users old enough to evaluate. Run with
  `node scripts/retention-report.js` (needs `.env.local` with `DATABASE_URL`, or the
  env var set directly).

**Verified two ways:** (1) `scripts/seed-retention-test-data.js` seeds 6 users with
hand-designed visit patterns (strong retention, day-1-only churn, immediate churn,
too-new-to-evaluate, patchy-but-present-at-day-7) with known expected results —
the report's output matched hand-calculated expectations exactly (4/5 = 80% day-2,
2/4 = 50% day-7, correctly excluding the two too-new users from each calculation).
(2) Hit the real running app 3 times in one session and confirmed exactly one
`VisitLog` row was created, not three — the dedup logic holds against real traffic,
not just seeded data.

## Auth (magic link)

`lib/auth.ts` implements signed, expiring tokens (HMAC-SHA256, hand-rolled rather
than pulling in a JWT library — all that's needed here is "tamper-evident payload
with an expiry"). Two token types: a 15-minute magic-link token and a 30-day session
token stored in an httpOnly cookie (`as_session`).

Flow: `POST /api/auth/request-link` → `GET /api/auth/verify?token=...` (sets cookie,
redirects to `/`) → `GET /api/auth/session` (used by the client to check login state)
→ `POST /api/auth/logout`.

**Live-tested end-to-end in the build sandbox** against the running dev server and
real Postgres: request → verify → session-with-cookie returns the user →
session-without-cookie returns null → `POST /api/habit-logs` without a cookie
correctly returns 401 → with a valid cookie it succeeds and is attributed to the
session's `userId`, not a client-supplied one (this closes a real gap the earlier
version had, where any client could pass an arbitrary `userId`).

**Not tested here — no egress to `api.resend.com` in this sandbox** (confirmed: a
direct request returns a proxy-level 403 with `x-deny-reason: host_not_allowed`, not
a response from Resend itself). `lib/email.ts` implements Resend's documented REST
API exactly, and `app/api/auth/request-link/route.ts` calls it whenever
`RESEND_API_KEY` is set — falling back to the dev-mode direct-link response
otherwise (verified above still works with the new code path). To actually send
email: sign up at resend.com, verify a sending domain, set `RESEND_API_KEY` and
`RESEND_FROM_ADDRESS` in your env. No code changes needed beyond that.

Set a real `AUTH_SECRET` env var in any environment beyond local dev — it defaults to
an insecure placeholder otherwise (`lib/auth.ts`).

## Location picker

`lib/cities.ts` is a small curated list of Indian cities with known lat/lng/timezone
— deliberately not wired to a geocoding API, same "no unnecessary external
dependency" reasoning as the solar math itself. `PATCH /api/users/location`
(session-gated) updates the signed-in user's location; the dial recomputes
immediately since the ephemeris/panchang math now reads from the user's real
stored location instead of a hardcoded constant.

**Live-tested end-to-end:** login → session returns Chennai (the default) → PATCH to
Kochi → session reflects Kochi's coordinates → an invalid city name is correctly
rejected with 400.

## Database (Postgres)

`prisma/schema.prisma` defines the v1 schema (`User`, `HabitLog` — matches the MVP
spec's minimal schema, not the full master PRD schema with circles/families/tiers).

**Important: the app currently runs on `lib/db.ts` (plain `pg`), not
`lib/prisma.ts`/`@prisma/client`.** Prisma's own tooling (`generate`/`migrate`) needs
to download engine binaries from `binaries.prisma.sh`, which this build sandbox can't
reach — so to actually get the app running end-to-end here, the API routes were
wired to a small `pg`-based data layer that mirrors the same schema exactly. This was
live-tested against a real local Postgres 16 instance: user creation, habit logging,
GET-ing logs back, and a streak calculation edge case (an old entry correctly does
not extend today's streak) all passed against real HTTP requests hitting the running
`next dev` server.

`lib/prisma-db.ts` is the Prisma-native equivalent, ready to use — it has the exact
same function signatures as `lib/db.ts`, so switching is two one-line import changes
once you've run `npx prisma generate` locally (needs normal internet access, which
your machine has even though this build sandbox didn't):

```ts
// app/api/auth/verify/route.ts
- import { getOrCreateUserForAuth } from '../../../../lib/db';
+ import { getOrCreateUserForAuth } from '../../../../lib/prisma-db';

// app/api/habit-logs/route.ts
- import { createHabitLog, listHabitLogs } from '../../../lib/db';
+ import { createHabitLog, listHabitLogs } from '../../../lib/prisma-db';
```

Everything else — `lib/auth.ts`, `lib/session.ts`, the login screen, the dial, the
habit log UI — is identical either way; only the two data-access imports change.
`lib/db.ts` (the `pg` version) is what's actually been live-tested end-to-end in
this build sandbox and can stay as a documented fallback if you ever need to run
this somewhere without internet access to `binaries.prisma.sh`.

Setup once you've scaffolded the Next.js project (see above):

```bash
# .env.local
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/auraschedule_dev"
AUTH_SECRET="something-long-and-random"

# apply prisma/migrations/0001_init/migration.sql to a fresh Postgres DB, e.g.:
psql -d auraschedule_dev -f prisma/migrations/0001_init/migration.sql
# (or, in your own environment with internet access: npx prisma migrate dev --name init)

npm install
npm run dev
```

There's no placeholder user anymore — visiting `/` with no session shows a
magic-link login screen. In dev mode (no email provider wired up), the response
includes the link directly so you can click straight through.

## Phase 2 note: lunar/planetary data

The 5 solar windows (Brahma/Abhijit/Rahu/Gulika/Yama) are pure sun-position geometry
and don't need this. But Phase 2's birth chart, tithi, and nakshatra features do need
actual planetary positions, not just the sun. Decision: use Swiss Ephemeris
(`swisseph`) — self-hosted, open-source, same "no third-party API dependency"
philosophy as `packages/astronomy` — rather than a paid panchang API
(Prokerala/AstrologyAPI) or scraping Drik Panchang.

## Preview

`auraschedule-dial-preview.jsx` (delivered alongside this zip) is a self-contained
version of the same dial + cards + log flow with the math inlined, for quick visual
iteration without needing the Next.js scaffolding above.
