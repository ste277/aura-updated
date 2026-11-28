# AURA-MP-2 — My People: mobile profiles and occasions (62016)

MP-2 is UI only. It builds on the MP-1 API (#400) and design AURA-MP-01 §5.1–5.4.
- No schema, migration, API or validation change.
- No dependency change.
- Merge review only; no independent review is required. MP-2 adds no new security, privacy or data path: every read and write goes through the existing owner-scoped MP-1 routes.

## What ships (dark: only when `AURA_MY_PEOPLE_ENABLED=1` and `NEXT_PUBLIC_AURA_MY_PEOPLE=1`)

| Area | Behaviour |
|---|---|
| **Entry** | **You → My People** ("The people who matter most"). No new tab. When the public flag is off, the row stays "People" |
| **Overview** | Shows **Coming up** first: the next 30 days, in date order. The section is hidden when empty. A "Soon"/"Today" marker appears inside each day's own reminder window. Then the people list: initial avatar, relationship (plus custom label), and the next special day. Empty state uses the approved copy |
| **Person** | Add, view, edit and delete. Name is required; everything else is optional. Optional fields: relationship (none preselected), a custom label ("Amma"), and a private note. The note shows only on the detail page, marked "Only you can see this". Detail order: header, special days, note, chart details, remove |
| **Special days** | Birthday (one per person), anniversary, or another named date. Day and month are required; the year is optional (1900–this year). The age or anniversary number shows only when the year is known |
| **29 February** | Accepted. With a year, only a leap year is accepted. In other years it is marked on 28 Feb and labelled "(for 29 Feb)" (D4) |
| **Reminders (D5)** | In-app only. Three choices: a week before and on the day (the API default, 7), on the day only (0), or no reminder (null). A saved value outside those three is kept. The surfacing rule `0 ≤ daysUntil ≤ remindDaysBefore` is the unchanged MP-1 one |
| **Birthday copy (D3)** | Add with a chart birth date offers "Also remember their birthday", **unchecked**. The special-day form offers "Use the birth date from chart details" only on request. Nothing is ever synced afterwards |
| **Delete** | Uses the approved MP-1 confirmation and the atomic MP-1 delete. Special days cascade; plans stay |

**Field contract** (same as MP-1 R4):
- An untouched optional field is omitted, so the API default stands.
- An edit sends only the fields that changed. An emptied field is sent as `null`.
- An invalid date is refused before any request.
- Helpers: `apps/web/lib/myPeopleOccasionUi.ts`.

## Tests

- **`test/myPeopleMp2Ui.test.ts`** (math-core job): formatting, optional year, 29 February, reminders, and payload rules.
- **`test/myPeopleMp2Db.test.ts`** (Day Constructor DB job): the real screen, real routes and real database. It covers:
  - Add, View, Edit and Delete journeys;
  - special-day create, edit and delete;
  - birthday copy;
  - Coming up;
  - owner isolation;
  - cascade;
  - the switch: server off, public flag off, and re-enabled.
- **Existing suites:** all MP-1 suites (R1–R4) and SavedPerson pass unchanged.

## Scope decisions (62016 completion, 2026-11-28)

- **Accepted as is:** the relationship dropdown and the form with all fields shown at once.
- **Moved to MP-3:** the Plan "+ Add someone" quick-add.
- **Deferred:** editing location and interests. Existing stored values are preserved, because the UI never sends those fields.
- **Corrected:** the people list now shows "(for 29 Feb)" like Coming up and the detail page.
  - How: the list reads the leap-day flag from the upcoming API over its maximum 60-day window, which is the same window the list uses. Coming up still shows 30 days.
  - Scope: UI only; no API change.
  - Test: `test/myPeopleMp2LeapDayJsdom.test.ts`.

## Not in MP-2

- **MP-3:** Home card, Plan / Find a Time with a person, "Not this year" dismissal, Plan quick-add.
- **MP-4:** rhythms.
- **Excluded:** push notifications, contact import, invitations.
