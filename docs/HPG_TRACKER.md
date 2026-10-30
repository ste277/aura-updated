# HPG (Goal ↔ Plan integration) tracker

| Ticket | Title | Status |
| --- | --- | --- |
| HPG1 | Preserve activity identity in Home → Plan | Merged ([PR #263](https://github.com/ste277/aura-updated/pull/263)) |
| HPG2 | Goal-linked plan creation from the main Plan tab | Merged ([PR #264](https://github.com/ste277/aura-updated/pull/264)) |
| HPG3 | Scheduling eligibility correctness and consistency | **Complete** — see breakdown below |
| HPG4 | Missed/reschedule experience | **Complete** — see breakdown below |

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

## HPG4 — Missed/reschedule experience (complete)

HPG4 is deliberately a separate concern from HPG3: HPG3 made the *enforcement and presentation of scheduling
conflicts* correct and consistent; HPG4 is about what happens when a user **misses** a planned activity, needs
to **recover** from it, or **reschedules** across time. Discovery found the core missed-activity feature
(detection, per-item Skip/Move/Done, Goal-state reversion) already shipped pre-HPG4; HPG4 itself closed three
specific, evidence-based gaps on top of that foundation — delivered as three independently reviewed sub-tickets,
each merged after its own implementation PR and independent GO review:

| Sub-ticket | Title | PR | Merged | Merge commit |
| --- | --- | --- | --- | --- |
| HPG4-1 | Recomposition Conflict Messaging | [#272](https://github.com/ste277/aura-updated/pull/272) | 2026-10-29 | `9236f632180e4a04fd10ff879677ed064e5af663` |
| — | Recomposition CI Coverage (follow-up) | [#273](https://github.com/ste277/aura-updated/pull/273) | 2026-10-29 | `f35d35ab6ed4568f58f766ce0122a3a1b471b4dc` |
| HPG4-2 | Bulk Skip Missed Activities | [#274](https://github.com/ste277/aura-updated/pull/274) | 2026-10-29 | `0e2928c287e9197452d9d11b710d9255d4e717d7` |
| — | CI & Functional Regression Hardening (follow-up) | [#275](https://github.com/ste277/aura-updated/pull/275) | 2026-10-29 | `5aecabb66518f7ff819e0c0ed232a086ec2a9adb` |
| HPG4-3 | Home & Plan Missed-Recovery Consistency | [#276](https://github.com/ste277/aura-updated/pull/276) | 2026-10-30 | `29fcc25723a8d6ecf4faf8274617896ffe6d0e26` |

Each of the 5 PRs above was independently reviewed by a fresh reviewer agent before merge and received an
explicit **GO** verdict (PR #275 required two review rounds: an initial NO-GO over a since-resolved CI
flake plus a demonstrated caller-side test-coverage gap, a follow-up implementation pass, then a second
independent review that returned GO).

### Verified guarantees (confirmed against merged `main`, not just claimed by each PR)

- **Recomposition conflict messaging.** `apps/web/app/api/day/recompose/accept/route.ts` maps the three known
  scheduling-conflict codes to HTTP 409 via the shared `SCHEDULING_ELIGIBILITY_STATUS_BY_CODE` map; `apps/web/components/RecompositionCard.tsx`
  (via `apps/web/lib/homeRecomposition.ts`) now calls `presentSchedulingEligibilityError()` for a known code and
  falls back to the original generic message otherwise — closing the exact gap HPG3's own closure tracker flagged
  above ("Recomposition — typed at the API layer, generic at the UI layer"). Traced the reducer's state
  transitions directly: a fresh `PROPOSAL`/notice state is always built as a new object literal with no
  `noticeCode` carried over from a prior failed attempt — no stale conflict code can leak into a later, unrelated
  proposal.
- **Bulk skip.** `apps/web/lib/homeMissedRecovery.ts`'s `collectSkipAllOutcomes`/`summarizeSkipAllOutcome` are
  the single shared implementation both `apps/web/components/HomeDashboard.tsx` and
  `apps/web/components/PlanWithAuraView.tsx` call — sequential execution (`for...of`/`await`, never `Promise.all`),
  reusing the existing single-item skip mechanism on each surface (no new endpoint), correct all-success/partial/
  all-failed counting, and no optimistic status write before the underlying skip call resolves. Both surfaces
  gate the "Skip all missed" action at ≥2 eligible items and recompute eligibility fresh at click time.
- **Consistency.** Plan tab's missed-activity visibility now depends on a ticking clock value (`useCurrentMinuteOfDay`)
  in addition to `savedPlans`, so eligibility visibly refreshes as time advances, not only on a data mutation —
  mirroring the mechanism Home already used for its own visibility. DONE/SKIPPED plans remain structurally
  excluded: `isMissedPlan` (`derivedPlanLifecycle`) returns a terminal persisted status immediately, before ever
  reaching the time-based MISSED check — traced directly, not assumed. Both surfaces' outcome notice now uses
  `role="alert"` only for a genuine all-failed result and `role="status"` otherwise, matching the established
  `DayPlanPreview.tsx` convention. Home's bulk-skip handler wraps its collection call in an explicit `try/finally`,
  confirmed to release the busy guard even on an unexpected thrown exception, not only on the normal path.

### Remaining items (not yet resolved — do not treat as closed)

- P2: `test/multiOccurrenceRhythmMoveCapacityDb.test.ts`'s "Recomp" check has a demonstrated, bounded,
  midnight-sensitive (Asia/Kolkata) failure window. Original failure: CI run `40926594114`, attempt 1, failing
  assertion `Recomp. the SAME enforcement point is reached via Recomposition acceptance: a same-week self-move
  (not exceeding capacity) SUCCEEDS through applyMoveWrites, proving one shared check, not two` — independently
  traced to ~23:41 IST, 19 minutes before local midnight, squarely inside the test's own documented danger
  window. The rerun of the identical commit passed after the day boundary had rolled over in IST. Accepted as a
  pre-existing, documented residual risk (not introduced or fixed by HPG4); a separate deterministic-clock
  stabilization is still needed. Do not disable or weaken this test to force green.
- P3: the Plan-tab callback's structural regression-test assertion (added in PR #275) matches a long,
  near-verbatim source-text sequence — a future, harmless refactor near those lines will likely need to update
  this regex. Future test-maintenance improvement, not a defect today.
- P3: no DOM-level/component-render test exists anywhere in this codebase for either "Skip all missed" surface.
  Current coverage is pure-function behavioral tests (real `collectSkipAllOutcomes`/`summarizeSkipAllOutcome`/
  `isMissedPlan` calls) plus structural source-text checks on the real production callbacks plus DB-level
  integration tests — never an actual simulated click through the real `onClick` binding. Future
  test-infrastructure improvement.
- P3: PR #276 adds a genuinely new, second `useCurrentMinuteOfDay` interval instance scoped to the Plan tab's own
  mount lifecycle (Home's own instance was not already reaching Plan tab before this PR) — a real, if cheap and
  bounded-by-lifecycle, net-new timer, not merely "reusing an already-running one." Accepted as bounded polling.
- P3: `summarizeSkipAllOutcome([])` (zero attempted, zero succeeded, zero failed) would evaluate the
  `succeeded === 0` role condition as true and render `role="alert"` for a case where nothing actually failed.
  Currently unreachable in practice: both production call sites (Home and Plan) early-return before ever invoking
  the collection path when fewer than 2 items are eligible. Not expanded into a defensive UI change as part of
  HPG4 closure.
