// AURA-PALM-G6-D0 — Interpretation rule set v0.1.0 (executable form of INTERPRETATION_RULE_SPEC.md).
//
// CONTENT PROVENANCE (applies to every string in this file unless a rule overrides it):
//   authoredBy: Claude Opus 5.5 (AI) for Aura, ticket AURA-PALM-G6-D0, 2026-11-18
//   licenceStatus: Aura draft. AI-generated; ownership/copyright status unresolved (G3-L1 item N3, counsel).
//   guideDerived: false. Not copied, paraphrased or translated from the paused Palmistry guide
//                 (packages/palmistry), from Zysk 2025 (CC BY-SA 4.0) or from any Wikipedia text.
//   tradition: Western popular palmistry ("chirology") handbook tradition, summarised in general terms.
//   reviewStatus: PENDING_HUMAN_REVIEW. Traditional attributions are NOT verified against a specific text in D0.

export const RULESET_VERSION = '0.1.0';
export const DOMAINS = Object.freeze(['personality', 'relationships', 'career', 'lifeDirection']);
export const DOMAIN_TITLES = Object.freeze({
  personality: 'Personality and tendencies',
  relationships: 'Relationships and emotional patterns',
  career: 'Career, strengths and working style',
  lifeDirection: 'Life direction and reflection',
});

/** Approximate conventional correspondence between anatomical creases and Western palmistry line names. */
export const TRADITIONAL_NAMES = Object.freeze({
  DTC: 'heart line', PTC: 'head line', TC: 'life line', CENTRAL_LONGITUDINAL: 'fate line',
});

const DEFAULT_PROVENANCE = Object.freeze({
  tradition: 'Western popular palmistry (chirology), general handbook tradition',
  correspondence: 'Anatomical crease ↔ traditional line name is an approximate convention, not a measured equivalence.',
  sourceStatus: 'general-tradition-summary; no specific text consulted or quoted in G6-D0',
  verificationRequired: 'Reviewer to confirm each attribution against a public-domain or licence-cleared source before any user exposure.',
  authoredBy: 'Claude Opus 5.5 (AI), AURA-PALM-G6-D0, 2026-11-18',
  licenceStatus: 'Aura draft; AI-generated; ownership unresolved (G3-L1 N3)',
  guideDerived: false,
  reviewStatus: 'PENDING_HUMAN_REVIEW',
});

/** Claims no rule may make, attached to every rule and also enforced by the prohibited-claim lint. */
const GLOBAL_EXCLUSIONS = Object.freeze([
  'future events stated as fact', 'lifespan or longevity', 'health, illness or medical conditions',
  'wealth or financial outcomes', 'marriage, divorce, partner or children counts', 'career success or failure',
  'scientific validity of palmistry', 'meaning drawn from an absent or undetected crease',
]);

/**
 * A family evaluates one observable feature into mutually exclusive variants.
 * value(ctx) → number | null (null = feature not measurable from available creases)
 * variants: ordered ranges [min, max) on value; a variant with text === null is "no notable feature" (no claim).
 * margin: values within ±margin of an internal boundary are ambiguous → both neighbouring claim variants
 *         are shown, capped at tentative ("multiple possible interpretations").
 */
