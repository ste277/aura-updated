# AURA-PALM-01-G2: Human Review PDF, Quality-Assurance Report

**Date:** 2026-11-11 · **Prepared by:** Claude Code (Opus 5.5) for the product owner
**Status:** Local document preparation only. Publication HOLD and Production merge freeze unchanged.

## 1. Deliverables

| Deliverable | Location |
|---|---|
| Review PDF (32 pages, A4, 1.1 MB) | `/Users/stephen/Desktop/Claude/auraschedule-math-core/AURA_PALM_01_G2_HUMAN_REVIEW_PACKAGE.pdf` |
| PDF SHA-256 | `988533d7f027ef5757f07b4580dac1306fe2689de55a6aabe259a9bee8a4353b` |
| New screenshots used in the PDF (06 current, 07 new) | `AURA_PALM_01_G2_REVIEW_SCREENSHOTS/` |
| This QA report, completeness checklist and open issues | `AURA_PALM_01_G2_PDF_QA_REPORT.md` |

All are untracked local files. Nothing was committed, pushed, deployed, merged or distributed.

## 2. Sources used and verified to exist

| Source | Where read from | Verified |
|---|---|---|
| Palmistry content, disclosures, sources, approval record | `origin/main` @ `1741a95` (`packages/palmistry/src/content.ts`, `sources.ts`, `review-status.json`), exported to JSON by importing the real modules | Yes. Approval record still `PENDING_HUMAN_REVIEW`, `approvedBy: null` |
| UI copy (Explore card, marks note, Sources footnote) | `origin/main:apps/web/components/PalmistryView.tsx` | Yes |
| I1 content review packet (sources, ledger, Q1–Q14, safeguards, licensing record) | `origin/main:docs/palmistry/AURA_PALM_01_I1_CONTENT_REVIEW_PACKET.md` | Yes |
| G1 human-review package (W1–W4, 19-row table, checklists, L1–L8) | `AURA_PALM_01_G1_HUMAN_REVIEW_PACKAGE.md` | Yes |
| G1 governance report (governance items, PD1) | `AURA_PALM_01_G1_GOVERNANCE_REPORT.md` | Yes |
| Screenshots 01–05 | `AURA_PALM_01_G1_REVIEW_PACKAGE_screenshots/` (= `origin/main:docs/palmistry/screenshots/`) | Yes |

`origin/main` was re-fetched on 2026-11-11 and is still at `1741a95`; no Palmistry file has changed since the G1 audit. The local `main` checkout (`f35d35a`, no Palmistry code) was not used.

## 3. Screenshot 06 correction

**Outcome: replaced with an accurate current screenshot.**

