# AURA-CI-07 occurrence 5: PR #392, head a59a934

- **Run:** 45625122499, attempt 1. Failed job: 139243144597 ("Day Constructor acceptance DB tests").
- **Head:** `a59a934dd0b1f3d2ce32a333543a4fbdd21cb72d`. This commit is docs-only on top of `9c32460`; `git diff 9c32460 a59a934` touches only `docs/`.
- **Failure:** `test/goalActivityDailyOccurrenceEligibilityDb.test.ts`, check "6. at most ONE live occurrence exists on the contested day afterward". This is the same check as occurrences 1 to 4.
- **The same code passed:**
  - CI run 45622705665 on `9c32460` (Day Constructor job success);
  - the local fresh-Postgres sweep on `9c32460` (76/76; `docs/android/evidence/rel04-r4-9c32460/db-tests`).
- **No rerun was performed**, following the owner's 2026-11-25 direction for CI-07.
- **Collection:** archived by the REL-04 R4 session on 2026-11-25T13:49Z via read-only `gh` API calls.
