# Mobile shells (Capacitor)

One web codebase serves desktop browsers, iOS, and Android. The native apps are
thin Capacitor webview shells (`apps/web/ios/`, `apps/web/android/`) that load
the web app by URL — they contain no app logic. The backend stays hosted; the
shells are never bundled with it.

Capacitor **6** is pinned deliberately: Capacitor 7 requires Xcode 16+. Upgrade
to 7 when the dev machine's Xcode is updated.

## How the URL is wired

`apps/web/capacitor.config.ts` reads `CAP_SERVER_URL` (default
`http://localhost:3000`) and writes it into both native projects on every
`npx cap sync`. Change the URL → re-run sync.

| Target | Command before building |
|---|---|
| iOS simulator (dev) | `npm run cap:sync` (default localhost works) |
| Android emulator (dev) | `CAP_SERVER_URL=http://10.0.2.2:3000 npx cap sync` |
| Physical device (dev) | `CAP_SERVER_URL=http://<mac-lan-ip>:3000 npx cap sync` |
| Production | `CAP_SERVER_URL=https://<hosted-url> npx cap sync` |

## Dev workflow

```bash
cd apps/web
npm run dev              # web app on :3000, as always

# Android
CAP_SERVER_URL=http://10.0.2.2:3000 npx cap sync
npm run cap:android      # opens Android Studio → Run
# or headless: cd android && ./gradlew assembleDebug
#   → app/build/outputs/apk/debug/app-debug.apk

# iOS
npm run cap:sync
npm run cap:ios          # opens Xcode → Run
```

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
