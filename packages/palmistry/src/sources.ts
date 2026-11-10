/**
 * AURA-PALM-01-I1 -- source register for the educational Palmistry guide.
 *
 * Every PalmistryEntry (content.ts) cites one or more of these stable IDs.
 * This module is pure data: it imports nothing, and nothing in the
 * Panchang / Muhurtham / Timing Search / Daily Rhythm / recommendation
 * engines may import it (enforced by test/palm01I1Content.test.ts).
 *
 * Verification status describes what the AURA-PALM-01-D1 research actually
 * read -- it is NOT a human expert sign-off. See
 * docs/palmistry/AURA_PALM_01_I1_CONTENT_REVIEW_PACKET.md.
 */

export type PalmSourceVerification =
  /** The cited passages were read directly in this edition/translation. */
  | 'read-directly'
  /** Read only through another source's edition, translation or excerpt. */
  | 'read-via-secondary'
  /** Not read; cited only for context. Never the sole support for content. */
  | 'not-read';

export interface PalmSource {
  id: string;
  /** Author, or the text's traditional attribution. */
  author: string;
  title: string;
  /** Approximate date of the text itself (not of the edition). */
  textDate: string;
  /** Chapters/sections the guide relies on. */
  sections: string;
  /** Edition / translation actually used. */
  edition: string;
  url?: string;
  licensing: string;
  verification: PalmSourceVerification;
  /** Short, user-facing citation line. */
  shortCitation: string;
}

export const PALM_SOURCES: readonly PalmSource[] = [
  {
    id: 'zysk-2025',
    author: 'Kenneth G. Zysk',
    title: 'Early Indian Palmistry. Śārdūlakarṇāvadāna: Pāṇilekhā',
    textDate: '2025 (scholarly edition)',
    sections: 'pp. 240–275: introduction, verses 1–34 with commentary, Appendix I (Hastasañjīvana, Sāmudrikatilaka excerpts)',
    edition: 'History of Science in South Asia 13 (2025): 240–275. DOI 10.18732/hssa128',
    url: 'https://journals.library.ualberta.ca/hssa/index.php/hssa/article/view/128',
    licensing:
      'CC BY-SA 4.0. Aura uses original paraphrase only: no translations, verses or diagrams are reproduced. Licensing review must confirm that the paraphrased content is not an "adaptation" that triggers share-alike.',
    verification: 'read-directly',
    shortCitation: 'Zysk, History of Science in South Asia 13 (2025)',
  },
  {
    id: 'sardulakarnavadana',
    author: 'Buddhist Sanskrit text (anonymous compilation)',
    title: 'Śārdūlakarṇāvadāna, chapter "Pāṇilekhā" (lines on the hands)',
    textDate: 'Palmistry chapter entered the text after the mid-9th century CE (Zysk 2025, p. 240)',
    sections: 'Verses 1–7 (lines), 9–15 and 21–22 (marks)',
    edition: 'Critical edition and English translation in Zysk 2025',
    url: 'https://journals.library.ualberta.ca/hssa/index.php/hssa/article/view/128',
    licensing: 'Ancient text (public domain). The edition and translation used are CC BY-SA 4.0 (Zysk 2025); paraphrase only.',
    verification: 'read-via-secondary',
    shortCitation: 'Śārdūlakarṇāvadāna (9th c.), ed. Zysk 2025',
  },
  {
    id: 'brhatsamhita',
    author: 'Varāhamihira',
    title: 'Bṛhatsaṃhitā, chapters on the marks of men and of women',
    textDate: '6th century CE (Zysk 2025, p. 240)',
    sections:
      'Iyer translation ch. 68 vv. 36–50 and ch. 70 vv. 10–14. NOTE: Sanskrit editions number the men\'s chapter 67 (e.g. Zysk cites 67.42 for Iyer\'s 68.42).',
    edition: 'N. Chidambaram Iyer, English translation (1884), as hosted by wisdomlib.org',
    url: 'https://www.wisdomlib.org/hinduism/book/brihat-samhita/d/doc229330.html',
    licensing: 'Ancient text and 1884 translation are public domain. Paraphrase only; wisdomlib.org hosting terms not relied on.',
    verification: 'read-directly',
    shortCitation: 'Bṛhatsaṃhitā (6th c.), tr. Iyer 1884',
  },
  {
    id: 'samudrikatilaka',
    author: 'Durlabharāja, completed by his son Jagaddeva',
    title: 'Sāmudrikatilaka',
    textDate: '1160–1175 CE (Zysk 2025, p. 242)',
    sections: '1.143, 1.155–1.156 (as excerpted in Zysk 2025, Appendix I, pp. 265–266)',
    edition: 'Excerpts translated in Zysk 2025, Appendix I',
    url: 'https://journals.library.ualberta.ca/hssa/index.php/hssa/article/view/128',
    licensing: 'Medieval text (public domain). Translation used is CC BY-SA 4.0 (Zysk 2025); paraphrase only.',
    verification: 'read-via-secondary',
    shortCitation: 'Sāmudrikatilaka (12th c.), excerpts in Zysk 2025',
  },
  {
    id: 'hastasanjivana',
    author: 'Jain treatise with commentary by Meghavijaya Gaṇi (Tapāgaccha; active 1674–1695)',
    title: 'Hastasañjīvana',
    textDate: 'Late 17th century CE (Zysk 2025, p. 241)',
    sections: '3.2.80–82 (upward line), as excerpted in Zysk 2025, Appendix I, p. 264',
    edition: 'Excerpts translated in Zysk 2025, Appendix I',
    url: 'https://journals.library.ualberta.ca/hssa/index.php/hssa/article/view/128',
    licensing: 'Pre-modern text (public domain). Translation used is CC BY-SA 4.0 (Zysk 2025); paraphrase only.',
    verification: 'read-via-secondary',
    shortCitation: 'Hastasañjīvana (17th c.), excerpts in Zysk 2025',
  },
  {
    id: 'hand-diagrams-18c',
    author: 'Anonymous palmistry diagrams (Rajasthan, Banaras and elsewhere)',
    title: 'Manuscript hand diagrams reproduced in Zysk 2025, figs. 1–5',
    textDate: 'Figs. 3–4: 1732–1748 CE; fig. 1 undated; fig. 2: 1929 print; fig. 5: 2002 print',
    sections: 'Line labels (āyur-, dhanamātṛ-, pitṛ- / Sarasvatī-rekhā), as described in Zysk\'s commentary',
    edition: 'Zysk 2025, Appendix II (described in commentary; images NOT reproduced by Aura)',
    url: 'https://journals.library.ualberta.ca/hssa/index.php/hssa/article/view/128',
    licensing: 'Aura\'s hand illustration is original and does not copy these diagrams.',
    verification: 'read-via-secondary',
    shortCitation: 'Indian hand diagrams (18th c. onward), described in Zysk 2025',
  },
];

export function getPalmSource(id: string): PalmSource | undefined {
  return PALM_SOURCES.find((source) => source.id === id);
}
