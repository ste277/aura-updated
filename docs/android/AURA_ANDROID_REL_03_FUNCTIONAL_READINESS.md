# AURA-ANDROID-REL-03 — Android Functional Readiness

**Date:** 2026-11-21 · **Mode:** code review, offline tests, one targeted fix
**Branch:** `android/rel-03-functional-readiness`, cut from `main` `5a3c205`.
**Provenance:** the review ran on an unreviewed snapshot of the uncommitted M2-B → AND-MIN-01 tree from another local worktree. This branch carries **only the Android/location subset** of that snapshot, plus fix F1. Excluded: account deletion, the live-session auth change, iOS notifications and the iOS Podfile, and the PR #344 notification permission. The original implementer of the M2-B → AND-MIN-01 lineage is **unknown** (see ALT01). All results below were re-run on this branch.

## 1. Readiness assessment

**Verdict: READY FOR PHYSICAL-DEVICE ACCEPTANCE TESTING. Not release-ready.**

| Area | Status | Evidence (re-checked here) |
|---|---|---|
| Builds | **PASS (compile only)** | `cap sync android` OK; `gradlew --offline :app:compileDebugJavaWithJavac` exit 0; `verifyGeolocationCompatPatch` exit 0. No APK packaged, so the debug keystore was never used. |
| Launches | **PENDING LIVE** | Needs a device. The last device run was M2-D-P1 (Samsung SM-A066B, API 36): 0 FATAL, 0 ANR. |
| Back button | **Implemented** | `useAndroidBackButton`, `useAndroidBackToHome`, `MainActivity` OnBackPressed fallback-page handling; `androidBackNavigation` test PASS. |
| Location permission flows | **Implemented** | Coarse-only request; always asks Android when not granted (M2-D F-1); permanent denial → Settings. Tests PASS (M2-D 63/0). |
| `crypto.randomUUID` crash | **Fixed** | `lib/clientId.ts` falls back to `getRandomValues`. No client-side `crypto.randomUUID` remains (only server `node:crypto` in `db.ts` and `planMove.ts`). `clientId` test PASS. |
| StrictMode lifecycle | **Fix present** | `isMountedRef` is restored on re-mount; StrictMode lifecycle test 19/0. |
| Navigation and onboarding | **Static/jsdom PASS; device PENDING** | Onboarding location step last passed on a device in M2-D-P1. |

**Governance caveat (P1, process):** before this PR, `main` had none of the native geolocation, back-button, Settings or `clientId` work; it existed only as uncommitted changes. The implementer of that lineage is unidentified (ALT01). minSdk 29 and the API 36 compile/target are not owner-ratified.

## 2. Known gaps (A–E) and confirmed defects

| Gap | Finding |
|---|---|
| **A. GPS acquisition** | **Most likely environmental, with one app-side factor.** In M2-C the attempts that returned nothing ran with no network or no SIM: the fused provider (balanced priority, needed for coarse) returned `null` at about 30 s (H6 confirmed, H5 plausible). M2-D-P1 later got 6/6 fixes in about 0.2 s with Wi-Fi and Google Location Accuracy on. App-side factor: Aura never passes `maximumAge`, so the plugin's last-known-location shortcut is disabled (`maximumAge=0`). **Not changed here.** It is M2-C recommendation #5 and needs a privacy sign-off (see §7). |
| **B. 10 s vs 30 s timeout** | **Already fixed in the M2-D tree.** Native app timeout is 30 s, the "Still finding…" progress message shows at 10 s, and the web timeout stays at 10 s. Timers are cleared when the request settles or the picker unmounts, and late results are discarded. Re-verified (timeout diagnostics 14/0, M2-D 63/0). A natural device timeout has never been observed (B-2). |
| **C. Permanent denial** | **Adequate.** The message explains the problem and an Android-only "Open Settings" button opens App info (`ACTION_APPLICATION_DETAILS_SETTINGS`; it navigates only and changes nothing). A direct link is appropriate and already present. On resume the app re-checks and clears the error, and never prompts or acquires by itself. "Return with permission granted" is still device-only (B-1). |
| **D. City lookup (OpenCage)** | **Missing key handled correctly.** Without a key, both routes return 503 `configured:false` *before* the request body is read, so the coordinates are never parsed. The UI says "City lookup is temporarily unavailable" and offers search or manual entry. The key is server-only, never logged, and never sent to the client. No key was created or read. Minor UX point: the app still asks for location permission when lookup can't work (§7). |
| **E. Lifecycle/navigation** | **One defect found and fixed (F1).** Back, unmount, resume and retry-after-denial behave correctly in the existing suites. |

