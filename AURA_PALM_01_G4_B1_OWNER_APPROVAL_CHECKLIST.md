# AURA-PALM-01-G4-B1: Owner Approval Checklist

**Readiness is not authorization.** Completing this checklist does **not** start collection. Collection begins only with an explicit owner authorization (Part C). Status as of 2026-11-11: **all owner items open.**

## Part A: Owner decisions

| # | Decision | Options / notes | Owner response |
|---|---|---|---|
| A-01 | Approve the consent form text (`AURA_PALM_01_G4_B1_CONSENT_FORM.md`), filling every **[OWNER]** field: controller/entity, contact, access list, retention date, withdrawal period, publication scope | — | ☐ |
| A-02 | Qualified privacy/legal review of the ⚖ items (biometric status, consent formalities, DPIA/ethics) for participants' jurisdictions | Review / documented decision to proceed without (owner risk) | ☐ |
| A-03 | Storage: approve `~/AuraResearch/palm-g4b/` with separate DATA and CONSENT encrypted images (or paper consent) | — | ☐ |
| A-04 | Backup: none, or one **encrypted** offline copy (logged for deletion); Time Machine exclusion yes/no | — | ☐ |
| A-05 | Metadata stripping tool (e.g. install `exiftool`, or approve a local re-encode script) | Installing software is the owner's decision | ☐ |
| A-06 | Code key: none (withdraw by code only) or a key in the CONSENT volume | — | ☐ |
| A-07 | **Skin-tone data:** keep the optional **self-report** question, or remove it. Either way, **no inference from photos**. Also decide criteria impact: (a) keep the frozen §1/C7 and report C7 by skin tone as "not measurable" if self-reports are insufficient; or (b) log a criteria amendment **before any results are seen** | (a) is recommended (no change to frozen criteria) | ☐ |
| A-08 | Approve research-tool changes before annotation: uncertain/unsuitable fields; skin-tone field transcribed from consent only (annotation protocol §2) | — | ☐ |
| A-09 | Scoring of "uncertain" creases as MINOR (criteria change-log entry, pre-results) | Approve / reject | ☐ |
| A-10 | Optional local pre-commit hook blocking image and annotation files | — | ☐ |
| A-11 | Confirm FileVault is enabled; confirm no cloud client syncs `~/AuraResearch`; confirm phones' cloud photo sync off during sessions (or a dedicated phone) | — | ☐ |
| A-12 | **Acknowledge the AI-agent rule** (privacy risk register R-04): no AI assistant views participant images or pages rendering them; agents read aggregate JSON only | Required | ☐ |
| A-13 | Name participants' recruiter, annotators (A1/A2) and access list | Roles, not shared here | ☐ |
| A-14 | Target dates: collection window, annotation, evaluation; retention end | — | ☐ |

## Part B: Preparation status (done in G4-B1, documentation only)

| Item | Status |
|---|---|
| Consent form revised with owner fields and ⚖ flags | ☑ |
| Storage architecture documented (nothing created) | ☑ |
| Collection protocol (10 adults, 30 palms, both hands, lighting, 2+ phones, front/rear, 5 back-of-hand, blur/occlusion; no inference) | ☑ |
| Annotation protocol (DTC/PTC/TC, uncertain, unsuitable, format, QA, second annotator, split) | ☑ |
| Privacy risk register with unresolved jurisdiction items | ☑ |
| Accuracy criteria preserved (unchanged; SHA-256 `bcc8f204…43a9`) | ☑ |
| Superseded records annotated (G4-B consent draft, dataset register §4) | ☑ |

## Part C: Authorization to begin collection (owner only)

| Field | Value |
|---|---|
| Authorize G4-B dataset collection under consent version ______ | ☐ Granted / ☐ Not granted |
| Conditions | |
| Authorized by / date | |

## Unresolved privacy decisions (summary)

1. Applicable jurisdictions and biometric-law status of palm photos (⚖).
2. Consent formalities and whether a DPIA or ethics review is needed (⚖).
3. Controller identity, contact, retention period and withdrawal period.
4. Self-reported skin tone: keep or drop, and the C7 reporting consequence.
5. Metadata-stripping tool; backup policy; code-key policy.

## Status (unchanged)

Real-image collection HOLD · Annotation HOLD · G4-B evaluation awaiting dataset · Native camera HOLD · G3 licensing pending · Publication HOLD · Merge freeze ACTIVE · Secondary evidence backup awaiting external storage.
