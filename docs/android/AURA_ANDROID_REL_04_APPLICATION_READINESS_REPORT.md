# AURA-ANDROID-REL-04 — Application Release Readiness

**Date:** 2026-11-24 · **Branch:** `aura-android-rel04-app-readiness`, cut from `main` `ad49e6a`
**Mode:** code review, code fixes, offline tests, local Gradle compile/resource checks. No emulator, ADB, device, signing, Play Console, infrastructure or Production action.

## 1. Verdict

**ANDROID APPLICATION — CODE-LEVEL RELEASE READINESS: COMPLETE FOR WHAT CODE CAN SETTLE. Android release: still NO-GO.**

Every confirmed application defect within REL-04's authority is fixed, has a regression test, and is wired into CI. What is left needs one of three things, none of which can be done in code here:
- **owner decisions** (§10);
- **two product features** that Google Play requires: in-app account deletion and a privacy policy (§9);
- **device acceptance** (§11).

Nothing in this report claims device behaviour. Every runtime claim below comes from source reading, unit/jsdom tests, or a local Gradle task.

## 2. Sources and restrictions

**Sources read.** The original S5-A package (read only), sealed at `~/Desktop/Claude/AuraEvidence/AURA_ANDROID_REL_02_S5_A_TEST_PLAN_CORRECTIONS_AND_SESSION_SAFETY/`:

| File | sha256 (first 8) |
|---|---|
| `S5A_FINDINGS_REGISTER.md` | `f0757999` |
| `S5A_ANDROID_BACKUP_DECISION.md` | `bc0ec57d` |
| `S5A_SERVER_REVOCATION_DECISION.md` | `8efcf449` |
| `S5A_R07_E1_RELEASE_CLASSIFICATION.md` | `673c0070` |
| `S5A_SR02_FRESH_PROCESS_TEST.md` | `5e9d755d` |

Also read: the REL-03 supervised plan R1 §5, the REL-03 functional readiness report and checklist (`docs/android/`), and the current `main` source.

**Restrictions honoured:**
- The REL-03 archive was not touched; P-1 and SAS-0 were not started.
- No emulator, ADB or device was used, and no host configuration was changed.
- No credential or signing operation took place. No APK was packaged, so the debug keystore was never used.
- No Play Console, infrastructure or Production change was made.
- No merge. Auto-fix and Auto-merge are left off.
- The only local files created outside the diff were in this worktree:
  - `apps/web/android/local.properties`, pointing at the existing SDK (gitignored);
  - the generated `capacitor.config.json` (gitignored), written by `npx cap sync`.
- A combined `npx cap sync` modified `apps/web/ios/App/Podfile`. That change was reverted (see §13).

## 3. Implemented fixes

