# AURA-PALM-01-G4-B1: Dataset Collection Protocol

**Status: PROPOSED. Collection is on HOLD** until the owner approval checklist is complete. It implements the frozen criteria (`AURA_PALM_01_G4_B_ACCURACY_CRITERIA.md` §1), which are unchanged.

## 1. Targets

| Item | Minimum | Notes |
|---|---|---|
| Participants | **≥ 10 consenting adults (18+)** | No minors |
| Open-palm photos | **≥ 30** | About 3–4 per participant |
| Hands | Left **and** right from each participant where possible | |
| Lighting | Daylight (near window), indoor warm light, low light | At least 1 non-daylight photo per participant |
| Cameras | Rear **and** front camera; **≥ 2 phone models** (ideally iPhone + Android) | Record model only, no serial numbers |
| Back-of-hand controls | **≥ 5** | For palm-vs-back (C2) and false positives (C5) |
| Degraded samples | **≥ 5 mildly blurred**, **≥ 5 partly occluded** (≤ 25% of palm, e.g. by the other hand's fingers) | Natural blur/occlusion only; no synthetic edits counted as "real" |
| Orientation | Natural: fingers up, ± about 30°; a few tilted shots | |

## 2. Diversity information (voluntary only)

- **No demographic category is inferred or assigned from photographs**, by the researcher, an annotator or software.
- Skin-tone group is recorded **only if the participant self-reports it** on the consent form (optional item 5). Otherwise it is "not stated".
- **Consequence for the frozen criteria:**
  - §1 asks for ≥ 6 images in each of three skin-tone groups, and C7 compares groups.
  - If self-reported data is insufficient, C7 by skin tone is reported as **"not measurable"**, and the dataset-adequacy statement says so.
  - Alternatively, the owner may decide on a criteria change (logged in the criteria change log **before** any results are seen).
  - This is an owner decision in the approval checklist (A-07).

## 3. Session procedure

1. **Before:** confirm the consent form version is approved; prepare participant codes (P01, P02, …); mount the DATA volume; confirm the phones' cloud photo sync is **off** for the session (or use a dedicated research phone).
2. **Consent:** the participant reads Part A, asks questions, completes Part B. The form goes to the CONSENT store or a locked paper file. **The code is the only link.**
3. **Preparation:** remove rings, watches and bracelets; sleeves back from the wrist; neutral, plain background (no documents, screens or faces in frame).
4. **Capture:** for each planned shot, frame **only the hand** (palm filling about 40–70% of the frame, fingers spread naturally); record the shot plan (hand, side, camera, lighting, blur/occlusion intent). If a face, tattoo or other identifying feature appears, delete and retake.
5. **Transfer:** USB / Image Capture straight to `/Volumes/PALM_G4B_DATA/images/_intake/` (see the storage plan). **No** AirDrop, email, messaging apps or cloud.
6. **Metadata removal:** strip all EXIF/XMP/GPS and convert HEIC to JPEG **inside the volume**, then rename to codes (`P07-L-01.jpg`). Approved tool: [OWNER: e.g. `exiftool -all=` (not currently installed) or a local re-encode script]. **Verify** no GPS or device serial remains.
7. **Clean-up:** delete the originals from `_intake/` and from the phones, including "Recently Deleted"; record in the register (codes, hand, side, camera model, conditions, consent ref, capture date).
8. **Unmount** the volume when not in use.

## 4. Register fields (codes only)

Image ID · participant code · hand · side · camera (front/rear) · phone model · conditions · self-reported skin-tone group or "not stated" · consent form version/ref · capture date · annotation status · split · delete-by date.

## 5. Stop rules

Stop and fix before continuing if: a photo contains a face or identifying feature; consent is incomplete; photos are found outside the DATA volume; any cloud sync or upload is detected; a participant asks to stop.
