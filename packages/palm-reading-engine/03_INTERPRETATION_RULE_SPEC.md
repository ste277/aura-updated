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

## 4. Rule catalogue (generated from `prototype/src/rules.mjs`, ruleset 0.1.3-r1.2)

### F-PTC-SLOPE — Personality and tendencies

| Field | Specification |
|---|---|
| Required features | `PTC` (traditional "head line"), each with status `ok`. Slope of the proximal transverse crease (traditional "head line"): how far its ulnar end drops toward the wrist relative to its radial end. |
| Traditional source / provenance | Western popular palmistry (chirology), general handbook tradition. Anatomical crease ↔ traditional line name is an approximate convention, not a measured equivalence. Source status: general-tradition-summary; no specific text consulted or quoted in G6-D0. Reviewer to confirm each attribution against a public-domain or licence-cleared source before any user exposure. Authored by Claude Opus 5.5 (AI), AURA-PALM-G6-D0, 2026-11-18; Aura draft; AI-generated; ownership unresolved (G3-L1 N3); guide-derived: false; review: PENDING_HUMAN_REVIEW. |
| Confidence requirement | evidence = min(scan, detection (basis-capped), class (source-capped), detector-status cap). ≥ 0.75 → clear; ≥ 0.5 → tentative; below → declined. |
| Contradictory evidence | Crease-level conflicts decline the family. In-crease contradiction lowers the tier by one: `(c) => (c.crease.PTC.branches.some((b) => b.direction === 'proximal' && b.lengthNorm >= 0.15) ? 'A long branch toward the wrist makes the overall slope harder to judge.' : null)` |
| Frame dependency (R1-F4, R1.1-RV-05) | direction (radial/ulnar; axis reliable, AND handedness known, AND palm facing confirmed): **required**; axis (finger-base→wrist axis; scale reliable, no hand-rotated / palm-not-visible issue, and rotation consistent: a hand is rotated only when the absolute rotation angle is strictly greater than 45° — exactly 45° is not rotated — and the hand-rotated flag must agree with the angle; disagreement → rotation-conflict, agreement beyond 45° → rotation-out-of-range): **required** (via direction); scale (palm width from landmarks; landmarks present and no hand-cut-off / hand-too-small / palm-not-visible issue): **required**. A required but unreliable frame property → declined (`frame-unreliable`, with `frameReasons`). Palm side unconfirmed → capped at tentative; model-estimated handedness → capped at tentative. |
| Endpoint roles (R1-F5) | `PTC`: radialUlnar — ambiguous roles → declined (`geometry-ambiguous`). |
| Optional observations (R1-F3) | none |
| Boundary handling | margin ±0.015: values within the margin of an internal boundary show both neighbouring claim variants at tentative. |
| Order-tie handling (R1.3) | Reads no order-summed value; not affected. |
| Missing-data behaviour | Required crease missing / not observed → family declined: "This crease was not detected. That is usually a limitation of the photo or detector, and it means nothing about you." No variant is selected and no meaning is drawn from absence. |
| Uncertainty wording | clear: "Palmistry traditions often associate this with …" + "Even a clearly visible crease only tells us what tradition says, not what is true about you."; tentative: "Some palmistry traditions might associate this with …" + "The scan evidence here is limited, so treat this as a loose possibility." |
| Excluded deterministic claims | future events stated as fact; lifespan or longevity; health, illness or medical conditions; wealth or financial outcomes; marriage, divorce, partner or children counts; career success or failure; scientific validity of palmistry; meaning drawn from an absent or undetected crease |

| Variant (rule id) | Range | Observation text | Interpretation (user-facing) | Reflection prompt |
|---|---|---|---|---|
| `P-PTC-STRAIGHT` | −∞ ≤ value < 0.05 | Your head-line crease runs fairly straight across the palm. | a practical, grounded way of thinking that prefers facts and clear steps | Where in your life does a step-by-step approach serve you best, and where might it hold you back? |
| `P-PTC-BALANCED` | 0.05 ≤ value < 0.11 | Your head-line crease slopes gently toward the wrist. | a mix of practical and imaginative thinking | When do you lean on logic, and when do you trust your imagination? |
| `P-PTC-SLOPING` | 0.11 ≤ value < +∞ | Your head-line crease slopes noticeably toward the wrist. | an imaginative, creative turn of mind | What creative outlet feels most like you right now? |

