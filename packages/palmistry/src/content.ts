/**
 * AURA-PALM-01-I1 -- typed, static educational content for the Explore ->
 * Palmistry guide. Indian-first (product decision 2.1): every entry is a
 * line or mark attested in Indian sources, described in Aura's own
 * paraphrase (decision 2.7). Western palmistry appears only as a clearly
 * labelled comparison note.
 *
 * Pure data + tiny lookup helpers. No I/O, no user data, no imports from
 * any engine package (see sources.ts header).
 *
 * CONTENT STATUS: researched (AURA-PALM-01-D1) but NOT yet approved by a
 * qualified human reviewer. PALMISTRY_CONTENT_REVIEW.status must stay
 * 'PENDING_HUMAN_REVIEW' until a real sign-off is recorded (decision 2.4).
 */

export type PalmistryCategory = 'line' | 'mark';

export type PalmistryAttributionStatus =
  | 'classical-supported'
  | 'later-tradition-supported'
  | 'modern-interpretation'
  | 'uncertain';

/** How the entry may be drawn. 'described-in-sources' lines get a schematic
 * path on the hand; marks are shown as standalone symbols ('symbol-only')
 * because the sources either do not fix one position or disagree, and
 * placing them on the hand would imply every palm carries them. */
export type PalmistryDiagramPlacement = 'described-in-sources' | 'symbol-only';

export interface PalmistrySourceRef {
  sourceId: string;
  /** Section/verse/page locator inside that source. */
  locator: string;
}

export interface PalmistryEntry {
  id: PalmistryEntryId;
  category: PalmistryCategory;
  /** Plain-English title (shown first). */
  title: string;
  /** Traditional term in IAST -- only where the term was seen in a source
   * actually read (decision: "traditional terminology, if verified"). */
  traditionalName?: string;
  /** Where the feature is / what it looks like (observable, neutral). */
  description: string;
  /** Historical interpretation, paraphrased, always framed as tradition. */
  interpretation: string;
  /** Which tradition this interpretation belongs to (user-facing label). */
  tradition: string;
  attributionStatus: PalmistryAttributionStatus;
  /** "Low" / "Medium" / "High" -- confidence in the source attribution,
   * not in the interpretation's truth. */
  attributionConfidence: 'High' | 'Medium' | 'Low';
  sources: PalmistrySourceRef[];
  /** Uncertainty, disagreement and context the user must see. */
  contextNote: string;
  /** Optional, explicitly-labelled Western comparison. */
  westernComparison?: string;
  diagramPlacement: PalmistryDiagramPlacement;
  /** SVG element id in PalmHandDiagram / glyph id in the mark gallery. */
  diagramRegionId: string;
}

export const PALMISTRY_LINE_IDS = ['ayurlekha', 'dhanamatrlekha', 'pitrlekha', 'urdhvarekha'] as const;
export const PALMISTRY_MARK_IDS = ['yava', 'matsya', 'shankha', 'chatra', 'vedi'] as const;
export const PALMISTRY_ENTRY_IDS = [...PALMISTRY_LINE_IDS, ...PALMISTRY_MARK_IDS] as const;
export type PalmistryEntryId = (typeof PALMISTRY_ENTRY_IDS)[number];

/** Required disclosure (I1-B), verbatim from the ticket. */
export const PALMISTRY_GENERAL_DISCLOSURE =
  'Palmistry is a traditional interpretive practice, not a scientifically validated method of predicting personality, health, lifespan, or future events.';

/** Required longevity disclosure (decision 2.2). */
export const PALMISTRY_LONGEVITY_DISCLOSURE =
  'Aura does not estimate lifespan or predict death. This entry explains a historical idea only.';

/** Diagram caveat (I1-C accuracy requirement). */
export const PALMISTRY_DIAGRAM_NOTE =
  'A schematic drawing, not a real hand. Line positions follow how the sources describe them and are approximate. Real hands vary, and no hand needs to show every feature.';

/** Hand-convention note (decision 2.3) -- history only; Aura never asks
 * for, or infers, the user's gender. */
export const PALMISTRY_HAND_CONVENTION_NOTE =
  'Indian palmistry texts traditionally examined the right hand of men and the left hand of women. The drawing shows a right hand only to illustrate; Aura does not ask which hand you use or infer anything about you.';

