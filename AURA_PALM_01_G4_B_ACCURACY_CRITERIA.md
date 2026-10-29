# AURA-PALM-01-G4-B: Accuracy Criteria (pre-registered)

**Status: FROZEN before any data or tuning.** Frozen 2026-11-11. The SHA-256 of this file at freeze time is recorded in `AURA_PALM_01_G4_B_EVALUATION_RESULTS.md` §1. Any later change must be logged in §7 with date, reason and whether results had been seen.

**Terminology:** creases are named **anatomically** (dermatology), not with palmistry terms. No uncleared Palmistry content is used.

| Code | Anatomical crease |
|---|---|
| DTC | Distal transverse crease (upper transverse crease, below the fingers) |
| PTC | Proximal transverse crease (middle transverse crease) |
| TC | Thenar crease (curving around the thumb base) |
| MINOR | Any other visible crease the annotator marks as minor (matches neither penalise nor reward) |

## 1. Dataset adequacy

- **Minimum for any conclusion:** **30 consented open-palm images from at least 10 different people**, both left and right hands, at least 3 skin-tone groups (Fitzpatrick I–II, III–IV, V–VI) with at least 6 images each, and front and rear camera.
- **Split:** fixed before evaluation. About 1/3 **development** (tuning allowed), about 2/3 **held-out** (evaluation only; never viewed for tuning). Split by **person**, not by image.
- **Below the minimum:** results are reported as **INCONCLUSIVE**, with 95% Wilson intervals; no GO decision may rest on them.

## 2. Targets (held-out set)

| # | Criterion | Metric | Target |
|---|---|---|---|
| C1 | Palm detection | Share of images where a hand is detected | **≥ 95%** clear · **≥ 80%** degraded (moderate blur, low light, partial occlusion ≤ 25%) |
| C2 | Palm vs back | Accuracy of the palm-facing classification, capture source known | **≥ 98%** clear (both cameras) |
| C3 | Crease localisation (recall) | Share of annotated DTC/PTC/TC matched by a suggestion (matching rule §3) | **≥ 80%** per crease type, clear images |
| C4 | Suggestion precision | Share of suggestions that match an annotated crease (DTC/PTC/TC/MINOR) | **≥ 80%**, clear images |
| C5 | False positives | Unmatched suggestions per image | **≤ 0.5** mean (clear); **0 on ≥ 95%** of back-of-hand and failed-quality images |
| C6 | Finger-edge confusion | Share of suggestions lying ≥ 50% outside the palm polygon or along finger-base edges (annotator flag) | **≤ 10%** of suggestions |
| C7 | Robustness | C1/C3 per condition (lighting, blur, skin-tone group, camera, left/right) | No group below **0.8 ×** the overall figure |
| C8 | Latency (physical mid-range phone) | Model first load / cached load / analysis per image | **≤ 3 s / ≤ 1 s / ≤ 1.5 s** |
| C9 | Correction effort | Interactions to reach the annotated major-crease set (accepts of matched suggestions + rejects of shown false suggestions + manual draws for misses) | **Median ≤ 3** per palm |

## 3. Matching rule

- Annotations and suggestions are polylines in image pixels. Resample both at 1-pixel spacing.
- Tolerance **τ = 3% of palm width** (palm width = distance between index-MCP and pinky-MCP landmarks; annotator line if the model fails).
- A suggestion **matches** an annotation if **≥ 70% of its points lie within τ** of the annotation **and** it covers **≥ 50%** of the annotation's length (projected points within τ).
- An annotation is **recalled** if any suggestion matches it. One suggestion may match only one annotation (greedy by overlap).

## 4. Approaches compared

1. **A1:** existing experimental suggestions (G4-A v1: gated multi-scale Hessian ridge filter).
2. **A2:** classical alternative: gated grey-level black-hat (morphological closing − image) + components.
3. **A3:** lightweight on-device segmentation. **Only if justified:** requires a licence-cleared model or training data. Currently **not justified** (none identified).
4. **A4:** user-drawn / user-confirmed creases (no automation). Measured by correction effort (C9, with zero suggestions) and annotator agreement.

## 5. Decision rule

- **GO for automated suggestions (user-confirmable):** dataset adequate (§1) **and** C1–C7 met on the held-out set **and** C8 met on at least one physical iPhone and one physical Android device.
- **CONDITIONAL GO:** C1, C2, C5 met but C3/C4 not met → ship **A4 only** (user-drawn), with detection/quality gating.
- **NO-GO:** C1 or C2 not met, or privacy verification fails.

## 6. Reporting

Report point estimates **and** 95% Wilson intervals; per-condition tables; every failure image ID (pseudonymous); and clearly separate measured from unmeasured items.

## 7. Change log

| Date | Change | Reason | Results seen before change? |
|---|---|---|---|
| 2026-11-11 | Initial freeze | — | No (no data exists) |
