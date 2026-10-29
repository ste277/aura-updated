# AURA-PALM-01-G4-B: Evaluation Dataset Register

**Status: EMPTY — AWAITING_OWNER_DATA. 0 consented open-palm images.** No images were scraped, downloaded or assumed licensed. The assistant cannot collect consented photographs of people; the owner (or people they recruit) must supply them under the protocol below.

## 1. Requirements (from the frozen criteria §1)

| Requirement | Minimum |
|---|---|
| Images | ≥ 30 open-palm images |
| Participants | ≥ 10 people; split dev/held-out **by person** |
| Hands | Left and right from each participant where possible |
| Skin-tone groups (Fitzpatrick, self-reported or annotator-estimated) | I–II, III–IV, V–VI with ≥ 6 images each |
| Hand sizes | Adult small/medium/large; minors **excluded** |
| Conditions | Clear daylight, indoor warm light, low light, moderate blur, partial occlusion (≤ 25%), natural orientations |
| Cameras | Rear and front, at least two phone models |
| Negatives | Back-of-hand images (≥ 5) for palm-vs-back and false-positive checks |
| Annotation | DTC, PTC, TC (anatomical) polylines + MINOR, using `research/palm-scan-g4a/annotate.html` (local) |

## 2. Consent and provenance (per image)

Each participant signs a short written consent covering:
- **Purpose:** testing on-device palm-crease detection for Aura research. Not identification, not biometric matching, not publication.
- **Permitted uses:** local evaluation by the named researcher(s); derived numeric results may appear in internal reports. **No** sharing, publication, model training by third parties, or cloud upload.
- **Retention:** until the end of G4 research, or [date], then deletion (with a deletion record).
- **Withdrawal:** at any time, with deletion within [N] days.
- **Data minimisation:** photo of the palm only (no face, jewellery, tattoos or other identifying marks in frame where possible); no name stored with the image.

## 3. Register (one row per image; no names)

| Image ID | Participant ID | Hand | Side | Camera / device | Conditions | Skin-tone group | Consent form ref | Permitted uses | Captured (date) | Annotated by / date | Split | Delete by | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | — | — | — | *No images yet* |

The mapping from participant ID to identity (if any) is held only by the owner, separately from the images, or not at all.

## 4. Storage and handling

- Store in `research/palm-scan-g4a/eval/` (git-ignored) or an owner-approved, access-restricted local location. Never commit, push, sync to the cloud or attach.
- `eval/manifest.json` lists `{file, annotation, split, person}`; annotations hold coordinates only.
- The split is fixed **before** any evaluation run and recorded here.

## 5. Owner actions required

1. Approve the consent text (and get legal/privacy review if required for the jurisdictions).
2. Recruit participants and capture images per §1.
3. Annotate (or designate annotators), ideally with two annotators on a subset for agreement.
4. Approve storage location, retention date and deletion procedure.


---

## Amendment (2026-11-11, G4-B1)

- **§4 Storage is superseded** by `AURA_PALM_01_G4_B1_DATASET_STORAGE_PLAN.md`. Participant data must **not** be stored in `research/palm-scan-g4a/eval/` or anywhere inside the repository. Use the encrypted volumes under `~/AuraResearch/palm-g4b/`.
- **§1 "self-reported or annotator-estimated" skin tone is superseded:** self-report only, optional. No inference from photographs (`AURA_PALM_01_G4_B1_COLLECTION_PROTOCOL.md` §2).
- **§2 consent** is superseded by `AURA_PALM_01_G4_B1_CONSENT_FORM.md`. Collection and annotation protocols: `AURA_PALM_01_G4_B1_COLLECTION_PROTOCOL.md`, `AURA_PALM_01_G4_B1_ANNOTATION_PROTOCOL.md`.
- Original text above is preserved unchanged.
