# AURA-PALM-01-G4-B2A — Gate Recommendation

## Recommendation: **CONDITIONAL PASS**

The research harness now requires an explicit external dataset root and refuses repository, synced or unverified locations. It verifies encryption from disk-image attributes, not names. Reports and logs carry no coordinates, images, paths or metadata. Annotations follow a validated v2 schema that captures uncertainty and unsuitability. A staged-content Git guard covers renames, force-adds and image magic bytes. Metadata stripping is confined to the dataset root.
**105 synthetic tests passed, 0 failed.** Frozen accuracy criteria and scoring are unchanged (SHA `bcc8f204…ee43a9`).

## Conditions (all must be met before any real-image work; none is authorised by this gate)
1. **ST-OWNER-1 and ST-OWNER-2:** the owner creates and mounts the approved AES-256 image and confirms `OK VERIFIED-ENCRYPTED`. Currently BLOCKED — AWAITING_OWNER_STORAGE.
2. **A-09:** owner decision on scoring uncertain creases and unsuitable images. Until then reports list both as pending.
3. **A-12:** AI-isolation decision. Remains AWAITING_OWNER.
4. **HEIC orientation:** verify on a synthetic rotated HEIC, or require JPEG intake.
5. **Optional, recommended:** the owner installs the per-worktree hook (ST-OWNER-3), and governance considers a CI equivalent, because hooks are bypassable.
6. A-01 to A-14 approvals, and the separate authorisation for real-image collection.

## Status unchanged by this ticket
| Item | Status |
|---|---|
| Real-image collection, annotation, G4-B evaluation | **HOLD** |
| Native camera | HOLD |
| G3 licensing | HOLD |
| Publication / deployment | HOLD |
| Merge freeze | ACTIVE |
| Secondary evidence backup | BLOCKED (owner storage) |
| Code state | Untracked in the research worktree; not committed, pushed or merged |

Technical completion here is **not** permission to collect participant images.
