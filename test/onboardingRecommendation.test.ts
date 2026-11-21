/**
 * AURA-READY-03-F1 -- onboarding must never present an unfavourable
 * Panchang window (Rahu Kalam, Yamaganda, Gulika) as "Your next useful
 * window... suitable period for focused activity".
 *
 * Deterministic: every case uses a fixed date and a fixed minute-of-day
 * (the "clock"), either with the REAL solar ephemeris + Panchang windows
 * for Chennai or with hand-built windows. The card is rendered with
 * renderToStaticMarkup (same harness as test/homeRecomposition.test.ts).
 */
import { computeSolarEphemeris } from '../packages/astronomy/src/ephemeris';
import {
  computePanchangWindows,
  evaluatePanchangOverlap,
  isInauspiciousCommencementWindow,
  type WeekdayIndex,
  type WindowSpan,
} from '../packages/panchang/src/windows';
import { computeDailyEnergyInsight } from '../apps/web/lib/scoreEngine';
import { computeOnboardingRecommendation, type OnboardingWindowRecommendation } from '../apps/web/lib/onboardingRecommendation';

const React = require('../apps/web/node_modules/react');
const { renderToStaticMarkup } = require('../apps/web/node_modules/react-dom/server');
const { RecommendationStep } = require('../apps/web/components/OnboardingJourney');

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const CHENNAI = { latitude: 13.0827, longitude: 80.2707, tzOffsetMinutes: 330 };
function chennaiWindows(year: number, month: number, day: number): WindowSpan[] {
  const solar = computeSolarEphemeris({ year, month, day, ...CHENNAI });
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() as WeekdayIndex;
  return computePanchangWindows(solar, weekday);
}
const hm = (h: number, m: number) => h * 60 + m;
const byType = (ws: WindowSpan[], t: string) => ws.find((w) => w.type === t)!;
function render(rec: OnboardingWindowRecommendation | undefined, hasReal = true): string {
  return renderToStaticMarkup(
    React.createElement(RecommendationStep, {
      cityName: 'Chennai', locationConfirmed: true, recommendation: rec, hasRealRecommendation: hasReal,
      onPlanMyDay: () => {}, onGoHome: () => {},
    })
  ).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
}
/** The card's claim must agree with the Panchang classification. */
function agreesWithClassification(windows: WindowSpan[], rec: OnboardingWindowRecommendation): boolean {
  if (rec.kind !== 'FAVOURABLE') return true;
  if (isInauspiciousCommencementWindow(rec.windowType)) return false;
  for (let m = rec.startMinute; m < rec.endMinute; m++) {
    if (evaluatePanchangOverlap(windows, m).commencementCaution) return false;
  }
  return rec.endMinute > rec.startMinute;
}

// ---------------------------------------------------------------------------
// 1 + 2. Saturday 21 Nov 2026, Chennai, 8:01 AM IST -- the exact AURA-READY-02
// F1 scenario: Rahu Kalam (≈9:02) is the next chronological window and
// Abhijit (≈11:32) follows it.
// ---------------------------------------------------------------------------
const sat = chennaiWindows(2026, 11, 21);
const satRahu = byType(sat, 'RAHU_KALAM');
const satAbhijit = byType(sat, 'ABHIJIT');
const T801 = hm(8, 1);
check('fixture: on Saturday Rahu Kalam starts after 8:01 and before Abhijit', satRahu.startMinutes > T801 && satRahu.startMinutes < satAbhijit.startMinutes);

// Negative test -- reproduces F1 as it was before the fix: the any-type
// nextShift the onboarding card used to display is Rahu Kalam.
const legacy = computeDailyEnergyInsight(sat, 'NEUTRAL', T801).nextShift;
check('NEGATIVE (pre-fix behaviour reproduced): the any-type nextShift onboarding used to show is Rahu Kalam', /Rahu Kalam/.test(legacy.windowName));
const legacyCardText = `Your next useful window ${legacy.windowName} Aura suggests this as a suitable period for focused activity`;
check('NEGATIVE: that pre-fix card claimed Rahu Kalam was suitable (the defect)', /Rahu Kalam/.test(legacyCardText) && /suitable period/.test(legacyCardText));