### F-PTC-LENGTH — Personality and tendencies

| Field | Specification |
|---|---|
| Required features | `PTC` (traditional "head line"), each with status `ok`. Length of the proximal transverse crease, in palm widths. |
| Traditional source / provenance | Western popular palmistry (chirology), general handbook tradition. Anatomical crease ↔ traditional line name is an approximate convention, not a measured equivalence. Source status: general-tradition-summary; no specific text consulted or quoted in G6-D0. Reviewer to confirm each attribution against a public-domain or licence-cleared source before any user exposure. Authored by Claude Opus 5.5 (AI), AURA-PALM-G6-D0, 2026-11-18; Aura draft; AI-generated; ownership unresolved (G3-L1 N3); guide-derived: false; review: PENDING_HUMAN_REVIEW. |
| Confidence requirement | evidence = min(scan, detection (basis-capped), class (source-capped), detector-status cap). ≥ 0.75 → clear; ≥ 0.5 → tentative; below → declined. |
| Contradictory evidence | Crease-level conflicts decline the family. In-crease contradiction lowers the tier by one: `(c) => (c.breaks.PTC !== null && c.breaks.PTC >= 2 ? 'The crease appears broken in several places, so its true length is uncertain.' : null)` |
| Frame dependency (R1-F4, R1.1-RV-05) | direction (radial/ulnar; axis reliable, AND handedness known, AND palm facing confirmed): **not required**; axis (finger-base→wrist axis; scale reliable, no hand-rotated / palm-not-visible issue, and rotation consistent: a hand is rotated only when the absolute rotation angle is strictly greater than 45° — exactly 45° is not rotated — and the hand-rotated flag must agree with the angle; disagreement → rotation-conflict, agreement beyond 45° → rotation-out-of-range): **not required**; scale (palm width from landmarks; landmarks present and no hand-cut-off / hand-too-small / palm-not-visible issue): **required**. A required but unreliable frame property → declined (`frame-unreliable`, with `frameReasons`). Palm side unconfirmed → capped at tentative. |
| Endpoint roles (R1-F5) | none |
| Optional observations (R1-F3) | none |
| Boundary handling | margin ±0.03: values within the margin of an internal boundary show both neighbouring claim variants at tentative. |
| Order-tie handling (R1.3) | Reads an order-summed length: on a 4-dp tie only readings selected in both point orders are kept; a claim made in one order only → abstain (quiet); a difference in ambiguity → tentative; identical selections → unchanged. |
| Missing-data behaviour | Required crease missing / not observed → family declined: "This crease was not detected. That is usually a limitation of the photo or detector, and it means nothing about you." No variant is selected and no meaning is drawn from absence. |
| Uncertainty wording | clear: "Palmistry traditions often associate this with …" + "Even a clearly visible crease only tells us what tradition says, not what is true about you."; tentative: "Some palmistry traditions might associate this with …" + "The scan evidence here is limited, so treat this as a loose possibility." |
| Excluded deterministic claims | future events stated as fact; lifespan or longevity; health, illness or medical conditions; wealth or financial outcomes; marriage, divorce, partner or children counts; career success or failure; scientific validity of palmistry; meaning drawn from an absent or undetected crease |

| Variant (rule id) | Range | Observation text | Interpretation (user-facing) | Reflection prompt |
|---|---|---|---|---|
| `P-PTC-SHORT` | −∞ ≤ value < 0.5 | Your head-line crease is on the shorter side. | a quick, decisive thinker who likes to act once the main point is clear | Which recent decision did you make quickly, and how did it turn out? |
| `P-PTC-MEDIUM` | 0.5 ≤ value < 0.7 | — (no claim) | — (no notable feature; nothing shown) | — |
| `P-PTC-LONG` | 0.7 ≤ value < +∞ | Your head-line crease is long, reaching well across the palm. | a thorough thinker who likes to consider many angles before deciding | Is there a choice you have been weighing for a while that is ready to be made? |

### F-DTC-RISE — Relationships and emotional patterns