| ID | Defect (confirmed in source) | Fix | Regression test |
|---|---|---|---|
| **REL04-F1 (S5A-F2 / BK-1)** | `android:allowBackup="true"` with no rules. The WebView profile (`app_webview/`: the `as_session` cookie in plaintext, plus Local Storage) goes into cloud backup and device-to-device transfer, so a restore can bring back a session that was signed out after the backup was taken. | **S5-A Option A, exactly as specified:**<br>• `allowBackup="false"`<br>• `fullBackupContent="false"` (API ≤ 30)<br>• `dataExtractionRules`, excluding all 9 domains for both `<cloud-backup>` and `<device-transfer>` (API 31+, where device transfer ignores `allowBackup`)<br>The merged manifest was checked with `processDebugResources`. | `androidRel04AppReadiness.test.mjs` §1 (24 checks) |
| **REL04-F2** | The WebView cookie store was never flushed. Chromium writes cookie changes lazily, so a sign-in or sign-out followed quickly by process death could leave the previous cookie on disk. The fresh process would then show the wrong state, for example signed back in after a sign-out. | `MainActivity.onPause()` calls `CookieManager.getInstance().flush()`, and tolerates a missing WebView provider. It writes only; it changes no cookie. | static §2 (4 checks); device row D-S2 |
| **REL04-F3** | Sign-out reported success it never got. `handleLogout` did `await fetch(logout); setUser(null)`:<br>• on HTTP 5xx the UI showed "signed out" while the cookie stayed valid, so the next launch was signed in again;<br>• offline, it threw and said nothing. | `lib/signOut.ts` `performSignOut()`:<br>• signed out only on a 2xx;<br>• otherwise the alert "Couldn't sign out. Check your connection and try again."<br>Home now uses it. | `signOutRel04.test.ts` (19 checks) |
| **REL04-F4** | The offline activity-log queue (`localStorage.offline_habit_queue`) has no owner. It survived sign-out and replayed under the **next** account that signed in on the device, which is a cross-account data leak on a shared device. | After a confirmed sign-out the queue is cleared. If it still holds entries, the user is first asked: "You have N activity logs that have not synced yet… Sign out anyway?" Cancel keeps both the session and the queue. | `signOutRel04.test.ts` |
| **REL04-F5** | The logout cookie removal omitted the issuing attributes, and the response could be cached. | The removal now uses `HttpOnly`, `Secure` (in production), `SameSite=Lax`, `Path=/` and `Max-Age=0`, plus `Cache-Control: no-store`. | `rel04Rv1TokenReplay.test.ts` |
| **REL04-F6 (REL-03 "search race", P3)** | A slower, older city-search response overwrote newer results or error state. This is more likely on mobile networks. | A per-query sequence id in `LocationPicker`: only the newest request updates results, error or loading. Shortening the query below 2 characters retires the request in flight. | `locationPickerRel04SearchRace.test.ts`: 6/0 fixed, **3 FAIL on the `main` baseline** |
| **REL04-F7 (A4)** | Release builds were not guarded. A release could be built against `http://localhost:3000` (the default), a LAN IP or `10.0.2.2`, with cleartext on, or without `errorPath` (a combined `cap sync`). `versionCode 1` was hard-coded. | New Gradle task `verifyReleaseServerConfig`, wired to `preReleaseBuild` only. It requires:<br>• an `https` URL whose host is not localhost or private;<br>• `cleartext` not true;<br>• `errorPath` set;<br>• WebView floor 91.<br>Versioning now reads validated `-PauraVersionCode` (1…2 100 000 000) and `-PauraVersionName`; the defaults are unchanged. The stale "Railway" production comment was corrected. | Static §3 (11 checks). Local Gradle runs below. |

**Gradle evidence (local, `--offline`, JDK 17, AGP 8.10.1, Gradle 8.11.1):**
- `:app:compileDebugJavaWithJavac` → exit 0.
- `:app:processDebugResources` → exit 0. The merged manifest has `allowBackup="false"`, `fullBackupContent="false"` and `dataExtractionRules="@xml/data_extraction_rules"`.
- `verifyReleaseServerConfig` on four inputs:

| Input | Result |
|---|---|
| Dev config (`http://10.0.2.2:3000`, `cap sync android`) | **blocked**, with 3 problems listed: not https, cleartext, errorPath missing |
| `https://aura.example.invalid` via combined `cap sync` | **blocked**: errorPath missing |
| `https://aura.example.invalid` via `cap sync android` | **passes** |
| `-PauraVersionCode=0` | **rejected** |

- `bundleRelease --dry-run` includes the gate; `assembleDebug --dry-run` does not.

## 4. Authentication and session security

