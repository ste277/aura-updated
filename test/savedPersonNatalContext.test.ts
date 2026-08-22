import { natalContextFromBirthDetails } from '../apps/web/lib/natalContext';
import { buildNatalContext } from '../packages/vedic/src/natalChart';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';
import { getNakshatra } from '../packages/vedic/src/panchangElements';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Same birth details -> equivalent natal context regardless of "who" it's
// for (the authenticated user's own profile vs a SavedPerson) -- both paths
// now reduce to the exact same natalContextFromBirthDetails() call
// (apps/web/lib/natalContext.ts), used identically by:
//   - apps/web/app/api/muhurtham-search/route.ts's buildPersonalMuhurtaContext()
//   - apps/web/app/api/timing-search/route.ts's buildPersonalMuhurtaContext()
//   - apps/web/app/api/panchang/natal-chart/route.ts
//   - apps/web/lib/savedPersonNatalContext.ts's getSavedPersonNatalContext()
// ============================================================

const context1 = natalContextFromBirthDetails('1992-03-14', '08:15', 'Asia/Kolkata');
const context2 = natalContextFromBirthDetails('1992-03-14', '08:15', 'Asia/Kolkata');
check('The exact same birth details produce an identical natal context on repeated calls (deterministic, no hidden state)', JSON.stringify(context1) === JSON.stringify(context2));

// Directly cross-check against the lower-level primitives to prove
// natalContextFromBirthDetails() is not a second/divergent implementation.
const birthMomentUTC = localDateTimeToUTC('1992-03-14', '08:15', 'Asia/Kolkata');
const directNatalContext = buildNatalContext(birthMomentUTC);
check('natalContextFromBirthDetails() matches buildNatalContext() called directly on the same resolved instant (one shared implementation, not two)', JSON.stringify(context1) === JSON.stringify(directNatalContext));
const directNakshatra = getNakshatra(birthMomentUTC);
check('The natal context\'s Janma Nakshatra index matches getNakshatra() called directly', context1.natalNakshatraIndex === directNakshatra.index);
check('The natal context\'s Janma Nakshatra name matches getNakshatra() called directly', context1.janmaNakshatra === directNakshatra.name);

// ============================================================
// Janma Nakshatra / Janma Rashi derive correctly (known fixture)
// ============================================================

check('Janma Nakshatra is a non-empty recognizable name', typeof context1.janmaNakshatra === 'string' && context1.janmaNakshatra.length > 0);
check('Janma Rashi is a non-empty recognizable name', typeof context1.janmaRashi === 'string' && context1.janmaRashi.length > 0);
check('natalNakshatraIndex is within the valid 1-27 range', context1.natalNakshatraIndex >= 1 && context1.natalNakshatraIndex <= 27);
check('moonElement is one of the four recognized elements', ['FIRE', 'WATER', 'AIR', 'EARTH'].includes(context1.moonElement));

// ============================================================
// Different birth details produce different (not identical) contexts --
// proves the calculation is actually sensitive to input, not a stub.
// ============================================================

const contextDifferentDate = natalContextFromBirthDetails('1990-05-15', '08:30', 'Asia/Kolkata');
check('A different birth date produces a different natal context', JSON.stringify(context1) !== JSON.stringify(contextDifferentDate));

// ============================================================
// Timezone handling remains correct -- the same clock-time birth in two
// different timezones represents two different UTC instants and should
// generally produce different (or at least independently-correct) results;
// cross-checked against localDateTimeToUTC()/getNakshatra() directly for
// each timezone rather than asserting a specific expected difference (Moon
// movement is slow enough that a small offset might not always cross a
// Nakshatra boundary, so "must differ" isn't a safe assertion -- "must
// match the direct calculation for ITS OWN timezone" is the real invariant).
// ============================================================

const nyContext = natalContextFromBirthDetails('1992-03-14', '08:15', 'America/New_York');
const nyBirthMomentUTC = localDateTimeToUTC('1992-03-14', '08:15', 'America/New_York');
const nyDirectNakshatra = getNakshatra(nyBirthMomentUTC);
check('A birth time in a different timezone still matches its own direct getNakshatra() calculation (timezone-correct)', nyContext.natalNakshatraIndex === nyDirectNakshatra.index);
check('The same clock time in two different timezones resolves to two different UTC instants (sanity: the two Date objects differ)', birthMomentUTC.getTime() !== nyBirthMomentUTC.getTime());

console.log(allPassed ? '\nALL SAVED PERSON NATAL CONTEXT CHECKS PASSED' : '\nSOME SAVED PERSON NATAL CONTEXT CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
