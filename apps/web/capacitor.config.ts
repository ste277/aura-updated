import type { CapacitorConfig } from '@capacitor/cli';

// The native shells load the web app by URL — one codebase for web, iOS, and
// Android. Point CAP_SERVER_URL at the deployment the shell should load, then
// re-run the sync PER PLATFORM -- `npx cap sync android` and `npx cap sync ios`
// as separate commands. A combined `npx cap sync` omits Android's
// server.errorPath, so the WebView floor below would only log (AND-MIN-01):
//
//   dev, iOS simulator:      (default) http://localhost:3000
//   dev, Android emulator:   CAP_SERVER_URL=http://10.0.2.2:3000  (emulator's
//                            alias for the host machine's localhost)
//   dev, physical device:    CAP_SERVER_URL=http://<your-mac-lan-ip>:3000
//   production:              CAP_SERVER_URL=https://<railway-app-url>
//
// CAP_SERVER_URL is read when the CLI runs and baked into the generated
// capacitor.config.json. If it is unset, the iOS-simulator default above is
// written, so an Android emulator sync must pass it explicitly:
//   CAP_SERVER_URL=http://10.0.2.2:3000 npx cap sync android
const serverUrl = process.env.CAP_SERVER_URL ?? 'http://localhost:3000';

// AURA-MOBILE-01-AND-MIN-01: Android compatibility gate.
// Capacitor's native check (Bridge.isMinimumWebViewInstalled) runs before the
// app URL loads. Below the floor, Capacitor loads `server.errorPath` from the
// bundled web assets instead. Without errorPath it only logs and loads anyway.
// WebView 91 is the lowest version validated end to end (AND-COMPAT-07); below
// Chromium 73 the timezone helpers return silently wrong times.
export const ANDROID_MIN_WEBVIEW_VERSION = 91;
export const ANDROID_ERROR_PATH = 'unsupported-webview.html';
// Capacitor writes one capacitor.config.json to every synced platform, and iOS
// also honours server.errorPath (on any failed navigation). The page is
// Android-specific, so errorPath is emitted only when the CLI command targets
// Android alone (`npx cap sync android`, `cap copy android`, `cap run android`).
// A combined `npx cap sync` omits it, which leaves Android with the log-only
// behaviour above and keeps iOS unchanged.
const cliArgs = process.argv.slice(2);
const androidOnlyCommand = cliArgs.includes('android') && !cliArgs.includes('ios');

const config: CapacitorConfig = {
  appId: 'com.greenarrow.auraschedule',
  appName: 'AuraSchedule',
  // Required by Capacitor even in remote-URL mode. Holds only bundled static
  // pages: index.html (unused while server.url is set), the WebView-floor page
  // (errorPath, below) and connection-error.html (served by the native
  // AuraWebViewClient). The real UI is served from `server.url`.
  webDir: 'cap-shell',
  backgroundColor: '#090d16',
  server: {
    url: serverUrl,
    // Dev servers are plain http; production URLs are https and unaffected.
    cleartext: serverUrl.startsWith('http://'),
    // Android only: shown by Capacitor's minimum-WebView check (see above).
    // Capacitor's default BridgeWebViewClient would also load it for every
    // main-frame network/HTTP error; since AND-ERR-01, MainActivity installs
    // AuraWebViewClient instead, which shows connection-error.html for network
    // errors and HTTP 5xx and keeps HTTP 4xx responses (e.g. the app's 404), so
    // this page now covers the WebView-floor case only.
    ...(androidOnlyCommand ? { errorPath: ANDROID_ERROR_PATH } : {}),
  },
  android: {
    minWebViewVersion: ANDROID_MIN_WEBVIEW_VERSION,
  },
};

export default config;
