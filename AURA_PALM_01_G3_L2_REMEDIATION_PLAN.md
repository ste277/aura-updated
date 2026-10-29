# AURA-PALM-01-G3-L2: Remediation Plan

**Status: PLAN ONLY. Not authorized for implementation.** Source: `AURA_PALM_01_G3_L2_CONTENT_PROVENANCE_AUDIT.md` (paths are named **L2-A** independent baseline, **L2-B** licence route, **L2-C** legal review retained). No content, code, illustration or PDF change is made under G3-L2. Licence-effect statements are design intent for the internal CC-qualified reviewer to confirm; this is not legal advice.

## 1. Content requiring a decision (16 Zysk-dependent strings + 2 glossed titles)

| Row | Content ID | Zysk-dependent part | L2-B (recommended): licensed under scope (a) | L2-A alternative: clean-room REWRITE | Fallback: REMOVE |
|---|---|---|---|---|---|
| 2 | ayurlekha.interpretation | ŚKA "also describes" clause | ✓ | Sanskritist from Sanskrit | Drop the ŚKA clause |
| 6 | dhanamatrlekha.description | ŚKA v.6 position | ✓ | Same | Not recommended |
| 7 | dhanamatrlekha.interpretation | Whole | ✓ | Same | Not recommended (empties the entry) |
| 11 | pitrlekha.description | ST 1.143 sentence | ✓ | From ST Sanskrit | Drop the sentence |
| 12 | pitrlekha.interpretation | Whole | ✓ | From ŚKA Sanskrit | Not recommended |
| 13 | pitrlekha.contextNote | ST 1.143 clause | ✓ | From ST Sanskrit | Drop the clause |
| 16 | urdhvarekha.description | "ending at different fingers" | ✓ | From HS/ST Sanskrit | Reduce to the BS 70.12 course |
| 17 | urdhvarekha.interpretation | HS/ST finger scheme | ✓ | From HS (Pratāpa Muni 1929, US PD; India unresolved) / ST Sanskrit | Replace with the BS 70.12 statement only |
| 18 | urdhvarekha.contextNote | ST 1.154 clause | ✓ | From ST Sanskrit | Drop the clause (W3 pending) |
| 22 | yava.interpretation | ŚKA birth-time clause | ✓ | From ŚKA Sanskrit | Drop the clause |
| 23 | yava.contextNote | ŚKA "several readings" | ✓ | Same | Drop the ŚKA reference |
| 26 | matsya.interpretation | ŚKA clause | ✓ | Same | Drop the clause |
| 30 | shankha.interpretation | ŚKA v.21 clause | ✓ | Same | Drop the clause |
| 34 | chatra.interpretation | ŚKA v.21 clause | ✓ | Same | Drop the clause |
| 38 | vedi.interpretation | ŚKA "both describe" clause | ✓ | Same | Drop the ŚKA reference |
| 39 | vedi.contextNote | "two sources agree" comparison | ✓ | Same | Drop the comparison |
| — | Titles "Prosperity line (mother line)", "Father line (knowledge line)" | Diagram/ŚKA glosses | ✓ | Same | Plain names only |

**Non-blocking:**
- Re-cite the PD-BS KEEP strings (rows 1, 21, 25, 33, 37, 49), plus the BS parts of rows 2, 16, 22, 26, 30, 34 and 38, to Iyer 1884 (**original edition**, Wellcome) and Kern 1865, with a concordance (Iyer ch. 68 = Skt ch. 67). Keep the Zysk citations.
- Check the row 49 footnote against the 1884 original.
- Optional: Reviewer B may reword row 49.

## 2. Strategy per route