| Question | Finding on `main` |
|---|---|
| Issuance | `verify-code` → `createSessionToken`, which produces HMAC-SHA256 over `{userId, email, exp: +30 d}`. It is set as the `as_session` cookie: HttpOnly, SameSite=Lax, Secure in production, max-age 30 days. |
| Server state / revocation | **None** (S5A-F3, confirmed). There is no session table and no `sessionVersion`. |
| Logout | Clears the cookie in the client that calls it (now with the matching attributes, uncached, and reported honestly to the user: F3, F5). It cannot revoke a copied token. |
| Expiry | Fixed 30-day `exp`, enforced in `verify()`. Not sliding; no refresh token. After expiry, `/api/auth/session` returns `user: null` and the app shows the signed-out state. |
| Deleted user | `/api/auth/session` returns `user: null` when the user row is gone. |
| Account switching | A new sign-in replaces the cookie in this WebView. With F2, the replacement reaches disk when the app is backgrounded. |
| Backup / device transfer | **Closed** (F1). |
| **RV-1 (executed in-process)** | A synthetic token, copied before logout, is **still accepted after logout**, until `exp`. This is the documented residual of revocation Option B; the test asserts it so that a later revocation change has to flip it. The token is rejected after `exp`, and a tampered token is never accepted. No database, network or real account was used. |

## 5. Outstanding Android findings: disposition

| ID | Original requirement (S5-A) | Status on `main` after REL-04 | Class |
|---|---|---|---|
| **FP-0 / S5A-F1** | Fresh-process test of the **S4.2 sign-in guard**: `getSessionCookieState` returning `durable:"fresh_process"` while A's row stays on disk. | **Not applicable to `main` as written.** The S4/S4.1 guard (SessionCookie plugin, `getSessionCookieState`, `fetchWithAndroidSignInGuard`, the transition marker) **is not on `main`**: it was in the HPG2 "live-session auth" lineage that REL-03 deliberately excluded (`git grep` finds none of it). Without that guard the predicted chain cannot occur. The `main`-equivalent risk, process death before the cookie change reaches disk, is reduced by F2 and moved to device row **D-S2**. | Owner decision **O-5** (is the S4 guard required?) + device |
| **R-07** | Require the S4.1 contract v3 `durable:"disk"`. | **Not applicable**: the contract does not exist on `main`. It applies only if O-5 brings the guard back. | Owner decision (O-5) |
| **E-1** | Route `LoginScreen` requests through `fetchWithAndroidSignInGuard`. | **Not applicable**: the guard does not exist on `main`. | Owner decision (O-5) |
| **BK-1** | Inspect a backup archive (API 29 and 34/36) **after** the backup decision is implemented. | Option A **implemented** (F1). Verification is device-only: row **D-S1**. | Device |
| **RV-1** | Replay a synthetic token after logout; expected *accepted*. | **Executed in-process** (§4): accepted. The residual needs the owner's written acceptance. | Owner decision **O-2** |
| **S5A-F4** | The production nginx access log records query strings (`?token=`). | Out of scope for the app. Magic links are already disabled outside local development (AURA-AUTH-02), so `/api/auth/verify` rejects before reading the token. The log setting itself is an infrastructure item. | Infrastructure (recorded) |
| **REL-03 A5: location on API 29–30** | Never observed on a device. | No code defect found. The patched coarse alias is covered by the Java logic tests (15/0, 24/0). | Device **D-L1** |
| **REL-03 A5: Android 15/16 edge-to-edge, keyboard, predictive back, large screens** | Device only. | Code review: insets go to WebView margins (bars, cutout, IME); Back uses `OnBackPressedCallback` everywhere (`MainActivity` and `@capacitor/app` 6.0.3), which is compatible with target-36 predictive back. Capacitor 6 is not officially validated at target 36. | Device **D-U1…D-U4** |
| **REL-03 A5: permission-spinner lifecycle** | F-3: a dropped permission callback leaves the button disabled until remount. | Accepted in M2-D; device only. | Device **D-L5** |
| **REL-03 A5: `errorPath` after `cap sync`** | A combined sync drops it. | **Now enforced for release builds** (F7). | Closed for release |

## 6. Native application experience: review

