import { addDaysToDateStr, computePresetRange, daySpan, formatDateLabel, partitionDatesByStrength, partitionSharedDatesByStrength } from '../apps/web/components/MuhurthamFinderView';
import type { MuhurthamDateCandidate, MuhurthamSharedDateCandidate } from '../packages/recommendation/src/muhurthamFinder';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// RANGE PRESETS (activity/range selection, brief section 12)
// ============================================================

check('THIS_MONTH starts today and ends the last day of the current month', JSON.stringify(computePresetRange('THIS_MONTH', '2026-09-15', '', '')) === JSON.stringify({ start: '2026-09-15', end: '2026-09-30' }));
check('THIS_MONTH handles a 31-day month correctly', JSON.stringify(computePresetRange('THIS_MONTH', '2026-01-05', '', '')) === JSON.stringify({ start: '2026-01-05', end: '2026-01-31' }));
check('NEXT_MONTH starts on the 1st of next month and ends on its last day', JSON.stringify(computePresetRange('NEXT_MONTH', '2026-09-15', '', '')) === JSON.stringify({ start: '2026-10-01', end: '2026-10-31' }));
check('NEXT_MONTH rolls over the year boundary from December', JSON.stringify(computePresetRange('NEXT_MONTH', '2026-12-10', '', '')) === JSON.stringify({ start: '2027-01-01', end: '2027-01-31' }));
check('NEXT_3_MONTHS starts today and spans 90 days total', (() => {
  const r = computePresetRange('NEXT_3_MONTHS', '2026-09-15', '', '');
  return r !== null && r.start === '2026-09-15' && daySpan(r.start, r.end) === 89;
})());
check('NEXT_3_MONTHS stays within the 180-day API cap', (() => {
  const r = computePresetRange('NEXT_3_MONTHS', '2026-09-15', '', '');
  return r !== null && daySpan(r.start, r.end) < 180;
})());
check('CUSTOM with a valid start/end is accepted as-is', JSON.stringify(computePresetRange('CUSTOM', '2026-09-15', '2026-10-01', '2026-10-10')) === JSON.stringify({ start: '2026-10-01', end: '2026-10-10' }));
check('CUSTOM with no dates chosen yet returns null (not a manufactured range)', computePresetRange('CUSTOM', '2026-09-15', '', '') === null);
check('CUSTOM with end before start returns null', computePresetRange('CUSTOM', '2026-09-15', '2026-10-10', '2026-10-01') === null);
check('CUSTOM with start === end is accepted (single-day search)', JSON.stringify(computePresetRange('CUSTOM', '2026-09-15', '2026-10-05', '2026-10-05')) === JSON.stringify({ start: '2026-10-05', end: '2026-10-05' }));

check('addDaysToDateStr advances within a month', addDaysToDateStr('2026-09-01', 10) === '2026-09-11');
check('addDaysToDateStr rolls over a month boundary', addDaysToDateStr('2026-09-25', 10) === '2026-10-05');
check('addDaysToDateStr rolls over a year boundary', addDaysToDateStr('2026-12-28', 10) === '2027-01-07');
check('daySpan is 0 for the same date', daySpan('2026-09-01', '2026-09-01') === 0);
check('daySpan counts inclusive-exclusive day difference', daySpan('2026-09-01', '2026-09-30') === 29);

// ============================================================
// DATE LABEL FORMATTING
// ============================================================

