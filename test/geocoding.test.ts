/**
 * Onboarding V1 PR 3 -- Smart Location Selection: pure regression suite
 * for lib/geocoding.ts, the one module that talks to the external
 * provider (OpenCage -- see this PR's own provider decision memo).
 * Exercises the REAL searchPlaces/reverseGeocode functions (never a
 * re-implementation) against a mocked `global.fetch`, the standard Node
 * technique for isolating an HTTP-calling module with no real network
 * access and no real API key required.
 *
 *   npx ts-node test/geocoding.test.ts
 */
import { searchPlaces, reverseGeocode, isGeocodingConfigured } from '../apps/web/lib/geocoding';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const originalFetch = global.fetch;
const originalKey = process.env.OPENCAGE_API_KEY;

function mockFetchOnce(response: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
  global.fetch = (async () => response as unknown as Response) as typeof fetch;
}

function openCageResult(overrides: Partial<{ formatted: string; lat: number; lng: number; city: string; town: string; village: string; county: string; state: string; country: string; timezone: string | null; confidence: number }> = {}) {
  return {
    formatted: overrides.formatted ?? 'Kollam, Kerala, India',
    geometry: { lat: overrides.lat ?? 8.8932, lng: overrides.lng ?? 76.6141 },
    components: {
      city: overrides.city,
      town: overrides.town,
      village: overrides.village,
      county: overrides.county,
      state: overrides.state ?? 'Kerala',
      country: overrides.country ?? 'India',
    },
    annotations: overrides.timezone === null ? {} : { timezone: { name: overrides.timezone ?? 'Asia/Kolkata' } },
    confidence: overrides.confidence ?? 9,
  };
}

