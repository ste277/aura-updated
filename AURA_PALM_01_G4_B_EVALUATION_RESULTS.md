# AURA-PALM-01-G4-B: Evaluation Results

**Result: INCONCLUSIVE — NO EVALUATION DATA.** Palm-crease accuracy could not be measured, because no consented open-palm images exist (dataset register: 0 images). **No detection is presented as accurate.**

## 1. Pre-registration

| Item | Value |
|---|---|
| Criteria file | `AURA_PALM_01_G4_B_ACCURACY_CRITERIA.md` |
| Frozen | 2026-11-11T14:25:31Z, **before any data or tuning** |
| SHA-256 at freeze | `bcc8f204d791537dd36a2b146171626971605dc3c81d20ce4f58c62148ee43a9` |
| Changes since freeze | None |

## 2. Approaches prepared (research worktree)

| Approach | Status |
|---|---|
| A1: existing gated Hessian ridge suggestions (G4-A v1) | Implemented (`src/creases.js`, `detectCandidateCreases`) |
| A2: classical gated grey-level black-hat | **Implemented in G4-B** (`detectBlackhatCreases`), sharing the same component extractor |
| A3: lightweight on-device segmentation | **Not justified.** No licence-cleared crease-segmentation model or training data identified; training one needs the dataset that doesn't exist |
| A4: user-drawn / user-confirmed | Available (prototype UI: accept/reject + draw); scored as zero suggestions + manual draws |

## 3. Evaluation tooling (ready to run when data exists)

| Tool | Purpose | Verified |
|---|---|---|
| `annotate.html` / `src/annotate.js` | Local annotation of DTC/PTC/TC/MINOR polylines and metadata; saves coordinates-only JSON to the annotator's disk | Loads; no network beyond local |
| `src/metrics.js` | The frozen matching rule (τ = 3% palm width; ≥ 70% within; ≥ 50% coverage; one-to-one), C9 effort, Wilson intervals | **Self-test 9/9 passed** (`test/metrics.test.mjs`) |
| `evaluate.html` / `src/evaluate.js` | Runs A1/A2/A4 on `eval/manifest.json` (held-out by default); computes C1–C5, C9 and latency; flags datasets below the §1 minimum as INCONCLUSIVE | **Mechanics smoke test passed** on 2 placeholder images (MediaPipe test assets, no creases annotated): ran all approaches, flagged "INCONCLUSIVE: below the §1 minimum". Smoke files deleted afterwards. **Its numbers are not accuracy evidence** |

## 4. What can be stated from G4-A data (non-palm test images; not criteria-grade)

- Detection, handedness and the palm-vs-back heuristic behaved well on MediaPipe's test images (32/35 detected; palm/back 32/32). This is **not** the C1/C2 evaluation: the set lacks open palms and consented participants.
- A1 suggestions on palm-side gestures traced **finger edges**, which is a C6 failure mode. A2 produced no suggestions on the one palm-side smoke image (no conclusion possible).

## 5. Criteria status

| Criterion | Status |
|---|---|
| C1 Palm detection | **Not measured** (no dataset) |
| C2 Palm vs back | **Not measured** |
| C3 Crease recall | **Not measured** |
| C4 Precision | **Not measured** |
| C5 False positives | **Not measured** (criteria-grade) |
| C6 Finger-edge confusion | **Not measured** (criteria-grade); qualitative G4-A evidence of the failure mode |
| C7 Robustness | **Not measured** |
| C8 Latency (phones) | **Blocked** (no devices) |
| C9 Correction effort | **Not measured** |

## 6. Failures and limitations

- No evaluation dataset; no annotators; no devices.
- Tooling has been exercised only with placeholder data; behaviour on real annotations is untested beyond unit geometry.
