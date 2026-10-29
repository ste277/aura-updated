> **PROPOSED, NOT COMMITTED, NOT AUTHORIZED.** This is a draft for a separately authorized governance reconciliation (findings G1-P2-02 and GF-1). It closes nothing until the product owner confirms the content and authorizes the change. Suggested repository path once authorized: `docs/palmistry/AURA_PALM_01_PRODUCT_DECISIONS.md`.

# Aura Palmistry MVP: Product Decisions 2.1–2.7

| Field | Value |
|---|---|
| Decision owner | Product owner (repository owner) |
| Originally issued | 2026-11-10, approximately 05:57 UTC, as §2 "Product Decisions" of ticket AURA-PALM-01-I1 |
| Source of this transcription | The product owner's I1 ticket as preserved in the Claude Code session "Palmistry discovery and feasibility audit" (local transcript, message timestamp 2026-11-10T05:57:37Z) |
| Transcribed into the repository | *[date of the authorized commit]*. This is a **transcription of an earlier decision, not a backdated record.** |
| Owner confirmation that this text is authoritative | *[pending: product owner name / date]* |
| Answers | The seven "Product decisions required" in AURA-PALM-01-D1 §I |

## Verbatim decision text (I1 ticket §2)

```text
2. Product Decisions
The following decisions are approved for the implementation baseline.
2.1 Tradition
Indian-first.
Use classical Indian palmistry as the primary framework.
Do not simply translate Western palmistry labels into Sanskrit.
Western comparisons may appear only when historically useful and explicitly distinguished.
2.2 Longevity
Include the historical concept of āyurlekhā.
Clearly explain:
Aura does not estimate lifespan or predict death.
Do not generate numerical lifespan estimates.
2.3 Hand-selection conventions
Historical men-right / women-left conventions may be mentioned as historical context.
Do not enforce gender-based hand selection.
Do not infer a user's gender.
2.4 Expert review
Qualified human review of historical terminology, source interpretation, and cultural accuracy is required before public launch.
AI-generated or AI-reviewed content is not sufficient for publication approval.
2.5 Launch gating
Develop on an isolated feature branch.
Do not expose the feature through Production.
No new feature-flag framework is required.
A merge into `main` is not authorized.
2.6 Analytics
Minimal non-sensitive educational events are permitted only after confirming the existing analytics contract.
Do not collect palm observations, inferred characteristics, or personal images.
2.7 Licensing
Use original paraphrases.
Do not reproduce copyrighted translations, published diagrams, or substantial source passages.
Preserve source attribution and record applicable licensing considerations.
```

## Later changes to these decisions

| Decision | Change | Evidence |
|---|---|---|
| 2.5 Launch gating ("A merge into `main` is not authorized") | **Superseded for the merge only** by ticket AURA-PALM-01-M2 (2026-11-10, approximately 10:47 UTC), which authorized a normal GitHub merge of PR #338 while keeping the content unpublished. "Do not expose the feature through Production" still holds: content is excluded from every production build until approval. | M2 ticket; see `AURA_PALM_01_M1_M2_MERGE_RECORD.md` |
| Explore placement | Confirmed as PALM-01-G1-PD1 (2026-11-11): the card stays directly on Explore, with no "Traditional Wisdom" layer | `AURA_PALM_01_G1_GOVERNANCE_REPORT.md` §1A |

## Where the code relies on these decisions

`packages/palmistry/src/content.ts` cites decisions 2.1, 2.2, 2.3, 2.4 and 2.7 in its comments.