| Area | Finding | Action |
|---|---|---|
| Native geolocation | Coarse only; plugin patched and gated in Gradle; 30 s native timeout with "Still finding…" at 10 s; late results discarded; F1 supersede present. | No new defect. `maximumAge` stays an owner/privacy decision (O-6). |
| Permission handling / permanent denial | Always asks Android when not granted. On permanent denial, "Open Settings" opens App info (navigates only). On resume, the error clears without prompting. | No new defect; device rows D-L2…D-L4. |
| Timeout / retry | Timers are cleared on settle or unmount; retry is possible after a timeout; single-flight native request. | No new defect. |
| Back button | Covers modals, the history stack, root exit, signed-out exit, fallback pages and kept 4xx pages. | No new defect. |
| Authentication persistence | **F2, F3, F4** fixed. | Done. |
| App lifecycle / resume | Connection page retries once on `onRestart`; briefing refresh on visibility (bounded); location re-check on `resume`; cookie flush on `onPause` (F2). | Done. |
| Offline / network errors | Main frame: network error or 5xx shows the bundled connection page with "Try again"; a 4xx keeps the app's page. In-app: the offline log queue replays on `online` and on mount; search, sign-in and sign-out show typed errors. | Search race (F6) and sign-out (F3) fixed. |
| Mobile layout / safe area | Edge-to-edge on API 29–36. The WebView gets margins equal to the bars, cutout and IME, and insets are consumed so the CSS does not pad twice. Dark bars. | No defect in code; device rows D-U1/D-U2. |

## 7. Release configuration

| Item | State |
|---|---|
| minSdk | **29 (Android 10), preserved**; enforced by the existing static test. |
| target / compile SDK | 36 / 36. Google Play requires target 36 for new apps and updates from 31 Aug 2026. |
| Toolchain | AGP 8.10.1, Gradle 8.11.1, JDK 17; SDK platforms 34 and 36 installed locally. |
| Capacitor | 6.2.1 (pinned at 6 because 7 needs Xcode 16+). Not officially validated at target 36, which is the device risk D-U*. |
| AndroidX | appcompat 1.6.1, core 1.12.0, activity 1.8.0, webkit 1.9.0: Capacitor 6 defaults, compiled cleanly against 36. Upgrading is not needed for release; doing so would be a separate ticket. |
| Manifest | Permissions are INTERNET and ACCESS_COARSE_LOCATION only. One exported launcher activity (required). FileProvider not exported. Backup and transfer off (F1). No `usesCleartextTraffic`. Release cleartext is blocked by F7. |
| Release build type | `minifyEnabled false` (Capacitor plugins use reflection; no R8 keep rules were prepared). Not debuggable by default. **No signing config** (signing is an owner action). |
| Versioning | `-PauraVersionCode` (must increase on every Play upload) and `-PauraVersionName`. Defaults stay 1 / "1.0". |
| 16 KB page size | The app ships no native `.so` of its own (Capacitor and plugins are Java/Kotlin). Confirm on the built AAB (RC-7). |

**AAB build procedure (for the RC; not executed):**
1. In `apps/web`: run `npm ci`. Scripts must stay enabled, because the geolocation patch is gated.
2. `CAP_SERVER_URL=https://<production-host> npx cap sync android` (Android only, never a combined sync).
3. `cd android && ./gradlew bundleRelease -PauraVersionCode=<n> -PauraVersionName=<x.y.z>`. The gate runs first; the output is an **unsigned** `app/build/outputs/bundle/release/app-release.aab`.
4. The owner signs it with the **upload key**, outside the repo. Play App Signing holds the app signing key.

## 8. Validation results (this branch)

**New tests (all wired into CI):**
- `androidRel04AppReadiness.test.mjs`: **48/0**
- `signOutRel04.test.ts`: **19/0**
- `rel04Rv1TokenReplay.test.ts`: **8/0**
- `locationPickerRel04SearchRace.test.ts`: **6/0** (3 FAIL on the baseline)

**Existing suites, re-run on this branch:**

| Suite | Result |
|---|---|
| Android minimum support (static) | 74/0 |
| COMPAT-03 patch script | 21/0 |
| COMPAT-03 Java logic | 15/0 |
| COMPAT-03 Java logic harness | 24/0 |
| COMPAT-05 shortOffset | 160/0 |
| clientId | PASS |
| back navigation | PASS |
| location search API | PASS |
| LocationPicker smart selection | PASS |
| LocationPicker native geolocation | PASS |
| reverse-geocode POST route | 19/0 |
| M2-D reliability | 63/0 |
| timeout diagnostics | 14/0 |
| StrictMode lifecycle | 19/0 |
| REL-03 supersede | 14/0 |
| IOS-02 errors and privacy | 35/0 |
| pending activity reload visibility | PASS |

