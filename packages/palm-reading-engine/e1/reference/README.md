# C1 reference oracle and checker (independent expected-output reference)

These files are an **independent reference** for E1, not the engine. They come from the AURA-PALM-03-C1 rev. 4 evidence. That evidence is preserved untracked at the repo root, and in `AuraEvidence/AURA_PALM_03_C1_REV4_PRESERVATION_20261125/`.

| File | Status |
|---|---|
| `original-c1-rev4/check_examples.py`, `original-c1-rev4/check_catalogue.py` | **Byte-identical** to the C1 rev. 4 evidence. Kept to show the defects below. |
| `check_examples.py` | **E1-R2 corrected** (finding F4; described below) |
| `check_catalogue.py` | **E1-R2 corrected** (finding F2; described below) |
| `mutation_tests_rev4.py`, `synthetic_reading_examples.json` | Byte-identical to C1 rev. 4 |
| `oracle_dump.py`, `oracle_eval.py`, `run_reference.py` | E1 harnesses. They add no oracle logic. |

## E1-R2 corrections (2026-11-25)

**F4: contradictory readings at an exact boundary** (`check_examples.py`, RC-7).
- **The defect:** range matching used open bands in floating point. A head slope of exactly 0.0800 is 0.03 from both thresholds (0.05 and 0.11), so it fell in neither band. It was then read as matching **both** head-line records, which emitted contradictory readings. E1 had the same defect.
- **Correction:**
  - values are compared as integer steps of 0.0001 (the serialized grid);
  - a value whose distance to a threshold is ≤ the margin is a boundary;
  - a clean match must be inside the range and more than the margin away from every threshold;
  - a feature that is a boundary for any record emits nothing.
- **Effect:** none of the 7 examples or the 5,760 sweep derivations changes. Behaviour changes only at exact margin distances. For example, a head slope of exactly 0.02 or 0.14 is now a boundary, where it used to emit.

**F2: application notes were not wording-checked** (`check_catalogue.py`).
- **The defect:** the prohibited-claim and forecast checks read only `observation`, `reading` and `reflection`.
- **Correction:** for records E1 can emit (eligible-initial), the checks cover **every** user-facing string field.
- **Why not all records:** other records keep the original field set. Under the stricter rule, the eligible-later record `C1-IN-MATSYA-PAIR-HOSPITALITY` fails: its application note uses "rich" in a disclaimer. That record is preserved unchanged and left for editorial review.

The corrected suite still passes on the packaged catalogue and catches all 40 rev. 4 mutations (`run_reference.py`). E1's tests also run the **original** oracle and checker to show that both defects existed before the correction.

## Not modelled by the oracle (E1 provisional policy V-B)

**Zone adjacency.** E1 also suppresses a zone record when the value is near an edge whose *other* side has that record. The oracle receives `nearEdge` only for the zone the value lies in.