| Field | Specification |
|---|---|
| Required features | `DTC` (traditional "heart line"), each with status `ok`. Rise of the radial end of the distal transverse crease (traditional "heart line") toward the index/middle fingers: y(ulnar end) − y(radial end), in palm widths. |
| Traditional source / provenance | Western popular palmistry (chirology), general handbook tradition. Anatomical crease ↔ traditional line name is an approximate convention, not a measured equivalence. Source status: general-tradition-summary; no specific text consulted or quoted in G6-D0. Reviewer to confirm each attribution against a public-domain or licence-cleared source before any user exposure. Authored by Claude Opus 5.5 (AI), AURA-PALM-G6-D0, 2026-11-18; Aura draft; AI-generated; ownership unresolved (G3-L1 N3); guide-derived: false; review: PENDING_HUMAN_REVIEW. |
| Confidence requirement | evidence = min(scan, detection (basis-capped), class (source-capped), detector-status cap). ≥ 0.75 → clear; ≥ 0.5 → tentative; below → declined. |
| Contradictory evidence | Crease-level conflicts (class collision, recorded conflict, ambiguous identity) decline the family. |
| Frame dependency (R1-F4, R1.1-RV-05) | direction (radial/ulnar; axis reliable, AND handedness known, AND palm facing confirmed): **required**; axis (finger-base→wrist axis; scale reliable, no hand-rotated / palm-not-visible issue, and rotation consistent: a hand is rotated only when the absolute rotation angle is strictly greater than 45° — exactly 45° is not rotated — and the hand-rotated flag must agree with the angle; disagreement → rotation-conflict, agreement beyond 45° → rotation-out-of-range): **required** (via direction); scale (palm width from landmarks; landmarks present and no hand-cut-off / hand-too-small / palm-not-visible issue): **required**. A required but unreliable frame property → declined (`frame-unreliable`, with `frameReasons`). Palm side unconfirmed → capped at tentative; model-estimated handedness → capped at tentative. |
| Endpoint roles (R1-F5) | `DTC`: radialUlnar — ambiguous roles → declined (`geometry-ambiguous`). |
| Optional observations (R1-F3) | none |
| Boundary handling | margin ±0.015: values within the margin of an internal boundary show both neighbouring claim variants at tentative. |
| Order-tie handling (R1.3) | Reads no order-summed value; not affected. |
| Missing-data behaviour | Required crease missing / not observed → family declined: "This crease was not detected. That is usually a limitation of the photo or detector, and it means nothing about you." No variant is selected and no meaning is drawn from absence. |
| Uncertainty wording | clear: "Palmistry traditions often associate this with …" + "Even a clearly visible crease only tells us what tradition says, not what is true about you."; tentative: "Some palmistry traditions might associate this with …" + "The scan evidence here is limited, so treat this as a loose possibility." |
| Excluded deterministic claims | future events stated as fact; lifespan or longevity; health, illness or medical conditions; wealth or financial outcomes; marriage, divorce, partner or children counts; career success or failure; scientific validity of palmistry; meaning drawn from an absent or undetected crease |

| Variant (rule id) | Range | Observation text | Interpretation (user-facing) | Reflection prompt |
|---|---|---|---|---|
| `R-DTC-STRAIGHT` | −∞ ≤ value < 0.05 | Your heart-line crease runs fairly level below the fingers. | a steady, private style with feelings, shown more through actions than words | How do the people close to you know that you care? |
| `R-DTC-GENTLE` | 0.05 ≤ value < 0.1 | Your heart-line crease rises gently toward the fingers. | a balance between openness and keeping some feelings to yourself | Who do you find it easiest to open up to, and why? |
| `R-DTC-RISING` | 0.1 ≤ value < +∞ | Your heart-line crease curves up toward the fingers. | a warm, expressive style that shares feelings openly | What helps you feel safe enough to express what you feel? |

### F-DTC-BRANCHES — Relationships and emotional patterns

