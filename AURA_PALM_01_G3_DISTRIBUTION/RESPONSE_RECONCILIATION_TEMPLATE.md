# AURA-PALM-01-G3: Reviewer Response Reconciliation Template

Copy this file once per returned review, as `returned/RECON_<A|B|C>_<YYYY-MM-DD>.md`. Transcribe **verbatim**, then summarise each item into `AURA_PALM_01_G3_REVIEW_TRACKER.md`. Never paraphrase a decision into a different one.

## 1. Intake

| Field | Value |
|---|---|
| Reviewer (as designated in tracker §1) | |
| Role | A Scholarly / B Editorial-Cultural / C Licensing |
| Received (UTC) and channel | |
| Sender matches the designated reviewer's approved contact? | Yes / No (if No: stop, verify with the product owner) |
| Document reviewed (version / SHA-256 quoted by reviewer) | |
| Matches v1.1 `d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88`? | Yes / No (if No, including the superseded v1.0 `988533d7…`: log it, do not count it, and ask the reviewer to re-review v1.1) |
| Returned file(s) and their SHA-256 | |
| Annotated PDF compared page by page with the reference copy? | Yes / No / n.a. |
| Sign-off block completed by the reviewer themself? | Yes / No / Partial |

## 2. Coverage check

| Required set | Expected | Answered | Missing (list) |
|---|---|---|---|
| A: Q1–Q14 | 14 | | |
| A: rows 1–19 | 19 | | |
| A: W1–W4 | 4 | | |
| A: scholarly checklist + research-limits box | 1 | | |
| B: ◆ rows 3, 4, 5, 10, 11 | 5 | | |
| B: W1–W4 | 4 | | |
| B: editorial checklist + concerns box | 1 | | |
| C: L1–L8 | 8 | | |
| Sign-off block | 1 | | |

If anything is missing, the review status is **RETURNED, INCOMPLETE**: ask the reviewer for it. Do not fill it in.

## 3. Item transcription

| Item ID | PDF section | Reviewer decision (exact) | Reviewer text (verbatim) | Requested exact wording (verbatim) | Accepted as open? |
|---|---|---|---|---|---|
| | | | | | |

## 4. Cross-reviewer comparison

Fill this in once more than one review has returned.

| Item | Reviewer A | Reviewer B | Reviewer C | Agree? | If not: CONFLICT ref |
|---|---|---|---|---|---|
| | | | | | |

**Conflict handling:** never pick a side. Record both positions verbatim and escalate to the product owner, who may ask a reviewer to clarify, consult the other reviewer, or decide. Record the product owner's decision separately as a **product decision**, citing who made it and when.

## 5. Correction requests (one per change)

| Field | Value |
|---|---|
| CR number | CR-### |
| Raised by / reference | |
| Affected item(s) and PDF section | |
| Affected content (current exact text) | |
| Affected source citations | |
| Requested change (verbatim) | |
| Significance | S1 blocking / S2 substantive / S3 editorial |
| Conflicts with | |
| Proposed correction plan (what file and string would change, which tests are affected, who re-confirms) | |
| **Authorization to change content** (product owner, date) | *Required before any change. Not available under G3.* |
| Revised text | |
| Re-confirmation by reviewer (date, verbatim) | |

## 6. Reviewer-specific outcome

| Field | Value |
|---|---|
| Overall decision (as written by the reviewer) | Approve / Approve with corrections / Reject |
| Conditions | |
| Counted toward G3 HUMAN REVIEW COMPLETE? | Only if §1 verified, §2 complete, and the sign-off block was completed by the reviewer |
| Recorded in tracker by / date | |

> Recording a reviewer's approval here does **not** change `review-status.json`, populate `approvedBy` or authorize publication. Each of those needs a separate, explicit product-owner authorization.
