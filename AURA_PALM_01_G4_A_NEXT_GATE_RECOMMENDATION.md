# AURA-PALM-01-G4-A: Next Gate Recommendation

## Verdict

**Feasible for hand detection, landmarks, orientation and quality gating. NOT yet feasible for automatic palm-line detection.** Evidence: the prototype and validation run (32/35 detections; correct palm/back heuristic on this set; blur/dark/rotation flagged; telemetry blocked; zero non-local requests). Crease detection is unvalidated, and on available images it traces finger edges.

## Recommended next gate: G4-B, "Evaluation data and device validation" (research only)

1. **Licence-cleared, consented evaluation set:** owner-provided open-palm photos (varied skin tones, lighting, ages, left/right, front and rear camera), with documented consent, retention and deletion, plus human-annotated creases as ground truth. Stored locally, never committed. Needs owner authorization and a privacy decision.
2. **Define acceptance metrics** before tuning, e.g. crease recall/precision against annotations at a tolerance; detection rate; time-to-result on target devices.
3. **Real-device testing** of the standalone page on iOS Safari and Android Chrome over HTTPS: camera capture, picker, performance, memory.
4. **Evaluate crease approaches** on that set: the current gated classical filter vs alternatives. Adopt automation only if metrics are met; otherwise ship **user-drawn / user-confirmed creases** only.
5. **Telemetry decision:** keep the CSP + guard approach or patch the bundle; document it in the privacy design.

## Explicitly later (separate gates)

- Native camera enablement (iOS `NSCameraUsageDescription`, Android `CAMERA`, WebView permission handling): a production change.
- Any integration into Aura, CSP/Permissions-Policy headers, analytics: production changes.
- Any connection between scan results and Palmistry interpretations: waits on content approval (G3 human review, licensing L2-B) and publication authorization.

## Decision needed from the owner

Authorize **G4-B** (evaluation data collection with consent + device testing), or stop at G4-A.

## Governance (unchanged)

G4-A research complete · G3-L2B-E complete · G3-L2B-E2 BLOCKED (awaiting owner storage) · G3-L2B-R awaiting authorization · G3-L2B-G HOLD · G3-L2-I HOLD · Publication HOLD · Merge freeze ACTIVE. No production code paths modified; no deployment; no merge; prototype branch uncommitted and unpushed.