export const PALMISTRY_INTRO = {
  title: 'Discover the traditions of Indian palmistry',
  lead:
    'Explore how historical Indian texts described lines and symbols on the palm. Select a feature to learn about its traditional interpretation and the sources behind it.',
  tradition:
    'Hasta Sāmudrika (reading the hand) is one branch of Sāmudrika Śāstra, the wider Indian tradition of reading marks on the whole body. Early descriptions of the hand appear in the Bṛhatsaṃhitā (6th century) and a Buddhist text from the 9th century. Fuller treatises followed in the 12th and 17th centuries.',
  linesAndMarks:
    'The texts read two kinds of features: lines, which they apply to everyone, and shaped marks such as a fish or a parasol, which mostly signal royal or high status. Interpretations differ between texts, and Aura shows those differences rather than resolving them.',
  westernDifference:
    'Western palmistry, as popularised in 19th-century Europe, uses different names (heart, head, life and fate lines) and planetary "mounts". Its labels do not translate the Indian terms: the same crease can carry a different name and meaning in each system.',
  limits:
    'These are descriptions of what historical texts said, in the social world they came from. They are not claims about you.',
};

export const PALMISTRY_CONTENT_REVIEW = {
  status: 'PENDING_HUMAN_REVIEW' as 'PENDING_HUMAN_REVIEW' | 'APPROVED',
  /** Shown in the UI until approved. */
  notice: 'Preview content: awaiting review by a qualified scholar before public release.',
  approvedBy: null as null | { reviewer: string; date: string },
};