**Type check and Gradle:** `apps/web` `tsc --noEmit` clean. The Gradle checks are listed in §3.

**Not run:**
- DB-backed suites;
- anything needing an emulator, ADB, a device, signing, secrets, the network or Production;
- APK or AAB packaging.

## 9. Remaining application blockers

| # | Blocker | Needs |
|---|---|---|
| **B-1** | **In-app account deletion is missing on `main`.** Google Play requires apps that create accounts to offer deletion in the app and through a web link. It existed only in the unmerged HPG2 lineage. | A product feature (schema and API), plus owner scoping |
| **B-2** | **No privacy policy page** on the app origin. Play requires one, and it feeds the Data safety form (email, approximate location, activity logs). | Content and owner approval |
| **B-3** | Production `CAP_SERVER_URL`: which hosted HTTPS origin the release loads. | Owner decision (O-4) |
| **B-4** | Device acceptance (§11), including BK-1 and the D-S rows. | Supervised run (REL-03 R2 or alternative) |
| **B-5** | Upload key, Play App Signing enrolment, Play Console set-up. | Owner (RC-4…RC-6) |

## 10. Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| **O-1** | Ratify backup **Option A** as implemented (F1). The S5-A decision box was unsigned. | Ratify. After a phone change the user signs in again. |
| **O-2** | Revocation: **Option B**. Accept in writing the residual of up to 30 days for a copied token (RV-1 confirmed it), optionally with a shorter lifetime, and schedule a `sessionVersion` revocation before wider rollout. | B now; `sessionVersion` before wider rollout. |
| **O-3** | Discarding the offline queue on sign-out after the prompt (F4). The alternative, binding queue entries to a user id, is a larger change. | Accept as implemented. |
| **O-4** | Production origin for `CAP_SERVER_URL`. | The Production domain already serving the web app. |
| **O-5** | Is the S4/S4.1 sign-in guard (FP-0, R-07, E-1, RV-02 lineage) required for release, or is `main`'s simpler model (server cookie, plus F2 and F3) acceptable? | Accept `main`'s model for a controlled release, with D-S2 and D-S3 passing on a device. Revisit if device testing shows stale sessions. |
| **O-6** | `maximumAge` 5–10 min for the location fix (privacy sign-off), and whether to hide GPS when city lookup is not configured. | Carried from REL-03. |
| **O-7** | Ratify minSdk 29 and target 36 (REL-03 governance caveat). | Ratify. |
| **O-8** | Account deletion scope (B-1) and privacy policy text (B-2). | Required before any Play track beyond internal testing. |

## 11. Consolidated final device acceptance checklist

**Rules carried from REL-03:**
- one build SHA; a disposable account; a non-production backend;
- no coordinates recorded;
- 0 FATAL / 0 ANR; no spinner over 31 s;
- record device, API level and location settings.

**Device coverage:** API 29 or 30, API 34, and API 36 (physical where marked P).

