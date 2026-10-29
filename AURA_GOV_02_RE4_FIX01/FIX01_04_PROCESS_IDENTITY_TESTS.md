# FIX01-04: Process Identity Tests (mock)

| Scenario | Fixture | Asserted outcome |
|---|---|---|
| T7_known_prohibited | TeamViewer | DETECTED `ucomm:TeamViewer`, zero keychain calls |
| T7_comm_spoofed_benign | kernel name `osascript`, argv[0]/comm `benign-tool` (the RV4-2 attack) | DETECTED `ucomm:osascript`; not triggered by `comm:benign-tool` |
| T7_comm_only_denylisted | comm `osascript-fake`, kernel name `zsh` (ucomm ≠ comm) | DETECTED `comm:osascript-fake` (conservative) |
| T7_multiple_matches | TeamViewer, AnyDesk, two osascript | All reported, de-duplicated (the de-dup assertion is weak: FX-6) |
| T7_grandchild_detected | child `osascript-child` (ppid = harness), grandchild `osascript-grand` | Child excluded, grandchild DETECTED |
| T7_parent_disagreement | reads disagree on the parent | Not excluded, so DETECTED |
| T7_ucomm_truncation | `Keyboard Maestro Engine` (16-char kernel name) | DETECTED `ucomm:Keyboard Maestro` |
| T7_misleading_names | `notes-about-claude`, `myosascript`, `…/Claude.app/…/updater-helper` | CLEAN (token-prefix basename matching; see the limitation below) |
| T7_clean_fixture | benign app plus the harness's own osascript child | **CLEAN**, rows=4; both columns read in order ucomm then comm; continues to attestations; rc 0 |
| T1_08 … T1_12 (R2E) | denylisted, space names, self/child exclusion, unrelated osascript | Pass with the stricter `comm:…;ucomm:…` labels |

**Residual (review FX-1, P2).** Detection is by **name** only:
- A copied or renamed executable is not detected; with a different file name, ucomm changes too. On this Mac, a relocated Apple platform binary was SIGKILLed by macOS (RE-4 attempt 2), which limits this for `osascript`, but not for third-party tools.
- Automation run through an interpreter (`node`, `Python`) is not detected.
- Vendor helpers whose names don't start with a token are not detected, for example SuperOps `updmgr`, `ScreensharingAgent`, Splashtop `SR*`.
- Browser-extension agents running inside Chrome are not detected.
- A process inside a denylisted app bundle with a non-token name is CLEAN.

The owner attestations remain the actual control (RC-20).
