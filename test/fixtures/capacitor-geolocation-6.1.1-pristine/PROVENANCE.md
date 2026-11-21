# Pristine `@capacitor/geolocation` 6.1.1 Java sources (test fixture)

These are unmodified upstream files, used by `test/geolocationCompatJavaLogic.test.mjs` as the ORIGINAL baseline. The test copies them into temporary trees and applies the real COMPAT-03 patch script to one copy. It never reads or writes the installed plugin in `apps/web/node_modules`, which stays patched.

| File | SHA-256 | Role |
|---|---|---|
| `GeolocationPlugin.java` | `bf807548b9c2439c59b1f0edd1caf33ae46587e7437344342265d78ec4bee9db` | pristine baseline (equals `FILES[0].pristine` in `apps/web/scripts/apply-geolocation-compat-patch.mjs`) |
| `Geolocation.java` | `506681e780dfe6827c99db372a6dabf244e730d11506c113eb5271cf31dc36f1` | pristine baseline (equals `FILES[1].pristine`) |
| `LICENSE` | `e8f989836e88732576472006444b65fd3d7d3c2455becdaaa4d82cd0dd43110f` | upstream MIT licence, Copyright 2020-present Ionic, kept with the copied sources |

## Provenance (AURA-MOBILE-01-AND-MIN-01-R0A, 2026-11-14)
- **Source:** the npm tarball `geolocation-6.1.1.tgz` already present in the local npm content cache. No download or network access was used.
- **Integrity:** the tarball's SHA-512 equals the `integrity` recorded for `node_modules/@capacitor/geolocation` in `apps/web/package-lock.json`: `sha512-zR24reZqkb9farg+qVqR0+DdDYs05SqkiqxCENoPofk/QWD6AobcHKDZutwifqO66jK2rM0ECo8MvbQv4MUTyA==` (hex `cd1db8ad…c513c8`).
- **Contents:** the tarball's `package/package.json` says `@capacitor/geolocation` 6.1.1, licence MIT. The files were copied byte-for-byte from `package/android/src/main/java/com/capacitorjs/plugins/geolocation/` and `package/LICENSE`.
- **Patch check:** applying the repo's patch script to these files produces exactly the approved patched fingerprints, `5c4ba692…` (GeolocationPlugin) and `1861133e…` (Geolocation). The test asserts this on every run.

The test fails closed if either Java file is missing or its SHA-256 differs from the values above. **Do not edit these files.** If the plugin version changes, replace them only from a lockfile-integrity-verified tarball and update the fingerprints here, in the patch script and in the test.
