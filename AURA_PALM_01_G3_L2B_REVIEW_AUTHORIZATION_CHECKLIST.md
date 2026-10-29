# AURA-PALM-01-G3-L2B: Human CC Review Authorization Checklist

**Readiness is not authorization.** Ticking every readiness item does **not** change gate G3-L2B-R. Only the owner's explicit, recorded authorization in Part B does.

## Part A: Readiness

| # | Item | Status | Evidence / where |
|---|---|---|---|
| A1 | Reviewer qualifications verified (R1–R5), independence and conflicts checked | ☐ `AWAITING_OWNER_INPUT` | Owner decisions #1; reviewer package §1 |
| A2 | Confidentiality documented in writing | ☐ `AWAITING_OWNER_INPUT` | Owner decisions #2 |
| A3 | Sharing channel approved | ☐ `AWAITING_OWNER_INPUT` | Owner decisions #2 |
| A4 | Review materials identified (minimum necessary) | ☑ **Ready** | Reviewer package §5: the request; PDF v1.1 (SHA-256 `d5fb7a1e…19a88`); implementation plan §§1–5 extract |
| A5 | Sensitive information excluded or approved | ☑ **Ready, with a rule** | Not sent: source code, governance records, **transcripts** (they contain unrelated conversations; manifest M-4). Any transcript extract needs redaction and owner approval |
| A6 | AI evidence manifest completed | ☑ **Done (snapshot)** | `AURA_PALM_01_G3_L2B_AI_EVIDENCE_MANIFEST.md` (174 files; SHA-256; commit cross-reference). Live-session caveat M-1 |
| A7 | AI provider terms identified | ◐ **Partial** | Published terms identified; **account type/plan `AWAITING_OWNER_INPUT`** (owner decisions #3) |
| A8 | App distribution facts | ◐ **Partial** | Repo facts recorded; **store status/EULA `AWAITING_OWNER_INPUT`** (owner decisions #4) |
| A9 | Outstanding legal questions identified | ☑ **Done** | OQ-L1 (iOS EULA/DRM vs CC BY-SA §3(b)(3)); OQ-L2 (AI authorship/ownership). Reviewer package §3D |
| A10 | Authorship confirmations (ticket text; no external edits) | ☐ `AWAITING_OWNER_INPUT` | Owner decisions #5, #6 |
| A11 | Licensor entity for any © line | ☐ `AWAITING_OWNER_INPUT` | Owner decisions #8 |
| A12 | Deadline confirmed | ☐ `AWAITING_OWNER_INPUT` | Owner decisions #9 |
| A13 | Frozen PDF checksum re-verified at send time | ☐ (at send) | Must equal `d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88` |

## Part B: Authorization (owner only)

| Field | Value |
|---|---|
| Authorization to designate the reviewer and send the package (gate G3-L2B-R) | ☐ Granted / ☐ Not granted |
| Authorized by (name) | |
| Date | |
| Conditions / limits | |
| Package version sent (SHA-256) | |

Gates are unchanged until Part B is completed: G3-L2B-R awaiting; G3-L2B-G HOLD; G3-L2-I HOLD; Publication HOLD; Merge freeze ACTIVE; External legal review DEFERRED, NOT WAIVED.