| Field | Specification |
|---|---|
| Required features | `DTC` (traditional "heart line"), each with status `ok`. Number of branches on the distal transverse crease. |
| Traditional source / provenance | Western popular palmistry (chirology), general handbook tradition. Anatomical crease ↔ traditional line name is an approximate convention, not a measured equivalence. Source status: general-tradition-summary; no specific text consulted or quoted in G6-D0. Reviewer to confirm each attribution against a public-domain or licence-cleared source before any user exposure. Authored by Claude Opus 5.5 (AI), AURA-PALM-G6-D0, 2026-11-18; Aura draft; AI-generated; ownership unresolved (G3-L1 N3); guide-derived: false; review: PENDING_HUMAN_REVIEW. |
| Confidence requirement | evidence = min(scan, detection (basis-capped), class (source-capped), detector-status cap). ≥ 0.75 → clear; ≥ 0.5 → tentative; below → declined. |
| Contradictory evidence | Crease-level conflicts (class collision, recorded conflict, ambiguous identity) decline the family. |
| Frame dependency (R1-F4, R1.1-RV-05) | direction (radial/ulnar; axis reliable, AND handedness known, AND palm facing confirmed): **not required**; axis (finger-base→wrist axis; scale reliable, no hand-rotated / palm-not-visible issue, and rotation consistent: a hand is rotated only when the absolute rotation angle is strictly greater than 45° — exactly 45° is not rotated — and the hand-rotated flag must agree with the angle; disagreement → rotation-conflict, agreement beyond 45° → rotation-out-of-range): **not required**; scale (palm width from landmarks; landmarks present and no hand-cut-off / hand-too-small / palm-not-visible issue): **not required**. A required but unreliable frame property → declined (`frame-unreliable`, with `frameReasons`). Palm side unconfirmed → capped at tentative. |
| Endpoint roles (R1-F5) | none |
| Optional observations (R1-F3) | none |
| Boundary handling | margin ±0: values within the margin of an internal boundary show both neighbouring claim variants at tentative. |
| Order-tie handling (R1.3) | Reads no order-summed value; not affected. |
| Missing-data behaviour | Required crease missing / not observed → family declined: "This crease was not detected. That is usually a limitation of the photo or detector, and it means nothing about you." No variant is selected and no meaning is drawn from absence. |
| Uncertainty wording | clear: "Palmistry traditions often associate this with …" + "Even a clearly visible crease only tells us what tradition says, not what is true about you."; tentative: "Some palmistry traditions might associate this with …" + "The scan evidence here is limited, so treat this as a loose possibility." |
| Excluded deterministic claims | future events stated as fact; lifespan or longevity; health, illness or medical conditions; wealth or financial outcomes; marriage, divorce, partner or children counts; career success or failure; scientific validity of palmistry; meaning drawn from an absent or undetected crease |

| Variant (rule id) | Range | Observation text | Interpretation (user-facing) | Reflection prompt |
|---|---|---|---|---|
| `R-DTC-FEW-BRANCHES` | −∞ ≤ value < 2 | — (no claim) | — (no notable feature; nothing shown) | — |
| `R-DTC-BRANCHED` | 2 ≤ value < +∞ | Your heart-line crease has several small branches. | someone who values many different kinds of connection | Which of your relationships gives you energy, and which takes it? |

### F-PTC-TC-ORIGIN — Career, strengths and working style

| Field | Specification |
|---|---|
| Required features | `PTC` (traditional "head line") + `TC` (traditional "life line"), each with status `ok`. Distance between the radial end of the proximal transverse crease and the distal end of the thenar crease (traditional head/life line "joined" or "separate" at the start). |
| Traditional source / provenance | Western popular palmistry (chirology), general handbook tradition. Anatomical crease ↔ traditional line name is an approximate convention, not a measured equivalence. Source status: general-tradition-summary; no specific text consulted or quoted in G6-D0. Reviewer to confirm each attribution against a public-domain or licence-cleared source before any user exposure. Authored by Claude Opus 5.5 (AI), AURA-PALM-G6-D0, 2026-11-18; Aura draft; AI-generated; ownership unresolved (G3-L1 N3); guide-derived: false; review: PENDING_HUMAN_REVIEW. |
| Confidence requirement | evidence = min(scan, detection (basis-capped), class (source-capped), detector-status cap). ≥ 0.75 → clear; ≥ 0.5 → tentative; below → declined. |
| Contradictory evidence | Crease-level conflicts (class collision, recorded conflict, ambiguous identity) decline the family. |
| Frame dependency (R1-F4, R1.1-RV-05) | direction (radial/ulnar; axis reliable, AND handedness known, AND palm facing confirmed): **required**; axis (finger-base→wrist axis; scale reliable, no hand-rotated / palm-not-visible issue, and rotation consistent: a hand is rotated only when the absolute rotation angle is strictly greater than 45° — exactly 45° is not rotated — and the hand-rotated flag must agree with the angle; disagreement → rotation-conflict, agreement beyond 45° → rotation-out-of-range): **required** (via direction); scale (palm width from landmarks; landmarks present and no hand-cut-off / hand-too-small / palm-not-visible issue): **required**. A required but unreliable frame property → declined (`frame-unreliable`, with `frameReasons`). Palm side unconfirmed → capped at tentative; model-estimated handedness → capped at tentative. |
| Endpoint roles (R1-F5) | `PTC`: radialUlnar; `TC`: distalProximal — ambiguous roles → declined (`geometry-ambiguous`). |
| Optional observations (R1-F3) | none |
| Boundary handling | margin ±0.01: values within the margin of an internal boundary show both neighbouring claim variants at tentative. |
| Order-tie handling (R1.3) | Reads no order-summed value; not affected. |
| Missing-data behaviour | Required crease missing / not observed → family declined: "This crease was not detected. That is usually a limitation of the photo or detector, and it means nothing about you." No variant is selected and no meaning is drawn from absence. |
| Uncertainty wording | clear: "Palmistry traditions often associate this with …" + "Even a clearly visible crease only tells us what tradition says, not what is true about you."; tentative: "Some palmistry traditions might associate this with …" + "The scan evidence here is limited, so treat this as a loose possibility." |
| Excluded deterministic claims | future events stated as fact; lifespan or longevity; health, illness or medical conditions; wealth or financial outcomes; marriage, divorce, partner or children counts; career success or failure; scientific validity of palmistry; meaning drawn from an absent or undetected crease |

