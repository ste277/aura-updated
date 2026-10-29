# AURA-PALM-01-G4-B: Gate Recommendation

## Verdict

| Scope | Recommendation |
|---|---|
| Automated palm-crease detection (A1/A2) for any user-facing or integration purpose | **NO-GO.** There is no evidence it meets the pre-registered criteria; the only available evidence shows the finger-edge failure mode |
| Continuing G4-B research | **CONDITIONAL GO**, once the owner supplies (1) a consented dataset meeting criteria §1 and (2) physical iPhone and Android devices with an authorized secure-context method |
| User-drawn / user-confirmed creases (A4) with detection + quality gating | Candidate fallback. Its C9 effort and device behaviour are **unmeasured**, so it isn't recommended for integration yet |

## What was done

- Accuracy criteria **frozen before any data** (SHA-256 `bcc8f204…43a9`).
- Classical alternative A2 implemented; A3 assessed as not justified.
- Annotation tool, scoring module (self-test 9/9) and evaluation harness built and smoke-tested.
- Privacy re-verified on desktop: telemetry attempts blocked, no other requests, no storage.
- Offline-error UX bug fixed.

## What is blocked (owner inputs)

1. **Dataset:** consent text, participants (≥ 10), images (≥ 30), annotations, storage and retention approval (dataset register §5).
2. **Devices:** a physical iPhone and Android phone, plus a secure-context method (device test report §2).

## Next authorization requested

**G4-B (continued): data collection and device testing.** Authorize the consent protocol and storage, provide devices, then run `evaluate.html` on the held-out split and the device matrix. Decide per criteria §5.

## Files changed (research worktree only; uncommitted, unpushed)

`research/palm-scan-g4a/`:
- **New:** `src/metrics.js`, `test/metrics.test.mjs`, `annotate.html`, `src/annotate.js`, `evaluate.html`, `src/evaluate.js`.
- **Modified:** `src/creases.js` (shared extractor, A2), `src/pipeline.js` (detector option, palm width), `src/app.js` (model-load error handling), `src/privacy-guard.js` (live record), `package.json` (`type: module`, test script), `.gitignore` (`eval/`).
- **Unchanged:** `apps/`, `packages/` and the main checkout.

## Governance (unchanged)

G4 production integration HOLD · G3-L2B-R awaiting authorization · G3-L2B-G HOLD · G3-L2-I HOLD · Publication HOLD · Merge freeze ACTIVE · Secondary evidence backup awaiting external storage. No deployment, push or merge. No uncleared Palmistry content used (crease names are anatomical). No cloud inference, uploads or biometric identification.
