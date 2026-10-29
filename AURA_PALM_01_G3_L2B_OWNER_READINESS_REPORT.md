# AURA-PALM-01-G3-L2B-O: Owner Inputs and Evidence Readiness Report

**Date:** 2026-11-11 · **Execution:** local only, documentation first. No external sharing or transmission of local evidence. The only network access was read-only GETs of Anthropic's public terms pages.

## 1. Completed work

1. **Owner decision register:** all nine items tracked individually (`AURA_PALM_01_G3_L2B_OWNER_DECISIONS.md`).
2. **AI evidence manifest:** a read-only SHA-256 inventory of 174 files (70.3 MB), snapshot 2026-11-11T13:31:49Z, with a commit cross-reference (`AURA_PALM_01_G3_L2B_AI_EVIDENCE_MANIFEST.md`).
3. **Anthropic terms:** the published Consumer and Commercial Terms identified, with effective dates and output clauses. Account type left open.
4. **Native distribution:** identifiers, packaging and docs evidence recorded. Store status left open; iOS legal question preserved.
5. **Authorization checklist:** readiness (Part A) separated from authorization (Part B) (`AURA_PALM_01_G3_L2B_REVIEW_AUTHORIZATION_CHECKLIST.md`).

## 2. Verified evidence

| Fact | Evidence |
|---|---|
| All five Palmistry content commits link to the recorded session | Each first referenced 0–5 s after its commit time (manifest §2) |
| Commits co-authored by "Claude Opus 5.5 <noreply@anthropic.com>"; git author is the owner | Commit trailers |
| Generation records: main transcript + 44 sub-agent transcripts + 88 sub-agent metadata files + 40 tool-result files + 1 metadata file | Manifest §1 |
| Published Consumer Terms effective Oct 8, 2025; Commercial Terms effective Jun 17, 2025. Output-assignment clauses say "(if any)" | anthropic.com/legal (fetched 2026-11-11) |
| iOS and Android ID `com.greenarrow.auraschedule`, v1.0 (build 1); remote-URL Capacitor shells; no Palmistry text in native packages | `capacitor.config.ts`, `project.pbxproj`, `build.gradle`, tree grep |
| Repo docs (2026-08-17) list store-submission prerequisites still pending (signing) | `MOBILE.md` |
| Frozen PDF unchanged | SHA-256 `d5fb7a1e…19a88` |

## 3. Outstanding owner inputs (all `AWAITING_OWNER_INPUT`)

1. CC reviewer and qualifications/conflicts.
2. Written confidentiality basis and channel.
3. Anthropic account type and plan on 2026-11-10.
4. iOS/Android store status and EULAs.
5. Ticket-authorship confirmation.
6. External-edit confirmation.
7. Transcript retention decision.
8. © legal entity.
9. Review deadline.

## 4. Evidence-preservation risks

| Risk | Detail | Mitigation (needs authorization) |
|---|---|---|
| **Live evidence** | The source session is still active; the main transcript changed during this work (now 32,232,915 bytes) | Freeze a copy at an agreed cut-off; re-hash |
| **Single local copy** | No backup; owner-only permissions on one machine | Durable, access-restricted, read-only copy (owner decision #7) |
| **Mixed content** | Transcripts include unrelated workstreams (for example credential-rotation operations) | Never share wholesale; redact extracts with owner approval |
| **Count correction** | "131 sub-agent transcripts" was a file count; actually 44 transcripts + 88 metadata | Corrected in the evidence matrix, the L2B-R readiness report and the manifest |

## 5. Legal questions requiring referral

- **OQ-L1 (iOS):** Apple's Licensed Application EULA, usage rules and DRM vs CC BY-SA 4.0 §3(b)(3) for in-app display of web-served licensed text; whether a custom EULA carve-out is viable. **Preserved for human legal assessment.**
- **OQ-L2 (AI authorship and ownership):** the US human-authorship requirement; India s. 2(d)(vi); the effect of the "(if any)" assignment in Anthropic's terms; applying CC BY-SA and a © line to AI-generated text.

No legal determination is made in this report.

## 6. Recommended next gate action

**Owner supplies inputs 1–9 and authorizes G3-L2B-R**, using checklist Part B. Separately and in parallel, **authorize a durable evidence copy** (owner decision #7) before the source session's files change further or are cleaned up.

## 7. Files created or modified

| File | Action |
|---|---|
| `AURA_PALM_01_G3_L2B_OWNER_DECISIONS.md` | Created |
| `AURA_PALM_01_G3_L2B_AI_EVIDENCE_MANIFEST.md` | Created |
| `AURA_PALM_01_G3_L2B_REVIEW_AUTHORIZATION_CHECKLIST.md` | Created |
| `AURA_PALM_01_G3_L2B_OWNER_READINESS_REPORT.md` | Created |
| `AURA_PALM_01_G3_L2B_EVIDENCE_MATRIX.md` | Modified (count correction only) |
| `AURA_PALM_01_G3_L2B_R_READINESS_REPORT.md` | Modified (count correction only) |
| Original transcripts | **Not modified** (read and hashed only) |

## 8. Governance restrictions (unchanged)

| Gate / item | Status |
|---|---|
| G3-L2B-R | Awaiting reviewer assignment and owner authorization |
| G3-L2B-G | HOLD |
| G3-L2-I | HOLD |
| Publication | HOLD |
| Merge freeze | ACTIVE |
| External legal review | DEFERRED, NOT WAIVED |

No product code changes, governance amendments, licence notices, commits, merges or deployments. **Work stops here pending explicit owner authorization.**
