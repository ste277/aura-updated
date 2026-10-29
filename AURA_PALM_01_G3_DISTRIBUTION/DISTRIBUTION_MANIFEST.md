# AURA-PALM-01-G3: PDF Distribution Manifest

**Status: READY, NOT DISTRIBUTED. AWAITING REVIEWER DETAILS.**
**Intended version: G3 v1.1 (draft).** v1.0 is superseded and must not be sent.

## 1. Intended artifact (v1.1)

| Field | Value |
|---|---|
| File name | `AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.pdf` |
| Working copy | `/Users/stephen/Desktop/Claude/auraschedule-math-core/AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.pdf` |
| Immutable reference copy | `AURA_PALM_01_G3_DISTRIBUTION/reference/v1.1/AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.REFERENCE.pdf` (mode `r--r--r--`) |
| **SHA-256** | **`d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88`** |
| Checksum file | `reference/v1.1/SHA256SUMS` (read-only; `shasum -a 256 -c SHA256SUMS` → OK) |
| Size / pages | 1,135,502 bytes / 32 pages |
| Version | G3 v1.1 (draft), 11 November 2026 |
| Content revision | `origin/main` @ `1741a95` (re-fetched 2026-11-11; no Palmistry file changed) |
| Generator | `generator/build_pdf_v1.1.py` (v1.0 generator kept as `generator/build_pdf_v1.0.py`; QA script `generator/qa_pdf.py`) |

## 2. Superseded artifact (v1.0)

| Field | Value |
|---|---|
| File | `AURA_PALM_01_G2_HUMAN_REVIEW_PACKAGE.pdf` (kept unchanged at the repository root) |
| SHA-256 | `988533d7f027ef5757f07b4580dac1306fe2689de55a6aabe259a9bee8a4353b` (re-verified 2026-11-11) |
| Reference copy | `reference/v1.0/` (read-only, `SHA256SUMS` → OK) |
| Superseded | 2026-11-11, by ticket AURA-PALM-01-G3-PDF-v1.1 |
| Reason | (1) Section 12 governance context corrected with recovered historical evidence. (2) TOC links and bookmarks fixed: in v1.0 every link and bookmark jumped to page 1 instead of its section. |
| Ever distributed? | **No** |

## 3. Pre-distribution verification of v1.1 (2026-11-11)

| Check | Result |
|---|---|
| File exists and is readable | PASS |
| Page count | PASS: 32 (unchanged from v1.0) |
| Draft banner on every page | PASS: 32/32 |
| Approval fields blank | PASS: sign-off residual text empty; 0 ticked boxes; no form fields |
| Screenshots 01–07 | PASS: 7 images, byte-identical to v1.0 |
| TOC links / bookmarks | PASS: 86/86 links and 43/43 bookmarks (12 top-level, 31 nested) resolve to the correct pages |
| Working copy = reference copy = manifest = messages = tracker SHA-256 | PASS (see the v1.1 QA report) |

## 4. Attachment checklist (for manual delivery)

For **each** reviewer, before sending:

- [ ] The reviewer's identity, qualifications and approved contact method are recorded in the tracker (§1) by the product owner.
- [ ] The due date has been agreed with the reviewer and recorded.
- [ ] The correct message is used: A → `01_MESSAGE_REVIEWER_A_SCHOLARLY.md`, B → `02_…_EDITORIAL_CULTURAL.md`, C → `03_…_LICENSING.md`. All `[…]` placeholders are filled.
- [ ] The **only** attachment is `AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.pdf`. **Not** the v1.0 file.
- [ ] The attachment's SHA-256 is re-checked immediately before sending and equals `d5fb7a1e…19a88`. Command:

```bash
shasum -a 256 /Users/stephen/Desktop/Claude/auraschedule-math-core/AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.pdf
```

- [ ] Sent through the approved channel only: a direct message to the named reviewer, with no public link or third-party upload unless the product owner approved it.
- [ ] Not attached: governance or QA reports, source code, the tracker, this manifest, generator scripts or other reviewers' messages.
- [ ] The send is logged in tracker §2 and in §5 below.

## 5. Delivery record

| Reviewer | Name | Channel | Sent (UTC) | Sent by | SHA-256 verified at send | Delivery confirmed |
|---|---|---|---|---|---|---|
| A: Scholarly | AWAITING DESIGNATION | — | — | — | — | — |
| B: Editorial / Cultural | AWAITING DESIGNATION | — | — | — | — | — |
| C: Licensing | AWAITING DESIGNATION | — | — | — | — | — |

## 6. Returned documents

Store returned files in `AURA_PALM_01_G3_DISTRIBUTION/returned/<reviewer>-<date>.<ext>` and compare annotated PDFs with `reference/v1.1/`.

| Received (UTC) | Reviewer | File | SHA-256 of returned file | References G3 v1.1 / `d5fb7a1e…`? |
|---|---|---|---|---|
| — | — | — | — | — |
