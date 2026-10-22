// AURA DB4 -- unit tests for InsightsDailyBriefingSection.tsx's exported
// selectSectionEvidence(), the fix for the gap DB3's own independent
// review found: dailyAstroBriefing.ts's composeDailyTheme() always cites
// Tara Bala in Daily Theme's prose, but the "Why this guidance?"
// expansion never surfaced the corresponding TARA_BALA evidence entry.
//
// This is a REAL unit test (not a source-text regex check) against the
// actual exported function. selectSectionEvidence itself has no JSX/DOM
// dependency, but importing it still pulls in the WHOLE .tsx module (the
// file's other exports use JSX), so this needs the same `--jsx` override
// as test/dr4f2bAsyncRaceConditions.test.ts / test/planTabChooseMyOwnTime.test.ts
// (both excluded from the root tsconfig.json program for the identical
// reason -- see tsconfig.json's own exclude list, which this file joins):
//
// Run with: TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/dailyBriefingEvidenceCompleteness.test.ts
import { selectSectionEvidence } from '../apps/web/components/InsightsDailyBriefingSection';
import type { GocharEvidenceRef } from '../apps/web/lib/dailyAstroBriefing';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const RULE_VERSION = 'GOCHAR_MOON_RELATIVE_PARASHARI_V1' as const;

function ev(graha: GocharEvidenceRef['graha'], category: GocharEvidenceRef['category'], summary: string, isFavorable = true, houseFromNatalMoon = 1): GocharEvidenceRef {
  return { graha, transitRashiName: 'Mesha', houseFromNatalMoon, isFavorable, category, ruleVersion: RULE_VERSION, summary };
}

// A realistic, full evidence array exactly as dailyAstroBriefing.ts's
// generateAstroDailyBriefing() actually builds it: 9 per-graha DAILY_THEME
// entries, a handful of CAREER/FINANCE/FOCUS/MINDFUL entries, then the
// CHANDRA_BALA and TARA_BALA entries appended last.
const fullEvidence: GocharEvidenceRef[] = [
  ev('Sun', 'DAILY_THEME', 'Sun is transiting House 9 from your natal Moon, traditionally calling for more care.', false, 9),
  ev('Moon', 'DAILY_THEME', 'Moon is transiting House 1 from your natal Moon, traditionally a supportive placement.', true, 1),
  ev('Mercury', 'DAILY_THEME', 'Mercury is transiting House 9 from your natal Moon, traditionally calling for more care.', false, 9),
  ev('Venus', 'DAILY_THEME', 'Venus is transiting House 9 from your natal Moon, traditionally a supportive placement.', true, 9),
  ev('Mars', 'DAILY_THEME', 'Mars is transiting House 6 from your natal Moon, traditionally a supportive placement.', true, 6),
  ev('Jupiter', 'DAILY_THEME', 'Jupiter is transiting House 7 from your natal Moon, traditionally a supportive placement.', true, 7),
  ev('Saturn', 'DAILY_THEME', 'Saturn is transiting House 2 from your natal Moon, traditionally calling for more care.', false, 2),
  ev('Rahu', 'DAILY_THEME', 'Rahu is transiting House 1 from your natal Moon, traditionally calling for more care.', false, 1),
  ev('Ketu', 'DAILY_THEME', 'Ketu is transiting House 7 from your natal Moon, traditionally calling for more care.', false, 7),
  ev('Sun', 'CAREER', 'Sun (career significator) is in House 9 from your natal Moon, traditionally less supportive.', false, 9),
  ev('Saturn', 'CAREER', 'Saturn (career significator) is in House 2 from your natal Moon, traditionally less supportive.', false, 2),
  ev('Mercury', 'CAREER', 'Mercury (career significator) is in House 9 from your natal Moon, traditionally less supportive.', false, 9),
  ev('Jupiter', 'FINANCE', 'Jupiter (finance significator) favors House 7 from your natal Moon.', true, 7),
  ev('Venus', 'FINANCE', 'Venus (finance significator) favors House 9 from your natal Moon.', true, 9),
  ev('Mercury', 'FINANCE', 'Mercury (finance significator) is in House 9 from your natal Moon, traditionally less supportive.', false, 9),
  ev('Moon', 'FOCUS', "Moon is favorably placed in House 1 from your natal Moon, the most notable supportive transit today.", true, 1),
  ev('Sun', 'MINDFUL', 'Sun is in House 9 from your natal Moon, traditionally the day\'s most notable caution.', false, 9),
  ev('Moon', 'CHANDRA_BALA', 'Chandra Bala: the transiting Moon is in House 1 from your natal Moon (traditionally favorable).', true, 1),
  ev('Moon', 'TARA_BALA', 'Tara Bala: today falls on your Janma Tara from Shatabhisha (favorable).', true, 1),
];

// ---- 1. Daily Theme always references Tara Bala (composeDailyTheme's own `tara` sentence is unconditional) -> always folded in ----
{
  const relevant = selectSectionEvidence(fullEvidence, 'DAILY_THEME');
  check('1. Daily Theme evidence includes all 9 per-graha entries', relevant.filter((e) => e.category === 'DAILY_THEME').length === 9);
  check('1. Daily Theme evidence includes the TARA_BALA entry (the claim its own prose always makes)', relevant.some((e) => e.category === 'TARA_BALA'));
  check('1. the TARA_BALA entry\'s summary is DB1\'s own text verbatim, not rewritten', relevant.find((e) => e.category === 'TARA_BALA')?.summary === 'Tara Bala: today falls on your Janma Tara from Shatabhisha (favorable).');
  check('1. Daily Theme evidence has exactly 10 entries total (9 grahas + 1 Tara Bala)', relevant.length === 10);
}