| Route | Steps | Evidence required |
|---|---|---|
| **L2-B, scope (a): the whole user-facing Palmistry text set (recommended)** | 1. Owner records L2-D: choose L2-B; accept the **irrevocable** CC BY-SA 4.0 grant (competitors may reuse the text); decide N3; designate the internal licensing reviewer; amend G3-C §1A and G3-L1 LA-01/03/05 in the same record. 2. The reviewer confirms the design intent, the who-licenses position (owner / AI-generated / any contractor text) and §3(b)(3) (app terms; native store terms and DRM). 3. Draft the Aura licence notice and placement (Reviewer B for wording). 4. Keep the Zysk attribution unchanged. | L2-D record; reviewer confirmation; notice text |
| L2-A clean-room REWRITE | 1. Obtain a protectability view on Zysk's edited Sanskrit (if used), or rights evidence for an alternative edition (1954 ŚKA likely protected if copyrightable; 1929 HS US PD / India unresolved). 2. A qualified Sanskritist translates from Sanskrit only, **never consulting Zysk's translation**, under a written provenance declaration. 3. Write the Aura text from those notes. 4. Run the overlap check against Zysk. 5. Reviewer A/B review. | Protectability view or edition rights evidence; Sanskritist declaration; overlap report |
| REMOVE | Delete the listed clauses only | Reviewer A/B confirm the remaining text |
| Re-cite (BS) | Add Iyer/Kern locators and concordance | Iyer date confirmation or reviewer acceptance |

## 3. Required human reviews

| Review | Reviewer | Scope |
|---|---|---|
| Licensing | Internal licensing reviewer, CC BY-SA 4.0 expertise | L2-B design intent; notice; who-licenses; §3(b)(3); L3, L4, L6 (incl. underlying figure sources); L5, L7, L8 |
| Scholarly | Reviewer A | Re-citations; concordance; any REWRITE; Q1–Q14 |
| Editorial / cultural | Reviewer B | Notice wording and placement; any REWRITE or REMOVE; W1–W4 |
| Legal (optional only per L2-D) | External counsel | L2-C; or assurance on L2-B or N3 |

## 4. Acceptance criteria

1. L2-D is recorded in writing, including irrevocability acceptance and the amendments to G3-C §1A and LA-01/03/05.
2. **L2-B:**
   - the licence notice covers the whole user-facing Palmistry text set, is accurate and is linked;
   - Zysk attribution keeps every §3(a)(1) element (a citation alone is not enough);
   - there are no additional terms or technological measures on the licensed text (app and store terms checked);
   - the reviewer has signed off.
3. **L2-A:** documented independent provenance; overlap against Zysk shows no non-conventional run; Reviewer A/B sign-off.
4. **REMOVE:** Reviewer A/B confirm accuracy and clarity.
5. BS re-citations are correct, with the concordance; the 1884 original has been checked.
6. Disclosures are unchanged unless W-proposals are accepted through review. No new interpretations or features.

## 5. Regression and content-validation requirements (future implementation)

- The Palmistry suites pass: content (220), Explore/jsdom (78) and Vercel guard (30). Exact-string tests are updated only for authorized changes.
- **Approval file unchanged** (`PENDING_HUMAN_REVIEW`, `approvedBy: null`). Build exclusion and bundle scanners still pass; content stays unpublished.
- Re-run the overlap analysis on changed strings.
- A new review-package version (e.g. v1.2) only under separate authorization, with full G2-style QA (49+7+22 checks, screenshots, navigation, diff limited to authorized changes).
- No Panchangam, Muhurtham or ranking changes; isolation tests pass.

## 6. Proposed implementation sequence

1. **Gate L2-D:** owner decision and record amendments.
2. Internal licensing reviewer confirms the design intent and drafts the notice; Reviewer B reviews the wording.
3. **Gate L2-I:** separately authorized content and notice change on a feature branch, with tests and no merge (merge freeze active).
4. Reviewer A/B review of changed and re-cited text.
5. A new review-package version (separately authorized) with QA.
6. Findings close only on recorded evidence. Publication is a separate gate.

## 7. Authorization gates

| Gate | Authorizes | Does not authorize |
|---|---|---|
| **AURA-PALM-01-G3-L2-D: Licensing Path Decision** | The owner's written choice of L2-B (scope a, irrevocable CC BY-SA 4.0) or L2-C; N3 decision; internal reviewer designation; amendment of G3-C §1A and G3-L1 LA-01/03/05 | Any content change |
| **AURA-PALM-01-G3-L2-I: Remediation Implementation** | The specific content and notice changes from L2-D, on a branch, with tests | Merge, deployment, approval-record change, publication |

External legal review remains **deferred, not waived** until L2-D is recorded. Governance findings GF-1 to GF-3 remain open and separate.