check('formatDateLabel renders a short weekday + month + day', formatDateLabel('2026-09-01', 'Asia/Kolkata') === new Date(Date.UTC(2026, 8, 1, 12, 0, 0)).toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short', month: 'short', day: 'numeric' }));

// ============================================================
// RESULTS RENDERING / NO-RESULT STATE (brief sections 13, 15)
// ============================================================

function fakeDate(date: string, rating: MuhurthamDateCandidate['rating']): MuhurthamDateCandidate {
  return {
    date,
    rating,
    score: rating === 'ACCEPTABLE' ? 6 : 8,
    bestWindow: { start: `${date}T06:00:00.000Z`, end: `${date}T07:00:00.000Z`, score: 8, label: 'VERY_GOOD', muhurtaScore: 10, reasons: [], metadata: { windowType: 'ABHIJIT', windowLabel: 'Abhijit Muhurtham', activityType: 'Start a Journey', dateLabel: date } },
    alternateWindows: [],
    reasons: [],
    cautions: [],
    panchangSummary: { vara: 'Somavara', tithi: 'Shukla Panchami', nakshatra: 'Ashwini', yoga: 'Priti', karana: 'Bava' },
  };
}

const mixedDates = [fakeDate('2026-09-01', 'EXCELLENT'), fakeDate('2026-09-02', 'ACCEPTABLE'), fakeDate('2026-09-03', 'STRONG'), fakeDate('2026-09-04', 'ACCEPTABLE'), fakeDate('2026-09-05', 'FAVORABLE')];
const { strong, acceptable } = partitionDatesByStrength(mixedDates);
check('partitionDatesByStrength separates ACCEPTABLE from stronger ratings', strong.length === 3 && acceptable.length === 2);
check('partitionDatesByStrength keeps EXCELLENT/STRONG/FAVORABLE in "strong"', strong.every((d) => d.rating !== 'ACCEPTABLE'));
check('partitionDatesByStrength keeps only ACCEPTABLE in "acceptable"', acceptable.every((d) => d.rating === 'ACCEPTABLE'));
check('partitionDatesByStrength preserves original order within each bucket', strong.map((d) => d.date).join(',') === '2026-09-01,2026-09-03,2026-09-05');

const allAcceptable = [fakeDate('2026-09-01', 'ACCEPTABLE'), fakeDate('2026-09-02', 'ACCEPTABLE')];
const allAcceptableSplit = partitionDatesByStrength(allAcceptable);
check('When every returned date is only ACCEPTABLE, "strong" is empty (drives the no-result state even though the API returned rows)', allAcceptableSplit.strong.length === 0 && allAcceptableSplit.acceptable.length === 2);

const noneAtAll = partitionDatesByStrength([]);
check('partitionDatesByStrength on an empty result is empty on both sides (true no-result state)', noneAtAll.strong.length === 0 && noneAtAll.acceptable.length === 0);

// ============================================================
// SHARED RESULTS RENDERING / NO-RESULT STATE (Shared Muhurtham brief sections 13, 15, 16)
// ============================================================

function fakeSharedDate(date: string, rating: MuhurthamSharedDateCandidate['rating']): MuhurthamSharedDateCandidate {
  const baseWindow = { start: `${date}T06:00:00.000Z`, end: `${date}T07:00:00.000Z`, score: 8, label: 'VERY_GOOD' as const, muhurtaScore: 10, reasons: [], metadata: { windowType: 'ABHIJIT' as const, windowLabel: 'Abhijit Muhurtham', activityType: 'Start a Journey', dateLabel: date } };
  return {
    date,
    rating,
    generalScore: 8,
    user: { score: 8, factors: {}, reasons: [] },
    person: { savedPersonId: 'p1', name: 'Anu', score: 8, factors: {}, reasons: [] },
    sharedScore: rating === 'MIXED_SHARED_FIT' ? 6 : 8,
    balance: 10,
    bestWindow: baseWindow,
    alternateWindows: [],
    reasons: [],
    cautions: [],
    panchangSummary: { vara: 'Somavara', tithi: 'Shukla Panchami', nakshatra: 'Ashwini', yoga: 'Priti', karana: 'Bava' },
  };
}

const mixedSharedDates = [fakeSharedDate('2026-09-01', 'EXCELLENT_SHARED_FIT'), fakeSharedDate('2026-09-02', 'MIXED_SHARED_FIT'), fakeSharedDate('2026-09-03', 'STRONG_SHARED_FIT'), fakeSharedDate('2026-09-04', 'MIXED_SHARED_FIT'), fakeSharedDate('2026-09-05', 'GOOD_SHARED_FIT')];
const { strong: sharedStrong, mixed: sharedMixed } = partitionSharedDatesByStrength(mixedSharedDates);
check('partitionSharedDatesByStrength separates MIXED_SHARED_FIT from stronger ratings', sharedStrong.length === 3 && sharedMixed.length === 2);
check('partitionSharedDatesByStrength keeps EXCELLENT/STRONG/GOOD in "strong"', sharedStrong.every((d) => d.rating !== 'MIXED_SHARED_FIT'));
check('partitionSharedDatesByStrength keeps only MIXED_SHARED_FIT in "mixed"', sharedMixed.every((d) => d.rating === 'MIXED_SHARED_FIT'));
check('partitionSharedDatesByStrength preserves original order within each bucket', sharedStrong.map((d) => d.date).join(',') === '2026-09-01,2026-09-03,2026-09-05');

const allMixed = [fakeSharedDate('2026-09-01', 'MIXED_SHARED_FIT'), fakeSharedDate('2026-09-02', 'MIXED_SHARED_FIT')];
const allMixedSplit = partitionSharedDatesByStrength(allMixed);
check('When every returned SHARED date is only MIXED_SHARED_FIT, "strong" is empty (drives the no-result state even though the API returned rows)', allMixedSplit.strong.length === 0 && allMixedSplit.mixed.length === 2);

const noSharedDates = partitionSharedDatesByStrength([]);
check('partitionSharedDatesByStrength on an empty result is empty on both sides (true no-result state)', noSharedDates.strong.length === 0 && noSharedDates.mixed.length === 0);

console.log(allPassed ? '\nALL MUHURTHAM FINDER VIEW LOGIC CHECKS PASSED' : '\nSOME MUHURTHAM FINDER VIEW LOGIC CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