| Variant (rule id) | Range | Observation text | Interpretation (user-facing) | Reflection prompt |
|---|---|---|---|---|
| `C-ORIGIN-JOINED` | −∞ ≤ value < 0.05 | Your head-line and life-line creases start close together. | a careful, considered approach to new ventures, preferring to plan before acting | What kind of preparation makes you feel ready to start something new at work? |
| `C-ORIGIN-NEAR` | 0.05 ≤ value < 0.1 | — (no claim) | — (no notable feature; nothing shown) | — |
| `C-ORIGIN-SEPARATE` | 0.1 ≤ value < +∞ | Your head-line and life-line creases start apart from each other. | an independent streak and comfort with taking the initiative | Where at work would you like more room to lead? |

### F-PTC-FORK — Career, strengths and working style

| Field | Specification |
|---|---|
| Required features | `PTC` (traditional "head line"), each with status `ok`. A branch near the ulnar end of the proximal transverse crease (traditional "writer's fork"): any branch with atT ≥ 0.8 (atT is measured from the radial end). |
| Traditional source / provenance | Western popular palmistry (chirology), general handbook tradition. Anatomical crease ↔ traditional line name is an approximate convention, not a measured equivalence. Source status: general-tradition-summary; no specific text consulted or quoted in G6-D0. Reviewer to confirm each attribution against a public-domain or licence-cleared source before any user exposure. Authored by Claude Opus 5.5 (AI), AURA-PALM-G6-D0, 2026-11-18; Aura draft; AI-generated; ownership unresolved (G3-L1 N3); guide-derived: false; review: PENDING_HUMAN_REVIEW. |
| Confidence requirement | evidence = min(scan, detection (basis-capped), class (source-capped), detector-status cap). ≥ 0.75 → clear; ≥ 0.5 → tentative; below → declined. |
| Contradictory evidence | Crease-level conflicts (class collision, recorded conflict, ambiguous identity) decline the family. |
| Frame dependency (R1-F4, R1.1-RV-05) | direction (radial/ulnar; axis reliable, AND handedness known, AND palm facing confirmed): **required**; axis (finger-base→wrist axis; scale reliable, no hand-rotated / palm-not-visible issue, and rotation consistent: a hand is rotated only when the absolute rotation angle is strictly greater than 45° — exactly 45° is not rotated — and the hand-rotated flag must agree with the angle; disagreement → rotation-conflict, agreement beyond 45° → rotation-out-of-range): **required** (via direction); scale (palm width from landmarks; landmarks present and no hand-cut-off / hand-too-small / palm-not-visible issue): **not required**. A required but unreliable frame property → declined (`frame-unreliable`, with `frameReasons`). Palm side unconfirmed → capped at tentative; model-estimated handedness → capped at tentative. |
| Endpoint roles (R1-F5) | `PTC`: radialUlnar — ambiguous roles → declined (`geometry-ambiguous`). |
| Optional observations (R1-F3) | none |
| Boundary handling | margin ±0: values within the margin of an internal boundary show both neighbouring claim variants at tentative. |
| Order-tie handling (R1.3) | Reads no order-summed value; not affected. |
| Missing-data behaviour | Required crease missing / not observed → family declined: "This crease was not detected. That is usually a limitation of the photo or detector, and it means nothing about you." No variant is selected and no meaning is drawn from absence. |
| Uncertainty wording | clear: "Palmistry traditions often associate this with …" + "Even a clearly visible crease only tells us what tradition says, not what is true about you."; tentative: "Some palmistry traditions might associate this with …" + "The scan evidence here is limited, so treat this as a loose possibility." |
| Excluded deterministic claims | future events stated as fact; lifespan or longevity; health, illness or medical conditions; wealth or financial outcomes; marriage, divorce, partner or children counts; career success or failure; scientific validity of palmistry; meaning drawn from an absent or undetected crease |