async function main() {
  process.env.OPENCAGE_API_KEY = 'test-key-not-real';

  // ============================================================
  // Configuration gate.
  // ============================================================
  check('isGeocodingConfigured is true when OPENCAGE_API_KEY is set', isGeocodingConfigured());
  delete process.env.OPENCAGE_API_KEY;
  check('isGeocodingConfigured is false when OPENCAGE_API_KEY is unset', !isGeocodingConfigured());
  check('searchPlaces throws (never silently returns empty) when unconfigured -- the route layer is what turns this into a graceful 503', await (async () => {
    try {
      await searchPlaces('Kochi');
      return false;
    } catch {
      return true;
    }
  })());
  process.env.OPENCAGE_API_KEY = 'test-key-not-real';

  // ============================================================
  // Search: success, normalization, cityName derivation priority.
  // ============================================================
  mockFetchOnce({ ok: true, json: async () => ({ results: [openCageResult({ city: 'Kollam', formatted: 'Kollam, Kerala, India' })] }) });
  {
    const results = await searchPlaces('Kollam');
    check('1. a successful search returns one normalized result', results.length === 1);
    check('2. cityName prefers components.city', results[0]?.cityName === 'Kollam');
    check('3. region/country/timezone/coordinates are passed through unmodified', results[0]?.region === 'Kerala' && results[0]?.country === 'India' && results[0]?.timezone === 'Asia/Kolkata' && results[0]?.latitude === 8.8932 && results[0]?.longitude === 76.6141);
    check('4. displayName is the provider\'s own formatted string', results[0]?.displayName === 'Kollam, Kerala, India');
    check('5. confidence is passed through for low-accuracy disclosure', results[0]?.confidence === 9);
  }

  mockFetchOnce({ ok: true, json: async () => ({ results: [openCageResult({ city: undefined, town: 'Alappuzha' })] }) });
  {
    const results = await searchPlaces('Alappuzha');
    check('6. cityName falls back to town when city is absent', results[0]?.cityName === 'Alappuzha');
  }

  mockFetchOnce({ ok: true, json: async () => ({ results: [openCageResult({ city: undefined, town: undefined, village: 'Varkala' })] }) });
  {
    const results = await searchPlaces('Varkala');
    check('7. cityName falls back to village when city/town are absent', results[0]?.cityName === 'Varkala');
  }

  // ============================================================
  // Never invent coordinates or a timezone.
  // ============================================================
  mockFetchOnce({ ok: true, json: async () => ({ results: [openCageResult({ timezone: null })] }) });
  {
    const results = await searchPlaces('Nowhere');
    check('8. a result with NO timezone annotation is dropped entirely, never defaulted to a guessed zone', results.length === 0);
  }

  mockFetchOnce({ ok: true, json: async () => ({ results: [{ formatted: 'Bad Result', geometry: { lat: 'not-a-number', lng: 76.6 }, components: { city: 'Bad' }, annotations: { timezone: { name: 'Asia/Kolkata' } } }] }) });
  {
    const results = await searchPlaces('Bad');
    check('9. a result with non-finite coordinates is dropped, never coerced/invented', results.length === 0);
  }

  // ============================================================
  // Search ambiguity and no results.
  // ============================================================
  mockFetchOnce({ ok: true, json: async () => ({ results: [openCageResult({ city: 'Kochi', formatted: 'Kochi, Kerala, India' }), openCageResult({ city: 'Cochin', formatted: 'Cochin, Ontario, Canada', state: 'Ontario', country: 'Canada', lat: 50.0, lng: -103.0, timezone: 'America/Regina' })] }) });
  {
    const results = await searchPlaces('Kochi');
    check('10. multiple genuinely different matches are all returned (disambiguation), never auto-collapsed to one', results.length === 2);
    check('10b. the two ambiguous results keep their own distinct region/country/timezone', results[0]?.country === 'India' && results[1]?.country === 'Canada');
  }

  mockFetchOnce({ ok: true, json: async () => ({ results: [] }) });
  {
    const results = await searchPlaces('Xyzzyqqqnotarealplace');
    check('11. zero provider results is a normal, non-throwing empty array, not an error', results.length === 0);
  }

  check('12. an empty/whitespace-only query never calls the provider at all (returns [] immediately)', (await searchPlaces('   ')).length === 0);

  // ============================================================
  // Provider unavailable: HTTP error, network error, malformed response.
  // ============================================================
  mockFetchOnce({ ok: false, status: 402, json: async () => ({ status: { message: 'quota exceeded' } }) });
  check('13. a non-2xx provider response throws (never silently returns [])', await (async () => {
    try { await searchPlaces('Kochi'); return false; } catch { return true; }
  })());

  global.fetch = (async () => { throw new Error('network unreachable'); }) as typeof fetch;
  check('14. a thrown network error propagates as a clear error (never silently returns [])', await (async () => {
    try { await searchPlaces('Kochi'); return false; } catch (e) { return e instanceof Error && /unreachable/.test(e.message); }
  })());

  // Final Integration Validation -- the API key must never leak into a
  // thrown error, even when the underlying fetch failure's own message
  // would have embedded the full request URL (which carries the key as a
  // query param). Simulates exactly that worst case: a fetch rejection
  // whose own .message contains the real key.
  global.fetch = (async () => {
    throw new TypeError(`fetch failed: request to https://api.opencagedata.com/geocode/v1/json?key=${process.env.OPENCAGE_API_KEY}&q=Kochi failed`);
  }) as typeof fetch;
  check('14b. SECURITY: the API key never appears in a thrown error\'s own message, even when the underlying fetch error embedded the full request URL', await (async () => {
    try {
      await searchPlaces('Kochi');
      return false;
    } catch (e) {
      return e instanceof Error && !e.message.includes(process.env.OPENCAGE_API_KEY!) && !/key=/.test(e.message);
    }
  })());

  mockFetchOnce({ ok: true, json: async () => ({ notResults: 'malformed' }) });
  check('15. a malformed (non-array results) provider response throws rather than crashing on .map', await (async () => {
    try { await searchPlaces('Kochi'); return false; } catch { return true; }
  })());

  // ============================================================
  // Reverse geocoding.
  // ============================================================
  mockFetchOnce({ ok: true, json: async () => ({ results: [openCageResult({ city: 'Kollam', lat: 8.8932, lng: 76.6141 })] }) });
  {
    const result = await reverseGeocode(8.8932, 76.6141);
    check('16. a successful reverse geocode returns the normalized best match', result?.cityName === 'Kollam' && result?.timezone === 'Asia/Kolkata');
  }

  mockFetchOnce({ ok: true, json: async () => ({ results: [openCageResult({ timezone: null }), openCageResult({ city: 'Thiruvananthapuram', timezone: 'Asia/Kolkata' })] }) });
  {
    const result = await reverseGeocode(8.5, 76.9);
    check('17. reverseGeocode skips a candidate with no usable timezone and falls through to the next one with one', result?.cityName === 'Thiruvananthapuram');
  }

  mockFetchOnce({ ok: true, json: async () => ({ results: [openCageResult({ timezone: null })] }) });
  {
    const result = await reverseGeocode(0, 0);
    check('18. reverseGeocode returns null (never a fabricated fallback) when NOTHING usable is returned', result === null);
  }

  mockFetchOnce({ ok: true, json: async () => ({ results: [] }) });
  check('19. reverseGeocode returns null, not an error, for a coordinate with zero provider results', (await reverseGeocode(0, 0)) === null);

  mockFetchOnce({ ok: false, status: 500, json: async () => ({ status: { message: 'server error' } }) });
  check('20. reverseGeocode throws on a provider error (route layer turns this into a 502)', await (async () => {
    try { await reverseGeocode(8.9, 76.6); return false; } catch { return true; }
  })());

  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENCAGE_API_KEY;
  else process.env.OPENCAGE_API_KEY = originalKey;

  if (!allPassed) {
    console.error('\nSOME GEOCODING CHECKS FAILED');
    process.exit(1);
  }
  console.log('\nALL GEOCODING CHECKS PASSED');
}

main().catch((err) => {
  global.fetch = originalFetch;
  console.error(err);
  process.exit(1);
});
