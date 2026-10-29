# R2D-08: Explicit Owner-Authorization Checklist

**Nothing below is authorized by this package.**

## A. To authorize **implementation** of the prototype harness (next ticket)
- [ ] I have reviewed R2D-01…07 and the independent design review (R2D-10).
- [ ] I approve the Tier 1 control specification (R2D-02) as written (including T1-8 path guard and T1-9 SIP).
- [ ] I approve the Tier 2 test matrix (R2D-03), including the deliberate RD-1…RD-4 risks (item B/C trust, the L7 unlocked residual, the L10 Always Allow, probes that may raise dialogs).
- [ ] I approve the prototype passphrase-custody procedure (R2D-05 "Prototype").
- [ ] I approve the hash-then-execute-from-memory bootstrap (R2D-06).
- [ ] I understand that implementation includes **mock-only self-tests**, with **no** keychain creation, unlock or `security` read until execution is separately authorized.

## B. To authorize **execution** of the prototype (a separate, later approval)
- [ ] The harness was implemented, self-tested with mocks, and independently reviewed; its sha256 is recorded in the report.
- [ ] **Accessibility:** every toggle in System Settings → Privacy & Security → Accessibility is **OFF**, including Codex Computer Use, Splashtop, ISL Online, Zoom, Claude and Terminal. ChatGPT, Codex and any remote-support session are closed.
- [ ] **FileVault is ON** (System Settings → Privacy & Security → FileVault).
- [ ] At least 500 MB free disk space.
- [ ] Claude desktop and Claude Code are **quit**. System Settings → General → **Sharing**: Screen Sharing, Remote Management and Remote Login are **OFF**.
- [ ] I will run it in a **fresh Terminal window started with `/usr/bin/env -i HOME=$HOME TERM=xterm-256color /bin/zsh -f`**, with **Secure Keyboard Entry ON**, via the bootstrap with the reported hash.
- [ ] For L7, I will kill the harness **only by its exact logged PID** (`kill -9 <PID>`), never `pkill`, and I accept that **post-L7 cleanup is the manual recovery** (R2D-07).
- [ ] For L9, the macOS lock screen asking for my login password after wake is **expected** and is the only permitted login-password entry.
- [ ] I will type only a **throwaway** passphrase I invent at run time. I will never enter my login password, and will Cancel any dialog that asks for it.
- [ ] I will click **Always Allow only in L10**, and nowhere else.
- [ ] I will be present for L9 (sleep/wake) and L7 (the `kill -9` from a second terminal).
- [ ] Synthetic values only. No production credential, launcher, Neon, R-1, B4, B5 or B6 involvement.

## C. Acknowledgements required (can be given now or with B)
- [ ] **Accepted limitation:** the design does **not** protect against an attacker controlling my macOS session or holding administrative privileges (RC-18).
- [ ] **Historical:** the cause of the original run-2 exposure (person vs automation) remains **unverified**.
- [ ] **Procedural controls:** automation-off and one-dialog-at-a-time rules are attestations, not technical enforcement (RC-20, RC-3).
- [ ] **Production adoption** of any locked-keychain design needs a further decision after the prototype results, including the D-B2 choice and its residual.
