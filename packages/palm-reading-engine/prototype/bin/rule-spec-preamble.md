# AURA-PALM-G6-D0-R1.2 — Interpretation Rule Specification (ruleset 0.1.3-r1.2; engine/validator R1.3)

> SYNTHETIC PROTOTYPE · TEXT PENDING_HUMAN_REVIEW · NOT FOR USER EXPOSURE · PRODUCTION HOLD
>
> R1 changes: each family now states its frame dependency (R1-F4), the endpoint roles it reads (R1-F5) and any optional observation it needs (R1-F3). `F-TC-BREAKS` reads observed breaks only and is held at tentative. No variant, range or user-facing interpretation text changed.
>
> R1.1 added the `axis` frame property and the G5-I1 rotation-consistency rule; R1.2 (R1.1-RV-04) documents them here. Runtime behaviour is unchanged by R1.2's documentation correction.

## 0. Frame and rotation rules (global)

- **Rotation (mirrors G5-I1 `QUALITY_THRESHOLDS.maxAbsRotationDeg = 45`, `quality.ts`).** A hand is considered rotated only when |rotationDeg| is **strictly greater than 45°**. At exactly 45° the angle alone does not indicate rotation. The scanner's `hand-rotated` issue must agree with the angle:
  - flag absent, |angle| ≤ 45 → rotation confirmed;
  - flag present, |angle| > 45 → `rotation-out-of-range` (plus `orientation-conflict` from the issue);
  - flag and angle disagree → `rotation-conflict`;
  - unknown or invalid `rotationDeg` → the input is rejected (`invalid-input`); it is never defaulted.
- **Frame properties.** *scale* needs landmarks and no `hand-cut-off` / `hand-too-small` / `palm-not-visible` issue. *axis* needs scale, no `hand-rotated` / `palm-not-visible` issue, and confirmed rotation. *direction* needs axis, known handedness and a confirmed palm side. Every rule that needs reliable left/right orientation therefore declines (`frame-unreliable`) under a rotation conflict.
- **Point order, rounding ties and validity (R1.3, owner-approved conservative reconciliation; supersedes R1.2).** Every descriptor is computed from one canonical point sequence, so a polyline and its reversal always give the same reading. The order-summed descriptors that rules read — crease length and centre x — are also summed in the other point order, and a claim survives only if BOTH orders support it:
  - **validity:** a polyline is valid only if it is valid in both point orders (`invalid-geometry` otherwise);
  - **length tie** (the two 4-dp values differ): only the readings selected in both orders are kept. If one order makes a claim and the other does not, the family abstains (reported as quiet, traced in `sections[].quietOrderTies`). If both orders select the same readings with the same ambiguity, nothing changes. Any other difference lowers the tier to tentative (`order-tie`);
  - **central longitudinal crease centre** (x in [0.3, 0.7]): a vertical MINOR crease that passes in EITHER order competes for conflict detection; it is identified only if it is the sole competitor AND passes in BOTH orders. Centre-tied candidates are traced in `observations[].centreOrderTieCandidates`.
  Thresholds, ranges and rule text are unchanged. Reconciliation never creates a claim, raises a tier or makes an invalid input valid relative to any point orientation.
- **Observation versus interpretation.** When a family declines for frame reasons, the scan's observation of the crease is still reported in `observations[]` (for example the central longitudinal crease stays `ok` under a rotation conflict); only the interpretation is withheld (R1.1-RV-05, INFO; deliberate).

## 1. Model

A reading is built from **feature families**. Each family:

1. names the anatomical crease(s) it needs (`DTC`, `PTC`, `TC`, or the hypothesis feature `CENTRAL_LONGITUDINAL`);
2. computes **one** numeric value from engine-derived geometry (never from declared descriptors);
3. maps that value onto **mutually exclusive variants** by fixed ranges;
4. emits the variant's text only if every required crease is `ok` and evidence reaches the tentative threshold.

Variants with no text are "no notable feature": the engine records the family as `quiet` and says nothing. This prevents the common palmistry habit of finding meaning in every configuration.

## 2. Traceability chain

Every emitted interpretation carries:

`ruleId` → `familyId` → `evidence.creaseIds` (ids present in the input) → `evidence.anatomicalClasses` → `evidence.feature` + `evidence.measuredValue` → `evidence.evidenceComponents` (scan, detection confidence + basis, class confidence + source, detector status) → `capsApplied` (incl. R1 frame caps) → `evidence.evidenceBeforeFrameCaps` → `evidence.frame` (R1) → `evidence.excludedInputs` (R1, e.g. `gapsBridged`) → `provenance` (tradition, authorship, licence status, guide-derived = false, review status) → `excludedClaims`.

Tests assert that every `creaseId` exists in the input, every `ruleId` exists in the catalogue, and the measured value is finite.

## 3. Global exclusions

No rule may state or imply: future events as fact; lifespan; health or medical conditions; wealth; marriage, divorce or numbers of partners/children; career success or failure; scientific validity of palmistry; or meaning drawn from an absent crease. These are enforced twice: by the authored text (reviewed) and by the runtime prohibited-claim lint in `policy.mjs`, which turns any violation into a hard error (`PROHIBITED_CLAIM`) instead of output.

The traditional "life line = length of life" belief is specifically excluded: `F-TC-ARC` and `F-TC-BREAKS` speak only about pace, variety and chapters of change, and carry extra exclusions for vitality, length of life, accidents, illness and event timing.