| Variant (rule id) | Range | Observation text | Interpretation (user-facing) | Reflection prompt |
|---|---|---|---|---|
| `C-PTC-NO-FORK` | −∞ ≤ value < 1 | — (no claim) | — (no notable feature; nothing shown) | — |
| `C-PTC-FORK` | 1 ≤ value < +∞ | Your head-line crease splits into a small fork near its end. | versatility and an ability to see a problem from more than one side | Which of your skills surprises people when they first see it? |

### F-CENTRAL-LONGITUDINAL — Career, strengths and working style

| Field | Specification |
|---|---|
| Required features | `CENTRAL_LONGITUDINAL` (traditional "fate line"), each with status `ok`. A roughly vertical minor crease through the centre of the palm (traditional "fate line"). Not an annotated class in G4-B; identified here by geometry only, so capped at tentative. |
| Traditional source / provenance | Western popular palmistry (chirology), general handbook tradition. Anatomical crease ↔ traditional line name is an approximate convention, not a measured equivalence. Source status: general-tradition-summary; no specific text consulted or quoted in G6-D0. Reviewer to confirm each attribution against a public-domain or licence-cleared source before any user exposure. Authored by Claude Opus 5.5 (AI), AURA-PALM-G6-D0, 2026-11-18; Aura draft; AI-generated; ownership unresolved (G3-L1 N3); guide-derived: false; review: PENDING_HUMAN_REVIEW. **Hypothesis feature** (no annotated reference class). |
| Confidence requirement | evidence = min(scan, detection (basis-capped), class (source-capped), detector-status cap, hypothesis cap 0.74). ≥ 0.75 → clear; ≥ 0.5 → tentative; below → declined. Never clear. |
| Contradictory evidence | Crease-level conflicts (class collision, recorded conflict, ambiguous identity) decline the family. |
| Frame dependency (R1-F4, R1.1-RV-05) | direction (radial/ulnar; axis reliable, AND handedness known, AND palm facing confirmed): **not required**; axis (finger-base→wrist axis; scale reliable, no hand-rotated / palm-not-visible issue, and rotation consistent: a hand is rotated only when the absolute rotation angle is strictly greater than 45° — exactly 45° is not rotated — and the hand-rotated flag must agree with the angle; disagreement → rotation-conflict, agreement beyond 45° → rotation-out-of-range): **required**; scale (palm width from landmarks; landmarks present and no hand-cut-off / hand-too-small / palm-not-visible issue): **required**. A required but unreliable frame property → declined (`frame-unreliable`, with `frameReasons`). Palm side unconfirmed → capped at tentative. |
| Endpoint roles (R1-F5) | none |
| Optional observations (R1-F3) | none |
| Boundary handling | margin ±0.03: values within the margin of an internal boundary show both neighbouring claim variants at tentative. |
| Order-tie handling (R1.3) | Reads an order-summed length: on a 4-dp tie only readings selected in both point orders are kept; a claim made in one order only → abstain (quiet); a difference in ambiguity → tentative; identical selections → unchanged. A vertical MINOR crease whose centre lies in x ∈ [0.3, 0.7] in either order competes for conflict detection; it is identified only if it is the sole competitor and its centre lies in the range in both orders. |
| Missing-data behaviour | Required crease missing / not observed → family declined: "This crease was not detected. That is usually a limitation of the photo or detector, and it means nothing about you." Plus: "Many hands show no clear vertical crease here; in this reading its absence carries no meaning." No variant is selected and no meaning is drawn from absence. |
| Uncertainty wording | clear: "Palmistry traditions often associate this with …" + "Even a clearly visible crease only tells us what tradition says, not what is true about you."; tentative: "Some palmistry traditions might associate this with …" + "The scan evidence here is limited, so treat this as a loose possibility." |
| Excluded deterministic claims | future events stated as fact; lifespan or longevity; health, illness or medical conditions; wealth or financial outcomes; marriage, divorce, partner or children counts; career success or failure; scientific validity of palmistry; meaning drawn from an absent or undetected crease |

