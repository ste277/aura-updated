# AURA-PALM-01-G4-B: Telemetry and Privacy Verification

**Environment:** desktop browser pane (Chromium 156), loopback server `127.0.0.1:8765`. **Not verified on phones** (device testing blocked).
**Telemetry status:** treated as a **release blocker**. The guard was not weakened.

| Check | Method | Result |
|---|---|---|
| MediaPipe telemetry present in 1.2.0 (pinned) and 1.2.2 (latest) | Source inspection | **Present in both**; logger constructed unconditionally for every task; POSTs protobuf usage metrics to `https://odml.pa.googleapis.com/v1/log` every 60 s and on close; **no opt-out found** |
| No requests to `odml.pa.googleapis.com` leave the page | Browser network log (`read_network_requests`, filter "googleapis") | **None** across G4-A runs and the G4-B evaluation, app and offline runs |
| Attempts are intercepted | Guard record `window.__blockedRequests` | **Attempt recorded and blocked** at model close in evaluate (14:29:11Z) and at session end in the app (twice) |
| No other third-party requests | Network log + `performance.getEntriesByType('resource')` | Only `http://127.0.0.1:8765/…` |
| No external image transmission | Same, plus code review (no upload code; CSP `connect-src 'self'`; guard blocks cross-origin fetch/XHR and all `sendBeacon`) | **None observed** |
| No persistent image storage | `localStorage`, `sessionStorage`, `document.cookie` after sessions | **All empty**. No IndexedDB or Cache API code in the prototype (code review) |
| No automatic camera activation | Page load inspection; camera requested only via the click handler | **Confirmed** (camera blocked in the pane; request occurred only after the click) |
| Image buffers released after session end | Canvas dimensions, result state, media stream, model handle | Canvas **0×0**, results hidden, stream null, model closed. **Browser and GPU internal memory can't be verified from JavaScript** |
| Annotation tool | Saves coordinates-only JSON to the user's disk via a local Blob; CSP `connect-src 'self'`; guard loaded | No network use beyond local assets |
| Offline operation | Server stopped mid-session | Analysis worked with the model resident. After end session, model reload fails with a **clear error** (fixed) |

## Conclusion

On desktop, the local-only design holds: telemetry is attempted and **blocked by two layers** (CSP + guard), and nothing else leaves the device.

**Before any production use:**
1. A strict CSP must be enforced server-side, not only as a meta tag.
2. The guard, or a patched MediaPipe bundle with the logger removed, must ship.
3. Phone verification is required: Safari's Web Inspector and Chrome remote DevTools network logs.