export const PALMISTRY_ENTRIES: readonly PalmistryEntry[] = [
  // ------------------------------------------------------------------ LINES
  {
    id: 'ayurlekha',
    category: 'line',
    title: 'Longevity line',
    traditionalName: 'āyurlekhā',
    description:
      'The uppermost of the main lines, closest to the fingers. The texts describe it as starting below the little finger and running toward the base of the forefinger.',
    interpretation:
      'In this tradition, the line was associated with length of life, read from how far it reached toward the forefinger. The Bṛhatsaṃhitā and the 9th-century Buddhist chapter both describe this idea.',
    tradition: 'Indian (classical)',
    attributionStatus: 'classical-supported',
    attributionConfidence: 'High',
    sources: [
      { sourceId: 'brhatsamhita', locator: 'Iyer tr. 68.50; 70.13' },
      { sourceId: 'sardulakarnavadana', locator: 'v. 3 (Zysk 2025, p. 244)' },
      { sourceId: 'hand-diagrams-18c', locator: 'figs. 1–3 (Zysk 2025, p. 244)' },
    ],
    contextNote:
      'The sources disagree on how the line was measured, which shows this was a scheme of interpretation, not a measurement. The term āyurlekhā in verse 3 rests on an editor\'s suggested reading; later diagrams label the line āyur-.',
    westernComparison:
      'Western palmistry calls a crease in roughly this position the "heart line" and reads it differently. It is not the Western "life line".',
    diagramPlacement: 'described-in-sources',
    diagramRegionId: 'palm-line-ayurlekha',
  },
  {
    id: 'dhanamatrlekha',
    category: 'line',
    title: 'Prosperity line (mother line)',
    traditionalName: 'dhanamātṛlekhā',
    description:
      'A line in the middle of the palm, between the longevity line above and the father or knowledge line below.',
    interpretation:
      'The 9th-century text links the middle line with wealth and names it after a lunar asterism. Later hand diagrams label it the "prosperity-mother" line.',
    tradition: 'Indian (9th-century text; later diagrams)',
    attributionStatus: 'later-tradition-supported',
    attributionConfidence: 'Medium',
    sources: [
      { sourceId: 'sardulakarnavadana', locator: 'vv. 6, 24 (Zysk 2025, pp. 245–246, 255)' },
      { sourceId: 'hand-diagrams-18c', locator: 'figs. 1–3 (Zysk 2025, p. 246)' },
    ],
    contextNote:
      'The compound name comes from the later diagrams, whose spellings vary. Which asterism the early text means is uncertain (possibly Dhaniṣṭhā). Historically "wealth" meant fortune in general, not a forecast of anyone\'s finances.',
    westernComparison: 'Western palmistry calls a crease in a similar place the "head line" and gives it a different meaning.',
    diagramPlacement: 'described-in-sources',
    diagramRegionId: 'palm-line-dhanamatrlekha',
  },
  {
    id: 'pitrlekha',
    category: 'line',
    title: 'Father line (knowledge line)',
    traditionalName: 'pitṛlekhā',
    description:
      'A line that rises from the base of the thumb near the wrist and runs toward the space between the thumb and forefinger.',
    interpretation:
      'The 9th-century text calls this a line of knowledge. Later hand diagrams name it the father\'s line, and one links it with Sarasvatī, the goddess of learning.',
    tradition: 'Indian (9th-century text; later diagrams)',
    attributionStatus: 'later-tradition-supported',
    attributionConfidence: 'Medium',
    sources: [
      { sourceId: 'sardulakarnavadana', locator: 'vv. 1–2 (Zysk 2025, p. 243)' },
      { sourceId: 'hand-diagrams-18c', locator: 'figs. 1–3 (Zysk 2025, p. 243)' },
    ],
    contextNote:
      'The sources say little about how this line was read in detail. It was a traditional label, not a measure of intelligence, ancestry or character. The 12th-century Sāmudrikatilaka groups three lines as concerning family, wealth and longevity; whether its "family" line is this father line awaits expert review.',
    westernComparison:
      'Western palmistry calls a crease curving round the thumb the "life line". In the Indian texts, the line linked with life is the longevity line at the top of the palm instead.',
    diagramPlacement: 'described-in-sources',
    diagramRegionId: 'palm-line-pitrlekha',
  },
  {
    id: 'urdhvarekha',
    category: 'line',
    title: 'Upward line',
    traditionalName: 'ūrdhvarekhā',
    description:
      'A line rising from the wrist toward the fingers. Its course varies: the texts describe it ending at different fingers.',
    interpretation:
      'Later treatises read this line by the finger it reaches. The Hastasañjīvana pairs each finger with a social role of its time: the forefinger with a king or minister, the middle finger with a general, the ring finger with a wealthy merchant or leader, and the little finger with renown. The Sāmudrikatilaka gives a similar scheme.',
    tradition: 'Indian (12th- and 17th-century treatises)',
    attributionStatus: 'later-tradition-supported',
    attributionConfidence: 'High',
    sources: [
      { sourceId: 'hastasanjivana', locator: '3.2.80–82 (Zysk 2025, p. 264)' },
      { sourceId: 'samudrikatilaka', locator: '1.155–1.156 (Zysk 2025, pp. 265–266)' },
      { sourceId: 'brhatsamhita', locator: 'Iyer tr. 70.12 (a line from the wrist to the middle finger)' },
      { sourceId: 'sardulakarnavadana', locator: 'vv. 1–2 (Zysk 2025, p. 243)' },
    ],
    contextNote:
      'The drawing shows one possible course, ending at the middle finger. These readings describe the status categories of medieval society; the Sāmudrikatilaka even varies them by social class. For Sāmudrikatilaka 1.155, the Sanskrit names the ring finger while the English translation says forefinger, an open question for expert review.',
    westernComparison:
      'Western palmistry splits similar vertical lines into a "fate line" and a "sun line". The Indian treatises treat them as one upward line read by where it ends.',
    diagramPlacement: 'described-in-sources',
    diagramRegionId: 'palm-line-urdhvarekha',
  },
  // ------------------------------------------------------------------ MARKS
  {
    id: 'yava',
    category: 'mark',
    title: 'Barleycorn',
    traditionalName: 'yava',
    description: 'A small mark shaped like a grain of barley, usually described on or at the base of the thumb.',
    interpretation:
      'Historically, this mark was interpreted as a sign of prosperity. The Bṛhatsaṃhitā also links a barleycorn at the thumb\'s root with sons. The 9th-century Buddhist text uses its position on the thumb in omens about the time of birth.',
    tradition: 'Indian (classical)',
    attributionStatus: 'classical-supported',
    attributionConfidence: 'High',
    sources: [
      { sourceId: 'brhatsamhita', locator: 'Iyer tr. 68.42 (Sanskrit editions: 67.42)' },
      { sourceId: 'sardulakarnavadana', locator: 'vv. 9–15, 22 (Zysk 2025, pp. 247–254)' },
    ],
    contextNote: 'Interpretations vary across sources, and the 9th-century text alone gives several different readings.',
    diagramPlacement: 'symbol-only',
    diagramRegionId: 'palm-mark-yava',
  },
  {
    id: 'matsya',
    category: 'mark',
    title: 'Fish',
    traditionalName: 'matsya',
    description: 'A mark shaped like a fish. The Bṛhatsaṃhitā places it in the middle of the palm; some later diagrams draw it just above the wrist.',
    interpretation:
      'The texts associate the fish with abundance. The Bṛhatsaṃhitā links two fish marks with feeding many people, and the 9th-century text links the fish with drink, food and wealth.',
    tradition: 'Indian (classical)',
    attributionStatus: 'classical-supported',
    attributionConfidence: 'High',
    sources: [
      { sourceId: 'brhatsamhita', locator: 'Iyer tr. 68.44' },
      { sourceId: 'sardulakarnavadana', locator: 'vv. 15, 22 (Zysk 2025, pp. 250–254)' },
    ],
    contextNote:
      'The sources disagree on the fish\'s meaning and its position. The editor notes that the fish appears twice in the 9th-century text, which suggests two source traditions were merged.',
    diagramPlacement: 'symbol-only',
    diagramRegionId: 'palm-mark-matsya',
  },
  {
    id: 'shankha',
    category: 'mark',
    title: 'Conch shell',
    traditionalName: 'śaṅkha',
    description: 'A mark shaped like a conch shell. The sources do not fix one position on the palm.',
    interpretation:
      'The conch is one of the "royal" marks. The Bṛhatsaṃhitā lists it among signs of kingship, and the 9th-century text names a king as one whose palms show a conch together with a parasol, a wheel and an elephant\'s foot.',
    tradition: 'Indian (classical)',
    attributionStatus: 'classical-supported',
    attributionConfidence: 'High',
    sources: [
      { sourceId: 'brhatsamhita', locator: 'Iyer tr. 68.45; 70.10' },
      { sourceId: 'sardulakarnavadana', locator: 'v. 21 (Zysk 2025, p. 253)' },
    ],
    contextNote:
      'Royal marks reflect ideals of kingship in early Indian society; the conch is also a familiar symbol in Indian art and ritual. The editor notes the verse stresses the princely or warrior class.',
    diagramPlacement: 'symbol-only',
    diagramRegionId: 'palm-mark-shankha',
  },
  {
    id: 'chatra',
    category: 'mark',
    title: 'Parasol',
    traditionalName: 'chatra',
    description: 'A mark shaped like a parasol or umbrella, the traditional canopy held over royalty. The sources do not fix one position on the palm.',
    interpretation:
      'Like the conch, the parasol belongs to the royal marks. The Bṛhatsaṃhitā lists it among signs of kingship for men and queenship for women, and the 9th-century text pairs it with the conch as a king\'s mark.',
    tradition: 'Indian (classical)',
    attributionStatus: 'classical-supported',
    attributionConfidence: 'High',
    sources: [
      { sourceId: 'brhatsamhita', locator: 'Iyer tr. 68.45; 70.10' },
      { sourceId: 'sardulakarnavadana', locator: 'v. 21 (Zysk 2025, p. 253)' },
    ],
    contextNote:
      'In verse 21 the manuscripts read an "elephant parasol"; the 1954 editor emended this to "king\'s parasol". The term appears there inside that compound.',
    diagramPlacement: 'symbol-only',
    diagramRegionId: 'palm-mark-chatra',
  },
  {
    id: 'vedi',
    category: 'mark',
    title: 'Altar',
    traditionalName: 'vedī',
    description: 'A mark shaped like a Vedic sacrificial altar. The Bṛhatsaṃhitā places it at the root of the thumb.',
    interpretation:
      'Historically, this mark was associated with performing sacrificial rites. Both the Bṛhatsaṃhitā and the 9th-century text describe it this way.',
    tradition: 'Indian (classical)',
    attributionStatus: 'classical-supported',
    attributionConfidence: 'High',
    sources: [
      { sourceId: 'brhatsamhita', locator: 'Iyer tr. 68.48' },
      { sourceId: 'sardulakarnavadana', locator: 'v. 22 (Zysk 2025, p. 254)' },
    ],
    contextNote:
      'The meaning reflects the ritual life of early India. The two sources agree on the association; only the Bṛhatsaṃhitā gives a position.',
    diagramPlacement: 'symbol-only',
    diagramRegionId: 'palm-mark-vedi',
  },
];

export function isPalmistryEntryId(value: unknown): value is PalmistryEntryId {
  return typeof value === 'string' && (PALMISTRY_ENTRY_IDS as readonly string[]).includes(value);
}

/** Safe lookup: unknown/invalid ids return undefined, never throw. */
export function getPalmistryEntry(id: unknown): PalmistryEntry | undefined {
  if (!isPalmistryEntryId(id)) return undefined;
  return PALMISTRY_ENTRIES.find((entry) => entry.id === id);
}

export function getPalmistryEntriesByCategory(category: PalmistryCategory): PalmistryEntry[] {
  return PALMISTRY_ENTRIES.filter((entry) => entry.category === category);
}

/** User-facing labels for attribution status (shown as a badge). */
export const PALMISTRY_ATTRIBUTION_LABELS: Record<PalmistryAttributionStatus, string> = {
  'classical-supported': 'Classical source',
  'later-tradition-supported': 'Later tradition',
  'modern-interpretation': 'Modern interpretation',
  uncertain: 'Source uncertain',
};
