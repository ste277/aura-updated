# Aura Muhurta Methodology — AURA_MUHURTA_V1

Developer/methodology reference for the Muhurta scoring system. This document
describes what the engine actually computes and why, for anyone auditing a
result, adding a new occasion, or building a future "how Aura calculated
this" UI. It is not marketing copy — where the methodology is incomplete or
uncertain, that is stated plainly.

## Methodology identifier

`AURA_MUHURTA_V1` (exported as `AURA_MUHURTA_METHODOLOGY_ID` from
`packages/muhurta/src/muhurtaRulePacks.ts`). Every `MuhurtaRulePack` produced
by this codebase declares this identifier in its `metadata.methodologyVersion`
field, and every evaluation produced through the rule-pack path
(`evaluateMuhurtaWithRulePack()`) records it in `MuhurtaEvaluation.provenance`.

Rule packs are never silently mixed across methodology versions. If a future
PR introduces a materially different ruleset (e.g. a specific regional or
lineage tradition, or a revised general synthesis), it gets its own
identifier rather than blending into this one.

## Scope: what AURA_MUHURTA_V1 is and is not

**Is:** a GENERAL-scope synthesis of Panchanga-based Muhurta guidance —
Tithi (lunar day), Nakshatra (lunar mansion), Yoga, Karana, and the five
solar timing windows (Brahma, Abhijit, Rahu Kalam, Gulika Kalam, Yama
Gandam) — reflecting widely-available, contemporary Vedic astrology
reference material. It draws on the same general body of knowledge that
mainstream Panchang engines and reference sites use.

**Is not:** a specific classical text's methodology verified against
primary sources, a specific regional tradition (Tamil, Kerala, North Indian,
etc.), a personalization system (natal chart / Tara Bala factors are a
*separate* layer — see `auraFitEngine.ts`'s `evaluatePersonalMuhurtaFit()` —
not part of what this document covers), or a claim of completeness across
every occasion or every traditionally-recognized rule for a given occasion.

## Currently supported activities (SUPPORTED)

As of this PR:

| Activity | Family | Intent | Depth | Rule source |
|---|---|---|---|---|
| Start a Journey | TRAVEL | JOURNEY_START | DEEP | Family base (legacy `JOURNEY_START` rules) |
| Financial Decision | FINANCE | IMPORTANT_FINANCIAL_DECISION | DEEP | Family base (legacy `FINANCE` rules) |
| New Beginning | WORK | PROJECT_START | DEEP | Family base (legacy `NEW_BEGINNING` rules) |
| Start a Business | BUSINESS | BUSINESS_START | DEEP | Family base (reuses `NEW_BEGINNING`) |
| Property Purchase | FINANCE | PROPERTY_PURCHASE | DEEP | Family base (reuses `FINANCE`) |
| Griha Pravesh | HOME | GRIHA_PRAVESH | CEREMONIAL | **Intent-specific** (`GRIHA_PRAVESH_V1`) |

**Still PARTIAL (hidden from Muhurtham Finder):**

| Activity | Depth | Why |
|---|---|---|
| Engagement | CEREMONIAL | Only has RELATIONSHIP's family-base Tithi/Nakshatra data (authored for casual dating), no intent-specific data — see "Engagement gap" below |

## Factors used

- **Tithi** (lunar day): matched via paksha-agnostic regex against the
  activity's rule pack `favorable`/`avoid` patterns.
- **Nakshatra** (lunar mansion): exact-string match against the rule pack's
  `favorable`/`avoid` lists.
- **Yoga**: GLOBAL, family/intent-independent. `FAVORABLE_YOGAS` /
  `DIFFICULT_YOGAS` sets in `muhurtaEngine.ts` apply identically to every
  activity — no rule pack overrides this.
- **Karana**: GLOBAL, family/intent-independent. `FAVORABLE_KARANAS` set
  plus a hard Vishti-karana caution, identical for every activity.
- **Solar timing windows**: ABHIJIT support and RAHU_KALAM/YAMA caution are
  GLOBAL baselines. BRAHMA and GULIKA carry a small bonus for specific
  legacy families only (e.g. BRAHMA for meditation/learning/deep-work-style
  activities) — this bonus is not part of the newer rule-pack model and
  simply doesn't apply when a family has no legacy equivalent (e.g. HOME).

Only Tithi and Nakshatra vary per rule pack today. Yoga/Karana/window logic
is shared, single-implementation code
(`evaluatePanchangaYogaKaranaReasons()` / `evaluateSolarWindowReason()` in
`muhurtaEngine.ts`), reused by both the legacy per-family evaluator and the
newer generic rule-pack evaluator — never duplicated.