### F1 — late GPS result overrode the user's own choice (**fixed**, P2)
- **Repro:** tap *Use my current location*; while "Still finding…" is showing, pick a search result (or save a city from the dropdown). When the native fix arrives (any time up to the 30 s wait), it replaces the picked result in the confirmation card, or opens an unexpected GPS card after the city was already saved. The 30 s window from M2-D makes this more likely.
- **Fix:** `supersedeGpsOp()` in `LocationPicker.tsx` retires the running GPS UI operation when the user picks a search result, picks a curated city, submits manual entry, or confirms the current city. It is UI only. The native request can't be cancelled and stays tracked in single-flight, so a later tap joins it. Permissions, saving and geocoding are unchanged.
- **Regression test:** `test/locationPickerRel03Supersede.test.ts`, 14/0 with the fix and **4 failures on the baseline**. It is wired into CI.

### Observations, not fixed (out of scope or accepted)
- F-3 (P3, accepted in M2-D): if Android drops the permission callback, the button stays disabled until the picker remounts. Device-only.
- Search race (P3, web and Android): a slow, older search response can overwrite newer results. No abort or sequence guard.
- R-8 (web only): an ignored browser permission prompt leaves the web button busy.

## 3. Fix
| ID | Files | Commit |
|---|---|---|
| F1 | `apps/web/components/LocationPicker.tsx` (+23/−1), `test/locationPickerRel03Supersede.test.ts` (new), `test/locationPickerSmartSelection.test.ts` (regex updated; same invariant plus one new check), `.github/workflows/ci.yml` (+1 step) | Included in this PR |

## 4. Offline test results (fixed tree)
All PASS: REL-03 supersede 14/0 · M2-D reliability 63/0 · timeout diagnostics 14/0 · StrictMode 19/0 · IOS-02 errors/privacy 35/0 · N2 alert cleanup 41/0 · reverse route POST 19/0 · smart selection 37/0 · native geolocation · location search API · clientId · back navigation · customLocationUx · trust disclosure · confirmation unification · save-failure state · minimum support 74/0 · COMPAT patch script 21/0 · Java logic 15/0 · Java harness 24/0 · `tsc --noEmit` (apps/web) 0 errors · Gradle Java compile and patch gate OK.
Not run: DB-backed suites and anything requiring adb, an emulator, AVD, Block 0, signing or secrets.

## 5. Device-only tests still pending
Launch; natural GPS fix under poor network; natural 30 s timeout (B-2); Settings → allow → return (B-1); one-time permission expiry; background/foreground mid-request on the current build; dropped permission callback (F-3); F1 on a device; reverse geocoding with a real key (needs separate approval); sign-in on the device.

## 6. Checklist
See `AURA_ANDROID_REL_03_DEVICE_ACCEPTANCE_CHECKLIST.md`.

## 7. Recommended next milestone — **AURA-ANDROID-REL-04: Device Acceptance Run**
1. **Owner decision first:** how the uncommitted Android lineage reaches `main` (land PR #344 plus this tree as reviewed commits, or split it). Without that, there is no stable build to accept.
2. Run the checklist on the Samsung API 36 device, plus one API 29–30 device (coarse acquisition there has never been proven).
3. Decisions to take alongside: `maximumAge` of 5–10 min (privacy sign-off); whether to hide GPS when lookup isn't configured; the OpenCage key for the test environment.
4. Security stays separate. Rev 6.6 stays frozen. DR-66 goes to a person or a model outside this lineage. R66-ADB, RA-04, D-2 and R66-10 stay unresolved. This report certifies no security work.
