import type { CapacitorConfig } from '@capacitor/cli';

// The native shells load the web app by URL — one codebase for web, iOS, and
// Android. Point CAP_SERVER_URL at the deployment the shell should load, then
// re-run `npx cap sync`:
//
//   dev, iOS simulator:      (default) http://localhost:3000
//   dev, Android emulator:   CAP_SERVER_URL=http://10.0.2.2:3000  (emulator's
//                            alias for the host machine's localhost)
//   dev, physical device:    CAP_SERVER_URL=http://<your-mac-lan-ip>:3000
//   production:              CAP_SERVER_URL=https://<railway-app-url>
const serverUrl = process.env.CAP_SERVER_URL ?? 'http://localhost:3000';

const config: CapacitorConfig = {
  appId: 'com.greenarrow.auraschedule',
  appName: 'AuraSchedule',
  // Required by Capacitor even in remote-URL mode; holds only the offline
  // fallback page. The real UI is served from `server.url`.
  webDir: 'cap-shell',
  backgroundColor: '#090d16',
  server: {
    url: serverUrl,
    // Dev servers are plain http; production URLs are https and unaffected.
    cleartext: serverUrl.startsWith('http://'),
  },
};

export default config;
