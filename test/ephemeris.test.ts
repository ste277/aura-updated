import {
  computeSolarEphemeris,
  formatMinutes,
} from '../packages/astronomy/src/ephemeris';
import {
  computePanchangWindows,
  getActiveWindow,
  WeekdayIndex,
} from '../packages/panchang/src/windows';

interface VerifiedCase {
  label: string;
  year: number;
  month: number;
  day: number;
  latitude: number;
  longitude: number;
  tzOffsetMinutes: number;
  weekday: WeekdayIndex;
  expectedSunrise: string;
  expectedSunset: string;
  source: string;
}

interface SanityCase {
  label: string;
  year: number;
  month: number;
  day: number;
  latitude: number;
  longitude: number;
  tzOffsetMinutes: number;
  weekday: WeekdayIndex;
}

// Verified against live sources on 2026-07-28 (theskylive.com, time.now, oneindia.com):
// Chennai sunrise 05:51-05:53, sunset 18:37-18:39 across multiple independent sites.
const verifiedCases: VerifiedCase[] = [
  {
    label: 'Chennai, IN — 2026-07-28',
    year: 2026,
    month: 7,
    day: 28,
    latitude: 13.0827,
    longitude: 80.2707,
    tzOffsetMinutes: 330,
    weekday: 2,
    expectedSunrise: '05:52', // midpoint of 05:51-05:53 across sources
    expectedSunset: '18:38', // midpoint of 18:37-18:39 across sources
    source: 'theskylive.com, time.now, oneindia.com (fetched live)',
  },
];

// NOT independently verified against a live source — included only to sanity-check
// that the math stays internally consistent (correct season-length swing, solar noon
// always falls inside Abhijit) across latitudes and times of year. Do not treat the
// printed sunrise/sunset here as ground truth.
const sanityCases: SanityCase[] = [
  {
    label: 'New Delhi, IN — 2026-01-15 (winter, unverified sanity check)',
    year: 2026,
    month: 1,
    day: 15,
    latitude: 28.6139,
    longitude: 77.209,
    tzOffsetMinutes: 330,
    weekday: 4,
  },
  {
    label: 'Mumbai, IN — 2026-06-21 (solstice, unverified sanity check)',
    year: 2026,
    month: 6,
    day: 21,
    latitude: 19.076,
    longitude: 72.8777,
    tzOffsetMinutes: 330,
    weekday: 0,
  },
];

function minutesDiff(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return Math.abs(ah * 60 + am - (bh * 60 + bm));
}

function printWindows(solar: ReturnType<typeof computeSolarEphemeris>, weekday: WeekdayIndex) {
  const windows = computePanchangWindows(solar, weekday);
  console.log('  panchang windows:');
  for (const w of windows) {
    console.log(
      `    ${w.label.padEnd(18)} ${formatMinutes(w.startMinutes)} - ${formatMinutes(w.endMinutes)}`
    );
  }
  const active = getActiveWindow(windows, solar.solarNoonMinutes);
  const ok = active === 'ABHIJIT';
  console.log(`  active window at solar noon: ${active} ${ok ? 'OK' : 'FAIL'}`);
  return ok;
}

let allPassed = true;

console.log('=== VERIFIED CASES (checked against live sunrise/sunset sources) ===');
for (const c of verifiedCases) {
  const solar = computeSolarEphemeris(c);
  const gotSunrise = formatMinutes(solar.sunriseMinutes);
  const gotSunset = formatMinutes(solar.sunsetMinutes);
  const tolerance = 3;
  const sunriseDelta = minutesDiff(gotSunrise, c.expectedSunrise);
  const sunsetDelta = minutesDiff(gotSunset, c.expectedSunset);
  const pass = sunriseDelta <= tolerance && sunsetDelta <= tolerance;
  if (!pass) allPassed = false;

  console.log(`\n${c.label}  (source: ${c.source})`);
  console.log(`  sunrise: got ${gotSunrise}  expected ~${c.expectedSunrise}  (Δ${sunriseDelta}m) ${sunriseDelta <= tolerance ? 'OK' : 'FAIL'}`);
  console.log(`  sunset:  got ${gotSunset}  expected ~${c.expectedSunset}  (Δ${sunsetDelta}m) ${sunsetDelta <= tolerance ? 'OK' : 'FAIL'}`);
  console.log(`  solar noon: ${formatMinutes(solar.solarNoonMinutes)}`);
  if (!printWindows(solar, c.weekday)) allPassed = false;
}

console.log('\n=== SANITY CASES (internal consistency only, not verified against a live source) ===');
for (const c of sanityCases) {
  const solar = computeSolarEphemeris(c);
  console.log(`\n${c.label}`);
  console.log(`  sunrise: ${formatMinutes(solar.sunriseMinutes)}  sunset: ${formatMinutes(solar.sunsetMinutes)}  solar noon: ${formatMinutes(solar.solarNoonMinutes)}  daylight: ${solar.daylightMinutes}m`);
  if (!printWindows(solar, c.weekday)) allPassed = false;
}

console.log(`\n${allPassed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
process.exit(allPassed ? 0 : 1);
