# AURA-DISK-01 — 09 Additional Storage Candidates

Only the five authorised locations were inspected (sizes via `du -sk`). Nothing was modified.

| Location | Size | Contents | Cleanup implication | Recommendation |
|---|---|---|---|---|
| `~/Library/Developer/Xcode/iOS DeviceSupport` | **6.93 GiB** | One entry: `iPhone17,1 26.6.1 (23G83)` | This is the symbol cache for the physical iPhone currently used for testing (iOS 26.6.1). Deleting it forces Xcode to re-copy symbols (≈7 GB, slow) next time the device is connected. Not a cleanup target while that device is in use | **PRESERVE** |
| `~/Library/Developer/CoreSimulator/Caches` | 3.50 GiB | `dyld` shared-cache only | Regenerated automatically by the simulator runtime on next boot (slower first launch). Simulator data is not affected | Low-risk candidate (owner decision) |
| `~/Library/Developer/CoreSimulator/Devices` | 1.26 GiB | 11 simulator devices: one used device 1.09 GiB (`EF33E620-…`), ten ≈17.5 MiB each (never booted) | Deleting the used device loses its installed apps/data. The ten unused ones are tiny | **PRESERVE** (ticket requires preserving simulator data) |
| `~/Library/Caches/Homebrew` | 2.09 GiB | `downloads/` 2.00 GiB (bottle/cask downloads), bootsnap, api, portable-ruby | Download cache only; installed formulae unaffected. `brew cleanup` is the supported way to clear it | Low-risk candidate (owner decision) |
| `~/Library/Caches/com.openai.codex` | 2.60 GiB | `org.sparkle-project.Sparkle` 2.59 GiB (downloaded app-update packages), small HTTP cache | Sparkle cache holds a downloaded Codex update; removing it means the update is re-downloaded if still pending | Low-risk candidate (owner decision; quit Codex first) |

Out of scope but observed while measuring (no inspection beyond size):
- Android emulator images `~/.android/avd`: 2.06 GiB — **preserve** (ticket requirement).
- A mounted iOS 18.3.1 Simulator runtime bundle (8.7 GB, its own APFS container `disk5`, a disk image). Its backing file was not located or inspected (outside authorised paths); preserve.

## Potential additional recovery (owner decision, not authorised)

| Option | Approx. |
|---|---|
| CoreSimulator dyld cache | 3.5 GiB |
| Homebrew downloads | 2.0 GiB |
| Codex Sparkle update cache | 2.6 GiB |
| **Total low-risk cache candidates** | **≈8.1 GiB (8.7 GB)** |

DeviceSupport (6.9 GiB) and simulator devices are excluded from the recovery estimate because they support ongoing iOS validation.
