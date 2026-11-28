# AURA-MP-3 — My People: linked plans and Home guidance (62018)

MP-3 builds on MP-1/MP-2 and design AURA-MP-01 §4.3, §4.4, §5.5–5.7 and §6.1.
- **Not changed:** schema, migrations and dependencies.
- **Gating:** My People appears only behind `AURA_MY_PEOPLE_ENABLED` (server) and `NEXT_PUBLIC_AURA_MY_PEOPLE`. It is off in Production.

## Behaviour

| Area | My People ON | OFF (unchanged) |
|---|---|---|
| **Plan with a person** | Selecting a person uses the **main** Find a Time route: Panchang ranking plus the user's own availability and Daily Rhythm. The person is only the plan's link, saved on an explicit "Use this time" with the existing "Planned with {name}" note. A note says to check the time with them; their availability is never assumed | Pre-existing `/api/timing-search/shared` path; no link sent |
| **Entry points** | Home card "Plan something". Person detail "Plan time with {name}" (catch-up). Special day "Plan something": birthday party, anniversary dinner or celebration dinner, over the day before to the day after, never starting before today. All three only pre-fill Plan | Hidden |
| **Quick-add** | Plan "+ Add someone" opens the My People form in place. The new person is selected, and the activity, dates and duration are kept | "+ Choose someone" opens People |
| **Home card** | At most **one** card, placed after Starting soon. It shows the soonest special day inside its own reminder window (7 days by default, on the day only, or off). "+N more" opens My People | Hidden |
| **Dismissal** | Ahead of the day: **Not now** hides the card until the day; **Not this year** hides it for this occurrence. On the day: **Not this year**. Nothing repeats after a choice. Wording is factual, with no counts of neglect or scores | — |
| **Move / Recomposition** | The new plan keeps the person link, through an owner-checked subselect (`lib/planMove.ts`) | Same: existing links are kept |

**Dismissal storage:**
- `POST /api/people/occasions/:occasionId/dismissal` takes `{scope: NOT_NOW | NOT_THIS_YEAR}`.
- It returns 404 when the server switch is off and for any id that isn't the owner's.
- It returns 409 unless the day is inside its reminder window.
- The key is derived on the server from the stored day and the owner's timezone; a date sent by the client is ignored.
- Each dismissal is one `ReminderAttention` row, type `PERSON_OCCASION`, keyed by the occurrence (design §4.4).
- The rows are deleted with the special day or the person (MP-1).
- Upcoming items gain an additive `dismissed` flag.

## Decisions and deferrals (62018)

- **Find route:** the owner chose the main route while My People is on. The shared route and Shared Muhurtham are unchanged while it is off.
- **Deferred:**
  - the person-detail "Together" section (design 5.4), which needs a person-detail API extension;
  - the `call` / `video-call` catalog entries (design 6.1); occasion actions use existing catalog activities;
  - the Home card's optional "good time to call" line (design 5.7, "if computed cheaply").
- **Independent verification requested** for the two authorization and data-integrity changes: the dismissal route, and Move keeping the link.

## R1 — concurrency and data integrity (62020)

Independent verification 62019 found two races on 31b7daf; both reproduced here before the fix. No schema or migration change.

- **F1, orphan dismissal.** The route now checks the special day and writes the dismissal in **one transaction** (`dismissPersonOccasionForOwner`). It reads the day owner-scoped `FOR SHARE` and derives the key from that locked row.
  - Deleting a person now locks that person's special days `FOR UPDATE` **before** it removes their dismissals.
  - A concurrent delete either runs first, so the dismissal returns 404, or waits for the dismissal's COMMIT and then removes the new row.
  - Unrelated reminder rows are untouched.
- **F2, person delete vs plan replacement deadlock.** The lock order is now **person before plan** everywhere.
  - Move (and Home Move through it) and Recomposition take `FOR KEY SHARE` on the people their source plans link to, sorted by id, before `FOR UPDATE` on the plans (`lockLinkedPeopleBeforePlans`). That is the same order a person DELETE uses: the person, then the SET NULL cascade to the plans.
  - `applyMoveWrites` requires that lock and refuses an owned link it does not hold.
  - The fix uses no retries, timeouts or deadlock catching.
- **Audit.** These paths take no plan lock before writing a person link, so they have no equivalent inversion:
  - plan create (`/api/plans`), which writes the link at insert;
  - Day Constructor acceptance, which writes no link;
  - AuraMoment creation, a single statement that only takes a compatible `KEY SHARE` on the plan.
  - The person DELETE's `User` row update conflicts with no Move-side lock.

## Tests

| Test | Job | Checks | Covers |
|---|---|---|---|
| `test/myPeopleMp3Ui.test.ts` | math-core | 19 | Home selection, dismissal keys, hand-offs, wording |
| `test/myPeopleMp3PlanJsdom.test.ts` | math-core | 18 | The real Plan tab with the real timing engine, in both switch states |
| `test/myPeopleMp3Db.test.ts` | Day Constructor DB | 33 | Real routes, Home card, People screen and database |
| `test/myPeopleMp3R1ConcurrencyDb.test.ts` | Day Constructor DB | 25 | Forced interleavings in both orders, using real routes: dismissal vs day/person DELETE, and person DELETE vs Move, Home Move and Recomposition |

All MP-1/MP-2, Find a Time, Move and Recomposition suites run unchanged.