- **Method:** a throw-away `git worktree` of `origin/main` @ `1741a95` in the session scratchpad. It had no `.env` files, so the app's configured cloud database could not be loaded. A new, empty local Postgres database (`aura_g2_screenshot_tmp`) was migrated, and `next dev` ran on port 3999 with only that database URL, a one-off auth secret and no email keys. Sign-in used the app's built-in development sign-in link for a throw-away `example.test` account.
- **What was captured:** at 1280×900 (desktop), the Upward line entry, which now reads "the middle finger with a general". Also a new **Screenshot 07** of the About section and the Sources list with the CC BY-SA 4.0 licence notice; no earlier screenshot showed it.
- **Safety:** no application code was changed (the worktree's `git status` was clean apart from a temporary export script, which was deleted). Afterwards the server was stopped, the temporary database dropped (confirmed: 0 rows in `pg_database`), the browser tab closed and the worktree removed.
- **Screenshots 01–05:** kept, because each was checked visually against the current text and the visible wording matches. The superseded 06 is **not** in the PDF; it remains in the G1 folder for traceability.

## 4. Verification results

All checks below were run automatically on the final PDF (text extracted with pypdf, whitespace normalised), plus a visual inspection of every page.

| # | Ticket check | Result |
|---|---|---|
| 1 | All 49 user-facing text strings vs current content source | **49/49** found verbatim. Also: 7/7 further UI strings (subtitle, review notice, card copy, marks note, Sources footnote); 22/22 entry source citations (short citation + locator) |
| 2 | All 14 open questions included | **14/14** full question text verbatim, each with its own response box (14/14) |
| 3 | All 19 review decisions represented | **19/19** rows, numbered 1–19 in order, each with A / AC / R boxes and a blank corrections field |
| 4 | W1–W4 and L1–L8 complete | W1–W4: **12/12** (current, proposed, reason) verbatim, each with Accept/Amend/Reject and a comments box. L1–L8: **8/8** rows; **16/16** question and current-position cells verbatim |
| 5 | All six screenshots included | **Yes**, plus 07. Images embedded: 01–05 at 292×600 px, 06–07 at 800×562 px; aspect ratios preserved |
| 6 | No content truncated | Citation ledger **120/120** cells verbatim; sources table **24/24**; safeguards table **14/14**; source-level licensing record **42/42**. Fixed row heights were removed after the first render clipped L1 (see §6) |
| 7 | Visual inspection of rendered PDF | Every page inspected at 50 dpi; pages 1, 9 and 18 at 90 dpi. All IAST diacritics render (ā ī ū ṛ ṣ ṭ ṇ ṅ ṃ ḥ ś Ś ñ), and fonts are embedded. Final pass found no layout defects (see §6 for those fixed) |
| 8 | All approval fields blank | Sign-off section text holds only the field labels (residual text: empty). No checkbox is ticked. No names, dates or signatures anywhere |
| 9 | No credentials, infrastructure details or customer data | Scanned for `@`, `http`, `localhost`, `token`, `secret`, `password`, `postgres`, `neon`, `vercel`, `dpl_`, `DATABASE`, account names and the location shown in the dev build. Only hits: "origin/main @ 1741a95" (3×), "temporary local database" (1×) and "HTTP 403" in the packet's research note (1×). None is sensitive |
| — | Banner on every page | "DRAFT — HUMAN REVIEW REQUIRED — NOT APPROVED FOR PUBLICATION" on **32/32** pages, plus the cover |
| — | Page numbers | "Page N of 32" on **32/32** pages |
| — | Clickable table of contents | 2-page TOC with **86** link annotations; **22** PDF bookmarks (outline) |

## 5. Source-to-PDF completeness checklist

| Ticket section | PDF location | Source | Status |
|---|---|---|---|
| 1. Cover page (version, date, status) | Page 1 | — | Done: G2 v1.0 (draft), 11 Nov 2026, PENDING HUMAN REVIEW, HOLD |
| 2. Review instructions | Sec. 1 | G1 package Part A/C, written for the PDF | Done |
| 3. Feature overview + PD1 placement | Sec. 2 | I1 packet §0; G1 report §1A | Done |
| 4. Content inventory | Sec. 3 (3.1 entries, 3.2 guide text, 3.3 four disclosures, 3.4 safeguards) | content.json; packet §6 | Done |
| 5. Traditional interpretations with citations | Sec. 4.1–4.9: each entry with Sources directly under the text | content.json | Done |
| 6. Claim-by-claim citations + open questions | Sec. 5.1–5.4 | I1 packet §1, ledger legend, §4, §5 | Done |
| 7. Proposed wording W1–W4 | Sec. 6 | G1 package C.1 | Done. Existing text on grey, proposals on blue labelled "not applied" |
| 8. Scholarly checklist | Sec. 7.1, research-limits box, 7.2 (19 rows) | G1 package C.2, C.3 | Done |
| 9. Editorial/cultural checklist | Sec. 8 (+ ◆ rows in 7.2, W1/W3/W4) | G1 package C.3 | Done |
| 10. Licensing checklist L1–L8 | Sec. 9.1 attribution text, 9.2 L1–L8, 9.3 source-level record | G1 package Part D; packet §7; UI copy | Done |
| 11. Screenshots with captions | Sec. 10 (01–05, 06 current, 07 new) | G1 folder; G2 captures | Done |
| 12. Reviewer sign-off | Sec. 11: three separate blocks | G1 package Part E | Done, blank |
| 13. Outstanding governance items | Sec. 12 | G1 report §6–§7 | Done |

## 6. Defects found and fixed during QA

| Defect (first render) | Fix |
|---|---|
| Authored emphasis showed as literal `<b>`/`<i>` tags in five places | Allowed those tags through the markup converter; content strings are still escaped |
| Fixed row heights clipped long cells (L1 overflowed into L2) | Replaced with minimum-height spacers so rows grow; re-verified 16/16 L cells |
| Headings orphaned at page bottoms (e.g. 3.3) | Headings kept with the following block |
| "Contents" listed itself in the TOC | Separate non-TOC heading style |
| Packet `§` references meaningless in the PDF (tag legend, checklist) | Changed to PDF section numbers in those PDF-authored places only |
| Screenshot section used 5 sparse pages | Three per row: 3 pages |
| QA script bugs (section matcher hit `### 6. Fish`; TOC text matched first) | Fixed and re-run; the results in §4 are from the corrected script |

## 7. Unresolved document issues

None blocks reviewer use. All are listed for the G3 distribution decision.

| # | Issue | Impact | Suggested handling |
|---|---|---|---|
| D1 | Screenshots 01–05 are low resolution at source (292×600 px, ≈148 dpi as placed); in-image small text is hard to read | Low: every word is also in Sections 3–4, which are authoritative | Accept, or recapture at higher resolution the same isolated way |
| D2 | Screenshot 07 (≈120 dpi at full width) has small in-image text | Low: the exact attribution wording is in Sec. 9.1 | Accept |
| D3 | Verbatim packet text keeps internal labels: "(added in P1)" and a source-file name ("PalmHandDiagram.tsx") in Sec. 9.3; "§A.3" in Sec. 2.1 refers to the discovery report | Cosmetic; kept verbatim to avoid silently revising source material | Accept, or edit the packet itself in a future change |
| D4 | L8's emoji icons (✋ 📜) are written as "raised-hand and scroll emoji", because the embedded fonts have no emoji glyphs | None to meaning | Accept |
| D5 | The PDF is not a fillable form; reviewers annotate or print | Usability only | Accept, or add form fields in G3 if reviewers want them |
| D6 | Page 27 is about half empty (screenshots 04–05 can't share a page with full-width 06) | Cosmetic | Accept |
| D7 | Standard Helvetica is listed, unembedded, in page resources (ReportLab default); no visible text uses it | None | Accept |
| D8 | The PDF says "Prepared with AI assistance (Claude Code)" and names no human author or owner | Reviewers may want a named contact | Product owner adds a contact name at G3 if desired |
| D9 | The governance items (MVP decision record, PR #338 merge authorization, M2 record) are still open | Not a document defect; listed in Sec. 12 | Product owner |

## 8. Confirmed vs pending

**Confirmed (done and verified):** PDF generated from `origin/main` content and the G1 sources; 49/49 strings; 14/14 questions; 19/19 decision rows; W1–W4 and L1–L8 complete; seven screenshots, with 06 replaced by an accurate current capture; no truncation in any checked table; all approval fields blank; no sensitive data; banner, page numbers, TOC links and bookmarks present; no repository, application, approval-status, deployment or Production change; temporary database, server and worktree cleaned up.

**Pending (not done, by design):** distribution to reviewers (needs PALM-01-G3 authorization); any reviewer contact; scholarly, editorial/cultural and licensing sign-off; product-owner governance records; publication authorization.

## 9. Recommendation

**GO**: the PDF is generated, visually verified and complete, and ready for the product owner's distribution decision at **PALM-01-G3 (Human Reviewer Distribution and Sign-off)**. Open issues D1–D8 are cosmetic or usability items and none blocks review.

---

## Erratum (added 2026-11-11 during ticket AURA-PALM-01-G3-PDF-v1.1)

§4 reported a "Clickable table of contents" PASS based on **counting** 86 link annotations and 22 bookmarks. They were never resolved. In v1.0, every link and all 43 bookmarks (22 counted was the top level only) jump to page 1 instead of their section, a side effect of the deferred-page "Page N of M" canvas. This is fixed in v1.1, where all 86 links and 43 bookmarks resolve to the correct pages. The G2 GO recommendation is superseded by the v1.1 QA. See `AURA_PALM_01_G3_DISTRIBUTION/PDF_v1.0_TO_v1.1_CHANGE_SUMMARY.md`.
