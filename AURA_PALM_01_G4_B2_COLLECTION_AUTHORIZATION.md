# AURA-PALM-01-G4-B2: Collection Authorization Package

**Status: NOT AUTHORIZED.** Real-image collection (G4-B3) is on HOLD. This package lists exactly what must be true before it can start.

## 1. Decision register summary

See `AURA_PALM_01_G4_B2_OWNER_DECISION_REGISTER.md`.

| Status | Items |
|---|---|
| APPROVED | none |
| LEGAL_REVIEW_REQUIRED | A-01 (entity, formalities), A-02, A-07 (and ⚖ confirmation of A-06) |
| AWAITING_OWNER | A-03, A-04, A-05, A-06, A-08, A-09, A-10, A-11, A-12, A-13, A-14 |
| REJECTED | none |

## 2. Unresolved legal questions ⚖

1. Applicable jurisdictions; whether palm photos (and landmark extraction) are biometric or special-category data there.
2. Consent formalities (written release, notice content, language); DPIA/ethics review.
3. Controller/responsible entity and data-protection contact.
4. Lawfulness of the retention and withdrawal periods; whether backups are covered.
5. Status of the optional skin-tone self-report.
6. Acceptability of withdrawal by code without a key.

## 3. Readiness

| Area | Status |
|---|---|
| Consent form | Drafted (B1-draft-1); **not approved**; owner fields open |
| Storage | Design **validated** (FileVault on; no cloud sync); **not created** |
| Metadata stripping | Method **validated on synthetic data** (ImageMagick + verifier); scripts ready |
| AI access safeguards | Rules written; research code verified compliant; **owner acknowledgment pending** |
| Research-code gaps | Harness and manifest must read from the encrypted volume (storage review §3); annotation-tool field changes (A-08). **Not yet made; need approval** |
| Accuracy criteria | **Unchanged** (frozen, SHA-256 `bcc8f204…43a9`) |

## 4. Collection requirements (from the G4-B1 collection protocol)

≥ 10 consenting adults · ≥ 30 open-palm photos · both hands · daylight/indoor/low light · ≥ 2 phone models, front and rear cameras · ≥ 5 back-of-hand controls · ≥ 5 mildly blurred and ≥ 5 partly occluded · hand-only framing · coded file names · EXIF stripped and verified · no demographic inference.

## 5. Must be complete before any real-image collection

| # | Requirement | Done |
|---|---|---|
| P-1 | A-02 legal review completed, **or** a written owner risk acceptance of the unresolved legal questions | ☐ |
| P-2 | A-01 consent form approved with all fields filled; version number assigned | ☐ |
| P-3 | A-03/A-04 storage created by the owner (passphrases typed by the owner); permissions and Spotlight off verified | ☐ |
| P-4 | A-05 tool confirmed; one synthetic dry run through `strip_metadata.sh` inside the volume prints CLEAN | ☐ |
| P-5 | A-08 research-code changes made (volume data path; annotation fields) and verified | ☐ |
| P-6 | A-11 phone cloud photo sync off (or dedicated phone) confirmed | ☐ |
| P-7 | **A-12 AI-access safeguards acknowledged** | ☐ |
| P-8 | A-06, A-07, A-09, A-10, A-13, A-14 decided | ☐ |

## 6. Privacy risk acceptance (owner)

| Risk (B1 register) | Accept as mitigated? | Notes |
|---|---|---|
| R-01 accidental repo/cloud storage | ☐ | |
| R-02 unauthorised access | ☐ | |
| R-03 hidden metadata | ☐ | |
| R-04 AI-agent transmission | ☐ | |
| R-05 MediaPipe telemetry | ☐ | |
| R-06 identifying features in frame | ☐ | |
| R-07 demographic inference | ☐ | |
| R-08 to R-15 (withdrawal, retention, disposal, phone residue, coercion, re-identification, outputs, caches) | ☐ | |
| Unresolved legal questions (§2), if proceeding without review | ☐ | Requires an explicit written statement |

## 7. Owner authorization (G4-B3 collection)

| Field | Value |
|---|---|
| I authorize G4-B3 dataset collection under consent version ______, subject to §5 being complete | ☐ Granted / ☐ Not granted |
| Conditions / limits (e.g. jurisdiction, number of participants) | |
| Authorized by / date | |

**Until this section is completed, no participant photographs will be collected, imported, annotated or processed.**

## Governance (unchanged)

G4-B1 PASS · G4-B2 preparation complete · Real-image collection HOLD · Annotation HOLD · G4-B evaluation awaiting dataset · Native camera HOLD · Licensing review pending · Publication HOLD · Merge freeze ACTIVE.
