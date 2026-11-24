# AURA-PALM-01-G3-C: Licensing Counsel Waiver (content-only guide)

**Status: APPROVED BY THE PRODUCT OWNER, 2026-11-24 (§4).** This is not legal advice, legal clearance or a guarantee of non-infringement.
- **Counsel:** mandatory external copyright counsel review is no longer an internal publication prerequisite for the content-only guide.
- **Still mandatory:** scholarly review, editorial review, attribution, applicable licence compliance and separate publication authorisation.
- **Not publication:** `review-status.json` stays `PENDING_HUMAN_REVIEW`.
- **No signature:** none is recorded. The approval is the owner's explicit written authorisation in the chat session, transcribed in §4.

**Scope:** the **content-only educational Palmistry guide** only (`packages/palmistry`, `components/PalmistryView`, `PalmHandDiagram`). It does **not** cover:
- scanning, camera or image input, or MediaPipe and the hand model;
- personalised readings;
- any privacy or data-protection requirement;
- any other Aura content.

## 1. What changes

| Before (G3-C) | After (approved 2026-11-24) |
|---|---|
| External copyright counsel (Reviewer C) must give an opinion on L1, L2 and N3 before publication | **Counsel review is no longer mandatory.** The Product Owner has accepted the residual risk in §3 on the basis of the §2 remediation and evidence |
| Licensing-reviewer sign-off row in v1.1 §8 | Replaced by this Product Owner risk acceptance |
| **Unchanged** | Scholarly review (Reviewer A) and editorial/cultural review (B) remain **required**. Third-party licence obligations (§2.3) remain in force. Publication still needs separate authorisation (`review-status.json` → `APPROVED`, then release approval under HR2 item M). Counsel may still be engaged voluntarily at any time |

## 2. Basis

1. **A1 remediation (done, commit `ec81a27`, this PR).**
   - **Removed:** the upward-line "In this tradition" text, which restated the finger-by-finger structure of Zysk's translations of Hastasañjīvana 3.2.81–82 and Sāmudrikatilaka 1.152. That was the counsel brief's closest case.
   - **Replaced with:** the owner-supplied general summary. It keeps no translated sequence, roles or wording.
   - **Accuracy check (AI, not human):** the summary is supported by the cited sources. The texts read the line by the finger it ends at (Zysk 2025, pp. 264–266), and the readings are kings or ministers, generals, merchants, fame and preceptor, plus the varṇa variation in ST 1.154. Those correspond to authority, occupation, prosperity and social hierarchy.
   - Sources and locators are unchanged.
   - Tests: content 220/0, guide component 78/0, Vercel guard 30/0.
   - One early component-test run exited 1. That was a defect in the preparer's shell loop: zsh does not word-split, so `--project tsconfig.jsdom-tests.json test/…` reached ts-node as one argument ("Unknown or unexpected option"). Reproduced in two fresh clones and fixed in the harness. It is not a code or test issue.
2. **Remaining Annex A rows (AI assessment, not legal):**

   | Row | Assessment | Recommendation |
   |---|---|---|
   | A2 Longevity | States a concept or fact (the line relates to life length, read by its reach); numbers are omitted | Keep |
   | A3 Prosperity | A one-clause summary of a fact (middle line, wealth, named after an asterism) | Keep |
   | A4 Barleycorn | The meaning of a **public-domain** 1884 translation (Iyer 68.42) and a short fact; W1 adds framing | Keep; apply W1 if reviewers agree |
   | A5 Fish / Altar | Meaning from the PD Iyer translation; the overlap is short functional phrases ("sacrificial rites") | Keep; optionally reword "performing sacrificial rites" to independent wording |
   | A6 Credited ideas | Zysk's ideas and dating, credited by name. Ideas and facts are not protected expression | Keep the attribution |

   - **Overlap evidence:** Annex B shows no more than 11 consecutive shared words; that one match is a stock phrase.
   - **Remaining residual:** *selection and arrangement*, meaning which 4 lines and 5 marks were chosen and their order, follows sources that include Zysk's edition. Whether it echoes Zysk's arrangement has not been tested.
   - **Owner direction (2026-11-24):** "Retain A2–A6 and the existing entry order. Do not reorder content solely to reduce perceived copyright risk." A2–A6 and the order are unchanged. The residual is carried as R-2.
3. **Third-party obligations preserved:**
   - the CC BY-SA 4.0 attribution to Zysk (Annex D: author, title, link, licence link, paraphrase notice);
   - courtesy citation of the PD Iyer translation;
   - no figures or translations reproduced.

   **If** the paraphrase were held to be Adapted Material, ShareAlike would require Aura's adapted text to be licensed under BY-SA 4.0 or a compatible licence. This waiver does **not** claim that obligation has been eliminated.

## 3. Residual risks accepted by the Product Owner (§4)