const rec1 = computeOnboardingRecommendation(sat, T801);
check('1. Rahu Kalam next: the recommendation is NOT Rahu Kalam', rec1.kind === 'FAVOURABLE' && rec1.windowType !== 'RAHU_KALAM');
check('2. favourable window after Rahu Kalam: Abhijit is recommended, at its real start', rec1.kind === 'FAVOURABLE' && rec1.windowType === 'ABHIJIT' && rec1.startMinute === satAbhijit.startMinutes && rec1.endMinute === satAbhijit.endMinutes);
check('2. starts-in text is computed from the fixed clock', rec1.kind === 'FAVOURABLE' && rec1.startsIn === `In ${Math.floor((satAbhijit.startMinutes - T801) / 60)}h ${(satAbhijit.startMinutes - T801) % 60}m` && !rec1.activeNow);
check('2. no caution is reported at 8:01 (nothing unfavourable is active)', rec1.cautionNow === undefined);
const card1 = render(rec1);
check('2. card: "Your next favourable window" + Peak Clarity (Abhijit), never Rahu Kalam', /Your next favourable window/i.test(card1) && /Peak Clarity \(Abhijit\)/.test(card1) && !/Rahu/.test(card1));
check('2. card: the old "suitable period" claim is gone', !/suitable period/.test(card1));

// ---------------------------------------------------------------------------
// 3. No favourable window in the evaluated period (rest of today).
// ---------------------------------------------------------------------------
const rec3 = computeOnboardingRecommendation(sat, hm(15, 0));
check('3. after Abhijit (3:00 PM) there is no favourable window left today', rec3.kind === 'NONE_TODAY');
const legacy3 = computeDailyEnergyInsight(sat, 'NEUTRAL', hm(15, 0)).nextShift;
check('3. NEGATIVE: at 3:00 PM the legacy nextShift wrapped to a window that has already passed today (Brahma), which the old card showed as "Today"; the fix shows no window instead', /Brahma/.test(legacy3.windowName) && rec3.kind === 'NONE_TODAY');
const card3 = render(rec3);
check('3. card: honest "No favourable window left today", no window presented as favourable or suitable', /No favourable window left today/.test(card3) && !/Your next favourable window|suitable period/i.test(card3));
const onlyCaution: WindowSpan[] = [
  { type: 'RAHU_KALAM', label: 'Rahu Kalam', startMinutes: 600, endMinutes: 690 },
  { type: 'YAMA', label: 'Yama Gandam', startMinutes: 780, endMinutes: 870 },
  { type: 'GULIKA', label: 'Gulika Kalam', startMinutes: 900, endMinutes: 990 },
];
check('3. only unfavourable windows ahead -> NONE_TODAY (never one of them)', computeOnboardingRecommendation(onlyCaution, 500).kind === 'NONE_TODAY');
const abhijitInsideCaution: WindowSpan[] = [
  { type: 'GULIKA', label: 'Gulika Kalam', startMinutes: 640, endMinutes: 727 },
  { type: 'ABHIJIT', label: 'Abhijit Muhurtham', startMinutes: 700, endMinutes: 748 },
  { type: 'RAHU_KALAM', label: 'Rahu Kalam', startMinutes: 727, endMinutes: 814 },
];
check('3. Abhijit fully covered by Gulika + Rahu Kalam is not offered (inauspicious precedence)', computeOnboardingRecommendation(abhijitInsideCaution, 600).kind === 'NONE_TODAY');
check('3. empty windows -> existing "No timing window available" branch still renders', /No timing window available right now/.test(render(undefined, false)));