| Variant (rule id) | Range | Observation text | Interpretation (user-facing) | Reflection prompt |
|---|---|---|---|---|
| `C-FATE-SHORT` | −∞ ≤ value < 0.35 | — (no claim) | — (no notable feature; nothing shown) | — |
| `C-FATE-PRESENT` | 0.35 ≤ value < +∞ | A vertical crease runs up through the middle of your palm. | a sense of purpose or direction in work | What thread of purpose runs through the work you have enjoyed most? |

### F-TC-ARC — Life direction and reflection

| Field | Specification |
|---|---|
| Required features | `TC` (traditional "life line"), each with status `ok`. Width of the thenar crease arc (traditional "life line"): its furthest reach from the radial edge. |
| Traditional source / provenance | Western popular palmistry (chirology), general handbook tradition. Anatomical crease ↔ traditional line name is an approximate convention, not a measured equivalence. Source status: general-tradition-summary; no specific text consulted or quoted in G6-D0. Reviewer to confirm each attribution against a public-domain or licence-cleared source before any user exposure. Authored by Claude Opus 5.5 (AI), AURA-PALM-G6-D0, 2026-11-18; Aura draft; AI-generated; ownership unresolved (G3-L1 N3); guide-derived: false; review: PENDING_HUMAN_REVIEW. |
| Confidence requirement | evidence = min(scan, detection (basis-capped), class (source-capped), detector-status cap). ≥ 0.75 → clear; ≥ 0.5 → tentative; below → declined. |
| Contradictory evidence | Crease-level conflicts decline the family. In-crease contradiction lowers the tier by one: `(c) => (c.breaks.TC !== null && c.breaks.TC >= 2 ? 'The crease appears broken in several places, so the arc is hard to trace.' : null)` |
| Frame dependency (R1-F4, R1.1-RV-05) | direction (radial/ulnar; axis reliable, AND handedness known, AND palm facing confirmed): **required**; axis (finger-base→wrist axis; scale reliable, no hand-rotated / palm-not-visible issue, and rotation consistent: a hand is rotated only when the absolute rotation angle is strictly greater than 45° — exactly 45° is not rotated — and the hand-rotated flag must agree with the angle; disagreement → rotation-conflict, agreement beyond 45° → rotation-out-of-range): **required** (via direction); scale (palm width from landmarks; landmarks present and no hand-cut-off / hand-too-small / palm-not-visible issue): **required**. A required but unreliable frame property → declined (`frame-unreliable`, with `frameReasons`). Palm side unconfirmed → capped at tentative; model-estimated handedness → capped at tentative. |
| Endpoint roles (R1-F5) | none |
| Optional observations (R1-F3) | none |
| Boundary handling | margin ±0.02: values within the margin of an internal boundary show both neighbouring claim variants at tentative. |
| Order-tie handling (R1.3) | Reads no order-summed value; not affected. |
| Missing-data behaviour | Required crease missing / not observed → family declined: "This crease was not detected. That is usually a limitation of the photo or detector, and it means nothing about you." No variant is selected and no meaning is drawn from absence. |
| Uncertainty wording | clear: "Palmistry traditions often associate this with …" + "Even a clearly visible crease only tells us what tradition says, not what is true about you."; tentative: "Some palmistry traditions might associate this with …" + "The scan evidence here is limited, so treat this as a loose possibility." |
| Excluded deterministic claims | future events stated as fact; lifespan or longevity; health, illness or medical conditions; wealth or financial outcomes; marriage, divorce, partner or children counts; career success or failure; scientific validity of palmistry; meaning drawn from an absent or undetected crease; vitality or physical stamina; length of life |