## Rule representation

A rule pack's Tithi/Nakshatra data is a `MuhurtaFactorRuleSet<T>`:

```ts
interface MuhurtaFactorRuleSet<T> {
  favorable: T[];
  acceptable?: T[]; // reserved, unpopulated by any pack today
  avoid: T[];
  block?: T[];      // reserved, unpopulated by any pack today
}
```

Every rule pack shipped so far only has evidence for two tiers
(`favorable`/`avoid`) — no source consulted distinguished a stronger "block"
tier from ordinary "avoid," and none distinguished a weaker "acceptable"
tier from silence. The `acceptable`/`block` fields exist so a *future* rule
pack whose source material genuinely supports that granularity can use them
without another type change — but populating them requires also wiring
evaluator support and tests; an unpopulated tier is never inferred.

## Activity-specific packs vs. family base

`resolveMuhurtaRulePack(classification)` resolves, in order:

1. **Intent-specific override** (`INTENT_RULE_PACKS[intent]`) — genuinely
   dedicated data for that exact occasion. Coverage: `IMPLEMENTED`.
2. **Family base** (`FAMILY_BASE_SOURCE[family]` → legacy
   `RULES[legacyFamily]`) — a documented, legitimate reuse of an existing
   family's data for a semantically-compatible newer intent. Coverage:
   `REUSABLE_BASE_RULE`.
3. **Empty** — no data exists at either level. Coverage: `MISSING`.

This is the *only* place that decides where an activity's Tithi/Nakshatra
data comes from; no evaluator branches on intent by name.

## Provenance

Every rule pack (except the empty ones) carries `metadata.sources`: an
array of `MuhurtaRuleSource` records —

```ts
interface MuhurtaRuleSource {
  id: string;
  title: string;
  tradition?: string;
  sourceType: 'CLASSICAL_TEXT' | 'TRADITIONAL_REFERENCE' | 'CURATED_METHODOLOGY';
  citation?: string;
  notes?: string;
}
```

`confidence` (`ESTABLISHED` / `CURATED` / `PROVISIONAL`) and `scope`
(`GENERAL` / `REGIONAL`) sit alongside. This is metadata for audit and a
future methodology-review UI — the scoring engine never reads or requires
human-readable source text; a `MuhurtaReason` stays clean
(`NAKSHATRA_SUPPORTIVE`, `value: 'Rohini'`), and provenance is only
attached to the overall `MuhurtaEvaluation.provenance` (`{ methodology,
rulePackId }`), never per-reason.

**Griha Pravesh's sources** (`sourceType: TRADITIONAL_REFERENCE`,
`confidence: CURATED`): multiple independent contemporary Vedic-astrology
reference sources, cross-checked against each other (see
`GRIHA_PRAVESH_SOURCES` in `muhurtaRulePacks.ts` for the specific
references and what was corroborated vs. excluded). No source found cited
a classical Sanskrit text with a verifiable direct quotation for Griha
Pravesh specifically, so `sourceType` is `TRADITIONAL_REFERENCE`, not
`CLASSICAL_TEXT`, and `confidence` is `CURATED` (multi-source corroborated),
not `ESTABLISHED` (primary-text verified).

**The pre-existing family-level `RULES` table** (used by every activity
before this PR, and still by 4 of the 6 SUPPORTED activities today) predates
the provenance model and was not re-audited against primary sources when
this model was introduced — it's carried forward as `CURATED_METHODOLOGY` /
`ESTABLISHED` by inheritance (already in production, exercised by every
existing activity), not freshly sourced.

## How support level is determined

`computeMuhurtaSupportLevel(classification, pack)` — driven by rule-pack
coverage, never by `evaluationDepth` alone:

- **DEEP activities**: `SUPPORTED` requires Tithi AND Nakshatra coverage to
  both be present (`REUSABLE_BASE_RULE` or `IMPLEMENTED` — not `MISSING`).
  A reused, semantically-fit family base is an acceptable bar here.
- **CEREMONIAL activities**: `SUPPORTED` requires Tithi AND Nakshatra to
  both be `IMPLEMENTED` (genuinely dedicated, intent-specific data) — a
  reused family base or missing data both fall short and land at `PARTIAL`.
  Yoga/Karana/window evaluation is always global/`IMPLEMENTED` and doesn't
  gate this on its own.

