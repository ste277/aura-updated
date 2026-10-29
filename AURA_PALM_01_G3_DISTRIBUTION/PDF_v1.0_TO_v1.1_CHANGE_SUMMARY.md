# Palmistry Human Review PDF: v1.0 → v1.1 change summary

| | v1.0 (superseded) | v1.1 (intended) |
|---|---|---|
| File | `AURA_PALM_01_G2_HUMAN_REVIEW_PACKAGE.pdf` | `AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.pdf` |
| SHA-256 | `988533d7f027ef5757f07b4580dac1306fe2689de55a6aabe259a9bee8a4353b` | `d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88` |
| Pages | 32 | 32 (no change; pagination and TOC page numbers identical) |
| Distributed | Never | Not yet |

## Method

v1.1 was built with the v1.0 generator (`generator/build_pdf_v1.0.py`) and the same inputs, all re-verified byte-identical: content exported from `origin/main` @ `1741a95`, the I1 packet, the G1 package and the 7 screenshot files. Before any edit, rebuilding with the unchanged generator reproduced v1.0's extracted text exactly on all 32 pages. Edits are in `generator/build_pdf_v1.1.py`.

## Textual changes (complete list)

Extracted text was compared page by page. After stripping the footer version label and the "Page N of M" line, **30 of 32 pages are line-for-line identical**. Only pages 1 and 32 differ.

| Page | Section | Change |
|---|---|---|
| All | Footer | "G2 v1.0 (draft)" → "G3 v1.1 (draft)" (version metadata) |
| 1 | Cover table | Document version "G2 v1.0 (draft)" → "G3 v1.1 (draft)". **Added row "Supersedes":** "G2 v1.0 (draft), SHA-256 988533d7…a4353b. v1.1 corrects the governance context in Section 12 only; all review content is unchanged." |
| 32 | 12, table row 2 | **Correction A.** "MVP scope decision record: Open. The shipped scope follows the discovery report's recommended options, but the decisions were not written down as a record. / Product owner records the MVP decisions" → "MVP product decisions record: Open. Palmistry MVP product decisions 2.1–2.7 were documented in the 10 November I1 ticket at approximately 05:57 UTC. These decisions have not yet been incorporated into the repository's formal governance records. / Incorporate decisions 2.1–2.7 into the repository's governance records" |
| 32 | 12, table row 3 | **Correction C.** "PR #338 merge authorization: Open. The change merged on 10 Nov 2026 while its description still read "Draft. Do not merge"; no review is recorded on GitHub. / Record who authorized the merge, and when" → "Open. The 10 November M2 ticket explicitly authorized a normal GitHub merge at approximately 10:47 UTC. PR #338 merged at approximately 11:00 UTC. The authorization is not recorded in the GitHub PR history. / Record the M2 merge authorization in the repository's governance records" |
| 32 | 12, table row 4 | **Correction B.** "Integration milestone (M2) record: Open. Integration is evidenced in the change history but not documented as a milestone. / Record M2 closure" → "M2 milestone record: Open. M2 covered the GitHub merge and Production verification stage. It ended POST-MERGE BLOCKED after automatic deployment failed. M3 subsequently addressed the deployment issue. No M2 milestone report exists. / Write the M2 milestone record" |
| 32 | 12, below the table | **Added evidence note:** "Evidence: the product owner's original ticket records of 10 November 2026 (I1, M2 and M3, with the M2 outcome report) and the GitHub timeline of PR #338. These are historical records, not formal repository approval records. The MVP product decisions, PR #338 merge authorization and M2 milestone items therefore remain open." |
| 32 | 12, Publication sequence step 1 | "Product owner records the MVP decisions and the merge authorization." → "Product owner incorporates the MVP decisions, the merge authorization and the M2 record into the repository's governance records." |

## Non-textual change: navigation fix

| Item | v1.0 | v1.1 |
|---|---|---|
| TOC link annotations | 86 present, but **every one jumped to page 1**, whatever section was clicked | 86, **all resolve** to the correct pages (4–32) |
| PDF bookmarks | 43 entries (12 top-level, 31 nested), **all pointing to page 1** | 43, all resolve (for example "12. Outstanding governance items" → p. 32) |
| Cause | The deferred-page canvas used for the "Page N of M" footer broke destination targeting, so every destination referenced the first page object | Footer drawn directly using a two-pass build (pass 1 counts pages); output text is identical |

The G2 QA counted the links (and only the 22 top-level bookmarks) but never resolved them, so it missed this defect. It is fixed in v1.1 because the ticket requires working navigation. The fix changes no visible text.

## Unchanged (verified)

All 49 user-facing content strings, 7 further UI strings, 22 entry citations, Q1–Q14 with response boxes, the 19 decision rows in order, W1–W4, L1–L8, both checklists, the blank sign-off fields, source attribution and licence notices, PD1 placement text, and the 7 embedded screenshot images (byte-identical image streams on the same pages).
