# Onboarding V1 — PR 2 Fresh-Account / First-Run Strategy

**Status:** Documentation only. No code in this document is implemented by
PR 1 (`locationConfirmedAt` / Location Trust Foundation). This is the
required PR 2 design input the PR 1 ticket mandated, not an authorization
to build it yet.

## The problem PR 2 needs to solve

PR 2's Welcome journey needs to answer one question reliably: **is this
account brand new** (so a first-run welcome flow should show), or is it an
**existing account** (so it should never see onboarding again)?

## The heuristic this explicitly rules out

PR 1's own architecture amendment rejected inferring "fresh account" from
the *absence* of feature data — e.g. "no Goals, no Plans, no CustomCity
rows yet". That signal is unreliable in both directions:

- A long-time user who has never created a Goal or a custom location looks
  identical to a brand-new signup.
- A brand-new user who is dropped straight into a demo/seeded state, or who
  completes one action in their first five minutes, stops looking "fresh"
  immediately — even though they never saw a welcome flow.

Absence-of-data is a proxy for *engagement*, not for *account age*. PR 2
must not use it.

## Option A — Explicit account-creation provenance (recommended)

Use signals that are already true facts about the account's own history,
never inferred from whether some unrelated feature has been used yet.
Two already-existing, un-added pieces of state make this possible with
**no new schema**:

1. **`User.createdAt`** (existing, `NOT NULL`, stamped by Postgres at the
   exact moment `upsertUserByEmail` inserts the row — see
   [`db.ts`](../apps/web/lib/db.ts)). This is the literal signup instant,
   not a heuristic.
2. **`VisitLog`** (existing, `apps/web/prisma/schema.prisma`): one row per
   `(userId, calendar day)`, written by `recordVisit` inside
   `GET /api/auth/session` on every session check. `getUserById` already
   runs *before* `recordVisit` in that route (see
   [`route.ts`](../apps/web/app/api/auth/session/route.ts)), so the row for
   "today" has not been written yet at the point a request arrives.

Combining them gives a direct, factual answer: **a session is the user's
very first one ever if and only if no `VisitLog` row exists for that
`userId` at the moment the session check runs** — not "first visit today"
(which `recordVisit`'s own dedupe already tracks), but first visit of any
day, ever.

Concrete mechanism for PR 2 to implement (not implemented here):
- Add a small `isFirstEverVisit(userId): Promise<boolean>` helper in
  `db.ts` that runs a `SELECT count(*) FROM "VisitLog" WHERE "userId" = $1`
  **before** `recordVisit`'s own insert for today, in the same request.
- `GET /api/auth/session` calls it in that order and includes the result
  (e.g. `isFirstSession: boolean`) in its response, the same way it already
  carries the full `User` row.
- The Welcome journey triggers only when `isFirstSession` is `true` on the
  very first session-check response of that browser session — never
  re-derived later, never re-triggered on a later visit.

Why this satisfies the ticket's own constraint ("do not introduce
additional onboarding schema fields without review"): neither `createdAt`
nor `VisitLog` is a new field — both already exist and are already
written on every request for unrelated reasons (signup, session checks).
PR 2 only needs a new *query*, not a new *column*, to turn existing facts
into the one boolean the Welcome journey needs.

**Limitation:** if the Welcome journey itself needs to be resumable across
multiple sessions (e.g. a user starts onboarding, closes the tab, comes
back tomorrow and should resume rather than restart), `isFirstEverVisit`
alone cannot distinguish "never started onboarding" from "started but
didn't finish" — that requires an explicit, reviewed completion flag
(e.g. `User.welcomeJourneyCompletedAt`, deliberately *not* added here,
consistent with the ticket's own deferral). Until that field exists, the
safe fallback (below) is what prevents this gap from becoming a repeat
nuisance.

## Option B — Migration-time cutoff

Treat every `User` row with `createdAt` after a hardcoded constant (the
moment migration `0044_user_location_confirmed_at`, or whichever PR 2's
own migration is, was deployed to production) as "new", and everything
before it as "existing".

**Why this is not recommended:** the cutoff is not actually "when this
feature shipped" in every environment that runs these migrations — it is
"whenever `prisma migrate deploy` happened to run" in *that* database. A
freshly provisioned database (a new staging environment, a CI test
database, a disaster-recovery restore) applies every migration back-to-back
in seconds, long after the real production rollout. In that environment,
a hardcoded production cutoff would misclassify every pre-existing
historical user row as "created after the cutoff" purely because the
*migration* ran recently, even though the *account* did not — exactly the
kind of false "verified"/"fresh" signal this whole feature exists to
avoid. It also requires a magic timestamp constant to be committed to
source and kept correct forever, with no natural way to validate it stayed
correct after the fact.

If Option B were ever chosen despite this, the only safe form is to key
the cutoff off something that is NOT migration-apply-time — e.g. a
separate, explicitly-set `featureLaunchedAt` config value set once at the
real production rollout moment, never derived from `prisma migrate
deploy`'s own timing. This still adds an operational constant to maintain
for a weaker signal than Option A's, which is why Option A is preferred.

## Recommendation

**Option A.** It requires no new schema, no magic constants, and is
immune to the cold-provisioning failure mode that makes Option B
unreliable outside of the exact environment it was tuned for. Its one gap
(mid-onboarding resumability) is real but bounded, explicitly named above,
and does not need to be solved before PR 2 can safely ship a first pass.

## Safe fallback (applies regardless of which option PR 2 picks)

Consistent with the Onboarding V1 architecture amendment's own principles
(carried over unchanged, not re-litigated here):
- If the first-run signal is ever ambiguous or fails to compute (a query
  error, a missing session, etc.), default to treating the account as
  **not fresh** — i.e., skip the Welcome journey rather than risk showing
  it to an existing user, or risk implying anything false about their
  account's history.
- The Welcome journey, whatever it ends up being, must never block general
  app access (Home and every other tab keep working exactly as they do
  today) — the same non-blocking constraint `LocationTrustBanner` already
  follows in PR 1.
- None of this changes `locationConfirmedAt`'s own contract from PR 1:
  confirmation is still stamped only by an explicit, successful
  `PATCH /api/users/location` call, never inferred from first-run status.
