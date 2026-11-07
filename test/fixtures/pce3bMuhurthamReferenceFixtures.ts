/**
 * PCE-3B -- Independent Muhurtham Reference Validation: provenance-first
 * fixture dataset for Marriage and Griha Pravesh.
 *
 * PROVENANCE DISCIPLINE (do not violate when adding fixtures):
 *  - Every field below was copied, by hand, from a real page this task
 *    fetched directly with `curl` from https://www.drikpanchang.com (the
 *    exact URL is in `sourceUrl` on each fixture) -- NOT from an AI web-
 *    search paraphrase, and NOT from running any of Aura's own code. The
 *    raw HTML block each fixture was extracted from is quoted verbatim in
 *    `rawExcerpt` (stripped of markup, kept short -- this is attribution-
 *    respecting excerpting of a public page's own factual listing, not a
 *    republication of the whole page).
 *  - No fixture states an "expected Aura result." Aura's own computed
 *    values are produced fresh by the test file that reads this dataset
 *    (test/pce3bIndependentReferenceValidation.test.ts) and compared
 *    against the `published` fields here -- this file only records what
 *    DrikPanchang itself published.
 *  - DrikPanchang's compact per-date cards omit the Paksha (Shukla/Krishna)
 *    prefix on Tithi names. `published.tithiNameIgnoringPaksha` preserves
 *    that limitation honestly -- it is NOT a claim about which paksha was
 *    meant, only the bare Tithi name as published.
 *  - Where DrikPanchang gives only a reason string and no exact muhurat
 *    window (an "inauspicious" day), `published.muhurat` is null. Do not
 *    invent a time for these.
 *  - Location coverage gap (disclosed, not fabricated): every fixture
 *    below is New Delhi, NCT, India (28.6139N 77.2090E, Asia/Kolkata) --
 *    the same coordinates test/marriageRequiredEligibility.test.ts already
 *    uses. A second geographic location (the ticket's own Section 3
 *    target) was NOT obtained: DrikPanchang's London/Dallas/Mumbai variant
 *    pages (reached via `?geoname-id=`) returned a reCAPTCHA challenge
 *    after the first few requests, and retrying past that challenge was
 *    correctly refused as bot-check circumvention. This is an honest,
 *    reported shortfall, not a fabricated second location -- see PCE-3B's
 *    own evidence register (deliverable A) for the full account.
 */

export type MuhurthamOccasionFixture = 'MARRIAGE' | 'GRIHA_PRAVESH';

export interface PublishedMuhurthamReference {
  /** Exact local calendar date DrikPanchang's card is keyed to. */
  localDate: string;
  /** Local weekday exactly as DrikPanchang's own card label states it. */
  publishedWeekday: string;
  auspicious: boolean;
  /** DrikPanchang's own stated reason/status message for this date. */
  message: string;
  /**
   * Published muhurat window in LOCAL (Asia/Kolkata) time, as two
   * {date,time} pairs -- null when DrikPanchang published no exact window
   * (an inauspicious day with only a reason string). Do not invent one.
   */
  muhurat: { startDate: string; startTime: string; endDate: string; endTime: string } | null;
  /**
   * Nakshatra name(s) exactly as published. A comma-separated pair means
   * the published window itself spans a Nakshatra transition.
   */
  nakshatra: string | null;
  /** Tithi name(s) exactly as published, Paksha prefix NOT included (see file doc comment). */
  tithiNameIgnoringPaksha: string | null;
}

export interface MuhurthamReferenceFixture {
  id: string;
  occasion: MuhurthamOccasionFixture;
  /** What this fixture is being used to probe -- purely descriptive, not an assertion. */
  purpose: string;
  sourcePublisher: 'DrikPanchang';
  sourceUrl: string;
  /** Date this task fetched the live page, confirmed via direct `curl`. */
  retrievedOn: string;
  location: { label: string; latitude: number; longitude: number; timezone: string };
  /** Short, attribution-respecting plain-text excerpt of the raw page block this fixture came from. */
  rawExcerpt: string;
  published: PublishedMuhurthamReference;
  /**
   * Comparability limitations specific to this fixture, stated honestly --
   * e.g. "day-level reason only, no exact instant" or "published window
   * itself spans a transition." Read before treating any mismatch found
   * against this fixture as a defect.
   */
  limitations: string[];
  /**
   * PCE-4A-T2: optional local time (HH:mm, within `published.muhurat`'s
   * window) to sample for the STRICT exact-instant Nakshatra/Tithi
   * comparisons, used ONLY when `published.muhurat.startTime` itself is
   * too close to a genuine Panchanga transition for the source's own
   * minute-level display precision to support an exact-instant claim.
   * `published.muhurat.startTime` is NEVER changed by this field -- it
   * stays the real, unmodified published value. Set this only with a
   * `justification` citing independent evidence (never to dodge a
   * specific failing instant without cause).
   */
  strictInstantOverride?: { localTime: string; justification: string };
}

