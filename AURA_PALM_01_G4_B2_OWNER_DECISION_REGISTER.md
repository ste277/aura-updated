# AURA-PALM-01-G4-B2: Owner Decision Register

**No approvals inferred.** Status values: APPROVED / REJECTED / AWAITING_OWNER / LEGAL_REVIEW_REQUIRED. As of 2026-11-11, **no item is approved.**

| # | Decision required | Recommended default | Supporting evidence | Privacy / legal implications | Owner approval | Status |
|---|---|---|---|---|---|---|
| A-01 | Approve consent form text and fill every [OWNER] field (entity, contact, access list, retention, withdrawal period, publication scope) | Retention: 6 months after first capture or end of G4 (earlier); withdrawal: 7 days; publication: internal aggregates only | B1 consent form; privacy recommendations #3–4 | Notice adequacy; controller identity ⚖ | ☐ | **LEGAL_REVIEW_REQUIRED** (entity, formalities) + AWAITING_OWNER (fields) |
| A-02 | Qualified privacy/legal review (biometric status, consent formalities, DPIA/ethics) or a documented risk acceptance | Obtain review before collection | B1 privacy risk register §1, §3 | Biometric statutes; special-category data ⚖ | ☐ | **LEGAL_REVIEW_REQUIRED** |
| A-03 | Storage location and two encrypted images (or paper consent) | `~/AuraResearch/palm-g4b/` with DATA + CONSENT images | Storage review: FileVault on; no cloud sync; design meets requirements | Confidentiality; minimisation | ☐ | AWAITING_OWNER |
| A-04 | Backup policy; Time Machine exclusion | No backup; Time Machine n/a (none configured) | Storage review §1 | Copies extend deletion scope | ☐ | AWAITING_OWNER |
| A-05 | Metadata stripping tool | ImageMagick (installed) + `verify_clean.sh`; no installation needed | Metadata tool evaluation (synthetic tests) | Removes GPS and device identifiers | ☐ | AWAITING_OWNER |
| A-06 | Code-to-person key | No key; withdrawal by participant-held code | Privacy recommendations #8 | Re-identification risk vs ability to contact ⚖ | ☐ | AWAITING_OWNER (⚖ confirm acceptability) |
| A-07 | Skin-tone self-report and C7 handling | Keep optional self-report; keep frozen criteria; C7 by skin tone "not measurable" if insufficient | Collection protocol §2; frozen criteria `bcc8f204…` | Sensitive data ⚖; fairness measurement | ☐ | **LEGAL_REVIEW_REQUIRED** + AWAITING_OWNER |
| A-08 | Research-tool changes before annotation (uncertain/unsuitable fields; skin-tone transcribed from consent only) **plus** the harness/manifest data-path changes (storage review §3) | Approve | Annotation protocol §2; storage review §3 | Prevents inference; keeps data out of the repo | ☐ | AWAITING_OWNER |
| A-09 | Treat "uncertain" creases as MINOR (criteria change-log entry, pre-results) | Approve | Annotation protocol §2 | None (methodology) | ☐ | AWAITING_OWNER |
| A-10 | Local pre-commit hook blocking image/annotation files | Approve (defence in depth) | Storage plan §4 | Reduces accidental commit risk | ☐ | AWAITING_OWNER |
| A-11 | Confirm FileVault; no cloud sync of `~/AuraResearch`; phone cloud photo sync off during sessions (or a dedicated phone) | — | FileVault **On** and no cloud clients (verified). Phone settings unverified | Leakage via phones' cloud backup | ☐ | AWAITING_OWNER (phones) |
| A-12 | Acknowledge the AI-access safeguards S-1 to S-8 | Acknowledge | AI access safeguards (code verified compliant) | Prevents transmission to model providers | ☐ | **AWAITING_OWNER (acknowledgment pending)** |
| A-13 | Name recruiter, annotators (A1/A2) and access list | Owner + 1–2 annotators | Annotation protocol | Access minimisation | ☐ | AWAITING_OWNER |
| A-14 | Dates: collection window, annotation, evaluation, retention end | Collection ≤ 4 weeks after authorization | — | Retention compliance | ☐ | AWAITING_OWNER |
