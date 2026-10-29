# AURA-PALM-01-G3-C: Counsel Distribution Checklist

**Status: NOT AUTHORIZED. Nothing sent.** Use this only after the product owner authorizes distribution to the appointed counsel.

## 1. Authorization checkpoints (in order)

| # | Checkpoint | Who | Evidence | Done |
|---|---|---|---|---|
| AC-1 | Counsel selected against `AURA_PALM_01_G3_C_REVIEWER_REQUIREMENTS.md` (§2 required items met, §3 conflicts clear) | Product owner | Completed assignment fields (§7 there) | ☐ |
| AC-2 | Confidentiality basis and engagement terms agreed **in writing** (engagement letter / NDA / privilege) | Product owner + counsel | Signed instrument on file | ☐ |
| AC-3 | Owner inputs added to the brief: commercial model and markets (§A), audience confirmation, licensor residence / provider location (C4, Annex E), AI provider terms (C3.3), sender details, deadline. **Pre-send cleanup:** remove the "DRAFT. NOT SENT." banner and internal file-name references; export to PDF | Product owner | Final brief version + its SHA-256 | ☐ |
| AC-4 | Distribution to counsel explicitly authorized | Product owner | Written authorization (date) | ☐ |
| AC-5 | Send, then confirm receipt | Authorized sender | Receipt log (§5) | ☐ |

**Stop if any checkpoint is incomplete.**

## 2. Controls

| # | Control | Requirement | Done |
|---|---|---|---|
| 1 | Named reviewer, qualifications verified | AC-1 complete; recorded in the requirements doc §7 | ☐ |
| 2 | Approved contact channel | Recorded before sending; counsel's verified address only | ☐ |
| 3 | Agreed deadline | Recorded | ☐ |
| 4 | Confidentiality and engagement | AC-2 complete. A private channel alone is not enough. | ☐ |
| 5 | Frozen PDF checksum | Re-run immediately before sending; must equal `d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88`. If it differs, STOP. | ☐ |
| 6 | Exact attachment inventory | §3 below, nothing else | ☐ |
| 7 | Minimum necessary material | Brief + PDF only. No source code, governance records, internal QA reports, transcripts or other reviewers' material unless separately authorized. | ☐ |
| 8 | Private transfer method | Direct transfer to counsel (for example, counsel's secure upload, or encrypted email if counsel agrees). No public links, open shared folders, or third-party upload services the owner hasn't approved. | ☐ |
| 9 | Receipt confirmation | Counsel confirms receipt and the PDF checksum or version | ☐ |
| 10 | Review tracking | Record in `AURA_PALM_01_G3_REVIEW_TRACKER.md` (Reviewer C column; L-items in §6) and in `AURA_PALM_01_G3_DISTRIBUTION/DISTRIBUTION_MANIFEST.md` | ☐ |
| 11 | Evidence retention | Keep: the sent brief (and its SHA-256), the PDF reference copy (`AURA_PALM_01_G3_DISTRIBUTION/reference/v1.1/`), the transmission record, receipt, and the opinion (with its SHA-256) under `AURA_PALM_01_G3_DISTRIBUTION/returned/` | ☐ |
| 12 | Version integrity | The opinion must reference G3 v1.1 / `d5fb7a1e…`. If the content changes later, counsel re-confirms the affected passages. | ☐ |

Command for control 5:

```bash
shasum -a 256 /Users/stephen/Desktop/Claude/auraschedule-math-core/AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.pdf
```

## 3. Attachment inventory

| # | File | Version / checksum | Notes |
|---|---|---|---|
| 1 | Counsel brief (final, with owner inputs; exported from `AURA_PALM_01_G3_C_COUNSEL_BRIEF.md`) | Record its SHA-256 at export | Annexes A–E included |
| 2 | `AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.pdf` | `d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88` | Unchanged. Contains the unpublished content and screenshots; covered by the confidentiality basis |
| — | Zysk 2025 article | **Link only** (public) | Not attached |
| — | Source code, governance records, QA/audit reports, transcripts | **Not sent** | Only if separately authorized |

## 4. Response handling

1. Store the opinion under `AURA_PALM_01_G3_DISTRIBUTION/returned/` and record its SHA-256.
2. Transcribe conclusions **verbatim** into the tracker for L1, L2 and N3, plus L3, L4 and L6 if counsel opines on them. Use the reconciliation template.
3. Keep **legal conclusions** separate from **product decisions**. The owner decides the remedy (accept BY-SA / rewrite / seek permission) and records it.
4. No L-finding closes until its closure evidence (`AURA_PALM_01_G3_L1_LICENSING_ACTIONS.md`) is accepted and recorded.
5. Any content change counsel recommends needs separate authorization, then reviewer re-confirmation (A/B for wording, C for licensing).

## 5. Receipt log

| Sent (UTC) | To (counsel / firm) | Channel | Sender | Brief SHA-256 | PDF SHA-256 verified | Receipt confirmed (date / evidence) |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | *Nothing sent* |