| Variant (rule id) | Range | Observation text | Interpretation (user-facing) | Reflection prompt |
|---|---|---|---|---|
| `L-TC-NARROW` | −∞ ≤ value < 0.3 | Your life-line crease curves close around the base of the thumb. | a preference for a calm, steady pace and a close circle | What does a good, unhurried week look like for you? |
| `L-TC-MID` | 0.3 ≤ value < 0.42 | — (no claim) | — (no notable feature; nothing shown) | — |
| `L-TC-WIDE` | 0.42 ≤ value < +∞ | Your life-line crease sweeps in a wide arc into the palm. | enthusiasm for variety, new places and new experiences | Which new experience would you most like to make room for this year? |

### F-TC-BREAKS — Life direction and reflection

| Field | Specification |
|---|---|
| Required features | `TC` (traditional "life line"), each with status `ok`. Observed breaks along the thenar crease, from a source that observes breaks. Detector gap-bridging metadata (gapsBridged) is not a break and is never used. |
| Traditional source / provenance | Western popular palmistry (chirology), general handbook tradition. Anatomical crease ↔ traditional line name is an approximate convention, not a measured equivalence. Source status: general-tradition-summary; no specific text consulted or quoted in G6-D0. Reviewer to confirm each attribution against a public-domain or licence-cleared source before any user exposure. Authored by Claude Opus 5.5 (AI), AURA-PALM-G6-D0, 2026-11-18; Aura draft; AI-generated; ownership unresolved (G3-L1 N3); guide-derived: false; review: PENDING_HUMAN_REVIEW. **Hypothesis feature** (no annotated reference class). |
| Confidence requirement | evidence = min(scan, detection (basis-capped), class (source-capped), detector-status cap, hypothesis cap 0.74). ≥ 0.75 → clear; ≥ 0.5 → tentative; below → declined. Never clear. |
| Contradictory evidence | Crease-level conflicts (class collision, recorded conflict, ambiguous identity) decline the family. |
| Frame dependency (R1-F4, R1.1-RV-05) | direction (radial/ulnar; axis reliable, AND handedness known, AND palm facing confirmed): **not required**; axis (finger-base→wrist axis; scale reliable, no hand-rotated / palm-not-visible issue, and rotation consistent: a hand is rotated only when the absolute rotation angle is strictly greater than 45° — exactly 45° is not rotated — and the hand-rotated flag must agree with the angle; disagreement → rotation-conflict, agreement beyond 45° → rotation-out-of-range): **not required**; scale (palm width from landmarks; landmarks present and no hand-cut-off / hand-too-small / palm-not-visible issue): **not required**. A required but unreliable frame property → declined (`frame-unreliable`, with `frameReasons`). Palm side unconfirmed → capped at tentative. |
| Endpoint roles (R1-F5) | none |
| Optional observations (R1-F3) | `TC`: breaks — unsupported by the detector → `feature-unsupported`; absent → `feature-not-observed`. `gapsBridged` is never read. |
| Boundary handling | margin ±0: values within the margin of an internal boundary show both neighbouring claim variants at tentative. |
| Order-tie handling (R1.3) | Reads no order-summed value; not affected. |
| Missing-data behaviour | Required crease missing / not observed → family declined: "This crease was not detected. That is usually a limitation of the photo or detector, and it means nothing about you." No variant is selected and no meaning is drawn from absence. |
| Uncertainty wording | clear: "Palmistry traditions often associate this with …" + "Even a clearly visible crease only tells us what tradition says, not what is true about you."; tentative: "Some palmistry traditions might associate this with …" + "The scan evidence here is limited, so treat this as a loose possibility." |
| Excluded deterministic claims | future events stated as fact; lifespan or longevity; health, illness or medical conditions; wealth or financial outcomes; marriage, divorce, partner or children counts; career success or failure; scientific validity of palmistry; meaning drawn from an absent or undetected crease; accidents, illness or dangerous periods; timing of events |

| Variant (rule id) | Range | Observation text | Interpretation (user-facing) | Reflection prompt |
|---|---|---|---|---|
| `L-TC-CONTINUOUS` | −∞ ≤ value < 1 | — (no claim) | — (no notable feature; nothing shown) | — |
| `L-TC-CHAPTERS` | 1 ≤ value < +∞ | Your life-line crease shows one or more breaks. | a life seen as a series of chapters, with room for change and fresh starts | Looking back, which change opened a chapter you are glad of? |

