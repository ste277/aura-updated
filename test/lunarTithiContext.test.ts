/**
 * Lunar Intelligence V1 — L1: deterministic lunar-Tithi classification.
 *
 * Domain-foundation tests only. Nothing here touches recommendation,
 * Muhurta activity rules, Aura Fit, Day Constructor, Home or Explore --
 * lunarTithiContext.ts is not imported by any of them yet (see the
 * architectural guard at the bottom of this file).
 */
import fs from 'fs';
import path from 'path';
import { TITHI_NAMES, getTithi } from '../packages/vedic/src/panchangElements';
import { getPanchangForDate } from '../packages/panchang/src/panchangDay';
import {
  buildLunarTithiContext,
  familyForTithiOrdinal,
  pakshaBandForTithi,
  type LunarTithiContext,
  type PakshaBand,
  type TithiFamily,
} from '../packages/muhurta/src/lunarTithiContext';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
function checkThrows(label: string, fn: () => unknown) {
  try {
    fn();
    check(label, false);
  } catch {
    check(label, true);
  }
}

async function main() {
  // ============================ A. exhaustive 30-Tithi table ============================
  // Independently written expected (family, band) for every canonical Tithi name, in
  // TITHI_NAMES order -- deliberately NOT derived via the same ordinal-mod-5 / band formula
  // the implementation uses, so a bug in that formula cannot also be baked into the expectation.
  const EXPECTED: Array<{ name: string; index: number; paksha: 'Shukla' | 'Krishna'; ordinal: number; family: TithiFamily; band: PakshaBand }> = [
    { name: 'Shukla Pratipada', index: 1, paksha: 'Shukla', ordinal: 1, family: 'NANDA', band: 'WEAK' },
    { name: 'Shukla Dvitiya', index: 2, paksha: 'Shukla', ordinal: 2, family: 'BHADRA', band: 'WEAK' },
    { name: 'Shukla Tritiya', index: 3, paksha: 'Shukla', ordinal: 3, family: 'JAYA', band: 'WEAK' },
    { name: 'Shukla Chaturthi', index: 4, paksha: 'Shukla', ordinal: 4, family: 'RIKTA', band: 'WEAK' },
    { name: 'Shukla Panchami', index: 5, paksha: 'Shukla', ordinal: 5, family: 'PURNA', band: 'WEAK' },
    { name: 'Shukla Shasthi', index: 6, paksha: 'Shukla', ordinal: 6, family: 'NANDA', band: 'MEDIUM' },
    { name: 'Shukla Saptami', index: 7, paksha: 'Shukla', ordinal: 7, family: 'BHADRA', band: 'MEDIUM' },
    { name: 'Shukla Ashtami', index: 8, paksha: 'Shukla', ordinal: 8, family: 'JAYA', band: 'MEDIUM' },
    { name: 'Shukla Navami', index: 9, paksha: 'Shukla', ordinal: 9, family: 'RIKTA', band: 'MEDIUM' },
    { name: 'Shukla Dashami', index: 10, paksha: 'Shukla', ordinal: 10, family: 'PURNA', band: 'MEDIUM' },
    { name: 'Shukla Ekadashi', index: 11, paksha: 'Shukla', ordinal: 11, family: 'NANDA', band: 'STRONG' },
    { name: 'Shukla Dvadashi', index: 12, paksha: 'Shukla', ordinal: 12, family: 'BHADRA', band: 'STRONG' },
    { name: 'Shukla Trayodashi', index: 13, paksha: 'Shukla', ordinal: 13, family: 'JAYA', band: 'STRONG' },
    { name: 'Shukla Chaturdashi', index: 14, paksha: 'Shukla', ordinal: 14, family: 'RIKTA', band: 'STRONG' },
    { name: 'Purnima', index: 15, paksha: 'Shukla', ordinal: 15, family: 'PURNA', band: 'STRONG' },
    { name: 'Krishna Pratipada', index: 16, paksha: 'Krishna', ordinal: 1, family: 'NANDA', band: 'STRONG' },
    { name: 'Krishna Dvitiya', index: 17, paksha: 'Krishna', ordinal: 2, family: 'BHADRA', band: 'STRONG' },
    { name: 'Krishna Tritiya', index: 18, paksha: 'Krishna', ordinal: 3, family: 'JAYA', band: 'STRONG' },
    { name: 'Krishna Chaturthi', index: 19, paksha: 'Krishna', ordinal: 4, family: 'RIKTA', band: 'STRONG' },
    { name: 'Krishna Panchami', index: 20, paksha: 'Krishna', ordinal: 5, family: 'PURNA', band: 'STRONG' },
    { name: 'Krishna Shasthi', index: 21, paksha: 'Krishna', ordinal: 6, family: 'NANDA', band: 'MEDIUM' },
    { name: 'Krishna Saptami', index: 22, paksha: 'Krishna', ordinal: 7, family: 'BHADRA', band: 'MEDIUM' },
    { name: 'Krishna Ashtami', index: 23, paksha: 'Krishna', ordinal: 8, family: 'JAYA', band: 'MEDIUM' },
    { name: 'Krishna Navami', index: 24, paksha: 'Krishna', ordinal: 9, family: 'RIKTA', band: 'MEDIUM' },
    { name: 'Krishna Dashami', index: 25, paksha: 'Krishna', ordinal: 10, family: 'PURNA', band: 'MEDIUM' },
    { name: 'Krishna Ekadashi', index: 26, paksha: 'Krishna', ordinal: 11, family: 'NANDA', band: 'WEAK' },
    { name: 'Krishna Dvadashi', index: 27, paksha: 'Krishna', ordinal: 12, family: 'BHADRA', band: 'WEAK' },
    { name: 'Krishna Trayodashi', index: 28, paksha: 'Krishna', ordinal: 13, family: 'JAYA', band: 'WEAK' },
    { name: 'Krishna Chaturdashi', index: 29, paksha: 'Krishna', ordinal: 14, family: 'RIKTA', band: 'WEAK' },
    { name: 'Amavasya', index: 30, paksha: 'Krishna', ordinal: 15, family: 'PURNA', band: 'WEAK' },
  ];

  check('A. TITHI_NAMES has exactly 30 canonical entries (the domain this test covers)', TITHI_NAMES.length === 30);
  check('A. the expected table above covers every canonical name, in the same order, with no gaps/duplicates', EXPECTED.length === 30 && EXPECTED.every((e, i) => e.name === TITHI_NAMES[i]));

  for (const expected of EXPECTED) {
    const ctx = buildLunarTithiContext(expected.name);
    check(
      `A. ${expected.name}: index=${expected.index} paksha=${expected.paksha} ordinal=${expected.ordinal} family=${expected.family} band=${expected.band}`,
      ctx.tithiName === expected.name &&
        ctx.tithiIndex === expected.index &&
        ctx.paksha === expected.paksha &&
        ctx.ordinal === expected.ordinal &&
        ctx.family === expected.family &&
        ctx.pakshaBand === expected.band
    );
  }

  // ============================ B. family boundary tests ============================
  const familyCases: Array<[number, TithiFamily]> = [
    [1, 'NANDA'], [2, 'BHADRA'], [3, 'JAYA'], [4, 'RIKTA'], [5, 'PURNA'],
    [6, 'NANDA'], [10, 'PURNA'], [11, 'NANDA'], [14, 'RIKTA'], [15, 'PURNA'],
  ];
  check('B. family boundaries: ' + familyCases.map(([o, f]) => `${o}->${f}`).join(', '), familyCases.every(([ordinal, family]) => familyForTithiOrdinal(ordinal) === family));

  // ============================ C. Paksha-band boundaries ============================
  const bandCases: Array<[('Shukla' | 'Krishna'), number, PakshaBand]> = [
    ['Shukla', 1, 'WEAK'], ['Shukla', 5, 'WEAK'], ['Shukla', 6, 'MEDIUM'], ['Shukla', 10, 'MEDIUM'], ['Shukla', 11, 'STRONG'], ['Shukla', 15, 'STRONG'],
    ['Krishna', 1, 'STRONG'], ['Krishna', 5, 'STRONG'], ['Krishna', 6, 'MEDIUM'], ['Krishna', 10, 'MEDIUM'], ['Krishna', 11, 'WEAK'], ['Krishna', 15, 'WEAK'],
  ];
  check('C. Paksha-band boundaries: ' + bandCases.map(([p, o, b]) => `${p}${o}->${b}`).join(', '), bandCases.every(([paksha, ordinal, band]) => pakshaBandForTithi(paksha, ordinal) === band));

  // ============================ D. Purnima ============================
  const purnima = buildLunarTithiContext('Purnima');
  check('D. Purnima: index 15, ordinal 15, Shukla, PURNA, STRONG', purnima.tithiIndex === 15 && purnima.ordinal === 15 && purnima.paksha === 'Shukla' && purnima.family === 'PURNA' && purnima.pakshaBand === 'STRONG');

  // ============================ E. Amavasya ============================
  const amavasya = buildLunarTithiContext('Amavasya');
  check('E. Amavasya: index 30, ordinal 15, Krishna, PURNA, WEAK', amavasya.tithiIndex === 30 && amavasya.ordinal === 15 && amavasya.paksha === 'Krishna' && amavasya.family === 'PURNA' && amavasya.pakshaBand === 'WEAK');
  check('D/E. Purnima and Amavasya land in the SAME family (PURNA) but OPPOSITE bands (STRONG vs WEAK) -- paksha, not family, carries the strength distinction', purnima.family === amavasya.family && purnima.pakshaBand !== amavasya.pakshaBand);

  // ============================ F. invalid input ============================
  checkThrows('F. familyForTithiOrdinal(0) throws (no silent coercion/clamp)', () => familyForTithiOrdinal(0));
  checkThrows('F. familyForTithiOrdinal(16) throws', () => familyForTithiOrdinal(16));
  checkThrows('F. familyForTithiOrdinal(-1) throws', () => familyForTithiOrdinal(-1));
  checkThrows('F. familyForTithiOrdinal(1.5) throws (non-integer)', () => familyForTithiOrdinal(1.5));
  checkThrows('F. pakshaBandForTithi("Shukla", 0) throws', () => pakshaBandForTithi('Shukla', 0));
  checkThrows('F. pakshaBandForTithi("Shukla", 16) throws', () => pakshaBandForTithi('Shukla', 16));
  checkThrows('F. pakshaBandForTithi with an invalid paksha throws', () => pakshaBandForTithi('shukla' as unknown as 'Shukla', 5));
  checkThrows('F. buildLunarTithiContext(unknown name) throws, never returns index 0 or a default family', () => buildLunarTithiContext('Shukla Ashtami '));
  checkThrows('F. buildLunarTithiContext("") throws', () => buildLunarTithiContext(''));
  checkThrows('F. buildLunarTithiContext(garbage) throws, no fuzzy match', () => buildLunarTithiContext('Full Moon'));
  checkThrows('F. buildLunarTithiContext is case-sensitive (no fuzzy/partial match)', () => buildLunarTithiContext('purnima'));

  // ============================ G. canonical integration (real Panchang output, no new astronomy) ============================
  const realDates = [
    new Date('2026-01-15T12:00:00Z'),
    new Date('2026-04-01T12:00:00Z'),
    new Date('2026-07-04T12:00:00Z'),
    new Date('2026-09-28T12:00:00Z'),
    new Date('2026-12-25T12:00:00Z'),
  ];
  let integrationOk = true;
  const integrationSamples: string[] = [];
  for (const date of realDates) {
    const liveTithi = getTithi(date); // the SAME canonical astronomy source the rest of the codebase uses -- no second source here
    let ctx: LunarTithiContext;
    try {
      ctx = buildLunarTithiContext(liveTithi.name);
    } catch {
      integrationOk = false;
      continue;
    }
    integrationSamples.push(`${date.toISOString().slice(0, 10)}: ${liveTithi.name} -> idx${ctx.tithiIndex}/${ctx.paksha}/ord${ctx.ordinal}/${ctx.family}/${ctx.pakshaBand}`);
    if (ctx.tithiIndex !== liveTithi.index || ctx.tithiName !== liveTithi.name) integrationOk = false;
  }
  check('G. every real getTithi() output for 5 real dates is accepted by buildLunarTithiContext with a matching index (no new astronomy performed): ' + integrationSamples.join(' | '), integrationOk);

  // Also round-trips through the higher-level Panchang day service (the same one Home/Explore/API routes call).
  const day = getPanchangForDate({ localDate: '2026-09-28', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const dayCtx = buildLunarTithiContext(day.panchanga.tithi.name);
  check('G. accepts getPanchangForDate()\'s own Tithi name output directly, and its derived Paksha agrees with panchangDay.ts\'s own Paksha field', dayCtx.paksha === day.panchanga.tithi.paksha);

  // ============================ H. architectural guard ============================
  const source = fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/lunarTithiContext.ts'), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const code = strip(source);
  const imports = [...source.matchAll(/^import[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  const FORBIDDEN_IMPORTS = /recommendation|auraFitEngine|dayConstructor|activityOntology|muhurtaRulePacks|muhurtaEngine|daily-guidance|daily-personal-fit|window-ranking/i;
  check('H. lunarTithiContext.ts imports nothing from recommendation/Aura Fit/Day Constructor/activityOntology/muhurtaRulePacks -- it stands alone', imports.every((i) => !FORBIDDEN_IMPORTS.test(i)));
  check('H. the only import is the canonical Tithi source (packages/vedic/panchangElements)', imports.length === 1 && /vedic\/src\/panchangElements$/.test(imports[0]));
  check('H. no scoring/reason/activity vocabulary in the module\'s actual CODE (comments explaining what L1 deliberately avoids are fine; favorable/unfavorable/auspicious/score/modifier/MuhurtaReason/activity family/intent/action phase must never appear outside prose)', !/favorable|unfavorable|auspicious|inauspicious|\bscore\b|\bmodifier\b|MuhurtaReason|activityFamily|MuhurtaIntent|actionPhase/i.test(code));
  // Lunar Intelligence V1 L3 deliberately wired muhurtaRulePacks.ts as the one designated production consumer
  // (packages/muhurta/src/lunarFamilyRules.ts and its own test carry the word too, as legitimate downstream
  // consequences of that same wiring) -- this guard now allows exactly that intentional set, no more.
  check('H. the only production consumers of lunarTithiContext.ts are muhurtaRulePacks.ts and auraFitEngine.ts (Lunar Intelligence L3/L3.2\'s two designated integration points) -- no other file reaches it', (() => {
    const { execSync } = require('child_process');
    const out = execSync(`grep -rl "lunarTithiContext" apps packages test --include="*.ts" --include="*.tsx" 2>/dev/null || true`, { cwd: path.join(__dirname, '..') }).toString();
    const files = out.split('\n').filter(Boolean).map((f: string) => f.replace(/\\/g, '/'));
    // Lunar Intelligence V1 L3.2 added auraFitEngine.ts as a second, deliberate consumer (the legacy-path overlay
    // integration point -- see auraFitEngine.ts's own comment), alongside muhurtaRulePacks.ts.
    const ALLOWED = new Set(['packages/muhurta/src/lunarTithiContext.ts', 'test/lunarTithiContext.test.ts', 'packages/muhurta/src/muhurtaRulePacks.ts', 'packages/muhurta/src/lunarFamilyRules.ts', 'test/lunarFamilyRules.test.ts', 'test/muhurtaRulePacks.test.ts', 'packages/recommendation/src/auraFitEngine.ts']);
    return files.every((f: string) => ALLOWED.has(f));
  })());

  if (!allPassed) { console.error('SOME LUNAR TITHI CONTEXT CHECKS FAILED'); process.exit(1); }
  console.log('ALL LUNAR TITHI CONTEXT CHECKS PASSED');
}
main();
