# CI stability note: run 45870363531, `multiOccurrenceRhythmMoveCapacityDb` (separate from the R11 findings)

This is recorded separately from the R11 implementation findings. **The test is not modified in PR #392.**

| Item | Value |
|---|---|
| Run | 45870363531, attempt 1, triggered automatically by the push of `abdd9d8` (not requested; not rerun) |
| Result | **8/9**. "Day Constructor acceptance DB tests" (job 140083882465) failed; the other 8 jobs succeeded |
| Integration commit | `aa2bcc2` = merge of `abdd9d8192b77b9fcb844e9ad1e98cddded9b230` into `main` `a39f3982eda3004862f360534ad606deb4599985` |
| Failing assertion | `FAIL Recomp. the SAME enforcement point is reached via Recomposition acceptance: a same-week self-move (not exceeding capacity) SUCCEEDS through applyMoveWrites, proving one shared check, not two` |
| Execution time | 2026-11-26T17:56:14.88Z, which is **23:26:14 IST**, 33 min 46 s before Asia/Kolkata midnight |
| Local reproduction | The local sweep at `abdd9d8` failed with the same assertion (command 72) at about 18:06Z, **23:36 IST** |
| Earlier passes | `main` `a39f398`, run 45866701816 at 17:19Z (22:49 IST), 7/7; PR runs 45862518425 (4a37173) and 45858803540 (8f3d316), 9/9 |

## Test code

Lines 300–334 of `test/multiOccurrenceRhythmMoveCapacityDb.test.ts` are preserved in this folder. The relevant part:

```
const todayLocalDateRecomp = getDatePartsInTimezone(TZ, new Date()).dateStr;      // TZ = 'Asia/Kolkata'
const tomorrowMidnightUTC = Date.UTC(midY, midM - 1, midD) - 5.5 * HOUR;
const remainingTodayMs = tomorrowMidnightUTC - Date.now();
const leadMs = Math.max(MIN, Math.min(20 * MIN, remainingTodayMs - 15 * MIN - 20 * MIN - 2 * MIN));
const recompBase = Math.ceil((Date.now() + leadMs) / MIN) * MIN;
const recompDest = recompBase + 15 * MIN;          // the moved item runs 20 min from here, on targetDate = today
```

The test's own comment calls this "a real-wall-clock-dependent window, same accepted residual risk".

**Suspected cause (wall clock, not R11).** With fewer than about 36 minutes left in the local day, the 1-minute minimum lead, the 15-minute move offset and the 20-minute item put the moved item past midnight. The same-day Recomposition move is then not accepted.

Both failures ran at 23:26 and 23:36 IST, inside that window. R11 changes only `apps/web/lib/offlineHabitQueue.ts` and `apps/web/lib/signOut.ts`, and the suite imports neither.

**Status:** open CI stability issue. A rerun outside the window would not close it.

## Preserved here (sha256 in `SHA256SUMS`)

- `job-140083882465-day-constructor.log`: the full job log;
- `run.json` and `jobs.json`: the run and job metadata;
- `multiOccurrenceRhythmMoveCapacityDb.lines300-334.ts.txt`: the test code above;
- `test-blob-sha.txt`: the git blob of the test at `abdd9d8`.
