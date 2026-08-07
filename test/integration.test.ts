import { computeSolarEphemeris } from '../packages/astronomy/src/ephemeris';
import { computePanchangWindows, getActiveWindow } from '../packages/panchang/src/windows';
import { getActionCards } from '../packages/recommendation/src/actionCards';

// Simulates the full "tap arc -> get 3 cards" flow for a live moment.
const solar = computeSolarEphemeris({
  year: 2026, month: 7, day: 28,
  latitude: 13.0827, longitude: 80.2707, tzOffsetMinutes: 330,
});
const windows = computePanchangWindows(solar, 2); // Tuesday
const nowMinuteOfDay = solar.solarNoonMinutes; // simulate "tapping" at solar noon
const active = getActiveWindow(windows, nowMinuteOfDay);
const cards = getActionCards(active);

console.log(`Active window: ${active}`);
console.log('Cards:', cards.map(c => c.title));

if (active === 'ABHIJIT' && cards.length === 3) {
  console.log('INTEGRATION TEST PASSED');
  process.exit(0);
} else {
  console.log('INTEGRATION TEST FAILED');
  process.exit(1);
}