| Risk | Level (AI estimate) | Note |
|---|---|---|
| **R-1 ShareAlike (L1/L2):** a court or licensor treats paraphrase of Zysk's translations as Adapted Material | Low after A1 | Remedy if raised: relicense the affected text under BY-SA 4.0, rewrite it, or remove it |
| **R-2 Selection and arrangement** echoes Zysk's edition | Low | Retained by owner direction (§2.2) |
| **R-3 AI authorship (N3):** Aura may hold no or limited copyright in AI-drafted text and SVG drawings. This affects Aura's ability to enforce or license them, not its right to use them | Medium (uncertain law; India and US) | There is no record of human line-editing (Annex C). Under the Consumer Terms that applied (§5), Anthropic assigns only its rights "if any". **That does not establish that Aura owns copyright** |
| **R-4 Unknown third-party reproduction** in AI output | Low | Annex B overlap test; images drawn directly as SVG code. The Consumer Terms disclaim non-infringement and give **no IP indemnity**; the user indemnifies Anthropic for third-party claims (§5) |
| **R-5 Cross-border distribution** (India, US, EU/UK, app stores) | Low to medium | Not assessed per jurisdiction |
| **R-6 1884 Iyer public-domain status** | Low | The translator's death date rests on secondary evidence |

## 4. Product Owner acceptance

**Wording supplied by the Product Owner on 2026-11-24, recorded verbatim, and APPROVED by the owner on 2026-11-24:**

> I elect to replace mandatory external copyright counsel review for the content-only Aura Palmistry guide with internal licensing assessment, targeted remediation and explicit Product Owner risk acceptance.
> I acknowledge the residual uncertainty concerning copyright, ShareAlike applicability, selection and arrangement, AI-generated content ownership and cross-border distribution.
> This decision does not constitute legal clearance, waive applicable third-party licensing obligations or authorize publication.
> Scholarly review, editorial review, attribution, applicable licence compliance and separate publication authorization remain mandatory.
> This decision does not extend to palm scanning, real photograph collection, personalized readings or privacy and data protection requirements.

| Field | Value (owner's words, verbatim) |
|---|---|
| Final decision | **APPROVE.** "I explicitly approve the Product Owner Licensing Risk Acceptance wording in §4 of `AURA-PALM-01-G3-C-WAIVER.md` and accept the documented residual licensing risks." |
| Account type and plan used on 2026-11-10 | **Confirmed by the owner:** "I was using my individual Claude Max subscription when the Palmistry content was generated on November 10, 2026." This is consistent with §5: the Anthropic Consumer Terms applied |
| Effect stated by the owner | "Mandatory external copyright counsel review is no longer an internal publication prerequisite for the content-only Palmistry guide. Scholarly review, editorial review, attribution, applicable licence compliance and separate publication authorization remain mandatory." |
| Scope stated by the owner | "This approval does not extend to palm scanning, real photograph collection, personalized readings or privacy and data protection requirements." |
| Approved by / date | The Product Owner, 2026-11-24, by explicit written authorisation in the Claude Code chat session. **No signature** (handwritten or digital) is recorded. Transcribed by Claude, which added no decision of its own |

## 5. AI provider terms that applied (evidence; not a legal conclusion)

| Question | Finding | Evidence |
|---|---|---|
| Provider and tool | Anthropic, Claude Opus 5.5 via Claude Code | Commit trailers; G3-L2B owner decisions, item 3 |
| Account used | **Individual Claude Max subscription** (`organizationType: claude_max`, `billingType: stripe_subscription`), subscription created 2026-08-21, before generation on 2026-11-10 | The local Claude Code profile, read 2026-11-24, and **confirmed by the owner on 2026-11-24 (§4)** |
| Applicable terms | **Anthropic Consumer Terms of Service, effective Oct 8, 2025.** They cover Claude.ai, Pro and other products and subscriptions for individuals. The Commercial Terms (effective Jun 17, 2025) cover API keys and the Console, and are "not for consumer use" | Pages fetched 2026-11-11 (G3-L2B item 3) and re-fetched 2026-11-24. **Both still show the same effective dates.** Each predates 2026-11-10 and no later version exists, so these versions were in force at generation. The pages link a version history, which was not read |
| Output rights (Consumer §4) | Subject to compliance, Anthropic assigns its right, title and interest "if any" in Outputs | Consumer Terms |
| Warranty / indemnity | Outputs are provided "as is", with non-infringement disclaimed (§11). The user indemnifies Anthropic for third-party-rights claims. **No Anthropic IP indemnity for Outputs** (the Commercial Terms have one in §K.1; they did not apply) | Consumer Terms; Commercial Terms for contrast |
| What this does **not** establish | That Aura owns copyright in the AI-drafted text or SVG. That the content is free of third-party claims. That commercial use is cleared. An assignment "if any" transfers only whatever rights Anthropic has | — |

**Preserved authorship evidence:**
- `~/AuraEvidence/AURA_PALM_01_G3_L2B_AI_EVIDENCE_20261111.sparseimage` (encrypted; owner passphrase).
- sha256 re-verified 2026-11-24: `038dc1784148d7b3a47b3f6b68c2586c62a574055eee7eb40023cc3d2521458b`, matching the preservation report. It was not mounted or opened.
- It holds the 2026-11-10 session transcripts (G3-L2B manifest).
- A secondary copy is still blocked (E2: awaiting owner storage).
- The terms themselves were **not archived as copies**; only URLs, effective dates and summarised clauses were recorded.