This is why Griha Pravesh reaching `SUPPORTED` required populating **both**
Tithi and Nakshatra with dedicated data — populating only one would have
left it `PARTIAL`. It's also why Engagement, which still only has RELATIONSHIP's
family-base data, remains `PARTIAL` even though that data exists and computes
fine — existing but non-dedicated data isn't sufficient evidence for a
ceremonial result.

## How CEREMONIAL differs from DEEP

Beyond the stricter support-level bar above, `evaluateActivityFit()` applies
`CEREMONIAL_INCOMPLETE_SCORE_CAP` (89, just below the EXCEPTIONAL label
threshold of 90) whenever `evaluationDepth === 'CEREMONIAL'` AND support
level is not yet `SUPPORTED`. This prevents a generic strong Abhijit/solar-window
score from single-handedly producing a top-tier rating for a ceremonial
occasion that lacks genuine Panchanga evidence. Once a CEREMONIAL activity's
pack reaches `SUPPORTED` (as Griha Pravesh's now has), the cap no longer
applies and the normal 0–100 rating range is available — but reaching the
top of that range still requires genuine multi-factor alignment (Nakshatra +
Tithi + Yoga + Karana + window all contributing), not a single strong factor.

DEEP activities never carry this cap; they were never held to the "needs
dedicated ceremonial evidence" bar in the first place.

## Known limitations

- **Engagement gap**: no intent-specific Tithi/Nakshatra data was added.
  Every "engagement-specific" ruleset found during research either (a)
  originated from a site that self-identifies as AI-generated content (a
  domain literally branded "KundliGPT," and near-identical phrasing
  reappearing across nominally independent sites), or (b) explicitly
  described engagement as reusing marriage/Vivah's Nakshatra set "relaxed" —
  which would mean silently borrowing unaudited Marriage data, exactly the
  pattern this methodology avoids. No source cleared the confidence bar.
  Engagement stays `PARTIAL`.
- **acceptable/block tiers are structurally supported but unpopulated** by
  every rule pack today — see "Rule representation" above.
- **`normalizeNakshatraId()`/`normalizeTithiId()`** exist for future
  REGIONAL-scope packs that might use different transliteration/spacing;
  today's matching (exact string for Nakshatra, paksha-agnostic regex for
  Tithi) is already reliable for the GENERAL-scope data in this codebase, so
  these normalizers aren't wired into the current matching path.
- **Griha Pravesh's excluded-but-mentioned values**: several
  nakshatras/tithis that appeared in only one source, or that contradicted
  themselves across sources (Shatabhisha: favorable in one detailed list,
  "causes instability" in another), were deliberately left unencoded rather
  than guessed at. See `GRIHA_PRAVESH_SOURCES` in `muhurtaRulePacks.ts` for
  the full list of what was excluded and why.
- **BRAHMA/GULIKA window bonuses** are legacy-family-keyed and don't extend
  to any family without a `FAMILY_BASE_SOURCE` legacy equivalent (i.e. HOME
  today) — Griha Pravesh gets no window bonus beyond the global
  ABHIJIT/RAHU_KALAM/YAMA baseline, which is an honest reflection of "no
  data says otherwise," not a bug.

## Explicitly unsupported assumptions

- A rule pack is never assumed complete because its `evaluationDepth` is
  DEEP or CEREMONIAL — see "How support level is determined."
- A family base is never silently reused for a family with no
  `FAMILY_BASE_SOURCE` entry (e.g. HOME had none before Griha Pravesh's
  dedicated pack existed) — an empty/MISSING pack is preferred over a
  misleading proxy.
- Marriage rules are never assumed transferable to Engagement, or vice
  versa — see "What Marriage would require" in the PR completion report.
- Personalization (Tara Bala, natal chart, moon-element affinity) is a
  separate layer entirely and is not part of AURA_MUHURTA_V1's own rule
  packs.

## Future regional-rule strategy

`MuhurtaRuleScope` already distinguishes `GENERAL` from `REGIONAL`. A future
PR introducing a specific regional/lineage tradition (e.g. a Tamil Nadu
Vastu-specific Griha Pravesh variant, or a South Indian vs. North Indian
Vivah Muhurta distinction) should:

1. Give it a distinct rule pack (or a distinct methodology version, if the
   differences are broad enough), never silently merge into
   `AURA_MUHURTA_V1`'s GENERAL-scope data.
2. Use `normalizeNakshatraId()`/`normalizeTithiId()` if the new source uses
   different transliteration/spacing than this codebase's existing display
   strings, rather than either duplicating spelling variants by hand or
   risking silent match failures.
3. Decide, and document, how a user would select or be assigned a regional
   variant — that UX/product decision is out of scope for the engine layer
   this document describes.
