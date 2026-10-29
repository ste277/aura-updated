# HPG (Goal ↔ Plan integration) tracker

| Ticket | Title | Status |
| --- | --- | --- |
| HPG1 | Preserve activity identity in Home → Plan | Merged ([PR #263](https://github.com/ste277/aura-updated/pull/263)) |
| HPG2 | Goal-linked plan creation from the main Plan tab | Merged ([PR #264](https://github.com/ste277/aura-updated/pull/264)) |
| HPG3 | Scheduling eligibility correctness and consistency | **Complete** — see breakdown below |
| HPG4 | Missed/reschedule experience | Scope under discovery — not started |

## HPG3 — Scheduling eligibility correctness and consistency (complete)

HPG3 enforces GoalActivity daily/weekly frequency rules consistently across every scheduling writer, and
presents the resulting conflicts to users with accurate, non-technical, consistent messaging. It was delivered
as six independently reviewed sub-tickets, each merged after its own implementation PR and independent review:

| Sub-ticket | Title | PR | Merged |
| --- | --- | --- | --- |
| A1 | Daily Occurrence Data-Model Foundation | [#265](https://github.com/ste277/aura-updated/pull/265) | 2026-10-28 |
| A2 | Transactional Daily Occurrence Enforcement | [#266](https://github.com/ste277/aura-updated/pull/266) | 2026-10-28 |
| A3a | Scheduling Eligibility Error Contract | [#267](https://github.com/ste277/aura-updated/pull/267) | 2026-10-28 |
| A3b | Existing-Session Scheduling UX | [#268](https://github.com/ste277/aura-updated/pull/268) | 2026-10-29 |
| A4a | Home Quick-Move Scheduling Error Consistency | [#269](https://github.com/ste277/aura-updated/pull/269) | 2026-10-29 |
| A4b | Recomposition Error Propagation and CI Coverage | [#270](https://github.com/ste277/aura-updated/pull/270) | 2026-10-29 |

### Verified guarantees (confirmed against merged `main`, not just claimed by each PR)

- **Shared enforcement.** All four real scheduling writers — Plan creation (`apps/web/app/api/plans/route.ts`),
  Day Constructor acceptance (`apps/web/lib/dayConstructorAcceptancePersistence.ts`), Move
  (`apps/web/lib/planMove.ts`), and Remaining-Day Recomposition (`apps/web/lib/remainingDayRecompositionAcceptance.ts`) —
  take the identical per-user advisory lock and call the same shared `db.ts`/`planMove.ts` eligibility functions.
  No writer has its own ad hoc eligibility logic.
- **Consistent presentation — Plan-with-Aura, Day Constructor, and Home quick-Move.**
  `apps/web/lib/schedulingEligibilityPresentation.ts` produces five distinct, accurate, non-technical messages
  (weekly capacity, daily capacity, unresolved legacy attribution, archived Goal, general unavailability), and
  `presentSchedulingEligibilityError()` is actually called from `apps/web/components/PlanWithAuraView.tsx`,
  `apps/web/lib/dayPlanAcceptancePresentation.ts`, and `apps/web/lib/homeMove.ts` — confirmed by direct call-site
  inspection, not just by file presence.
- **Recomposition — typed at the API layer, generic at the UI layer (not yet consistent).** Remaining-Day
  Recomposition's accept route (`apps/web/app/api/day/recompose/accept/route.ts`) preserves the three recognized
  scheduling-conflict codes and returns HTTP 409 for them, same as every other writer. However, its *UI*
  (`apps/web/components/RecompositionCard.tsx`, via `apps/web/lib/homeRecomposition.ts`) does **not** call
  `presentSchedulingEligibilityError()` — it reads only the response's `status` field and shows one generic
  "Couldn't save. Nothing was changed. Try again." message for every `SAVE_FAILED` outcome, regardless of cause.
  This is a real, verified gap, not something HPG3 resolves — tracked below as its own follow-up item, not as
  already-solved.
- **Typed HTTP contract.** The three genuine scheduling-conflict codes (`CAPACITY_EXCEEDED`,
  `DAILY_CAPACITY_EXCEEDED`, `DAILY_ATTRIBUTION_UNRESOLVED`) consistently return HTTP 409 everywhere they can
  occur. Plan creation, Day Constructor acceptance, and Recomposition's route all import and use one shared
  status map, `SCHEDULING_ELIGIBILITY_STATUS_BY_CODE`; Move's own route (`apps/web/app/api/plans/[planId]/move/route.ts`)
  currently retains a separately defined, value-equivalent `STATUS_BY_CODE` map (same three codes, same 409)
  rather than importing the shared one — behaviorally consistent, not literally one map used everywhere.
  Unrelated failures retain their original, unchanged fallback behavior and status codes.
- **Active Home Recomposition consumer — audit correction.** An earlier HPG3-A4 audit incorrectly stated that
  Remaining-Day Recomposition's accept endpoint had no UI consumer. It does: `apps/web/components/HomeDashboard.tsx`
  instantiates a live `createRecompositionStore()` action that calls it via `apps/web/lib/homeRecomposition.ts`.
  This was independently verified compatible with A4b's change — that consumer only reads the response's
  `status` field, never the newly-added `code`, so A4b's HTTP 500→409 change is behavior-preserving for it.
  (Recorded on [PR #270](https://github.com/ste277/aura-updated/pull/270) at the time; recorded here as the
  permanent correction to the historical record.)

### Remaining items

**Verified UX follow-up (surfaced by this closure's own review — not pre-existing, not yet fixed):**

- P3: Recomposition's accept-failure UI (`apps/web/components/RecompositionCard.tsx`) does not yet distinguish
  the three typed scheduling-conflict codes from any other save failure — see "Recomposition — typed at the API
  layer, generic at the UI layer" above. A small, independent follow-up (same shape as HPG3-A4a's Home quick-Move
  fix) would wire it to `schedulingEligibilityPresentation.ts` the same way the other three surfaces already are.

**Pre-existing test-maintenance housekeeping (not HPG3 defects, predate HPG3, do not block HPG3 closure):**

- P2: `test/goalActivityRhythmGoalDetailStructuralGuards.test.ts`'s DDL-match regex lacks whitespace tolerance
  between `ADD COLUMN` and a quoted column name (narrow, low-likelihood gap; from PR #181's independent review).
  This file *is* wired into CI — the gap is in the regex's precision, not in CI coverage.
- P3: `test/goalPlanningHandoffWiring.test.ts` check 27 was loosened from an exact `throw new Error` match to a
  generic `throw` match during HPG3-A3a (minor, non-critical broadening).
- P3: several structural-guard/fixture staleness issues (overbroad regexes matching migration comment prose,
  a stale hardcoded migration count) remain undetected because the affected test files are not wired into CI.
- `test/goalActivityRhythmSetupUi.test.ts` remains intentionally excluded from CI pending a maintainer decision
  (update it to the current `CreateGoalModal` shape, or retire it) — unrelated to HPG3.

**Broader CI-coverage scope (distinct from the above, do not conflate):** the items above are specific, named
issues. Separately, and much more broadly, a large number of this repository's `test/*.test.ts` files — on the
order of 180+, by rough count, spanning well beyond HPG3's own area — have no reference anywhere in
`.github/workflows/ci.yml` at all. This is a long-predating, repo-wide condition, not something HPG3 claims to
have fixed or even meaningfully narrowed. What HPG3 *did* do, specifically and only, is wire its own required
regression suites (the ones its own six sub-tickets added or depended on — e.g. `schedulingEligibilityErrorContractDb.test.ts`,
`goalActivityDailyOccurrenceEligibilityDb.test.ts`, `multiOccurrenceRhythmMoveCapacityDb.test.ts`,
`homeMoveDb.test.ts`, `remainingDayRecompositionErrorPropagationDb.test.ts`) into CI, and confirmed those are now
wired and passing. This tracker does not claim, and should not be read as claiming, that CI now executes all
repository tests — it does not.

## HPG4 — Missed/reschedule experience (scope under discovery)

HPG4 is deliberately a separate concern from HPG3: HPG3 made the *enforcement and presentation of scheduling
conflicts* correct and consistent; HPG4 is about what happens when a user **misses** a planned activity, needs
to **recover** from it, or **reschedules** across time — a different part of the product. HPG4 implementation
has **not started**. Its scope is being discovered and proposed via a dedicated read-only investigation (see
that report for the current missed/reschedule behavior matrix, verified gaps, and a proposed PR sequence). This
tracker will be updated again once that proposal is reviewed and a first HPG4 ticket is actually opened.