// ---- 2. Chandra Bala is deliberately NOT folded into Daily Theme (composeDailyTheme never names it, and it would duplicate the Moon's own DAILY_THEME entry) ----
{
  const relevant = selectSectionEvidence(fullEvidence, 'DAILY_THEME');
  check('2. Daily Theme evidence does NOT include the CHANDRA_BALA entry (no claim in the text to attach it to, and it would duplicate the Moon\'s own per-graha entry)', !relevant.some((e) => e.category === 'CHANDRA_BALA'));
}

// ---- 3. Both Tara Bala and (hypothetically) Chandra Bala referenced: only Tara Bala is ever folded in, by design, regardless of a Chandra Bala entry's presence ----
{
  // Even with BOTH TARA_BALA and CHANDRA_BALA present in the raw evidence
  // array (as they always are -- DB1 unconditionally computes/pushes
  // both), Daily Theme's selection stays TARA_BALA-only -- the mapping is
  // keyed to what the TEXT cites, not to what evidence exists.
  const relevant = selectSectionEvidence(fullEvidence, 'DAILY_THEME');
  const categories = new Set(relevant.map((e) => e.category));
  check('3. Daily Theme\'s selected evidence categories are exactly {DAILY_THEME, TARA_BALA} -- never CHANDRA_BALA even though it exists in the source array', categories.has('DAILY_THEME') && categories.has('TARA_BALA') && !categories.has('CHANDRA_BALA') && categories.size === 2);
}

// ---- 4. Missing optional evidence: an evidence array with NO Tara Bala entry (defensive case) never fabricates one ----
{
  const noTara = fullEvidence.filter((e) => e.category !== 'TARA_BALA');
  const relevant = selectSectionEvidence(noTara, 'DAILY_THEME');
  check('4. with no TARA_BALA entry present, Daily Theme evidence is just the 9 graha entries -- no fabricated Tara Bala line', relevant.length === 9 && relevant.every((e) => e.category === 'DAILY_THEME'));
}

// ---- 5. No duplicate evidence entries are ever introduced by the selection itself ----
{
  const relevant = selectSectionEvidence(fullEvidence, 'DAILY_THEME');
  const seen = new Set<string>();
  let hasDuplicate = false;
  for (const e of relevant) {
    const key = `${e.graha}:${e.category}:${e.summary}`;
    if (seen.has(key)) hasDuplicate = true;
    seen.add(key);
  }
  check('5. no duplicate (graha, category, summary) entries in Daily Theme\'s selected evidence', !hasDuplicate);
  check('5. selectSectionEvidence never mutates or re-pushes into the input array (same length as source after filtering, no added entries)', fullEvidence.length === 19);
}

// ---- 6. Other sections' evidence is completely unchanged by this fix ----
{
  for (const category of ['CAREER', 'FINANCE', 'FOCUS', 'MINDFUL'] as const) {
    const before = fullEvidence.filter((e) => e.category === category);
    const after = selectSectionEvidence(fullEvidence, category);
    check(`6. ${category} section's evidence is byte-identical to a plain category filter (unaffected by the Daily Theme fix)`, JSON.stringify(before) === JSON.stringify(after));
  }
}

// ---- 7. Evidence labels match the calculated values (isFavorable/houseFromNatalMoon/ruleVersion carried through untouched) ----
{
  const relevant = selectSectionEvidence(fullEvidence, 'DAILY_THEME');
  const taraEntry = relevant.find((e) => e.category === 'TARA_BALA')!;
  check('7. the folded-in Tara Bala entry retains its own isFavorable value', taraEntry.isFavorable === true);
  check('7. the folded-in Tara Bala entry retains its own houseFromNatalMoon value', taraEntry.houseFromNatalMoon === 1);
  check('7. the folded-in Tara Bala entry retains the shared GOCHAR rule version', taraEntry.ruleVersion === RULE_VERSION);
}

// ---- 8. Correct date/user association: selectSectionEvidence is a pure function of its OWN evidence argument only -- two different briefings' evidence arrays never mix ----
{
  const otherUserEvidence: GocharEvidenceRef[] = [
    ev('Moon', 'TARA_BALA', 'Tara Bala: today falls on your Vipat Tara from Rohini (use extra caution).', false, 4),
  ];
  const relevantA = selectSectionEvidence(fullEvidence, 'DAILY_THEME');
  const relevantB = selectSectionEvidence(otherUserEvidence, 'DAILY_THEME');
  check('8. a different evidence array (different user/date) never leaks its Tara Bala entry into another array\'s selection', !relevantA.some((e) => e.summary.includes('Vipat Tara')) && relevantB.some((e) => e.summary.includes('Vipat Tara')));
}

if (!allPassed) { console.error('SOME DB4 EVIDENCE COMPLETENESS CHECKS FAILED'); process.exit(1); }
console.log('ALL DB4 EVIDENCE COMPLETENESS CHECKS PASSED');
process.exit(0);