// ---------------------------------------------------------------------------
// 4. The current time falls within an unfavourable window.
// ---------------------------------------------------------------------------
const T930 = hm(9, 30);
const rec4 = computeOnboardingRecommendation(sat, T930);
check('4. inside Rahu Kalam (9:30): cautionNow names Rahu Kalam and its end', !!rec4.cautionNow && /Rahu Kalam/.test(rec4.cautionNow.windowName));
check('4. inside Rahu Kalam: the recommendation is still Abhijit, not "now"', rec4.kind === 'FAVOURABLE' && rec4.windowType === 'ABHIJIT' && !rec4.activeNow);
const card4 = render(rec4);
check('4. card states Rahu Kalam is in effect as a period to avoid, and recommends Abhijit', /Right now: Friction Period \(Rahu Kalam\) until/.test(card4) && /avoids for starting important activities/.test(card4) && /Peak Clarity \(Abhijit\)/.test(card4));
check('4. card never calls Rahu Kalam favourable/suitable', !/Rahu Kalam\)[^.]*favourable period/.test(card4) && !/suitable/.test(card4));
const partial: WindowSpan[] = [
  { type: 'RAHU_KALAM', label: 'Rahu Kalam', startMinutes: 640, endMinutes: 727 },
  { type: 'ABHIJIT', label: 'Abhijit Muhurtham', startMinutes: 700, endMinutes: 748 },
];
const rec4b = computeOnboardingRecommendation(partial, 710);
check('4. inside Abhijit overlapped by Rahu Kalam: only the caution-free part (after Rahu ends) is offered', rec4b.kind === 'FAVOURABLE' && rec4b.startMinute === 728 && rec4b.endMinute === 748 && !rec4b.activeNow && !!rec4b.cautionNow);
const rec4c = computeOnboardingRecommendation(sat, satAbhijit.startMinutes + 5);
check('4. inside a clean Abhijit: "now until <end>"', rec4c.kind === 'FAVOURABLE' && rec4c.activeNow && rec4c.startsIn === 'Now' && /now until/.test(render(rec4c)));

// ---------------------------------------------------------------------------
// 5. The explanation always agrees with the suitability classification --
// swept over a whole real week (Sat 21 -> Fri 27 Nov 2026), every 5 minutes.
// ---------------------------------------------------------------------------
let sweepOk = true; let favourableSeen = 0; let noneSeen = 0; let trimmedSeen = 0;
for (let d = 21; d <= 27; d++) {
  const ws = chennaiWindows(2026, 11, d);
  const abh = byType(ws, 'ABHIJIT');
  for (let m = 0; m < 1440; m += 5) {
    const rec = computeOnboardingRecommendation(ws, m);
    if (!agreesWithClassification(ws, rec)) { sweepOk = false; console.log('  mismatch', d, m, JSON.stringify(rec)); }
    if (rec.kind === 'FAVOURABLE') { favourableSeen++; if (rec.windowType === 'ABHIJIT' && (rec.startMinute > Math.max(abh.startMinutes, m) || rec.endMinute < abh.endMinutes)) trimmedSeen++; } else noneSeen++;
    const card = render(rec);
    const cautionNames = /Rahu Kalam|Yamaganda|Gulika/;
    const titlePart = rec.kind === 'FAVOURABLE' ? rec.windowName : '';
    if (cautionNames.test(titlePart) || /suitable period/.test(card)) { sweepOk = false; console.log('  bad card', d, m); }
  }
}
check(`5. week sweep: every FAVOURABLE claim is a non-inauspicious window with no caution minute in its span (favourable=${favourableSeen}, none=${noneSeen}, trimmed=${trimmedSeen})`, sweepOk && favourableSeen > 0 && noneSeen > 0);
check('5. week sweep exercised the overlap-trim path on a real day (Abhijit overlapping a caution window)', trimmedSeen > 0);

// NEGATIVE structural guard: fails on the pre-fix component, which rendered
// the any-type nextShift under "suitable period for focused activity".
const fs = require('fs'); const path = require('path');
const journeySrc: string = fs.readFileSync(path.join(__dirname, '..', 'apps/web/components/OnboardingJourney.tsx'), 'utf8')
  .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('NEGATIVE guard: OnboardingJourney no longer renders nextShift or the "suitable period" claim', !/nextShift/.test(journeySrc) && !/suitable period/.test(journeySrc));
const pageSrc: string = fs.readFileSync(path.join(__dirname, '..', 'apps/web/app/page.tsx'), 'utf8');
check('page.tsx feeds onboarding from computeOnboardingRecommendation over the real windows', /computeOnboardingRecommendation\(windows, currentMinuteOfDay\)/.test(pageSrc) && /recommendation=\{mounted \? onboardingRecommendation : undefined\}/.test(pageSrc));

// Panchang/energy behaviour unchanged by the shared-formatter extraction.
const insight = computeDailyEnergyInsight(sat, 'NEUTRAL', T801);
check('unchanged: computeDailyEnergyInsight nextShift startTime/startsIn format', /^\d{1,2}:\d{2} (AM|PM)$/.test(insight.nextShift.startTime) && /^In (\d+h )?\d+m$/.test(insight.nextShift.startsIn));

if (!allPassed) { console.log('\nSOME CHECKS FAILED'); process.exit(1); }
console.log('\nAll onboarding recommendation checks passed.');
