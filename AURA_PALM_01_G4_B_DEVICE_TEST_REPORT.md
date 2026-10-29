# AURA-PALM-01-G4-B: Real-Device Test Report

**Status: BLOCKED — NO PHYSICAL DEVICES AVAILABLE.** No iPhone or Android device is connected (`system_profiler SPUSBDataType` shows none; no mounted device). **No desktop emulation was substituted.** Native iOS/Android wrappers were not modified.

## 1. Planned test matrix (to run when devices are available)

| # | Test | iPhone / Safari | Android / Chrome |
|---|---|---|---|
| D1 | Page loads over HTTPS; assets local only | ☐ | ☐ |
| D2 | Consent gate: camera/picker disabled until consent | ☐ | ☐ |
| D3 | Camera **only** after a click; permission prompt shown | ☐ | ☐ |
| D4 | Permission **denied** → clean fallback message | ☐ | ☐ |
| D5 | Permission prompt **cancelled/dismissed** → no hang | ☐ | ☐ |
| D6 | Rear and front camera capture; camera light off after capture | ☐ | ☐ |
| D7 | Image selection from library | ☐ | ☐ |
| D8 | End session: canvas cleared, camera stopped, storage/cookies empty | ☐ | ☐ |
| D9 | Offline: analysis works with the model resident; clear error after the model is unloaded | ☐ | ☐ |
| D10 | Latency (C8): first model load, cached load, per-image analysis | ☐ | ☐ |
| D11 | Memory: tab stays responsive over 20 analyses; no crash | ☐ | ☐ |
| D12 | Screen sizes: small phone and large phone; overlay and touch drawing usable | ☐ | ☐ |
| D13 | Network: no non-local requests (Safari Web Inspector / Chrome remote DevTools) | ☐ | ☐ |

## 2. Setup requirement (secure context)

`getUserMedia` requires HTTPS on phones (only `localhost` is exempt). Options, none of which deploys to production:

1. **Android:** USB debugging + Chrome `chrome://inspect` **port forwarding** of `localhost:8765` to the laptop (keeps `localhost`, so it's a secure context).
2. **iPhone:** a local HTTPS server on the LAN with a locally trusted certificate (e.g. a development CA installed on the test phone), or a private, access-controlled HTTPS staging host. **Either needs owner authorization.** Do not use public preview deployments: the merge freeze and preview-containment rules apply.

## 3. Desktop-only facts already measured (G4-A/G4-B; not substitutes)

Measured in the desktop browser pane:
- Consent gating.
- Camera request only on click (camera blocked in the pane → `NotAllowedError` fallback).
- End-session cleanup (canvas 0×0, storage and cookies empty).
- Offline behaviour: analysis works with the model resident and the server stopped. After end session the model can't reload offline; the page now shows a clear error (fixed in G4-B).
- Latency: 55–386 ms per image on desktop.

## 4. Owner action required

Provide at least one physical iPhone (Safari) and one physical Android phone (Chrome), ideally mid-range plus one older or low-end device, and authorize a secure-context method (§2).