const NEW_DELHI = { label: 'New Delhi, NCT, India', latitude: 28.6139, longitude: 77.209, timezone: 'Asia/Kolkata' };

export const PCE3B_MUHURTHAM_REFERENCE_FIXTURES: MuhurthamReferenceFixture[] = [
  {
    id: 'MARRIAGE-FAV-2026-02-06',
    occasion: 'MARRIAGE',
    purpose: 'Clearly favorable example, single-day window, no midnight crossing.',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/shubh-marriage-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'February 6, 2026, Friday Auspicious Marriage Muhurat is Available Muhurat: 07:06 AM to 11:37 PM Nakshatra: Hasta Tithi: Panchami',
    limitations: ['Tithi paksha not stated by the source (see file doc comment).'],
    published: {
      localDate: '2026-02-06',
      publishedWeekday: 'Friday',
      auspicious: true,
      message: 'Auspicious Marriage Muhurat is Available',
      muhurat: { startDate: '2026-02-06', startTime: '07:06', endDate: '2026-02-06', endTime: '23:37' },
      nakshatra: 'Hasta',
      tithiNameIgnoringPaksha: 'Panchami',
    },
  },
  {
    id: 'MARRIAGE-FAV-2026-02-08-MIDNIGHT-CROSSING',
    occasion: 'MARRIAGE',
    purpose: 'Favorable example whose published window starts right after local midnight -- a day-boundary-adjacent case, the same class of bug this engagement has repeatedly found (PR #290).',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/shubh-marriage-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'February 8, 2026, Sunday Auspicious Marriage Muhurat is Available Muhurat: 12:08 AM to 05:02 AM , Feb 09 Nakshatra: Swati Tithi: Saptami',
    limitations: [
      'Tithi paksha not stated by the source.',
      'The published window starts only 8 minutes after local midnight -- Aura\'s computed Tithi at that exact instant disagreed with the published Tithi by one step (see comparison report / discrepancy F1 in the PR description). Treat this fixture\'s Tithi comparison as unresolved pending a transition-instant investigation, not as a pass or a confirmed defect.',
    ],
    published: {
      localDate: '2026-02-08',
      publishedWeekday: 'Sunday',
      auspicious: true,
      message: 'Auspicious Marriage Muhurat is Available',
      muhurat: { startDate: '2026-02-08', startTime: '00:08', endDate: '2026-02-09', endTime: '05:02' },
      nakshatra: 'Swati',
      tithiNameIgnoringPaksha: 'Saptami',
    },
  },
  {
    id: 'MARRIAGE-EXCL-YOGA-2026-02-07',
    occasion: 'MARRIAGE',
    purpose: 'Excluded example with an explicit stated reason (prohibited Yoga) -- day-level only, no exact muhurat window published.',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/shubh-marriage-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'February 7, 2026, Saturday Prohibited Yoga is corrupting most of the day',
    limitations: ['Day-level reason only -- DrikPanchang published no exact instant or window for an excluded day; do not treat a single noon sample as "the" instant DrikPanchang meant.'],
    published: {
      localDate: '2026-02-07',
      publishedWeekday: 'Saturday',
      auspicious: false,
      message: 'Prohibited Yoga is corrupting most of the day',
      muhurat: null,
      nakshatra: null,
      tithiNameIgnoringPaksha: null,
    },
  },
  {
    id: 'MARRIAGE-EXCL-VENUS-COMBUSTION-2026-01-15',
    occasion: 'MARRIAGE',
    purpose: 'Excluded example attributed to Venus (Shukra) combustion, a factor Aura explicitly implements (requiresPlanetaryCombustion). Sampled mid-way through a DrikPanchang-published month-long "Shukra Tara Asta" exclusion window (2026-01-01 through 2026-02-01).',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/shubh-marriage-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'January 15, 2026, Thursday Shukra Tara Asta',
    limitations: ['Day-level reason only; this fixture is a representative midpoint of a published month-long window (2026-01-01 to 2026-02-01), not a precise boundary instant.'],
    published: {
      localDate: '2026-01-15',
      publishedWeekday: 'Thursday',
      auspicious: false,
      message: 'Shukra Tara Asta',
      muhurat: null,
      nakshatra: null,
      tithiNameIgnoringPaksha: null,
    },
  },
  {
    id: 'MARRIAGE-EXCL-JUPITER-COMBUSTION-2026-08-01',
    occasion: 'MARRIAGE',
    purpose: 'Excluded example attributed to Jupiter (Guru) combustion, the other factor Aura explicitly implements under requiresPlanetaryCombustion.',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/shubh-marriage-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'August 1, 2026, Saturday Guru Tara Asta',
    limitations: ['Day-level reason only.'],
    published: {
      localDate: '2026-08-01',
      publishedWeekday: 'Saturday',
      auspicious: false,
      message: 'Guru Tara Asta',
      muhurat: null,
      nakshatra: null,
      tithiNameIgnoringPaksha: null,
    },
  },
  {
    id: 'MARRIAGE-EXCL-SOLAR-MONTH-2026-09-01',
    occasion: 'MARRIAGE',
    purpose: 'Excluded example attributed to a "Prohibited Solar month" -- published across the entire August-October 2026 range (zero auspicious Marriage dates in any of those 3 months), plausibly related to Aura\'s own Chaturmas/Dakshinayana period-exclusion concept, but NOT confirmed to be the same mechanism -- see limitations.',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/shubh-marriage-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'September 1, 2026, Tuesday Prohibited Solar month',
    limitations: [
      'Day-level reason only.',
      'DrikPanchang labels this a SOLAR-month restriction; Aura\'s own Chaturmas/Kharmas machinery (packages/vedic/src/lunarCalendar.ts, packages/recommendation/src/ceremonialPeriods.ts) is framed around synodic lunar-month and Sankranti boundaries. Whether "Prohibited Solar month" and Aura\'s Chaturmas concept are the same traditional mechanism under different names, or genuinely different rules, is NOT established by this fixture alone -- marked unresolved (category F), not asserted as either agreement or a gap.',
    ],
    published: {
      localDate: '2026-09-01',
      publishedWeekday: 'Tuesday',
      auspicious: false,
      message: 'Prohibited Solar month',
      muhurat: null,
      nakshatra: null,
      tithiNameIgnoringPaksha: null,
    },
  },
  {
    id: 'GRIHA_PRAVESH-FAV-2026-02-20',
    occasion: 'GRIHA_PRAVESH',
    purpose: 'Clearly favorable example, single-day window, no midnight crossing.',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/griha-pravesh-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'February 20, 2026, Friday Auspicious Griha Pravesh Muhurat is Available Muhurat: 06:55 AM to 02:38 PM Nakshatra: Uttara Bhadrapada Tithi: Tritiya',
    limitations: ['Tithi paksha not stated by the source.'],
    published: {
      localDate: '2026-02-20',
      publishedWeekday: 'Friday',
      auspicious: true,
      message: 'Auspicious Griha Pravesh Muhurat is Available',
      muhurat: { startDate: '2026-02-20', startTime: '06:55', endDate: '2026-02-20', endTime: '14:38' },
      nakshatra: 'Uttara Bhadrapada',
      tithiNameIgnoringPaksha: 'Tritiya',
    },
  },
  {
    id: 'GRIHA_PRAVESH-FAV-2026-03-06',
    occasion: 'GRIHA_PRAVESH',
    purpose: 'Second clearly favorable example, different month, single-day window.',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/griha-pravesh-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'March 6, 2026, Friday Auspicious Griha Pravesh Muhurat is Available Muhurat: 09:29 AM to 05:53 PM Nakshatra: Chitra Tithi: Tritiya',
    limitations: [
      'Tithi paksha not stated by the source.',
      // PCE-4A-T2: DrikPanchang's own day-panchang breakdown for this date
      // (drikpanchang.com/panchang/day-panchang.html?date=06/03/2026,
      // independently re-fetched 2026-11-07, confirmed unchanged even in
      // its "24 Plus" extended-hour display mode, which still shows no
      // seconds anywhere on the page for any transition) states "Nakshatra
      // Hasta upto 09:29" -- i.e. DrikPanchang's own transition instant for
      // Hasta->Chitra is published to the SAME minute-level precision as
      // this fixture's muhurat start time, not a finer one. Aura's
      // corrected Hasta->Chitra transition for this date is 09:29:05.334
      // IST, which rounds to the published "09:29" exactly -- consistent
      // with, not contradicting, the source. A strict Nakshatra/Tithi
      // comparison sampled at the literal published start-of-window minute
      // (09:29:00.000) therefore falls on the wrong side of a real
      // transition that the source's own precision cannot distinguish from
      // it. See `strictInstantOverride` below.
    ],
    published: {
      localDate: '2026-03-06',
      publishedWeekday: 'Friday',
      auspicious: true,
      message: 'Auspicious Griha Pravesh Muhurat is Available',
      muhurat: { startDate: '2026-03-06', startTime: '09:29', endDate: '2026-03-06', endTime: '17:53' },
      nakshatra: 'Chitra',
      tithiNameIgnoringPaksha: 'Tritiya',
    },
    // PCE-4A-T2: sample the strict Nakshatra/Tithi comparison at the
    // published window's midpoint (09:29 AM-05:53 PM -> 13:41) instead of
    // its literal start minute. This is an instant safely interior to both
    // window boundaries (not chosen to dodge the specific 09:29:05
    // transition second -- it is the window's natural midpoint, confirmed
    // independently to still be Chitra/Tritiya per both DrikPanchang's own
    // day-panchang page and Aura's corrected calculation). The published
    // 09:29 AM start time above is left completely unchanged.
    strictInstantOverride: {
      localTime: '13:41',
      justification:
        'Published start minute (09:29) is within the same source-stated minute as the real Hasta->Chitra transition (09:29:05.334 IST per Aura\'s corrected calculation; DrikPanchang\'s own day-panchang page independently states "Hasta upto 09:29" for the same transition, confirming minute-level source precision, not a disagreement). Window midpoint (13:41) is safely interior to both the 09:29 start and 17:53 end boundaries.',
    },
  },
  {
    id: 'GRIHA_PRAVESH-FAV-2026-02-06-TRANSITION-SPANNING',
    occasion: 'GRIHA_PRAVESH',
    purpose: 'Favorable example whose published window itself spans a Nakshatra+Tithi transition (window crosses midnight AND the source lists two Nakshatra/Tithi pairs for it).',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/griha-pravesh-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'February 6, 2026, Friday Auspicious Griha Pravesh Muhurat is Available Muhurat: 12:23 AM to 01:18 AM , Feb 07 Nakshatra: Chitra, Hasta Tithi: Shashthi, Panchami',
    limitations: [
      'The published Nakshatra/Tithi are each a comma-separated PAIR ("Chitra, Hasta" / "Shashthi, Panchami") -- DrikPanchang is stating that both values occur somewhere within the 55-minute window, not which one applies at the exact start. Do not treat a single-instant comparison against this fixture as a clean pass/fail; it is inherently ambiguous (category D) by the source\'s own publication format.',
    ],
    published: {
      localDate: '2026-02-06',
      publishedWeekday: 'Friday',
      auspicious: true,
      message: 'Auspicious Griha Pravesh Muhurat is Available',
      muhurat: { startDate: '2026-02-06', startTime: '00:23', endDate: '2026-02-07', endTime: '01:18' },
      nakshatra: 'Chitra, Hasta',
      tithiNameIgnoringPaksha: 'Shashthi, Panchami',
    },
  },
  {
    id: 'GRIHA_PRAVESH-EXCL-TITHI-2026-02-14',
    occasion: 'GRIHA_PRAVESH',
    purpose: 'Excluded example attributed to a prohibited Tithi -- day-level only, no exact window published.',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/griha-pravesh-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'February 14, 2026, Saturday Prohibited Tithi for Griha Pravesh',
    limitations: [
      'Day-level reason only -- no exact instant published, so which of the day\'s Tithi(s) DrikPanchang means cannot be determined precisely from this fixture alone.',
      'A noon sample on this date computed via Aura\'s own getTithi() does not appear in Aura\'s own Griha Pravesh avoid-Tithi list -- but because the exact instant is unknown (see above), this must be recorded as unresolved (category D/F), not asserted as a confirmed gap.',
    ],
    published: {
      localDate: '2026-02-14',
      publishedWeekday: 'Saturday',
      auspicious: false,
      message: 'Prohibited Tithi for Griha Pravesh',
      muhurat: null,
      nakshatra: null,
      tithiNameIgnoringPaksha: null,
    },
  },
  {
    id: 'GRIHA_PRAVESH-EXCL-ADHIKA-MASA-2026-05-17',
    occasion: 'GRIHA_PRAVESH',
    purpose: 'Excluded example attributed to Adhika/leap-month overlap. Aura\'s Griha Pravesh rule pack has NO period-exclusion rule of any kind today (confirmed: no requiresPeriodExclusion/periodRules on its INTENT_RULE_PACKS entry) -- this fixture is primarily evidence for the traditional-rule-difference gap PCE-1/PCE-3A already identified, and secondarily an astronomical cross-check of Aura\'s own Adhika Masa detection.',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/griha-pravesh-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'May 17, 2026, Sunday Prohibited Adhika/Leaped month',
    limitations: [
      'Day-level reason only.',
      'Aura\'s own classifySynodicMonthContaining() DOES detect a real 2026 Adhika Masa -- but for the synodic month 2026-06-15 to 2026-07-14, not the month containing May 16-17 (which it classifies NORMAL). This is a genuine, reproducible discrepancy of about one synodic month between DrikPanchang\'s flagged dates and Aura\'s own leap-month window -- classified unresolved/convention-difference (B/F), NOT a confirmed defect, since Aura does detect a real leap month in 2026, just not coincident with this specific fixture\'s dates. See the paired fixture GRIHA_PRAVESH-EXCL-ADHIKA-MASA-2026-05-16 and the PR\'s comparison report for the full investigation.',
    ],
    published: {
      localDate: '2026-05-17',
      publishedWeekday: 'Sunday',
      auspicious: false,
      message: 'Prohibited Adhika/Leaped month',
      muhurat: null,
      nakshatra: null,
      tithiNameIgnoringPaksha: null,
    },
  },
  {
    id: 'GRIHA_PRAVESH-EXCL-ADHIKA-MASA-2026-05-16',
    occasion: 'GRIHA_PRAVESH',
    purpose: 'Paired with the 2026-05-17 fixture above -- DrikPanchang\'s own adjacent-day label ("partially overlaps") for the day immediately before.',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/griha-pravesh-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'May 16, 2026, Saturday Day partially overlaps with Prohibited Adhika/Leaped month',
    limitations: [
      'Day-level reason only.',
      'Same unresolved Adhika-Masa-window discrepancy as the paired 2026-05-17 fixture -- see that fixture\'s limitations.',
    ],
    published: {
      localDate: '2026-05-16',
      publishedWeekday: 'Saturday',
      auspicious: false,
      message: 'Day partially overlaps with Prohibited Adhika/Leaped month',
      muhurat: null,
      nakshatra: null,
      tithiNameIgnoringPaksha: null,
    },
  },
  {
    id: 'GRIHA_PRAVESH-EXCL-WEEKDAY-2026-02-08',
    occasion: 'GRIHA_PRAVESH',
    purpose: 'Excluded example attributed to a prohibited Vara (weekday) -- a factor Aura does not implement for Griha Pravesh at all (its rule pack has no vara field, and the code comment documents Vara as deliberately de-prioritized for Marriage; Griha Pravesh has no Vara handling whatsoever).',
    sourcePublisher: 'DrikPanchang',
    sourceUrl: 'https://www.drikpanchang.com/shubh-dates/griha-pravesh-dates-with-muhurat.html',
    retrievedOn: '2026-11-06',
    location: NEW_DELHI,
    rawExcerpt: 'February 8, 2026, Sunday Prohibited Weekday for Griha Pravesh',
    limitations: ['Day-level reason only; the weekday itself (Sunday) is independently verifiable and was cross-checked directly (see comparison report).'],
    published: {
      localDate: '2026-02-08',
      publishedWeekday: 'Sunday',
      auspicious: false,
      message: 'Prohibited Weekday for Griha Pravesh',
      muhurat: null,
      nakshatra: null,
      tithiNameIgnoringPaksha: null,
    },
  },
];
