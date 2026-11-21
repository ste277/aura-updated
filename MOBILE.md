# Mobile shells (Capacitor)

One web codebase serves desktop browsers, iOS, and Android. The native apps are
thin Capacitor webview shells (`apps/web/ios/`, `apps/web/android/`) that load
the web app by URL — they contain no app logic. The backend stays hosted; the
shells are never bundled with it.

Capacitor **6** is pinned deliberately: Capacitor 7 requires Xcode 16+. Upgrade
to 7 when the dev machine's Xcode is updated.

## Supported platform baseline

| | Value | Source of truth |
|---|---|---|
| Android minimum SDK | **API 29** (Android 10) | `apps/web/android/variables.gradle` (`minSdkVersion`) |
| Android compile SDK | API 36 | `apps/web/android/variables.gradle` (`compileSdkVersion`) |
| Android target SDK | API 36 | `apps/web/android/variables.gradle` (`targetSdkVersion`) |
| Minimum Android System WebView | **91** | `apps/web/capacitor.config.ts` (`android.minWebViewVersion`) |
| iOS deployment target | iOS 13.0 | `apps/web/ios/App/Podfile` (`platform :ios`) |

- Android **API 22–28 is outside the supported range**. With `minSdkVersion`
  29, the app no longer installs on those versions.
- WebView 91 is the lowest version validated end to end. Below the floor,
  Capacitor shows the bundled `cap-shell/unsupported-webview.html` page
  instead of loading the app. This works only if the generated Android config
  carries `server.errorPath`; see the sync rules below.
- `test/androidMinimumSupportConfig.test.mjs` (run in CI) asserts the API 29
  minimum, the WebView 91 floor and the fallback-page wiring.

## How the URL is wired

`apps/web/capacitor.config.ts` reads `CAP_SERVER_URL` when the Capacitor CLI
runs (default `http://localhost:3000`, the iOS-simulator value). It bakes the
value into each synced platform's generated `capacitor.config.json`. Change
the URL → re-run the sync for each platform you build.

**Sync one platform at a time.** Run every command from `apps/web`.

| Target | Command before building |
|---|---|
| iOS simulator (dev) | `npx cap sync ios` (default localhost works) |
| Android emulator (dev) | `CAP_SERVER_URL=http://10.0.2.2:3000 npx cap sync android` |
| Physical device (dev) | `CAP_SERVER_URL=http://<mac-lan-ip>:3000 npx cap sync android` or `… npx cap sync ios` |
| Production | `CAP_SERVER_URL=https://<hosted-url> npx cap sync android`, then `… npx cap sync ios` (see `deploy/README.md`, "Mobile shells") |

`CAP_SERVER_URL` must be passed explicitly for an Android emulator sync.
Otherwise the iOS-simulator default is written, and the emulator can't reach it.

### Known limitation MIN-F1 (unresolved)

**MIN-F1 remains unresolved: a plain combined Capacitor synchronization
(`npx cap sync`, which is also what `npm run cap:sync` runs) omits Android's
`server.errorPath`.** The config emits `errorPath` only when the CLI command
targets Android alone (`cap sync android`, `cap copy android`,
`cap run android`).

Without `errorPath`, an Android device whose WebView is below the version-91
floor only logs an error and loads the app anyway, instead of showing the
unsupported-WebView page.

- The connection-error page (`cap-shell/connection-error.html`, shown for
  network errors and HTTP 5xx) is served by the native `AuraWebViewClient` and
  does not depend on `errorPath`.
- No release-time check yet verifies that a generated Android config carries
  `errorPath`.

**Never use the combined `npx cap sync` or `npm run cap:sync` before an
Android build.**

## Dev workflow

```bash
cd apps/web
npm run dev              # web app on :3000, as always

# Android
CAP_SERVER_URL=http://10.0.2.2:3000 npx cap sync android
npm run cap:android      # opens Android Studio → Run
# or headless: cd android && ./gradlew assembleDebug
#   → app/build/outputs/apk/debug/app-debug.apk

# iOS
npx cap sync ios
npm run cap:ios          # opens Xcode → Run
```

## Geolocation compatibility patch (`@capacitor/geolocation` 6.1.1)

`@capacitor/geolocation` is pinned to exactly **6.1.1** in
`apps/web/package.json`. The `postinstall` script
(`apps/web/scripts/apply-geolocation-compat-patch.mjs`) applies
`apps/web/patches/capacitor-geolocation-6.1.1-coarse-compat.patch` to the
plugin's Android Java sources inside `node_modules`.

**Why API 29–30 still need it.** The app requests coarse location only.

| Patch part | File | Fixes | Affected supported versions |
|---|---|---|---|
| Part 1 | `GeolocationPlugin.java` | Backports the upstream manifest-aware permission alias, so a coarse-only app asks for `ACCESS_COARSE_LOCATION` instead of failing | API 29–30 |
| Part 2 | `Geolocation.java` | Skips last-known-location providers that throw `SecurityException` for coarse-only callers, instead of crashing | API 29 |

**Guards.**
- The script patches only version 6.1.1, and only when both files match the
  recorded pristine fingerprints. Both files are patched or neither is.
- Re-running it is a no-op ("already applied").
- An unexpected version, an unknown file state, or a missing plugin fails
  closed (exit 1). On Vercel (`VERCEL` set), failures are a warning and exit 0,
  because web deploys never compile this Java.
- Android builds are gated separately: the Gradle task
  `verifyGeolocationCompatPatch` (in `android/app/build.gradle`, run before
  `preBuild`) fails the build unless the patched fingerprints are present.
- Installing with `--ignore-scripts` skips the patch. Run
  `node scripts/apply-geolocation-compat-patch.mjs` from `apps/web` before
  building Android.

**Keep the patch file byte-for-byte.** Its context lines contain intentional
trailing whitespace. An editor or formatter that strips trailing whitespace
breaks it.

The pristine upstream sources used by the tests live in
`test/fixtures/capacitor-geolocation-6.1.1-pristine/` with their MIT `LICENSE`
and `PROVENANCE.md`. Don't edit them. Changing the plugin version means
replacing the fixtures, the patch, and the fingerprints in the script and the
tests together.

## Verified / known issues (2026-08-17)

- **Android**: `./gradlew assembleDebug` builds a working debug APK on this
  machine (Java 17, Android SDK present).
- **iOS**: project generated, pods installed, `cap sync` clean — but
  **compilation is blocked by the machine's Xcode 15.4 on macOS 26 (still pending an Xcode update)**: `actool`
  fails with "Failed to launch AssetCatalogSimulatorAgent via CoreSimulator
  spawn" on every build. Fix: update Xcode from the App Store, then rebuild.
  After the Xcode update, consider bumping to Capacitor 7.

## Still to do before store submission

1. ~~Auth~~ DONE: 6-digit code flow shipped (POST /api/auth/verify-code) — works inside the shells.
   webview, so the session cookie lands in the wrong context. Replace with a
   6-digit code-entry flow for the packaged apps (works on web too).
2. App icons + splash screens (`@capacitor/assets` generates all sizes from one
   1024×1024 source image).
3. Push notifications for window transitions (also strengthens App Store
   guideline 4.2 "minimum functionality" position).
4. Signing: Apple Developer account + Android keystore.