export const FAMILIES = Object.freeze([
  {
    id: 'F-PTC-SLOPE', domain: 'personality', requires: ['PTC'],
    feature: 'Slope of the proximal transverse crease (traditional "head line"): how far its ulnar end drops toward the wrist relative to its radial end.',
    value: (c) => c.d.PTC.endDropRadial, margin: 0.015,
    contradictedBy: (c) => (c.crease.PTC.branches.some((b) => b.direction === 'proximal' && b.lengthNorm >= 0.15) ? 'A long branch toward the wrist makes the overall slope harder to judge.' : null),
    variants: [
      { id: 'P-PTC-STRAIGHT', max: 0.05, observe: 'Your head-line crease runs fairly straight across the palm.',
        text: 'a practical, grounded way of thinking that prefers facts and clear steps',
        reflect: 'Where in your life does a step-by-step approach serve you best, and where might it hold you back?' },
      { id: 'P-PTC-BALANCED', min: 0.05, max: 0.11, observe: 'Your head-line crease slopes gently toward the wrist.',
        text: 'a mix of practical and imaginative thinking',
        reflect: 'When do you lean on logic, and when do you trust your imagination?' },
      { id: 'P-PTC-SLOPING', min: 0.11, observe: 'Your head-line crease slopes noticeably toward the wrist.',
        text: 'an imaginative, creative turn of mind',
        reflect: 'What creative outlet feels most like you right now?' },
    ],
  },
  {
    id: 'F-PTC-LENGTH', domain: 'personality', requires: ['PTC'],
    feature: 'Length of the proximal transverse crease, in palm widths.',
    value: (c) => c.d.PTC.lengthNorm, margin: 0.03,
    contradictedBy: (c) => (c.crease.PTC.continuity.breaks >= 2 ? 'The crease appears broken in several places, so its true length is uncertain.' : null),
    variants: [
      { id: 'P-PTC-SHORT', max: 0.5, observe: 'Your head-line crease is on the shorter side.',
        text: 'a quick, decisive thinker who likes to act once the main point is clear',
        reflect: 'Which recent decision did you make quickly, and how did it turn out?' },
      { id: 'P-PTC-MEDIUM', min: 0.5, max: 0.7, observe: null, text: null, reflect: null },
      { id: 'P-PTC-LONG', min: 0.7, observe: 'Your head-line crease is long, reaching well across the palm.',
        text: 'a thorough thinker who likes to consider many angles before deciding',
        reflect: 'Is there a choice you have been weighing for a while that is ready to be made?' },
    ],
  },
  {
    id: 'F-DTC-RISE', domain: 'relationships', requires: ['DTC'],
    feature: 'Rise of the radial end of the distal transverse crease (traditional "heart line") toward the index/middle fingers: y(ulnar end) − y(radial end), in palm widths.',
    value: (c) => c.d.DTC.endDropRadial, margin: 0.015,
    contradictedBy: () => null,
    variants: [
      { id: 'R-DTC-STRAIGHT', max: 0.05, observe: 'Your heart-line crease runs fairly level below the fingers.',
        text: 'a steady, private style with feelings, shown more through actions than words',
        reflect: 'How do the people close to you know that you care?' },
      { id: 'R-DTC-GENTLE', min: 0.05, max: 0.1, observe: 'Your heart-line crease rises gently toward the fingers.',
        text: 'a balance between openness and keeping some feelings to yourself',
        reflect: 'Who do you find it easiest to open up to, and why?' },
      { id: 'R-DTC-RISING', min: 0.1, observe: 'Your heart-line crease curves up toward the fingers.',
        text: 'a warm, expressive style that shares feelings openly',
        reflect: 'What helps you feel safe enough to express what you feel?' },
    ],
  },
  {
    id: 'F-DTC-BRANCHES', domain: 'relationships', requires: ['DTC'],
    feature: 'Number of branches on the distal transverse crease.',
    value: (c) => c.crease.DTC.branches.length, margin: 0,
    contradictedBy: () => null,
    variants: [
      { id: 'R-DTC-FEW-BRANCHES', max: 2, observe: null, text: null, reflect: null },
      { id: 'R-DTC-BRANCHED', min: 2, observe: 'Your heart-line crease has several small branches.',
        text: 'someone who values many different kinds of connection',
        reflect: 'Which of your relationships gives you energy, and which takes it?' },
    ],
  },
  {
    id: 'F-PTC-TC-ORIGIN', domain: 'career', requires: ['PTC', 'TC'],
    feature: 'Distance between the radial end of the proximal transverse crease and the distal end of the thenar crease (traditional head/life line "joined" or "separate" at the start).',
    value: (c) => c.dist(c.d.PTC.radialEnd, c.d.TC.distalEnd), margin: 0.01,
    contradictedBy: () => null,
    variants: [
      { id: 'C-ORIGIN-JOINED', max: 0.05, observe: 'Your head-line and life-line creases start close together.',
        text: 'a careful, considered approach to new ventures, preferring to plan before acting',
        reflect: 'What kind of preparation makes you feel ready to start something new at work?' },
      { id: 'C-ORIGIN-NEAR', min: 0.05, max: 0.1, observe: null, text: null, reflect: null },
      { id: 'C-ORIGIN-SEPARATE', min: 0.1, observe: 'Your head-line and life-line creases start apart from each other.',
        text: 'an independent streak and comfort with taking the initiative',
        reflect: 'Where at work would you like more room to lead?' },
    ],
  },
  {
    id: 'F-PTC-FORK', domain: 'career', requires: ['PTC'],
    feature: 'A branch near the ulnar end of the proximal transverse crease (traditional "writer\'s fork"): any branch with atT ≥ 0.8.',
    value: (c) => (c.crease.PTC.branches.some((b) => b.atT >= 0.8) ? 1 : 0), margin: 0,
    contradictedBy: () => null,
    variants: [
      { id: 'C-PTC-NO-FORK', max: 1, observe: null, text: null, reflect: null },
      { id: 'C-PTC-FORK', min: 1, observe: 'Your head-line crease splits into a small fork near its end.',
        text: 'versatility and an ability to see a problem from more than one side',
        reflect: 'Which of your skills surprises people when they first see it?' },
    ],
  },
  {
    id: 'F-CENTRAL-LONGITUDINAL', domain: 'career', requires: ['CENTRAL_LONGITUDINAL'], hypothesis: true,
    feature: 'A roughly vertical minor crease through the centre of the palm (traditional "fate line"). Not an annotated class in G4-B; identified here by geometry only, so capped at tentative.',
    value: (c) => (c.centralLongitudinal ? c.centralLongitudinal.d.lengthNorm : null), margin: 0.03,
    contradictedBy: () => null,
    variants: [
      { id: 'C-FATE-SHORT', max: 0.35, observe: null, text: null, reflect: null },
      { id: 'C-FATE-PRESENT', min: 0.35, observe: 'A vertical crease runs up through the middle of your palm.',
        text: 'a sense of purpose or direction in work',
        reflect: 'What thread of purpose runs through the work you have enjoyed most?' },
    ],
    absentNote: 'Many hands show no clear vertical crease here; in this reading its absence carries no meaning.',
  },
  {
    id: 'F-TC-ARC', domain: 'lifeDirection', requires: ['TC'],
    feature: 'Width of the thenar crease arc (traditional "life line"): its furthest reach from the radial edge.',
    value: (c) => c.d.TC.xMax, margin: 0.02,
    contradictedBy: (c) => (c.crease.TC.continuity.breaks >= 2 ? 'The crease appears broken in several places, so the arc is hard to trace.' : null),
    exclusionsExtra: ['vitality or physical stamina', 'length of life'],
    variants: [
      { id: 'L-TC-NARROW', max: 0.3, observe: 'Your life-line crease curves close around the base of the thumb.',
        text: 'a preference for a calm, steady pace and a close circle',
        reflect: 'What does a good, unhurried week look like for you?' },
      { id: 'L-TC-MID', min: 0.3, max: 0.42, observe: null, text: null, reflect: null },
      { id: 'L-TC-WIDE', min: 0.42, observe: 'Your life-line crease sweeps in a wide arc into the palm.',
        text: 'enthusiasm for variety, new places and new experiences',
        reflect: 'Which new experience would you most like to make room for this year?' },
    ],
  },
  {
    id: 'F-TC-BREAKS', domain: 'lifeDirection', requires: ['TC'],
    feature: 'Breaks or bridged gaps along the thenar crease.',
    value: (c) => c.crease.TC.continuity.breaks + (c.crease.TC.continuity.gapsBridged >= 2 ? 1 : 0), margin: 0,
    contradictedBy: () => null,
    exclusionsExtra: ['accidents, illness or dangerous periods', 'timing of events'],
    variants: [
      { id: 'L-TC-CONTINUOUS', max: 1, observe: null, text: null, reflect: null },
      { id: 'L-TC-CHAPTERS', min: 1, observe: 'Your life-line crease shows one or more breaks.',
        text: 'a life seen as a series of chapters, with room for change and fresh starts',
        reflect: 'Looking back, which change opened a chapter you are glad of?' },
    ],
  },
]);

export function provenanceFor(family) {
  return Object.freeze({ ...DEFAULT_PROVENANCE, familyId: family.id, hypothesisFeature: !!family.hypothesis });
}

export function exclusionsFor(family) {
  return Object.freeze([...GLOBAL_EXCLUSIONS, ...(family.exclusionsExtra || [])]);
}