| # | Area | Steps | Pass |
|---|---|---|---|
| R1–R10 | REL-03 rows 1–10 (launch, permissions, deny, Settings recovery, GPS and timeout, F1 supersede, manual city, background, Back, Find a Time, save and sign-in) | As in `AURA_ANDROID_REL_03_DEVICE_ACCEPTANCE_CHECKLIST.md` | As written there |
| **D-S1 (BK-1)** | Backup and transfer | Signed in on the debug RC: `bmgr backupnow` with a local transport (API 34/36) and `adb backup` (API 29/30); list the archive; on API 31+, a device-transfer emulation if available | No `app_webview/` (and no app data) in any archive or transfer. After restore or transfer the app opens **signed out**. |
| **D-S2** | Cookie persistence across process death | (a) Sign in → background within 3 s → swipe from Recents → cold launch. (b) Sign out → background within 3 s → swipe → cold launch. Repeat 5×. | (a) always signed in; (b) always signed out |
| **D-S3** | Honest sign-out | Airplane mode → Sign out | The alert "Couldn't sign out…" appears and the app stays signed in. Online again → Sign out → signed out. |
| **D-S4** | Queue on sign-out | Offline, log 2 activities → online server down → Sign out | The prompt names 2 logs. Cancel keeps both the session and the logs; OK signs out. Signing in as B never shows A's logs. |
| **D-S5** | Account switch | Sign out A → sign in B → cold launch | B is shown; A never reappears |
| **D-L1** | Location on API 29–30 (P preferred) | Run REL-03 rows 2–5 | A fix or a clean timeout; never a crash |
| **D-L2…L4** | Permission flows on API 34/36 | REL-03 rows 3, 4, 4b | As written there |
| **D-L5** | Permission-spinner lifecycle | Rotate, toggle dark mode, and background while the dialog is open | No duplicate dialog; the button returns within 31 s, or F-3 is recorded |
| **D-L6** | Search race (optional) | Throttled network: type "Ko", then "Kollam" | Kollam results remain |
| **D-U1** | Edge-to-edge (API 35/36, and API 29) | Every tab, modal and sheet; gesture and 3-button navigation; cutout device | Nothing under the bars or cutout; no double padding |
| **D-U2** | Keyboard | Sign-in code field, location search, notes | The focused field stays visible; the layout recovers on close |
| **D-U3** | Predictive back (API 36) | Back gesture from a modal, a sub-tab and the root | Matches REL-03 row 8; no premature exit |
| **D-U4** | Large screen / fold | Tablet or resizable emulator; rotate | Usable layout; no clipped content |
| **D-N1** | Connection page | Server down → launch; then server up → "Try again" | The page shows; one retry loads the app; Back exits |
| **D-N2** | WebView floor | Device or emulator with WebView below 91 (if obtainable) | `unsupported-webview.html` shows |
| **D-R1 (P)** | Release build from the internal track | Install the Play-signed build from internal testing; repeat R1, R2, D-S2, D-S3 | All pass on a physical device |
| **D-R2** | Play pre-launch report | Review it after the internal upload | No crash or ANR; accessibility warnings triaged |

## 12. Release-candidate preparation requirements

| # | Item | Owner / where |
|---|---|---|
| RC-1 | Merge this PR after review and CI | Owner approval |
| RC-2 | Resolve B-1, B-2 and O-1…O-8 | Owner / product |
| RC-3 | Choose the RC commit; build the debug RC for device acceptance (§11) | Engineering, with authorization |
| RC-4 | Google Play developer account. If it is a personal account created after Nov 2023, a closed test (12+ testers for 14 days) is required before production. | Owner |
| RC-5 | Play App Signing enrolment; generate the **upload key** and store it outside the repo, with a recorded backup | Owner |
| RC-6 | Store listing, content rating, Data safety (email, approximate location, activity data; encrypted in transit; deletion per B-1), privacy policy URL, target audience, internal tester list | Owner |
| RC-7 | Build the AAB (§7) with `auraVersionCode` ≥ 1; confirm 16 KB alignment and that no debuggable flag is set (`bundletool` / APK Analyzer) | Engineering, with authorization |
| RC-8 | Upload to **internal testing** only; run D-R1 and D-R2 | Owner GO |

## 13. Observations (not fixed; outside scope)

- **iOS Podfile drift:** a combined `npx cap sync` adds the `CapacitorApp` and `CapacitorGeolocation` pods to `apps/web/ios/App/Podfile`, which `main` does not list. iOS is outside REL-04; the change was reverted here and needs an iOS ticket.
- **Pre-existing deprecation notes:** `MainActivity` calls `setStatusBarColor` and `setNavigationBarColor` below API 35 only. These are expected; no action.
- **R-8 (web only):** an ignored browser permission prompt leaves the web button busy. This is unchanged and web only.
